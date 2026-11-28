package app.seans.tv.network

import java.io.IOException
import java.nio.file.Files
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.Request
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** Nothing here leaves the machine: refused requests fail before DNS, the rest go to MockWebServer. */
class SeansHttpDenylistTest {
    private val http = SeansHttp(Files.createTempDirectory("seans-http").toFile())

    @Test
    fun `denylist matches the aggregator network and nothing else`() {
        for (host in listOf("p.linkpp.ink", "linkpp.ink", "kinopoisk.cx", "www.kinopoisk.cx", "s1.troutcdn.net", "P.LinkPP.Ink")) {
            assertTrue(host, SeansHttp.isDenied(host))
        }
        for (host in listOf("kinopoisk.ru", "api.corevia.ws", "seasonvar.ru", "kodikplayer.com", "rutube.ru", "animego.me")) {
            assertFalse(host, SeansHttp.isDenied(host))
        }
        assertTrue(SeansHttp.isDeniedUrl("https://p.linkpp.ink/api/players?kinopoisk=1"))
        assertTrue("a malformed URL is refused", SeansHttp.isDeniedUrl("not a url"))
        assertFalse(SeansHttp.isDeniedUrl("https://api.corevia.ws/embed/kp/1"))
    }

    @Test
    fun `both clients refuse a denied host before any connection`() {
        for (client in listOf(http.client, http.mediaClient)) {
            for (url in listOf("https://p.linkpp.ink/api/players", "https://kinopoisk.cx/", "http://cdn.troutcdn.com/a.m3u8")) {
                try {
                    client.newCall(Request.Builder().url(url).build()).execute().close()
                    fail("$url must be refused")
                } catch (e: IOException) {
                    assertTrue(e.message, e.message!!.contains("denylist"))
                }
            }
        }
    }

    @Test
    fun `a redirect into the denied network is refused`() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(302).addHeader("Location", "https://p.linkpp.ink/api/players"))
            server.start()
            try {
                http.client.newCall(Request.Builder().url(server.url("/go")).build()).execute().close()
                fail("the redirect must be refused")
            } catch (e: IOException) {
                assertTrue(e.message, e.message!!.contains("denylist"))
            }
            assertEquals(1, server.requestCount)
        }
    }

    @Test
    fun `the desktop Chrome UA is sent unless a request sets its own`() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("ok"))
            server.enqueue(MockResponse().setBody("ok"))
            server.start()
            http.mediaClient.newCall(Request.Builder().url(server.url("/a")).build()).execute().close()
            http.mediaClient.newCall(Request.Builder().url(server.url("/b")).header("User-Agent", "custom").build()).execute().close()
            assertEquals(SeansHttp.USER_AGENT, server.takeRequest().getHeader("User-Agent"))
            assertEquals("custom", server.takeRequest().getHeader("User-Agent"))
        }
    }

    @Test
    fun `DoH queries have a short call timeout, page requests do not`() {
        assertEquals(4_000, http.doh.callTimeoutMillis)
        assertEquals("page and media requests keep only connect/read timeouts", 0, http.client.callTimeoutMillis)
        assertEquals(0, http.mediaClient.callTimeoutMillis)
    }

    @Test
    fun `localhost resolves without DoH`() {
        assertTrue(http.dns.lookup("localhost").isNotEmpty())
    }
}
