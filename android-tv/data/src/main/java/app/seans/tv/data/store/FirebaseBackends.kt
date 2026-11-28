package app.seans.tv.data.store

import com.google.firebase.Timestamp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldPath
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.SetOptions
import app.seans.tv.model.SeansError
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await

/**
 * [DocumentStore] on the `FirebaseFirestore` instance `SeansApp` built. Reads documents into
 * plain maps by hand (no `toObject()`: R8 strips reflection targets, risks.md B3).
 */
class FirebaseDocumentStore(private val firestore: FirebaseFirestore) : DocumentStore {
    override suspend fun get(collection: String, id: String): Map<String, Any?>? = guard {
        val snapshot = firestore.collection(collection).document(id).get().await()
        if (snapshot.exists()) plain(snapshot) else null
    }

    override suspend fun whereEqual(collection: String, field: String, value: Any, limit: Long?): List<Doc> = guard {
        var query: Query = firestore.collection(collection).whereEqualTo(field, value)
        if (limit != null) query = query.limit(limit)
        query.get().await().documents.map { Doc(it.id, plain(it)) }
    }

    override suspend fun whereIn(collection: String, field: String, values: List<Any>, limit: Long?): List<Doc> = guard {
        if (values.isEmpty()) return@guard emptyList()
        values.chunked(30).flatMap { chunk ->
            var query: Query = firestore.collection(collection).whereIn(field, chunk)
            if (limit != null) query = query.limit(limit)
            query.get().await().documents.map { Doc(it.id, plain(it)) }
        }
    }

    override suspend fun whereEqualOrderedDesc(
        collection: String,
        field: String,
        value: Any,
        orderField: String,
        limit: Long,
    ): List<Doc> = guard {
        firestore.collection(collection)
            .whereEqualTo(field, value)
            .orderBy(orderField, Query.Direction.DESCENDING)
            .orderBy(FieldPath.documentId(), Query.Direction.DESCENDING)
            .limit(limit)
            .get().await()
            .documents.map { Doc(it.id, plain(it)) }
    }

    override fun listenWhereEqual(collection: String, field: String, value: Any): Flow<List<Doc>> = callbackFlow {
        val registration = firestore.collection(collection).whereEqualTo(field, value)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    close(seansError(error))
                    return@addSnapshotListener
                }
                if (snapshot != null) trySend(snapshot.documents.map { Doc(it.id, plain(it)) })
            }
        awaitClose { registration.remove() }
    }

    override suspend fun set(collection: String, id: String, data: Map<String, Any?>, merge: Boolean) = guard {
        val payload = data.mapValues { (_, v) -> if (v === ServerTimestamp) FieldValue.serverTimestamp() else v }
        val ref = firestore.collection(collection).document(id)
        if (merge) ref.set(payload, SetOptions.merge()).await() else ref.set(payload).await()
        Unit
    }

    override suspend fun delete(collection: String, id: String) = guard {
        firestore.collection(collection).document(id).delete().await()
        Unit
    }

    private suspend fun <T> guard(block: suspend () -> T): T = try {
        block()
    } catch (e: FirebaseFirestoreException) {
        throw seansError(e)
    }

    /** R2: a pending account gets PERMISSION_DENIED on writes; the UI says why. */
    private fun seansError(e: FirebaseFirestoreException): SeansError = when (e.code) {
        FirebaseFirestoreException.Code.PERMISSION_DENIED, FirebaseFirestoreException.Code.UNAUTHENTICATED ->
            SeansError(SeansError.Code.UNAUTHORIZED, "Firestore: ${e.code}", e)
        FirebaseFirestoreException.Code.NOT_FOUND -> SeansError(SeansError.Code.NOT_FOUND, "Firestore: NOT_FOUND", e)
        FirebaseFirestoreException.Code.UNAVAILABLE -> SeansError(SeansError.Code.NETWORK, "Firestore: UNAVAILABLE", e)
        FirebaseFirestoreException.Code.DEADLINE_EXCEEDED -> SeansError(SeansError.Code.TIMEOUT, "Firestore: DEADLINE_EXCEEDED", e)
        FirebaseFirestoreException.Code.RESOURCE_EXHAUSTED -> SeansError(SeansError.Code.QUOTA_EXHAUSTED, "Firestore: RESOURCE_EXHAUSTED", e)
        else -> SeansError(SeansError.Code.UNKNOWN, "Firestore: ${e.code}", e)
    }

    private fun plain(snapshot: DocumentSnapshot): Map<String, Any?> =
        // ESTIMATE resolves a pending server timestamp of our own write to the local time.
        plainValue(snapshot.getData(DocumentSnapshot.ServerTimestampBehavior.ESTIMATE) ?: emptyMap<String, Any?>())
            .let { @Suppress("UNCHECKED_CAST") (it as Map<String, Any?>) }

    private fun plainValue(value: Any?): Any? = when (value) {
        is Timestamp -> value.seconds * 1000 + value.nanoseconds / 1_000_000
        is Map<*, *> -> value.entries.associate { (k, v) -> k.toString() to plainValue(v) }
        is List<*> -> value.map { plainValue(it) }
        else -> value
    }
}

/** [AuthBackend] on the `FirebaseAuth` instance `SeansApp` built. */
class FirebaseAuthBackend(private val auth: FirebaseAuth) : AuthBackend {
    override val currentUser: AuthUser?
        get() = auth.currentUser?.let { AuthUser(it.uid, it.displayName, it.photoUrl?.toString()) }

    override fun userChanges(): Flow<AuthUser?> = callbackFlow {
        val listener = FirebaseAuth.AuthStateListener { firebaseAuth ->
            trySend(firebaseAuth.currentUser?.let { AuthUser(it.uid, it.displayName, it.photoUrl?.toString()) })
        }
        auth.addAuthStateListener(listener)
        awaitClose { auth.removeAuthStateListener(listener) }
    }

    override suspend fun signInWithCustomToken(token: String): AuthUser {
        val user = auth.signInWithCustomToken(token).await().user
            ?: throw IllegalStateException("Custom-token sign-in returned no user")
        return AuthUser(user.uid, user.displayName, user.photoUrl?.toString())
    }

    override fun signOut() = auth.signOut()

    override suspend fun idToken(forceRefresh: Boolean): String? =
        auth.currentUser?.getIdToken(forceRefresh)?.await()?.token
}
