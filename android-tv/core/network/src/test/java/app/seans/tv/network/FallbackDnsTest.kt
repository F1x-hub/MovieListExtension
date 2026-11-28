package app.seans.tv.network

import java.net.InetAddress
import java.net.UnknownHostException
import okhttp3.Dns
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class FallbackDnsTest {
    private val a = InetAddress.getByAddress("a", byteArrayOf(10, 0, 0, 1))
    private val b = InetAddress.getByAddress("b", byteArrayOf(10, 0, 0, 2))
    private val c = InetAddress.getByAddress("c", byteArrayOf(10, 0, 0, 3))

    private class Recorder(val name: String, val log: MutableList<String>, val answer: (String) -> List<InetAddress>) : Dns {
        override fun lookup(hostname: String): List<InetAddress> {
            log += "$name:$hostname"
            return answer(hostname)
        }
    }

    private fun failing(): (String) -> List<InetAddress> = { throw UnknownHostException(it) }

    @Test
    fun `first resolver wins and the others are not asked`() {
        val log = mutableListOf<String>()
        val dns = FallbackDns(listOf(Recorder("cf", log) { listOf(a) }, Recorder("google", log) { listOf(b) }, Recorder("system", log) { listOf(c) }))
        assertEquals(listOf(a), dns.lookup("seasonvar.ru"))
        assertEquals(listOf("cf:seasonvar.ru"), log)
    }

    @Test
    fun `falls back in order Cloudflare, Google, system`() {
        val log = mutableListOf<String>()
        val dns = FallbackDns(listOf(Recorder("cf", log, failing()), Recorder("google", log, failing()), Recorder("system", log) { listOf(c) }))
        assertEquals(listOf(c), dns.lookup("seasonvar.ru"))
        assertEquals(listOf("cf:seasonvar.ru", "google:seasonvar.ru", "system:seasonvar.ru"), log)
    }

    @Test
    fun `an empty answer counts as a failure`() {
        val log = mutableListOf<String>()
        val dns = FallbackDns(listOf(Recorder("cf", log) { emptyList() }, Recorder("google", log) { listOf(b) }))
        assertEquals(listOf(b), dns.lookup("example.org"))
        assertEquals(2, log.size)
    }

    @Test
    fun `all failing throws UnknownHostException`() {
        val dns = FallbackDns(listOf(Dns { throw IllegalStateException("boom") }, Dns { throw UnknownHostException("x") }))
        try {
            dns.lookup("nowhere.example")
            fail("expected UnknownHostException")
        } catch (_: UnknownHostException) {
        }
    }

    @Test
    fun `LAN names skip DoH`() {
        val log = mutableListOf<String>()
        val dns = FallbackDns(listOf(Recorder("cf", log) { listOf(a) }), local = Recorder("system", log) { listOf(c) })
        assertEquals(listOf(c), dns.lookup("localhost"))
        assertEquals(listOf(c), dns.lookup("tv.local"))
        assertEquals(listOf("system:localhost", "system:tv.local"), log)
    }

    @Test
    fun `answers are cached for the TTL, failures are not`() {
        var now = 0L
        var calls = 0
        var broken = true
        val dns = FallbackDns(
            listOf(Dns { calls++; if (broken) throw UnknownHostException(it) else listOf(a) }),
            ttlMillis = 1_000,
            clock = { now },
        )
        runCatching { dns.lookup("cdn.example") }
        broken = false
        dns.lookup("cdn.example")
        dns.lookup("CDN.example")
        assertEquals("a failure is retried, a success is reused", 2, calls)
        now = 1_000
        dns.lookup("cdn.example")
        assertEquals("expired entries are asked again", 3, calls)
    }

    @Test
    fun `refused names never reach a resolver`() {
        val log = mutableListOf<String>()
        val dns = FallbackDns(listOf(Recorder("cf", log) { listOf(a) }), refuse = SeansHttp::isDenied)
        for (host in listOf("p.linkpp.ink", "kinopoisk.cx", "x.troutcdn.com", "API.LINKPP.INK")) {
            try {
                dns.lookup(host)
                fail("$host must be refused")
            } catch (e: UnknownHostException) {
                assertTrue(e.message!!.contains("denylist"))
            }
        }
        assertTrue(log.isEmpty())
    }
}
