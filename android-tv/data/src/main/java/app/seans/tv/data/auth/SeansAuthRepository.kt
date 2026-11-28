package app.seans.tv.data.auth

import app.seans.tv.data.store.AuthBackend
import app.seans.tv.data.store.AuthUser
import app.seans.tv.data.store.Clock
import app.seans.tv.data.store.DocumentStore
import app.seans.tv.data.store.KeyValueStore
import app.seans.tv.data.store.Values
import app.seans.tv.model.AuthRepository
import app.seans.tv.model.AuthState
import app.seans.tv.model.DeviceLogin
import app.seans.tv.model.DeviceLoginStatus
import app.seans.tv.model.SeansError
import app.seans.tv.model.UserProfile
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Sign-in for the TV: a device code approved from the extension or the Hosting page `/tv`
 * (`functions/tvLogin.js`), then `signInWithCustomToken`. After every sign-in and on every app
 * start `users/{uid}` is read; a user whose `approvalStatus` is set and is not `approved` is
 * signed out and the state stays [AuthState.NotApproved] until a new sign-in or guest mode.
 * A missing field counts as approved (legacy accounts), as in the Firestore rules.
 *
 * Guest mode is a local choice (no Firebase user), remembered across restarts until a sign-in
 * succeeds; a guest's «Войти» shows the sign-in screen without forgetting it. Nothing here starts before someone collects
 * [state] or calls a method, so building the object costs no I/O.
 */
class SeansAuthRepository internal constructor(
    private val backend: AuthBackend,
    private val store: DocumentStore,
    private val prefs: KeyValueStore,
    private val api: DeviceLoginApi,
    private val deviceName: String,
    private val scope: CoroutineScope,
    private val clock: Clock = Clock.SYSTEM,
    private val sleep: suspend (Long) -> Unit = { delay(it) },
) : AuthRepository {
    private val _state = MutableStateFlow<AuthState>(AuthState.Unknown)
    override val state: StateFlow<AuthState> = _state.asStateFlow()

    private val started = AtomicBoolean(false)
    private val resolveMutex = Mutex()
    private val deviceCodes = ConcurrentHashMap<String, String>()

    @Volatile private var guest = false
    /** Set by an explicit choice (guest, sign-in, sign-out); the stored flag read at start must not undo it. */
    @Volatile private var guestDecided = false
    /** Sticky reason after a not-approved account was signed out. */
    @Volatile private var notApproved: String? = null
    @Volatile private var lastResolved: Triple<String, Long, AuthState>? = null

    init {
        scope.launch {
            _state.subscriptionCount.first { it > 0 }
            ensureStarted()
        }
    }

    private fun ensureStarted() {
        if (!started.compareAndSet(false, true)) return
        scope.launch {
            val stored = prefs.getBoolean(KEY_GUEST)
            if (!guestDecided) guest = stored
            backend.userChanges().collect { user -> onUser(user) }
        }
    }

    private suspend fun onUser(user: AuthUser?) {
        if (user == null) {
            _state.value = notApproved?.let { AuthState.NotApproved(it) }
                ?: if (guest) AuthState.Guest else AuthState.SignedOut
            return
        }
        val resolved = resolve(user)
        if (backend.currentUser?.uid != user.uid) return // signed out or switched meanwhile
        _state.value = resolved
        if (resolved is AuthState.NotApproved) backend.signOut()
    }

    /** Reads `users/{uid}` once per sign-in (reused for 10 s, the listener and the login flow both ask). */
    private suspend fun resolve(user: AuthUser): AuthState = resolveMutex.withLock {
        lastResolved?.let { (uid, at, state) ->
            if (uid == user.uid && clock.nowMs() - at < 10_000) return@withLock state
        }
        val doc = try {
            store.get("users", user.uid)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // Offline at start: keep the user signed in; the rules still refuse writes if needed.
            null
        }
        val status = doc?.let { if (it.containsKey("approvalStatus")) Values.string(it["approvalStatus"]) ?: "unknown" else null }
        val state = if (status != null && status != "approved") {
            notApproved = status
            AuthState.NotApproved(status)
        } else {
            AuthState.SignedIn(profileOf(user, doc))
        }
        lastResolved = Triple(user.uid, clock.nowMs(), state)
        state
    }

    override suspend fun startDeviceLogin(): DeviceLogin {
        ensureStarted()
        val started = api.start(deviceName)
        deviceCodes[started.userCode] = started.deviceCode
        return DeviceLogin(
            userCode = started.userCode,
            verificationUrl = started.verificationUrl,
            expiresAt = started.expiresAt,
            pollIntervalSec = started.pollIntervalSec,
        )
    }

    override fun awaitDeviceLogin(login: DeviceLogin): Flow<DeviceLoginStatus> = flow {
        ensureStarted()
        val deviceCode = deviceCodes[login.userCode]
        if (deviceCode == null) {
            emit(DeviceLoginStatus.Failed(SeansError(SeansError.Code.NOT_FOUND, "Unknown device login")))
            return@flow
        }
        emit(DeviceLoginStatus.Waiting)
        var intervalSec = login.pollIntervalSec.coerceIn(1, MAX_POLL_INTERVAL_SEC)
        while (true) {
            if (clock.nowMs() >= login.expiresAt) {
                deviceCodes.remove(login.userCode)
                emit(DeviceLoginStatus.Expired)
                return@flow
            }
            sleep(intervalSec * 1000L)
            val answer = try {
                api.poll(deviceCode)
            } catch (e: SeansError) {
                when (e.code) {
                    // Rate limited: wait longer. Offline or a server error (a missing IAM role
                    // keeps the approved login on the server): try again until it expires.
                    SeansError.Code.QUOTA_EXHAUSTED -> intervalSec = (intervalSec + 5).coerceAtMost(MAX_POLL_INTERVAL_SEC)
                    SeansError.Code.NETWORK, SeansError.Code.TIMEOUT -> intervalSec = (intervalSec * 2).coerceAtMost(MAX_POLL_INTERVAL_SEC)
                    else -> {
                        deviceCodes.remove(login.userCode)
                        emit(DeviceLoginStatus.Failed(e))
                        return@flow
                    }
                }
                continue
            }
            when (answer) {
                is PollAnswer.Pending -> intervalSec = answer.pollIntervalSec.coerceIn(1, MAX_POLL_INTERVAL_SEC)
                is PollAnswer.SlowDown -> intervalSec = answer.pollIntervalSec.coerceIn(1, MAX_POLL_INTERVAL_SEC)
                PollAnswer.Expired -> {
                    deviceCodes.remove(login.userCode)
                    emit(DeviceLoginStatus.Expired)
                    return@flow
                }
                is PollAnswer.Approved -> {
                    deviceCodes.remove(login.userCode)
                    emit(completeSignIn(answer.customToken))
                    return@flow
                }
            }
        }
    }

    private suspend fun completeSignIn(customToken: String): DeviceLoginStatus {
        notApproved = null
        val user = try {
            backend.signInWithCustomToken(customToken)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            return DeviceLoginStatus.Failed(SeansError(SeansError.Code.UNAUTHORIZED, "Custom-token sign-in failed", e))
        }
        guestDecided = true
        guest = false
        prefs.putBoolean(KEY_GUEST, false)
        return when (val resolved = resolve(user)) {
            is AuthState.SignedIn -> {
                _state.value = resolved
                DeviceLoginStatus.Approved(resolved.profile)
            }
            is AuthState.NotApproved -> {
                _state.value = resolved
                backend.signOut()
                DeviceLoginStatus.Failed(SeansError(SeansError.Code.UNAUTHORIZED, "Account is ${resolved.status}"))
            }
            else -> DeviceLoginStatus.Failed(SeansError(SeansError.Code.UNKNOWN, "Unexpected sign-in state"))
        }
    }

    override suspend fun continueAsGuest() {
        ensureStarted()
        guestDecided = true
        guest = true
        notApproved = null
        prefs.putBoolean(KEY_GUEST, true)
        if (backend.currentUser != null) backend.signOut()
        _state.value = AuthState.Guest
    }

    /**
     * Signs the account out. For a guest it only opens the sign-in screen: the stored guest choice
     * stays until a sign-in succeeds, so a restart (or leaving the sign-in screen) is still a guest.
     */
    override suspend fun signOut() {
        ensureStarted()
        val wasGuest = backend.currentUser == null && (guest || _state.value == AuthState.Guest)
        guestDecided = true
        guest = false
        notApproved = null
        lastResolved = null
        if (!wasGuest) prefs.putBoolean(KEY_GUEST, false)
        backend.signOut()
        _state.value = AuthState.SignedOut
    }

    override suspend fun idToken(): String? {
        ensureStarted()
        if (backend.currentUser == null) return null
        return try {
            backend.idToken(false)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            throw SeansError(SeansError.Code.NETWORK, "ID token refresh failed", e)
        }
    }

    /** The signed-in uid, or null for guests. For the other repositories. */
    internal fun currentUid(): String? = backend.currentUser?.uid

    companion object {
        internal const val KEY_GUEST = "auth.guest"
        private const val MAX_POLL_INTERVAL_SEC = 30

        /** As the extension's navigation names a user (`displayNameFormat`). */
        internal fun profileOf(user: AuthUser, doc: Map<String, Any?>?): UserProfile {
            val username = Values.string(doc?.get("username"))
            val fullName = listOfNotNull(Values.string(doc?.get("firstName")), Values.string(doc?.get("lastName")))
                .joinToString(" ").takeIf { it.isNotBlank() }
            val name = when {
                Values.string(doc?.get("displayNameFormat")) == "username" && username != null -> username
                else -> fullName ?: Values.string(doc?.get("displayName")) ?: user.displayName ?: username ?: "Зритель"
            }
            val photo = Values.string(doc?.get("photoURL"))?.takeIf { it.startsWith("https://") }
                ?: user.photoUrl?.takeIf { it.startsWith("https://") }
            return UserProfile(uid = user.uid, displayName = name, photoUrl = photo)
        }
    }
}
