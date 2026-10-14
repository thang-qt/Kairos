package org.kairos.android.markdown

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.font.FontWeight
import dev.snipme.highlights.Highlights
import dev.snipme.highlights.model.BoldHighlight
import dev.snipme.highlights.model.ColorHighlight
import dev.snipme.highlights.model.SyntaxLanguage
import dev.snipme.highlights.model.SyntaxThemes

/** Native stand-in for Shiki: token colours from the `highlights` library, on a worker thread. */
object CodeHighlighter {
    private val languages = mapOf(
        "kotlin" to SyntaxLanguage.KOTLIN, "kt" to SyntaxLanguage.KOTLIN, "kts" to SyntaxLanguage.KOTLIN,
        "java" to SyntaxLanguage.JAVA,
        "js" to SyntaxLanguage.JAVASCRIPT, "javascript" to SyntaxLanguage.JAVASCRIPT, "jsx" to SyntaxLanguage.JAVASCRIPT, "mjs" to SyntaxLanguage.JAVASCRIPT,
        "ts" to SyntaxLanguage.TYPESCRIPT, "typescript" to SyntaxLanguage.TYPESCRIPT, "tsx" to SyntaxLanguage.TYPESCRIPT,
        "py" to SyntaxLanguage.PYTHON, "python" to SyntaxLanguage.PYTHON,
        "rb" to SyntaxLanguage.RUBY, "ruby" to SyntaxLanguage.RUBY,
        "rs" to SyntaxLanguage.RUST, "rust" to SyntaxLanguage.RUST,
        "go" to SyntaxLanguage.GO, "golang" to SyntaxLanguage.GO,
        "c" to SyntaxLanguage.C, "h" to SyntaxLanguage.C,
        "cpp" to SyntaxLanguage.CPP, "c++" to SyntaxLanguage.CPP, "cc" to SyntaxLanguage.CPP, "hpp" to SyntaxLanguage.CPP,
        "cs" to SyntaxLanguage.CSHARP, "csharp" to SyntaxLanguage.CSHARP,
        "dart" to SyntaxLanguage.DART, "swift" to SyntaxLanguage.SWIFT, "php" to SyntaxLanguage.PHP,
        "pl" to SyntaxLanguage.PERL, "perl" to SyntaxLanguage.PERL,
        "sh" to SyntaxLanguage.SHELL, "bash" to SyntaxLanguage.SHELL, "shell" to SyntaxLanguage.SHELL, "zsh" to SyntaxLanguage.SHELL, "console" to SyntaxLanguage.SHELL,
        "coffee" to SyntaxLanguage.COFFEESCRIPT, "coffeescript" to SyntaxLanguage.COFFEESCRIPT,
    )
    private val plain = setOf("", "text", "txt", "plaintext", "plain", "md", "markdown")

    private val labels = mapOf(
        "js" to "JavaScript", "javascript" to "JavaScript", "jsx" to "JSX", "ts" to "TypeScript", "typescript" to "TypeScript",
        "tsx" to "TSX", "py" to "Python", "kt" to "Kotlin", "rb" to "Ruby", "rs" to "Rust", "sh" to "Shell", "bash" to "Bash",
        "cpp" to "C++", "cs" to "C#", "csharp" to "C#", "json" to "JSON", "html" to "HTML", "css" to "CSS", "sql" to "SQL",
        "yaml" to "YAML", "yml" to "YAML", "md" to "Markdown", "go" to "Go", "php" to "PHP",
    )

    fun label(language: String): String {
        val key = language.lowercase()
        if (key in plain) return "Text"
        return labels[key] ?: key.replaceFirstChar { it.uppercase() }
    }

    /** Unknown languages get the library's generic rules (strings, numbers, comments). */
    fun highlight(code: String, language: String, dark: Boolean): AnnotatedString {
        val key = language.lowercase()
        if (key in plain || code.isEmpty()) return AnnotatedString(code)
        val highlights = Highlights.Builder()
            .code(code)
            .language(languages[key] ?: SyntaxLanguage.DEFAULT)
            .theme(SyntaxThemes.atom(dark))
            .build()
            .getHighlights()
        val builder = AnnotatedString.Builder(code)
        for (highlight in highlights) {
            val start = highlight.location.start.coerceIn(0, code.length)
            val end = highlight.location.end.coerceIn(start, code.length)
            if (start == end) continue
            when (highlight) {
                is ColorHighlight -> builder.addStyle(SpanStyle(color = Color(0xFF000000.toInt() or highlight.rgb)), start, end)
                // Kairos never goes heavier than medium.
                is BoldHighlight -> builder.addStyle(SpanStyle(fontWeight = FontWeight.Medium), start, end)
            }
        }
        return builder.toAnnotatedString()
    }
}
