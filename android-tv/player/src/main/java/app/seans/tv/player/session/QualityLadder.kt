package app.seans.tv.player.session

import app.seans.tv.model.PlayableStream
import app.seans.tv.model.QualityOption
import app.seans.tv.player.engine.PlayerBudget

/** One quality that is a stream of its own (Kodik). */
internal data class QualityStep(val option: QualityOption, val url: String)

/**
 * The separate-stream qualities of a [PlayableStream], best first. Empty when the stream has a
 * single URL (an adaptive HLS master or one MP4): then the engine's variants are the qualities.
 * [PlayableStream.alternatives] are "other" qualities, so the main URL joins them when it is not
 * one of them, labelled with the option's best known quality.
 */
internal object QualityLadder {
    fun of(stream: PlayableStream, mainLabel: String?): List<QualityStep> {
        if (stream.alternatives.isEmpty()) return emptyList()
        val steps = stream.alternatives.map { (option, url) -> QualityStep(option, url) }.toMutableList()
        if (steps.none { it.url == stream.url }) {
            val height = mainLabel?.let { Regex("(\\d{3,4})").find(it)?.value?.toIntOrNull() } ?: Int.MAX_VALUE
            steps += QualityStep(QualityOption(height, mainLabel ?: "Авто"), stream.url)
        }
        return steps.distinctBy { it.url }.sortedByDescending { it.option.height }
    }

    /** Where playback starts: the highest step the panel can show (1080p), else the lowest there is. */
    fun startIndex(steps: List<QualityStep>): Int {
        if (steps.isEmpty()) return -1
        val fitting = steps.indexOfFirst { it.option.height <= PlayerBudget.MAX_VIDEO_HEIGHT }
        return if (fitting >= 0) fitting else steps.lastIndex
    }
}
