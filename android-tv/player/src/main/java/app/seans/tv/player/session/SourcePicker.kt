package app.seans.tv.player.session

import app.seans.tv.model.EpisodeKey
import app.seans.tv.model.ProviderId
import app.seans.tv.model.SourceEvent
import app.seans.tv.model.SourceKind
import app.seans.tv.model.SourceOption

/**
 * Collects the answers of `SourceResolver.find` and decides which option to play.
 *
 * Order: the request's preferred provider, then the provider stored with the progress, then
 * [ProviderId] priority order. An option is offered as soon as every better-ranked provider has
 * answered, so a fast low-priority provider never wins over a slower better one, and nobody waits
 * for the slowest provider when the best one is already in. Web-only options and options that
 * cannot play the episode are listed for the panel but never played.
 */
internal class SourcePicker(
    private val preferred: ProviderId?,
    private val stored: ProviderId?,
    private val episode: EpisodeKey?,
) {
    private val found = mutableListOf<SourceOption>()
    private val answered = mutableSetOf<ProviderId>()
    private val failed = mutableSetOf<ProviderId>()

    /** True once the resolver said every provider has answered. */
    var done: Boolean = false
        private set

    /** Every option found so far, in rank order, for the «Источник» panel. */
    val options: List<SourceOption> get() = found.sortedBy { rank(it.providerId) }

    fun onEvent(event: SourceEvent) {
        when (event) {
            is SourceEvent.Found -> {
                val option = event.option
                if (found.none { it.providerId == option.providerId && it.handle == option.handle }) found += option
                answered += option.providerId
            }
            is SourceEvent.Failed -> {
                answered += event.providerId
                failed += event.providerId
            }
            SourceEvent.Done -> done = true
        }
    }

    fun rank(provider: ProviderId): Int = when (provider) {
        preferred -> 0
        stored -> 1
        else -> 2 + provider.ordinal
    }

    /** Whether the player can play [option] for the requested episode. */
    fun isPlayable(option: SourceOption): Boolean {
        if (option.kind != SourceKind.DIRECT || option.unavailableReason != null) return false
        val ep = episode ?: return true
        if (!option.providerId.supportsEpisodes) return false
        return option.seasons.isEmpty() || option.seasons.any { season -> season.episodes.any { it.key == ep } }
    }

    /**
     * The best playable option not in [tried], or null when a better-ranked provider may still
     * answer. [force] (search timed out) takes the best one found so far.
     */
    fun next(tried: Collection<SourceOption>, force: Boolean = false): SourceOption? {
        val best = found.filter { isPlayable(it) && it !in tried }.minByOrNull { rank(it.providerId) } ?: return null
        if (done || force) return best
        val bestRank = rank(best.providerId)
        val waiting = ProviderId.entries.any { rank(it) < bestRank && it !in answered }
        return if (waiting) null else best
    }

    /**
     * The viewer's explicit choice ([preferred], rank 0) has not answered yet. No grace period may
     * pass over it: the player waits for it to answer or fail (bounded by the search timeout).
     */
    fun waitingForPreferred(): Boolean = preferred != null && preferred !in answered && !done

    /** No option is left to try and none can still arrive. */
    fun exhausted(tried: Collection<SourceOption>): Boolean = done && found.none { isPlayable(it) && it !in tried }

    /** Some provider failed (network, blocked) rather than simply not having the title. */
    val anyFailed: Boolean get() = failed.isNotEmpty()

    companion object {
        /** The voice to ask for: the preferred one, then the stored one, when the option has it. */
        fun voiceFor(option: SourceOption, preferred: String?, stored: String?): String? {
            if (option.voices.isEmpty()) return preferred ?: stored
            return listOf(preferred, stored).firstOrNull { id -> id != null && option.voices.any { it.id == id } }
                ?: option.voices.first().id
        }
    }
}
