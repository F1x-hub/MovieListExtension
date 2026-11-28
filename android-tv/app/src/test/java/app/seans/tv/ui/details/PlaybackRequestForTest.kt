package app.seans.tv.ui.details

import app.seans.tv.model.EpisodeKey
import app.seans.tv.model.MediaType
import app.seans.tv.model.ProviderId
import app.seans.tv.model.SelectionReason
import app.seans.tv.model.TitleRef
import app.seans.tv.model.TitleSummary
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlaybackRequestForTest {
    private val summary = TitleSummary(TitleRef(404900, MediaType.SERIES), "Во все тяжкие")
    private val e25 = EpisodeKey(2, 5)

    @Test fun noExplicitPickLeavesTheChoiceToThePlayer() {
        val r = playbackRequestFor(summary, e25, SelectionReason.RESUME, pickedProvider = null, pickedVoice = null)
        assertNull(r.preferredProvider)
        assertNull(r.preferredVoiceId)
    }

    @Test fun anExplicitPickIsPassedOn() {
        val r = playbackRequestFor(summary, e25, SelectionReason.EPISODE_PICK, ProviderId.ANIMEGO, "anilibria")
        assertEquals(ProviderId.ANIMEGO, r.preferredProvider)
        assertEquals("anilibria", r.preferredVoiceId)
        assertEquals(e25, r.episode)
        assertEquals(SelectionReason.EPISODE_PICK, r.reason)
    }

    @Test fun aVoiceWithoutItsSourceIsNotPassed() {
        val r = playbackRequestFor(summary, e25, SelectionReason.RESUME, pickedProvider = null, pickedVoice = "lostfilm")
        assertNull(r.preferredVoiceId)
    }
}
