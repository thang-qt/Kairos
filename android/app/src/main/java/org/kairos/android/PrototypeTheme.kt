package org.kairos.android

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.kairos.android.ui.theme.KairosPalettes

/** Native theme is available without constructing a transcript or a WebView. */
class PrototypeTheme {
    var paletteIndex by mutableStateOf(0)
        private set
    var dark by mutableStateOf(false)
        private set
    val colors get() = KairosPalettes[paletteIndex].let { if (dark) it.dark else it.light }
    fun cyclePalette() { paletteIndex = (paletteIndex + 1) % KairosPalettes.size }
    fun toggleMode() { dark = !dark }
}
