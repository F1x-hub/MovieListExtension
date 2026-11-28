package app.seans.tv.ui.search

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat

/**
 * Voice input inside the search screen: no activity, no chooser. `RecognizerIntent` opened a
 * chooser on the owner's TCL, where both Katniss (Google TV's voice search) and Google TTS answer
 * it, and then Google's own window. Here [SpeechRecognizer] runs in place and the words appear in
 * the search field while the viewer speaks.
 *
 * Katniss is asked first: it is what opens the remote's microphone. The recogniser needs
 * `RECORD_AUDIO`; Android asks for it once, on the first press.
 *
 * The remote's own microphone button never reaches an app on this TV: measured with `getevent`
 * on 2026-11-28, it sends no key event and Google TV opens its Assistant by itself.
 */
@Stable
class VoiceInput internal constructor(
    private val context: Context,
    private val askPermission: () -> Unit,
) {
    /** True while the recogniser listens or works on what it heard. */
    var listening by mutableStateOf(false)
        private set

    /** A short line for the field when listening fails («Не расслышал»), else null. */
    var problem by mutableStateOf<String?>(null)
        private set

    internal var onPartial: (String) -> Unit = {}
    internal var onFinal: (String) -> Unit = {}

    private var recognizer: SpeechRecognizer? = null

    val available: Boolean = recognitionComponent(context) != null || SpeechRecognizer.isRecognitionAvailable(context)

    /** Starts listening, or stops when it already listens. */
    fun toggle() {
        if (listening) {
            recognizer?.stopListening()
            return
        }
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            askPermission()
            return
        }
        start()
    }

    internal fun start() {
        problem = null
        val engine = recognizer ?: runCatching {
            val component = recognitionComponent(context)
            if (component != null) SpeechRecognizer.createSpeechRecognizer(context, component)
            else SpeechRecognizer.createSpeechRecognizer(context)
        }.getOrNull()?.also { created ->
            created.setRecognitionListener(listener)
            recognizer = created
        } ?: run {
            problem = "Голосовой ввод недоступен"
            return
        }
        listening = true
        engine.startListening(
            Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ru-RU")
                .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName),
        )
    }

    internal fun permissionAnswered(granted: Boolean) {
        if (granted) start() else problem = "Нет доступа к микрофону"
    }

    internal fun release() {
        recognizer?.destroy()
        recognizer = null
        listening = false
    }

    private val listener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) = Unit
        override fun onBeginningOfSpeech() = Unit
        override fun onRmsChanged(rmsdB: Float) = Unit
        override fun onBufferReceived(buffer: ByteArray?) = Unit
        override fun onEndOfSpeech() = Unit
        override fun onEvent(eventType: Int, params: Bundle?) = Unit

        override fun onPartialResults(partialResults: Bundle?) {
            firstOf(partialResults)?.let { onPartial(it) }
        }

        override fun onResults(results: Bundle?) {
            listening = false
            firstOf(results)?.let { onFinal(it) } ?: run { problem = "Не расслышал" }
        }

        override fun onError(error: Int) {
            listening = false
            problem = when (error) {
                SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "Не расслышал"
                SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Нет доступа к микрофону"
                SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Нет связи с распознаванием"
                SpeechRecognizer.ERROR_CLIENT -> null // Stopped by the viewer.
                else -> "Голосовой ввод не сработал"
            }
            // A busy or broken engine is built again on the next press.
            if (error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY || error == SpeechRecognizer.ERROR_SERVER) {
                recognizer?.destroy()
                recognizer = null
            }
        }
    }

    private fun firstOf(bundle: Bundle?): String? =
        bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim()?.takeIf { it.isNotEmpty() }

    private companion object {
        val KATNISS = ComponentName(
            "com.google.android.katniss",
            "com.google.android.apps.tvsearch.voice.recognition.KatnissRecognitionService",
        )

        /** Katniss when the TV has it, else null and the default recogniser is used. */
        fun recognitionComponent(context: Context): ComponentName? {
            val probe = Intent("android.speech.RecognitionService").setComponent(KATNISS)
            return KATNISS.takeIf { context.packageManager.resolveService(probe, 0) != null }
        }
    }
}

/** A [VoiceInput] for this screen; [onPartial] and [onFinal] receive what was heard. */
@Composable
fun rememberVoiceInput(onPartial: (String) -> Unit, onFinal: (String) -> Unit): VoiceInput {
    val context = LocalContext.current
    val created = remember { arrayOfNulls<VoiceInput>(1) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        created[0]?.permissionAnswered(granted)
    }
    val voice = remember { VoiceInput(context.applicationContext) { permission.launch(Manifest.permission.RECORD_AUDIO) } }
    created[0] = voice
    val partial by rememberUpdatedState(onPartial)
    val final by rememberUpdatedState(onFinal)
    voice.onPartial = { partial(it) }
    voice.onFinal = { final(it) }
    DisposableEffect(voice) { onDispose { voice.release() } }
    return voice
}
