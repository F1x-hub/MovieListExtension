package app.seans.tv.model

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.Serializable

@Serializable
data class UserProfile(
    val uid: String,
    val displayName: String,
    val photoUrl: String? = null,
)

/**
 * The extension signs in with Google only, so the TV signs in through a QR/code that a signed-in
 * user approves (no email/password). After every sign-in and app start the data layer reads
 * `users/{uid}` and signs out a user whose `approvalStatus` is set and not `approved`.
 */
sealed interface AuthState {
    /** Firebase has not answered yet. Not the same as signed out: render nothing personal or guest-only. */
    data object Unknown : AuthState
    /** Nobody is signed in and the viewer has not chosen guest mode: show the sign-in screen. */
    data object SignedOut : AuthState
    /**
     * «Продолжить без входа»: Live and public data (community ratings, TMDB through `tmdbProxy`);
     * no bookmarks, no Kinopoisk calls (`kinopoiskProxy` needs an ID token). Local only, not Firebase.
     */
    data object Guest : AuthState
    data class SignedIn(val profile: UserProfile) : AuthState
    /** Signed in, but the account awaits approval or was rejected; the app shows why and signs out. */
    data class NotApproved(val status: String) : AuthState
}

/** A pending TV sign-in: the TV shows [userCode] («K7Q·4MD») and a QR for [verificationUrl]. */
data class DeviceLogin(
    val userCode: String,
    /** `https://movielistdb-13208.web.app/tv?c=<userCode>`. */
    val verificationUrl: String,
    val expiresAt: Long,
    /** Seconds between polls the server asked for. */
    val pollIntervalSec: Int,
)

sealed interface DeviceLoginStatus {
    data object Waiting : DeviceLoginStatus
    data class Approved(val profile: UserProfile) : DeviceLoginStatus
    data object Expired : DeviceLoginStatus
    data class Failed(val error: SeansError) : DeviceLoginStatus
}

interface AuthRepository {
    val state: StateFlow<AuthState>

    suspend fun startDeviceLogin(): DeviceLogin

    /** Emits until approved, expired or failed, then completes. Cancel to abandon. */
    fun awaitDeviceLogin(login: DeviceLogin): Flow<DeviceLoginStatus>

    suspend fun continueAsGuest()

    suspend fun signOut()

    /** A fresh Firebase ID token for `kinopoiskProxy`, or null for guests. Never log it. */
    suspend fun idToken(): String?
}

/**
 * Catalogue. Kinopoisk quota is shared with the extension: never call it on focus; Details reads
 * `movies/{kp}` and a local cache first; search waits 600 ms and needs 3+ letters.
 */
interface CatalogRepository {
    suspend fun details(ref: TitleRef): TitleDetails

    suspend fun search(query: String): List<TitleSummary>

    /** Titles the extension's users rate highest (`movies.avgRating`). */
    suspend fun popularInCommunity(): List<TitleSummary>

    /** A recommended title for the Home hero when there is nothing to continue. */
    suspend fun featured(): TitleSummary?
}

/**
 * Bookmarks: the extension's `favorites` collection, one status per title. Writing a status
 * keeps the extension's full field set so its Bookmarks page still renders the item.
 * The TV writes nothing else that the extension owns (no `movies`, no `ratings` in v1).
 */
interface LibraryRepository {
    /** Bookmarked titles with that status, newest first. Empty for guests. */
    fun bookmarks(status: BookmarkStatus): Flow<List<TitleSummary>>

    suspend fun bookmarkStatus(ref: TitleRef): BookmarkStatus?

    /** null removes the bookmark. */
    suspend fun setBookmarkStatus(summary: TitleSummary, status: BookmarkStatus?)

    /** Unfinished titles joined with their summaries, newest first. */
    fun continueWatching(): Flow<List<ContinueItem>>
}
