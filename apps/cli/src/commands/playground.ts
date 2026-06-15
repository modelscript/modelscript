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
      console.log(`[HTTP] ${req.method} ${req.url}`);
      if (req.url === "/") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(getIndexHtml());
      } else if (req.url === "/worker-compiler.js") {
        res.writeHead(200, { "Content-Type": "application/javascript" });
        res.end(getCompilerWorkerJs());
      } else if (req.url === "/worker-lsp.js") {
        res.writeHead(200, { "Content-Type": "application/javascript" });
        res.end(getLspWorkerJs());
      } else if (req.url === "/browser.js") {
        res.writeHead(200, { "Content-Type": "application/javascript" });
        const browserJsPath = join(__dirname, "../../../../packages/language/dist/browser.js");
        res.end(existsSync(browserJsPath) ? readFileSync(browserJsPath) : "");
      } else if (req.url?.startsWith("/node_modules/")) {
        const filePath = join(__dirname, "../../../../node_modules", req.url.slice(14));
        const ext = req.url.split(".").pop()?.toLowerCase();
        const mimeTypes: Record<string, string> = {
          js: "application/javascript",
          html: "text/html",
          css: "text/css",
          wasm: "application/wasm",
          ttf: "font/ttf",
        };
        res.writeHead(200, { "Content-Type": ext && mimeTypes[ext] ? mimeTypes[ext] : "text/plain" });
        if (existsSync(filePath)) {
          if (req.url.endsWith(".js") && req.url.includes("assemblyscript/dist/")) {
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
      } else if (req.url === "/asc.js") {
        // Map top-level /asc.js to the node_modules path so it goes through our interceptor above
        res.writeHead(302, { Location: "/node_modules/assemblyscript/dist/asc.js" });
        res.end();
      } else if (req.url === "/favicon.ico") {
        const faviconPath = join(__dirname, "../../../../apps/morsel/public/favicon.ico");
        if (existsSync(faviconPath)) {
          res.writeHead(200, { "Content-Type": "image/x-icon" });
          res.end(readFileSync(faviconPath));
        } else {
          res.writeHead(404);
          res.end();
        }
      } else if (req.url === "/logo.png") {
        const logoPath = join(__dirname, "../../../../apps/web/public/ms-logo.png");
        if (existsSync(logoPath)) {
          res.writeHead(200, { "Content-Type": "image/png" });
          res.end(readFileSync(logoPath));
        } else {
          res.writeHead(404);
          res.end();
        }
      } else if (req.url === "/logo-light.png") {
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

function getIndexHtml() {
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
        #editors { display: flex; flex: 1; height: 100%; }
        #dsl-editor { flex: 1; border-right: 1px solid var(--border-color); }
        #right-pane { flex: 1; display: flex; flex-direction: column; }
        #code-editor { flex: 1; border-bottom: 1px solid var(--border-color); }
        #ast-viewer { flex: 1; overflow: auto; padding: 10px; font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace; white-space: pre; font-size: 12px; }
        
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
    <!-- Load Monaco Editor Locally -->
    <script src="/node_modules/monaco-editor/min/vs/loader.js"></script>
    <script type="module">
        window.MonacoEnvironment = {
            getWorkerUrl: function(workerId, label) {
                return \`data:text/javascript;charset=utf-8,\${encodeURIComponent("self.MonacoEnvironment = { baseUrl: '/node_modules/monaco-editor/min/' }; importScripts('/node_modules/monaco-editor/min/vs/base/worker/workerMain.js');")}\`;
            }
        };
        
        require.config({ paths: { 'vs': '/node_modules/monaco-editor/min/vs' }});
        require(['vs/editor/editor.main'], function() {
            const dslLib = [
                "export {};",
                "declare global {",
                "    interface Rule {}",
                "    type RuleLike = Rule | string | RegExp;",
                "    interface LanguageOptions {",
                "        name: string;",
                "        word?: string;",
                "        rules: Record<string, ($: any) => RuleLike>;",
                "        primitives?: {",
                "            nestedComment?: { open: string; close: string };",
                "            lineComment?: string;",
                "            escapedIdent?: { quote: string; escape?: string };",
                "            stringLiteral?: { delim: string; escapes?: Record<string, number> };",
                "            multiWordKeywords?: string[];",
                "            layout?: { indent: string; dedent: string };",
                "        };",
                "        externals?: ($: any) => Rule[];",
                "        scanner?: (currentPos: number, scannerState: number) => number;",
                "        supertypes?: ($: any) => Rule[];",
                "        inline?: string[];",
                "        conflicts?: (($: any) => RuleLike[][]) | string[][];",
                "        precedences?: string[][];",
                "        reserved?: Record<string, ($: any) => Rule[]>;",
                "    }",
                "    function language(options: LanguageOptions): any;",
                "    function seq(...rules: RuleLike[]): Rule;",
                "    function choice(...rules: RuleLike[]): Rule;",
                "    function repeat(rule: RuleLike): Rule;",
                "    function repeat1(rule: RuleLike): Rule;",
                "    function optional(rule: RuleLike): Rule;",
                "    function sepBy1(rule: RuleLike, separator: RuleLike): Rule;",
                "    function sepBy(rule: RuleLike, separator: RuleLike): Rule;",
                "    function prec(level: number, rule: RuleLike): Rule;",
                "    function precLeft(level: number, rule: RuleLike): Rule;",
                "    function precRight(level: number, rule: RuleLike): Rule;",
                "    function precDynamic(level: number, rule: RuleLike): Rule;",
                "    function token(rule: RuleLike): Rule;",
                "    function alias(rule: RuleLike, name: string): Rule;",
                "}"
            ].join("\\n");
            
            monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
                target: monaco.languages.typescript.ScriptTarget.ESNext,
                allowNonTsExtensions: true,
                moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
                module: monaco.languages.typescript.ModuleKind.CommonJS,
                noEmit: true
            });
            monaco.languages.typescript.typescriptDefaults.addExtraLib(dslLib, 'ts:filename/dsl.d.ts');

            const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
            const editorTheme = prefersDark ? 'vs-dark' : 'vs';

            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
                monaco.editor.setTheme(e.matches ? 'vs-dark' : 'vs');
            });

            window.dslEditor = monaco.editor.create(document.getElementById('dsl-editor'), {
                value: "export default language({\\n  name: 'MyLang',\\n  rules: {\\n    Main: $ => $.Identifier,\\n    Identifier: $ => /[a-zA-Z_][a-zA-Z0-9_]*/\\n  }\\n});",
                language: 'typescript',
                theme: editorTheme
            });
            window.codeEditor = monaco.editor.create(document.getElementById('code-editor'), {
                value: "test code",
                language: 'plaintext',
                theme: editorTheme
            });

            const compilerWorker = new Worker('/worker-compiler.js', { type: 'module' });
            compilerWorker.onerror = (e) => {
                console.error("Compiler Worker Error:", e);
                document.getElementById('status').innerText = "Compiler Worker Error: " + e.message;
            };

            const lspWorker = new Worker('/worker-lsp.js', { type: 'module' });
            lspWorker.onerror = (e) => {
                console.error("LSP Worker Error:", e);
            };

            document.getElementById('compile-btn').onclick = () => {
                document.getElementById('status').innerText = "Compiling DSL in browser...";
                const dsl = window.dslEditor.getValue();
                compilerWorker.postMessage({ type: 'compile', dsl });
            };
            
            compilerWorker.onmessage = (e) => {
                if (e.data.type === 'success') {
                    document.getElementById('status').innerText = "Compiled successfully! LSP is active.";
                    lspWorker.postMessage({ 
                        type: 'init', 
                        wasm: e.data.wasm, 
                        jsWrapper: e.data.jsWrapper,
                        syntaxNames: e.data.syntaxNames 
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
                            severity: d.severity === 1 ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
                            startLineNumber: d.range.start.line + 1,
                            startColumn: d.range.start.character + 1,
                            endLineNumber: d.range.end.line + 1,
                            endColumn: d.range.end.character + 1,
                            message: d.message,
                            source: 'ModelScript DSL LSP'
                        }));
                        console.log("Client received diagnostics:", markers);
                        monaco.editor.setModelMarkers(this.model, 'dsl-lsp', markers);
                    } else if (msg.type === 'astUpdate') {
                        const viewer = document.getElementById('ast-viewer');
                        if (viewer) viewer.textContent = msg.ast || "(Empty AST)";
                    }
                }
            }
            
            // Start the client
            const languageClient = new SimpleMonacoLanguageClient(lspWorker, window.codeEditor);
        });
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
            <div id="ast-viewer">(Waiting for compile...)</div>
        </div>
    </div>
</body>
</html>`;
}

function getCompilerWorkerJs() {
  return `
import * as Language from '/browser.js';
import asc from '/asc.js';

console.log("Compiler Worker started", Language);

self.onmessage = async (e) => {
    if (e.data.type === 'compile') {
        try {
            console.log("Evaluating DSL definition...");
            
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
            // 2. Generate AssemblyScript files
            const result = Language.buildParser(grammarDef);
            
            // 3. Setup Virtual File System for AssemblyScript
            const vfs = {};
            for (const file of result.assemblyScriptFiles) {
                vfs[file.filename] = file.content;
            }
            
            console.log("Compiling to WASM with asc...");
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
                syntaxNames: result.parserInfo.terminals.concat(result.parserInfo.nonTerminals)
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
let latestText = undefined;
let latestUri = undefined;

function triggerDiagnostics(changes = null) {
    if (latestText !== undefined && latestUri && lspFacade) {
        let editStartByte = 0;
        let editOldEndByte = 0;
        let editNewEndByte = 0;

        if (changes && changes.length === 1 && changes[0].rangeOffset !== undefined) {
            const change = changes[0];
            // JS strings are UTF-16 code units. The WASM lexer reads UTF-16LE bytes directly.
            // So we simply multiply JS character indices by 2 to get the exact byte offsets!
            editStartByte = change.rangeOffset * 2;
            editOldEndByte = (change.rangeOffset + change.rangeLength) * 2;
            editNewEndByte = editStartByte + change.text.length * 2;
            
            latestText = latestText.substring(0, change.rangeOffset) + change.text + latestText.substring(change.rangeOffset + change.rangeLength);
        } else if (changes && changes.length > 0) {
            for (const change of changes) {
                if (change.rangeOffset !== undefined) {
                    latestText = latestText.substring(0, change.rangeOffset) + change.text + latestText.substring(change.rangeOffset + change.rangeLength);
                } else {
                    latestText = change.text;
                }
            }
        }

        const astRoot = lspFacade.parse(latestText, editStartByte, editOldEndByte, editNewEndByte);
        
        const astString = lspFacade.getAstSExpr(astRoot);
        self.postMessage({ type: 'astUpdate', ast: astString });
        
        const rawDiags = lspFacade.getDiagnostics(astRoot);
        const diagnostics = rawDiags.map(d => ({
            severity: d.severity,
            range: d.range,
            message: d.message,
            source: 'ModelScript DSL'
        }));
        
        console.log("Publishing diagnostics for", latestUri, diagnostics);
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
        const { wasm, jsWrapper } = e.data;
        
        try {
            const memory = new WebAssembly.Memory({ initial: 4000, maximum: 4000, shared: true });
            const imports = { env: { memory, emitTextEdit: () => {}, abort: (msg, file, line, col) => {
                let str = "unknown";
                if (msg) {
                    const mem16 = new Uint16Array(memory.buffer);
                    const mem32 = new Uint32Array(memory.buffer);
                    const len = mem32[(msg - 4) >> 2];
                    str = "";
                    for (let i = 0; i < len / 2; i++) str += String.fromCharCode(mem16[(msg >> 1) + i]);
                }
                console.error("WASM Abort:", str, "at line", line, "col", col);
            } } };
            
            const { instance } = await WebAssembly.instantiate(wasm, imports);
            
            if (instance.exports.initCompiler) {
                instance.exports.initCompiler();
            }
            
            const blob = new Blob([jsWrapper], { type: 'application/javascript' });
            const url = URL.createObjectURL(blob);
            const { LspFacade } = await import(url);
            
            lspFacade = new LspFacade(memory, instance.exports);
            console.log("LspFacade successfully loaded inside worker.");
            triggerDiagnostics();
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
            latestText = params.textDocument?.text || params.contentChanges?.[0]?.text;
            triggerDiagnostics();
        } else {
            triggerDiagnostics(params.contentChanges);
        }
    }
});
`;
}
