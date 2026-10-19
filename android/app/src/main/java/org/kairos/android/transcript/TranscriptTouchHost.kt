package org.kairos.android.transcript

import android.content.Context
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.ViewConfiguration
import android.widget.FrameLayout
import kotlin.math.abs

/** AndroidView consumes Compose pointer input. This host routes a claimed drag to the SAME
 * AnchoredDraggableState as the Compose shell and cancels Chromium's touch sequence normally.
 * A decision is latched once; vertical motion cannot turn into a drawer gesture later. */
class TranscriptTouchHost(context: Context, private val bridge: TranscriptBridge) : FrameLayout(context) {
    var onDrag: (Float) -> Unit = {}
    var onRelease: (Float) -> Unit = {}
    var onTouchActive: (Boolean) -> Unit = {}
    var systemEdge = 24f * resources.displayMetrics.density
    private val slop = ViewConfiguration.get(context).scaledTouchSlop.toFloat()
    private var startX = 0f
    private var startY = 0f
    private var lastX = 0f
    private var locked = false
    private var dragging = false
    private var tracker: VelocityTracker? = null

    init { addView(bridge.webView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)) }

    override fun requestDisallowInterceptTouchEvent(disallowIntercept: Boolean) {
        // Chromium disallows interception as soon as it scrolls. We decide by direction and
        // its explicit DOM hscroll report instead. Preserve disallow for the Compose parent.
        parent?.requestDisallowInterceptTouchEvent(true)
    }

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        if (event.actionMasked == MotionEvent.ACTION_DOWN) {
            startX = event.rawX; startY = event.rawY; lastX = event.rawX
            dragging = false
            locked = event.x < systemEdge || width - event.x < systemEdge
            bridge.touchDecisionReady = false
            bridge.touchDirectionReady = false
            bridge.horizontalActive = false
            tracker?.recycle()
            tracker = VelocityTracker.obtain()
            onTouchActive(true)
        }
        // VelocityTracker uses local coordinates; normalize them as the host itself slides.
        val screenEvent = MotionEvent.obtain(event)
        screenEvent.offsetLocation(event.rawX - event.x, event.rawY - event.y)
        tracker?.addMovement(screenEvent)
        screenEvent.recycle()
        if (event.pointerCount > 1) locked = true
        val result = super.dispatchTouchEvent(event)
        if (event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_CANCEL) {
            tracker?.recycle(); tracker = null
            onTouchActive(false)
        }
        return result
    }

    override fun onInterceptTouchEvent(event: MotionEvent): Boolean {
        if (dragging) return true
        if (locked || event.actionMasked != MotionEvent.ACTION_MOVE) return false
        val dx = event.rawX - startX
        val dy = event.rawY - startY
        if (abs(dy) > slop && abs(dx) < abs(dy) * 1.25f) { locked = true; return false }
        if (abs(dx) <= slop || abs(dx) < abs(dy) * 1.25f) return false
        // Wait for the touchstart DOM report: no speculative interception of code/table drags.
        if (!bridge.touchDecisionReady) return false
        if (bridge.horizontalActive) {
            if (bridge.touchDirectionReady) locked = true
            return false
        }
        dragging = true
        lastX = event.rawX
        onDrag(dx - slop * if (dx > 0) 1f else -1f)
        return true
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (!dragging) return false
        when (event.actionMasked) {
            MotionEvent.ACTION_MOVE -> { onDrag(event.rawX - lastX); lastX = event.rawX }
            MotionEvent.ACTION_UP -> {
                tracker?.computeCurrentVelocity(1000)
                onRelease(tracker?.xVelocity ?: 0f)
                dragging = false
            }
            MotionEvent.ACTION_CANCEL -> { onRelease(0f); dragging = false }
        }
        return true
    }
}
