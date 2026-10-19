package org.kairos.android.assistant

import android.os.Build
import android.view.HapticFeedbackConstants
import android.view.View
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import org.kairos.android.ui.AppIcon
import org.kairos.android.ui.icons.AppIcons
import org.kairos.android.ui.theme.LocalThemeColors

/**
 * Swipe up on the header to continue in the app. Travel is capped at [threshold];
 * the panel uses progress to grow to a fixed height, then hands off on release.
 */
@Stable
class SwipeToOpenState
internal constructor(
    private val scope: CoroutineScope,
    private val threshold: Float,
    private val flingVelocity: Float,
    private val view: View,
    private val onOpen: State<() -> Unit>,
) {
    /** Upward travel in px. */
    var offset by mutableFloatStateOf(0f)
        private set

    private var opening by mutableStateOf(false)
    private var armed = false
    private var job: Job? = null

    val active
        get() = offset > 0f || opening

    val progress
        get() = (offset / (threshold * 1.2f)).coerceIn(0f, 1f)

    /** [delta] is a pointer delta: negative moves the finger up. */
    fun dragBy(delta: Float) {
        if (opening) return
        job?.cancel()
        offset =
            if (delta < 0f) offset - delta * (if (offset < threshold) 1f else 0.35f)
            else (offset - delta).coerceAtLeast(0f)
        offset = offset.coerceIn(0f, threshold)
        val nowArmed = offset >= threshold
        if (nowArmed != armed) {
            armed = nowArmed
            if (nowArmed) view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
        }
    }

    /** Consumes a downward [delta] against pending travel; returns the consumed amount. */
    fun retract(delta: Float): Float {
        if (opening || offset <= 0f || delta <= 0f) return 0f
        val used = minOf(delta, offset)
        dragBy(used)
        return used
    }

    fun release(velocity: Float) {
        if (opening || offset <= 0f) return
        if (offset >= threshold || (velocity < -flingVelocity && offset > threshold * 0.25f)) open()
        else
            job =
                scope.launch {
                    animate(
                        offset,
                        0f,
                        animationSpec = spring(stiffness = Spring.StiffnessMediumLow),
                    ) { value, _ ->
                        offset = value
                    }
                }
    }

    private fun open() {
        opening = true
        job?.cancel()
        view.performHapticFeedback(
            if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM
            else HapticFeedbackConstants.VIRTUAL_KEY
        )
        job =
            scope.launch {
                animate(
                    offset,
                    threshold * 1.2f,
                    animationSpec = tween(180, easing = FastOutSlowInEasing),
                ) { value, _ ->
                    offset = value
                }
                onOpen.value()
            }
    }
}

/** Fresh state per overlay [generation], so a reopened overlay never starts mid-swipe. */
@Composable
fun rememberSwipeToOpen(generation: Int, onOpen: () -> Unit): SwipeToOpenState {
    val scope = rememberCoroutineScope()
    val view = LocalView.current
    val density = LocalDensity.current
    val latest = rememberUpdatedState(onOpen)
    return remember(generation, density) {
        SwipeToOpenState(
            scope,
            with(density) { 88.dp.toPx() },
            with(density) { 1200.dp.toPx() },
            view,
            latest,
        )
    }
}

@Composable
fun SwipeHint(progress: Float, modifier: Modifier = Modifier) {
    if (progress <= 0f) return
    val colors = LocalThemeColors.current
    val shape = RoundedCornerShape(16.dp)
    Row(
        modifier
            .graphicsLayer { alpha = progress.coerceIn(0f, 1f) }
            .shadow(6.dp, shape)
            .background(colors.surface, shape)
            .padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        AppIcon(AppIcons.ArrowUp02, colors.p(700), size = 20.dp)
        Text(
            if (progress >= 1f) "Release to open Kairos" else "Swipe up to open Kairos",
            color = colors.p(900),
            fontWeight = FontWeight.Medium,
        )
    }
}
