package app.seans.tv.player.broadcast

import app.seans.tv.model.SubtitleTrack
import app.seans.tv.model.VoiceOption
import app.seans.tv.player.BroadcastController
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The [BroadcastController] `:live` passes to `BroadcastPlayer`: create one with
 * `remember { BroadcastControls() }`, pass it as `controller`, and drive its methods from the
 * Live screen's buttons. The player connects it to whichever session is playing; calls made while
 * nothing plays are kept and applied when playback starts. [voicesFlow] and [subtitlesFlow] change
 * when the source changes, so the buttons can be drawn from them.
 */
class BroadcastControls : BroadcastController {
    private var session: BroadcastSession? = null
    private var pendingVoice: String? = null
    private var pendingSubtitle: String? = null
    private var subtitleSet = false
    private var muted = false

    private val _voices = MutableStateFlow<List<VoiceOption>>(emptyList())
    private val _subtitles = MutableStateFlow<List<SubtitleTrack>>(emptyList())
    private val _selectedVoice = MutableStateFlow<String?>(null)
    private val _selectedSubtitle = MutableStateFlow<String?>(null)
    private val _muted = MutableStateFlow(false)

    val voicesFlow: StateFlow<List<VoiceOption>> = _voices.asStateFlow()
    val subtitlesFlow: StateFlow<List<SubtitleTrack>> = _subtitles.asStateFlow()
    val selectedVoice: StateFlow<String?> = _selectedVoice.asStateFlow()
    /** URL of the subtitle shown, null when off. */
    val selectedSubtitle: StateFlow<String?> = _selectedSubtitle.asStateFlow()
    val isMuted: StateFlow<Boolean> = _muted.asStateFlow()

    override fun voices(): List<VoiceOption> = _voices.value
    override fun subtitles(): List<SubtitleTrack> = _subtitles.value

    override fun selectVoice(id: String) {
        _selectedVoice.value = id
        session?.selectVoice(id) ?: run { pendingVoice = id }
    }

    override fun selectSubtitle(url: String?) {
        _selectedSubtitle.value = url
        session?.selectSubtitle(url) ?: run { pendingSubtitle = url; subtitleSet = true }
    }

    override fun setMuted(muted: Boolean) {
        this.muted = muted
        _muted.value = muted
        session?.setMuted(muted)
    }

    internal fun bind(session: BroadcastSession) {
        this.session = session
        session.setMuted(muted)
        pendingVoice?.let { session.selectVoice(it); pendingVoice = null }
        if (subtitleSet) { session.selectSubtitle(pendingSubtitle); subtitleSet = false }
    }

    internal fun unbind(session: BroadcastSession) {
        if (this.session === session) this.session = null
    }

    internal fun publish(voices: List<VoiceOption>, subtitles: List<SubtitleTrack>, voiceId: String?) {
        _voices.value = voices
        _subtitles.value = subtitles
        if (voiceId != null) _selectedVoice.value = voiceId
        if (_selectedSubtitle.value != null && subtitles.none { it.url == _selectedSubtitle.value }) _selectedSubtitle.value = null
    }
}
