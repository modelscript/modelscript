import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CommandModule } from "yargs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const Playground: CommandModule = {
  command: "playground",
  describe: "Launch the dual-editor DSL workbench",
  handler: async () => {
    const port = 3000;

    const server = createServer(async (req, res) => {
      const urlPath = req.url?.split("?")[0] || "/";
      const headers = { "Content-Type": "text/plain", "Cache-Control": "no-store" };
      if (urlPath === "/") {
        headers["Content-Type"] = "text/html";
        res.writeHead(200, headers);

        const dslPath = join(__dirname, "../../../../packages/language/src/dsl.ts");
        let dslLibStr = "";
        if (existsSync(dslPath)) {
          dslLibStr = readFileSync(dslPath, "utf-8").replace(/^export\s+/gm, "");
        }
        res.end(getIndexHtml(dslLibStr));
      } else if (urlPath === "/worker-compiler.js") {
        headers["Content-Type"] = "application/javascript";
        res.writeHead(200, headers);
        res.end(getCompilerWorkerJs());
      } else if (urlPath === "/worker-lsp.js") {
        headers["Content-Type"] = "application/javascript";
        res.writeHead(200, headers);
        res.end(getLspWorkerJs());
      } else if (urlPath === "/browser.js") {
        headers["Content-Type"] = "application/javascript";
        res.writeHead(200, headers);
        const browserJsPath = join(__dirname, "../../../../packages/language/dist/browser.js");
        if (existsSync(browserJsPath)) {
          let content = readFileSync(browserJsPath, "utf-8");
          content = content.replace(
            /import\s*\*\s*as\s*([a-zA-Z0-9_]+)\s*from\s*["']typescript["']/g,
            'import $1 from "/typescript.mjs"',
          );
          // Fallback if there's any other "typescript" imports left
          content = content.replace(/from\s*["']typescript["']/g, 'from "/typescript.mjs"');
          res.end(content);
        } else {
          res.end("");
        }
      } else if (urlPath === "/typescript.mjs") {
        headers["Content-Type"] = "application/javascript";
        res.writeHead(200, headers);
        const tsJsPath = join(__dirname, "../../../../packages/language/dist/typescript.mjs");
        res.end(existsSync(tsJsPath) ? readFileSync(tsJsPath) : "");
      } else if (urlPath?.startsWith("/node_modules/")) {
        const rootNodeModules = join(__dirname, "../../../../node_modules");
        const cliNodeModules = join(__dirname, "../../node_modules");
        let filePath = join(cliNodeModules, urlPath.slice(14));
        if (!existsSync(filePath)) {
          filePath = join(rootNodeModules, urlPath.slice(14));
        }

        const ext = urlPath.split(".").pop()?.toLowerCase();
        const mimeTypes: Record<string, string> = {
          js: "application/javascript",
          html: "text/html",
          css: "text/css",
          wasm: "application/wasm",
          ttf: "font/ttf",
        };
        headers["Content-Type"] = ext && mimeTypes[ext] ? mimeTypes[ext] : "text/plain";
        res.writeHead(200, headers);
        if (existsSync(filePath)) {
          if (urlPath.endsWith(".js") && urlPath.includes("assemblyscript/dist/")) {
            let content = readFileSync(filePath, "utf-8");
            content = content.replace(/from\s*["']binaryen["']/g, 'from "/node_modules/binaryen/index.js"');
            content = content.replace(/from\s*["']long["']/g, 'from "/node_modules/long/index.js"');
            content = content.replace(
              /from\s*["']assemblyscript["']/g,
              'from "/node_modules/assemblyscript/dist/assemblyscript.js"',
            );
            res.end(content);
          } else {
            res.end(readFileSync(filePath));
          }
        } else {
          res.end("");
        }
      } else if (urlPath === "/asc.js") {
        // Map top-level /asc.js to the node_modules path so it goes through our interceptor above
        res.writeHead(302, { Location: "/node_modules/assemblyscript/dist/asc.js" });
        res.end();
      } else if (urlPath === "/favicon.ico") {
        const faviconPath = join(__dirname, "../../../../apps/morsel/public/favicon.ico");
        if (existsSync(faviconPath)) {
          res.writeHead(200, { "Content-Type": "image/x-icon" });
          res.end(readFileSync(faviconPath));
        } else {
          res.writeHead(404);
          res.end();
        }
      } else if (urlPath === "/logo.png") {
        const logoPath = join(__dirname, "../../../../apps/web/public/ms-logo.png");
        if (existsSync(logoPath)) {
          res.writeHead(200, { "Content-Type": "image/png" });
          res.end(readFileSync(logoPath));
        } else {
          res.writeHead(404);
          res.end();
        }
      } else if (urlPath === "/logo-light.png") {
        const logoPath = join(__dirname, "../../../../apps/web/public/ms-logo-light.png");
        if (existsSync(logoPath)) {
          res.writeHead(200, { "Content-Type": "image/png" });
          res.end(readFileSync(logoPath));
        } else {
          res.writeHead(404);
          res.end();
        }
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    server.listen(port, () => {
      const url = `http://localhost:${port}`;
      console.log(`Playground running at ${url}`);

      const startCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
      import("node:child_process").then(({ exec }) => {
        exec(`${startCmd} ${url}`).on("error", () => {
          console.log(`Could not automatically open browser. Please navigate to ${url}`);
        });
      });
    });
  },
};

function getIndexHtml(dslLibStr = "") {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>ModelScript Playground</title>
    <link rel="icon" type="image/x-icon" href="/favicon.ico">
    <style>
        :root {
            --bg-color: #f6f8fa;
            --border-color: #d0d7de;
            --text-color: #24292f;
            --btn-bg: #2da44e;
            --btn-hover: #2c974b;
            --btn-text: #ffffff;
            --toolbar-bg: #ffffff;
        }
        @media (prefers-color-scheme: dark) {
            :root {
                --bg-color: #0d1117;
                --border-color: #30363d;
                --text-color: #c9d1d9;
                --btn-bg: #238636;
                --btn-hover: #2ea043;
                --btn-text: #ffffff;
                --toolbar-bg: #161b22;
            }
        }
        body { margin: 0; padding: 0; display: flex; flex-direction: column; height: 100vh; font-family: -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji"; background: var(--bg-color); color: var(--text-color); }
        #toolbar { padding: 12px 16px; background: var(--toolbar-bg); border-bottom: 1px solid var(--border-color); display: flex; align-items: center; gap: 16px; }
        #editors { display: flex; flex: 1; height: 100%; min-height: 0; min-width: 0; }
        #dsl-editor { flex: 1; border-right: 1px solid var(--border-color); min-width: 0; min-height: 0; }
        #right-pane { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
        #code-editor { flex: 1; border-bottom: 1px solid var(--border-color); min-width: 0; min-height: 0; }
        #react-ast-root { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
        #ast-viewer { flex: 1; overflow: auto; padding: 10px; font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace; white-space: pre; font-size: 12px; min-height: 0; }
        
        .ghost-node { opacity: 0.6; color: #d73a49; font-style: italic; }
        .ghost-node::after { content: " (inserted)"; font-size: 10px; }
        
        .primer-btn {
            background-color: var(--btn-bg);
            color: var(--btn-text);
            border: 1px solid rgba(240,246,252,0.1);
            border-radius: 6px;
            padding: 5px 16px;
            font-size: 14px;
            font-weight: 500;
            line-height: 20px;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            transition: 80ms cubic-bezier(0.33, 1, 0.68, 1);
            transition-property: color,background-color,box-shadow,border-color;
        }
        .primer-btn:hover { background-color: var(--btn-hover); }
        
        .brand-container {
            display: flex;
            align-items: center;
            gap: 10px;
            font-weight: 600;
            font-size: 16px;
            margin-right: auto;
        }
        .brand-icon {
            width: 24px;
            height: 24px;
            background-image: url('/logo.png');
            background-size: contain;
            background-repeat: no-repeat;
            background-position: center;
        }
        @media (prefers-color-scheme: dark) {
            .brand-icon {
                background-image: url('/logo-light.png');
            }
        }
    </style>
    <!-- React and Babel -->
    <script crossorigin src="/node_modules/react/umd/react.development.js"></script>
    <script crossorigin src="/node_modules/react-dom/umd/react-dom.development.js"></script>
    <script src="/node_modules/@babel/standalone/babel.min.js"></script>
    <!-- Load Monaco Editor Locally -->
    <script src="/node_modules/monaco-editor/min/vs/loader.js"></script>
    <script type="module">
        window.highlightNode = function(startLine, startCol, endLine, endCol) {
            if (window.codeEditor) {
                const range = new monaco.Range(startLine + 1, startCol + 1, endLine + 1, endCol + 1);
                window.codeEditor.setSelection(range);
                window.codeEditor.revealRangeInCenter(range);
                window.codeEditor.focus();
            }
        };

        window.MonacoEnvironment = {
            getWorkerUrl: function(workerId, label) {
                return \`data:text/javascript;charset=utf-8,\${encodeURIComponent("self.MonacoEnvironment = { baseUrl: '/node_modules/monaco-editor/min/' }; importScripts('/node_modules/monaco-editor/min/vs/base/worker/workerMain.js');")}\`;
            }
        };
        
        require.config({ paths: { 'vs': '/node_modules/monaco-editor/min/vs' }});
        require(['vs/editor/editor.main'], function() {
            const dslLibStrRaw = \`${dslLibStr.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$")}\`;
            const dslLib = [
                "export {};",
                "declare global {",
                dslLibStrRaw,
                "}"
            ].join("\\n");
            
            monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
                target: monaco.languages.typescript.ScriptTarget.ESNext,
                allowNonTsExtensions: true,
                moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
                module: monaco.languages.typescript.ModuleKind.CommonJS,
                strict: true,
                noEmit: true
            });
            monaco.languages.typescript.typescriptDefaults.addExtraLib(dslLib, 'ts:filename/dsl.d.ts');

            const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
            const editorTheme = prefersDark ? 'vs-dark' : 'vs';

            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
                monaco.editor.setTheme(e.matches ? 'vs-dark' : 'vs');
            });

            const exampleDSL = \`export default language({
  name: 'MyLang',
  rules: {
    Program: $ => repeat($.Block),
    Block: $ => seq('scope', '{', repeat(choice($.Decl, $.Usage)), '}'),
    Decl: $ => seq('let', field('name', $.Identifier), '=', $.Number, ';'),
    Usage: $ => seq('print', field('target', $.Identifier), ';'),
    Identifier: $ => /[a-zA-Z_][a-zA-Z0-9_]*/,
    Number: $ => /[0-9]+/
  },
  extras: $ => [/\\\\s/],
  lsp: {
    folding: ['Block'],
    outline: ['Decl'],
    definition: (db, node, $) => {
        let type = db.ast.getType(node);
        if (type == $.Identifier) {
           return db.runQuery("resolveVar", node);
        }
        return 0;
    }
  },
  queries: {
      resolveVar: (db, node, $) => {
          let root = db.ast.getRootNode();
          let targetHash = db.ast.hashSpan(db.ast.getTextSpan(node));
          return db.runQuery("searchHash", root, targetHash);
      },
      searchHash: (db, node, targetHash, $) => {
          if (db.ast.getType(node) == $.Decl) {
              let nameNode = db.ast.getChildByFieldId(node, 'name');
              if (db.ast.hashSpan(db.ast.getTextSpan(nameNode)) == targetHash) {
                  return nameNode; // Found definition!
              }
          }
          let child = db.ast.getFirstChild(node);
          while (child != 0) {
              let result = db.runQuery("searchHash", child, targetHash);
              if (result != 0) return result;
              child = db.ast.getNextSibling(child);
          }
          return 0;
      }
  }
});\`;

            const exampleCode = \`scope {
  let velocity = 100;
  let mass = 50;
  
  print velocity;
}

scope {
  let gravity = 9;
  
  print mass;
  print gravity;
}\`;

            let latestUri = 'inmemory://example.mo';
            window.dslEditor = monaco.editor.create(document.getElementById('dsl-editor'), {
                value: exampleDSL,
                language: 'typescript',
                theme: editorTheme,
                minimap: { enabled: false }
            });
            window.codeEditor = monaco.editor.create(document.getElementById('code-editor'), {
                value: exampleCode,
                language: 'plaintext',
                theme: editorTheme,
                minimap: { enabled: false }
            });

            window.addEventListener('resize', () => {
                window.dslEditor.layout();
                window.codeEditor.layout();
            });

            const cacheBuster = Date.now();
            const compilerWorker = new Worker('/worker-compiler.js?v=' + cacheBuster, { type: 'module' });
            compilerWorker.onerror = (e) => {
                console.error("Compiler Worker Error:", e);
                document.getElementById('status').innerText = "Compiler Worker Error: " + e.message;
            };

            const lspWorker = new Worker('/worker-lsp.js?v=' + cacheBuster, { type: 'module' });
            lspWorker.onerror = (e) => {
                console.error("LSP Worker Error:", e);
            };

            document.getElementById('compile-btn').onclick = () => {
                document.getElementById('status').innerText = "Compiling DSL in browser...";
                const dsl = window.dslEditor.getValue();
                compilerWorker.postMessage({ type: 'compile', dsl });
            };
            
            compilerWorker.onmessage = (e) => {
                if (e.data.type === 'progress') {
                    document.getElementById('status').innerText = e.data.message;
                } else if (e.data.type === 'success') {
                    const kb = (e.data.wasm.byteLength / 1024).toFixed(1);
                    document.getElementById('status').innerText = "Compiled successfully! LSP is active. (WASM: " + kb + " KB)";
                    window.syntaxNames = e.data.syntaxNames;
                    lspWorker.postMessage({ 
                        type: 'init', 
                        wasm: e.data.wasm, 
                        jsWrapper: e.data.jsWrapper,
                        syntaxNames: e.data.syntaxNames,
                        langName: e.data.langName,
                        initialText: window.codeEditor ? window.codeEditor.getValue() : null
                    });
                } else if (e.data.type === 'error') {
                    document.getElementById('status').innerText = "Error: " + e.data.error;
                }
            };

            let msgId = 0;
            const pending = new Map();
            class SimpleMonacoLanguageClient {
                constructor(worker, editor) {
                    this.worker = worker;
                    this.editor = editor;
                    this.model = editor.getModel();
                    
                    this.worker.addEventListener('message', (e) => this.handleMessage(e.data));
                    this.model.onDidChangeContent((e) => this.syncDocument('textDocument/didChange', e.changes));
                    
                    // Initialize
                    this.sendRequest('initialize', {
                        capabilities: {}
                    }).then(() => {
                        this.sendNotification('initialized', {});
                        this.syncDocument('textDocument/didOpen', [{ text: this.model.getValue() }]);
                    });
                }
                
                syncDocument(method = 'textDocument/didChange', contentChanges = []) {
                    this.sendNotification(method, {
                        textDocument: {
                            uri: this.model.uri.toString(),
                            version: this.model.getVersionId(),
                            text: method === 'textDocument/didOpen' ? this.model.getValue() : undefined,
                            languageId: 'plaintext'
                        },
                        contentChanges: contentChanges
                    });
                }
                
                sendRequest(method, params) {
                    return new Promise((resolve, reject) => {
                        const id = ++msgId;
                        pending.set(id, { resolve, reject });
                        this.worker.postMessage({ jsonrpc: '2.0', id, method, params });
                    });
                }
                
                sendNotification(method, params) {
                    this.worker.postMessage({ jsonrpc: '2.0', method, params });
                }
                
                handleMessage(msg) {
                    if (msg.id !== undefined && pending.has(msg.id)) {
                        const { resolve, reject } = pending.get(msg.id);
                        pending.delete(msg.id);
                        if (msg.error) reject(msg.error);
                        else resolve(msg.result);
                    } else if (msg.method === 'textDocument/publishDiagnostics') {
                        const markers = msg.params.diagnostics.map(d => ({
                            severity: d.severity === 1 ? monaco.MarkerSeverity.Error 
                                    : d.severity === 2 ? monaco.MarkerSeverity.Warning
                                    : d.severity === 3 ? monaco.MarkerSeverity.Info
                                    : monaco.MarkerSeverity.Hint,
                            startLineNumber: d.range.start.line + 1,
                            startColumn: d.range.start.character + 1,
                            endLineNumber: d.range.end.line + 1,
                            endColumn: d.range.end.character + 1,
                            message: d.message,
                            code: d.code ? String(d.code) : undefined,
                            source: d.source
                        }));
                        console.log("Client received diagnostics:", markers);
                        monaco.editor.setModelMarkers(this.model, 'dsl-lsp', markers);
                    } else if (msg.type === 'statusUpdate') {
                        document.getElementById('status').innerText = msg.message;
                    } else if (msg.type === 'astPatch' || msg.type === 'astPatchBinary') {
                        window.postMessage(msg, '*');
                    }
                }
            }
            
            // Start the client
            const languageClient = new SimpleMonacoLanguageClient(lspWorker, window.codeEditor);

            monaco.languages.registerDefinitionProvider('plaintext', {
                provideDefinition: async (model, position, token) => {
                    const result = await languageClient.sendRequest('textDocument/definition', {
                        textDocument: { uri: model.uri.toString() },
                        position: { line: position.lineNumber - 1, character: position.column - 1 }
                    });
                    if (result && result.range) {
                        return {
                            uri: model.uri,
                            range: new monaco.Range(
                                result.range.start.line + 1,
                                result.range.start.character + 1,
                                result.range.end.line + 1,
                                result.range.end.character + 1
                            )
                        };
                    }
                    return null;
                }
            });

            monaco.languages.registerReferenceProvider('plaintext', {
                provideReferences: async (model, position, context, token) => {
                    const result = await languageClient.sendRequest('textDocument/references', {
                        textDocument: { uri: model.uri.toString() },
                        position: { line: position.lineNumber - 1, character: position.column - 1 }
                    });
                    if (result && result.length > 0) {
                        return result.map(loc => ({
                            uri: model.uri,
                            range: new monaco.Range(
                                loc.range.start.line + 1,
                                loc.range.start.character + 1,
                                loc.range.end.line + 1,
                                loc.range.end.character + 1
                            )
                        }));
                    }
                    return null;
                }
            });

            monaco.languages.registerFoldingRangeProvider('plaintext', {
                provideFoldingRanges: async (model, context, token) => {
                    const result = await languageClient.sendRequest('textDocument/foldingRange', {
                        textDocument: { uri: model.uri.toString() }
                    });
                    if (result && result.length > 0) {
                        return result.map(f => ({
                            start: f.startLine + 1,
                            end: f.endLine + 1,
                            kind: monaco.languages.FoldingRangeKind.Region
                        }));
                    }
                    return null;
                }
            });

            monaco.languages.registerDocumentSymbolProvider('plaintext', {
                provideDocumentSymbols: async (model, token) => {
                    const result = await languageClient.sendRequest('textDocument/documentSymbol', {
                        textDocument: { uri: model.uri.toString() }
                    });
                    if (result && result.length > 0) {
                        return result.map(s => ({
                            name: s.name,
                            detail: s.detail || '',
                            kind: s.kind || monaco.languages.SymbolKind.Class,
                            range: new monaco.Range(s.range.start.line + 1, s.range.start.character + 1, s.range.end.line + 1, s.range.end.character + 1),
                            selectionRange: new monaco.Range(s.selectionRange.start.line + 1, s.selectionRange.start.character + 1, s.selectionRange.end.line + 1, s.selectionRange.end.character + 1),
                            tags: []
                        }));
                    }
                    return null;
                }
            });

            monaco.languages.registerRenameProvider('plaintext', {
                provideRenameEdits: async (model, position, newName, token) => {
                    const result = await languageClient.sendRequest('textDocument/rename', {
                        textDocument: { uri: model.uri.toString() },
                        position: { line: position.lineNumber - 1, character: position.column - 1 },
                        newName: newName
                    });
                    
                    if (result && result.changes) {
                        const edits = [];
                        for (const uri in result.changes) {
                            for (const change of result.changes[uri]) {
                                edits.push({
                                    resource: monaco.Uri.parse(uri),
                                    textEdit: {
                                        range: new monaco.Range(
                                            change.range.start.line + 1,
                                            change.range.start.character + 1,
                                            change.range.end.line + 1,
                                            change.range.end.character + 1
                                        ),
                                        text: change.newText
                                    },
                                    versionId: undefined
                                });
                            }
                        }
                        return { edits };
                    }
                    return null;
                }
            });
        });
    </script>

    <script type="text/babel">
        // React AST Viewer Component
        const { useState, useEffect, useRef, useMemo, useCallback } = React;

        function AstViewer() {
            const [rootId, setRootId] = useState(0);
            const [updateTick, setUpdateTick] = useState(0);
            const [status, setStatus] = useState("(Waiting for compile...)");
            const [renderLimit, setRenderLimit] = useState(150);
            const [diagnostics, setDiagnostics] = useState([]);
            const nodeMap = useRef(new Map());

            const [currentGeneration, setCurrentGeneration] = useState(0);

            const [lineStarts, setLineStarts] = useState([0]);

            useEffect(() => {
                const handleMessage = (e) => {
                    const msg = e.data;
                    if (msg.type === 'astPatchBinary') {
                        if (msg.generationId !== undefined && msg.generationId !== currentGeneration) {
                            nodeMap.current.clear();
                            setCurrentGeneration(msg.generationId);
                        }

                        let hasUpdates = false;
                        if (msg.buffer && msg.buffer.byteLength > 0) {
                            const ints = new Int32Array(msg.buffer);
                            let i = 0;
                            while (i < ints.length) {
                                const op = ints[i++];
                                const ptr = ints[i++];
                                const typeId = ints[i++];
                                const oldPtr = ints[i++];
                                const pad = ints[i++];
                                const len = ints[i++];
                                const childCount = ints[i++];
                                
                                const children = [];
                                for (let c = 0; c < childCount; c++) {
                                    children.push(ints[i++]);
                                }

                                const typeName = typeId === 65535 ? "ERROR" : (window.syntaxNames ? window.syntaxNames[typeId] : "UNKNOWN");
                                
                                if (op === 1) { // INSERT
                                    nodeMap.current.set(ptr, { id: ptr, typeId, typeName, pad, len, children });
                                    hasUpdates = true;
                                } else if (op === 3) { // DELETE
                                    nodeMap.current.delete(ptr);
                                    hasUpdates = true;
                                } else if (op === 2) { // UPDATE
                                    const oldNode = nodeMap.current.get(oldPtr);
                                    nodeMap.current.set(ptr, { ...oldNode, id: ptr, typeId, typeName, pad, len, children });
                                    nodeMap.current.delete(oldPtr);
                                    hasUpdates = true;
                                }
                            }
                        }
                        
                        if (hasUpdates || msg.rootId !== rootId) {
                            setRootId(msg.rootId);
                            setUpdateTick(t => t + 1);
                        }
                        
                        if (msg.lineStarts) {
                            setLineStarts(msg.lineStarts);
                        }
                        
                        if (msg.diagnostics) {
                            setDiagnostics(msg.diagnostics);
                        }
                    } else if (msg.type === 'statusUpdate') {
                        setStatus(msg.message);
                    }
                };
                window.addEventListener('message', handleMessage);
                return () => window.removeEventListener('message', handleMessage);
            }, [rootId, currentGeneration]);

            const handleScroll = (e) => {
                const target = e.target;
                if (target.scrollTop + target.clientHeight >= target.scrollHeight - 200) {
                    setRenderLimit(prev => prev + 150);
                }
            };

            const flatNodes = useMemo(() => {
                const nodes = [];
                const visited = new Set();
                
                const flatten = (ptr, depth, parentOffset) => {
                    if (nodes.length >= 5000) return parentOffset;
                    if (visited.has(ptr)) {
                        nodes.push({ id: ptr + '_cycle', typeName: 'CYCLE', depth, isCycle: true });
                        return parentOffset;
                    }
                    visited.add(ptr);
                    
                    const node = nodeMap.current.get(ptr);
                    if (!node) return parentOffset;
                    
                    const currentOffset = parentOffset + (node.pad || 0);
                    const isError = node.typeName === "ERROR";
                    const isGhost = node.len === 0 && !isError;
                    
                    nodes.push({ ...node, depth, isGhost, isError, currentOffset });
                    
                    let childOffset = currentOffset;
                    for (const childPtr of node.children || []) {
                        childOffset = flatten(childPtr, depth + 1, childOffset);
                    }
                    return currentOffset + (node.len || 0);
                };
                
                if (rootId) flatten(rootId, 0, 0);
                return nodes;
            }, [updateTick, rootId]);

            const visibleNodes = flatNodes.slice(0, renderLimit);

            const getLineCol = (offsetBytes) => {
                let low = 0, high = lineStarts.length - 1;
                while (low <= high) {
                    const mid = (low + high) >> 1;
                    if (lineStarts[mid] <= offsetBytes) low = mid + 1;
                    else high = mid - 1;
                }
                const line = high;
                const colChars = Math.floor((offsetBytes - lineStarts[line]) / 2);
                return { line: line + 1, col: colChars + 1 };
            };

            const getPosStr = (offset, len) => {
                const startPos = getLineCol(offset);
                const endPos = getLineCol(offset + len);
                return "[" + startPos.line + ", " + startPos.col + "] - [" + endPos.line + ", " + endPos.col + "]";
            };

            const handleNodeClick = (offset, len) => {
                if (window.highlightNode) {
                    const startPos = getLineCol(offset);
                    const endPos = getLineCol(offset + len);
                    window.highlightNode(startPos.line - 1, startPos.col - 1, endPos.line - 1, endPos.col - 1);
                }
            };

            return (
                <div id="ast-viewer" style={{ padding: '10px', overflow: 'auto', flex: 1 }} onScroll={handleScroll}>
                    {rootId === 0 ? status : (
                        <>
                            {visibleNodes.map((node, i) => {
                                if (node.isCycle) {
                                    return <div key={node.id + "_" + i} style={{ marginLeft: node.depth * 15, color: '#8c959f', marginTop: '4px' }}>CYCLE</div>;
                                }
                                
                                let className = "ast-node";
                                if (node.isGhost) className += " ghost-node";
                                if (node.isError) className += " ast-error";
                                
                                return (
                                    <div key={node.id} className={className} style={{ marginLeft: node.depth * 15, cursor: 'pointer' }} onClick={() => handleNodeClick(node.currentOffset, node.len)}>
                                        <span className="hoverable-text" style={{ color: node.isError ? '#d73a49' : '#d2a8ff' }}>{node.typeName}</span>
                                        <span style={{ color: '#8b949e', marginLeft: '5px' }}>
                                            {getPosStr(node.currentOffset, node.len)}
                                        </span>
                                    </div>
                                );
                            })}

                        </>
                    )}
                </div>
            );
        }

        // Render React Tree
        const root = ReactDOM.createRoot(document.getElementById('react-ast-root'));
        root.render(<AstViewer />);
    </script>
</head>
<body>
    <div id="toolbar">
        <div class="brand-container">
            <div class="brand-icon"></div>
            ModelScript Playground
        </div>
        <span id="status" style="font-size: 12px; opacity: 0.8;">Ready</span>
        <button id="compile-btn" class="primer-btn">
            <svg aria-hidden="true" height="16" viewBox="0 0 16 16" version="1.1" width="16" fill="currentColor">
                <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm4.879-2.773 4.264 2.559a.25.25 0 0 1 0 .428l-4.264 2.559A.25.25 0 0 1 6 10.559V5.44a.25.25 0 0 1 .379-.216Z"></path>
            </svg>
            Compile & Load DSL
        </button>
    </div>
    <div id="editors">
        <div id="dsl-editor"></div>
        <div id="right-pane">
            <div id="code-editor"></div>
            <div id="react-ast-root"></div>
        </div>
    </div>
</body>
</html>`;
}

function getCompilerWorkerJs() {
  return `
import * as Language from '/browser.js?v=${Date.now()}';
import asc from '/asc.js';

console.log("Compiler Worker started", Language);

self.onmessage = async (e) => {
    if (e.data.type === 'compile') {
        try {
            console.log("Evaluating DSL definition...");
            self.postMessage({ type: 'progress', message: 'Evaluating DSL definition...' });
            
            // 1. Evaluate the grammar definition
            // Support ES module syntax by transforming 'export default' into 'return'
            let dslCode = e.data.dsl.replace(/export\\s+default\\s+/, 'return ');
            if (!dslCode.includes('return ')) {
                dslCode += '\\nreturn typeof __grammar !== "undefined" ? __grammar : null;';
            }
            dslCode = 'const {' + Object.keys(Language).join(', ') + '} = Language;\\n' + dslCode;
            
            const createGrammar = new Function('Language', dslCode);
            const grammarDef = createGrammar(Language);
            
            if (!grammarDef) {
                throw new Error("Grammar definition not found. Please assign your Language.language() to '__grammar'.");
            }
            
            console.log("Building parser artifacts...");
            self.postMessage({ type: 'progress', message: 'Building parser artifacts...' });
            // 2. Generate AssemblyScript files
            const result = Language.buildParser(grammarDef);
            
            // 3. Setup Virtual File System for AssemblyScript
            const vfs = {};
            for (const file of result.assemblyScriptFiles) {
                vfs[file.filename] = file.content;
            }
            
            console.log("Compiling to WASM with asc...");
            self.postMessage({ type: 'progress', message: 'Compiling to WASM with asc...' });
            // 4. Compile with asc
            const ascResult = await asc.main([
                "parser.ts",
                "-O3",
                "--enable", "threads",
                "--runtime", "stub",
                "--exportRuntime",
                "--importMemory",
                "--sharedMemory",
                "--maximumMemory", "4000",
                "--memoryBase", "65536",
                "--outFile", "parser.wasm",
                "--textFile", "parser.wat"
            ], {
                readFile: (name) => {
                    if (Object.prototype.hasOwnProperty.call(vfs, name)) return vfs[name];
                    return null;
                },
                writeFile: (name, data) => {
                    vfs[name] = data;
                },
                listFiles: () => Object.keys(vfs)
            });
            
            if (ascResult.error) {
                throw new Error("AssemblyScript compilation failed: " + ascResult.stderr.toString());
            }
            
            console.log("WASM compiled successfully!");
            
            self.postMessage({ 
                type: 'success', 
                wasm: vfs['parser.wasm'], 
                jsWrapper: result.javascriptWrapper.js,
                syntaxNames: result.javascriptWrapper.syntaxNames,
                langName: grammarDef.name
            });
        } catch (err) {
            self.postMessage({ type: 'error', error: err.message });
        }
    }
};
`;
}

function getLspWorkerJs() {
  return `
// LSP Worker (Standalone JSON-RPC without CDNs)
console.log("LSP Worker started");

let lspFacade = null;
let latestUri = undefined;
let currentTextLength = 0;
let currentGenerationId = Date.now();
let pendingFullText = null;
let currentLangName = "ModelScript DSL";
let globalAstRoot = 0;

let patchBufferA = new ArrayBuffer(1024 * 1024 * 2);
let patchBufferB = new ArrayBuffer(1024 * 1024 * 2);
let patchBuffer = patchBufferA;
let patchInt32 = new Int32Array(patchBuffer);
let patchOffset = 0;

function pushPatch(op, ptr, typeId, oldPtr, pad, len, children) {
    if (patchOffset + 10 + (children ? children.length : 0) > patchInt32.length) {
        const old = patchInt32;
        patchBuffer = new ArrayBuffer(patchBuffer.byteLength * 2);
        patchInt32 = new Int32Array(patchBuffer);
        patchInt32.set(old);
        // Keep both buffers in sync size-wise
        if (patchBuffer === patchBufferA) patchBufferA = patchBuffer;
        else patchBufferB = patchBuffer;
    }
    patchInt32[patchOffset++] = op;
    patchInt32[patchOffset++] = ptr;
    patchInt32[patchOffset++] = typeId || 0;
    patchInt32[patchOffset++] = oldPtr || 0;
    patchInt32[patchOffset++] = pad || 0;
    patchInt32[patchOffset++] = len || 0;
    patchInt32[patchOffset++] = children ? children.length : 0;
    if (children) {
        for (let i = 0; i < children.length; i++) {
            patchInt32[patchOffset++] = children[i];
        }
    }
}

function triggerDiagnostics(changes = null) {
    if (latestUri && lspFacade && changes && changes.length > 0) {
        let astRoot = 0;
        
        for (const change of changes) {
            if (change.rangeOffset !== undefined) {
                const newTotalLength = currentTextLength - change.rangeLength + change.text.length;
                globalAstRoot = lspFacade.parseIncremental(change.text, change.rangeOffset, change.rangeLength, newTotalLength);
                currentTextLength = newTotalLength;
            } else {
                currentTextLength = change.text.length;
                currentGenerationId++;
                globalAstRoot = lspFacade.parseIncremental(change.text, 0, 0, currentTextLength);
            }
        }
        
        const rawDiags = lspFacade.getDiagnostics(globalAstRoot);
        console.log('DIAGS:', JSON.stringify(rawDiags), 'root:', globalAstRoot, 'inputLen:', lspFacade.exports.inputLength?.value);
        const lineStarts = lspFacade.getLineStarts();
        
        // Double-buffer swap: transfer the current buffer and switch to the other
        const transferBuffer = patchBuffer.slice(0, patchOffset * 4);
        patchOffset = 0;
        // Swap to the alternate buffer to avoid allocating a new one each edit
        patchBuffer = (patchBuffer === patchBufferA) ? patchBufferB : patchBufferA;
        patchInt32 = new Int32Array(patchBuffer);
        
        self.postMessage({ 
            type: 'astPatchBinary', 
            buffer: transferBuffer, 
            rootId: globalAstRoot, 
            diagnostics: rawDiags,
            lineStarts: lineStarts,
            generationId: currentGenerationId
        }, [transferBuffer]);
        
        const diagnostics = rawDiags.map(d => ({
            severity: d.severity,
            range: d.range,
            message: d.message,
            code: d.code,
            source: currentLangName
        }));
        
        self.postMessage({
            jsonrpc: '2.0',
            method: 'textDocument/publishDiagnostics',
            params: { uri: latestUri, diagnostics }
        });
    }
}

// Listen for custom init message containing the WASM binary and generated JS
self.addEventListener('message', async (e) => {
    if (e.data.type === 'init') {
        console.log("LSP initialized with new WASM parser");
        const { wasm, jsWrapper, langName } = e.data;
        if (langName) currentLangName = langName;
        
        try {
            const memory = new WebAssembly.Memory({ initial: 4000, maximum: 4000, shared: true });
            const baseImports = { 
                env: { memory, emitTextEdit: function(a,b,c,d) {}, abort: function(msg, file, line, col) {
                    let str = "unknown";
                    if (msg) {
                        const mem16 = new Uint16Array(memory.buffer);
                        const mem32 = new Uint32Array(memory.buffer);
                        const len = mem32[(msg - 4) >> 2];
                        str = "";
                        for (let i = 0; i < len / 2; i++) str += String.fromCharCode(mem16[(msg >> 1) + i]);
                    }
                    console.error("WASM Abort:", str, "at line", line, "col", col);
                } },
                engine: { debugLog: function(state, cost, pos, padding) { } },
                parser: { 
                    logInt: function(val) {},
                    emitTextEdit: function(op, len, start, end) {},
                    getSourceSlice: function(start, end) { return 0; }
                }
            };

            const imports = new Proxy(baseImports, {
                get: function(target, moduleName) {
                    if (!(moduleName in target)) {
                        console.warn("WASM requested missing module:", moduleName);
                        target[moduleName] = {};
                    }
                    return new Proxy(target[moduleName], {
                        get: function(modTarget, fieldName) {
                            if (fieldName in modTarget) return modTarget[fieldName];
                            console.warn("WASM requested missing function:", moduleName + "." + fieldName);
                            return function() { console.warn("Called dummy func:", moduleName + "." + fieldName); return 0; };
                        }
                    });
                }
            });
            
            const { instance } = await WebAssembly.instantiate(wasm, imports);
            
            // initCompiler is called by LspFacade constructor; do NOT call it here
            
            const blob = new Blob([jsWrapper], { type: 'application/javascript' });
            const url = URL.createObjectURL(blob);
            const { LspFacade } = await import(url);
            
            lspFacade = new LspFacade(memory, instance.exports);
            currentTextLength = 0;  // Reset stale length from previous session
            
            lspFacade.addAstChangeListener({
                onNodeInserted: (ptr, typeId, typeName, pad, len, children) => pushPatch(1, ptr, typeId, 0, pad, len, children),
                onNodeDeleted: (ptr) => pushPatch(3, ptr, 0, 0, 0, 0, null),
                onNodeRetained: (ptr) => {},
                onNodeUpdated: (newPtr, oldPtr, typeId, typeName, pad, len, children) => pushPatch(2, newPtr, typeId, oldPtr, pad, len, children)
            });

            console.log("LspFacade successfully loaded inside worker.");
            if (e.data.initialText !== undefined && e.data.initialText !== null) {
                pendingFullText = e.data.initialText;
            }
            if (pendingFullText !== null) {
                triggerDiagnostics([{ text: pendingFullText }]);
                pendingFullText = null;
            }
        } catch(err) {
            console.error("LSP Worker WASM Init Error:", err);
        }
    } else if (e.data.method === 'initialize') {
        self.postMessage({
            jsonrpc: '2.0',
            id: e.data.id,
            result: { capabilities: { textDocumentSync: 2 } }
        });
    } else if (e.data.method === 'textDocument/didChange' || e.data.method === 'textDocument/didOpen') {
        const params = e.data.params;
        const uri = params.textDocument?.uri;
        if (uri) latestUri = uri;
        
        if (e.data.method === 'textDocument/didOpen') {
            const fullText = params.textDocument?.text || params.contentChanges?.[0]?.text;
            if (!lspFacade) {
                pendingFullText = fullText;
            } else {
                if (lspFacade.resetParser) lspFacade.resetParser();
                currentTextLength = 0;
                triggerDiagnostics([{ text: fullText }]);
            }
        } else {
            triggerDiagnostics(params.contentChanges);
        }
    } else if (e.data.method === 'textDocument/definition') {
        if (!lspFacade || !globalAstRoot) return self.postMessage({ jsonrpc: '2.0', id: e.data.id, result: null });
        const pos = e.data.params.position;
        // offset from pos logic might need lineStarts check, lspFacade provides offsetToPos, but we need posToOffset
        const lineStarts = lspFacade.getLineStarts();
        let offset = 0;
        if (pos.line < lineStarts.length) {
            offset = lineStarts[pos.line] + (pos.character * 2);
        }
        const def = lspFacade.getDefinition(globalAstRoot, offset);
        if (def) {
            const startPos = lspFacade.offsetToPos(def.start, lineStarts);
            const endPos = lspFacade.offsetToPos(def.end, lineStarts);
            self.postMessage({
                jsonrpc: '2.0',
                id: e.data.id,
                result: { uri: latestUri, range: { start: startPos, end: endPos } }
            });
        } else {
            self.postMessage({ jsonrpc: '2.0', id: e.data.id, result: null });
        }
    } else if (e.data.method === 'textDocument/references') {
        if (!lspFacade || !globalAstRoot) return self.postMessage({ jsonrpc: '2.0', id: e.data.id, result: [] });
        const pos = e.data.params.position;
        const lineStarts = lspFacade.getLineStarts();
        let offset = 0;
        if (pos.line < lineStarts.length) {
            offset = lineStarts[pos.line] + (pos.character * 2);
        }
        const refs = lspFacade.getReferences(globalAstRoot, offset);
        const result = refs.map(ref => ({
            uri: latestUri,
            range: {
                start: lspFacade.offsetToPos(ref.start, lineStarts),
                end: lspFacade.offsetToPos(ref.end, lineStarts)
            }
        }));
        self.postMessage({ jsonrpc: '2.0', id: e.data.id, result });
    } else if (e.data.method === 'textDocument/foldingRange') {
        if (!lspFacade || !globalAstRoot) return self.postMessage({ jsonrpc: '2.0', id: e.data.id, result: [] });
        const ranges = lspFacade.getFoldingRanges(globalAstRoot);
        const result = ranges.map(r => ({
            startLine: r.start.line,
            startCharacter: r.start.character,
            endLine: r.end.line,
            endCharacter: r.end.character
        }));
        self.postMessage({ jsonrpc: '2.0', id: e.data.id, result });
    } else if (e.data.method === 'textDocument/documentSymbol') {
        if (!lspFacade || !globalAstRoot) return self.postMessage({ jsonrpc: '2.0', id: e.data.id, result: [] });
        const symbols = lspFacade.getDocumentSymbols(globalAstRoot);
        const result = symbols.map(s => {
            const typeName = self.syntaxNames ? self.syntaxNames[s.typeId] : "Symbol";
            return {
                name: typeName,
                detail: "",
                kind: 5, // monaco.languages.SymbolKind.Class
                range: { start: s.start, end: s.end },
                selectionRange: { start: s.start, end: s.end }
            };
        });
        self.postMessage({ jsonrpc: '2.0', id: e.data.id, result });
    } else if (e.data.method === 'textDocument/rename') {
        if (!lspFacade || !globalAstRoot) return self.postMessage({ jsonrpc: '2.0', id: e.data.id, result: null });
        const pos = e.data.params.position;
        const newName = e.data.params.newName;
        const lineStarts = lspFacade.getLineStarts();
        let offset = 0;
        if (pos.line < lineStarts.length) {
            offset = lineStarts[pos.line] + (pos.character * 2);
        }
        
        // Find all references
        const refs = lspFacade.getReferences(globalAstRoot, offset);
        
        // getReferences already finds the definition identifier itself because it evaluates all nodes
        // with the matching hash, avoiding the need to explicitly include getDefinition() which would return
        // the entire statement.
        let changes = [];
        
        for (const ref of refs) {
             changes.push({
                 range: {
                     start: lspFacade.offsetToPos(ref.start, lineStarts),
                     end: lspFacade.offsetToPos(ref.end, lineStarts)
                 },
                 newText: newName
             });
        }
        
        const result = {
            changes: {
                [latestUri]: changes
            }
        };
        self.postMessage({ jsonrpc: '2.0', id: e.data.id, result });
    }
});
`;
}
