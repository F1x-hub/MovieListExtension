package app.seans.tv.data.store

import android.content.Context
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json

internal val DataJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    encodeDefaults = true
    coerceInputValues = true
}

/** SharedPreferences, opened lazily on the IO dispatcher (nothing touches disk in `SeansApp.onCreate`). */
class SharedPrefsKeyValueStore(context: Context, private val name: String = "seans_data") : KeyValueStore {
    private val appContext = context.applicationContext
    private val prefs by lazy { appContext.getSharedPreferences(name, Context.MODE_PRIVATE) }

    override suspend fun getLong(key: String): Long? = withContext(Dispatchers.IO) {
        if (prefs.contains(key)) prefs.getLong(key, 0L) else null
    }

    override suspend fun putLong(key: String, value: Long?) = withContext(Dispatchers.IO) {
        prefs.edit().apply { if (value == null) remove(key) else putLong(key, value) }.apply()
    }

    override suspend fun getBoolean(key: String): Boolean = withContext(Dispatchers.IO) { prefs.getBoolean(key, false) }

    override suspend fun putBoolean(key: String, value: Boolean) = withContext(Dispatchers.IO) {
        prefs.edit().putBoolean(key, value).apply()
    }
}

/**
 * One JSON document on disk, read once and kept in memory. Survives a kill or a power cut
 * mid-write (the low-RAM TV is killed often, and TVs lose power):
 * - a write goes to `.tmp`, is `fsync`ed, the current file becomes `.bak`, then `.tmp` takes its
 *   place, so at every moment either the file or its `.bak` is complete;
 * - a read falls back to `.bak` when the file is missing or damaged;
 * - a damaged file is kept aside as `.corrupt` instead of being overwritten.
 */
class JsonFile<T>(
    private val file: File,
    private val serializer: KSerializer<T>,
    private val empty: () -> T,
) {
    private val mutex = Mutex()
    private var loaded: T? = null
    private val tmp get() = File(file.parentFile, file.name + ".tmp")
    private val bak get() = File(file.parentFile, file.name + ".bak")

    suspend fun read(): T = mutex.withLock { loadLocked() }

    /** Applies [change] and writes the result; returns it. */
    suspend fun update(change: (T) -> T): T = mutex.withLock {
        val next = change(loadLocked())
        withContext(Dispatchers.IO) { writeDurably(DataJson.encodeToString(serializer, next).toByteArray()) }
        loaded = next
        next
    }

    private fun writeDurably(bytes: ByteArray) {
        file.parentFile?.mkdirs()
        FileOutputStream(tmp).use { out ->
            out.write(bytes)
            out.flush()
            out.fd.sync()
        }
        if (file.exists()) {
            bak.delete()
            if (!file.renameTo(bak)) file.delete()
        }
        if (!tmp.renameTo(file)) throw IOException("Could not move ${tmp.name} into place")
    }

    private suspend fun loadLocked(): T {
        loaded?.let { return it }
        val value = withContext(Dispatchers.IO) {
            decode(file).also { if (it == null && file.exists()) file.renameTo(File(file.parentFile, file.name + ".corrupt")) }
                ?: decode(bak)
        } ?: empty()
        loaded = value
        return value
    }

    private fun decode(source: File): T? =
        if (!source.exists()) null else runCatching { DataJson.decodeFromString(serializer, source.readText()) }.getOrNull()
}
