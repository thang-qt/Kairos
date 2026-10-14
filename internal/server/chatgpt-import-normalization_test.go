package server

import (
	"net/http"
	"strings"
	"testing"
)

func TestImportStoresNormalizedAssistantContentAndOriginalModelID(t *testing.T) {
	app := newTestApp(t, nil)
	cookie := signupAndRequireCookie(t, app, "normalized@example.invalid")
	conversation := importFixtureConversation("normalized")
	mapping := conversation["mapping"].(map[string]any)
	answer := mapping["answer"].(map[string]any)["message"].(map[string]any)
	answer["metadata"].(map[string]any)["model_slug"] = "gpt-6-thinking"
	answer["content"].(map[string]any)["parts"] = []any{`<box><text>Synthetic portable answer</text></box>`}
	user := mapping["user"].(map[string]any)["message"].(map[string]any)
	user["content"].(map[string]any)["parts"] = []any{`Explain <box gap={2}> without changing it.`}
	response, report := performImportRequest(t, app, cookie, importFixtureArchive(t, conversation), "import")
	assertStatusCode(t, response, http.StatusOK)
	if report.Failed || report.Imported != 1 {
		t.Fatal("normalization import failed")
	}
	var model, name, content string
	if err := app.app.db.QueryRow(`SELECT model,model_name,content_json FROM chat_messages WHERE model=?`, "gpt-6-thinking").Scan(&model, &name, &content); err != nil {
		t.Fatal(err)
	}
	if model != "gpt-6-thinking" || name != "GPT-6 Thinking" || !strings.Contains(content, "```text") || strings.Contains(content, "<box>") {
		t.Fatal("normalization was not persisted correctly")
	}
	if err := app.app.db.QueryRow(`SELECT content_json FROM chat_messages WHERE role='user'`).Scan(&content); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(content, "box gap={2}") {
		t.Fatal("user-authored markup was modified")
	}
}

func TestImportedModelDisplayNames(t *testing.T) {
	for slug, wanted := range map[string]string{"gpt-6-thinking": "GPT-6 Thinking", "gpt-4o-mini": "GPT-4o Mini", "gpt-4.1-nano": "GPT-4.1 Nano", "chatgpt-4o-latest": "ChatGPT-4o Latest", "o3-mini": "o3 Mini", "custom-provider/model-v2": "custom-provider/model-v2", "": ""} {
		if got := importedModelDisplayName(slug); got != wanted {
			t.Fatalf("display label for %q: %q, want %q", slug, got, wanted)
		}
	}
}

func TestChatGPTGeneratedUIBecomesPortableText(t *testing.T) {
	source := `Before. <Cite refs={["opaque-reference"]}/>

<box gap={2}>
  <row align="center"><icon name="check"/>Synthetic offer</row>
  <box><title size="lg">Example heading</title><text>Example description</text></box>
  <button onClick={() => GenUI.openUrl("https://example.invalid/offer")}>Open offer <icon name="arrow"/></button>
</box>

After. <Link url="https://example.invalid/reference" title="Reference"/>`
	normalized := normalizeChatGPTMarkup(source)
	for _, wanted := range []string{"Before.", "After.", "[ChatGPT citation unavailable]", "```text", "Synthetic offer", "Example heading", "Example description", "Open offer", "https://example.invalid/offer", "[Reference](<https://example.invalid/reference>)"} {
		if !strings.Contains(normalized, wanted) {
			t.Fatalf("normalized content missing %q", wanted)
		}
	}
	for _, removed := range []string{"<box", "<row", "<button", "<icon", "GenUI.openUrl", "onClick", "opaque-reference"} {
		if strings.Contains(normalized, removed) {
			t.Fatalf("unportable UI survived: %q", removed)
		}
	}
	code := "```jsx\n<box><text>Code example</text></box>\n```"
	if normalizeChatGPTMarkup(code) != code {
		t.Fatal("code sample was modified")
	}
	unsafe := normalizeChatGPTMarkup(`<Link url="javascript:alert(1)" title="Unsafe"/>`)
	if strings.Contains(unsafe, "javascript:") {
		t.Fatal("unsafe link protocol retained")
	}
	unknown := normalizeChatGPTMarkup(`<UnknownWidget value={"example"}/>`)
	if !strings.Contains(unknown, "```text") || !strings.Contains(unknown, "UnknownWidget") {
		t.Fatal("unknown component was lost")
	}
}

func TestChatGPTNormalizationPreservesTildeCodeBlocks(t *testing.T) {
	for _, code := range []string{
		"~~~jsx\n<box><text>Example</text></box>\n~~~",
		"   ~~~jsx\n<box><text>Indented example</text></box>\n  ~~~",
		"~~~~jsx\n<Cite refs={[]} />\n~~~\n<Link title=\"example\"/>\n~~~~",
		"~~~jsx\n<box><text>Unfinished example</text></box>",
	} {
		if got := normalizeChatGPTMarkup(code); got != code {
			t.Fatal("tilde-fenced code was modified")
		}
	}
}
