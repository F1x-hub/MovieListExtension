package app.seans.tv.data.store

import app.seans.tv.data.net.postJson
import app.seans.tv.model.SeansError
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import okhttp3.OkHttpClient

/**
 * Public `movies` queries that return only the fields a card needs. The Android SDK always
 * downloads whole documents, and a `movies` document carries cast, facts and frames (often
 * 100 KB+): 24 of them took 18 s on the TV. Firestore's REST `runQuery` takes a field mask.
 * Only for collections the rules make public (`movies`: `allow read: if true`). Carries the
 * user's ID token when there is one, and works without it for guests.
 */
interface ProjectedQueries {
    suspend fun whereEqualOrderedDesc(collection: String, field: String, value: Any, orderField: String, limit: Int, fields: List<String>): List<Doc>

    suspend fun whereIn(collection: String, field: String, values: List<Any>, fields: List<String>): List<Doc>
}

class FirestoreRestQueries(
    private val client: OkHttpClient,
    private val projectId: String,
    private val apiKey: String,
    private val baseUrl: String = "https://firestore.googleapis.com/v1",
    /** The signed-in user's ID token, or null for guests (`movies` is public, so both work). */
    private val idToken: suspend () -> String? = { null },
) : ProjectedQueries {
    private val url get() = "${baseUrl.trimEnd('/')}/projects/$projectId/databases/(default)/documents:runQuery?key=$apiKey"

    override suspend fun whereEqualOrderedDesc(
        collection: String,
        field: String,
        value: Any,
        orderField: String,
        limit: Int,
        fields: List<String>,
    ): List<Doc> = run(buildJsonObject {
        putJsonArray("from") { addJsonObject { put("collectionId", collection) } }
        select(fields)
        putJsonObject("where") {
            putJsonObject("fieldFilter") {
                putJsonObject("field") { put("fieldPath", field) }
                put("op", "EQUAL")
                put("value", encode(value))
            }
        }
        putJsonArray("orderBy") {
            addJsonObject {
                putJsonObject("field") { put("fieldPath", orderField) }
                put("direction", "DESCENDING")
            }
            addJsonObject {
                putJsonObject("field") { put("fieldPath", "__name__") }
                put("direction", "DESCENDING")
            }
        }
        put("limit", limit)
    })

    override suspend fun whereIn(collection: String, field: String, values: List<Any>, fields: List<String>): List<Doc> =
        values.chunked(30).flatMap { chunk ->
            run(buildJsonObject {
                putJsonArray("from") { addJsonObject { put("collectionId", collection) } }
                select(fields)
                putJsonObject("where") {
                    putJsonObject("fieldFilter") {
                        putJsonObject("field") { put("fieldPath", field) }
                        put("op", "IN")
                        putJsonObject("value") {
                            putJsonObject("arrayValue") { put("values", JsonArray(chunk.map { encode(it) })) }
                        }
                    }
                }
            })
        }

    private fun kotlinx.serialization.json.JsonObjectBuilder.select(fields: List<String>) {
        putJsonObject("select") {
            putJsonArray("fields") { fields.forEach { f -> addJsonObject { put("fieldPath", f) } } }
        }
    }

    private suspend fun run(structuredQuery: JsonObject): List<Doc> {
        val body = buildJsonObject { put("structuredQuery", structuredQuery) }
        val token = try {
            idToken()
        } catch (e: kotlin.coroutines.cancellation.CancellationException) {
            throw e
        } catch (_: Exception) {
            null
        }
        var result = client.postJson(url, body, token?.let { mapOf("Authorization" to "Bearer $it") } ?: emptyMap())
        // A token that expired between refresh and use: the collection is public, ask without it.
        if (result.code == 401 && token != null) result = client.postJson(url, body)
        if (!result.ok) {
            throw SeansError(
                if (result.code == 403) SeansError.Code.UNAUTHORIZED else SeansError.Code.NETWORK,
                "Firestore REST HTTP ${result.code}",
            )
        }
        val rows = result.body as? JsonArray ?: return emptyList()
        return rows.mapNotNull { row ->
            val document = (row as? JsonObject)?.get("document") as? JsonObject ?: return@mapNotNull null
            val name = (document["name"] as? JsonPrimitive)?.contentOrNull ?: return@mapNotNull null
            val fields = document["fields"] as? JsonObject ?: JsonObject(emptyMap())
            Doc(name.substringAfterLast('/'), decodeFields(fields))
        }
    }

    companion object {
        fun encode(value: Any): JsonObject = when (value) {
            is Boolean -> buildJsonObject { put("booleanValue", value) }
            is Int, is Long -> buildJsonObject { put("integerValue", value.toString()) }
            is Number -> buildJsonObject { put("doubleValue", value.toDouble()) }
            else -> buildJsonObject { put("stringValue", value.toString()) }
        }

        fun decodeFields(fields: JsonObject): Map<String, Any?> = fields.mapValues { (_, v) -> decode(v) }

        /** REST values to the same plain shapes [FirebaseDocumentStore] returns (timestamps as millis). */
        fun decode(value: JsonElement): Any? {
            val obj = value as? JsonObject ?: return null
            val (type, inner) = obj.entries.firstOrNull() ?: return null
            val primitive = inner as? JsonPrimitive
            return when (type) {
                "stringValue", "referenceValue" -> primitive?.contentOrNull
                "integerValue" -> primitive?.contentOrNull?.toLongOrNull()
                "doubleValue" -> primitive?.contentOrNull?.toDoubleOrNull()
                "booleanValue" -> primitive?.contentOrNull?.toBooleanStrictOrNull()
                "timestampValue" -> Values.millis(primitive?.contentOrNull)
                "mapValue" -> ((inner as? JsonObject)?.get("fields") as? JsonObject)?.let { decodeFields(it) } ?: emptyMap<String, Any?>()
                "arrayValue" -> ((inner as? JsonObject)?.get("values") as? JsonArray)?.map { decode(it) } ?: emptyList<Any?>()
                else -> null
            }
        }
    }
}
