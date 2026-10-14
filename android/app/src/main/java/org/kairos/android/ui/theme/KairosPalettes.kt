// Generated from src/styles.css by scripts/gen-android-theme.mjs. Do not edit.
package org.kairos.android.ui.theme

import androidx.compose.ui.graphics.Color

data class KairosColors(val primary: List<Color>, val surface: Color, val ink: Color) {
    fun p(step: Int): Color = primary[listOf(50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950).indexOf(step)]
}
data class KairosPalette(val name: String, val light: KairosColors, val dark: KairosColors)

val KairosPalettes = listOf(
    KairosPalette("default",
        light = KairosColors(listOf(Color(0xFFFDFCFB), Color(0xFFF9F9F9), Color(0xFFEDEDED), Color(0xFFF0EEEB), Color(0xFFD7D5D2), Color(0xFFBBB9B5), Color(0xFF979590), Color(0xFF767471), Color(0xFF575552), Color(0xFF3C3A38), Color(0xFF222120)), Color(0xFFFFFFFF), Color(0xFF000000)),
        dark = KairosColors(listOf(Color(0xFF060606), Color(0xFF0D0D0D), Color(0xFF181818), Color(0xFF2F2D2A), Color(0xFF494744), Color(0xFF6B6965), Color(0xFF918F8B), Color(0xFFAAA7A3), Color(0xFFC9C7C4), Color(0xFFDEDCD9), Color(0xFFEEEDEA)), Color(0xFF000000), Color(0xFFFFFFFF))
    ),
    KairosPalette("harvest",
        light = KairosColors(listOf(Color(0xFFFCF4DF), Color(0xFFF5E5C0), Color(0xFFECD2A2), Color(0xFFD9BA82), Color(0xFFC49F63), Color(0xFFAE8752), Color(0xFF8D6944), Color(0xFF73543A), Color(0xFF5B4333), Color(0xFF47352D), Color(0xFF34271F)), Color(0xFFFBF1DE), Color(0xFF34271F)),
        dark = KairosColors(listOf(Color(0xFF171311), Color(0xFF201917), Color(0xFF2B211D), Color(0xFF3A2D26), Color(0xFF513D33), Color(0xFF6A5040), Color(0xFF8B674F), Color(0xFFB48966), Color(0xFFD5B188), Color(0xFFEBD3B0), Color(0xFFF6EAD5)), Color(0xFF241B18), Color(0xFFEBD3B0))
    ),
    KairosPalette("mist",
        light = KairosColors(listOf(Color(0xFFF3F6FB), Color(0xFFE8EDF6), Color(0xFFDBE3F0), Color(0xFFC8D2E4), Color(0xFFAEBCD6), Color(0xFF93A5C4), Color(0xFF7487A7), Color(0xFF5E708D), Color(0xFF4C5B73), Color(0xFF3D485D), Color(0xFF2E3747)), Color(0xFFF3F6FB), Color(0xFF2E3747)),
        dark = KairosColors(listOf(Color(0xFF10141B), Color(0xFF161C24), Color(0xFF1D2530), Color(0xFF273242), Color(0xFF334258), Color(0xFF43556F), Color(0xFF5D7496), Color(0xFF87A0C2), Color(0xFFAFC0DC), Color(0xFFD4DEF0), Color(0xFFEBF1FB)), Color(0xFF111720), Color(0xFFD4DEF0))
    ),
    KairosPalette("canopy",
        light = KairosColors(listOf(Color(0xFFF3F3E6), Color(0xFFE7E9D6), Color(0xFFD9DDC3), Color(0xFFC4CCB1), Color(0xFFA5B68F), Color(0xFF8D9D78), Color(0xFF748262), Color(0xFF5F6950), Color(0xFF4E5644), Color(0xFF3F4638), Color(0xFF31352B)), Color(0xFFF1F0E3), Color(0xFF31352B)),
        dark = KairosColors(listOf(Color(0xFF151A17), Color(0xFF1D2420), Color(0xFF273029), Color(0xFF334038), Color(0xFF435247), Color(0xFF55675A), Color(0xFF6F856D), Color(0xFF9EB196), Color(0xFFC0CBB0), Color(0xFFDDE1CF), Color(0xFFEDF0E3)), Color(0xFF18201C), Color(0xFFDDE1CF))
    ),
    KairosPalette("ember",
        light = KairosColors(listOf(Color(0xFFFCF1EC), Color(0xFFF7E0D7), Color(0xFFEFC7B7), Color(0xFFE1A58E), Color(0xFFCF8166), Color(0xFFBB654E), Color(0xFF965141), Color(0xFF794238), Color(0xFF61362F), Color(0xFF4C2B28), Color(0xFF381F20)), Color(0xFFFBEFEA), Color(0xFF381F20)),
        dark = KairosColors(listOf(Color(0xFF180F12), Color(0xFF221419), Color(0xFF311D22), Color(0xFF44282C), Color(0xFF5F3638), Color(0xFF7E4944), Color(0xFFA05F52), Color(0xFFCB8368), Color(0xFFE1AB92), Color(0xFFF0D1C3), Color(0xFFFAECE7)), Color(0xFF1D1216), Color(0xFFF0D1C3))
    ),
    KairosPalette("tide",
        light = KairosColors(listOf(Color(0xFFEEF6F8), Color(0xFFDDEBEF), Color(0xFFC5DCE3), Color(0xFFA5C4CF), Color(0xFF81AAB9), Color(0xFF648F9F), Color(0xFF4F7282), Color(0xFF405C69), Color(0xFF334954), Color(0xFF293A43), Color(0xFF1D2B31)), Color(0xFFEEF5F7), Color(0xFF1D2B31)),
        dark = KairosColors(listOf(Color(0xFF0F161A), Color(0xFF162026), Color(0xFF1E2B33), Color(0xFF293944), Color(0xFF38505D), Color(0xFF4A6878), Color(0xFF628899), Color(0xFF89AEBA), Color(0xFFB4CDD5), Color(0xFFD9E9ED), Color(0xFFEFF7F9)), Color(0xFF111A1F), Color(0xFFD9E9ED))
    )
)
