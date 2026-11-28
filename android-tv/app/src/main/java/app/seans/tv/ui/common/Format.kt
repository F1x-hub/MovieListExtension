package app.seans.tv.ui.common

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Russian copy helpers shared by the screens. */
object Format {
    /** A playback position: «14:20» under an hour, «1:12:40» above. */
    fun position(ms: Long): String {
        val total = (ms / 1000).coerceAtLeast(0)
        val h = total / 3600
        val m = (total % 3600) / 60
        val s = total % 60
        return if (h > 0) String.format(Locale.US, "%d:%02d:%02d", h, m, s) else String.format(Locale.US, "%d:%02d", m, s)
    }

    /** «1 ч 36 мин», «32 мин», «1 ч». */
    fun duration(minutes: Int): String {
        val h = minutes / 60
        val m = minutes % 60
        return when {
            h > 0 && m > 0 -> "$h ч $m мин"
            h > 0 -> "$h ч"
            else -> "${m.coerceAtLeast(1)} мин"
        }
    }

    /** «осталось 32 мин». */
    fun remaining(ms: Long): String = "осталось ${duration(((ms + 59_999) / 60_000).toInt())}"

    /** The live card's «ещё 1 ч 04 мин». */
    fun timeLeft(ms: Long): String {
        val minutes = ((ms + 59_999) / 60_000).coerceAtLeast(0).toInt()
        val h = minutes / 60
        val m = minutes % 60
        return if (h > 0) String.format(Locale.US, "ещё %d ч %02d мин", h, m) else "ещё $m мин"
    }

    private val hm = SimpleDateFormat("HH:mm", Locale.US)

    /** Local wall-clock time «22:40» of an epoch-millis instant. */
    fun clock(epochMs: Long): String = synchronized(hm) { hm.format(Date(epochMs)) }

    /** «1 сезон», «2 сезона», «5 сезонов». */
    fun seasons(n: Int): String = "$n ${plural(n, "сезон", "сезона", "сезонов")}"

    /** «1 озвучка», «3 озвучки», «6 озвучек». */
    fun voices(n: Int): String = "$n ${plural(n, "озвучка", "озвучки", "озвучек")}"

    private fun plural(n: Int, one: String, few: String, many: String): String {
        val mod10 = n % 10
        val mod100 = n % 100
        return when {
            mod10 == 1 && mod100 != 11 -> one
            mod10 in 2..4 && mod100 !in 12..14 -> few
            else -> many
        }
    }
}
