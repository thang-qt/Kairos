package org.kairos.android.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

val LocalKairosColors = staticCompositionLocalOf { KairosPalettes[0].light }

@Composable
fun KairosTheme(colors: KairosColors, dark: Boolean, content: @Composable () -> Unit) {
    val scheme = if (dark) darkColorScheme() else lightColorScheme()
    // Mirrors html/body in src/styles.css: system sans, -0.15px tracking, text-sm for UI.
    val body = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Normal, fontSize = 14.sp, lineHeight = 20.sp, letterSpacing = (-0.15).sp)
    CompositionLocalProvider(LocalKairosColors provides colors) {
        MaterialTheme(
            colorScheme = scheme.copy(
                primary = colors.p(950), onPrimary = colors.p(50),
                secondary = colors.p(700), onSecondary = colors.p(50),
                background = colors.surface, onBackground = colors.p(950),
                surface = colors.surface, onSurface = colors.p(950),
                surfaceVariant = colors.p(100), onSurfaceVariant = colors.p(800),
                surfaceContainer = colors.p(100), surfaceContainerLow = colors.p(100),
                outline = colors.ink.copy(alpha = 0.1f),
            ),
            typography = Typography(
                displayLarge = body, displayMedium = body, displaySmall = body,
                headlineLarge = body, headlineMedium = body, headlineSmall = body,
                titleLarge = body.copy(fontSize = 18.sp, lineHeight = 28.sp, fontWeight = FontWeight.Medium),
                titleMedium = body.copy(fontWeight = FontWeight.Medium), titleSmall = body,
                bodyLarge = body, bodyMedium = body, bodySmall = body.copy(fontSize = 12.sp, lineHeight = 16.sp),
                labelLarge = body, labelMedium = body.copy(fontSize = 12.sp, lineHeight = 16.sp), labelSmall = body.copy(fontSize = 11.sp, lineHeight = 16.sp),
            ),
            shapes = Shapes(small = RoundedCornerShape(8.dp), medium = RoundedCornerShape(12.dp), large = RoundedCornerShape(22.dp)),
            content = content,
        )
    }
}
