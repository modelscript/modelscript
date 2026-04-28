// This script runs inside the VS Code Markdown preview Webview.
// It enhances the rendered HTML with ModelScript-specific features:
// - ::diagram{target="X"}  → diagram placeholder div
// - ::requirements{target="X"} → requirements view placeholder div
// - {{ Var.Name }} → styled variable placeholder span

console.log("[ModelScript Preview] Script loaded!");
document.title = "[MS] " + document.title;

let isProcessing = false;

function processDirectives() {
  document.querySelectorAll("p").forEach((p) => {
    const text = p.textContent?.trim() || "";

    const diagMatch = /^::diagram\{target="([^"]+)"\}$/.exec(text);
    if (diagMatch) {
      const div = document.createElement("div");
      div.className = "modelscript-diagram";
      div.setAttribute("data-target", diagMatch[1]);
      div.style.cssText =
        "padding:20px;text-align:center;background:var(--vscode-editor-background);" +
        "border:1px solid var(--vscode-panel-border);border-radius:4px;margin:16px 0;";
      div.textContent = `Loading diagram: ${diagMatch[1]}...`;
      p.replaceWith(div);
      return;
    }

    const reqMatch = /^::requirements\{target="([^"]+)"\}$/.exec(text);
    if (reqMatch) {
      const div = document.createElement("div");
      div.className = "modelscript-requirements";
      div.setAttribute("data-target", reqMatch[1]);
      div.style.cssText =
        "padding:10px;background:var(--vscode-textBlockQuote-background);" +
        "border-left:4px solid var(--vscode-textBlockQuote-border);margin:16px 0;";
      div.textContent = `[Requirements View: ${reqMatch[1]}]`;
      p.replaceWith(div);
      return;
    }
  });
}

/**
 * Process {{ variable }} placeholders by operating on the body's innerHTML directly.
 * This bypasses all issues with text nodes being split across DOM nodes by the
 * markdown renderer, because we operate on the serialized HTML string.
 */
function processVariables() {
  const body = document.body;
  if (!body) return;

  const html = body.innerHTML;
  // Quick check — innerHTML preserves { as literal (not an HTML special char)
  if (!html.includes("{{")) return;
  // Guard: if we already processed, don't re-process (avoids infinite MutationObserver loop)
  if (html.includes("modelscript-var")) return;

  const varRegex = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
  const replaced = html.replace(
    varRegex,
    '<span class="modelscript-var" data-name="$1" ' +
      'style="font-family:monospace;color:var(--vscode-textPreformat-foreground,#d16969)">' +
      "&#123;&#123; $1 &#125;&#125;</span>",
  );

  if (replaced !== html) {
    body.innerHTML = replaced;
  }
}

function runAllExtensions() {
  if (!document.body || isProcessing) return;
  isProcessing = true;
  try {
    processDirectives();
    processVariables();
  } catch (e) {
    console.error("[ModelScript Preview]", e);
  } finally {
    Promise.resolve().then(() => {
      isProcessing = false;
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", runAllExtensions);
} else {
  runAllExtensions();
}

function startObserver() {
  if (!document.body) return;
  const observer = new MutationObserver(() => {
    if (isProcessing) return;
    runAllExtensions();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.body) {
  startObserver();
} else {
  document.addEventListener("DOMContentLoaded", startObserver);
}
