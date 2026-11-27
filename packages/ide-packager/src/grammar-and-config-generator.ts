// SPDX-License-Identifier: AGPL-3.0-or-later

import { generateTextMate } from "@modelscript/dsl";
import type {
  ExtensionGeneratedFile,
  ExtensionOptions,
  LanguageInputLike,
  NormalizedLanguage,
} from "./language-normalization.js";
import { normalizeLanguages } from "./language-normalization.js";

/**
 * Generates a VS Code File Icon Theme JSON (`file-icons/theme.json`) mapping each
 * language ID to `./<lang>.svg` (or `./<lang>.png` fallback) when present in
 * `availableIcons`, defaulting to `default.svg` (or `default.png`).
 */
export function generateFileIconTheme(
  languagesInput: LanguageInputLike[] | LanguageInputLike,
  availableIcons: ReadonlyMap<string, string> | ReadonlySet<string>,
): Record<string, unknown> {
  const rawList = Array.isArray(languagesInput) ? languagesInput : [languagesInput];
  const languages = normalizeLanguages(rawList);
  const iconMap: ReadonlyMap<string, string> =
    "get" in availableIcons
      ? availableIcons
      : new Map(
          Array.from(availableIcons, (entry) => {
            const lower = entry.toLowerCase();
            if (lower.endsWith(".svg") || lower.endsWith(".png")) {
              return [lower.slice(0, -4), entry] as const;
            }
            return [lower, `${lower}.svg`] as const;
          }),
        );

  const iconDefinitions: Record<string, { iconPath: string }> = {};
  const defaultFile = iconMap.get("default");
  if (defaultFile) {
    iconDefinitions["_default"] = { iconPath: `./${defaultFile}` };
  }
  const languageIds: Record<string, string> = {};

  for (const lang of languages) {
    const id = lang.id.toLowerCase();
    const iconFile = iconMap.get(id);
    if (iconFile) {
      iconDefinitions[id] = { iconPath: `./${iconFile}` };
      languageIds[lang.id] = id;
    }
    if (id === "sysml2") {
      const sysmlKey = iconMap.has("sysml") ? "sysml" : iconMap.has("sysml2") ? "sysml2" : undefined;
      const sysmlFile = sysmlKey ? iconMap.get(sysmlKey) : undefined;
      if (sysmlKey && sysmlFile) {
        iconDefinitions[sysmlKey] = { iconPath: `./${sysmlFile}` };
        languageIds["sysml"] = sysmlKey;
      }
    }
  }

  return {
    ...(iconDefinitions["_default"] ? { file: "_default" } : {}),
    iconDefinitions,
    languageIds,
  };
}

/**
 * Generates language-configuration.json content for a specific language.
 */
export function generateLanguageConfiguration(lang: NormalizedLanguage): string {
  const lineComment = lang.lineComment || "//";
  const blockOpen = lang.blockComment?.open || "/*";
  const blockClose = lang.blockComment?.close || "*/";

  const config = {
    comments: {
      lineComment,
      blockComment: [blockOpen, blockClose],
    },
    brackets: [
      ["{", "}"],
      ["[", "]"],
      ["(", ")"],
    ],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"', notIn: ["string"] },
      { open: "'", close: "'", notIn: ["string", "comment"] },
    ],
    surroundingPairs: [
      ["{", "}"],
      ["[", "]"],
      ["(", ")"],
      ['"', '"'],
      ["'", "'"],
    ],
    folding: {
      markers: {
        start: "^\\s*//\\s*#?region\\b",
        end: "^\\s*//\\s*#?endregion\\b",
      },
    },
  };

  return JSON.stringify(config, null, 2);
}

/**
 * Generates TextMate `.tmLanguage.json` and `language-configuration-<id>.json` files
 * for a list of normalized languages (including the `sysml2` → `sysml` alias).
 */
export function generateLanguageGrammarAndConfigFiles(languages: NormalizedLanguage[]): ExtensionGeneratedFile[] {
  const files: ExtensionGeneratedFile[] = [];

  for (const lang of languages) {
    files.push({
      path: `language-configuration-${lang.id}.json`,
      content: generateLanguageConfiguration(lang),
    });

    try {
      const tm = generateTextMate(lang.options);
      files.push({
        path: `syntaxes/${lang.id}.tmLanguage.json`,
        content: tm.tm || JSON.stringify({}),
      });
    } catch {
      files.push({
        path: `syntaxes/${lang.id}.tmLanguage.json`,
        content: JSON.stringify(
          {
            name: lang.displayName,
            scopeName: `source.${lang.id}`,
            patterns: [],
          },
          null,
          2,
        ),
      });
    }

    if (lang.id === "sysml2") {
      files.push({
        path: "language-configuration-sysml.json",
        content: generateLanguageConfiguration(lang),
      });
      try {
        const sysmlTm = generateTextMate({ ...lang.options, name: "sysml" });
        files.push({
          path: "syntaxes/sysml.tmLanguage.json",
          content: sysmlTm.tm || JSON.stringify({}),
        });
      } catch {
        files.push({
          path: "syntaxes/sysml.tmLanguage.json",
          content: JSON.stringify(
            {
              name: "SysML",
              scopeName: "source.sysml",
              patterns: [],
            },
            null,
            2,
          ),
        });
      }
    }
  }

  return files;
}

/**
 * Generates the unified client extension.ts TypeScript bootstrap source.
 */
export function generateExtensionBootstrap(languages: NormalizedLanguage[], _options?: ExtensionOptions): string {
  const langArrayJson = JSON.stringify(
    languages.map((l) => ({
      id: l.id,
      name: l.name,
      displayName: l.displayName,
      primaryExtension: l.primaryExtension,
      fileExtensions: l.fileExtensions,
    })),
    null,
    2,
  );

  return `// SPDX-License-Identifier: AGPL-3.0-or-later
// Auto-generated by ModelScript Unified Extension Generator
import * as vscode from "vscode";

interface LanguageMeta {
  id: string;
  name: string;
  displayName: string;
  primaryExtension: string;
  fileExtensions: string[];
}

const REGISTERED_LANGUAGES: LanguageMeta[] = ${langArrayJson};

let wasmExports: {
  ensureInputBuffer?: (lenBytes: number) => number;
  getInputBuffer?: () => number;
  lsp_setInputEncoding?: (encoding: number) => void;
  lsp_setInputLength?: (lenBytes: number) => void;
  getDiagramData?: (fileId: number) => number;
  [key: string]: unknown;
} | undefined;
let wasmMemory: WebAssembly.Memory;
let currentWasmBufferUri: string | null = null;
const uriToLastText = new Map<string, string>();
const uriToFileId = new Map<string, number>();
const fileIdToUri = new Map<number, string>();
let nextFileId = 0;

function getFileId(uri: string): number {
  if (uriToFileId.has(uri)) return uriToFileId.get(uri)!;
  const id = nextFileId++;
  uriToFileId.set(uri, id);
  fileIdToUri.set(id, uri);
  return id;
}

function syncWasmInputBuffer(doc: vscode.TextDocument) {
  if (!wasmExports) return;
  if (currentWasmBufferUri === doc.uri.toString() && uriToLastText.get(doc.uri.toString()) === doc.getText()) return;
  const text = doc.getText();
  const lenBytes = text.length * 2;
  const textPtr = wasmExports.ensureInputBuffer ? wasmExports.ensureInputBuffer(lenBytes) : (wasmExports.getInputBuffer ? wasmExports.getInputBuffer() : 0);
  if (!textPtr || !wasmMemory) return;

  const memArray = new Uint16Array(wasmMemory.buffer);
  for (let i = 0; i < text.length; i++) {
    memArray[(textPtr >> 1) + i] = text.charCodeAt(i);
  }
  if (wasmExports.lsp_setInputEncoding) wasmExports.lsp_setInputEncoding(1);
  if (wasmExports.lsp_setInputLength) wasmExports.lsp_setInputLength(lenBytes);

  currentWasmBufferUri = doc.uri.toString();
  uriToLastText.set(doc.uri.toString(), text);
}

// Diagram Editor Provider
class PolyglotDiagramEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext, private readonly langMeta: LanguageMeta) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = { enableScripts: true };

    const updateWebview = () => {
      syncWasmInputBuffer(document);
      const fileId = getFileId(document.uri.toString());
      let diagramData = { nodes: [], edges: [] };
      if (wasmExports && wasmExports.getDiagramData) {
        try {
          const ptr = wasmExports.getDiagramData(fileId);
          if (ptr) {
            // Read JSON from WASM memory
            const mem = new Uint8Array(wasmMemory.buffer);
            let end = ptr;
            while (mem[end] !== 0) end++;
            const jsonStr = new TextDecoder().decode(mem.subarray(ptr, end));
            diagramData = JSON.parse(jsonStr);
          }
        } catch (e) {
          console.warn("Diagram extraction failed:", e);
        }
      }
      webviewPanel.webview.postMessage({
        type: "update",
        text: document.getText(),
        diagramData,
        language: this.langMeta.displayName,
      });
    };

    const changeDocSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        updateWebview();
      }
    });

    webviewPanel.onDidDispose(() => {
      changeDocSubscription.dispose();
    });

    webviewPanel.webview.onDidReceiveMessage((e) => {
      if (e.type === "edit" && e.actions) {
        // Handle diagram user edits
      }
    });

    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview, document);
    updateWebview();
  }

  private getHtmlForWebview(webview: vscode.Webview, _document: vscode.TextDocument): string {
    let nonce = "";
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      nonce = crypto.randomUUID().replace(/-/g, "");
    } else if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      const arr = new Uint8Array(16);
      crypto.getRandomValues(arr);
      nonce = Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
    } else {
      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
      for (let i = 0; i < 32; i++) {
        nonce += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    }
    const safeTitle = String(this.langMeta.displayName).replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] || c
    );
    return \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src \${webview.cspSource} data:; style-src \${webview.cspSource} 'unsafe-inline'; script-src 'nonce-\${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>\${safeTitle} Diagram</title>
  <style>
    body { margin: 0; padding: 0; background: #0d1117; color: #c9d1d9; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; overflow: hidden; height: 100vh; display: flex; flex-direction: column; }
    #canvas-container { flex: 1; position: relative; background: #0d1117; background-image: radial-gradient(#21262d 1px, transparent 1px); background-size: 20px 20px; overflow: hidden; }
    .diagram-node { position: absolute; border: 2px solid #58a6ff; background: rgba(56, 139, 253, 0.15); border-radius: 6px; cursor: move; user-select: none; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #f0f6fc; font-weight: bold; box-shadow: 0 4px 12px rgba(0,0,0,0.5); }
    .diagram-node:hover { border-color: #79c0ff; background: rgba(56, 139, 253, 0.25); }
    .port-pin { position: absolute; width: 8px; height: 8px; background: #3fb950; border: 1px solid #ffffff; border-radius: 50%; }
  </style>
</head>
<body>
  <div id="canvas-container"></div>
  <script nonce="\${nonce}">
    const vscode = acquireVsCodeApi();
    const container = document.getElementById('canvas-container');
    let currentDiagram = { nodes: [], edges: [] };

    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'update') {
        currentDiagram = message.diagramData || { nodes: [], edges: [] };
        render();
      }
    });

    function render() {
      container.textContent = '';
      (currentDiagram.nodes || []).forEach(node => {
        const el = document.createElement('div');
        el.className = 'diagram-node';
        el.style.left = (Number(node.x || 0) + 250) + 'px';
        el.style.top = (Number(node.y || 0) + 200) + 'px';
        el.style.width = (Number(node.width || 120)) + 'px';
        el.style.height = (Number(node.height || 60)) + 'px';
        const typeSpan = document.createElement('span');
        typeSpan.style.fontSize = '11px';
        typeSpan.style.opacity = '0.7';
        typeSpan.textContent = String(node.typeId || 'Node');
        const labelSpan = document.createElement('span');
        labelSpan.textContent = String(node.label || node.id || 'Node');
        el.appendChild(typeSpan);
        el.appendChild(labelSpan);
        container.appendChild(el);
      });
    }
  </script>
</body>
</html>\`;
  }
}

export async function activate(context: vscode.ExtensionContext) {
  console.log("Activating ModelScript Extension for languages:", REGISTERED_LANGUAGES.map(l => l.displayName).join(", "));

  // Try to initialize WASM backend if available in the extension
  try {
    const wasmUri = vscode.Uri.joinPath(context.extensionUri, "parser.wasm");
    const wasmBytes = await vscode.workspace.fs.readFile(wasmUri);
    wasmMemory = new WebAssembly.Memory({ initial: 4000, maximum: 16000, shared: true });
    const env = {
      memory: wasmMemory,
      abort: () => console.error("WASM Abort"),
      logInt: () => {},
    };
    const module = await WebAssembly.instantiate(wasmBytes, { env, parser: env, engine: { debugLog: env.logInt }, host: { runHostQuery: () => 0 } });
    wasmExports = module.instance.exports;
    if (wasmExports.initArena) wasmExports.initArena(10 * 1024 * 1024);
  } catch (e) {
    console.log("Note: Running in lightweight mode without local parser.wasm:", e);
  }

  // Register Custom Diagram Editors for each registered language
  for (const lang of REGISTERED_LANGUAGES) {
    const provider = new PolyglotDiagramEditorProvider(context, lang);
    context.subscriptions.push(
      vscode.window.registerCustomEditorProvider(\`\${lang.id}.diagramEditor\`, provider, {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: true,
      })
    );
  }

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand("modelscript.openDiagram", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const lang = REGISTERED_LANGUAGES.find(l => l.fileExtensions.some(ext => editor.document.fileName.endsWith(ext)));
      if (lang) {
        const viewType = lang.id === "step" ? "modelscript.stepEditor" : \`\${lang.id}.diagramEditor\`;
        await vscode.commands.executeCommand("vscode.openWith", editor.document.uri, viewType);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("modelscript.openDiagramSource", async () => {
      const tab = vscode.window.tabGroups?.activeTabGroup?.activeTab;
      if (tab?.input && typeof tab.input === "object" && "uri" in tab.input) {
        await vscode.commands.executeCommand("vscode.openWith", (tab.input as { uri: unknown }).uri, "default");
      } else {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          await vscode.commands.executeCommand("vscode.openWith", editor.document.uri, "default");
        }
      }
    })
  );
}

export function deactivate() {}
`;
}
