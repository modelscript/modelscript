// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ActionCategory, LanguageAction, LanguageOptions } from "../../dsl/language.js";
import { generateTextMate } from "../parser/textmate.js";
import { discoverWorkspaceLanguages } from "./language-discovery.js";

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
    if (lang.extensions && Array.isArray(lang.extensions)) {
      extensions = lang.extensions.map((e: string) => (e.startsWith(".") ? e : `.${e}`));
    } else if (lang.lsp?.fileExtensions && Array.isArray(lang.lsp.fileExtensions)) {
      extensions = lang.lsp.fileExtensions.map((e: string) => (e.startsWith(".") ? e : `.${e}`));
    } else if (lang.lsp?.fileExtension) {
      const ext = lang.lsp.fileExtension.startsWith(".") ? lang.lsp.fileExtension : `.${lang.lsp.fileExtension}`;
      extensions = [ext];
    } else if (lang.fileExtensions && Array.isArray(lang.fileExtensions)) {
      extensions = lang.fileExtensions.map((e: string) => (e.startsWith(".") ? e : `.${e}`));
    } else if (id === "sysml2" || id === "sysml") {
      extensions = [".sysml", ".sysml2"];
    } else if (id === "step") {
      extensions = [".step", ".stp", ".p21"];
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
  const activationEvents: string[] = ["*", "onStartupFinished", "onFileSystem:memfs"];

  for (const lang of languages) {
    activationEvents.push(`onLanguage:${lang.id}`);

    const aliases = [lang.displayName, lang.name];
    if (lang.id === "sysml2" || lang.id === "sysml") {
      for (const a of ["SysML v2", "SysML", "sysml2", "sysml"]) {
        if (!aliases.includes(a)) aliases.push(a);
      }
    }

    const langEntry: any = {
      id: lang.id,
      aliases,
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

    if (lang.id === "sysml2") {
      activationEvents.push("onLanguage:sysml");
      contributesLanguages.push({
        id: "sysml",
        aliases: ["SysML", "sysml"],
        extensions: [".sysml"],
        configuration: `./language-configuration-sysml.json`,
      });
      contributesGrammars.push({
        language: "sysml",
        scopeName: `source.sysml`,
        path: `./syntaxes/sysml.tmLanguage.json`,
      });
    }

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

  // FEA / CalculiX Deck 3D Editor
  customEditors.push({
    viewType: "modelscript.inpEditor",
    displayName: "FEA Deck & 3D Simulation Viewer",
    selector: [{ filenamePattern: "*.inp" }, { filenamePattern: "*.inpt" }],
    priority: "option",
  });

  // CFD / SU2 Config 3D Editor
  customEditors.push({
    viewType: "modelscript.cfgEditor",
    displayName: "CFD Config & 3D Aerodynamics Viewer",
    selector: [{ filenamePattern: "*.cfg" }, { filenamePattern: "*.cfgt" }],
    priority: "option",
  });

  // SysML Requirements Matrix Custom Editor
  if (languages.some((l) => l.id === "sysml2" || l.id === "sysml")) {
    customEditors.push({
      viewType: "modelscript.requirementsEditor",
      displayName: "SysML Requirements Matrix",
      selector: [{ filenamePattern: "*.sysml" }, { filenamePattern: "*.sysml2" }],
      priority: "option",
    });
  }

  // Collect commands, menus, language model tools, and keybindings from language actions
  const commands: any[] = [
    {
      command: "modelscript.openDiagram",
      title: "ModelScript: Open Diagram",
      category: "ModelScript",
      icon: "$(open-preview)",
    },
    {
      command: "modelscript.openDiagramSource",
      title: "ModelScript: Open Source",
      category: "ModelScript",
      icon: "$(go-to-file)",
    },
    {
      command: "modelscript.generateFeaMesh",
      title: "ModelScript: Discretize CAD to FEA Mesh (.inp)",
      category: "ModelScript CAE",
    },
    {
      command: "modelscript.generateCfdMesh",
      title: "ModelScript: Discretize CAD to CFD Mesh (.su2)",
      category: "ModelScript CAE",
    },
  ];

  const editorTitleMenus: any[] = [];
  const editorContextMenus: any[] = [];
  const explorerContextMenus: any[] = [
    {
      command: "modelscript.generateFeaMesh",
      when: "resourceExtname == .step || resourceExtname == .stp",
      group: "modelscript_cae@1",
    },
    {
      command: "modelscript.generateCfdMesh",
      when: "resourceExtname == .step || resourceExtname == .stp",
      group: "modelscript_cae@2",
    },
  ];
  const commandPaletteMenus: any[] = [];
  const languageModelTools: any[] = [];
  const keybindings: any[] = [];

  // Automatically contribute diagram open/source buttons to editor/title (Method 1)
  if (options?.features?.diagramEditor !== false) {
    const diagramLangIds = new Set<string>();
    for (const lang of languages) {
      // Check if language explicitly defined its own custom diagram action (Method 2)
      const hasCustomDiagramAction = (lang.options.actions || []).some(
        (a: any) => (a.id === "open_diagram" || a.id === "diagram" || a.id === "openDiagram") && a.ui?.editorTitle,
      );
      if (!hasCustomDiagramAction) {
        diagramLangIds.add(lang.id);
        if (lang.id === "sysml2") {
          diagramLangIds.add("sysml");
        }
      }
    }

    if (diagramLangIds.size > 0) {
      const editorWhen = Array.from(diagramLangIds)
        .map((id) => `editorLangId == ${id} || resourceLangId == ${id}`)
        .join(" || ");

      editorTitleMenus.push({
        command: "modelscript.openDiagram",
        when: editorWhen,
        group: "navigation@0",
      });
    }

    const diagramViewTypes = [
      "modelscript.diagram",
      ...languages.map((l) => `${l.id}.diagramEditor`),
      ...(languages.some((l) => l.id === "sysml2") ? ["sysml.diagramEditor"] : []),
    ];
    const customEditorWhen = diagramViewTypes.map((vt) => `activeCustomEditorId == ${vt}`).join(" || ");

    editorTitleMenus.push({
      command: "modelscript.openDiagramSource",
      when: customEditorWhen,
      group: "navigation@0",
    });
  }

  const registeredToolNames = new Set<string>();

  for (const lang of languages) {
    const actions: LanguageAction[] = [...(lang.options.actions || [])];

    // Bridge mcp.tools to actions if not explicitly present
    if (lang.options.mcp?.tools) {
      for (const tool of lang.options.mcp.tools) {
        if (
          !actions.some(
            (a) => a.id === tool.name || `modelscript_${a.id}` === tool.name || `${lang.id}_${a.id}` === tool.name,
          )
        ) {
          const cleanId = tool.name.replace(new RegExp(`^${lang.id}_`), "").replace(/^modelscript_/, "");
          actions.push({
            id: cleanId,
            title: tool.description,
            description: tool.description,
            category: (tool.category === "simulation"
              ? "simulate"
              : tool.category === "transformation"
                ? "transform"
                : "query") as ActionCategory,
            inputs: tool.inputSchema as any,
            ui: {
              languageModelTool: {
                name: tool.name.startsWith("modelscript_") ? tool.name : `modelscript_${cleanId}`,
                displayName: tool.description,
                modelDescription: tool.description,
              },
            },
          });
        }
      }
    }

    for (const action of actions) {
      const commandId = `modelscript.${lang.id}.${action.id}`;
      const category = action.ui?.commandPalette?.category || lang.displayName;

      const cmdEntry: any = {
        command: commandId,
        title: action.title,
        category,
      };
      if (action.ui?.editorTitle?.icon) {
        cmdEntry.icon = action.ui.editorTitle.icon;
      }
      commands.push(cmdEntry);

      // 1. Editor title toolbar menu
      if (action.ui?.editorTitle) {
        editorTitleMenus.push({
          command: commandId,
          when: action.ui.editorTitle.when || `editorLangId == ${lang.id} || resourceLangId == ${lang.id}`,
          group: action.ui.editorTitle.group || "navigation",
        });
      }

      // 2. Editor context menu
      if (action.ui?.editorContextMenu) {
        editorContextMenus.push({
          command: commandId,
          when: action.ui.editorContextMenu.when || `editorLangId == ${lang.id} || resourceLangId == ${lang.id}`,
          group: action.ui.editorContextMenu.group || "1_modification",
        });
      }

      // 3. Explorer context menu
      if (action.ui?.explorerContextMenu) {
        const defaultWhen =
          lang.fileExtensions.length > 0
            ? lang.fileExtensions.map((ext) => `resourceExt == ${ext}`).join(" || ")
            : `resourceLangId == ${lang.id}`;
        explorerContextMenus.push({
          command: commandId,
          when: action.ui.explorerContextMenu.when || defaultWhen,
          group: action.ui.explorerContextMenu.group || "navigation",
        });
      }

      // 4. Command palette filtering
      if (action.ui?.commandPalette?.when) {
        commandPaletteMenus.push({
          command: commandId,
          when: action.ui.commandPalette.when,
        });
      }

      // 5. Keybindings
      if (action.ui?.keybinding) {
        keybindings.push({
          command: commandId,
          key: action.ui.keybinding.key,
          mac: action.ui.keybinding.mac,
          when: action.ui.keybinding.when || `editorLangId == ${lang.id}`,
        });
      }

      // 6. Language Model Tools
      const toolName = action.ui?.languageModelTool?.name || `modelscript_${action.id}`;
      if (!registeredToolNames.has(toolName)) {
        registeredToolNames.add(toolName);

        const properties: Record<string, any> = {};
        const required: string[] = [];
        if (action.inputs) {
          for (const [propName, propDef] of Object.entries(action.inputs)) {
            properties[propName] = {
              type: propDef.type,
              description: propDef.description,
              default: propDef.default,
              enum: propDef.enum,
            };
            if (propDef.required) required.push(propName);
          }
        }

        languageModelTools.push({
          name: toolName,
          displayName: action.ui?.languageModelTool?.displayName || action.title,
          modelDescription: action.ui?.languageModelTool?.modelDescription || action.description,
          inputSchema: {
            type: "object",
            properties,
            ...(required.length > 0 ? { required } : {}),
          },
        });
      }
    }
  }

  // Defensively ensure standard built-in modelscript LM tools are always contributed
  const standardLmTools = [
    {
      name: "modelscript_flatten",
      displayName: "Flatten Modelica Model to DAE",
      modelDescription: "Flattens a Modelica model or component into its lower-level DAE equation representation.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Fully qualified Modelica class name" },
        },
        required: ["name"],
      },
    },
    {
      name: "modelscript_simulate",
      displayName: "Simulate Modelica Model",
      modelDescription: "Flattens and simulates a Modelica model with initial conditions and numerical integration.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Fully qualified Modelica class name" },
          startTime: { type: "number", description: "Simulation start time in seconds" },
          stopTime: { type: "number", description: "Simulation stop time in seconds" },
          solver: { type: "string", description: "Numerical ODE solver" },
          format: { type: "string", description: "Output format ('json' or 'csv')" },
        },
        required: ["name"],
      },
    },
    {
      name: "modelscript_query",
      displayName: "Query Model Structure",
      modelDescription: "Queries semantic structure, components, parameters, and extends hierarchy.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Class or component name to query" },
        },
        required: ["name"],
      },
    },
    {
      name: "modelscript_parse",
      displayName: "Parse Modelica Source Code",
      modelDescription: "Parses Modelica code into CST/AST and returns syntax diagnostics.",
      inputSchema: {
        type: "object",
        properties: {
          code: { type: "string", description: "Modelica source code" },
        },
        required: ["code"],
      },
    },
    {
      name: "modelscript_add_component",
      displayName: "Add Component to Model",
      modelDescription: "Adds a subcomponent instance or equation to a Modelica class.",
      inputSchema: {
        type: "object",
        properties: {
          className: { type: "string", description: "Target class name" },
          classKind: { type: "string", description: "Kind of class (model, block, package, etc.)" },
        },
        required: ["className"],
      },
    },
    {
      name: "modelscript_simulate_and_plot",
      displayName: "Simulate and Plot Modelica Model",
      modelDescription: "Simulates a Modelica model and renders interactive visual plots in the simulation panel.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Modelica class name" },
        },
        required: ["name"],
      },
    },
  ];

  for (const stdTool of standardLmTools) {
    if (!registeredToolNames.has(stdTool.name)) {
      registeredToolNames.add(stdTool.name);
      languageModelTools.push(stdTool);
    }
  }

  commands.push({
    command: "modelscript.writebackParameter",
    title: "Writeback Parameter Value to Source",
    category: "ModelScript",
  });

  const contributes: Record<string, any> = {
    languages: contributesLanguages,
    grammars: contributesGrammars,
    customEditors,
    commands,
    "markdown.markdownItPlugins": true,
    "markdown.previewScripts": ["./dist/markdownPreview.js"],
    menus: {
      "editor/title": editorTitleMenus,
      "editor/context": editorContextMenus,
      "explorer/context": explorerContextMenus,
      ...(commandPaletteMenus.length > 0 ? { commandPalette: commandPaletteMenus } : {}),
    },
    languageModelTools,
    ...(keybindings.length > 0 ? { keybindings } : {}),
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

  contributes.debuggers = [
    {
      type: "modelscript",
      label: "ModelScript Simulator",
      languages: ["modelica"],
      configurationAttributes: {
        launch: {
          required: ["program"],
          properties: {
            program: {
              type: "string",
              description: "Absolute path to the Modelica source file.",
              default: "${file}",
            },
            stopOnEntry: {
              type: "boolean",
              description: "Automatically stop after launch.",
              default: true,
            },
          },
        },
      },
    },
  ];
  contributes.views = {
    explorer: [
      {
        id: "modelscript.libraryTree",
        name: "Modelica Library",
      },
      {
        id: "modelscript.mqttTree",
        name: "MQTT Participants",
      },
      {
        id: "modelscript.experimentsView",
        name: "Experiments",
      },
      {
        id: "modelscript.owl2ClassHierarchy",
        name: "OWL2 Classes",
      },
      {
        id: "modelscript.owl2PropertyHierarchy",
        name: "OWL2 Properties",
      },
    ],
    scm: [
      {
        id: "modelscript.scmTreeView",
        name: "Model Structural Changes",
      },
    ],
  };

  const manifest: Record<string, any> = {
    name,
    displayName,
    version,
    publisher,
    description,
    categories: ["Programming Languages", "Linters", "Formatters"],
    keywords: ["modelica", "sysml", "simulation", "dsl", "modeling", "wasm"],
    homepage: options?.homepage || "https://modelscript.org",
    repository: {
      type: "git",
      url: options?.repository || "https://github.com/modelscript/modelscript.git",
    },
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
      const tab = vscode.window.tabGroups?.activeTabGroup?.activeTab;
      if (tab?.input && typeof tab.input === "object" && "uri" in (tab.input as any)) {
        await vscode.commands.executeCommand("vscode.openWith", (tab.input as any).uri, "default");
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

    if (lang.id === "sysml2") {
      files.push({
        path: `language-configuration-sysml.json`,
        content: generateLanguageConfiguration(lang),
      });
      try {
        const sysmlTm = generateTextMate({ ...lang.options, name: "sysml" });
        files.push({
          path: `syntaxes/sysml.tmLanguage.json`,
          content: sysmlTm.tm || JSON.stringify({}),
        });
      } catch {
        files.push({
          path: `syntaxes/sysml.tmLanguage.json`,
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

  // 4. Client bootstrap TypeScript source (src/extension.ts)
  files.push({
    path: "src/extension.ts",
    content: generateExtensionBootstrap(languages, options),
  });

  // 5. README.md & LICENSE.md
  files.push({
    path: "README.md",
    content: `# ${packageJson.displayName || "ModelScript"}\n\n${packageJson.description || ""}\n`,
  });
  files.push({
    path: "LICENSE.md",
    content: `GNU AFFERO GENERAL PUBLIC LICENSE Version 3\n\nCopyright (C) 2026 ModelScript Contributors\n`,
  });

  return files;
}

/**
 * Builds the complete production ModelScript VS Code IDE extension to a target directory.
 */
export async function buildIdeExtension(outDir: string, options?: ExtensionOptions): Promise<void> {
  const fs = await import("fs");
  const path = await import("path");
  const esbuild = await import("esbuild");

  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(path.join(outDir, "dist"), { recursive: true });
  fs.mkdirSync(path.join(outDir, "server", "dist"), { recursive: true });

  // 1. Locate repository root and discover workspace languages
  const currentDir = path.dirname(new URL(import.meta.url).pathname);
  let repoRoot = currentDir;
  while (repoRoot !== path.dirname(repoRoot)) {
    if (fs.existsSync(path.join(repoRoot, "package.json"))) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
        if (pkg.name === "modelscript") break;
      } catch {}
    }
    repoRoot = path.dirname(repoRoot);
  }

  const languagesDir = path.join(repoRoot, "languages");
  const discovered = await discoverWorkspaceLanguages(languagesDir);
  const languages =
    discovered.languages.length > 0
      ? discovered.languages
      : normalizeLanguages([{ name: "modelica", lsp: { fileExtensions: [".mo"] } }]);

  // Write languages manifest for runtime & web worker loading
  fs.writeFileSync(
    path.join(outDir, "server", "dist", "languages-manifest.json"),
    JSON.stringify(discovered.manifest, null, 2),
    "utf-8",
  );

  // 2. Generate package.json manifest
  const pkg = generatePackageJson(languages, {
    name: "modelscript",
    displayName: "ModelScript — Modelica & Polyglot Systems IDE",
    description:
      "Complete Modelica, SysML, STEP, and OWL2 development environment — diagram editing, simulation, scripting, notebooks, and bundled MSL.",
    version: options?.version || "0.0.10",
    ...options,
    features: {
      diagramEditor: true,
      cad3dViewer: true,
      simulationPanels: true,
      notebooks: true,
      mcpBridge: true,
      chatParticipant: true,
      ...options?.features,
    },
  });

  // Set browser client entry point
  pkg.browser = "./dist/browserClientMain.js";
  fs.writeFileSync(path.join(outDir, "package.json"), JSON.stringify(pkg, null, 2), "utf-8");
  fs.writeFileSync(path.join(outDir, "package.nls.json"), "{}", "utf-8");

  // 3. Write language configs and syntaxes
  for (const lang of languages) {
    fs.writeFileSync(
      path.join(outDir, `language-configuration-${lang.id}.json`),
      generateLanguageConfiguration(lang),
      "utf-8",
    );

    const syntaxesDir = path.join(outDir, "syntaxes");
    fs.mkdirSync(syntaxesDir, { recursive: true });
    try {
      const tm = generateTextMate(lang.options);
      fs.writeFileSync(path.join(syntaxesDir, `${lang.id}.tmLanguage.json`), tm.tm, "utf-8");
    } catch {
      fs.writeFileSync(
        path.join(syntaxesDir, `${lang.id}.tmLanguage.json`),
        JSON.stringify({ name: lang.displayName, scopeName: `source.${lang.id}`, patterns: [] }, null, 2),
        "utf-8",
      );
    }

    if (lang.id === "sysml2") {
      fs.writeFileSync(
        path.join(outDir, `language-configuration-sysml.json`),
        generateLanguageConfiguration(lang),
        "utf-8",
      );
      try {
        const sysmlTm = generateTextMate({ ...lang.options, name: "sysml" });
        fs.writeFileSync(path.join(syntaxesDir, `sysml.tmLanguage.json`), sysmlTm.tm, "utf-8");
      } catch {
        fs.writeFileSync(
          path.join(syntaxesDir, `sysml.tmLanguage.json`),
          JSON.stringify({ name: "SysML", scopeName: "source.sysml", patterns: [] }, null, 2),
          "utf-8",
        );
      }
    }
  }

  // 4. Compile with esbuild
  const ideDir =
    [
      path.resolve(repoRoot, "packages/ide/src"),
      path.resolve(repoRoot, "packages/ide"),
      path.resolve(currentDir, "../../../../packages/ide/src"),
      path.resolve(currentDir, "../../../packages/ide/src"),
      path.resolve(currentDir, "../ide"),
    ].find((p) => fs.existsSync(p)) ?? path.resolve(repoRoot, "packages/ide/src");

  // Build browser client
  const clientMainPath = path.join(ideDir, "browserClientMain.ts");
  if (fs.existsSync(clientMainPath)) {
    await esbuild.build({
      entryPoints: [clientMainPath],
      outfile: path.join(outDir, "dist", "browserClientMain.js"),
      bundle: true,
      format: "cjs",
      platform: "browser",
      external: ["vscode"],
      define: {
        "process.env": JSON.stringify({}),
        "process.browser": "true",
      },
      sourcemap: "inline",
    });
  }

  // Build webviews
  const webviewEntries = [
    "webview/diagram.ts",
    "webview/simulationWebview.ts",
    "webview/cosimWebview.ts",
    "webview/chatWebview.ts",
    "webview/chatWorker.ts",
    "webview/cadWebview.tsx",
    "webview/stepWebview.tsx",
    "webview/multibodyAnimationWebview.tsx",
    "webview/analysisWebview.ts",
    "webview/calibrationWebview.tsx",
    "webview/optimizationWebview.tsx",
    "webview/uncertaintyWebview.tsx",
    "webview/markdownPreview.ts",
    "webview/surrogateWebview.tsx",
    "webview/physicsSetupWebview.tsx",
    "webview/gcodeWebview.tsx",
    "webview/feaDeckWebview.tsx",
    "webview/cfdConfigWebview.tsx",
    "webview/vrVisualizationWebview.tsx",
  ]
    .map((rel) => path.join(ideDir, rel))
    .filter((p) => fs.existsSync(p));

  if (webviewEntries.length > 0) {
    await esbuild.build({
      entryPoints: webviewEntries,
      outdir: path.join(outDir, "dist"),
      bundle: true,
      format: "iife",
      platform: "browser",
      sourcemap: "inline",
      external: ["@kitware/vtk.js", "@kitware/vtk.js/*"],
    });
  }

  // Build notebook renderer
  const notebookRendererPath = path.join(ideDir, "webview", "notebookRenderer.ts");
  if (fs.existsSync(notebookRendererPath)) {
    await esbuild.build({
      entryPoints: [notebookRendererPath],
      outfile: path.join(outDir, "dist", "notebookRenderer.js"),
      bundle: true,
      format: "esm",
      platform: "browser",
      sourcemap: "inline",
    });
  }

  // 5. Copy WASM and library assets
  // Copy discovered language WASM assets (both <lang>.wasm and legacy tree-sitter-<lang>.wasm)
  for (const asset of discovered.wasmAssets) {
    const destPath = path.join(outDir, asset.dest);
    if (fs.existsSync(asset.src)) {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.cpSync(asset.src, destPath, { recursive: true });
    }
  }

  const candidateAssets = [
    [path.join(repoRoot, "packages/runtime/build/release.wasm"), "server/dist/release.wasm"],
    [path.join(repoRoot, "node_modules/occt-import-js/dist/occt-import-js.wasm"), "server/dist/occt-import-js.wasm"],
    [
      path.join(repoRoot, "scripts/ModelicaStandardLibrary_v4.1.0.zip"),
      "server/dist/ModelicaStandardLibrary_v4.1.0.zip",
    ],
    [path.join(repoRoot, "scripts/SysML-v2-Release-2026-03.zip"), "server/dist/SysML-v2-Release-2026-03.zip"],
    [path.join(repoRoot, "packages/lsp/dist"), "server/dist"],
    [path.join(repoRoot, "languages/modelica/assets"), "assets"],
  ];

  for (const [src, dest] of candidateAssets) {
    const destPath = path.join(outDir, dest);
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.cpSync(src, destPath, { recursive: true });
    }
  }

  // 6. Bundle LSP browser server into standalone IIFE
  const lspDir = path.join(repoRoot, "packages/lsp");
  const browserServerMain = path.join(lspDir, "src/browserServerMain.ts");
  if (fs.existsSync(browserServerMain)) {
    const builtins = [
      "assert",
      "buffer",
      "child_process",
      "crypto",
      "diagnostics_channel",
      "events",
      "fs",
      "fs/promises",
      "http",
      "https",
      "module",
      "net",
      "os",
      "path",
      "process",
      "readline",
      "stream",
      "string_decoder",
      "tls",
      "url",
      "util",
      "worker_threads",
      "zlib",
      "tty",
      "esbuild",
      "assemblyscript",
      "assemblyscript/asc",
      "assemblyscript/dist/asc.js",
      "binaryen",
    ];
    const filter = new RegExp(
      `^(node:)?(?:${builtins.map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`,
    );
    const ignorePlugin = {
      name: "node-builtins-ignore",
      setup(build: any) {
        build.onResolve({ filter }, (args: any) => ({ path: args.path, namespace: "ignore" }));
        build.onLoad({ filter: /.*/, namespace: "ignore" }, () => ({ contents: "", loader: "js" }));
      },
    };

    await esbuild.build({
      entryPoints: [browserServerMain],
      outfile: path.join(outDir, "server/dist/browserServerMain.js"),
      bundle: true,
      format: "iife",
      platform: "browser",
      target: "es2022",
      minify: false,
      keepNames: true,
      sourcemap: "inline",
      define: {
        "process.env": "{}",
        "process.browser": "true",
        "import.meta.url": "''",
      },
      plugins: [ignorePlugin],
    });

    const indexerWorker = path.join(lspDir, "src/workers/indexer.worker.ts");
    if (fs.existsSync(indexerWorker)) {
      await esbuild.build({
        entryPoints: [indexerWorker],
        outfile: path.join(outDir, "server/dist/workers/indexer.worker.js"),
        bundle: true,
        format: "iife",
        platform: "browser",
        target: "es2022",
        minify: false,
        keepNames: true,
        sourcemap: "inline",
        define: {
          "process.env": "{}",
          "process.browser": "true",
          "import.meta.url": "''",
        },
        plugins: [ignorePlugin],
      });
    }
  }
}
