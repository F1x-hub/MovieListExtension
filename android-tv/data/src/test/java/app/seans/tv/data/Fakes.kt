package app.seans.tv.data

import app.seans.tv.data.store.AuthBackend
import app.seans.tv.data.store.AuthUser
import app.seans.tv.data.store.Clock
import app.seans.tv.data.store.Doc
import app.seans.tv.data.store.DocumentStore
import app.seans.tv.data.store.ProjectedQueries
import app.seans.tv.data.store.Values
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map

class FakeClock(var now: Long = 1_800_000_000_000L) : Clock {
    override fun nowMs(): Long = now
}

/** In-memory Firestore: `collection/id` → fields. Records reads so tests can count them. */
class FakeDocumentStore : DocumentStore {
    val docs = MutableStateFlow<Map<String, Map<String, Any?>>>(emptyMap())
    val reads = mutableListOf<String>()
    val writes = mutableListOf<Triple<String, Map<String, Any?>, Boolean>>()
    var failWith: Exception? = null

    fun put(collection: String, id: String, data: Map<String, Any?>) {
        docs.value = docs.value + ("$collection/$id" to data)
    }

    operator fun get(path: String): Map<String, Any?>? = docs.value[path]

    private fun inCollection(collection: String) = docs.value
        .filterKeys { it.substringBefore('/') == collection }
        .map { (path, data) -> Doc(path.substringAfter('/'), data) }

    override suspend fun get(collection: String, id: String): Map<String, Any?>? {
        failWith?.let { throw it }
        reads += "$collection/$id"
        return docs.value["$collection/$id"]
    }

    override suspend fun whereEqual(collection: String, field: String, value: Any, limit: Long?): List<Doc> {
        reads += "$collection?$field==$value"
        return inCollection(collection).filter { it.data[field] == value }.take(limit?.toInt() ?: Int.MAX_VALUE)
    }

    override suspend fun whereIn(collection: String, field: String, values: List<Any>, limit: Long?): List<Doc> {
        reads += "$collection?$field in $values"
        return inCollection(collection).filter { doc -> values.any { Values.long(it) == Values.long(doc.data[field]) } }
    }

    override suspend fun whereEqualOrderedDesc(collection: String, field: String, value: Any, orderField: String, limit: Long): List<Doc> {
        reads += "$collection?$field==$value orderBy $orderField desc"
        return inCollection(collection).filter { it.data[field] == value }
            .sortedByDescending { Values.double(it.data[orderField]) ?: 0.0 }
            .take(limit.toInt())
    }

    override fun listenWhereEqual(collection: String, field: String, value: Any): Flow<List<Doc>> =
        docs.map { inCollection(collection).filter { it.data[field] == value } }

    override suspend fun set(collection: String, id: String, data: Map<String, Any?>, merge: Boolean) {
        failWith?.let { throw it }
        writes += Triple("$collection/$id", data, merge)
        val old = if (merge) docs.value["$collection/$id"].orEmpty() else emptyMap()
        put(collection, id, old + data)
    }

    override suspend fun delete(collection: String, id: String) {
        writes += Triple("$collection/$id", emptyMap(), false)
        docs.value = docs.value - "$collection/$id"
    }
}

class FakeAuthBackend : AuthBackend {
    private val user = MutableStateFlow<AuthUser?>(null)
    val tokensUsed = mutableListOf<String>()
    var signOuts = 0
    var idTokenValue = "id-token-1"

    override val currentUser: AuthUser? get() = user.value
    override fun userChanges(): Flow<AuthUser?> = user

    fun setUser(value: AuthUser?) { user.value = value }

    override suspend fun signInWithCustomToken(token: String): AuthUser {
        tokensUsed += token
        val signedIn = AuthUser(uid = token.removePrefix("custom-token-for-"), displayName = "Google Name", photoUrl = null)
        user.value = signedIn
        return signedIn
    }

    override fun signOut() {
        signOuts++
        user.value = null
    }

    override suspend fun idToken(forceRefresh: Boolean): String? = if (user.value != null) idTokenValue else null
}

/** Like the module's scope: a failed `async` stays in its Deferred instead of failing the test. */
fun TestScope.supervisedBackground(): CoroutineScope =
    CoroutineScope(backgroundScope.coroutineContext + SupervisorJob(backgroundScope.coroutineContext[Job]))

/** [ProjectedQueries] over the same in-memory documents (no field mask applied). */
class FakeProjectedQueries(private val store: FakeDocumentStore) : ProjectedQueries {
    override suspend fun whereEqualOrderedDesc(collection: String, field: String, value: Any, orderField: String, limit: Int, fields: List<String>) =
        store.whereEqualOrderedDesc(collection, field, value, orderField, limit.toLong())

    override suspend fun whereIn(collection: String, field: String, values: List<Any>, fields: List<String>) =
        store.whereIn(collection, field, values)
}
