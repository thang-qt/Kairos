package org.kairos.android.ui

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp

/** Shared geometry for controls, grouped content, and elevated surfaces. */
object UiTokens {
    val controlShape = RoundedCornerShape(8.dp)
    val cardShape = RoundedCornerShape(12.dp)
    val dialogShape = RoundedCornerShape(16.dp)
    val sheetShape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp)
    val controlHeight = 48.dp
    const val scrimAlpha = 0.4f
}
