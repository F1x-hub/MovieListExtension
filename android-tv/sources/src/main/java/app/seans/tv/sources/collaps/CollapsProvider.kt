package app.seans.tv.sources.collaps

import app.seans.tv.model.EpisodeInfo
import app.seans.tv.model.EpisodeKey
import app.seans.tv.model.PlayableStream
import app.seans.tv.model.ProviderId
import app.seans.tv.model.SeansError
import app.seans.tv.model.SeasonInfo
import app.seans.tv.model.SourceKind
import app.seans.tv.model.SourceOption
import app.seans.tv.model.SourceQuery
import app.seans.tv.model.StreamFallback
import app.seans.tv.model.StreamFormat
import app.seans.tv.model.VoiceOption
import app.seans.tv.network.SeansHttp
import app.seans.tv.sources.internal.Fetcher
import app.seans.tv.sources.internal.NO_EPISODE
import app.seans.tv.sources.internal.Provider
import app.seans.tv.sources.internal.requireUsable
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Collaps: the Venom balancer asked by Kinopoisk ID (`/embed/kp/<id>`, no token), films and
 * series. Not the linkpp network. Played natively: the embed page carries the manifests.
 *
 * [resolve] plays the VP9 DASH (up to 1080p) with the H.264 HLS (up to 720p) as
 * [PlayableStream.fallback]. Voices are audio renditions of one manifest, and their order
 * differs between episodes, so [VoiceOption.id] / [PlayableStream.voiceId] are a name key
 * ([CollapsMedia.voiceKeys]) and [resolve] maps it to the rendition index of *that* episode in
 * [PlayableStream.audioTrackIndex] (HLS `EXT-X-MEDIA` order, the digit of DASH `lang="ruN"`).
 * An unknown key plays the episode's default voice.
 * [PlayableStream.episode] is the episode the page lists the stream under.
 */
internal class CollapsProvider(
    private val fetcher: Fetcher,
    private val domains: BalancerDomains = BalancerDomains(fetcher),
    private val clock: () -> Long = System::currentTimeMillis,
) : Provider {
    override val id = ProviderId.COLLAPS

    override fun accepts(query: SourceQuery): Boolean = query.ref.kinopoiskId > 0

    override fun cacheKey(query: SourceQuery): String = "kp${query.ref.kinopoiskId}:${query.episode?.storageKey() ?: "-"}"

    private class Cached(val page: CollapsPage, val at: Long)

    private val pages = object : LinkedHashMap<Long, Cached>(8, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Long, Cached>?) = size > PAGE_CACHE_SIZE
    }

    override suspend fun find(query: SourceQuery): SourceOption? {
        val kp = query.ref.kinopoiskId
        val page = page(kp) ?: return null
        val handle = handleOf(kp)

        if (!page.isSeries) {
            val film = page.film ?: return null
            return SourceOption(
                providerId = id,
                kind = SourceKind.DIRECT,
                handle = handle,
                voices = voicesOf(aligned(film)),
                // A film page never stands in for an episode (a wrong KP ID lands on a film).
                unavailableReason = if (query.episode != null) NO_EPISODE else null,
            )
        }

        val seasons = page.episodes.groupBy { it.season }.toSortedMap().map { (season, episodes) ->
            SeasonInfo(
                number = season,
                episodes = episodes.map { EpisodeInfo(key = EpisodeKey(it.season, it.episode), durationSec = it.media.durationSec) },
            )
        }
        val wanted = query.episode
        val match = wanted?.let { key -> page.episodes.firstOrNull { it.season == key.season && it.episode == key.episode } }
        return SourceOption(
            providerId = id,
            kind = SourceKind.DIRECT,
            handle = handle,
            voices = voicesOf(aligned((match ?: page.episodes.first()).media)),
            seasons = seasons,
            unavailableReason = if (wanted != null && match == null) NO_EPISODE else null,
        )
    }

    override suspend fun resolve(option: SourceOption, episode: EpisodeKey?, voiceId: String?, fresh: Boolean): PlayableStream {
        val kp = kpOf(option.handle)
        val page = page(kp, fresh) ?: throw SeansError(SeansError.Code.NOT_FOUND, "Collaps has no such title")
        val (key, listed) = if (page.isSeries) {
            val chosen = if (episode == null) page.episodes.first()
            else page.episodes.firstOrNull { it.season == episode.season && it.episode == episode.episode }
                ?: throw SeansError(SeansError.Code.NOT_FOUND, NO_EPISODE)
            EpisodeKey(chosen.season, chosen.episode) to chosen.media
        } else {
            // An episode was asked for and this is a film page: never play the film as the episode.
            if (episode != null) throw SeansError(SeansError.Code.NOT_FOUND, NO_EPISODE)
            null to (page.film ?: throw SeansError(SeansError.Code.NOT_FOUND, "Collaps has no film stream"))
        }

        val media = aligned(listed)
        // Voices are keyed by name: the rendition order differs between episodes of one title.
        val keys = media.voiceKeys()
        val voiceIndex = voiceId?.let { keys.indexOf(it) }?.takeIf { it >= 0 } ?: media.voiceOrder.firstOrNull()
        val dash = media.dash?.let { StreamFallback(it, StreamFormat.DASH) }
        val hls = media.hls?.let { StreamFallback(it, StreamFormat.HLS) }
        val primary = dash ?: hls ?: throw SeansError(SeansError.Code.PROVIDER_CHANGED, "Collaps episode has no manifest")
        return PlayableStream(
            url = primary.url,
            format = primary.format,
            // The CDN refuses segments to any other UA (measured: curl's UA got 410). No Referer needed.
            headers = mapOf("User-Agent" to SeansHttp.USER_AGENT),
            episode = key,
            providerId = id,
            voiceId = voiceIndex?.let { keys[it] },
            subtitles = media.subtitles,
            audioTrackIndex = voiceIndex,
            fallback = hls.takeIf { primary === dash },
            expiresAt = signedExpiryMillis(primary.url),
        )
    }

    /** The embed page, cached for a while: its URLs are signed for days. Null when the balancer has no such title. */
    private suspend fun page(kp: Long, fresh: Boolean = false): CollapsPage? {
        if (!fresh) synchronized(pages) {
            pages[kp]?.takeIf { clock() - it.at < PAGE_TTL_MS }?.let { return it.page }
        }
        for (attempt in 0..1) {
            val host = domains.host()
            val result = fetcher.get("https://$host/embed/kp/$kp", PAGE_HEADERS)
            // What a domain the balancer has left answers.
            if (result.code == 422) {
                if (attempt == 0 && domains.refresh()) continue
                throw SeansError(SeansError.Code.PROVIDER_CHANGED, "Collaps domain retired")
            }
            val usable = result.requireUsable("Collaps") ?: return null
            val page = CollapsPage.parse(usable.body)
                ?: throw SeansError(SeansError.Code.PROVIDER_CHANGED, "Collaps page has no player")
            if (!page.isSeries && page.film == null) return null
            synchronized(pages) { pages[kp] = Cached(page, clock()) }
            return page
        }
        return null
    }

    /** Rendition languages by HLS master URL (signed, so a renewed page asks again). */
    private val trackLanguages = object : LinkedHashMap<String, List<String?>>(8, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, List<String?>>?) = size > PAGE_CACHE_SIZE * 4
    }

    /**
     * [media] with its voice names moved onto the renditions of their language when the
     * balancer's list contradicts the HLS tags ([VoiceLanguages]). Any failure keeps the names.
     */
    private suspend fun aligned(media: CollapsMedia): CollapsMedia {
        val hls = media.hls ?: return media
        if (media.voices.size < 2) return media
        val languages = synchronized(trackLanguages) { trackLanguages[hls] } ?: run {
            val result = try {
                withTimeoutOrNull(MASTER_TIMEOUT_MS) { fetcher.get(hls, mapOf("User-Agent" to SeansHttp.USER_AGENT)) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                null
            }
            // No answer in time: ask again next time. A refusal is remembered as «no tags».
            result ?: return media
            VoiceLanguages.trackLanguages(if (result.ok) result.body else "").also { found -> synchronized(trackLanguages) { trackLanguages[hls] = found } }
        }
        val names = VoiceLanguages.namesForTracks(media.voices, languages) ?: return media
        return media.copy(voices = names)
    }

    private fun voicesOf(media: CollapsMedia): List<VoiceOption> {
        val keys = media.voiceKeys()
        return media.voiceOrder.map { VoiceOption(id = keys[it], name = media.voices[it].ifEmpty { "Дорожка ${it + 1}" }) }
    }

    companion object {
        private const val PAGE_TTL_MS = 20 * 60 * 1000L
        private const val PAGE_CACHE_SIZE = 6
        private const val MASTER_TIMEOUT_MS = 4_000L

        /** As the extension opens the frame: in the name of Ex-FS. The page answers without it too. */
        private val PAGE_HEADERS = mapOf(
            "Referer" to "https://ex-fs.net/",
            "Accept" to "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language" to "ru-RU,ru;q=0.9,en;q=0.8",
        )

        fun handleOf(kp: Long): String = "kp:$kp"

        fun kpOf(handle: String): Long =
            handle.removePrefix("kp:").toLongOrNull()?.takeIf { it > 0 }
                ?: throw SeansError(SeansError.Code.PROVIDER_CHANGED, "Bad Collaps handle")
    }
}
