package app.seans.tv.ui.login

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.seans.tv.model.AppGraph
import app.seans.tv.model.AuthState
import app.seans.tv.model.DeviceLogin
import app.seans.tv.model.DeviceLoginStatus
import app.seans.tv.model.SeansError
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

sealed interface LoginUi {
    data object Loading : LoginUi
    data class Code(val login: DeviceLogin) : LoginUi
    data class Error(val message: String) : LoginUi
}

/**
 * The QR/code sign-in loop: start a device login, wait for approval until the code expires, then
 * start over with a new code. An approval changes `AuthState`, and navigation leaves the screen.
 */
class LoginViewModel(private val graph: AppGraph) : ViewModel() {
    private val _ui = MutableStateFlow<LoginUi>(LoginUi.Loading)
    val ui: StateFlow<LoginUi> = _ui.asStateFlow()
    val auth: StateFlow<AuthState> = graph.auth.state

    /** Posters for the dim wall behind the text (public data); empty when offline. */
    private val _wall = MutableStateFlow<List<String>>(emptyList())
    val wall: StateFlow<List<String>> = _wall.asStateFlow()

    init {
        viewModelScope.launch { runLoop() }
        viewModelScope.launch {
            _wall.value = runCatching { graph.catalog.popularInCommunity() }.getOrDefault(emptyList())
                .mapNotNull { it.posterUrl }.take(9)
        }
    }

    private suspend fun runLoop() {
        var failures = 0
        while (true) {
            try {
                val login = graph.auth.startDeviceLogin()
                failures = 0
                _ui.value = LoginUi.Code(login)
                val left = login.expiresAt - System.currentTimeMillis()
                val result = withTimeoutOrNull(left.coerceAtLeast(1_000)) {
                    graph.auth.awaitDeviceLogin(login).firstOrNull { it !is DeviceLoginStatus.Waiting }
                        // The flow ended without an answer: keep the code on screen until it expires.
                        ?: run { delay(Long.MAX_VALUE); null }
                }
                when (result) {
                    is DeviceLoginStatus.Approved -> return
                    is DeviceLoginStatus.Failed -> {
                        _ui.value = LoginUi.Error(messageFor(result.error))
                        delay(5_000)
                    }
                    DeviceLoginStatus.Expired, DeviceLoginStatus.Waiting, null -> Unit // new code
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failures++
                _ui.value = LoginUi.Error(messageFor(e as? SeansError))
                delay((5_000L * failures).coerceAtMost(30_000))
            }
        }
    }

    fun continueAsGuest() {
        viewModelScope.launch { runCatching { graph.auth.continueAsGuest() } }
    }

    private fun messageFor(error: SeansError?): String = when (error?.code) {
        SeansError.Code.NETWORK, SeansError.Code.TIMEOUT -> "Нет связи с сервером. Пробуем снова…"
        SeansError.Code.QUOTA_EXHAUSTED -> "Сервер занят. Пробуем снова…"
        else -> "Не удалось получить код. Пробуем снова…"
    }
}
