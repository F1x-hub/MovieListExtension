package app.seans.tv.data.auth

import app.seans.tv.data.net.HttpResult
import app.seans.tv.data.net.long
import app.seans.tv.data.net.postJson
import app.seans.tv.data.net.str
import app.seans.tv.model.SeansError
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient

/** What `tvLoginStart` returns; [deviceCode] never leaves `:data` and is never logged. */
internal data class StartedLogin(
    val deviceCode: String,
    val userCode: String,
    val verificationUrl: String,
    val expiresAt: Long,
    val pollIntervalSec: Int,
)

internal sealed interface PollAnswer {
    data class Pending(val pollIntervalSec: Int) : PollAnswer
    data class SlowDown(val pollIntervalSec: Int) : PollAnswer
    data object Expired : PollAnswer
    data class Approved(val customToken: String) : PollAnswer
}

/**
 * Client of the `tvLoginStart` / `tvLoginPoll` HTTPS functions (`functions/tvLogin.js`).
 * [functionsBaseUrl] is `https://us-central1-movielistdb-13208.cloudfunctions.net`, or the
 * Functions emulator (`http://localhost:5001/movielistdb-13208/us-central1` over `adb reverse`).
 */
internal class DeviceLoginApi(private val client: OkHttpClient, private val functionsBaseUrl: String) {
    private fun url(name: String) = "${functionsBaseUrl.trimEnd('/')}/$name"

    suspend fun start(deviceName: String): StartedLogin {
        val result = client.postJson(url("tvLoginStart"), buildJsonObject { put("deviceName", deviceName) })
        val body = result.requireOk()
        return StartedLogin(
            deviceCode = body.str("deviceCode") ?: throw changed("deviceCode"),
            userCode = body.str("userCode") ?: throw changed("userCode"),
            verificationUrl = body.str("verificationUrl") ?: throw changed("verificationUrl"),
            expiresAt = body.long("expiresAt") ?: throw changed("expiresAt"),
            pollIntervalSec = (body.long("pollIntervalSec") ?: 5L).toInt().coerceIn(1, 60),
        )
    }

    suspend fun poll(deviceCode: String): PollAnswer {
        val result = client.postJson(url("tvLoginPoll"), buildJsonObject { put("deviceCode", deviceCode) })
        val body = result.requireOk()
        val interval = (body.long("pollIntervalSec") ?: 5L).toInt().coerceIn(1, 60)
        return when (body.str("status")) {
            "pending" -> PollAnswer.Pending(interval)
            "slow_down" -> PollAnswer.SlowDown(interval)
            "expired" -> PollAnswer.Expired
            "approved" -> PollAnswer.Approved(body.str("customToken") ?: throw changed("customToken"))
            else -> throw changed("status")
        }
    }

    private fun HttpResult.requireOk() = if (ok) obj ?: throw changed("body") else throw toError()

    private fun HttpResult.toError(): SeansError {
        val code = when {
            errorCode == "RATE_LIMITED" || this.code == 429 -> SeansError.Code.QUOTA_EXHAUSTED
            this.code == 401 || this.code == 403 -> SeansError.Code.UNAUTHORIZED
            this.code == 404 -> SeansError.Code.NOT_FOUND
            this.code in 500..599 -> SeansError.Code.NETWORK
            else -> SeansError.Code.UNKNOWN
        }
        // Only the server's error code goes into the message: never a token or a device code.
        return SeansError(code, "TV login HTTP ${this.code} ${errorCode ?: ""}".trim())
    }

    private fun changed(field: String) = SeansError(SeansError.Code.PROVIDER_CHANGED, "TV login response has no $field")
}
