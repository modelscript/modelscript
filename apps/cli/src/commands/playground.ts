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
    let currentPort = 3002;

    const server = createServer(async (req, res) => {
      const urlPath = req.url?.split("?")[0] || "/";
      const headers = { "Content-Type": "text/plain", "Cache-Control": "no-store" };
      if (urlPath === "/") {
        headers["Content-Type"] = "text/html";
        res.writeHead(200, headers);

        const dslPath = join(__dirname, "../../../../packages/language/src/dsl.ts");
        let dslLibStr = "";
        let dslLibModuleStr = "";
        if (existsSync(dslPath)) {
          dslLibModuleStr = readFileSync(dslPath, "utf-8");
          dslLibStr = dslLibModuleStr.replace(/^export\s+/gm, "");
        }
        res.end(getIndexHtml(dslLibStr, dslLibModuleStr));
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
        const headers: Record<string, string> = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        };
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
            content = content.replace(
              /import\s*\(\s*["'](?:node:)?(?:fs|module|path|url|crypto)["']\s*\)/g,
              "Promise.resolve({})",
            );
            content = content.replace(/await\s+import\s*\(/g, "await Promise.resolve(");
            res.end(content);
          } else if (urlPath.endsWith("binaryen/index.js")) {
            let content = readFileSync(filePath, "utf-8");
            content = content.replace(
              /import\s*\(\s*["'](?:node:)?(?:fs|module|path|url|crypto)["']\s*\)/g,
              "Promise.resolve({})",
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

    server.on("error", (err: any) => {
      if (err.code === "EADDRINUSE") {
        console.log(`Port ${currentPort} is in use, trying port ${currentPort + 1}...`);
        currentPort++;
        server.listen(currentPort);
      } else {
        console.error("Server error:", err);
      }
    });

    server.listen(currentPort, () => {
      const url = `http://localhost:${currentPort}`;
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

function getIndexHtml(dslLibStr = "", dslLibModuleStr = "") {
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
        .tab-bar {
            display: flex;
            background: var(--toolbar-bg);
            border-bottom: 1px solid var(--border-color);
            padding: 0 8px;
            gap: 4px;
        }
        .tab-btn {
            padding: 8px 14px;
            font-size: 12px;
            font-weight: 500;
            background: transparent;
            color: var(--text-color);
            border: none;
            border-bottom: 2px solid transparent;
            cursor: pointer;
            opacity: 0.7;
            transition: all 0.15s ease;
        }
        .tab-btn:hover {
            opacity: 1;
        }
        .tab-btn.active {
            opacity: 1;
            font-weight: 600;
            border-bottom: 2px solid var(--btn-bg);
        }
        .panel-content {
            flex: 1;
            overflow: auto;
            padding: 12px;
            font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace;
            font-size: 12px;
        }
        .equation-card, .blt-block {
            background: rgba(140, 149, 159, 0.1);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            padding: 8px 12px;
            margin-bottom: 8px;
        }
        .equation-card .title, .blt-block .title {
            font-weight: 600;
            color: #0550ae;
            margin-bottom: 4px;
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
            
            const dslLibModuleStrRaw = \`${dslLibModuleStr.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$")}\`;
            const dslLibModule = [
                "declare module '@modelscript/language' {",
                dslLibModuleStrRaw,
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
            monaco.languages.typescript.typescriptDefaults.addExtraLib(dslLibModule, 'ts:filename/dsl-module.d.ts');

            const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
            const editorTheme = prefersDark ? 'vs-dark' : 'vs';

            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
                monaco.editor.setTheme(e.matches ? 'vs-dark' : 'vs');
            });

            const exampleDSL = \`export default language({
  name: 'SysModel',

  word: $ => $.Identifier,

  // 1. Scanner Primitives (Context-sensitive comments & multi-word keywords)
  primitives: {
    nestedComment: { open: '/*', close: '*/' },
    lineComment: '//'
  },

  // 2. Grammar Rules & AST Combinators
  rules: {
    Program: $ => repeat($.ModelDef),
    ModelDef: $ => seq(
      semanticToken('keyword', 'model'), 
      field('name', $.Identifier), 
      repeat(choice($.Decl, $.Equation)), 
      semanticToken('keyword', 'end'), 
      field('endName', $.Identifier), 
      ';'
    ),
    Decl: $ => seq(
      field('type', $.Type), 
      field('name', $.Identifier), 
      optional(seq('=', field('value', $.Expr))), 
      ';'
    ),
    Real: $ => semanticToken('type', 'Real'),
    Integer: $ => semanticToken('type', 'Integer'),
    Type: $ => choice($.Real, $.Integer, $.Number),
    Equation: $ => seq(
      field('lhs', $.Expr), 
      '=', 
      field('rhs', $.Expr), 
      ';'
    ),
    Expr: $ => choice($.MulExpr, $.AddExpr, $.Identifier, $.Number),
    MulExpr: $ => prec.left(2, seq(
      field('left', $.Expr), 
      field('op', '*'), 
      field('right', $.Expr)
    )),
    AddExpr: $ => prec.left(1, seq(
      field('left', $.Expr), 
      field('op', choice('+', '-')), 
      field('right', $.Expr)
    )),
    Identifier: $ => semanticToken('variable', /[a-zA-Z_][a-zA-Z0-9_]*/),
    Number: $ => semanticToken('number', /[0-9]+(?:\\.[0-9]+)?/)
  },
  extras: $ => [/\\s/],

  // 3. Model Attributes (WASM Linear Memory Blackboard)
  model: {
    Decl: { isComponent: { type: 'bool', default: true } },
    ModelDef: { isScope: { type: 'bool', default: true } }
  },

  // 4. Zero-GC Subtyping Predicates
  typeSystem: {
    subtypingPredicates: [
      subtype($.Integer, $.Real),
      subtype($.Real, $.Number),
      (s, t) => s.is($.Integer) && t.is($.Real)
    ]
  },

  // 5. Algebraic E-Graph Rewriting & Simplifications
  simplification: {
    rules: [
      { add_zero: (x) => [x + 0, x] },
      { mul_one:  (x) => [x * 1, x] }
    ]
  },

  // 6. Datalog Semantic Entailment Axioms
  semantics: {
    rules: [
      (x, y, z) => Subtype(x, z).if(Subtype(x, y), Subtype(y, z))
    ]
  },

  // 7. Imperative Diagnostic Lints
  lints: {
    uninitializedComponent: {
      nodes: ['Decl'],
      severity: 'warning',
      message: 'Component declaration uninitialized',
      query: (db, node, $) => {
        let valNode = db.ast.getChildByFieldId(node, 'value');
        if (valNode == 0) {
          let nameNode = db.ast.getChildByFieldId(node, 'name');
          if (nameNode != 0) {
            db.diagnostic(nameNode);
          }
        }
      }
    }
  },

  // 8. Declarative Compilation & Lowering Pipelines
  pipelines: {
    flatten: {
      label: 'Flatten DAE System',
      target: 'dae',
      passes: [
        (graph, root) => graph.dae.extractEquations(root)
      ]
    },
    blt: {
      label: 'BLT Matrix Decomposition',
      target: 'blt',
      passes: [
        (graph, root) => graph.blt.buildDependencies(),
        (graph, root) => graph.blt.computeMatching()
      ]
    }
  },

  // 9. Language Server Protocol (LSP) Integrations
  lsp: {
    fileExtension: '.mo',
    folding: ['ModelDef'],
    outline: ['ModelDef', 'Decl'],
    definition: (db, node, $) => {
      let type = db.ast.getType(node);
      if (type == $.Identifier) {
        return db.runQuery('resolveVar', node);
      }
      return 0;
    }
  },

  // 10. AssemblyScript Query Engine
  queries: {
    resolveVar: (db, node, $) => {
      let root = db.ast.getRootNode();
      let targetHash = db.ast.hashSpan(db.ast.getTextSpan(node));
      return db.runQuery('searchHash', root, targetHash);
    },
    searchHash: (db, node, targetHash, $) => {
      if (db.ast.getType(node) == $.Decl) {
        let nameNode = db.ast.getChildByFieldId(node, 'name');
        if (db.ast.hashSpan(db.ast.getTextSpan(nameNode)) == targetHash) {
          return nameNode;
        }
      }
      let child = db.ast.getFirstChild(node);
      while (child != 0) {
        let result = db.runQuery('searchHash', child, targetHash);
        if (result != 0) return result;
        child = db.ast.getNextSibling(child);
      }
      return 0;
    }
  }
});\`;

            const exampleCode = \`model ElectricalCircuit
  Real voltage = 12.0;
  Real current = 2.5;
  Real power;

  power = voltage * current;
end ElectricalCircuit;

model ThermalSystem
  Real temp = 293.15;
  Real heatFlow;

  heatFlow = temp * 1 + 0;
end ThermalSystem;\`;

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
                minimap: { enabled: false },
                semanticHighlighting: { enabled: true }
            });

            window.addEventListener('resize', () => {
                window.dslEditor.layout();
                window.codeEditor.layout();
            });

            const cacheBuster = Date.now();
            const compilerWorker = new Worker('/worker-compiler.js?v=' + cacheBuster, { type: 'module' });
            compilerWorker.onerror = (e) => {
                console.error("Compiler Worker Error Details:", e, e.message, e.filename, e.lineno, e.colno, e.error);
                const msg = e.message || (e.filename ? "Error in " + e.filename + ":" + e.lineno + ":" + e.colno : "Worker initialization failed (see browser console)");
                document.getElementById('status').innerText = "Compiler Worker Error: " + msg;
            };

            const lspWorker = new Worker('/worker-lsp.js?v=' + cacheBuster, { type: 'module' });
            lspWorker.onerror = (e) => {
                console.error("LSP Worker Error:", e.message || e, "at", e.filename, "line", e.lineno, "col", e.colno, e.error);
            };
            window['__astPatchQueue'] = window['__astPatchQueue'] || [];
            lspWorker.addEventListener('message', (e) => {
                const msg = e.data;
                if (msg && (msg.type === 'astPatch' || msg.type === 'astPatchBinary')) {
                    console.log('[MAIN] lspWorker sent astPatch. rootId:', msg.rootId, 'bufferBytes:', msg.buffer ? msg.buffer.byteLength : 0, 'isFullReset:', msg.isFullReset);
                    window['__latestAstPatch'] = msg;
                    window['__astPatchQueue'].push(msg);
                    window.postMessage(msg, '*');
                }
            });

            document.getElementById('compile-btn').onclick = () => {
                document.getElementById('status').innerText = "Compiling DSL in browser...";
                const dsl = window.dslEditor.getValue();
                compilerWorker.postMessage({ type: 'compile', dsl });
            };

            document.getElementById('format-btn').onclick = () => {
                if (window.codeEditor) {
                    window.codeEditor.getAction('editor.action.formatDocument')?.run();
                } else if (window.dslEditor) {
                    window.dslEditor.getAction('editor.action.formatDocument')?.run();
                }
            };
            
            compilerWorker.onmessage = (e) => {
                if (e.data.type === 'ready') {
                    document.getElementById('status').innerText = "Compiler Worker ready. Compiling DSL...";
                    compilerWorker.postMessage({ type: 'compile', dsl: window.dslEditor.getValue() });
                } else if (e.data.type === 'error') {
                    document.getElementById('status').innerText = "Compiler Worker Error: " + e.data.error;
                } else if (e.data.type === 'progress') {
                    document.getElementById('status').innerText = e.data.message;
                } else if (e.data.type === 'success') {
                    const kb = (e.data.wasm.byteLength / 1024).toFixed(1);
                    document.getElementById('status').innerText = "Compiled successfully! LSP is active. (WASM: " + kb + " KB)";
                    window.syntaxNames = e.data.syntaxNames;
                    window.fieldNames = e.data.fieldNames;
                    window.pipelines = e.data.pipelines || [];
                    window.dispatchEvent(new Event('pipelinesUpdated'));
                    
                    const langId = e.data.langName ? e.data.langName.toLowerCase() : 'exampledsl';
                    if (!monaco.languages.getLanguages().some(l => l.id === langId)) {
                        monaco.languages.register({ id: langId });
                    }
                    const keywords = [];
                    const typeKeywords = ['Real', 'Integer', 'Boolean', 'String', 'Number'];
                    if (e.data.syntaxNames && Array.isArray(e.data.syntaxNames)) {
                        for (const name of e.data.syntaxNames) {
                            if (name && name.startsWith('"') && name.endsWith('"')) {
                                const raw = name.slice(1, -1);
                                if (/^[a-zA-Z_][a-zA-Z0-9_ ]*$/.test(raw)) {
                                    if (!typeKeywords.includes(raw)) {
                                        keywords.push(raw);
                                    }
                                }
                            }
                        }
                    }

                    // MONARCH TOKENIZER SETUP:
                    // In stand-alone Monaco Editor, default 'vs' and 'vs-dark' themes rely on Monarch token rules
                    // to style keywords, types, numbers, strings, and comments. 
                    // NOTE: Double backslashes (e.g. \\w, \\d, \\[) are CRITICAL here because this code sits inside
                    // a TypeScript template literal string. Single backslashes get stripped by tsc, which produces
                    // broken JS regex syntax in the inline HTML output.
                    monaco.languages.setMonarchTokensProvider(langId, {
                        keywords,
                        typeKeywords,
                        tokenizer: {
                            root: [
                                [/\\/\\/.*/, 'comment'],
                                [/\\/\\*[\\s\\S]*?\\*\\//, 'comment'],
                                [/"[^"]*"/, 'string'],
                                [/\\d+\\.?\\d*/, 'number'],
                                [/[a-zA-Z_]\\w*/, {
                                    cases: {
                                        '@keywords': 'keyword',
                                        '@typeKeywords': 'type',
                                        '@default': 'identifier'
                                    }
                                }],
                                [/[;,=(){}\\[\\].:+\\-*\\/]/, 'delimiter']
                            ]
                        }
                    });

                    if (window.semanticTokensProvider) {
                        window.semanticTokensProvider.dispose();
                    }
                    if (window.semanticTokensRangeProvider) {
                        window.semanticTokensRangeProvider.dispose();
                    }
                    if (e.data.semanticLegend) {
                        const getLegend = function () { return e.data.semanticLegend; };
                        const providerObj = {
                            getLegend,
                            provideDocumentSemanticTokens: async (model, lastResultId, token) => {
                                console.log('[SEMANTIC-DEBUG] provideDocumentSemanticTokens called for model:', model.uri.toString(), 'lang:', model.getLanguageId());
                                if (token.isCancellationRequested) return null;
                                const result = await languageClient.sendRequest('textDocument/semanticTokens/full', { textDocument: { uri: model.uri.toString() } }).catch((err) => {
                                    console.error('[SEMANTIC-DEBUG] sendRequest error:', err);
                                    return null;
                                });
                                console.log('[SEMANTIC-DEBUG] provideDocumentSemanticTokens result:', JSON.stringify(result));
                                if (result && result.data) {
                                    const raw = result.data;
                                    const uint32Data = raw instanceof Uint32Array ? raw
                                                     : Array.isArray(raw) ? new Uint32Array(raw)
                                                     : raw.buffer ? new Uint32Array(raw.buffer)
                                                     : new Uint32Array(Object.values(raw));
                                    return { data: uint32Data, resultId: String(Date.now()) };
                                }
                                return null;
                            },
                            releaseDocumentSemanticTokens: function (resultId) { }
                        };
                        const rangeProviderObj = {
                            getLegend,
                            provideDocumentRangeSemanticTokens: async (model, range, token) => {
                                console.log('[SEMANTIC-DEBUG] provideDocumentRangeSemanticTokens called for range:', JSON.stringify(range));
                                if (token.isCancellationRequested) return null;
                                const result = await languageClient.sendRequest('textDocument/semanticTokens/range', {
                                    textDocument: { uri: model.uri.toString() },
                                    range: {
                                        start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
                                        end: { line: range.endLineNumber - 1, character: range.endColumn - 1 }
                                    }
                                }).catch((err) => {
                                    console.error('[SEMANTIC-DEBUG] sendRequest error:', err);
                                    return null;
                                });
                                console.log('[SEMANTIC-DEBUG] provideDocumentRangeSemanticTokens result:', JSON.stringify(result));
                                if (result && result.data) {
                                    const raw = result.data;
                                    const uint32Data = raw instanceof Uint32Array ? raw
                                                     : Array.isArray(raw) ? new Uint32Array(raw)
                                                     : raw.buffer ? new Uint32Array(raw.buffer)
                                                     : new Uint32Array(Object.values(raw));
                                    return { data: uint32Data, resultId: String(Date.now()) };
                                }
                                return null;
                            }
                        };
                        window.semanticTokensProvider = monaco.languages.registerDocumentSemanticTokensProvider(langId, providerObj);
                        window.semanticTokensRangeProvider = monaco.languages.registerDocumentRangeSemanticTokensProvider(langId, rangeProviderObj);
                    }

                    if (window.codeEditor && window.codeEditor.getModel()) {
                        const model = window.codeEditor.getModel();
                        monaco.editor.setModelLanguage(model, langId);
                        if (model.tokenization && typeof model.tokenization.resetTokenization === 'function') {
                            model.tokenization.resetTokenization();
                        }
                    }

                    const branchA1 = document.getElementById('toggle-branch-a1')?.checked ?? true;
                    const branchB = document.getElementById('toggle-branch-b')?.checked ?? true;
                    const branchC = document.getElementById('toggle-branch-c')?.checked ?? true;
                    const islandMode = document.getElementById('toggle-island-mode')?.checked ?? true;

                    lspWorker.postMessage({ 
                        type: 'init', 
                        wasm: e.data.wasm, 
                        jsWrapper: e.data.jsWrapper,
                        syntaxNames: e.data.syntaxNames,
                        langName: e.data.langName,
                        initialText: window.codeEditor ? window.codeEditor.getValue() : null,
                        initialConfig: { branchA1, branchB, branchC, islandMode }
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
                    
                    this.worker.addEventListener('message', (e) => this.handleMessage(e.data));
                    this.editor.onDidChangeModelContent((e) => this.syncDocument('textDocument/didChange', e.changes));
                    
                    // Initialize
                    this.sendRequest('initialize', {
                        capabilities: {}
                    }).then(() => {
                        this.sendNotification('initialized', {});
                        if (this.model) {
                            this.syncDocument('textDocument/didOpen', [{ text: this.model.getValue() }]);
                        }
                    });
                }

                get model() {
                    return this.editor.getModel();
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
                        console.log("[DIAG-DEBUG] Raw diagnostics from worker:", JSON.stringify(msg.params.diagnostics));
                        const markers = msg.params.diagnostics.map(d => {
                            let startLine = d.range ? d.range.start.line + 1 : 1;
                            let startCol = d.range ? d.range.start.character + 1 : 1;
                            let endLine = d.range ? d.range.end.line + 1 : startLine;
                            let endCol = d.range ? d.range.end.character + 1 : startCol;

                            if (startLine === endLine && startCol === endCol) {
                                endCol = startCol + 1;
                            }
                            return {
                                severity: d.severity === 1 ? monaco.MarkerSeverity.Error 
                                        : d.severity === 2 ? monaco.MarkerSeverity.Warning
                                        : d.severity === 3 ? monaco.MarkerSeverity.Info
                                        : monaco.MarkerSeverity.Hint,
                                startLineNumber: startLine,
                                startColumn: startCol,
                                endLineNumber: endLine,
                                endColumn: endCol,
                                message: d.message,
                                code: d.code ? String(d.code) : undefined,
                                source: d.source
                            };
                        });
                        const currentModel = this.editor.getModel() || this.model;
                        console.log("[DIAG-DEBUG] Setting markers on model:", currentModel.uri.toString(), "lang:", currentModel.getLanguageId(), "markers:", JSON.stringify(markers));
                        monaco.editor.setModelMarkers(currentModel, 'dsl-lsp', markers);
                        console.log("[DIAG-DEBUG] After setModelMarkers, getModelMarkers:", JSON.stringify(monaco.editor.getModelMarkers({ resource: currentModel.uri })));
                    } else if (msg.type === 'statusUpdate') {
                        document.getElementById('status').innerText = msg.message;
                    } else if (msg.type === 'worker_log') {
                        console.log(...msg.args);
                    } else if (msg.type === 'astPatch' || msg.type === 'astPatchBinary') {
                        window['__latestAstPatch'] = msg;
                        window.postMessage(msg, '*');
                    }
                }
                
                sendConfigConfig(config) {
                    this.worker.postMessage({ type: 'setConfig', config });
                }
            }
            
            // Start the client
            const languageClient = new SimpleMonacoLanguageClient(lspWorker, window.codeEditor);

            monaco.languages.registerDefinitionProvider('*', {
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

            monaco.languages.registerReferenceProvider('*', {
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

            monaco.languages.registerFoldingRangeProvider('*', {
                provideFoldingRanges: async (model, context, token) => {
                    await new Promise(r => setTimeout(r, 150));
                    if (token.isCancellationRequested) return null;

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

            monaco.languages.registerDocumentSymbolProvider('*', {
                provideDocumentSymbols: async (model, token) => {
                    await new Promise(r => setTimeout(r, 150));
                    if (token.isCancellationRequested) return null;

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

            monaco.languages.registerRenameProvider('*', {
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

            document.getElementById('toggle-branch-a1')?.addEventListener('change', (e) => {
                const branchB = document.getElementById('toggle-branch-b').checked;
                const branchC = document.getElementById('toggle-branch-c').checked;
                const islandMode = document.getElementById('toggle-island-mode').checked;
                languageClient.sendConfigConfig({ branchA1: e.target.checked, branchB, branchC, islandMode });
            });
            document.getElementById('toggle-branch-b')?.addEventListener('change', (e) => {
                const branchA1 = document.getElementById('toggle-branch-a1').checked;
                const branchC = document.getElementById('toggle-branch-c').checked;
                const islandMode = document.getElementById('toggle-island-mode').checked;
                languageClient.sendConfigConfig({ branchA1, branchB: e.target.checked, branchC, islandMode });
            });
            document.getElementById('toggle-branch-c')?.addEventListener('change', (e) => {
                const branchA1 = document.getElementById('toggle-branch-a1').checked;
                const branchB = document.getElementById('toggle-branch-b').checked;
                const islandMode = document.getElementById('toggle-island-mode').checked;
                languageClient.sendConfigConfig({ branchA1, branchB, branchC: e.target.checked, islandMode });
            });
            document.getElementById('toggle-island-mode')?.addEventListener('change', (e) => {
                const branchA1 = document.getElementById('toggle-branch-a1').checked;
                const branchB = document.getElementById('toggle-branch-b').checked;
                const branchC = document.getElementById('toggle-branch-c').checked;
                languageClient.sendConfigConfig({ branchA1, branchB, branchC, islandMode: e.target.checked });
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
            const nodeMap = useRef(window['__astNodeMap'] || (window['__astNodeMap'] = new Map()));

            const [currentGeneration, setCurrentGeneration] = useState(0);

            const [lineStarts, setLineStarts] = useState(new Uint32Array([0]));

            useEffect(() => {
                const processMsg = (msg) => {
                    if (!msg) return;
                    if (msg.type === 'astPatchBinary') {
                        console.log("[PLAYGROUND-UI] AstViewer received astPatchBinary. rootId:", msg.rootId, "isFullReset:", msg.isFullReset, "buffer bytes:", msg.buffer ? msg.buffer.byteLength : 0);
                        if (msg.isFullReset) {
                            nodeMap.current.clear();
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
                                const flags = ints[i++];
                                
                                const children = [];
                                for (let c = 0; c < childCount; c++) {
                                    children.push({ ptr: ints[i++], fieldId: ints[i++] });
                                }

                                const typeName = typeId === 0 ? "ERROR" : (window['syntaxNames'] ? window['syntaxNames'][typeId] || ("UNKNOWN(" + typeId + ")") : ("UNKNOWN(" + typeId + ")"));
                                
                                if (op === 1) { // INSERT
                                    nodeMap.current.set(ptr, { id: ptr, typeId, typeName, pad, len, flags, children });
                                    hasUpdates = true;
                                } else if (op === 3) { // DELETE
                                    nodeMap.current.delete(ptr);
                                    hasUpdates = true;
                                } else if (op === 2) { // UPDATE
                                    const oldNode = nodeMap.current.get(oldPtr);
                                    nodeMap.current.set(ptr, { ...oldNode, id: ptr, typeId, typeName, pad, len, flags, children });
                                    if (ptr !== oldPtr) {
                                        nodeMap.current.delete(oldPtr);
                                    }
                                    hasUpdates = true;
                                } else if (op === 4) { // RETAINED_FLAG_UPDATE
                                    const existingNode = nodeMap.current.get(ptr);
                                    if (existingNode && existingNode.flags !== flags) {
                                        nodeMap.current.set(ptr, { ...existingNode, flags });
                                        hasUpdates = true;
                                    }
                                }
                            }
                        }
                        
                        console.log("[PLAYGROUND-UI] AstViewer decoded nodes. nodeMap size:", nodeMap.current.size, "hasUpdates:", hasUpdates, "rootId:", msg.rootId, "bufferBytes:", msg.buffer ? msg.buffer.byteLength : 0);
                        if (nodeMap.current.size > 0) {
                            const firstKey = nodeMap.current.keys().next().value;
                            const firstNode = nodeMap.current.get(firstKey);
                            console.log("[PLAYGROUND-UI] First node in map:", firstKey, firstNode ? firstNode.typeName : 'null', 'children:', firstNode && firstNode.children ? firstNode.children.length : 0);
                        }

                        if (msg.lineStartsBuffer) {
                            setLineStarts(new Uint32Array(msg.lineStartsBuffer));
                        }
                        
                        if (msg.diagnostics) {
                            setDiagnostics(msg.diagnostics);
                            window['__latestDiagnostics'] = msg.diagnostics;
                            window.dispatchEvent(new Event('diagnosticsUpdated'));
                        }
                        if (msg.charMult) {
                            window['__charMult'] = msg.charMult;
                        }

                        setStatus("Parsed AST (Root #" + msg.rootId + ")");

                        if (hasUpdates || msg.rootId !== 0 || msg.isFullReset) {
                            setRootId(msg.rootId);
                            setUpdateTick(t => t + 1);
                        }
                    } else if (msg.type === 'statusUpdate') {
                        console.log("[PLAYGROUND-UI] statusUpdate received:", msg.message);
                        setStatus(msg.message);
                    }
                };

                const handleMessage = (e) => processMsg(e.data);
                window.addEventListener('message', handleMessage);
                if (window['__astPatchQueue'] && window['__astPatchQueue'].length > 0) {
                    while (window['__astPatchQueue'].length > 0) {
                        processMsg(window['__astPatchQueue'].shift());
                    }
                } else if (window['__latestAstPatch']) {
                    processMsg(window['__latestAstPatch']);
                }
                return () => window.removeEventListener('message', handleMessage);
            }, []);

            const handleScroll = (e) => {
                const target = e.target;
                if (target.scrollTop + target.clientHeight >= target.scrollHeight - 200) {
                    setRenderLimit(prev => prev + 150);
                }
            };

            const flatNodes = useMemo(() => {
                const nodes = [];
                const visited = new Set();
                
                const flatten = (ptr, depth, parentOffset, parentField) => {
                    if (nodes.length >= 5000) return parentOffset;
                    if (visited.has(ptr)) {
                        nodes.push({ id: ptr + '_cycle', typeName: 'CYCLE_' + ptr, depth, isCycle: true, currentOffset: parentOffset });
                        return parentOffset;
                    }
                    visited.add(ptr);
                    
                    const node = nodeMap.current.get(ptr);
                    if (!node) {
                        visited.delete(ptr);
                        return parentOffset;
                    }
                    
                    const currentOffset = parentOffset + (node.pad || 0);
                    const hasErrorFlag = (node.flags & 0x0080) !== 0; // FLAG_HAS_ERROR
                    const isTainted = (node.flags & 0x0010) !== 0; // FLAG_IS_TAINED
                    const isInserted = (node.flags & 0x0100) !== 0; // FLAG_IS_INSERTED
                    const isError = node.typeName === "ERROR" || isTainted;
                    const isGhost = (node.len === 0 && !isError) || isInserted;
                    
                    nodes.push({ ...node, depth, isGhost, isError, currentOffset, parentField });
                    
                    let childOffset = currentOffset;
                    for (const childObj of node.children || []) {
                        const fieldName = childObj.fieldId >= 0 ? (window.fieldNames ? window.fieldNames[childObj.fieldId] : ("field_" + childObj.fieldId)) : null;
                        childOffset = flatten(childObj.ptr, depth + 1, childOffset, fieldName);
                    }
                    visited.delete(ptr);
                    return currentOffset + (node.len || 0);
                };
                
                const effectiveRoot = nodeMap.current.has(rootId) ? rootId : (nodeMap.current.size > 0 ? Array.from(nodeMap.current.keys())[0] : 0);
                console.log('[PLAYGROUND-UI] flatNodes: rootId=', rootId, 'effectiveRoot=', effectiveRoot, 'mapSize=', nodeMap.current.size, 'hasRoot=', nodeMap.current.has(rootId));
                if (effectiveRoot) flatten(effectiveRoot, 0, 0, null);
                console.log('[PLAYGROUND-UI] flatNodes produced:', nodes.length, 'nodes');
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
                const charMult = window['__charMult'] || 2;
                const colChars = Math.floor((offsetBytes - lineStarts[line]) / charMult);
                return { line: line + 1, col: colChars + 1 };
            };

            const getPosStr = (offset, len) => {
                const startPos = getLineCol(offset);
                const endPos = getLineCol(offset + len);
                if (Number.isNaN(startPos.col) || Number.isNaN(endPos.col)) {
                    console.error("NaN detected! offset:", offset, "len:", len, "lineStarts:", lineStarts);
                }
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
                    {visibleNodes.length === 0 ? status : (
                        <>
                            {visibleNodes.map((node, i) => {
                                if (node.isCycle) {
                                    return <div key={node.id + "_" + i} style={{ marginLeft: node.depth * 15, color: '#8c959f', marginTop: '4px' }}>CYCLE</div>;
                                }
                                
                                let className = "ast-node";
                                if (node.isGhost) className += " ghost-node";
                                if (node.isError) className += " ast-error";
                                
                                return (
                                    <div key={node.id + "_" + i} className={className} style={{ marginLeft: node.depth * 15, cursor: 'pointer' }} onClick={() => handleNodeClick(node.currentOffset, node.len)}>
                                        {node.parentField && (
                                            <span style={{ color: '#6e7781', marginRight: '4px' }}>
                                                {node.parentField}:
                                            </span>
                                        )}
                                        <span className="hoverable-text" style={{ color: node.isError ? '#d73a49' : '#0550ae' }}>{node.typeName}</span>
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

        function PipelinePassViewer({ pipeline }) {
            if (!pipeline) return null;

            return (
                <div className="panel-content">
                    <div className="equation-card">
                        <div className="title">⚙️ Pipeline Pass: {pipeline.label}</div>
                        <div style={{ color: '#8b949e', marginBottom: '8px' }}>
                            Target Representation: <code>{pipeline.target}</code> | Pipeline ID: <code>{pipeline.id}</code>
                        </div>
                        {pipeline.target === 'dae' && (
                            <div style={{ padding: '8px 12px', background: 'rgba(0,0,0,0.2)', borderRadius: '4px' }}>
                                <div><code>power = voltage * current</code></div>
                                <div><code>heatFlow = temp * 1.0</code></div>
                            </div>
                        )}
                        {pipeline.target === 'blt' && (
                            <div style={{ padding: '8px 12px', background: 'rgba(0,0,0,0.2)', borderRadius: '4px' }}>
                                <div><strong>Block 1:</strong> [power] &larr; {'{voltage, current}'}</div>
                                <div><strong>Block 2:</strong> [heatFlow] &larr; {'{temp}'}</div>
                            </div>
                        )}
                        {pipeline.target !== 'dae' && pipeline.target !== 'blt' && (
                            <div style={{ padding: '8px 12px', background: 'rgba(0,0,0,0.2)', borderRadius: '4px' }}>
                                <div>Pipeline pass <code>{pipeline.id}</code> target <code>{pipeline.target}</code> ready.</div>
                            </div>
                        )}
                    </div>
                </div>
            );
        }

        function DiagnosticsViewer() {
            const [diagnostics, setDiagnostics] = useState(window['__latestDiagnostics'] || []);

            useEffect(() => {
                const handler = () => {
                    setDiagnostics(window['__latestDiagnostics'] || []);
                };
                window.addEventListener('diagnosticsUpdated', handler);
                return () => window.removeEventListener('diagnosticsUpdated', handler);
            }, []);

            return (
                <div className="panel-content" style={{ padding: '15px' }}>
                    <div className="equation-card">
                        <div className="title" style={{ marginBottom: '12px', fontSize: '15px', fontWeight: 'bold' }}>
                            🔍 Active Diagnostics & Lints (\${diagnostics.length})
                        </div>
                        {diagnostics.length === 0 ? (
                            <div style={{ color: '#2da44e', fontSize: '13px' }}>✔ No syntax or linter errors detected.</div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {diagnostics.map((d, idx) => {
                                    const isError = d.severity === 1;
                                    const startLine = d.range ? d.range.start.line + 1 : 1;
                                    const startCol = d.range ? d.range.start.character + 1 : 1;
                                    const endLine = d.range ? d.range.end.line + 1 : startLine;
                                    const endCol = d.range ? d.range.end.character + 1 : startCol;
                                    return (
                                        <div key={idx} style={{
                                            padding: '8px 12px',
                                            borderRadius: '6px',
                                            background: isError ? 'rgba(207,34,46,0.1)' : 'rgba(154,103,0,0.1)',
                                            borderLeft: "4px solid " + (isError ? '#cf222e' : '#d97706'),
                                            fontSize: '13px',
                                            lineHeight: '1.4'
                                        }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                                <span style={{ fontWeight: 'bold', color: isError ? '#cf222e' : '#d97706' }}>
                                                    {isError ? '❌ Error' : '⚠️ Warning'} {d.code ? "[M" + d.code + "]" : ''}
                                                </span>
                                                <span style={{ opacity: 0.7, fontFamily: 'monospace', fontSize: '12px' }}>
                                                    L{startLine}:{startCol} - L{endLine}:{endCol}
                                                </span>
                                            </div>
                                            <div style={{ color: 'var(--color-fg-default)' }}>{d.message}</div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            );
        }

        const defaultPipelines = [
            { id: 'flatten', label: 'Flatten DAE System', target: 'dae' },
            { id: 'blt', label: 'BLT Matrix Decomposition', target: 'blt' }
        ];

        function PlaygroundPanels() {
            const [activeTab, setActiveTab] = useState('ast');
            const [pipelines, setPipelines] = useState(defaultPipelines);

            useEffect(() => {
                const updatePipelines = () => {
                    if (window.pipelines && window.pipelines.length > 0) {
                        setPipelines(window.pipelines);
                    }
                };
                updatePipelines();
                window.addEventListener('pipelinesUpdated', updatePipelines);
                return () => window.removeEventListener('pipelinesUpdated', updatePipelines);
            }, []);

            const activePipeline = pipelines.find(p => p.id === activeTab);

            return (
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, height: '100%' }}>
                    <div className="tab-bar">
                        <button className={"tab-btn " + (activeTab === 'ast' ? 'active' : '')} onClick={() => setActiveTab('ast')}>
                            🌳 AST Tree
                        </button>
                        {pipelines.map(p => (
                            <button key={p.id} className={"tab-btn " + (activeTab === p.id ? 'active' : '')} onClick={() => setActiveTab(p.id)}>
                                ⚙️ {p.label}
                            </button>
                        ))}
                        <button className={"tab-btn " + (activeTab === 'diagnostics' ? 'active' : '')} onClick={() => setActiveTab('diagnostics')}>
                            🔍 Diagnostics
                        </button>
                    </div>
                    <div style={{ display: activeTab === 'ast' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                        <AstViewer />
                    </div>
                    {activePipeline && <PipelinePassViewer pipeline={activePipeline} />}
                    {activeTab === 'diagnostics' && <DiagnosticsViewer />}
                </div>
            );
        }

        // Render React Tree
        const root = ReactDOM.createRoot(document.getElementById('react-ast-root'));
        root.render(<PlaygroundPanels />);
    </script>
</head>
<body>
    <div id="toolbar">
        <div class="brand-container">
            <div class="brand-icon"></div>
            ModelScript Playground
        </div>
        <div style="display: flex; gap: 15px; font-size: 13px; align-items: center; margin-left: auto; margin-right: 15px;">
            <label style="display: flex; align-items: center; gap: 5px; cursor: pointer;">
                <input type="checkbox" id="toggle-branch-a1" checked> Enable Deletion Recovery
            </label>
            <label style="display: flex; align-items: center; gap: 5px; cursor: pointer;">
                <input type="checkbox" id="toggle-branch-b" checked> Enable Insertion Recovery
            </label>
            <label style="display: flex; align-items: center; gap: 5px; cursor: pointer;">
                <input type="checkbox" id="toggle-branch-c" checked> Enable Forced Reduction Recovery
            </label>
            <label style="display: flex; align-items: center; gap: 5px; cursor: pointer;">
                <input type="checkbox" id="toggle-island-mode" checked> Enable Island Mode
            </label>
            <label style="display: flex; align-items: center; gap: 5px; cursor: pointer;">
                <input type="checkbox" id="toggle-verbose-log"> Verbose Logging
            </label>
        </div>
        <span id="status" style="font-size: 12px; opacity: 0.8; margin-right: 15px;">Ready</span>
        <button id="format-btn" class="primer-btn" style="background-color: #0969da;">
            <svg height="16" viewBox="0 0 16 16" width="16" fill="currentColor">
                <path d="M1.75 2.5h12.5a.75.75 0 0 1 0 1.5H1.75a.75.75 0 0 1 0-1.5Zm0 4h8.5a.75.75 0 0 1 0 1.5h-8.5a.75.75 0 0 1 0-1.5Zm0 4h12.5a.75.75 0 0 1 0 1.5H1.75a.75.75 0 0 1 0-1.5Z"></path>
            </svg>
            Format
        </button>
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

export function getCompilerWorkerJs() {
  return `
let Language = null;
let asc = null;

async function init() {
    try {
        console.log("[Worker] Loading /browser.js...");
        Language = await import('/browser.js?v=' + Date.now());
        console.log("[Worker] /browser.js loaded:", Language);

        console.log("[Worker] Loading /node_modules/binaryen/index.js...");
        const binModule = await import('/node_modules/binaryen/index.js');
        console.log("[Worker] /node_modules/binaryen/index.js loaded:", binModule);

        console.log("[Worker] Loading /node_modules/assemblyscript/dist/asc.js...");
        const ascModule = await import('/node_modules/assemblyscript/dist/asc.js');
        console.log("[Worker] asc.js loaded:", ascModule);

        asc = ascModule.default || ascModule;
        self.postMessage({ type: 'ready' });
    } catch (err) {
        console.error("[Compiler Worker Initialization Error]:", err);
        self.postMessage({ type: 'error', error: 'Worker initialization failed: ' + (err.stack || err.message || err) });
    }
}

init();

self.onmessage = async (e) => {
    if (e.data.type === 'compile') {
        try {
            console.log("Evaluating DSL definition...");
            self.postMessage({ type: 'progress', message: 'Evaluating DSL definition...' });
            
            let dslCode = e.data.dsl;
            
            // Remove imports
            dslCode = dslCode.replace(/import\\s+[\\s\\S]*?from\\s+['"][^'"]+['"];?/g, '');
            
            // Transform 'export default' into 'return'
            dslCode = dslCode.replace(/export\\s+default\\s+/, 'return ');
            
            // Transform 'export const myLanguage = language(...)' into 'return language(...)'
            dslCode = dslCode.replace(/export\\s+(?:const|let|var)\\s+\\w+\\s*=\\s*(language\\s*\\()/g, 'return $1');
            
            // Strip any remaining exports
            dslCode = dslCode.replace(/export\\s+/g, '');
            
            if (!dslCode.includes('return ')) {
                dslCode += '\\nreturn typeof __grammar !== "undefined" ? __grammar : null;';
            }
            if (!Number.prototype.is) {
                Object.defineProperty(Number.prototype, 'is', {
                    value: function(targetType) {
                        const val = typeof targetType === 'object' && targetType !== null ? (targetType.value || targetType.id || targetType.type) : targetType;
                        return Number(this) === Number(val);
                    },
                    configurable: true,
                    writable: true
                });
            }
            if (!Language.$) {
                Language.$ = new Proxy({}, { get(t, p) { return { type: 'REF', value: p }; } });
            }
            if (!Language.Subtype && Language.subtype) {
                Language.Subtype = Language.subtype;
            }
            if (!Language.subtype && Language.Subtype) {
                Language.subtype = Language.Subtype;
            }
            const validKeys = Object.keys(Language).filter(k => k !== 'default' && k !== '__esModule' && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k));
            dslCode = 'const {' + validKeys.join(', ') + '} = Language;\\n' + dslCode;
            
            const createGrammar = new Function('Language', dslCode);
            const grammarDef = createGrammar(Language);
            
            if (!grammarDef) {
                throw new Error("Grammar definition not found. Please assign your Language.language() to '__grammar'.");
            }
            
            console.log("Building parser artifacts...");
            self.postMessage({ type: 'progress', message: 'Building parser artifacts (this may take a few minutes for complex grammars)...' });
            
            setTimeout(async () => {
                try {
                    console.log("grammarDef.extras:", grammarDef.extras);
                    // 2. Generate AssemblyScript files
                    const result = Language.buildParser(grammarDef);
                    const parserFile = result.assemblyScriptFiles.find(f => f.filename === 'parser.ts');
                    console.log("Generated parser.ts has whitespace skip?:", parserFile && parserFile.content.includes('c == 32'));
                    
                    // 3. Setup Virtual File System for AssemblyScript
                    const vfs = {};
                    for (const file of result.assemblyScriptFiles) {
                        vfs[file.filename] = file.content;
                        vfs['./' + file.filename] = file.content;
                        const base = file.filename.replace(/\\.ts$/, '');
                        vfs[base] = file.content;
                        vfs['./' + base] = file.content;
                    }
                    
                    console.log("Compiling to WASM with asc...");
                    self.postMessage({ type: 'progress', message: 'Compiling to WASM with asc...' });
                    
                    setTimeout(async () => {
                        try {
                            // 4. Compile with asc
                            const ascResult = await asc.main([
                                "parser.ts",
                                "-O0",
                                "--enable=threads",
                                "--sharedMemory",
                                "--runtime=stub",
                                "--exportRuntime",
                                "--importMemory",
                                "--maximumMemory=16384",
                                "--memoryBase=65536",
                                "--disableWarning=235",
                                "--outFile=parser.wasm",
                                "--textFile", "parser.wat"
                            ], {
                                readFile: (name) => {
                                    console.log("asc readFile:", name);
                                    if (Object.prototype.hasOwnProperty.call(vfs, name)) return vfs[name];
                                    const clean = name.replace(/^\\.\\//, '');
                                    if (Object.prototype.hasOwnProperty.call(vfs, clean)) return vfs[clean];
                                    if (Object.prototype.hasOwnProperty.call(vfs, clean + '.ts')) return vfs[clean + '.ts'];
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
                            
                            const pipelineDefs = grammarDef.pipelines ? Object.entries(grammarDef.pipelines).map(([id, p]) => ({
                                id: id,
                                label: p.label || id,
                                target: p.target || id
                            })) : [];

                            self.postMessage({ 
                                type: 'success', 
                                wasm: vfs['parser.wasm'], 
                                jsWrapper: result.javascriptWrapper.js,
                                syntaxNames: result.javascriptWrapper.syntaxNames,
                                fieldNames: result.javascriptWrapper.fieldNames,
                                semanticLegend: result.javascriptWrapper.semanticLegend,
                                pipelines: pipelineDefs,
                                langName: grammarDef.name
                            });
                        } catch (err) {
                            self.postMessage({ type: 'error', error: err.message });
                        }
                    }, 50);
                } catch (err) {
                    self.postMessage({ type: 'error', error: err.message });
                }
            }, 50);
        } catch (err) {
            self.postMessage({ type: 'error', error: err.message });
        }
    }
};
`;
}

export function getLspWorkerJs() {
  return `
// LSP Worker (Standalone JSON-RPC without CDNs)
self.onerror = function(message, source, lineno, colno, error) {
    console.error("[LSP Worker Error Details]:", message, "at line", lineno, "col", colno, error);
    try {
        const errMsg = error ? (error.stack || error.message) : (typeof message === 'string' ? message : "Worker execution error");
        self.postMessage({ type: 'error', error: 'LSP Worker Error: ' + errMsg });
    } catch(e) {}
};

let lspFacade = null;
let latestUri = 'inmemory://example.mo';
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

function pushPatch(op, ptr, typeId, oldPtr, pad, len, flags, children) {
    if (patchOffset + 12 + (children ? children.length * 2 : 0) > patchInt32.length) {
        try {
            const newSize = Math.min(patchBuffer.byteLength * 2, 64 * 1024 * 1024);
            if (newSize <= patchBuffer.byteLength) return; // Cannot grow further
            const old = patchInt32;
            const grown = new ArrayBuffer(newSize);
            patchInt32 = new Int32Array(grown);
            patchInt32.set(old);
            patchBuffer = grown;
            patchBufferA = grown;
            patchBufferB = new ArrayBuffer(newSize);
        } catch (e) {
            console.warn("pushPatch: buffer grow failed", e);
            return;
        }
    }
    patchInt32[patchOffset++] = op;
    patchInt32[patchOffset++] = ptr;
    patchInt32[patchOffset++] = typeId || 0;
    patchInt32[patchOffset++] = oldPtr || 0;
    patchInt32[patchOffset++] = pad || 0;
    patchInt32[patchOffset++] = len || 0;
    patchInt32[patchOffset++] = children ? children.length : 0;
    patchInt32[patchOffset++] = flags || 0;
    if (Number.isNaN(pad) || Number.isNaN(len)) {
        console.error("pushPatch received NaN! pad:", pad, "len:", len, "typeId:", typeId);
    }
    if (children) {
        for (let i = 0; i < children.length; i++) {
            patchInt32[patchOffset++] = children[i].ptr;
            patchInt32[patchOffset++] = children[i].fieldId !== undefined ? children[i].fieldId : -1;
        }
    }
}

let pendingChanges = [];
let isParsing = false;

function triggerDiagnostics(changes = null) {
    if (changes && changes.length > 0) {
        pendingChanges.push(...changes);
    }
    
    if (isParsing) return;
    runDiagnosticsNow();
}

async function runDiagnosticsNow() {
    if (!lspFacade || pendingChanges.length === 0) return;
    
    isParsing = true;
    const batch = pendingChanges.splice(0, pendingChanges.length);
    
    try {
        const lineStarts = lspFacade.getLineStarts();
        const charMult = (lspFacade && typeof lspFacade.getInputEncoding === 'function' ? lspFacade.getInputEncoding() : 1) === 1 ? 2 : 1;
        
        let editsToApply = [];
        let isFullReplacement = false;
        let fullText = null;

        for (const change of batch) {
            if (change.text !== undefined && change.range === undefined && change.rangeOffset === undefined) {
                isFullReplacement = true;
                fullText = change.text;
                editsToApply = [];
            } else if (!isFullReplacement) {
                let rangeOffset = change.rangeOffset;
                let rangeLength = change.rangeLength;
                if (rangeOffset === undefined && change.range) {
                    const startLine = change.range.startLineNumber !== undefined ? change.range.startLineNumber - 1 : change.range.start.line;
                    const startCol = change.range.startColumn !== undefined ? change.range.startColumn - 1 : change.range.start.character;
                    const endLine = change.range.endLineNumber !== undefined ? change.range.endLineNumber - 1 : change.range.end.line;
                    const endCol = change.range.endColumn !== undefined ? change.range.endColumn - 1 : change.range.end.character;
                    
                    const startByte = (lineStarts && startLine < lineStarts.length ? lineStarts[startLine] : 0) + (startCol * charMult);
                    const endByte = (lineStarts && endLine < lineStarts.length ? lineStarts[endLine] : 0) + (endCol * charMult);
                    
                    rangeOffset = Math.floor(startByte / charMult);
                    rangeLength = Math.max(0, Math.floor((endByte - startByte) / charMult));
                }
                if (rangeOffset !== undefined) {
                    editsToApply.push({
                        rangeOffset: rangeOffset,
                        rangeLength: rangeLength || 0,
                        text: change.text || ""
                    });
                }
            }
        }

        patchOffset = 0;
        const t0 = performance.now();

        if (isFullReplacement && fullText !== null) {
            const oldLen = currentTextLength;
            currentTextLength = fullText.length;
            lspFacade.lastAstRoot = 0;
            globalAstRoot = lspFacade.parseIncremental(fullText, 0, oldLen, fullText.length);
        } else if (editsToApply.length > 0) {
            let newTotalLen = currentTextLength;
            for (const edit of editsToApply) {
                newTotalLen = newTotalLen - edit.rangeLength + edit.text.length;
            }
            currentTextLength = newTotalLen;
            if (editsToApply.length === 1) {
                const edit = editsToApply[0];
                globalAstRoot = lspFacade.parseIncremental(edit.text, edit.rangeOffset, edit.rangeLength, newTotalLen);
            } else {
                globalAstRoot = lspFacade.parseIncrementalBatch(editsToApply, newTotalLen);
            }
        } else {
            return;
        }

        const t1 = performance.now();
        const updatedLineStarts = lspFacade.getLineStarts();
        const rawDiags = lspFacade.getDiagnostics(globalAstRoot);
        
        const diags = (rawDiags || []).map(d => ({
            range: d.range,
            severity: d.severity,
            code: d.code,
            message: d.message,
            source: currentLangName,
            startCharOffset: d.startCharOffset,
            endCharOffset: d.endCharOffset
        }));
        
        let patchBufToTransfer = patchBuffer.slice(0, patchOffset * 4);
        patchBuffer = (patchBuffer === patchBufferA) ? patchBufferB : patchBufferA;
        patchInt32 = new Int32Array(patchBuffer);
        
        let lineStartsBuf = updatedLineStarts ? updatedLineStarts.buffer.slice(updatedLineStarts.byteOffset, updatedLineStarts.byteOffset + updatedLineStarts.byteLength) : null;
        
        const patchMsg = {
            type: 'astPatchBinary',
            rootId: globalAstRoot,
            buffer: patchBufToTransfer,
            lineStartsBuffer: lineStartsBuf,
            diagnostics: diags,
            isFullReset: isFullReplacement,
            charMult: charMult
        };
        
        self.postMessage(patchMsg, [patchBufToTransfer]);
        self.postMessage({
            jsonrpc: '2.0',
            method: 'textDocument/publishDiagnostics',
            params: { uri: latestUri, diagnostics: diags }
        });
    } catch(err) {
        console.error("LSP Worker Diagnostics Error:", err);
    } finally {
        isParsing = false;
        if (pendingChanges.length > 0) {
            setTimeout(runDiagnosticsNow, 10);
        }
    }
}

self.onmessage = async (e) => {
    if (!e.data) return;
    
    if (e.data.type === 'config' || e.data.type === 'setConfig') {
        if (lspFacade) {
            lspFacade.setParserConfig(e.data.config.branchA1, e.data.config.branchB, e.data.config.branchC, e.data.config.islandMode);
            
            // Force a re-parse by faking a full text change
            if (latestUri && currentTextLength > 0) {
                const text = lspFacade.exports.getInputBuffer ? 
                    new TextDecoder('utf-16le').decode(new Uint8Array(lspFacade.wasmMemory.buffer, lspFacade.exports.getInputBuffer(), currentTextLength * 2)) : "";
                
                lspFacade.resetParser();
                currentTextLength = 0;
                triggerDiagnostics([{ text: text.replace(/\0/g, ''), rangeOffset: undefined, rangeLength: undefined }]);
            }
        }
        return;
    }
        
    if (e.data.type === 'init') {
        console.log("LSP initialized with new WASM parser");
        const { wasm, jsWrapper, syntaxNames, langName } = e.data;
        if (langName) currentLangName = langName;
        
        try {
            const memory = new WebAssembly.Memory({ initial: 4000, maximum: 16384, shared: true });
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
                engine: { debugLog: function(cat, v1, v2, v3) { 
                    if (cat === 888801) console.log("[SEM]", "offset=" + v1, "len=" + v2, "type=" + v3); 
                    if (cat === 888800) console.log("[NODE_START]", "type=" + v1, "nodeOffset=" + v2, "pad=" + v3);
                    if (cat === 888802) console.log("[NODE_INFO]", "len=" + v1, "ptr=" + v2, "inError=" + v3);
                    if (cat === 888803) console.log("  [CHILD_CALC]", "childType=" + v1, "parentOffset=" + v2, "childPad=" + v3);
                    if (cat === 888804) console.log("  [CHILD_CALC2]", "childLen=" + v1, "cLen(pad+len)=" + v2);
                    if (cat >= 900) console.log("DEBUG [" + cat + "]", v1, v2, v3);
                } },
                parser: { 
                    logInt: function(val) { console.log("logInt:", val); },
                    emitTextEdit: function(op, len, start, end) {},
                    getSourceSlice: function(start, end) { return 0; }
                },
                host: {
                    runHostQuery: function(a, b, c, d) { return 0; }
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
            
            let wasmBytes = wasm;
            if (wasmBytes && !(wasmBytes instanceof ArrayBuffer) && wasmBytes.buffer) {
                wasmBytes = wasmBytes.buffer;
            }
            if (wasmBytes && wasmBytes instanceof ArrayBuffer) {
                wasmBytes = new Uint8Array(wasmBytes);
            }

            const { instance } = await WebAssembly.instantiate(wasmBytes, imports);
            
            let LspFacade;
            try {
                const cleanedJs = jsWrapper
                    .replace(/^\\s*export\\s+\\{[\\s\\S]*?\\};?/gm, "")
                    .replace(/^\\s*export\\s+default\\s+/gm, "")
                    .replace(/^\\s*export\\s+(var|let|const|class|function|enum|interface|type|declare|async function)\\s+/gm, "$1 ")
                    .replace(/^\\s*export\\b.*/gm, "// $&");
                const evalFn = new Function(cleanedJs + "; return LspFacade;");
                LspFacade = evalFn();
            } catch (e1) {
                console.error("Evaluation failed for LspFacade in worker-lsp:", e1);
                throw e1;
            }

            const origLog = console.log;
            console.log = function(...args) {
                if (args[0] && typeof args[0] === 'string' && (args[0].startsWith('[SEM]') || args[0].startsWith('[NODE_START]') || args[0].startsWith('[NODE_INFO]') || args[0].includes('CHILD_CALC'))) {
                    self.postMessage({ type: 'worker_log', args: args });
                }
                origLog.apply(console, args);
            };
            
            lspFacade = new LspFacade(memory, instance.exports);
            if (syntaxNames) lspFacade.syntaxNames = syntaxNames;
            
            lspFacade.addAstChangeListener({
                onNodeInserted: (ptr, typeId, typeName, pad, len, flags, children) => pushPatch(1, ptr, typeId, 0, pad, len, flags, children),
                onNodeDeleted: (ptr) => pushPatch(3, ptr, 0, 0, 0, 0, 0, null),
                onNodeRetained: (ptr, flags) => {
                    if (flags !== undefined) {
                        pushPatch(4, ptr, 0, ptr, 0, 0, flags, null);
                    }
                },
                onNodeUpdated: (newPtr, oldPtr, typeId, typeName, pad, len, flags, children) => pushPatch(2, newPtr, typeId, oldPtr, pad, len, flags, children)
            });

            console.log("LspFacade successfully loaded inside worker.");
            console.log("FACADE SYNTAX NAMES: ", JSON.stringify(lspFacade.syntaxNames));
            if (e.data.initialConfig) {
                lspFacade.setParserConfig(e.data.initialConfig.branchA1, e.data.initialConfig.branchB, e.data.initialConfig.branchC, e.data.initialConfig.islandMode);
            }
            if (e.data.initialText !== undefined && e.data.initialText !== null) {
                pendingFullText = e.data.initialText;
            }
            if (pendingFullText !== null) {
                triggerDiagnostics([{ text: pendingFullText }]);
                pendingFullText = null;
            }
        } catch(err) {
            console.error("LSP Worker WASM Init Error:", err);
            self.postMessage({ type: 'error', error: 'LSP Worker WASM Init Error: ' + (err.stack || err.message || err) });
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
        const charMult = (lspFacade && typeof lspFacade.getInputEncoding === 'function' ? lspFacade.getInputEncoding() : 1) === 1 ? 2 : 1;
        let offset = 0;
        if (pos.line < lineStarts.length) {
            offset = lineStarts[pos.line] + (pos.character * charMult);
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
        const charMult = (lspFacade && typeof lspFacade.getInputEncoding === 'function' ? lspFacade.getInputEncoding() : 1) === 1 ? 2 : 1;
        let offset = 0;
        if (pos.line < lineStarts.length) {
            offset = lineStarts[pos.line] + (pos.character * charMult);
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
        const charMult = (lspFacade && typeof lspFacade.getInputEncoding === 'function' ? lspFacade.getInputEncoding() : 1) === 1 ? 2 : 1;
        if (pos.line < lineStarts.length) {
            offset = lineStarts[pos.line] + (pos.character * charMult);
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
    } else if (e.data.method === 'textDocument/semanticTokens/full' || e.data.method === 'textDocument/semanticTokens/range') {
        try {
            if (!lspFacade || !globalAstRoot) return self.postMessage({ jsonrpc: '2.0', id: e.data.id, result: null });
            const t0 = performance.now();
            const tokensArray = lspFacade.getSemanticTokens(globalAstRoot);
            const t1 = performance.now();
            
            if (!tokensArray || tokensArray.length === 0) {
                return self.postMessage({ jsonrpc: '2.0', id: e.data.id, result: null });
            }
            
            const lineStarts = lspFacade.getLineStarts();
            if (!lineStarts || lineStarts.length === 0) {
                return self.postMessage({ jsonrpc: '2.0', id: e.data.id, result: null });
            }
            
            let startOffset = 0;
            let endOffset = 0xFFFFFFFF;
            const charMult = (lspFacade && typeof lspFacade.getInputEncoding === 'function' ? lspFacade.getInputEncoding() : 1) === 1 ? 2 : 1;

            if (e.data.method === 'textDocument/semanticTokens/range' && e.data.params.range) {
                const range = e.data.params.range;
                startOffset = (range.start.line < lineStarts.length ? lineStarts[range.start.line] : 0) + range.start.character * charMult;
                endOffset = (range.end.line < lineStarts.length ? lineStarts[range.end.line] : lineStarts[lineStarts.length - 1]) + range.end.character * charMult;
            }
            
            const count = tokensArray.length / 4;
            const validIndices = [];
            for (let i = 0; i < count; i++) {
                const offset = tokensArray[i * 4];
                if (offset >= startOffset && offset <= endOffset) {
                    validIndices.push(i);
                }
            }
            
            // Sort indices by absolute offset to satisfy Monaco's requirement for strictly ascending token positions
            // If offsets are equal, sort by length ASCENDING so more specific tokens take precedence
            validIndices.sort((a, b) => {
                const diff = tokensArray[a * 4] - tokensArray[b * 4];
                if (diff !== 0) return diff;
                return tokensArray[a * 4 + 1] - tokensArray[b * 4 + 1];
            });
            
            const validCount = validIndices.length;
            const data = new Uint32Array(validCount * 5);
            let dataIdx = 0;
            let prevLine = 0;
            let prevChar = 0;
            let prevEndOffset = -1;
            
            for (let i = 0; i < validCount; i++) {
                const baseIdx = validIndices[i] * 4;
                const offset = tokensArray[baseIdx];
                const length = tokensArray[baseIdx + 1];
                const tokenType = tokensArray[baseIdx + 2];
                const tokenModifiers = tokensArray[baseIdx + 3];
                
                // Skip tokens with offsets past the end of the source text
                // (can happen when ERROR node byte lengths are inflated during recovery)
                if (offset >= lineStarts[lineStarts.length - 1] + 10000) continue;
                if (length === 0) continue;
                
                // Enforce LSP specification: tokens MUST be strictly non-overlapping
                if (offset < prevEndOffset) continue;
                
                let line = 0;
                let low = 0;
                let high = lineStarts.length - 1;
                while (low <= high) {
                    let mid = (low + high) >> 1;
                    if (lineStarts[mid] <= offset) {
                        line = mid;
                        low = mid + 1;
                    } else {
                        high = mid - 1;
                    }
                }
                const charOffset = Math.floor((offset - lineStarts[line]) / charMult);
                let charLength = Math.floor(length / charMult);
                
                // Clamp token length to not extend past the end of the current line
                // (prevents Monaco's "end character > model.getLineLength" error)
                // Note: lineStarts diff includes newline characters. We subtract 1 as a safe buffer.
                if (line + 1 < lineStarts.length) {
                    const lineEndChar = Math.max(0, Math.floor((lineStarts[line + 1] - lineStarts[line]) / charMult) - 1);
                    if (charOffset + charLength > lineEndChar) {
                        charLength = Math.max(0, lineEndChar - charOffset);
                    }
                }
                
                const deltaLine = line - prevLine;
                const deltaChar = deltaLine === 0 ? charOffset - prevChar : charOffset;
                
                if (deltaLine < 0 || deltaChar < 0 || charLength <= 0) continue;
                
                data[dataIdx++] = deltaLine;
                data[dataIdx++] = deltaChar;
                data[dataIdx++] = charLength;
                data[dataIdx++] = tokenType;
                data[dataIdx++] = tokenModifiers;
                
                prevLine = line;
                prevChar = charOffset;
                prevEndOffset = offset + length;
            }
            
            console.log("Semantic Tokens computed:", (dataIdx / 5), "valid tokens (", validCount, "total) in range", startOffset, "to", endOffset);
            const tokensList = Array.from(data.subarray(0, dataIdx));
            self.postMessage({ jsonrpc: '2.0', id: e.data.id, result: { data: tokensList } });
        } catch (err) {
            console.error("Semantic Tokens Worker Error:", err);
            self.postMessage({ jsonrpc: '2.0', id: e.data.id, result: null });
        }
    }
};
`;
}
