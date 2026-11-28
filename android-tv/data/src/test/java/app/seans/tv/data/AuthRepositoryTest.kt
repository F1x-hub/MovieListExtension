package app.seans.tv.data

import app.seans.tv.data.auth.DeviceLoginApi
import app.seans.tv.data.auth.SeansAuthRepository
import app.seans.tv.data.store.AuthUser
import app.seans.tv.data.store.InMemoryKeyValueStore
import app.seans.tv.model.AuthState
import app.seans.tv.model.DeviceLoginStatus
import app.seans.tv.model.SeansError
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class AuthRepositoryTest {
    private val server = MockWebServer()
    private val store = FakeDocumentStore()
    private val backend = FakeAuthBackend()
    private val prefs = InMemoryKeyValueStore()
    private val clock = FakeClock()
    private val sleeps = mutableListOf<Long>()

    @Before fun start() = server.start()
    @After fun stop() = server.shutdown()

    private fun TestScope.repo(scope: CoroutineScope = backgroundScope) = SeansAuthRepository(
        backend = backend,
        store = store,
        prefs = prefs,
        api = DeviceLoginApi(OkHttpClient(), server.url("/movielistdb-13208/us-central1").toString()),
        deviceName = "Телевизор TCL",
        scope = scope,
        clock = clock,
        sleep = { ms -> sleeps += ms; clock.now += ms },
    )

    private fun json(body: String) = MockResponse().setHeader("Content-Type", "application/json").setBody(body)

    private fun startResponse() = json(
        """{"ok":true,"deviceCode":"${"D".repeat(43)}","userCode":"K7Q4MD","verificationUrl":"https://movielistdb-13208.web.app/tv?c=K7Q4MD","expiresAt":${clock.now + 600_000},"pollIntervalSec":5}""",
    )

    @Test fun `device sign-in polls as asked and signs in with the custom token`() = runTest {
        store.put("users", "alice", mapOf("approvalStatus" to "approved", "firstName" to "Ираклий", "lastName" to ""))
        val repo = repo()
        server.enqueue(startResponse())
        server.enqueue(json("""{"ok":true,"status":"pending","pollIntervalSec":5}"""))
        server.enqueue(json("""{"ok":true,"status":"slow_down","pollIntervalSec":10}"""))
        server.enqueue(json("""{"ok":true,"status":"approved","customToken":"custom-token-for-alice"}"""))

        val login = repo.startDeviceLogin()
        assertEquals("K7Q4MD", login.userCode)
        assertEquals("https://movielistdb-13208.web.app/tv?c=K7Q4MD", login.verificationUrl)
        val startRequest = server.takeRequest()
        assertEquals("/movielistdb-13208/us-central1/tvLoginStart", startRequest.path)
        assertEquals("Телевизор TCL", Json.parseToJsonElement(startRequest.body.readUtf8()).jsonObject["deviceName"]!!.jsonPrimitive.content)

        val statuses = repo.awaitDeviceLogin(login).toList()
        assertEquals(DeviceLoginStatus.Waiting, statuses.first())
        val approved = statuses.last() as DeviceLoginStatus.Approved
        assertEquals("alice", approved.profile.uid)
        assertEquals("Ираклий", approved.profile.displayName)
        assertEquals(listOf(5_000L, 5_000L, 10_000L), sleeps)
        assertEquals(listOf("custom-token-for-alice"), backend.tokensUsed)
        val poll = server.takeRequest()
        assertEquals("/movielistdb-13208/us-central1/tvLoginPoll", poll.path)
        assertEquals("D".repeat(43), Json.parseToJsonElement(poll.body.readUtf8()).jsonObject["deviceCode"]!!.jsonPrimitive.content)
        assertTrue(repo.state.value is AuthState.SignedIn)
        assertEquals("id-token-1", repo.idToken())
    }

    @Test fun `a pending account is signed out and stays NotApproved`() = runTest {
        store.put("users", "bob", mapOf("approvalStatus" to "pending"))
        val repo = repo()
        server.enqueue(startResponse())
        server.enqueue(json("""{"ok":true,"status":"approved","customToken":"custom-token-for-bob"}"""))
        val statuses = repo.awaitDeviceLogin(repo.startDeviceLogin()).toList()
        val failed = statuses.last() as DeviceLoginStatus.Failed
        assertEquals(SeansError.Code.UNAUTHORIZED, failed.error.code)
        assertTrue(backend.signOuts >= 1)
        assertEquals(null, backend.currentUser)
        assertEquals(AuthState.NotApproved("pending"), repo.state.first { it is AuthState.NotApproved })
        assertEquals(null, repo.idToken())
    }

    @Test fun `on app start a rejected user is signed out and a legacy user stays`() = runTest {
        store.put("users", "carol", mapOf("approvalStatus" to "rejected"))
        backend.setUser(AuthUser("carol", "Carol", null))
        val repo = repo()
        assertEquals(AuthState.NotApproved("rejected"), repo.state.first { it !is AuthState.Unknown })
        assertEquals(null, backend.currentUser)

        store.put("users", "dave", mapOf("username" to "dave", "displayNameFormat" to "username"))
        backend.setUser(AuthUser("dave", "Dave Google", null))
        val signedIn = repo.state.first { it is AuthState.SignedIn } as AuthState.SignedIn
        org.junit.Assert.assertEquals("no approvalStatus = legacy approved", "dave", signedIn.profile.displayName)
    }

    @Test fun `guest mode is local and remembered`() = runTest {
        val repo = repo()
        assertEquals(AuthState.SignedOut, repo.state.first { it !is AuthState.Unknown })
        repo.continueAsGuest()
        assertEquals(AuthState.Guest, repo.state.value)
        assertEquals(null, repo.idToken())
        assertTrue(prefs.getBoolean(SeansAuthRepository.KEY_GUEST))

        val restarted = repo()
        assertEquals(AuthState.Guest, restarted.state.first { it !is AuthState.Unknown })
    }

    @Test fun `a guest who opens the sign-in screen is still a guest after a restart`() = runTest {
        val repo = repo()
        repo.state.first { it !is AuthState.Unknown }
        repo.continueAsGuest()
        repo.signOut() // Home's «Войти» for a guest
        assertEquals(AuthState.SignedOut, repo.state.value)
        assertTrue(prefs.getBoolean(SeansAuthRepository.KEY_GUEST))
        assertEquals(AuthState.Guest, repo().state.first { it !is AuthState.Unknown })
    }

    @Test fun `a successful sign-in ends guest mode, and signing out of an account forgets it`() = runTest {
        store.put("users", "frank", mapOf("approvalStatus" to "approved"))
        val repo = repo()
        repo.continueAsGuest()
        server.enqueue(startResponse())
        server.enqueue(json("""{"ok":true,"status":"approved","customToken":"custom-token-for-frank"}"""))
        assertTrue(repo.awaitDeviceLogin(repo.startDeviceLogin()).toList().last() is DeviceLoginStatus.Approved)
        assertFalse(prefs.getBoolean(SeansAuthRepository.KEY_GUEST))
        repo.signOut()
        assertEquals(AuthState.SignedOut, repo().state.first { it !is AuthState.Unknown })
    }

    @Test fun `the stored flag read at start does not undo a guest choice made meanwhile`() = runTest {
        // A slow store: a read returns what was stored when it began.
        val slow = object : app.seans.tv.data.store.KeyValueStore by prefs {
            override suspend fun getBoolean(key: String): Boolean {
                val value = prefs.getBoolean(key)
                kotlinx.coroutines.delay(1_000)
                return value
            }

            override suspend fun putBoolean(key: String, value: Boolean) {
                kotlinx.coroutines.delay(10) // lets the start-up read begin first, as on a real dispatcher
                prefs.putBoolean(key, value)
            }
        }
        val repo = SeansAuthRepository(backend, store, slow, DeviceLoginApi(OkHttpClient(), server.url("/").toString()),
            "Телевизор TCL", backgroundScope, clock)
        repo.continueAsGuest() // starts the slow read of «not a guest», then chooses guest
        // advanceUntilIdle ignores background work: move the clock past the slow read instead.
        testScheduler.advanceTimeBy(5_000)
        testScheduler.runCurrent()
        assertEquals(AuthState.Guest, repo.state.value)
    }

    @Test fun `an expired login ends the flow`() = runTest {
        val repo = repo()
        server.enqueue(startResponse())
        server.enqueue(json("""{"ok":true,"status":"expired"}"""))
        val statuses = repo.awaitDeviceLogin(repo.startDeviceLogin()).toList()
        assertEquals(listOf(DeviceLoginStatus.Waiting, DeviceLoginStatus.Expired), statuses)
    }

    @Test fun `server errors are retried until the login expires`() = runTest {
        val repo = repo()
        server.enqueue(startResponse())
        repeat(3) { server.enqueue(json("""{"error":"Sign-in is temporarily unavailable","code":"TOKEN_MINT_FAILED"}""").setResponseCode(500)) }
        server.enqueue(json("""{"ok":true,"status":"approved","customToken":"custom-token-for-erin"}"""))
        store.put("users", "erin", mapOf("approvalStatus" to "approved"))
        val statuses = repo.awaitDeviceLogin(repo.startDeviceLogin()).toList()
        assertTrue(statuses.last() is DeviceLoginStatus.Approved)
        assertEquals(listOf(5_000L, 10_000L, 20_000L, 30_000L), sleeps)
    }

    @Test fun `a login nobody approves expires locally`() = runTest {
        val repo = repo()
        server.enqueue(startResponse())
        repeat(200) { server.enqueue(json("""{"ok":true,"status":"pending","pollIntervalSec":5}""")) }
        val statuses = repo.awaitDeviceLogin(repo.startDeviceLogin()).toList()
        assertEquals(DeviceLoginStatus.Expired, statuses.last())
        assertEquals(120, sleeps.size)
    }
}

