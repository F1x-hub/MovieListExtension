package app.seans.tv.player

import app.seans.tv.player.session.BarAction
import app.seans.tv.player.session.BarKeys
import app.seans.tv.player.session.Scrubber
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ScrubberTest {
    private var now = 0L
    private val seeks = mutableListOf<Long>()
    private val scrubber = Scrubber({ now }) { seeks += it }

    @Test
    fun `the step grows while the key is held`() {
        // Presses 150 ms apart: one streak.
        val targets = (1..10).map {
            scrubber.press(+1, positionMs = 600_000, durationMs = 7_200_000, repeat = it > 1)
            now += 150
            scrubber.targetMs!!
        }
        val steps = listOf(targets[0] - 600_000) + targets.zipWithNext { a, b -> b - a }
        assertEquals(listOf(10_000L, 10_000L, 10_000L, 30_000L, 30_000L, 30_000L, 30_000L, 30_000L, 60_000L, 60_000L), steps)
    }

    @Test
    fun `a pause between presses starts a new streak at 10 s`() {
        repeat(5) { scrubber.press(+1, 0, 7_200_000); now += 100 }
        now += 500
        val before = scrubber.targetMs!!
        scrubber.press(+1, 0, 7_200_000)
        assertEquals(10_000L, scrubber.targetMs!! - before)
    }

    @Test
    fun `fast key repeats are throttled to one step per 120 ms`() {
        scrubber.press(+1, 0, 7_200_000)
        repeat(5) { now += 20; scrubber.press(+1, 0, 7_200_000, repeat = true) }
        assertEquals("100 ms of repeats add nothing", 10_000L, scrubber.targetMs)
        now += 20
        scrubber.press(+1, 0, 7_200_000, repeat = true)
        assertEquals(20_000L, scrubber.targetMs)
    }

    @Test
    fun `the seek fires once, 0,6 s after the last press`() {
        scrubber.press(-1, positionMs = 300_000, durationMs = 7_200_000)
        now += 200
        scrubber.press(-1, positionMs = 300_000, durationMs = 7_200_000)
        now += 500
        assertFalse(scrubber.poll())
        assertTrue(seeks.isEmpty())
        now += 100
        assertTrue(scrubber.poll())
        assertEquals(listOf(280_000L), seeks)
        now += 1_000
        assertFalse("only once", scrubber.poll())
        assertNull(scrubber.targetMs)
    }

    @Test
    fun `the target stays inside the media`() {
        scrubber.press(-1, positionMs = 4_000, durationMs = 60_000)
        assertEquals(0L, scrubber.targetMs)
        scrubber.cancel()
        scrubber.press(+1, positionMs = 55_000, durationMs = 60_000)
        assertEquals(59_000L, scrubber.targetMs)
    }

    @Test
    fun `OK on the bar toggles pause, left and right seek`() {
        assertEquals(BarAction.TogglePause, BarKeys.action(android.view.KeyEvent.KEYCODE_DPAD_CENTER))
        assertEquals(BarAction.TogglePause, BarKeys.action(android.view.KeyEvent.KEYCODE_ENTER))
        assertEquals(BarAction.SeekBack, BarKeys.action(android.view.KeyEvent.KEYCODE_DPAD_LEFT))
        assertEquals(BarAction.SeekForward, BarKeys.action(android.view.KeyEvent.KEYCODE_DPAD_RIGHT))
        assertEquals(BarAction.None, BarKeys.action(android.view.KeyEvent.KEYCODE_DPAD_DOWN))
    }
}
