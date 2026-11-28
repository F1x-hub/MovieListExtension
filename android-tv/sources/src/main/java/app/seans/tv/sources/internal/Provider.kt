package app.seans.tv.sources.internal

import app.seans.tv.model.EpisodeKey
import app.seans.tv.model.PlayableStream
import app.seans.tv.model.ProviderId
import app.seans.tv.model.SourceOption
import app.seans.tv.model.SourceQuery

/** One provider port. Implementations hold no UI state and never log URLs, only hosts. */
internal interface Provider {
    val id: ProviderId

    /** Whether this provider can have the title at all (Seasonvar has no films, ...). */
    fun accepts(query: SourceQuery): Boolean

    /** What makes two queries the same for this provider's cache (the provider id is added). */
    fun cacheKey(query: SourceQuery): String

    /** The provider's offer, or null when it has no such title. Errors are [app.seans.tv.model.SeansError]. */
    suspend fun find(query: SourceQuery): SourceOption?

    /**
     * [fresh] skips every cache of the provider. An unknown [voiceId] (or one without this
     * episode) falls back to the default voice; the stream's `voiceId` is the voice chosen.
     */
    suspend fun resolve(option: SourceOption, episode: EpisodeKey?, voiceId: String?, fresh: Boolean = false): PlayableStream
}

/** «Этой серии нет», the panel line for a source that lacks the asked episode. */
internal const val NO_EPISODE = "Этой серии нет"
