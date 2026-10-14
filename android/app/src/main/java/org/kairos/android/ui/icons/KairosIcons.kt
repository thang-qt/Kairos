// Generated from @hugeicons/core-free-icons by scripts/gen-android-icons.mjs. Do not edit.
package org.kairos.android.ui.icons

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

// The web renders every icon with strokeWidth={1.5}, which overrides each element's own width.
private const val STROKE_WIDTH = 1.5f

private fun icon(name: String, block: ImageVector.Builder.() -> Unit): ImageVector =
    ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).apply(block).build()

private fun ImageVector.Builder.path(
    d: String,
    stroke: Boolean = false,
    fill: Boolean = false,
    evenOdd: Boolean = false,
    cap: StrokeCap = StrokeCap.Butt,
    join: StrokeJoin = StrokeJoin.Miter,
    alpha: Float = 1f,
) {
    // Black is replaced by the tint at draw time.
    addPath(
        pathData = addPathNodes(d),
        pathFillType = if (evenOdd) PathFillType.EvenOdd else PathFillType.NonZero,
        fill = if (fill) SolidColor(Color.Black) else null,
        fillAlpha = alpha,
        stroke = if (stroke) SolidColor(Color.Black) else null,
        strokeAlpha = alpha,
        strokeLineWidth = STROKE_WIDTH,
        strokeLineCap = cap,
        strokeLineJoin = join,
    )
}

object KairosIcons {
    val AiMagic: ImageVector by lazy {
        icon("AiMagic") {
            path("M10 7L9.48415 8.39405C8.80774 10.222 8.46953 11.136 7.80278 11.8028C7.13603 12.4695 6.22204 12.8077 4.39405 13.4842L3 14L4.39405 14.5158C6.22204 15.1923 7.13603 15.5305 7.80278 16.1972C8.46953 16.864 8.80774 17.778 9.48415 19.6059L10 21L10.5158 19.6059C11.1923 17.778 11.5305 16.864 12.1972 16.1972C12.864 15.5305 13.778 15.1923 15.6059 14.5158L17 14L15.6059 13.4842C13.778 12.8077 12.864 12.4695 12.1972 11.8028C11.5305 11.136 11.1923 10.222 10.5158 8.39405L10 7Z", stroke = true, join = StrokeJoin.Round)
            path("M18 3L17.7789 3.59745C17.489 4.38087 17.3441 4.77259 17.0583 5.05833C16.7726 5.34408 16.3809 5.48903 15.5975 5.77892L15 6L15.5975 6.22108C16.3809 6.51097 16.7726 6.65592 17.0583 6.94167C17.3441 7.22741 17.489 7.61913 17.7789 8.40255L18 9L18.2211 8.40255C18.511 7.61913 18.6559 7.22741 18.9417 6.94166C19.2274 6.65592 19.6191 6.51097 20.4025 6.22108L21 6L20.4025 5.77892C19.6191 5.48903 19.2274 5.34408 18.9417 5.05833C18.6559 4.77259 18.511 4.38087 18.2211 3.59745L18 3Z", stroke = true, join = StrokeJoin.Round)
        }
    }

    val ArrowDown01: ImageVector by lazy {
        icon("ArrowDown01") {
            path("M18 9.00005C18 9.00005 13.5811 15 12 15C10.4188 15 6 9 6 9", stroke = true, cap = StrokeCap.Round, join = StrokeJoin.Round)
        }
    }

    val ArrowRight01: ImageVector by lazy {
        icon("ArrowRight01") {
            path("M9.00005 6C9.00005 6 15 10.4189 15 12C15 13.5812 9 18 9 18", stroke = true, cap = StrokeCap.Round, join = StrokeJoin.Round)
        }
    }

    val ArrowUp02: ImageVector by lazy {
        icon("ArrowUp02") {
            path("M12 5.5V19", stroke = true, cap = StrokeCap.Round, join = StrokeJoin.Round)
            path("M18 11C18 11 13.5811 5.00001 12 5C10.4188 4.99999 6 11 6 11", stroke = true, cap = StrokeCap.Round, join = StrokeJoin.Round)
        }
    }

    val ArrowUpRight01: ImageVector by lazy {
        icon("ArrowUpRight01") {
            path("M9 6.65032C9 6.65032 15.9383 6.10759 16.9154 7.08463C17.8924 8.06167 17.3496 15 17.3496 15M16.5 7.5L6.5 17.5", stroke = true, cap = StrokeCap.Round, join = StrokeJoin.Round)
        }
    }

    val BubbleChat: ImageVector by lazy {
        icon("BubbleChat") {
            path("M12.0045 12H12.0135M16 12H16.009M8.009 12H8.01797", stroke = true, cap = StrokeCap.Round, join = StrokeJoin.Round)
            path("M21.5 12C21.5 17.2467 17.2467 21.5 12 21.5C10.3719 21.5 8.8394 21.0904 7.5 20.3687C5.63177 19.362 4.37462 20.2979 3.26592 20.4658C3.09774 20.4913 2.93024 20.4302 2.80997 20.31C2.62741 20.1274 2.59266 19.8451 2.6935 19.6074C3.12865 18.5818 3.5282 16.6382 2.98341 15C2.6698 14.057 2.5 13.0483 2.5 12C2.5 6.75329 6.75329 2.5 12 2.5C17.2467 2.5 21.5 6.75329 21.5 12Z", stroke = true, cap = StrokeCap.Round, join = StrokeJoin.Round)
        }
    }

    val Cancel01: ImageVector by lazy {
        icon("Cancel01") {
            path("M18 6L6.00081 17.9992M17.9992 18L6 6.00085", stroke = true, cap = StrokeCap.Round, join = StrokeJoin.Round)
        }
    }

    val Copy01: ImageVector by lazy {
        icon("Copy01") {
            path("M9 15C9 12.1716 9 10.7574 9.87868 9.87868C10.7574 9 12.1716 9 15 9L16 9C18.8284 9 20.2426 9 21.1213 9.87868C22 10.7574 22 12.1716 22 15V16C22 18.8284 22 20.2426 21.1213 21.1213C20.2426 22 18.8284 22 16 22H15C12.1716 22 10.7574 22 9.87868 21.1213C9 20.2426 9 18.8284 9 16L9 15Z", stroke = true, cap = StrokeCap.Round, join = StrokeJoin.Round)
            path("M16.9999 9C16.9975 6.04291 16.9528 4.51121 16.092 3.46243C15.9258 3.25989 15.7401 3.07418 15.5376 2.90796C14.4312 2 12.7875 2 9.5 2C6.21252 2 4.56878 2 3.46243 2.90796C3.25989 3.07417 3.07418 3.25989 2.90796 3.46243C2 4.56878 2 6.21252 2 9.5C2 12.7875 2 14.4312 2.90796 15.5376C3.07417 15.7401 3.25989 15.9258 3.46243 16.092C4.51121 16.9528 6.04291 16.9975 9 16.9999", stroke = true, cap = StrokeCap.Round, join = StrokeJoin.Round)
        }
    }

    val CopyLink: ImageVector by lazy {
        icon("CopyLink") {
            path("M14.5563 13.2183C13.514 14.2606 11.8241 14.2606 10.7817 13.2183C9.73942 12.1759 9.73942 10.486 10.7817 9.44364L13.1409 7.0845C14.1357 6.08961 15.7206 6.04433 16.7692 6.94866M16.4437 3.78175C17.486 2.73942 19.1759 2.73942 20.2183 3.78175C21.2606 4.82408 21.2606 6.51403 20.2183 7.55636L17.8591 9.9155C16.8643 10.9104 15.2794 10.9557 14.2308 10.0513", stroke = true, cap = StrokeCap.Round, join = StrokeJoin.Round)
            path("M10.4999 3C7.21257 3 5.56889 3 4.46256 3.9079C4.25998 4.07414 4.07423 4.25989 3.90798 4.46247C3.00007 5.56879 3.00006 7.21247 3.00002 10.4998L3 12.9999C2.99996 16.7712 2.99995 18.6568 4.17152 19.8284C5.3431 21 7.22873 21 11 21H13.4999C16.7874 21 18.4311 21 19.5375 20.092C19.74 19.9258 19.9257 19.7401 20.092 19.5376C20.9999 18.4312 20.9999 16.7875 20.9999 13.5", stroke = true, cap = StrokeCap.Round, join = StrokeJoin.Round)
        }
    }

    val Delete01: ImageVector by lazy {
        icon("Delete01") {
            path("M19.5 5.5L18.8803 15.5251C18.7219 18.0864 18.6428 19.3671 18.0008 20.2879C17.6833 20.7431 17.2747 21.1273 16.8007 21.416C15.8421 22 14.559 22 11.9927 22C9.42312 22 8.1383 22 7.17905 21.4149C6.7048 21.1257 6.296 20.7408 5.97868 20.2848C5.33688 19.3626 5.25945 18.0801 5.10461 15.5152L4.5 5.5", stroke = true, cap = StrokeCap.Round)
            path("M3 5.5H21M16.0557 5.5L15.3731 4.09173C14.9196 3.15626 14.6928 2.68852 14.3017 2.39681C14.215 2.3321 14.1231 2.27454 14.027 2.2247C13.5939 2 13.0741 2 12.0345 2C10.9688 2 10.436 2 9.99568 2.23412C9.8981 2.28601 9.80498 2.3459 9.71729 2.41317C9.32164 2.7167 9.10063 3.20155 8.65861 4.17126L8.05292 5.5", stroke = true, cap = StrokeCap.Round)
        }
    }

    val Moon01: ImageVector by lazy {
        icon("Moon01") {
            path("M21.0985 7.84477C20.458 8.55417 19.5311 9 18.5 9C16.567 9 15 7.433 15 5.5C15 4.46895 15.4458 3.54203 16.1552 2.90149M21.0985 7.84477C21.6774 9.11025 22 10.5174 22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C13.4826 2 14.8898 2.32262 16.1552 2.90149M21.0985 7.84477C20.0998 5.66155 18.3384 3.90018 16.1552 2.90149", stroke = true)
            path("M10 8H10.0064", stroke = true, cap = StrokeCap.Round, join = StrokeJoin.Round)
            path("M7 14H7.00635", stroke = true, cap = StrokeCap.Round, join = StrokeJoin.Round)
            path("M16 16C16 17.1046 15.1046 18 14 18C12.8954 18 12 17.1046 12 16C12 14.8954 12.8954 14 14 14C15.1046 14 16 14.8954 16 16Z", stroke = true)
        }
    }

    val MoreHorizontal: ImageVector by lazy {
        icon("MoreHorizontal") {
            path("M12.0045 11.5C12.5568 11.5 13.0045 11.9477 13.0045 12.5C13.0045 13.0523 12.5568 13.5 12.0045 13.5C11.4522 13.5 11.0045 13.0523 11.0045 12.5C11.0045 11.9477 11.4522 11.5 12.0045 11.5Z", stroke = true, cap = StrokeCap.Round, join = StrokeJoin.Round)
            path("M18.0045 11.5C18.5568 11.5 19.0045 11.9477 19.0045 12.5C19.0045 13.0523 18.5568 13.5 18.0045 13.5C17.4522 13.5 17.0045 13.0523 17.0045 12.5C17.0045 11.9477 17.4522 11.5 18.0045 11.5Z", stroke = true, cap = StrokeCap.Round, join = StrokeJoin.Round)
            path("M6.00449 11.5C6.55677 11.5 7.00449 11.9477 7.00449 12.5C7.00449 13.0523 6.55677 13.5 6.00449 13.5C5.4522 13.5 5.00449 13.0523 5.00449 12.5C5.00449 11.9477 5.4522 11.5 6.00449 11.5Z", stroke = true, cap = StrokeCap.Round, join = StrokeJoin.Round)
        }
    }

    val MoreVertical: ImageVector by lazy {
        icon("MoreVertical") {
            path("M11.9967 11.5C12.549 11.5 12.9967 11.9477 12.9967 12.5C12.9967 13.0523 12.549 13.5 11.9967 13.5C11.4444 13.5 10.9967 13.0523 10.9967 12.5C10.9967 11.9477 11.4444 11.5 11.9967 11.5Z", stroke = true, cap = StrokeCap.Round, join = StrokeJoin.Round)
            path("M11.9967 5.5C12.549 5.5 12.9967 5.94772 12.9967 6.5C12.9967 7.05228 12.549 7.5 11.9967 7.5C11.4444 7.5 10.9967 7.05228 10.9967 6.5C10.9967 5.94772 11.4444 5.5 11.9967 5.5Z", stroke = true, cap = StrokeCap.Round, join = StrokeJoin.Round)
            path("M11.9967 17.5C12.549 17.5 12.9967 17.9477 12.9967 18.5C12.9967 19.0523 12.549 19.5 11.9967 19.5C11.4444 19.5 10.9967 19.0523 10.9967 18.5C10.9967 17.9477 11.4444 17.5 11.9967 17.5Z", stroke = true, cap = StrokeCap.Round, join = StrokeJoin.Round)
        }
    }

    val PaintBoard: ImageVector by lazy {
        icon("PaintBoard") {
            path("M22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22C12.8417 22 14 22.1163 14 21C14 20.391 13.6832 19.9212 13.3686 19.4544C12.9082 18.7715 12.4523 18.0953 13 17C13.6667 15.6667 14.7778 15.6667 16.4815 15.6667C17.3334 15.6667 18.3334 15.6667 19.5 15.5C21.601 15.1999 22 13.9084 22 12Z", stroke = true)
            path("M7 15.002L7.00868 14.9996", stroke = true, cap = StrokeCap.Round, join = StrokeJoin.Round)
            path("M8 8.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0Z", stroke = true)
            path("M15 9.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0Z", stroke = true)
        }
    }

    val PencilEdit02: ImageVector by lazy {
        icon("PencilEdit02") {
            path("M16.4249 4.60509L17.4149 3.6151C18.2351 2.79497 19.5648 2.79497 20.3849 3.6151C21.205 4.43524 21.205 5.76493 20.3849 6.58507L19.3949 7.57506M16.4249 4.60509L9.76558 11.2644C9.25807 11.772 8.89804 12.4078 8.72397 13.1041L8 16L10.8959 15.276C11.5922 15.102 12.228 14.7419 12.7356 14.2344L19.3949 7.57506M16.4249 4.60509L19.3949 7.57506", stroke = true, join = StrokeJoin.Round)
            path("M18.9999 13.5C18.9999 16.7875 18.9999 18.4312 18.092 19.5376C17.9258 19.7401 17.7401 19.9258 17.5375 20.092C16.4312 21 14.7874 21 11.4999 21H11C7.22876 21 5.34316 21 4.17159 19.8284C3.00003 18.6569 3 16.7712 3 13V12.5C3 9.21252 3 7.56879 3.90794 6.46244C4.07417 6.2599 4.2599 6.07417 4.46244 5.90794C5.56879 5 7.21252 5 10.5 5", stroke = true, cap = StrokeCap.Round, join = StrokeJoin.Round)
        }
    }

    val PlusSign: ImageVector by lazy {
        icon("PlusSign") {
            path("M12 4V20M20 12H4", stroke = true, cap = StrokeCap.Round, join = StrokeJoin.Round)
        }
    }

    val Search01: ImageVector by lazy {
        icon("Search01") {
            path("M17 17L21 21", stroke = true, cap = StrokeCap.Round, join = StrokeJoin.Round)
            path("M19 11C19 6.58172 15.4183 3 11 3C6.58172 3 3 6.58172 3 11C3 15.4183 6.58172 19 11 19C15.4183 19 19 15.4183 19 11Z", stroke = true, cap = StrokeCap.Round, join = StrokeJoin.Round)
        }
    }

    val Settings01: ImageVector by lazy {
        icon("Settings01") {
            path("M21.3175 7.14139L20.8239 6.28479C20.4506 5.63696 20.264 5.31305 19.9464 5.18388C19.6288 5.05472 19.2696 5.15664 18.5513 5.36048L17.3311 5.70418C16.8725 5.80994 16.3913 5.74994 15.9726 5.53479L15.6357 5.34042C15.2766 5.11043 15.0004 4.77133 14.8475 4.37274L14.5136 3.37536C14.294 2.71534 14.1842 2.38533 13.9228 2.19657C13.6615 2.00781 13.3143 2.00781 12.6199 2.00781H11.5051C10.8108 2.00781 10.4636 2.00781 10.2022 2.19657C9.94085 2.38533 9.83106 2.71534 9.61149 3.37536L9.27753 4.37274C9.12465 4.77133 8.84845 5.11043 8.48937 5.34042L8.15249 5.53479C7.73374 5.74994 7.25259 5.80994 6.79398 5.70418L5.57375 5.36048C4.85541 5.15664 4.49625 5.05472 4.17867 5.18388C3.86109 5.31305 3.67445 5.63696 3.30115 6.28479L2.80757 7.14139C2.45766 7.74864 2.2827 8.05227 2.31666 8.37549C2.35061 8.69871 2.58483 8.95918 3.05326 9.48012L4.0843 10.6328C4.3363 10.9518 4.51521 11.5078 4.51521 12.0077C4.51521 12.5078 4.33636 13.0636 4.08433 13.3827L3.05326 14.5354C2.58483 15.0564 2.35062 15.3168 2.31666 15.6401C2.2827 15.9633 2.45766 16.2669 2.80757 16.8741L3.30114 17.7307C3.67443 18.3785 3.86109 18.7025 4.17867 18.8316C4.49625 18.9608 4.85542 18.8589 5.57377 18.655L6.79394 18.3113C7.25263 18.2055 7.73387 18.2656 8.15267 18.4808L8.4895 18.6752C8.84851 18.9052 9.12464 19.2442 9.2775 19.6428L9.61149 20.6403C9.83106 21.3003 9.94085 21.6303 10.2022 21.8191C10.4636 22.0078 10.8108 22.0078 11.5051 22.0078H12.6199C13.3143 22.0078 13.6615 22.0078 13.9228 21.8191C14.1842 21.6303 14.294 21.3003 14.5136 20.6403L14.8476 19.6428C15.0004 19.2442 15.2765 18.9052 15.6356 18.6752L15.9724 18.4808C16.3912 18.2656 16.8724 18.2055 17.3311 18.3113L18.5513 18.655C19.2696 18.8589 19.6288 18.9608 19.9464 18.8316C20.264 18.7025 20.4506 18.3785 20.8239 17.7307L21.3175 16.8741C21.6674 16.2669 21.8423 15.9633 21.8084 15.6401C21.7744 15.3168 21.5402 15.0564 21.0718 14.5354L20.0407 13.3827C19.7887 13.0636 19.6098 12.5078 19.6098 12.0077C19.6098 11.5078 19.7888 10.9518 20.0407 10.6328L21.0718 9.48012C21.5402 8.95918 21.7744 8.69871 21.8084 8.37549C21.8423 8.05227 21.6674 7.74864 21.3175 7.14139Z", stroke = true, cap = StrokeCap.Round)
            path("M15.5195 12C15.5195 13.933 13.9525 15.5 12.0195 15.5C10.0865 15.5 8.51953 13.933 8.51953 12C8.51953 10.067 10.0865 8.5 12.0195 8.5C13.9525 8.5 15.5195 10.067 15.5195 12Z", stroke = true)
        }
    }

    val SidebarLeft01: ImageVector by lazy {
        icon("SidebarLeft01") {
            path("M2 12C2 8.25027 2 6.3754 2.95491 5.06107C3.26331 4.6366 3.6366 4.26331 4.06107 3.95491C5.3754 3 7.25027 3 11 3H13C16.7497 3 18.6246 3 19.9389 3.95491C20.3634 4.26331 20.7367 4.6366 21.0451 5.06107C22 6.3754 22 8.25027 22 12C22 15.7497 22 17.6246 21.0451 18.9389C20.7367 19.3634 20.3634 19.7367 19.9389 20.0451C18.6246 21 16.7497 21 13 21H11C7.25027 21 5.3754 21 4.06107 20.0451C3.6366 19.7367 3.26331 19.3634 2.95491 18.9389C2 17.6246 2 15.7497 2 12Z", stroke = true, join = StrokeJoin.Round)
            path("M9.5 3.5L9.5 20.5", stroke = true, join = StrokeJoin.Round)
            path("M5 7C5 7 5.91421 7 6.5 7", stroke = true, cap = StrokeCap.Round, join = StrokeJoin.Round)
            path("M5 11H6.5", stroke = true, cap = StrokeCap.Round, join = StrokeJoin.Round)
            path("M17 10L15.7735 11.0572C15.2578 11.5016 15 11.7239 15 12C15 12.2761 15.2578 12.4984 15.7735 12.9428L17 14", stroke = true, cap = StrokeCap.Round, join = StrokeJoin.Round)
        }
    }

    val SmartPhone01: ImageVector by lazy {
        icon("SmartPhone01") {
            path("M12 19H12.01", stroke = true, cap = StrokeCap.Round, join = StrokeJoin.Round)
            path("M13.5 2H10.5C8.14298 2 6.96447 2 6.23223 2.73223C5.5 3.46447 5.5 4.64298 5.5 7V17C5.5 19.357 5.5 20.5355 6.23223 21.2678C6.96447 22 8.14298 22 10.5 22H13.5C15.857 22 17.0355 22 17.7678 21.2678C18.5 20.5355 18.5 19.357 18.5 17V7C18.5 4.64298 18.5 3.46447 17.7678 2.73223C17.0355 2 15.857 2 13.5 2Z", stroke = true, cap = StrokeCap.Round, join = StrokeJoin.Round)
        }
    }

    val Sun01: ImageVector by lazy {
        icon("Sun01") {
            path("M17 12C17 14.7614 14.7614 17 12 17C9.23858 17 7 14.7614 7 12C7 9.23858 9.23858 7 12 7C14.7614 7 17 9.23858 17 12Z", stroke = true)
            path("M11.9955 3H12.0045M11.9961 21H12.0051M18.3588 5.63599H18.3678M5.63409 18.364H5.64307M5.63409 5.63647H5.64307M18.3582 18.3645H18.3672M20.991 12.0006H21M3 12.0006H3.00898", stroke = true, cap = StrokeCap.Round, join = StrokeJoin.Round)
        }
    }

    val Tick02: ImageVector by lazy {
        icon("Tick02") {
            path("M5 14L8.5 17.5L19 6.5", stroke = true, cap = StrokeCap.Round, join = StrokeJoin.Round)
        }
    }
}
