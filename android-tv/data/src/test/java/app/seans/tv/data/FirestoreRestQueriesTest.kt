package app.seans.tv.data

import app.seans.tv.data.store.FirestoreRestQueries
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

class FirestoreRestQueriesTest {
    private val server = MockWebServer()

    @Before fun start() = server.start()
    @After fun stop() = server.shutdown()

    private fun queries(token: String? = null) =
        FirestoreRestQueries(OkHttpClient(), "movielistdb-13208", "public-key", server.url("/v1").toString()) { token }

    @Test fun `runQuery sends a field mask and decodes the values`() = runTest {
        server.enqueue(MockResponse().setHeader("Content-Type", "application/json").setBody("""
            [{"document":{"name":"projects/p/databases/(default)/documents/movies/920265","fields":{
                "name":{"stringValue":"Человек-паук"},"avgRating":{"integerValue":"10"},"kpRating":{"doubleValue":8.4},
                "isSeries":{"booleanValue":false},"genres":{"arrayValue":{"values":[{"mapValue":{"fields":{"name":{"stringValue":"мультфильм"}}}}]}},
                "lastRatingUpdatedAt":{"timestampValue":"2026-08-10T23:29:05.400Z"},"collection":{"nullValue":null}}},
              "readTime":"2026-11-27T19:44:18Z"},
             {"readTime":"2026-11-27T19:44:18Z"}]
        """.trimIndent()))
        val docs = queries().whereEqualOrderedDesc("movies", "hasCommunityRating", true, "avgRating", 24, listOf("name", "avgRating"))
        assertEquals(1, docs.size)
        val doc = docs.single()
        assertEquals("920265", doc.id)
        assertEquals("Человек-паук", doc.data["name"])
        assertEquals(10L, doc.data["avgRating"])
        assertEquals(8.4, doc.data["kpRating"])
        assertEquals(false, doc.data["isSeries"])
        assertEquals(listOf(mapOf("name" to "мультфильм")), doc.data["genres"])
        assertEquals(1_786_404_545_400L, doc.data["lastRatingUpdatedAt"])
        assertEquals(null, doc.data["collection"])

        val request = server.takeRequest()
        assertEquals("/v1/projects/movielistdb-13208/databases/(default)/documents:runQuery?key=public-key", request.path)
        val query = Json.parseToJsonElement(request.body.readUtf8()).jsonObject["structuredQuery"]!!.jsonObject
        assertEquals(listOf("name", "avgRating"), query["select"]!!.jsonObject["fields"]!!.jsonArray.map { it.jsonObject["fieldPath"]!!.jsonPrimitive.content })
        assertEquals("24", query["limit"]!!.jsonPrimitive.content)
        assertEquals("__name__", query["orderBy"]!!.jsonArray[1].jsonObject["field"]!!.jsonObject["fieldPath"]!!.jsonPrimitive.content)
    }

    @Test fun `in queries are split into chunks of 30`() = runTest {
        repeat(2) { server.enqueue(MockResponse().setBody("[]")) }
        queries().whereIn("movies", "tmdbId", (1L..45L).toList(), listOf("name"))
        assertEquals(2, server.requestCount)
        val first = Json.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject
        val values = first["structuredQuery"]!!.jsonObject["where"]!!.jsonObject["fieldFilter"]!!.jsonObject["value"]!!
            .jsonObject["arrayValue"]!!.jsonObject["values"]!!.jsonArray
        assertEquals(30, values.size)
        assertEquals("1", values[0].jsonObject["integerValue"]!!.jsonPrimitive.content)
    }

    @Test fun `signed-in queries carry the ID token, guests send none`() = runTest {
        repeat(2) { server.enqueue(MockResponse().setBody("[]")) }
        queries(token = "id-token-1").whereIn("movies", "tmdbId", listOf(1L), listOf("name"))
        assertEquals("Bearer id-token-1", server.takeRequest().getHeader("Authorization"))
        queries(token = null).whereIn("movies", "tmdbId", listOf(1L), listOf("name"))
        assertEquals(null, server.takeRequest().getHeader("Authorization"))
    }

    @Test fun `an expired token is retried without it`() = runTest {
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":{"code":401}}"""))
        server.enqueue(MockResponse().setBody("""[{"document":{"name":"x/movies/7","fields":{"name":{"stringValue":"A"}}}}]"""))
        val docs = queries(token = "stale").whereIn("movies", "tmdbId", listOf(1L), listOf("name"))
        assertEquals(listOf("7"), docs.map { it.id })
        assertEquals("Bearer stale", server.takeRequest().getHeader("Authorization"))
        assertEquals(null, server.takeRequest().getHeader("Authorization"))
    }
}
