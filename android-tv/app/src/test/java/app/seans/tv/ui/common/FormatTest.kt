package app.seans.tv.ui.common

import org.junit.Assert.assertEquals
import org.junit.Test

class FormatTest {
    @Test fun positionUnderAnHourIsMinutesAndSeconds() = assertEquals("14:20", Format.position(14 * 60_000L + 20_000))

    @Test fun positionOverAnHourHasHours() = assertEquals("1:12:40", Format.position(72 * 60_000L + 40_000))

    @Test fun durationReadsLikeTheMockup() {
        assertEquals("2 ч 49 мин", Format.duration(169))
        assertEquals("47 мин", Format.duration(47))
        assertEquals("2 ч", Format.duration(120))
    }

    @Test fun remainingRoundsUp() = assertEquals("осталось 32 мин", Format.remaining(31 * 60_000L + 1))

    @Test fun timeLeftPadsMinutes() {
        assertEquals("ещё 1 ч 04 мин", Format.timeLeft(64 * 60_000L))
        assertEquals("ещё 45 мин", Format.timeLeft(45 * 60_000L))
    }

    @Test fun russianPlurals() {
        assertEquals("1 сезон", Format.seasons(1))
        assertEquals("3 сезона", Format.seasons(3))
        assertEquals("5 сезонов", Format.seasons(5))
        assertEquals("11 сезонов", Format.seasons(11))
        assertEquals("21 сезон", Format.seasons(21))
        assertEquals("6 озвучек", Format.voices(6))
        assertEquals("2 озвучки", Format.voices(2))
    }
}
