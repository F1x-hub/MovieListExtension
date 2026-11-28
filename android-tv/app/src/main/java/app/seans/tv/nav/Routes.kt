package app.seans.tv.nav

import android.net.Uri
import android.os.Bundle
import androidx.navigation.NavType
import app.seans.tv.model.PlaybackRequest
import app.seans.tv.model.TitleRef
import kotlin.reflect.KType
import kotlin.reflect.typeOf
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.serializer

/**
 * Type-safe routes. Arguments are small serializable values (`TitleRef`, `PlaybackRequest`),
 * never repositories or lambdas, so a restored back stack after process death still opens.
 */
@Serializable data object LoginRoute
@Serializable data object HomeRoute
@Serializable data class DetailsRoute(val ref: TitleRef)
@Serializable data object SearchRoute
@Serializable data class PlayerRoute(val request: PlaybackRequest)
@Serializable data object LiveRoute

private val navJson = Json { ignoreUnknownKeys = true; encodeDefaults = false }

/** Passes a `@Serializable` contract type as one JSON string argument. */
internal class JsonNavType<T : Any>(private val serializer: KSerializer<T>) : NavType<T>(isNullableAllowed = false) {
    override fun get(bundle: Bundle, key: String): T? = bundle.getString(key)?.let { navJson.decodeFromString(serializer, it) }
    override fun put(bundle: Bundle, key: String, value: T) = bundle.putString(key, navJson.encodeToString(serializer, value))
    override fun parseValue(value: String): T = navJson.decodeFromString(serializer, Uri.decode(value))
    override fun serializeAsValue(value: T): String = Uri.encode(navJson.encodeToString(serializer, value))
}

val DetailsTypeMap: Map<KType, NavType<*>> = mapOf(typeOf<TitleRef>() to JsonNavType(serializer<TitleRef>()))
val PlayerTypeMap: Map<KType, NavType<*>> = mapOf(typeOf<PlaybackRequest>() to JsonNavType(serializer<PlaybackRequest>()))
