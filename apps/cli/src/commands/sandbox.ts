// SPDX-License-Identifier: AGPL-3.0-or-later

import { exec, execSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CommandModule } from "yargs";

interface SandboxArgs {
  entry: string;
  outdir: string;
  open: boolean;
}

export const Sandbox: CommandModule<{}, SandboxArgs> = {
  command: "sandbox [entry] [outdir]",
  describe: "Start a VS Code Web sandbox with the compiled language server",
  builder: (yargs) => {
    return yargs
      .positional("entry", {
        demandOption: false,
        description: "path to the language spec file (e.g. src/language.ts)",
        type: "string",
        default: "src/language.ts",
      })
      .positional("outdir", {
        description: "output directory",
        type: "string",
        default: "build/src-gen",
      })
      .option("open", {
        description: "Open the browser automatically",
        type: "boolean",
        default: true,
      });
  },
  handler: async (args) => {
    try {
      const entryPath = args.entry;
      const outDir = args.outdir;

      const absoluteEntry = path.resolve(process.cwd(), entryPath);
      if (!fs.existsSync(absoluteEntry)) {
        console.error(`Error: Entry file not found at ${absoluteEntry}`);
        process.exit(1);
      }

      const { createJiti } = await import("jiti");
      const jiti = createJiti(import.meta.url);
      const module = (await jiti.import(absoluteEntry)) as Record<string, unknown>;

      const languageDef = Object.values(module).find((val: unknown) => {
        const v = val as Record<string, unknown>;
        return v && v.name && v.rules;
      }) as any;

      if (!languageDef) {
        console.error("Error: Could not find a valid language export in the entry file.");
        process.exit(1);
      }

      const absoluteOutDir = path.resolve(process.cwd(), outDir);
      await startVscodeExtension(absoluteOutDir, languageDef.name, languageDef, args.open);
    } catch (err: unknown) {
      if (err instanceof Error) {
        console.error(err.stack || err.message);
      } else {
        console.error(err);
      }
      process.exit(1);
    }
  },
};
export async function startVscodeExtension(outDir: string, grammarName: string, grammarDef: any, openBrowser = false) {
  const extDir = path.join(outDir, "..", ".vscode-extension");
  const srcDir = path.join(extDir, "src");

  if (!fs.existsSync(srcDir)) {
    fs.mkdirSync(srcDir, { recursive: true });
  }

  const langId = grammarName.toLowerCase();
  const fileExt = grammarDef.lsp?.fileExtension || `.${langId}`;

  const packageJson = {
    name: `${langId}-lang`,
    publisher: "modelscript",
    version: `1.0.${Math.floor(Date.now() / 1000)}`,
    engines: {
      vscode: "^1.80.0",
    },
    browser: "./dist/extension.js",
    activationEvents: ["onLanguage:" + langId],
    contributes: {
      languages: [
        {
          id: langId,
          extensions: [fileExt],
        },
      ],
      grammars: [
        {
          language: langId,
          scopeName: "source." + langId,
          path: "./syntaxes/tmLanguage.json",
        },
      ],
    },
  };

  fs.writeFileSync(path.join(extDir, "package.json"), JSON.stringify(packageJson, null, 2), "utf-8");

  const syntaxesDir = path.join(extDir, "syntaxes");
  if (!fs.existsSync(syntaxesDir)) {
    fs.mkdirSync(syntaxesDir, { recursive: true });
  }

  try {
    // @ts-expect-error - The module might not be compiled at the time of typechecking
    const mod = await import("@modelscript/language/dist/codegen/textmate.js");
    const tm = mod.generateTextMate(grammarDef);
    fs.writeFileSync(path.join(syntaxesDir, "tmLanguage.json"), tm.tm, "utf-8");
  } catch (e) {
    try {
      const mod = await import("@modelscript/language");
      // @ts-expect-error - Type might not be fully resolved in dev environment
      const tm = mod.generateTextMate(grammarDef);
      fs.writeFileSync(path.join(syntaxesDir, "tmLanguage.json"), tm.tm, "utf-8");
    } catch (e2) {
      console.warn("Could not generate textmate grammar from @modelscript/language:", e2);
      fs.writeFileSync(path.join(syntaxesDir, "tmLanguage.json"), JSON.stringify({}), "utf-8");
    }
  }

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

  fs.writeFileSync(path.join(extDir, "tsconfig.json"), JSON.stringify(tsconfig, null, 2), "utf-8");

  const extensionCode = `
import * as vscode from 'vscode';
import { LspFacade, semanticLegend } from './lsp_api';

let wasmExports: any;
let wasmMemory: WebAssembly.Memory;
let facade: any;
let currentWasmBufferUri: string | null = null;

function getUtf8ByteLength(str: string): number {
    let s = str.length;
    for (let i=str.length-1; i>=0; i--) {
        let code = str.charCodeAt(i);
        if (code > 0x7f && code <= 0x7ff) s++;
        else if (code > 0x7ff && code <= 0xffff) s+=2;
        if (code >= 0xDC00 && code <= 0xDFFF) i--; // surrogate pair
    }
    return s;
}

function syncWasmInputBuffer(doc: vscode.TextDocument) {
    if (currentWasmBufferUri === doc.uri.toString() && uriToLastText.get(doc.uri.toString()) === doc.getText()) return;
    const text = doc.getText();
    const textPtr = wasmExports.getInputBuffer();
    const memArray = new Uint16Array(wasmMemory.buffer);
    for (let i = 0; i < text.length; i++) {
        memArray[(textPtr >> 1) + i] = text.charCodeAt(i);
    }
    if (wasmExports.lsp_setInputEncoding) wasmExports.lsp_setInputEncoding(1);
    else if (wasmExports.setInputEncoding) wasmExports.setInputEncoding(1);
    wasmExports.setInputLength(text.length * 2);
    
    currentWasmBufferUri = doc.uri.toString();
    uriToLastText.set(doc.uri.toString(), text);
}

const uriToAstRoot = new Map<string, number>();
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

// --- Phase 2: Off-Main-Thread Web Worker Proxy ---
class LspWorkerProxy {
    private worker: Worker;
    private msgId = 0;
    private callbacks = new Map<number, Function>();

    constructor(wasmUri: string) {
        const workerCode = \`
            let wasmExports;
            let wasmMemory;

            self.onmessage = async (e) => {
                const msg = e.data;
                if (msg.command === 'init') {
                    try {
                        const response = await fetch(msg.wasmUri);
                        const wasmBytes = await response.arrayBuffer();
                        wasmMemory = new WebAssembly.Memory({ initial: 4000, maximum: 16000, shared: true });
                        const env = {
                            memory: wasmMemory,
                            abort: () => console.error("WASM Abort in Worker"),
                            getSourceSlice: () => 0,
                            emitTextEdit: () => {},
                            logInt: () => {}
                        };
                        const parser = {
                            logInt: env.logInt,
                            emitTextEdit: env.emitTextEdit,
                            getSourceSlice: env.getSourceSlice,
                            "parser.logState": () => {},
                            "parser.logToken": () => {},
                            "parser.logCost": () => {}
                        };
                        const engine = {
                            debugLog: env.logInt
                        };
                        const host = {
                            runHostQuery: () => 0
                        };
                        const module = await WebAssembly.instantiate(wasmBytes, { env, parser, engine, host });
                        wasmExports = module.instance.exports;
                        wasmExports.initArena(10 * 1024 * 1024);
                        self.postMessage({ id: msg.id, success: true });
                    } catch (err) {
                        self.postMessage({ id: msg.id, success: false, error: err.toString() });
                    }
                }
            };
        \`;
        
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        this.worker = new Worker(URL.createObjectURL(blob));
        
        this.worker.onmessage = (e) => {
            const cb = this.callbacks.get(e.data.id);
            if (cb) {
                this.callbacks.delete(e.data.id);
                cb(e.data);
            }
        };
        
        this.send('init', { wasmUri });
    }
    
    private send(command: string, payload: any): Promise<any> {
        return new Promise((resolve) => {
            const id = this.msgId++;
            this.callbacks.set(id, resolve);
            this.worker.postMessage({ id, command, ...payload });
        });
    }
}

let lspWorker: LspWorkerProxy;





export async function activate(context: vscode.ExtensionContext) {
    console.log('${grammarName} Language Extension Activating...');

    const wasmUri = vscode.Uri.joinPath(context.extensionUri, 'parser.wasm');
    const wasmBytes = await vscode.workspace.fs.readFile(wasmUri);

    let pendingEdits: vscode.TextEdit[] = [];

    wasmMemory = new WebAssembly.Memory({ initial: 4000, maximum: 16000, shared: true });

    const env = {
        memory: wasmMemory,
        abort: (msgPtr: number, filePtr: number, line: number, col: number) => {
            console.error("WASM Abort at " + line + ":" + col);
        },
        getSourceSlice: (startByte: number, endByte: number) => {
            return 0; // Return AS null pointer; LSP doesn't currently rely on unparsing
        },
        emitTextEdit: (startByte: number, endByte: number, newSourcePtr: number) => {
            if (newSourcePtr === 0) return;
            const memory = new Uint32Array(wasmMemory.buffer);
            // AssemblyScript strings: length in bytes is at ptr - 4
            const strLenBytes = memory[(newSourcePtr - 4) >> 2];
            const strLen16 = strLenBytes >> 1;
            const strBuffer = new Uint16Array(wasmMemory.buffer, newSourcePtr, strLen16);
            let newText = "";
            for(let i=0; i<strLen16; i++) newText += String.fromCharCode(strBuffer[i]);
            
            if (endByte === 0xFFFFFFFF) {
                // Replace entire document
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    const lastLine = editor.document.lineCount - 1;
                    const lastChar = editor.document.lineAt(lastLine).text.length;
                    pendingEdits.push(vscode.TextEdit.replace(
                        new vscode.Range(0, 0, lastLine, lastChar),
                        newText
                    ));
                }
            } else {
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    const docText = editor.document.getText();
                    const buf = Buffer.from(docText, 'utf8');
                    const startSlice = buf.slice(0, startByte).toString('utf8');
                    const endSlice = buf.slice(0, endByte).toString('utf8');
                    
                    const startPos = editor.document.positionAt(startSlice.length);
                    const endPos = editor.document.positionAt(endSlice.length);
                    
                    pendingEdits.push(vscode.TextEdit.replace(
                        new vscode.Range(startPos, endPos),
                        newText
                    ));
                }
            }
        },
        logInt: () => {}
    };

    const wasmModule = await WebAssembly.instantiate(wasmBytes, {
        env,
        parser: {
            logInt: () => {},
            emitTextEdit: env.emitTextEdit,
            getSourceSlice: env.getSourceSlice,
            "parser.logState": () => {},
            "parser.logToken": () => {},
            "parser.logCost": () => {}
        },
        engine: {
            debugLog: () => {}
        },
        host: {
            runHostQuery: () => 0
        }
    });
    wasmExports = wasmModule.instance.exports;
    facade = new LspFacade(wasmMemory, wasmExports);
    
    // CRITICAL: Initialize the AST arena to prevent memory corruption between input buffer and AST nodes
    wasmExports.initArena(10 * 1024 * 1024);
    
    // Initialize the Phase 2 Web Worker!
    lspWorker = new LspWorkerProxy(wasmUri.toString());

    const diagnosticCollection = vscode.languages.createDiagnosticCollection('${langId}');
    context.subscriptions.push(diagnosticCollection);

    vscode.workspace.onDidOpenTextDocument(doc => {
        if (doc.languageId === '${langId}') updateDocument(doc, diagnosticCollection);
    });

    let debounceTimer: NodeJS.Timeout | undefined;
    vscode.workspace.onDidChangeTextDocument(e => {
        if (e.document.languageId === '${langId}') {
            const sortedChanges = [...e.contentChanges].sort((a, b) => b.rangeOffset - a.rangeOffset);
            updateDocumentState(e.document, sortedChanges);
            
            // Publish diagnostics immediately for the edited document to prevent diagnostic ghosting/lag
            publishDiagnostics(e.document, diagnosticCollection);
            
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                let dirtyUris = new Set<string>();
                
                if (wasmExports.dirtyFilesBitsetOffset) {
                    const offset = typeof wasmExports.dirtyFilesBitsetOffset === 'object' ? wasmExports.dirtyFilesBitsetOffset.value : wasmExports.dirtyFilesBitsetOffset;
                    const bitset = new Uint32Array(wasmMemory.buffer, offset, 32);
                    for (let fileId = 0; fileId < 1024; fileId++) {
                        let wordIdx = fileId >> 5;
                        let bitIdx = fileId & 31;
                        if ((bitset[wordIdx] & (1 << bitIdx)) !== 0) {
                            let uri = fileIdToUri.get(fileId);
                            if (uri) dirtyUris.add(uri);
                        }
                    }
                }
                
                for (const doc of vscode.workspace.textDocuments) {
                    if (doc.languageId === '${langId}' && doc.uri.toString() !== e.document.uri.toString() && dirtyUris.has(doc.uri.toString())) {
                        publishDiagnostics(doc, diagnosticCollection);
                    }
                }
            }, 150);
        }
    });

    vscode.workspace.onDidSaveTextDocument(doc => {
        if (doc.languageId === '${langId}') {
            if (debounceTimer) clearTimeout(debounceTimer);
            updateDocument(doc, diagnosticCollection);
        }
    });

    if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.languageId === '${langId}') {
        updateDocument(vscode.window.activeTextEditor.document, diagnosticCollection);
    }

    context.subscriptions.push(
        vscode.languages.registerHoverProvider('${langId}', {
            provideHover(document, position, token) {
                syncWasmInputBuffer(document);
                const astRoot = uriToAstRoot.get(document.uri.toString()) || 0;
                if (astRoot === 0 || typeof (facade as any).getHover !== 'function') return null;
                const hover = (facade as any).getHover(astRoot, document.uri.toString(), position.line, position.character);
                if (!hover || !hover.contents || !hover.contents.value) return null;
                return new vscode.Hover(hover.contents.value, new vscode.Range(
                    hover.range.start.line, hover.range.start.character,
                    hover.range.end.line, hover.range.end.character
                ));
            }
        })
    );

    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider('${langId}', {
            provideDefinition(document, position, token) {
                syncWasmInputBuffer(document);
                const astRoot = uriToAstRoot.get(document.uri.toString()) || 0;
                if (astRoot === 0 || typeof (facade as any).getDefinition !== 'function') return null;
                const def = (facade as any).getDefinition(astRoot, document.uri.toString(), position.line, position.character);
                if (!def) return null;
                return new vscode.Location(
                    vscode.Uri.parse(def.uri),
                    new vscode.Range(def.range.start.line, def.range.start.character, def.range.end.line, def.range.end.character)
                );
            }
        })
    );

    const legend = new vscode.SemanticTokensLegend(
        semanticLegend.tokenTypes,
        semanticLegend.tokenModifiers
    );
    context.subscriptions.push(
        vscode.languages.registerDocumentSemanticTokensProvider('${langId}', {
            provideDocumentSemanticTokens(document) {
                try {
                    syncWasmInputBuffer(document);
                    const astRoot = uriToAstRoot.get(document.uri.toString()) || 0;
                    if (astRoot === 0) return null;
                    const tokens = facade.getSemanticTokens(astRoot);
                    if (!tokens) return null;
                    const builder = new vscode.SemanticTokensBuilder(legend);
                    
                    for (let i = 0; i < tokens.length; i += 4) {
                        const offset = tokens[i];
                        const len = tokens[i+1];
                        const type = tokens[i+2];
                        const mod = tokens[i+3];
                        
                        const startPos = document.positionAt(offset / 2);
                        
                        // Sanity check to avoid crashing the VS Code extension host
                        const lineText = document.lineAt(startPos.line).text;
                        if (startPos.character + (len / 2) > lineText.length) {
                            continue;
                        }
                        
                        builder.push(startPos.line, startPos.character, len / 2, type, mod);
                    }
                    
                    return builder.build();
                } catch (e: any) {
                    console.error("Semantic Tokens crashed:", e, e.stack);
                    return null;
                }
            }
        }, legend)
    );

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider('${langId}', {
            provideCompletionItems(document, position, token, context) {
                syncWasmInputBuffer(document);
                const astRoot = uriToAstRoot.get(document.uri.toString()) || 0;
                if (astRoot === 0 || typeof (facade as any).getCompletions !== 'function') return null;
                const completions = (facade as any).getCompletions(astRoot, position.line, position.character);
                if (!completions) return null;
                return completions.map((c: any) => {
                    const item = new vscode.CompletionItem(c.label, c.kind);
                    return item;
                });
            }
        })
    );

    context.subscriptions.push(
        vscode.languages.registerDocumentSymbolProvider('${langId}', {
            provideDocumentSymbols(document, token) {
                syncWasmInputBuffer(document);
                const astRoot = uriToAstRoot.get(document.uri.toString()) || 0;
                if (astRoot === 0) return null;
                
                const symbols = facade.getDocumentSymbols(astRoot);
                if (!symbols) return null;
                
                const docSymbols = symbols.map((sym: any) => {
                    const range = new vscode.Range(
                        new vscode.Position(sym.start.line, sym.start.character),
                        new vscode.Position(sym.end.line, sym.end.character)
                    );
                    
                    let text = document.getText(range).trim();
                    let nameMatch = text.match(/^('[^']*'|[a-zA-Z_]\\w*)/);
                    let name = nameMatch ? nameMatch[0] : text.split('\\\\n')[0].trim();
                    if (name.length > 50) name = name.substring(0, 50) + '...';
                    
                    // Simple heuristic for SymbolKind based on name
                    let kind = vscode.SymbolKind.Class;
                    if (name.startsWith('function')) kind = vscode.SymbolKind.Function;
                    else if (name.startsWith('model')) kind = vscode.SymbolKind.Class;
                    else if (name.startsWith('record')) kind = vscode.SymbolKind.Struct;
                    else if (name.startsWith('package')) kind = vscode.SymbolKind.Package;
                    else if (name.startsWith('connector')) kind = vscode.SymbolKind.Interface;
                    else if (name.startsWith('type')) kind = vscode.SymbolKind.TypeParameter;
                    else if (name.startsWith('Integer') || name.startsWith('Real') || name.startsWith('Boolean') || name.startsWith('String')) kind = vscode.SymbolKind.Variable;
                    else kind = vscode.SymbolKind.Variable;
                    
                    return new vscode.DocumentSymbol(
                        name,
                        '',
                        kind,
                        range,
                        range
                    );
                });
                
                // Build a nested tree based on ranges
                const root: vscode.DocumentSymbol[] = [];
                const stack: vscode.DocumentSymbol[] = [];
                
                for (const sym of docSymbols) {
                    while (stack.length > 0) {
                        const parent = stack[stack.length - 1];
                        if (sym.range.start.isAfterOrEqual(parent.range.start) && sym.range.end.isBeforeOrEqual(parent.range.end)) {
                            break;
                        }
                        stack.pop();
                    }
                    
                    if (stack.length > 0) {
                        const parent = stack[stack.length - 1];
                        parent.children.push(sym);
                    } else {
                        root.push(sym);
                    }
                    
                    stack.push(sym);
                }
                
                return root;
            }
        })
    );



    console.log('${grammarName} Language Extension Activated!');
}

function updateDocumentState(doc: vscode.TextDocument, changes?: any[]) {
    try {
        const text = doc.getText();

        // Graceful fail for very large files to avoid WASM OOM and LSP crash
        if (text.length * 2 > 30 * 1024 * 1024) { // 30 MB limit
            console.warn(\`[ModelScript LSP] Document too large to parse (\\\${text.length * 2} bytes). Skipping to prevent WASM OOM.\`);
            vscode.window.showWarningMessage(\`Document too large to parse (\\\${Math.round(text.length * 2 / 1024 / 1024)}MB). LSP features disabled for this file.\`);
            uriToAstRoot.set(doc.uri.toString(), 0);
            if (wasmExports.clearDiagnostics) wasmExports.clearDiagnostics();
            return;
        }

        const textPtr = wasmExports.getInputBuffer();
        const memArray = new Uint16Array(wasmMemory.buffer);
        
        for (let i = 0; i < text.length; i++) {
            memArray[(textPtr >> 1) + i] = text.charCodeAt(i);
        }
        if (wasmExports.lsp_setInputEncoding) wasmExports.lsp_setInputEncoding(1);
        else if (wasmExports.setInputEncoding) wasmExports.setInputEncoding(1);
        wasmExports.setInputLength(text.length * 2);
        currentWasmBufferUri = doc.uri.toString();

        wasmExports.clearDiagnostics();
        if ((facade as any)._cachedLineStarts) {
            (facade as any)._cachedLineStarts = null;
        }
        
        let astRoot = uriToAstRoot.get(doc.uri.toString()) || 0;
        wasmExports.clearAstMarks(astRoot);
        if (wasmExports.clearDirtyFilesBitset) {
            wasmExports.clearDirtyFilesBitset();
        }
        
        // Ensure file ID is assigned for this document so the engine could use it
        const fileId = getFileId(doc.uri.toString());

        if (changes && astRoot !== 0 && changes.length > 0) {
            let editStart = 0xFFFFFFFF;
            let editOldEnd = 0;
            let totalShift = 0;
            
            const lastText = uriToLastText.get(doc.uri.toString()) || "";
            
            for (const change of changes) {
                const startChar = change.rangeOffset;
                const replacedCharLen = change.rangeLength;
                
                // For UTF-16, the byte offset is simply character offset * 2
                const startByte = startChar * 2;
                const replacedByteLen = replacedCharLen * 2;
                const oldEndByte = startByte + replacedByteLen;
                
                if (startByte < editStart) editStart = startByte;
                if (oldEndByte > editOldEnd) editOldEnd = oldEndByte;
                
                const insertedByteLen = change.text.length * 2;
                totalShift += (insertedByteLen - replacedByteLen);
            }
            
            let editNewEnd = editOldEnd + totalShift;
            if (wasmExports.resetGeneration) wasmExports.resetGeneration(0);
            astRoot = wasmExports.parse(astRoot, editStart, editOldEnd, editNewEnd);
            if (wasmExports.invalidateQuery) {
                // queryType 0 is PARSE. queryArg is fileId.
                // queryKey = (0 << 16) | fileId = fileId
                wasmExports.invalidateQuery(fileId);
            }
        } else {
            if (wasmExports.resetGeneration) {
                wasmExports.resetGeneration(1);
                wasmExports.resetGeneration(0);
            }
            astRoot = wasmExports.parse(0, 0, 0, 0); // initial parse or reset
        }
        uriToAstRoot.set(doc.uri.toString(), astRoot);
        uriToLastText.set(doc.uri.toString(), text);
        if (astRoot !== 0 && wasmExports.cacheNodeStrings && wasmExports.getNodePadding) {
            wasmExports.cacheNodeStrings(astRoot, wasmExports.getNodePadding(astRoot));
        }
    } catch (e: any) {
        console.error("updateDocumentState crashed fatally:", e, e.stack);
        uriToAstRoot.set(doc.uri.toString(), 0);
    }
}

function publishDiagnostics(doc: vscode.TextDocument, diagnosticCollection: vscode.DiagnosticCollection) {
    try {
        let astRoot = uriToAstRoot.get(doc.uri.toString()) || 0;
        if (astRoot === 0) return;
        const diags = facade.getDiagnostics(astRoot);
        const vsDiags = diags.map((d: any) => {
            const range = new vscode.Range(d.range.start.line, d.range.start.character, d.range.end.line, d.range.end.character);
            return new vscode.Diagnostic(range, d.message || 'Error', vscode.DiagnosticSeverity.Error);
        });

        diagnosticCollection.set(doc.uri, vsDiags);
    } catch (e: any) {
        console.error("publishDiagnostics crashed fatally:", e, e.stack);
        diagnosticCollection.clear();
    }
}

function updateDocument(doc: vscode.TextDocument, diagnosticCollection: vscode.DiagnosticCollection, changes?: any[]) {
    updateDocumentState(doc, changes);
    publishDiagnostics(doc, diagnosticCollection);
}

export function deactivate() {}
`;

  fs.writeFileSync(path.join(srcDir, "extension.ts"), extensionCode, "utf-8");

  const packageJsonPath = path.join(process.cwd(), "package.json");
  let langName = grammarName.split("/").pop() || "parser";
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      if (pkg.name) {
        langName = pkg.name.split("/").pop() || "parser";
      }
    } catch {
      // ignore
    }
  }

  const wasmPath = path.join(process.cwd(), "dist", `${langName}.wasm`);
  if (!fs.existsSync(wasmPath)) {
    console.error(`WASM not found at ${wasmPath}. Please run 'msc build' first.`);
    process.exit(1);
  }
  fs.copyFileSync(wasmPath, path.join(extDir, "parser.wasm"));

  const indexJsPath = path.join(outDir, "index.js");
  const indexDtsPath = path.join(outDir, "index.d.ts");
  if (fs.existsSync(indexJsPath)) {
    fs.copyFileSync(indexJsPath, path.join(srcDir, "lsp_api.js"));
    if (fs.existsSync(indexDtsPath)) {
      fs.copyFileSync(indexDtsPath, path.join(srcDir, "lsp_api.d.ts"));
    }
  } else {
    fs.copyFileSync(path.join(outDir, "lsp_api.ts"), path.join(srcDir, "lsp_api.ts"));
  }

  console.log(`Building VS Code extension...`);
  try {
    execSync(
      `npx esbuild src/extension.ts --bundle --outfile=dist/extension.js --external:vscode --format=cjs --platform=browser`,
      { cwd: extDir, stdio: "inherit" },
    );
  } catch (e) {
    console.error("Failed to build extension:", e);
    process.exit(1);
  }

  console.log(`Booting up @vscode/test-web...`);
  try {
    let commitArg = "";
    const sharedTestWebDir = path.join(os.homedir(), ".vscode-test-web");
    const localTestWebDir = path.join(extDir, ".vscode-test-web");

    // Migrate existing local cache to shared cache to prevent re-downloads
    if (fs.existsSync(localTestWebDir) && !fs.existsSync(sharedTestWebDir)) {
      console.log(`Migrating local cache to shared cache at ${sharedTestWebDir}...`);
      try {
        if (typeof fs.cpSync === "function") {
          fs.cpSync(localTestWebDir, sharedTestWebDir, { recursive: true });
        } else {
          fs.mkdirSync(sharedTestWebDir, { recursive: true });
          const copyRecursive = (src: string, dest: string) => {
            if (fs.existsSync(src)) {
              const stats = fs.statSync(src);
              if (stats.isDirectory()) {
                fs.mkdirSync(dest, { recursive: true });
                fs.readdirSync(src).forEach((childItemName) => {
                  copyRecursive(path.join(src, childItemName), path.join(dest, childItemName));
                });
              } else {
                fs.copyFileSync(src, dest);
              }
            }
          };
          copyRecursive(localTestWebDir, sharedTestWebDir);
        }
      } catch (e) {
        console.warn(`Failed to migrate cache: ${e}`);
      }
    }

    if (fs.existsSync(sharedTestWebDir)) {
      const dirs = fs.readdirSync(sharedTestWebDir);
      for (const d of dirs) {
        if (d.startsWith("vscode-web-insider-")) {
          const commit = d.replace("vscode-web-insider-", "");
          commitArg = `--commit ${commit}`;
          console.log(`Using locally cached VS Code Web commit: ${commit}`);
          break;
        }
      }
    }

    // Open the workspace subdirectory
    const workspaceFolder = path.resolve(outDir, "..", "..", "workspace");
    if (!fs.existsSync(workspaceFolder)) {
      fs.mkdirSync(workspaceFolder, { recursive: true });

      // Auto-generate some example files based on the language
      const exampleContent =
        langId === "calc"
          ? "/* Welcome to Calc! */\n\na = 10;\nb = 20;\nsum = a + b;\n"
          : langId === "json"
            ? '{\n  "hello": "world",\n  "status": true,\n  "count": 42\n}\n'
            : `// Sample ${langId} file\n`;
      fs.writeFileSync(path.join(workspaceFolder, `example${fileExt}`), exampleContent, "utf-8");
    }

    const args = [
      "--yes",
      "@vscode/test-web",
      "--browserType=none",
      "--coi",
      `--extensionDevelopmentPath=${extDir}`,
      `--testRunnerDataDir=${sharedTestWebDir}`,
    ];
    if (commitArg) {
      args.push("--commit");
      args.push(commitArg.replace("--commit ", ""));
    }
    args.push(workspaceFolder);

    const serverProcess = spawn("npx", args, {
      cwd: extDir,
      stdio: "inherit",
      shell: true,
    });

    if (openBrowser) {
      setTimeout(() => {
        const startCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
        exec(`${startCmd} http://localhost:3000`).on("error", () => {
          console.log("Could not open browser automatically. Please navigate to http://localhost:3000");
        });
      }, 2500);
    }

    serverProcess.on("close", (code) => {
      process.exit(code || 0);
    });
  } catch (e) {
    console.error("VS Code Web environment closed with error:", e);
  }
}
