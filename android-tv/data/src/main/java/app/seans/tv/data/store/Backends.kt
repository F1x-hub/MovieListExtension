package app.seans.tv.data.store

import kotlinx.coroutines.flow.Flow

/**
 * The few Firestore operations `:data` uses, behind an interface so the repositories run in
 * plain JVM tests with fakes. Values in returned maps are plain Kotlin: Firestore
 * `Timestamp`s arrive as epoch millis (`Long`), nested maps and lists as `Map`/`List`.
 */
interface DocumentStore {
    /** null when the document does not exist. */
    suspend fun get(collection: String, id: String): Map<String, Any?>?

    suspend fun whereEqual(collection: String, field: String, value: Any, limit: Long? = null): List<Doc>

    /** `field in values`; Firestore allows at most 30 values, callers chunk. */
    suspend fun whereIn(collection: String, field: String, values: List<Any>, limit: Long? = null): List<Doc>

    /** `field == value orderBy orderField desc limit n`; needs a composite index. */
    suspend fun whereEqualOrderedDesc(
        collection: String,
        field: String,
        value: Any,
        orderField: String,
        limit: Long,
    ): List<Doc>

    /** A live `field == value` query. Cancel the collection to remove the listener. */
    fun listenWhereEqual(collection: String, field: String, value: Any): Flow<List<Doc>>

    /** [ServerTimestamp] values become `FieldValue.serverTimestamp()`. */
    suspend fun set(collection: String, id: String, data: Map<String, Any?>, merge: Boolean)

    suspend fun delete(collection: String, id: String)
}

data class Doc(val id: String, val data: Map<String, Any?>)

/** Stands for `FieldValue.serverTimestamp()` in maps passed to [DocumentStore.set]. */
object ServerTimestamp

/** The parts of Firebase Auth `:data` needs. */
interface AuthBackend {
    val currentUser: AuthUser?

    /** Emits the current user at once and on every sign-in and sign-out. */
    fun userChanges(): Flow<AuthUser?>

    suspend fun signInWithCustomToken(token: String): AuthUser

    fun signOut()

    suspend fun idToken(forceRefresh: Boolean = false): String?
}

data class AuthUser(val uid: String, val displayName: String?, val photoUrl: String?)

/** Small persistent settings (guest choice, the Kinopoisk quota stop). */
interface KeyValueStore {
    suspend fun getLong(key: String): Long?
    suspend fun putLong(key: String, value: Long?)
    suspend fun getBoolean(key: String): Boolean
    suspend fun putBoolean(key: String, value: Boolean)
}

class InMemoryKeyValueStore : KeyValueStore {
    private val values = java.util.concurrent.ConcurrentHashMap<String, Any>()
    override suspend fun getLong(key: String): Long? = values[key] as? Long
    override suspend fun putLong(key: String, value: Long?) {
        if (value == null) values.remove(key) else values[key] = value
    }
    override suspend fun getBoolean(key: String): Boolean = values[key] as? Boolean ?: false
    override suspend fun putBoolean(key: String, value: Boolean) { values[key] = value }
}

/** Wall-clock source, replaced in tests. */
fun interface Clock {
    fun nowMs(): Long

    companion object {
        val SYSTEM = Clock { System.currentTimeMillis() }
    }
}
