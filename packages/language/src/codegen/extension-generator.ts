// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LanguageOptions } from "../dsl/language.js";
import { generateTextMate } from "./textmate.js";

/**
 * Configuration options for generating a VS Code extension.
 */
export interface ExtensionOptions {
  /** Extension unique identifier (e.g. "modelscript", "calc-lang") */
  name?: string;
  /** Human-readable display name (e.g. "ModelScript — Polyglot Systems IDE") */
  displayName?: string;
  /** Semantic version string */
  version?: string;
  /** Publisher name */
  publisher?: string;
  /** Extension description */
  description?: string;
  /** Homepage URL */
  homepage?: string;
  /** Repository URL */
  repository?: string;
  /** Minimum VS Code engine version (default: "^1.80.0") */
  vscodeEngine?: string;
  /** Output mode: "web" (pure browser) | "node" (desktop) | "universal" (both) */
  target?: "web" | "node" | "universal";
  /** Feature toggles */
  features?: {
    diagramEditor?: boolean;
    cad3dViewer?: boolean;
    simulationPanels?: boolean;
    notebooks?: boolean;
    mcpBridge?: boolean;
    chatParticipant?: boolean;
  };
}

export interface ExtensionGeneratedFile {
  path: string;
  content: string | Uint8Array;
}

/**
 * Normalized language descriptor for extension generation.
 */
export interface NormalizedLanguage {
  id: string;
  name: string;
  displayName: string;
  fileExtensions: string[];
  primaryExtension: string;
  options: LanguageOptions;
  lineComment?: string;
  blockComment?: { open: string; close: string };
  icon?: { light: string; dark: string };
}

/**
 * Normalizes a list of LanguageOptions into standard descriptors.
 */
export function normalizeLanguages(languages: (LanguageOptions | any)[]): NormalizedLanguage[] {
  return languages.map((lang) => {
    const rawName = lang.name || "dsl";
    const id = rawName.toLowerCase().replace(/[^a-z0-9_-]/g, "");
    const displayName = lang.displayName || rawName.charAt(0).toUpperCase() + rawName.slice(1);

    // Extract file extensions
    let extensions: string[] = [];
    if (lang.lsp?.fileExtensions && Array.isArray(lang.lsp.fileExtensions)) {
      extensions = lang.lsp.fileExtensions.map((e: string) => (e.startsWith(".") ? e : `.${e}`));
    } else if (lang.lsp?.fileExtension) {
      const ext = lang.lsp.fileExtension.startsWith(".") ? lang.lsp.fileExtension : `.${lang.lsp.fileExtension}`;
      extensions = [ext];
    } else if (lang.fileExtensions && Array.isArray(lang.fileExtensions)) {
      extensions = lang.fileExtensions.map((e: string) => (e.startsWith(".") ? e : `.${e}`));
    } else {
      extensions = [`.${id}`];
    }

    // Extract comment delimiters
    const lineComment = lang.primitives?.lineComment || "//";
    const blockComment = lang.primitives?.nestedComment || { open: "/*", close: "*/" };

    return {
      id,
      name: rawName,
      displayName,
      fileExtensions: extensions,
      primaryExtension: extensions[0] || `.${id}`,
      options: lang,
      lineComment,
      blockComment,
      icon: lang.lsp?.icons,
    };
  });
}

/**
 * Generates the package.json manifest for the unified VS Code extension.
 */
export function generatePackageJson(languages: NormalizedLanguage[], options?: ExtensionOptions): Record<string, any> {
  const isMultiLang = languages.length > 1;
  const primaryLang = languages[0] || { id: "modelscript", name: "ModelScript", displayName: "ModelScript" };

  const name = options?.name || (isMultiLang ? "modelscript-suite" : `${primaryLang.id}-lang`);
  const displayName =
    options?.displayName ||
    (isMultiLang ? "ModelScript — Polyglot Systems IDE" : `${primaryLang.displayName} for VS Code`);
  const version = options?.version || `1.0.${Math.floor(Date.now() / 1000)}`;
  const publisher = options?.publisher || "modelscript";
  const description =
    options?.description ||
    (isMultiLang
      ? "Complete multi-language modeling, diagramming, and simulation environment for VS Code."
      : `VS Code support for ${primaryLang.displayName} with syntax highlighting, diagnostics, and diagram editing.`);

  const contributesLanguages: any[] = [];
  const contributesGrammars: any[] = [];
  const customEditors: any[] = [];
  const activationEvents: string[] = [];

  for (const lang of languages) {
    activationEvents.push(`onLanguage:${lang.id}`);

    const langEntry: any = {
      id: lang.id,
      aliases: [lang.displayName, lang.name],
      extensions: lang.fileExtensions,
      configuration: `./language-configuration-${lang.id}.json`,
    };

    if (lang.icon) {
      langEntry.icon = lang.icon;
    }

    contributesLanguages.push(langEntry);

    contributesGrammars.push({
      language: lang.id,
      scopeName: `source.${lang.id}`,
      path: `./syntaxes/${lang.id}.tmLanguage.json`,
    });

    if (options?.features?.diagramEditor !== false) {
      customEditors.push({
        viewType: `${lang.id}.diagramEditor`,
        displayName: `${lang.displayName} 2D Diagram`,
        selector: lang.fileExtensions.map((ext) => ({ filenamePattern: `*${ext}` })),
        priority: "option",
      });
    }
  }

  // If STEP / 3D CAD viewer is enabled
  if (options?.features?.cad3dViewer) {
    customEditors.push({
      viewType: "modelscript.stepEditor",
      displayName: "3D CAD / STEP Viewer",
      selector: [{ filenamePattern: "*.step" }, { filenamePattern: "*.stp" }],
      priority: "option",
    });
  }

  const contributes: Record<string, any> = {
    languages: contributesLanguages,
    grammars: contributesGrammars,
    customEditors,
    commands: [
      {
        command: "modelscript.openDiagram",
        title: "ModelScript: Open Diagram",
        icon: "$(open-preview)",
      },
      {
        command: "modelscript.openDiagramSource",
        title: "ModelScript: Open Source",
        icon: "$(go-to-file)",
      },
    ],
  };

  // Add notebook controller if enabled
  if (options?.features?.notebooks) {
    contributes.notebooks = [
      {
        type: "modelscript-notebook",
        displayName: "ModelScript Notebook",
        selector: [{ filenamePattern: "*.monb" }],
        priority: "default",
      },
    ];
  }

  const manifest: Record<string, any> = {
    name,
    displayName,
    version,
    publisher,
    description,
    categories: ["Programming Languages", "Linters", "Formatters"],
    keywords: ["modelica", "sysml", "simulation", "dsl", "modeling", "wasm"],
    homepage: options?.homepage || "https://modelscript.org",
    license: "AGPL-3.0-or-later",
    engines: {
      vscode: options?.vscodeEngine || "^1.80.0",
    },
    browser: "./dist/extension.js",
    activationEvents,
    contributes,
  };

  return manifest;
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
 * Generates the unified client extension.ts TypeScript bootstrap source.
 */
export function generateExtensionBootstrap(languages: NormalizedLanguage[], options?: ExtensionOptions): string {
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

let wasmExports: any;
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

  private getHtmlForWebview(_webview: vscode.Webview, _document: vscode.TextDocument): string {
    return \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>\${this.langMeta.displayName} Diagram</title>
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
  <script>
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
      container.innerHTML = '';
      (currentDiagram.nodes || []).forEach(node => {
        const el = document.createElement('div');
        el.className = 'diagram-node';
        el.style.left = (node.x + 250) + 'px';
        el.style.top = (node.y + 200) + 'px';
        el.style.width = (node.width || 120) + 'px';
        el.style.height = (node.height || 60) + 'px';
        el.innerHTML = '<span style="font-size: 11px; opacity: 0.7;">' + (node.typeId || 'Node') + '</span><span>' + (node.label || node.id || 'Node') + '</span>';
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
      getSourceSlice: () => 0,
      emitTextEdit: () => {},
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
        await vscode.commands.executeCommand("vscode.openWith", editor.document.uri, \`\${lang.id}.diagramEditor\`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("modelscript.openDiagramSource", async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        await vscode.commands.executeCommand("vscode.openWith", editor.document.uri, "default");
      }
    })
  );
}

export function deactivate() {}
`;
}

/**
 * Generates the complete set of files for a VS Code Extension in-memory.
 * Returns a list of relative paths and string/binary contents.
 */
export function bundleExtension(
  languagesInput: (LanguageOptions | any)[] | LanguageOptions,
  options?: ExtensionOptions,
): ExtensionGeneratedFile[] {
  const rawList = Array.isArray(languagesInput) ? languagesInput : [languagesInput];
  const languages = normalizeLanguages(rawList);
  const files: ExtensionGeneratedFile[] = [];

  // 1. package.json
  const packageJson = generatePackageJson(languages, options);
  files.push({
    path: "package.json",
    content: JSON.stringify(packageJson, null, 2),
  });

  // 2. tsconfig.json
  const tsconfig = {
    compilerOptions: {
      module: "CommonJS",
      target: "ES2022",
      outDir: "out",
      lib: ["ES2022"],
      sourceMap: true,
      rootDir: "src",
      strict: true,
    },
  };
  files.push({
    path: "tsconfig.json",
    content: JSON.stringify(tsconfig, null, 2),
  });

  // 3. Language configurations & TextMate grammars for each language
  for (const lang of languages) {
    // language-configuration-<id>.json
    files.push({
      path: `language-configuration-${lang.id}.json`,
      content: generateLanguageConfiguration(lang),
    });

    // syntaxes/<id>.tmLanguage.json
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
  }

  // 4. Client bootstrap TypeScript source (src/extension.ts)
  files.push({
    path: "src/extension.ts",
    content: generateExtensionBootstrap(languages, options),
  });

  return files;
}
