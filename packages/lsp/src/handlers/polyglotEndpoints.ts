// SPDX-License-Identifier: AGPL-3.0-or-later

import { compileDslToWasm, CstUnparser } from "@modelscript/dsl";
import { createWasmParser } from "@modelscript/dsl/bindings";
import { PolyglotNode, PolyglotTransformer, WasmPolyglotKernelBridge } from "@modelscript/runtime";
import { GenericModelicaBridge } from "@modelscript/sysml2";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  CompletionRequest,
  DefinitionRequest,
  Diagnostic,
  DiagnosticSeverity,
  DidChangeTextDocumentNotification,
  DidOpenTextDocumentNotification,
  Disposable,
  DocumentSymbolRequest,
  FoldingRangeRequest,
  HoverRequest,
  TextDocumentSyncKind,
  type Connection,
  type TextDocuments,
} from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { globalLanguageRegistry, type LanguagePlugin } from "../registry/LanguageRegistry.js";
import {
  isIdentContCode,
  isIdentStartCode,
  readIdentAt,
  skipWs,
  stripFileExtension,
  trimOuterChars,
  trimTrailingChars,
} from "../utils/lexical-utils.js";

const require = createRequire(import.meta.url);

function findNodes(node: any, type: string, results: any[] = []): any[] {
  if (!node) return results;
  if (node.type === type) results.push(node);
  for (const c of node.children || []) findNodes(c, type, results);
  return results;
}

function hasZeroRegexCall(text: string, callee: string): boolean {
  let pos = 0;
  while (pos < text.length) {
    const idx = text.indexOf(callee, pos);
    if (idx === -1) return false;
    const prevOk = idx === 0 || !isIdentContCode(text.charCodeAt(idx - 1));
    const afterName = skipWs(text, idx + callee.length);
    if (prevOk && !isIdentContCode(text.charCodeAt(idx + callee.length)) && text[afterName] === "(") {
      return true;
    }
    pos = idx + callee.length;
  }
  return false;
}

function extractScadFallback(
  text: string,
  baseName: string,
): {
  name: string;
  kind: string;
  attributes: { name: string; type: string; value?: string | undefined }[];
  components: { name: string; typeSpecifier: string }[];
} {
  let name = baseName;
  const attributes: { name: string; type: string; value?: string | undefined }[] = [];
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("//", i)) {
      const nl = text.indexOf("\n", i + 2);
      i = nl === -1 ? text.length : nl + 1;
      continue;
    }
    if (isIdentStartCode(text.charCodeAt(i))) {
      const prevOk = i === 0 || !isIdentContCode(text.charCodeAt(i - 1));
      const tok = readIdentAt(text, i)!;
      if (prevOk && tok.token === "module") {
        const wsEnd = skipWs(text, tok.next);
        const modTok = readIdentAt(text, wsEnd);
        if (modTok && name === baseName) {
          name = modTok.token;
        }
        i = tok.next;
        continue;
      }
      if (prevOk && tok.token !== "module") {
        const eqPos = skipWs(text, tok.next);
        if (text[eqPos] === "=" && text[eqPos + 1] !== "=") {
          const semi = text.indexOf(";", eqPos + 1);
          if (semi !== -1) {
            attributes.push({ name: tok.token, type: "Real", value: text.slice(eqPos + 1, semi).trim() });
            i = semi + 1;
            continue;
          }
        }
      }
      i = tok.next;
    } else {
      i++;
    }
  }
  const components: { name: string; typeSpecifier: string }[] = [];
  if (hasZeroRegexCall(text, "cube")) components.push({ name: "cubeSolid", typeSpecifier: "CubePrimitive" });
  if (hasZeroRegexCall(text, "cylinder"))
    components.push({ name: "cylinderSolid", typeSpecifier: "CylinderPrimitive" });
  if (hasZeroRegexCall(text, "sphere")) components.push({ name: "sphereSolid", typeSpecifier: "SpherePrimitive" });
  return { name, kind: "module", attributes, components };
}

function extractOwlClassesFallback(text: string): string[] {
  const classes: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("Class(:")) {
      // handled below via Class scan
    }
    if (isIdentStartCode(text.charCodeAt(i))) {
      const prevOk = i === 0 || !isIdentContCode(text.charCodeAt(i - 1));
      const tok = readIdentAt(text, i)!;
      if (prevOk && tok.token === "Class") {
        if (text.startsWith("(:", tok.next)) {
          const id = readIdentAt(text, tok.next + 2);
          if (id && text[id.next] === ")") {
            classes.push(id.token);
            i = id.next + 1;
            continue;
          }
        } else if (text[tok.next] === ":") {
          const id = readIdentAt(text, skipWs(text, tok.next + 1));
          if (id) {
            classes.push(id.token);
            i = id.next;
            continue;
          }
        }
      }
      i = tok.next;
    } else {
      i++;
    }
  }
  return classes;
}

let scadParserInstance: any = null;
function getScadParser(): any {
  if (scadParserInstance) return scadParserInstance;
  try {
    const { createWasmParserSync } = require("@modelscript/dsl");
    const { SYNTAX_NAMES } = require("@modelscript/scad/parser");
    const wasmPath = require.resolve("@modelscript/scad/parser.wasm");
    const res = createWasmParserSync(wasmPath, { syntaxNames: SYNTAX_NAMES });
    scadParserInstance = res.parser;
    return scadParserInstance;
  } catch {
    return null;
  }
}

let owlParserInstance: any = null;
function getOwlParser(): any {
  if (owlParserInstance) return owlParserInstance;
  try {
    const { createWasmParserSync } = require("@modelscript/dsl");
    const { SYNTAX_NAMES } = require("@modelscript/owl2/parser");
    const wasmPath = require.resolve("@modelscript/owl2/parser.wasm");
    const res = createWasmParserSync(wasmPath, { syntaxNames: SYNTAX_NAMES });
    owlParserInstance = res.parser;
    return owlParserInstance;
  } catch {
    return null;
  }
}

let moParserInstance: any = null;
function getModelicaParser(): any {
  if (moParserInstance) return moParserInstance;
  try {
    const { createWasmParserSync } = require("@modelscript/dsl");
    const { SYNTAX_NAMES } = require("@modelscript/modelica/parser");
    const wasmPath = require.resolve("@modelscript/modelica/parser.wasm");
    const res = createWasmParserSync(wasmPath, { syntaxNames: SYNTAX_NAMES });
    moParserInstance = res.parser;
    return moParserInstance;
  } catch {
    return null;
  }
}

let sysmlParserInstance: any = null;
function getSysmlParser(): any {
  if (sysmlParserInstance) return sysmlParserInstance;
  try {
    const { createWasmParserSync } = require("@modelscript/dsl");
    const { SYNTAX_NAMES } = require("@modelscript/sysml2/parser");
    const wasmPath = require.resolve("@modelscript/sysml2/parser.wasm");
    const res = createWasmParserSync(wasmPath, { syntaxNames: SYNTAX_NAMES });
    sysmlParserInstance = res.parser;
    return sysmlParserInstance;
  } catch {
    return null;
  }
}

export interface RegisterLanguageRequest {
  id: string;
  name?: string | undefined;
  extensions?: string[] | undefined;
  wasmBytes?: number[] | Uint8Array | string | undefined;
  monarch?: any;
  textmate?: any;
  languageDef?: any;
}

export interface ReloadLanguageRequest {
  id: string;
  wasmBytes?: number[] | Uint8Array | string | undefined;
  monarch?: any;
  languageDef?: any;
}

export interface UnregisterLanguageRequest {
  id: string;
}

/**
 * Registers dynamic polyglot runtime management JSON-RPC endpoints on the LSP connection:
 * - `modelscript/registerLanguage`: Compiles or hot-loads a new DSL into WASM, registers capabilities.
 * - `modelscript/reloadLanguage`: Atomic hot-swap of WASM bytecode and Monarch tokens.
 * - `modelscript/unregisterLanguage`: Disposes dynamic capabilities and unloads the language.
 * - `modelscript/listLanguages`: Lists all active language plugins.
 */
export function registerPolyglotEndpoints(
  connection: Connection,
  documents: TextDocuments<TextDocument>,
  validationService: any,
  documentManager: any,
  workspaceManager?: any,
) {
  // ── 1. Register Language (Dynamic Compile / Load) ────────────────────────
  connection.onRequest("modelscript/registerLanguage", async (params: RegisterLanguageRequest) => {
    try {
      connection.console.info(`[polyglot-lsp] Registering language '${params.id}'...`);
      let wasmBytes: Uint8Array | null = null;
      let monarch = params.monarch;
      let textmate = params.textmate;
      let extensions = params.extensions || [];
      const id = params.id.toLowerCase();
      const name = params.name || params.id;

      // Case A: Compile from language definition on-the-fly
      if (params.languageDef) {
        connection.console.info(`[polyglot-lsp] Compiling language '${id}' in-memory via AssemblyScript...`);
        const compiled = await compileDslToWasm(params.languageDef, { extensions });
        wasmBytes = compiled.wasmBytes;
        if (!monarch) monarch = compiled.monarch;
        if (!textmate) textmate = compiled.textmate;
        if (extensions.length === 0) extensions = compiled.extensions;
      } else if (params.wasmBytes) {
        if (typeof params.wasmBytes === "string") {
          // Base64 string
          const binaryStr = atob(params.wasmBytes);
          const len = binaryStr.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          wasmBytes = bytes;
        } else if (Array.isArray(params.wasmBytes)) {
          wasmBytes = new Uint8Array(params.wasmBytes);
        } else if (params.wasmBytes instanceof Uint8Array) {
          wasmBytes = params.wasmBytes;
        }
      }

      if (!wasmBytes) {
        return { success: false, error: "Neither languageDef nor wasmBytes provided" };
      }

      if (extensions.length === 0) {
        extensions = [`.${id}`];
      }

      // Instantiate WASM parser and LspFacade
      const { facade, parser } = await createWasmParser(wasmBytes);

      // Create and register plugin
      const plugin: LanguagePlugin = {
        id,
        name,
        extensions,
        parser,
        facade,
        monarch,
        textmate,
        wasmBytes,
        languageDef: params.languageDef,
        handlers: params.languageDef?.lsp?.handlers,
        disposables: [],
      };

      // Register dynamic LSP capabilities with client if supported
      const documentSelector = extensions.map((ext) => ({ pattern: `**/*${ext}` }));
      const disposables: Disposable[] = [];

      try {
        const regOpen = await connection.client.register(DidOpenTextDocumentNotification.type, {
          documentSelector,
        });
        disposables.push(regOpen);
      } catch (e: any) {
        connection.console.warn(`[polyglot-lsp] dynamic register didOpen warning: ${e.message}`);
      }

      try {
        const regChange = await connection.client.register(DidChangeTextDocumentNotification.type, {
          documentSelector,
          syncKind: TextDocumentSyncKind.Full,
        });
        disposables.push(regChange);
      } catch (e: any) {
        connection.console.warn(`[polyglot-lsp] dynamic register didChange warning: ${e.message}`);
      }

      try {
        const regComp = await connection.client.register(CompletionRequest.type, {
          documentSelector,
          triggerCharacters: [".", ":", " "],
        });
        disposables.push(regComp);
      } catch {}

      try {
        const regHover = await connection.client.register(HoverRequest.type, { documentSelector });
        disposables.push(regHover);
      } catch {}

      try {
        const regDef = await connection.client.register(DefinitionRequest.type, { documentSelector });
        disposables.push(regDef);
      } catch {}

      try {
        const regSym = await connection.client.register(DocumentSymbolRequest.type, { documentSelector });
        disposables.push(regSym);
      } catch {}

      try {
        const regFold = await connection.client.register(FoldingRangeRequest.type, { documentSelector });
        disposables.push(regFold);
      } catch {}

      plugin.disposables = disposables;
      globalLanguageRegistry.register(plugin);

      // Notify client to register Monaco Monarch syntax highlighting & tokenizer
      connection.sendNotification("modelscript/languageRegistered", {
        id: plugin.id,
        name: plugin.name,
        extensions: plugin.extensions,
        monarch: plugin.monarch,
      });

      // Validate any open documents matching the newly registered extensions
      for (const doc of documents.all()) {
        if (plugin.extensions.some((ext) => doc.uri.endsWith(ext))) {
          connection.console.info(
            `[polyglot-lsp] Early-validating open document '${doc.uri}' for new language '${id}'`,
          );
          if (validationService?.validateTextDocument) {
            await validationService.validateTextDocument(doc);
          }
        }
      }

      connection.console.info(
        `[polyglot-lsp] Language '${id}' registered successfully with extensions: ${extensions.join(", ")}`,
      );
      return {
        success: true,
        id: plugin.id,
        extensions: plugin.extensions,
      };
    } catch (err: any) {
      connection.console.error(`[polyglot-lsp] Failed to register language: ${err?.message || err}`);
      return { success: false, error: err?.message || String(err) };
    }
  });

  // ── 2. Reload Language (Atomic Hot-Swap) ──────────────────────────────────
  connection.onRequest("modelscript/reloadLanguage", async (params: ReloadLanguageRequest) => {
    try {
      const id = params.id.toLowerCase();
      const existing = globalLanguageRegistry.getPluginById(id);
      if (!existing) {
        return { success: false, error: `Language '${id}' is not registered` };
      }

      connection.console.info(`[polyglot-lsp] Hot-reloading language '${id}'...`);
      let wasmBytes: Uint8Array | null = null;
      let monarch = params.monarch || existing.monarch;

      if (params.languageDef) {
        const compiled = await compileDslToWasm(params.languageDef, { extensions: existing.extensions });
        wasmBytes = compiled.wasmBytes;
        if (compiled.monarch) monarch = compiled.monarch;
      } else if (params.wasmBytes) {
        if (Array.isArray(params.wasmBytes)) {
          wasmBytes = new Uint8Array(params.wasmBytes);
        } else if (params.wasmBytes instanceof Uint8Array) {
          wasmBytes = params.wasmBytes;
        }
      } else if (existing.wasmBytes) {
        wasmBytes = existing.wasmBytes;
      }

      if (!wasmBytes) {
        return { success: false, error: "No WASM bytecode available for reload" };
      }

      // Re-instantiate WASM parser
      const { facade, parser } = await createWasmParser(wasmBytes);
      existing.parser = parser;
      existing.facade = facade;
      existing.monarch = monarch;
      existing.wasmBytes = wasmBytes;
      if (params.languageDef) {
        existing.languageDef = params.languageDef;
        existing.handlers = params.languageDef.lsp?.handlers;
      }

      // Invalidate tree caches in documentManager for this language's files
      for (const [uri] of documentManager.documentTrees) {
        if (existing.extensions.some((ext) => uri.endsWith(ext))) {
          documentManager.documentTrees.delete(uri);
        }
      }

      // Notify client of updated Monarch syntax tokens
      connection.sendNotification("modelscript/languageRegistered", {
        id: existing.id,
        name: existing.name,
        extensions: existing.extensions,
        monarch: existing.monarch,
      });

      // Re-validate all open documents of this language
      for (const doc of documents.all()) {
        if (existing.extensions.some((ext) => doc.uri.endsWith(ext))) {
          if (validationService?.validateTextDocument) {
            await validationService.validateTextDocument(doc);
          }
        }
      }

      connection.console.info(`[polyglot-lsp] Language '${id}' hot-reloaded successfully.`);
      return { success: true, id };
    } catch (err: any) {
      connection.console.error(`[polyglot-lsp] Failed to reload language: ${err?.message || err}`);
      return { success: false, error: err?.message || String(err) };
    }
  });

  // ── 3. Unregister Language ───────────────────────────────────────────────
  connection.onRequest("modelscript/unregisterLanguage", async (params: UnregisterLanguageRequest) => {
    try {
      const id = params.id.toLowerCase();
      const existing = globalLanguageRegistry.getPluginById(id);
      if (!existing) {
        return { success: false, error: `Language '${id}' is not registered` };
      }

      connection.console.info(`[polyglot-lsp] Unregistering language '${id}'...`);
      const extensions = [...existing.extensions];

      // Unregister from registry (disposes dynamic capability handles)
      await globalLanguageRegistry.unregister(id);

      // Unregister from UnifiedWorkspace if present
      if (workspaceManager?.unifiedWorkspace?.unregisterWorkspace) {
        workspaceManager.unifiedWorkspace.unregisterWorkspace(id);
      }

      // Notify client to unregister syntax tokens
      connection.sendNotification("modelscript/languageUnregistered", {
        id,
        extensions,
      });

      // Clear diagnostics for all open documents of this language
      for (const doc of documents.all()) {
        if (extensions.some((ext) => doc.uri.endsWith(ext))) {
          connection.sendDiagnostics({ uri: doc.uri, diagnostics: [] });
          documentManager.documentTrees.delete(doc.uri);
        }
      }

      connection.console.info(`[polyglot-lsp] Language '${id}' unregistered successfully.`);
      return { success: true, id, extensions };
    } catch (err: any) {
      connection.console.error(`[polyglot-lsp] Failed to unregister language: ${err?.message || err}`);
      return { success: false, error: err?.message || String(err) };
    }
  });

  // ── 4. List Registered Languages ─────────────────────────────────────────
  connection.onRequest("modelscript/listLanguages", () => {
    const plugins = globalLanguageRegistry.getAllPlugins();
    return plugins.map((p) => ({
      id: p.id,
      name: p.name,
      extensions: p.extensions,
      hasParser: !!p.parser,
      hasMonarch: !!p.monarch,
    }));
  });

  // ── 5. Project Model Cross-Domain ────────────────────────────────────────
  connection.onRequest(
    "modelscript/projectModel",
    async (params: ProjectModelRequest): Promise<ProjectModelResponse> => {
      try {
        connection.console.info(`[polyglot-lsp] Projecting model '${params.uri}' to domain '${params.targetLang}'...`);
        const doc = documents.get(params.uri);
        let text: string;
        if (doc) {
          text = doc.getText();
        } else {
          const vfs = workspaceManager?.vfs;
          if (vfs && vfs.read) {
            text = await vfs.read(params.uri);
          } else {
            return {
              success: false,
              targetLang: params.targetLang,
              correspondenceCount: 0,
              error: `Document not open or found: ${params.uri}`,
            };
          }
        }

        const ext = params.uri.slice(params.uri.lastIndexOf(".")).toLowerCase();
        let node: PolyglotNode;

        const uriParts = params.uri.split("/");
        const fileName = uriParts[uriParts.length - 1] || "Model";
        const baseName = stripFileExtension(fileName);

        if (ext === ".mo") {
          const sysmlDef = GenericModelicaBridge.parseModelicaToSysML2(text);
          node = {
            name: sysmlDef.name || baseName,
            kind: sysmlDef.kind || "model",
            isAbstract: sysmlDef.isAbstract,
            superclasses: sysmlDef.superclasses,
            attributes: sysmlDef.attributes.map((a) => ({
              name: a.name,
              type: a.type,
              value: a.defaultValue !== undefined ? String(a.defaultValue) : undefined,
            })),
            ports: sysmlDef.ports.map((p) => {
              const isPin = p.type === "Pin" || p.type.includes("Pin") || p.type.includes("ElectricalPort");
              const isFlange = p.type === "Flange" || p.type.includes("Flange");
              const isHeat = p.type === "HeatPort" || p.type.includes("Heat");
              return {
                name: p.name,
                type: p.type,
                direction: p.direction,
                isConjugated: p.isConjugated,
                ...(isPin ? { acrossVar: "v", flowVar: "i", domain: "electrical" } : {}),
                ...(isFlange ? { acrossVar: "s", flowVar: "f", domain: "translational" } : {}),
                ...(isHeat ? { acrossVar: "T", flowVar: "Q_flow", domain: "thermal" } : {}),
              };
            }),
            components: sysmlDef.parts?.map((p) => ({
              name: p.name,
              typeSpecifier: p.type,
              multiplicity: p.multiplicity,
              dimensions: p.multiplicity,
              modifications: p.attributes,
            })),
            connections: sysmlDef.connections.map((c) => ({
              source: c.source,
              target: c.target,
              kind: c.kind,
            })),
            constraints: sysmlDef.constraints,
            equations: sysmlDef.constraints,
          };
        } else if (ext === ".sysml" || ext === ".sysml2") {
          const sysmlDef = GenericModelicaBridge.parseSysML2(text);
          node = {
            name: sysmlDef.name || baseName,
            kind: sysmlDef.kind || "part def",
            isAbstract: sysmlDef.isAbstract,
            superclasses: sysmlDef.superclasses,
            attributes: sysmlDef.attributes.map((a) => ({
              name: a.name,
              type: a.type,
              value: a.defaultValue !== undefined ? String(a.defaultValue) : undefined,
            })),
            ports: sysmlDef.ports.map((p) => {
              const isPin = p.type === "Pin" || p.type.includes("Pin") || p.type.includes("ElectricalPort");
              const isFlange = p.type === "Flange" || p.type.includes("Flange");
              const isHeat = p.type === "HeatPort" || p.type.includes("Heat");
              return {
                name: p.name,
                type: p.type,
                direction: p.direction,
                isConjugated: p.isConjugated,
                ...(isPin ? { acrossVar: "v", flowVar: "i", domain: "electrical" } : {}),
                ...(isFlange ? { acrossVar: "s", flowVar: "f", domain: "translational" } : {}),
                ...(isHeat ? { acrossVar: "T", flowVar: "Q_flow", domain: "thermal" } : {}),
              };
            }),
            components: sysmlDef.parts?.map((p) => ({
              name: p.name,
              typeSpecifier: p.type,
              multiplicity: p.multiplicity,
              dimensions: p.multiplicity,
              modifications: p.attributes,
            })),
            connections: sysmlDef.connections.map((c) => ({
              source: c.source,
              target: c.target,
              kind: c.kind,
            })),
            constraints: sysmlDef.constraints,
            equations: sysmlDef.constraints,
          };
        } else if (ext === ".scad") {
          const sp = getScadParser();
          if (sp) {
            const tree = sp.parse(text);
            try {
              const root = tree.rootNode;
              const modDecls = findNodes(root, "ModuleDeclaration");
              let name = baseName;
              if (modDecls.length > 0) {
                const idNode = findNodes(modDecls[0], "IDENTIFIER")[0];
                if (idNode) name = idNode.text.trim();
              }
              const attributes: { name: string; type: string; value?: string | undefined }[] = [];
              const varDecls = findNodes(root, "VariableDeclaration");
              for (const vd of varDecls) {
                const idNode = findNodes(vd, "IDENTIFIER")[0];
                const exprNode = findNodes(vd, "Expression")[0] || findNodes(vd, "PrimaryExpression")[0];
                if (idNode && !idNode.text.startsWith("//") && idNode.text !== "module") {
                  let valStr: string;
                  if (exprNode) {
                    valStr = exprNode.text.trim();
                  } else {
                    const eqIdx = vd.text.indexOf("=");
                    const rhs = eqIdx !== -1 ? vd.text.slice(eqIdx + 1) : vd.text;
                    valStr = trimTrailingChars(rhs, "; \t\r\n").trim();
                  }
                  attributes.push({ name: idNode.text.trim(), type: "Real", value: valStr });
                }
              }
              const components: { name: string; typeSpecifier: string }[] = [];
              if (findNodes(root, "CubePrimitive").length > 0) {
                components.push({ name: "cubeSolid", typeSpecifier: "CubePrimitive" });
              }
              if (findNodes(root, "CylinderPrimitive").length > 0) {
                components.push({ name: "cylinderSolid", typeSpecifier: "CylinderPrimitive" });
              }
              if (findNodes(root, "SpherePrimitive").length > 0) {
                components.push({ name: "sphereSolid", typeSpecifier: "SpherePrimitive" });
              }
              node = { name: name || baseName, kind: "module", attributes, components };
            } finally {
              tree?.delete?.();
            }
          } else {
            node = extractScadFallback(text, baseName);
          }
        } else if (ext === ".csv") {
          const lines = text.trim().split("\n");
          const header = lines[0] ? lines[0].split(",").map((c) => c.trim()) : [];
          const attributes = header.map((h) => ({ name: h, type: "Real" }));
          node = { name: baseName, kind: "table", attributes };
        } else if (ext === ".owl" || ext === ".owl2") {
          const op = getOwlParser();
          if (op) {
            const tree = op.parse(text);
            try {
              const root = tree.rootNode;
              const decls = findNodes(root, "Declaration");
              const classes: string[] = [];
              for (const d of decls) {
                const clsNodes = findNodes(d, "Class");
                for (const cn of clsNodes) {
                  const clsName = trimOuterChars(cn.text, ":<\t \r\n", ":>\t \r\n").trim();
                  if (clsName && !classes.includes(clsName)) classes.push(clsName);
                }
              }
              if (classes.length > 0 && classes[0]) {
                node = { name: classes[0], kind: "ontology_class", superclasses: classes.slice(1) };
              } else {
                node = { name: baseName, kind: "ontology_class" };
              }
            } finally {
              tree?.delete?.();
            }
          } else {
            const classes = extractOwlClassesFallback(text);
            node = { name: classes[0] || baseName, kind: "ontology_class", superclasses: classes.slice(1) };
          }
        } else {
          node = { name: baseName };
        }

        const transformer = new PolyglotTransformer();

        if (params.options?.includeInferredFeatures) {
          for (const superCls of node.superclasses ?? []) {
            transformer.addReasonerFact("subClassOf", node.name, superCls);
          }
          for (const attr of node.attributes ?? []) {
            transformer.addReasonerFact("hasFeature", node.name, `${attr.name}:${attr.type}`);
          }
        }

        let targetSource = transformer.transform(node, params.targetLang);

        // Surgical CST Unparser synchronization if target document exists
        if (params.targetUri) {
          const existingDoc = documents.get(params.targetUri);
          let existingText: string | null = existingDoc?.getText() ?? null;
          if (existingText === null && params.targetUri.startsWith("file://")) {
            try {
              const localPath = fileURLToPath(params.targetUri);
              if (fs.existsSync(localPath)) {
                existingText = fs.readFileSync(localPath, "utf-8");
              }
            } catch {}
          }
          if (existingText && existingText.trim().length > 0) {
            let targetParser: any = null;
            if (params.targetLang === "sysml2") targetParser = getSysmlParser();
            else if (params.targetLang === "modelica") targetParser = getModelicaParser();
            if (targetParser) {
              const synced = CstUnparser.syncTargetSource(
                existingText,
                node as Parameters<typeof CstUnparser.syncTargetSource>[1],
                params.targetLang,
                targetParser,
              );
              if (synced && synced.text) {
                targetSource = synced.text;
              }
            }
          }
        }

        const correspondenceCount =
          (node.attributes?.length || 0) + (node.ports?.length || 0) + (node.components?.length || 0);

        return {
          success: true,
          targetSource,
          targetLang: params.targetLang,
          correspondenceCount,
        };
      } catch (err: any) {
        connection.console.error(`[polyglot-lsp] Project model failed: ${err?.message || err}`);
        return {
          success: false,
          targetLang: params.targetLang,
          correspondenceCount: 0,
          error: err?.message || String(err),
        };
      }
    },
  );

  const resolveCorrespondenceIndex = (uri?: string) => {
    const uw = workspaceManager?.unifiedWorkspace;
    if (!uw) return undefined;
    const directQe = uw.queryEngine;
    if (directQe && typeof directQe.getCorrespondenceIndex === "function") {
      const idx = directQe.getCorrespondenceIndex();
      if (idx) return idx;
    }
    if (typeof uw.getQueryEngine === "function") {
      const preferredLangs = uri?.endsWith(".sysml")
        ? ["sysml2", "modelica"]
        : uri?.endsWith(".mo")
          ? ["modelica", "sysml2"]
          : ["modelica", "sysml2", "step", "scad"];
      for (const lang of preferredLangs) {
        const qe = uw.getQueryEngine(lang);
        const idx = qe?.getCorrespondenceIndex?.();
        if (idx) return idx;
      }
    }
    return uw.tggCorrespondenceIndexer?.hypergraph ?? workspaceManager?.hypergraph;
  };

  // ── 6. Propagate Stale Correspondence Links ──────────────────────────────
  connection.onRequest(
    "modelscript/propagateStale",
    async (params: { uri?: string | undefined; symbolIds?: number[] | undefined; parentSlot?: number | undefined }) => {
      try {
        const corr = resolveCorrespondenceIndex(params.uri);
        let updatedCount = 0;
        if (corr) {
          const slotMap: Map<number, number> | undefined =
            workspaceManager?.unifiedWorkspace?.tggCorrespondenceIndexer?.slotMap;
          if (params.parentSlot !== undefined && typeof corr.markStaleCascading === "function") {
            updatedCount += corr.markStaleCascading(params.parentSlot);
          } else if (params.symbolIds && params.symbolIds.length > 0) {
            for (const symId of params.symbolIds) {
              if (typeof corr.markStale === "function") {
                const slot = slotMap?.get(symId) ?? symId;
                corr.markStale(slot);
                updatedCount++;
              }
            }
          } else if (params.parentSlot !== undefined && typeof corr.markStale === "function") {
            corr.markStale(params.parentSlot);
            updatedCount++;
          }
          if (typeof corr.propagateAllStale === "function") {
            updatedCount += corr.propagateAllStale();
          }
        }
        return { success: true, updatedCount };
      } catch (err: any) {
        return { success: false, error: err?.message || String(err) };
      }
    },
  );

  // ── 6b. Live DBSP Z-Set Symbol Delta Synchronization ─────────────────────
  const pluginTggRules = globalLanguageRegistry.getAllPlugins().flatMap((p) => {
    const rules = (
      p as unknown as {
        polyglot?: { rules?: NonNullable<ConstructorParameters<typeof PolyglotTransformer>[0]>["rules"] };
      }
    )?.polyglot?.rules;
    return Array.isArray(rules) ? rules : [];
  });
  const liveDeltaTransformer = new PolyglotTransformer(
    pluginTggRules.length > 0 ? { rules: pluginTggRules } : undefined,
  );
  const kernelBridge = new WasmPolyglotKernelBridge();
  const activeDeltaKeys = new Map<string, string>();

  connection.onRequest(
    "modelscript/syncSymbolDeltas",
    async (params: {
      uri?: string | undefined;
      targetLang: string;
      deltas: {
        added?: PolyglotNode[] | undefined;
        updated?: PolyglotNode[] | undefined;
        removed?: string[] | undefined;
      };
    }) => {
      try {
        const deltaPayload: { added?: PolyglotNode[]; updated?: PolyglotNode[]; removed?: string[] } = {};
        if (params.deltas?.added) deltaPayload.added = params.deltas.added;
        if (params.deltas?.updated) deltaPayload.updated = params.deltas.updated;
        if (params.deltas?.removed) deltaPayload.removed = params.deltas.removed;

        const { consolidated, syncResult: res } = kernelBridge.syncDeltas(
          liveDeltaTransformer,
          deltaPayload,
          params.targetLang,
        );
        let applied = res.applied;
        let retracted = res.retracted;
        const targets: PolyglotNode[] = [...res.targets];

        // Handle retractions tracked under composite thread keys or direct IDs
        for (const id of consolidated.removed) {
          const mappedKey = activeDeltaKeys.get(id);
          if (mappedKey && mappedKey !== id && liveDeltaTransformer.retract(mappedKey)) {
            retracted++;
          }
          activeDeltaKeys.delete(id);
        }

        // For symbol deltas without an explicit registered TGG rule match, maintain a direct Z-set correspondence thread
        const incoming = [...consolidated.added, ...consolidated.updated];
        if (targets.length < incoming.length) {
          const matchedNames = new Set(targets.map((t) => t.name));
          for (const node of incoming) {
            if (matchedNames.has(node.name)) continue;
            const symKey = String(node.id ?? node.name);
            const threadKey = symKey;
            liveDeltaTransformer.registerThread(threadKey, {
              source: node,
              [params.targetLang]: node,
            });
            activeDeltaKeys.set(symKey, threadKey);
            targets.push(node);
            applied++;
          }
        } else {
          for (const node of incoming) {
            const symKey = String(node.id ?? node.name);
            activeDeltaKeys.set(symKey, `${node.kind}:${node.name}`);
          }
        }

        const corr = resolveCorrespondenceIndex(params.uri);
        if (corr && typeof corr.propagateAllStale === "function") {
          corr.propagateAllStale();
        }
        const emitted = targets.map((tgt) => liveDeltaTransformer.transform(tgt, params.targetLang));
        return {
          success: true,
          applied,
          retracted,
          cancelledCount: consolidated.cancelledCount,
          usedWasmZSet: consolidated.usedWasmZSet,
          targets,
          targetSources: emitted,
        };
      } catch (err: any) {
        return { success: false, applied: 0, retracted: 0, targets: [], error: err?.message || String(err) };
      }
    },
  );

  // ── 7. Reconcile Correspondence Conflicts ────────────────────────────────
  connection.onRequest(
    "modelscript/reconcileConflicts",
    async (params: { strategy?: number | undefined; uri?: string | undefined }) => {
      try {
        const corr = resolveCorrespondenceIndex(params.uri);
        let resolvedCount = 0;
        if (corr && typeof corr.reconcileAll === "function") {
          resolvedCount = corr.reconcileAll(params.strategy ?? 0);
        } else if (corr && typeof corr.getAllRecords === "function" && typeof corr.resolveConflict === "function") {
          for (const rec of corr.getAllRecords()) {
            if (rec?.isConflicted && !rec?.isRemoved) {
              corr.resolveConflict(rec.slot);
              resolvedCount++;
            }
          }
        }
        if (corr && params.uri) {
          connection.sendDiagnostics({ uri: params.uri, diagnostics: [] });
        }
        return { success: true, resolvedCount };
      } catch (err: any) {
        return { success: false, error: err?.message || String(err) };
      }
    },
  );

  // ── 8. Check Correspondence Conflicts & Publish Diagnostics ─────────────
  connection.onRequest("modelscript/checkCorrespondenceConflicts", async (params: { uri?: string | undefined }) => {
    try {
      const corr = resolveCorrespondenceIndex(params.uri);
      const doc = params.uri ? documents.get(params.uri) : undefined;
      const symMap = workspaceManager?.unifiedWorkspace?.index?.symbols;
      const conflicts: { slot: number; source: number; target: number; rule: number }[] = [];
      if (corr) {
        const conflictDiags: Diagnostic[] = [];
        const pushConflict = (slot: number, srcId: number, tgtId: number, rule: number) => {
          conflicts.push({ slot, source: srcId, target: tgtId, rule });
          let range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
          const symEntry = symMap?.get?.(srcId) ?? symMap?.get?.(tgtId);
          if (doc && symEntry && typeof symEntry.startOffset === "number" && typeof symEntry.endOffset === "number") {
            range = {
              start: doc.positionAt(symEntry.startOffset),
              end: doc.positionAt(symEntry.endOffset),
            };
          }
          conflictDiags.push({
            range,
            severity: DiagnosticSeverity.Error,
            code: "CORR_FLAG_CONFLICT",
            source: "polyglot-tgg",
            message: `Cross-domain physical/parametric constraint conflict in correspondence link slot #${slot} (source #${srcId} <-> target #${tgtId}).`,
          });
        };

        if (typeof corr.getAllRecords === "function") {
          for (const rec of corr.getAllRecords()) {
            if (rec?.isConflicted && !rec?.isRemoved) {
              const nodeIds = Object.values(rec.domainNodes ?? {}) as number[];
              pushConflict(rec.slot, nodeIds[0] ?? 0, nodeIds[1] ?? 0, rec.relation ?? 0);
            }
          }
        } else {
          for (let slot = 0; slot < corr.count; slot++) {
            if (typeof corr.isConflicted === "function" && corr.isConflicted(slot) && !corr.isRemoved(slot)) {
              pushConflict(slot, corr.getSource(slot), corr.getTarget(slot), corr.getRule(slot));
            }
          }
        }
        if (params.uri) {
          connection.sendDiagnostics({ uri: params.uri, diagnostics: conflictDiags });
        }
      }
      return { success: true, count: conflicts.length, conflicts };
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) };
    }
  });
}

export interface ProjectModelRequest {
  uri: string;
  targetLang: "sysml2" | "modelica" | "owl2" | "step" | "csv" | "scad" | "json-schema";
  targetUri?: string | undefined;
  options?:
    | {
        strict?: boolean | undefined;
        includeInferredFeatures?: boolean | undefined;
      }
    | undefined;
}

export interface ProjectModelResponse {
  success: boolean;
  targetSource?: string | undefined;
  targetLang: string;
  correspondenceCount: number;
  diagnostics?: string[] | undefined;
  error?: string | undefined;
}
