package org.kairos.android.assistant

import androidx.compose.foundation.Image
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale

@Composable
fun ScreenThumbnail(
    attachment: ScreenAttachment,
    modifier: Modifier = Modifier,
    crop: Boolean = false,
) {
    // Reduced bytes only; the original system screenshot never enters composition.
    val image = remember(attachment) { attachment.decode().asImageBitmap() }
    Image(
        image,
        contentDescription = "Attached screen",
        modifier = modifier,
        contentScale = if (crop) ContentScale.Crop else ContentScale.Fit,
    )
}
