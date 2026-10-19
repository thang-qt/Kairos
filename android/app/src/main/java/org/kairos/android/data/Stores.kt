package org.kairos.android.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.compose.runtime.*
import java.net.URI
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.kairos.android.ui.theme.ColorPalettes

fun normalizeServerUrl(input: String): String {
    val trimmed = input.trim().trimEnd('/')
    require(trimmed.isNotBlank()) { "Enter your server address." }
    val candidate = if ("://" in trimmed) trimmed else "https://$trimmed"
    val uri =
        runCatching { URI(candidate) }
            .getOrElse { throw IllegalArgumentException("Enter a valid server address.") }
    require(
        uri.scheme in listOf("http", "https") &&
            !uri.host.isNullOrBlank() &&
            uri.userInfo == null &&
            uri.rawQuery == null &&
            uri.rawFragment == null
    ) {
        "Enter an http:// or https:// server address without credentials or a query."
    }
    return uri.toASCIIString().trimEnd('/')
}

fun isUnencryptedRemote(url: String): Boolean {
    val uri = runCatching { URI(url) }.getOrNull() ?: return false
    if (uri.scheme != "http") return false
    val host = uri.host.orEmpty().lowercase().removePrefix("[").removeSuffix("]")
    if (host == "localhost" || host == "::1" || host.endsWith(".localhost")) return false
    if (
        host.contains(':') &&
            (host.startsWith("fc") ||
                host.startsWith("fd") ||
                host.startsWith("fe8") ||
                host.startsWith("fe9") ||
                host.startsWith("fea") ||
                host.startsWith("feb"))
    )
        return false
    val parts = host.split('.').mapNotNull { it.toIntOrNull()?.takeIf { n -> n in 0..255 } }
    if (
        parts.size == 4 &&
            (parts[0] == 127 ||
                parts[0] == 10 ||
                (parts[0] == 172 && parts[1] in 16..31) ||
                (parts[0] == 192 && parts[1] == 168) ||
                (parts[0] == 169 && parts[1] == 254))
    )
        return false
    return true
}

class ServerStore private constructor(
    private val prefs: android.content.SharedPreferences?,
    initialUrl: String,
) {
    constructor(context: Context) :
        this(
            context.getSharedPreferences("server", Context.MODE_PRIVATE),
            context.getSharedPreferences("server", Context.MODE_PRIVATE).getString("url", "").orEmpty(),
        )

    internal constructor(initialUrl: String) : this(null, initialUrl)

    var url: String = initialUrl
        private set

    fun save(value: String) {
        url = normalizeServerUrl(value)
        prefs?.edit()?.putString("url", url)?.apply()
    }

    fun clear() {
        url = ""
        prefs?.edit()?.clear()?.apply()
    }

    val host
        get() = runCatching { URI(url).authority }.getOrNull().orEmpty()
}

class TokenStore private constructor(
    private val prefs: android.content.SharedPreferences?,
    initialToken: String?,
) {
    constructor(context: Context) :
        this(context.getSharedPreferences("auth", Context.MODE_PRIVATE), null) {
        cached = read()
        _signedIn.value = cached != null
    }

    internal constructor(initialToken: String?) : this(null, initialToken)

    private val alias = "kairos.bearer.v1"
    private val _signedIn = MutableStateFlow(initialToken != null)
    val signedIn = _signedIn.asStateFlow()
    @Volatile private var cached: String? = initialToken
    @Volatile private var tokenGeneration = 0L
    val token
        get() = cached
    val generation: Long
        get() = tokenGeneration

    val email
        get() = prefs?.getString("email", "").orEmpty()

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        return (store.getKey(alias, null) as? SecretKey)
            ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
                .apply {
                    init(
                        KeyGenParameterSpec.Builder(
                                alias,
                                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                            )
                            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                            .setKeySize(256)
                            .build()
                    )
                }
                .generateKey()
    }

    private fun read(): String? {
        val prefs = checkNotNull(prefs)
        if (prefs.getLong("expiresAt", 0) <= System.currentTimeMillis() / 1000) {
            prefs.edit().clear().apply()
            return null
        }
        return runCatching {
                val data = prefs.getString("ciphertext", null) ?: return null
                val iv = Base64.decode(prefs.getString("iv", null), Base64.NO_WRAP)
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
                String(cipher.doFinal(Base64.decode(data, Base64.NO_WRAP)), Charsets.UTF_8)
            }
            .getOrElse {
                prefs.edit().clear().apply()
                null
            }
    }

    @Synchronized
    fun save(response: TokenResponse) {
        val prefs = prefs
        if (prefs == null) {
            cached = response.token
            tokenGeneration++
            _signedIn.value = true
            return
        }
        val cipher =
            Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val encrypted = cipher.doFinal(response.token.toByteArray(Charsets.UTF_8))
        check(
            prefs
                .edit()
                .putString("ciphertext", Base64.encodeToString(encrypted, Base64.NO_WRAP))
                .putString("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
                .putLong("expiresAt", response.expiresAt)
                .putString("email", response.user.email)
                .commit()
        ) {
            "Unable to save sign-in."
        }
        cached = response.token
        tokenGeneration++
        _signedIn.value = true
    }

    @Synchronized
    fun clear() {
        clearLocked()
    }

    @Synchronized
    fun clearIfCurrent(expectedToken: String?, expectedGeneration: Long): Boolean {
        if (cached != expectedToken || tokenGeneration != expectedGeneration) return false
        clearLocked()
        return true
    }

    private fun clearLocked() {
        cached = null
        tokenGeneration++
        prefs?.edit()?.clear()?.apply()
        _signedIn.value = false
    }
}

enum class ThemeMode {
    Light,
    Dark,
    System,
}

enum class AssistantRenderer(val label: String) {
    Native("Native"),
    WebView("WebView"),
}

class PreferencesStore(context: Context) {
    private val prefs = context.getSharedPreferences("appearance", Context.MODE_PRIVATE)
    var paletteIndex by
        mutableIntStateOf(prefs.getInt("palette", 0).coerceIn(ColorPalettes.indices))
        private set

    var mode by
        mutableStateOf(
            runCatching { ThemeMode.valueOf(prefs.getString("mode", "System")!!) }
                .getOrDefault(ThemeMode.System)
        )
        private set

    var assistantRenderer by mutableStateOf(
        runCatching {
            AssistantRenderer.valueOf(prefs.getString("assistantRenderer", "Native")!!)
        }.getOrDefault(AssistantRenderer.Native)
    )
        private set

    fun assistantRenderer(value: AssistantRenderer) {
        assistantRenderer = value
        prefs.edit().putString("assistantRenderer", value.name).apply()
    }

    var appRenderer by mutableStateOf(
        runCatching { AssistantRenderer.valueOf(prefs.getString("appRenderer", "WebView")!!) }
            .getOrDefault(AssistantRenderer.WebView)
    )
        private set

    fun appRenderer(value: AssistantRenderer) {
        appRenderer = value
        prefs.edit().putString("appRenderer", value.name).apply()
    }

    var systemDark by mutableStateOf(false)
    val dark
        get() =
            when (mode) {
                ThemeMode.Light -> false
                ThemeMode.Dark -> true
                ThemeMode.System -> systemDark
            }

    val colors
        get() = ColorPalettes[paletteIndex].let { if (dark) it.dark else it.light }

    fun palette(index: Int) {
        paletteIndex = index
        prefs.edit().putInt("palette", index).apply()
    }

    fun mode(value: ThemeMode) {
        mode = value
        prefs.edit().putString("mode", value.name).apply()
    }
}
