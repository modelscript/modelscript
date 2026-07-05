// SPDX-License-Identifier: AGPL-3.0-or-later

import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CommandModule } from "yargs";

interface SandboxArgs {
  entry: string;
  outdir: string;
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
      startVscodeExtension(absoluteOutDir, languageDef.name, languageDef);
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
export function startVscodeExtension(outDir: string, grammarName: string, grammarDef: any) {
  const extDir = path.join(outDir, "..", ".vscode-extension");
  const srcDir = path.join(extDir, "src");

  if (!fs.existsSync(srcDir)) {
    fs.mkdirSync(srcDir, { recursive: true });
  }

  const langId = grammarName.toLowerCase();
  const fileExt = grammarDef.lsp?.fileExtension || `.${langId}`;

  const packageJson = {
    name: `${langId}-lang`,
    version: "1.0.0",
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
    },
  };

  fs.writeFileSync(path.join(extDir, "package.json"), JSON.stringify(packageJson, null, 2), "utf-8");

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
import { LspFacade } from './lsp_api';

let wasmExports: any;
let wasmMemory: WebAssembly.Memory;
let facade: any;
let currentWasmBufferUri: string | null = null;

function syncWasmInputBuffer(doc: vscode.TextDocument) {
    if (currentWasmBufferUri === doc.uri.toString() && uriToLastText.get(doc.uri.toString()) === doc.getText()) return;
    const text = doc.getText();
    const encoder = new TextEncoder();
    const encoded = encoder.encode(text);
    
    const textPtr = wasmExports.getInputBuffer();
    const memArray = new Uint8Array(wasmMemory.buffer);
    memArray.set(encoded, textPtr);
    wasmExports.setInputLength(encoded.length);
    
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
                        const env = {
                            abort: () => console.error("WASM Abort in Worker"),
                            getSourceSlice: () => 0,
                            emitTextEdit: () => {},
                            logInt: (val) => console.log('Worker WASM LOG:', val)
                        };
                        const parser = {
                            logInt: env.logInt,
                            emitTextEdit: env.emitTextEdit,
                            getSourceSlice: env.getSourceSlice,
                            "parser.logState": () => {},
                            "parser.logToken": () => {},
                            "parser.logCost": () => {}
                        };
                        const module = await WebAssembly.instantiate(wasmBytes, { env, parser });
                        wasmExports = module.instance.exports;
                        wasmMemory = wasmExports.memory;
                        wasmExports.initArena(10 * 1024 * 1024);
                        self.postMessage({ id: msg.id, success: true });
                    } catch (err) {
                        self.postMessage({ id: msg.id, success: false, error: err.toString() });
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
    
    // Initialize the IPOPT Solver asynchronously
    globalIpoptSolver.initialize(context.extensionUri);

    const wasmUri = vscode.Uri.joinPath(context.extensionUri, 'parser.wasm');
    const wasmBytes = await vscode.workspace.fs.readFile(wasmUri);

    let pendingEdits: vscode.TextEdit[] = [];

    const env = {
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
        logInt: (val: number) => { console.log('WASM LOG:', val); }
    };

    const wasmModule = await WebAssembly.instantiate(wasmBytes, {
        env,
        parser: {
            logInt: (val: number) => { console.log('WASM LOG:', val); },
            emitTextEdit: env.emitTextEdit,
            getSourceSlice: env.getSourceSlice,
            "parser.logState": () => {},
            "parser.logToken": () => {},
            "parser.logCost": () => {}
        }
    });
    wasmExports = wasmModule.instance.exports;
    wasmMemory = wasmExports.memory;
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
                if (astRoot === 0) return null;
                const hover = facade.getHover(astRoot, document.uri.toString(), position.line, position.character);
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
                if (astRoot === 0) return null;
                const def = facade.getDefinition(astRoot, document.uri.toString(), position.line, position.character);
                if (!def) return null;
                return new vscode.Location(
                    vscode.Uri.parse(def.uri),
                    new vscode.Range(def.range.start.line, def.range.start.character, def.range.end.line, def.range.end.character)
                );
            }
        })
    );

    const legend = new vscode.SemanticTokensLegend([
        'namespace', 'class', 'enum', 'interface', 'struct', 'typeParameter', 'type', 'parameter',
        'variable', 'property', 'enumMember', 'event', 'function', 'method', 'macro', 'keyword',
        'modifier', 'comment', 'string', 'number', 'regexp', 'operator'
    ], []);
    context.subscriptions.push(
        vscode.languages.registerDocumentSemanticTokensProvider('${langId}', {
            provideDocumentSemanticTokens(document) {
                try {
                    syncWasmInputBuffer(document);
                    const astRoot = uriToAstRoot.get(document.uri.toString()) || 0;
                    if (astRoot === 0) return null;
                    const tokens = facade.getSemanticTokens(astRoot);
                    if (!tokens) return null;
                    console.log("[LSP Ext] Raw WASM Tokens: " + JSON.stringify(tokens));
                    
                    const builder = new vscode.SemanticTokensBuilder(legend);
                    let currentLine = 0;
                    let currentChar = 0;
                    
                    for (let i = 0; i < tokens.length; i += 5) {
                        const deltaLine = tokens[i];
                        const deltaChar = tokens[i+1];
                        const len = tokens[i+2];
                        const type = tokens[i+3];
                        const mod = tokens[i+4];
                        
                        currentLine += deltaLine;
                        if (deltaLine > 0) {
                            currentChar = deltaChar;
                        } else {
                            currentChar += deltaChar;
                        }
                        
                        // Sanity check to avoid crashing the VS Code extension host
                        const lineText = document.lineAt(currentLine).text;
                        if (currentChar + len > lineText.length) {
                            console.error(\`Skipping invalid token at line \${currentLine}, char \${currentChar}, len \${len}. Line length is \${lineText.length}\`);
                            continue;
                        }
                        
                        const tokenText = lineText.substring(currentChar, currentChar + len);
                        console.log(\`[LSP Ext] Token at line \${currentLine}, char \${currentChar}, len \${len}, type \${type} text: "\${tokenText}"\`);
                        
                        builder.push(currentLine, currentChar, len, type, mod);
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
                if (astRoot === 0) return null;
                const completions = facade.getCompletions(astRoot, position.line, position.character);
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
                
                const symbols = facade.getDocumentSymbols(astRoot, document.uri.toString());
                if (!symbols) return null;
                
                // Convert SymbolInformation to DocumentSymbol for hierarchical outline
                // For a flat list, we can map them directly.
                return symbols.map((sym: any) => {
                    const range = new vscode.Range(
                        new vscode.Position(sym.location.range.start.line, sym.location.range.start.character),
                        new vscode.Position(sym.location.range.end.line, sym.location.range.end.character)
                    );
                    return new vscode.DocumentSymbol(
                        sym.name,
                        '',
                        sym.kind,
                        range,
                        range
                    );
                });
            }
        })
    );



    console.log('${grammarName} Language Extension Activated!');
}

function updateDocumentState(doc: vscode.TextDocument, changes?: any[]) {
    try {
        const text = doc.getText();
        const encoder = new TextEncoder();
        const encoded = encoder.encode(text);

        // Graceful fail for very large files to avoid WASM OOM and LSP crash
        if (encoded.length > 30 * 1024 * 1024) { // 30 MB limit
            console.warn(\`[ModelScript LSP] Document too large to parse (\\\${encoded.length} bytes). Skipping to prevent WASM OOM.\`);
            vscode.window.showWarningMessage(\`Document too large to parse (\\\${Math.round(encoded.length / 1024 / 1024)}MB). LSP features disabled for this file.\`);
            uriToAstRoot.set(doc.uri.toString(), 0);
            if (wasmExports.clearDiagnostics) wasmExports.clearDiagnostics();
            return;
        }

        const textPtr = wasmExports.getInputBuffer();
        const memArray = new Uint8Array(wasmMemory.buffer);
        
        memArray.set(encoded, textPtr);
        wasmExports.setInputLength(encoded.length);
        currentWasmBufferUri = doc.uri.toString();

        wasmExports.clearDiagnostics();
        
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
                const prefixChar = lastText.substring(0, startChar);
                const startByte = encoder.encode(prefixChar).length;
                
                const replacedChar = lastText.substring(startChar, startChar + change.rangeLength);
                const replacedByteLen = encoder.encode(replacedChar).length;
                const oldEndByte = startByte + replacedByteLen;
                
                if (startByte < editStart) editStart = startByte;
                if (oldEndByte > editOldEnd) editOldEnd = oldEndByte;
                
                const insertedByteLen = encoder.encode(change.text).length;
                totalShift += (insertedByteLen - replacedByteLen);
            }
            
            let editNewEnd = editOldEnd + totalShift;
            if (wasmExports.resetGeneration) wasmExports.resetGeneration(0);
            console.log("[LSP Ext] Calling parse with:", { astRoot, editStart, editOldEnd, editNewEnd });
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

  const langName = grammarName.split("/").pop() || "parser";
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
    }
    execSync(
      `npx --yes @vscode/test-web --browserType=none --testRunnerDataDir="${sharedTestWebDir}" --extensionDevelopmentPath=. ${commitArg} ${workspaceFolder}`,
      { cwd: extDir, stdio: "inherit" },
    );
  } catch (e) {
    console.error("VS Code Web environment closed with error:", e);
  }
}
