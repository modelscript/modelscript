// This script runs inside the VS Code Markdown preview Webview.
// It enhances the rendered HTML with ModelScript-specific features:
// - ::diagram{target="X"}  → diagram placeholder div
// - ::requirements{target="X"} → requirements view placeholder div
// - {{ Var.Name }} → styled variable placeholder span and interactive writeback

declare function acquireVsCodeApi(): { postMessage: (msg: unknown) => void };

let vscodeApi: { postMessage: (msg: unknown) => void } | null = null;
try {
  vscodeApi = acquireVsCodeApi();
} catch {
  // May fail in non-webview test environments
}

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
  if (!html.includes("{{")) return;
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

/**
 * Attach click-to-edit inline input to variables and editable cells.
 * Emits writebackParameter postMessage to VS Code host on Enter / blur.
 */
function setupEditableVariables() {
  document.querySelectorAll<HTMLElement>(".modelscript-var, .modelscript-var-editable").forEach((el) => {
    if (el.dataset.listenerAttached) return;
    el.dataset.listenerAttached = "true";

    const varName = el.getAttribute("data-name");
    if (!varName) return;

    el.style.cursor = "pointer";
    el.style.borderBottom = "1px dashed var(--vscode-textLink-foreground, #3794ff)";

    el.addEventListener("click", (evt) => {
      evt.stopPropagation();
      if (el.querySelector("input")) return; // Already editing

      const originalText = el.textContent?.trim() || "";
      const currentValue = el.getAttribute("data-value") || originalText.replace(/^\{\{\s*|\s*\}\}$/g, "");

      const input = document.createElement("input");
      input.type = "text";
      input.value = currentValue;
      input.style.cssText =
        "font-family:monospace;font-size:inherit;color:var(--vscode-input-foreground,#ccc);" +
        "background:var(--vscode-input-background,#1e1e1e);border:1px solid var(--vscode-input-border,#007acc);" +
        "border-radius:2px;padding:1px 4px;width:" +
        Math.max(60, currentValue.length * 10 + 20) +
        "px;outline:none;";

      el.textContent = "";
      el.appendChild(input);
      input.focus();
      input.select();

      let committed = false;
      const finishEdit = (save: boolean) => {
        if (committed) return;
        committed = true;
        const newText = input.value.trim();
        if (save && newText && newText !== currentValue && vscodeApi) {
          el.textContent = newText;
          el.setAttribute("data-value", newText);
          vscodeApi.postMessage({
            command: "writebackParameter",
            target: varName,
            newValue: newText,
          });
        } else {
          el.textContent = originalText;
        }
      };

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finishEdit(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finishEdit(false);
        }
      });

      input.addEventListener("blur", () => {
        finishEdit(true);
      });
    });
  });
}

function runAllExtensions() {
  if (!document.body || isProcessing) return;
  isProcessing = true;
  try {
    processDirectives();
    processVariables();
    setupEditableVariables();
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
