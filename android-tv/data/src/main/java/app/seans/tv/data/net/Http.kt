package app.seans.tv.data.net

import app.seans.tv.model.SeansError
import java.io.IOException
import java.io.InterruptedIOException
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.longOrNull
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response

internal class HttpResult(val code: Int, val body: JsonElement?, val headers: okhttp3.Headers) {
    val ok: Boolean get() = code in 200..299
    val obj: JsonObject? get() = body as? JsonObject

    /** The `code` the Cloud Functions put in error bodies: `{ code }` or `{ error: { code } }`. */
    val errorCode: String?
        get() = obj?.let { o ->
            o.str("code") ?: (o["error"] as? JsonObject)?.str("code")
        }
}

private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()
private val lenientJson = Json { ignoreUnknownKeys = true; isLenient = true }

/** Runs a request off the caller's thread, cancelling it with the coroutine. Body parsed as JSON when it is JSON. */
internal suspend fun OkHttpClient.send(request: Request): HttpResult {
    val call = newCall(request)
    val response = try {
        call.await()
    } catch (e: InterruptedIOException) {
        throw SeansError(SeansError.Code.TIMEOUT, "Request timed out", e)
    } catch (e: IOException) {
        throw SeansError(SeansError.Code.NETWORK, "Network request failed", e)
    }
    return response.use { r ->
        val text = try {
            r.body.string()
        } catch (e: IOException) {
            throw SeansError(SeansError.Code.NETWORK, "Network read failed", e)
        }
        val json = if (text.isBlank()) null else runCatching { lenientJson.parseToJsonElement(text) }.getOrNull()
        HttpResult(r.code, json, r.headers)
    }
}

internal suspend fun OkHttpClient.postJson(url: String, body: JsonObject, headers: Map<String, String> = emptyMap()): HttpResult {
    val builder = Request.Builder().url(url).post(body.toString().toRequestBody(JSON_MEDIA))
        .header("Accept", "application/json")
    headers.forEach { (k, v) -> builder.header(k, v) }
    return send(builder.build())
}

internal suspend fun OkHttpClient.getJson(url: String, headers: Map<String, String> = emptyMap()): HttpResult {
    val builder = Request.Builder().url(url).get().header("Accept", "application/json")
    headers.forEach { (k, v) -> builder.header(k, v) }
    return send(builder.build())
}

private suspend fun Call.await(): Response = suspendCancellableCoroutine { continuation ->
    continuation.invokeOnCancellation { cancel() }
    enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) {
            if (continuation.isActive) continuation.resumeWithException(e)
        }

        override fun onResponse(call: Call, response: Response) {
            continuation.resume(response) { _, value, _ -> value.close() }
        }
    })
}

// --- Small JSON readers (lenient, like store.Values). ---
internal fun JsonObject.str(key: String): String? =
    (this[key] as? JsonPrimitive)?.contentOrNull?.trim()?.takeIf { it.isNotEmpty() }

internal fun JsonObject.long(key: String): Long? = (this[key] as? JsonPrimitive)?.let { it.longOrNull ?: it.doubleOrNull?.toLong() }

internal fun JsonObject.double(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull?.takeIf { it.isFinite() }

internal fun JsonObject.bool(key: String): Boolean? = (this[key] as? JsonPrimitive)?.contentOrNull?.toBooleanStrictOrNull()

internal fun JsonObject.obj(key: String): JsonObject? = this[key] as? JsonObject

/** JSON as plain Kotlin values (maps, lists, Long/Double, String, Boolean, null), for the shared movie mapper. */
internal fun JsonElement?.toPlain(): Any? = when (this) {
    null, is kotlinx.serialization.json.JsonNull -> null
    is JsonObject -> entries.associate { (k, v) -> k to v.toPlain() }
    is kotlinx.serialization.json.JsonArray -> map { it.toPlain() }
    is JsonPrimitive -> when {
        isString -> content
        content == "true" -> true
        content == "false" -> false
        else -> longOrNull ?: doubleOrNull
    }
}
