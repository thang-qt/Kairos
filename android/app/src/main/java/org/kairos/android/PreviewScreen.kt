package org.kairos.android

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import android.graphics.Typeface
import androidx.compose.ui.graphics.toArgb

/** Synthetic pixels only. Preview has no system screenshot and never captures another app. */
fun previewScreen(app: KairosApplication): Bitmap {
    val bitmap = Bitmap.createBitmap(720, 1080, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val colors = app.theme.colors
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    paint.shader = LinearGradient(0f, 0f, 720f, 1080f, colors.p(100).toArgb(), colors.p(400).toArgb(), Shader.TileMode.CLAMP)
    canvas.drawRect(0f, 0f, 720f, 1080f, paint)
    paint.shader = null
    paint.color = colors.p(950).toArgb()
    paint.typeface = Typeface.create("sans-serif", Typeface.NORMAL)
    paint.textSize = 42f
    canvas.drawText("Kairos screen preview", 48f, 148f, paint)
    paint.textSize = 26f
    canvas.drawText("A fake screen for attachment testing", 48f, 204f, paint)
    canvas.drawText("No app content was captured.", 48f, 246f, paint)
    paint.color = colors.surface.toArgb()
    canvas.drawRoundRect(48f, 320f, 672f, 740f, 24f, 24f, paint)
    paint.color = colors.p(800).toArgb()
    paint.textSize = 28f
    canvas.drawText("Example notes", 80f, 382f, paint)
    paint.textSize = 24f
    canvas.drawText("• Attach this placeholder", 80f, 444f, paint)
    canvas.drawText("• Send it with a question", 80f, 492f, paint)
    canvas.drawText("• Open the conversation in Kairos", 80f, 540f, paint)
    return bitmap
}
