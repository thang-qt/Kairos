package org.kairos.android.assistant

import android.content.Context
import android.net.Uri
import androidx.core.content.FileProvider
import java.io.File

/** Camera apps write only to a temporary, explicitly granted cache URI. */
object CameraAttachment {
    fun create(context: Context): Uri {
        val directory = File(context.cacheDir, "camera").apply { mkdirs() }
        directory.listFiles()?.filter { it.lastModified() < System.currentTimeMillis() - 86_400_000L }
            ?.forEach { it.delete() }
        val file = File.createTempFile("capture-", ".jpg", directory)
        return FileProvider.getUriForFile(context, "${context.packageName}.camera", file)
    }

    fun remove(context: Context, uri: Uri?) {
        if (uri?.authority != "${context.packageName}.camera") return
        val name = uri.lastPathSegment ?: return
        if (name.startsWith("capture-") && name.endsWith(".jpg") && '/' !in name)
            File(File(context.cacheDir, "camera"), name).delete()
    }
}
