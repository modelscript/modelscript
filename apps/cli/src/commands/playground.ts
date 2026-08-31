import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CommandModule } from "yargs";

function bundleDsl(entryPath: string): string {
  if (!existsSync(entryPath)) return "";

  const visited = new Set<string>();
  const importedChunks: string[] = [];

  function processFile(filePath: string, isEntry: boolean): string {
    const resolvedPath = resolve(filePath);
    if (visited.has(resolvedPath)) return "";
    visited.add(resolvedPath);

    let content = readFileSync(resolvedPath, "utf-8");
    const dir = dirname(resolvedPath);

    // Find relative imports and exports: import ... from "./xyz.js", export * from "./xyz.js", etc.
    const importRegex =
      /(?:import|export)\s+(?:type\s+)?(?:(\{[^}]+\})|(\*\s+as\s+[a-zA-Z0-9_$]+)|\*|([a-zA-Z0-9_$]+))?\s*(?:from\s+)?['"](\.[^'"]+)['"];?/g;
    let match: RegExpExecArray | null;

    while ((match = importRegex.exec(content)) !== null) {
      const relPath = match[4];
      if (!relPath) continue;
      const candidates = [
        join(dir, relPath),
        join(dir, relPath.replace(/\.js$/, ".ts")),
        join(dir, relPath + ".ts"),
        join(dir, relPath + ".js"),
        join(dir, relPath, "index.ts"),
        join(dir, relPath, "index.js"),
      ];
      const target = candidates.find((c) => existsSync(c));
      if (target) {
        processFile(target, false);
      }
    }

    // Strip relative imports and re-exports from this file
    content = content.replace(
      /(?:import|export)\s+(?:type\s+)?(?:(\{[^}]+\})|(\*\s+as\s+[a-zA-Z0-9_$]+)|\*|([a-zA-Z0-9_$]+))?\s*(?:from\s+)?['"]\.[^'"]+['"];?\n?/g,
      "",
    );
    content = content.replace(/export\s*\*\s*from\s+['"][^'"]+['"];?\n?/g, "");
    content = content.replace(/export\s*\{[\s\S]*?\}(?:\s*from\s+['"][^'"]+['"])?;?\n?/g, "");

    if (!isEntry) {
      // In helper files, also strip external @modelscript/language imports
      content = content.replace(/import\s+[\s\S]*?from\s+['"]@modelscript\/language['"];?\n?/g, "");
      importedChunks.push(content.trim());
      return "";
    }

    return content;
  }

  const mainContent = processFile(entryPath, true);
  return (importedChunks.length > 0 ? importedChunks.join("\n\n") + "\n\n" : "") + mainContent;
}

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

        const dslPathCandidate = join(__dirname, "../../../../packages/language/src/dsl/language.ts");
        const dslPath = existsSync(dslPathCandidate)
          ? dslPathCandidate
          : join(__dirname, "../../../../packages/language/src/dsl/dsl.ts");
        let dslLibStr = "";
        let dslLibModuleStr = "";
        if (existsSync(dslPath)) {
          dslLibModuleStr = readFileSync(dslPath, "utf-8");
          dslLibStr = dslLibModuleStr.replace(/^export\s+/gm, "");
        }

        const modelicaPath = join(__dirname, "../../../../languages/modelica/src/language.ts");
        let initialDsl = "";
        if (existsSync(modelicaPath)) {
          initialDsl = bundleDsl(modelicaPath);
        }

        const initialCode = `model ElectricalCircuit
  Pin p, n;
  parameter Real R = 100.0;
  parameter Real L = 0.001;
  Real v, i;
equation
  v = p.v - n.v;
  0 = p.i + n.i;
  i = p.i;
  v = R * i;
end ElectricalCircuit;

model ChuaCircuit
  Pin p, n;
  Real vC1, vC2, iL;
  parameter Real C1 = 10.0;
  parameter Real C2 = 100.0;
  parameter Real L = 18.0;
  parameter Real G = 0.7;
equation
  C1 * der(vC1) = G * (vC2 - vC1);
  C2 * der(vC2) = G * (vC1 - vC2) + iL;
  L * der(iL) = -vC2;
end ChuaCircuit;`;

        res.end(getIndexHtml(dslLibStr, dslLibModuleStr, initialDsl, initialCode));
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
      } else if (urlPath === "/diagram.browser.js") {
        headers["Content-Type"] = "application/javascript";
        res.writeHead(200, headers);
        const diagramJsPath = join(__dirname, "../../../../packages/language/dist/diagram.browser.js");
        res.end(existsSync(diagramJsPath) ? readFileSync(diagramJsPath) : "");
      } else if (urlPath?.startsWith("/vendor/")) {
        headers["Content-Type"] = "application/javascript";
        res.writeHead(200, headers);
        const fileName = urlPath.slice(8);
        const vendorDist = join(__dirname, "../vendor", fileName);
        const vendorSrc = join(__dirname, "../../src/vendor", fileName);
        const vendorPath = existsSync(vendorDist) ? vendorDist : vendorSrc;
        res.end(existsSync(vendorPath) ? readFileSync(vendorPath) : "");
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

export function getIndexHtml(dslLibStr = "", dslLibModuleStr = "", initialDsl = "", initialCode = "") {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>ModelScript Playground</title>
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
        html, body { margin: 0; padding: 0; display: flex; flex-direction: column; height: 100vh; width: 100vw; overflow: hidden; font-family: -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji"; background: var(--bg-color); color: var(--text-color); }
        #toolbar { height: 48px; min-height: 48px; box-sizing: border-box; padding: 8px 16px; background: var(--toolbar-bg); border-bottom: 1px solid var(--border-color); display: flex; align-items: center; gap: 12px; }
        #editors { display: flex; flex: 1; height: calc(100vh - 48px); min-height: 0; min-width: 0; }
        #dsl-editor { flex: 1; border-right: 1px solid var(--border-color); min-width: 0; height: 100%; min-height: 0; }
        #right-pane { flex: 1; display: flex; flex-direction: column; min-width: 0; height: 100%; min-height: 0; }
        #code-editor { flex: 1; border-bottom: 1px solid var(--border-color); min-width: 0; min-height: 0; height: 50%; }
        #react-ast-root { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; height: 50%; background: var(--toolbar-bg); }
        #ast-viewer { flex: 1; overflow: auto; padding: 10px; font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace; white-space: pre; font-size: 12px; min-height: 0; }
        
        .ghost-node { opacity: 0.6; color: #d73a49; font-style: italic; }
        .ghost-node::after { content: " (inserted)"; font-size: 10px; }
        
        .primer-btn {
            background-color: var(--btn-bg);
            color: var(--btn-text);
            border: 1px solid rgba(27, 31, 36, 0.15);
            border-radius: 6px;
            padding: 6px 14px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            box-shadow: 0 1px 0 rgba(27, 31, 36, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.25);
            transition: 0.2s cubic-bezier(0.3, 0, 0.5, 1);
        }
        .primer-btn:hover {
            background-color: var(--btn-hover);
        }
        .primer-btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }
        .status-badge {
            font-size: 12px;
            color: #57606a;
            display: flex;
            align-items: center;
            gap: 8px;
            margin-left: auto;
        }
        .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background-color: #2da44e;
            display: inline-block;
        }
        .status-dot.building {
            background-color: #bf8700;
            animation: pulse 1.5s infinite;
        }
        .status-dot.error {
            background-color: #cf222e;
        }
        @keyframes pulse {
            0% { transform: scale(0.95); opacity: 0.5; }
            50% { transform: scale(1.1); opacity: 1; }
            100% { transform: scale(0.95); opacity: 0.5; }
        }
        .tab-btn {
            background: none;
            border: none;
            border-bottom: 2px solid transparent;
            padding: 8px 16px;
            cursor: pointer;
            font-weight: 600;
            font-size: 13px;
            color: var(--text-color);
            opacity: 0.7;
        }
        .tab-btn.active {
            opacity: 1;
            border-bottom-color: #fd8c73;
        }
        #right-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid var(--border-color);
            background: var(--toolbar-bg);
        }
        #ast-viewer-controls {
            display: flex;
            gap: 8px;
            padding-right: 12px;
            font-size: 12px;
        }
    </style>
    <!-- Scripts: React, Babel, LZString before Monaco AMD loader to avoid define() conflicts -->
    <script src="/vendor/react.production.min.js"></script>
    <script src="/vendor/react-dom.production.min.js"></script>
    <script src="/node_modules/@babel/standalone/babel.min.js"></script>
    <script src="/node_modules/lz-string/libs/lz-string.min.js"></script>
    <script type="module">
        import * as Diagram from "/diagram.browser.js";
        window.DiagramModule = Diagram;
        window.dispatchEvent(new Event('diagramModuleLoaded'));
    </script>
    <script src="/node_modules/monaco-editor/min/vs/loader.js"></script>
</head>
<body>
    <div id="toolbar">
        <div style="display: flex; align-items: center; gap: 8px;">
            <img src="/logo.png" alt="Logo" style="height: 24px; width: auto;" class="dark-only" onerror="this.style.display='none'">
            <img src="/logo-light.png" alt="Logo" style="height: 24px; width: auto;" class="light-only" onerror="this.style.display='none'">
            <h1 style="margin: 0; font-size: 14px; font-weight: 600;">ModelScript Playground</h1>
        </div>
        <button id="btn-compile" class="primer-btn">
            <svg aria-hidden="true" height="14" viewBox="0 0 16 16" version="1.1" width="14" style="fill: currentColor;">
                <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm4.879-2.773 4.264 2.559a.25.25 0 0 1 0 .428l-4.264 2.559A.25.25 0 0 1 6 10.559V5.442a.25.25 0 0 1 .379-.215Z"></path>
            </svg>
            Build Grammar (Ctrl+Enter)
        </button>
        <button id="btn-format" class="primer-btn" style="background-color: var(--border-color); color: var(--text-color);" title="Format DSL (Alt+Shift+F)">
            Format DSL
        </button>
        <button id="btn-share" class="primer-btn" style="background-color: var(--border-color); color: var(--text-color);" title="Copy Shareable Link">
            Share
        </button>
        <div style="display: flex; gap: 12px; font-size: 12px; align-items: center;">
            <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                <input type="checkbox" id="toggle-branch-a1" checked> Deletion Recovery
            </label>
            <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                <input type="checkbox" id="toggle-branch-b" checked> Insertion Recovery
            </label>
            <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                <input type="checkbox" id="toggle-branch-c" checked> Forced Reduction
            </label>
            <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                <input type="checkbox" id="toggle-island-mode" checked> Island Mode
            </label>
            <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;" title="Toggle Monaco Monarch syntax token colorizer">
                <input type="checkbox" id="toggle-monarch" checked> Monarch Colorizer
            </label>
            <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                <input type="checkbox" id="toggle-verbose-log"> Verbose Log
            </label>
        </div>
        <div class="status-badge">
            <span id="status-indicator" class="status-dot"></span>
            <span id="status">Ready</span>
        </div>
    </div>
    <div id="editors">
        <div id="dsl-editor"></div>
        <div id="right-pane">
            <div id="code-editor"></div>
            <div id="react-ast-root"></div>
        </div>
    </div>

    <script>
        require.config({ paths: { 'vs': '/node_modules/monaco-editor/min/vs' }});

        // Initialize Share functionality (hash encoding/decoding)
        function getShareState() {
            try {
                if (window.location.hash && window.location.hash.length > 1) {
                    const compressed = window.location.hash.substring(1);
                    const jsonStr = LZString.decompressFromEncodedURIComponent(compressed);
                    if (jsonStr) {
                        return JSON.parse(jsonStr);
                    }
                }
            } catch (e) {
                console.error("Failed to restore state from URL hash:", e);
            }
            return null;
        }

        function updateShareUrl(dsl, code) {
            try {
                const state = { dsl, code };
                const compressed = LZString.compressToEncodedURIComponent(JSON.stringify(state));
                window.history.replaceState(null, '', '#' + compressed);
            } catch (e) {
                console.error("Failed to update URL hash:", e);
            }
        }

        require(['vs/editor/editor.main'], function() {
            // Setup DSL environment types for monaco
            monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
                target: monaco.languages.typescript.ScriptTarget.ES2020 || monaco.languages.typescript.ScriptTarget.ESNext || 99,
                module: monaco.languages.typescript.ModuleKind.ESNext || 99,
                moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs || 2,
                allowNonTsExtensions: true,
                downlevelIteration: true,
                lib: ["es2020", "esnext", "dom"],
                noEmit: true,
                esModuleInterop: true,
            });

            const dslLib = ${JSON.stringify(dslLibStr)};
            const dslLibModule = ${JSON.stringify(dslLibModuleStr)};
            const dslModuleDecl = ${JSON.stringify('declare module "@modelscript/language" {\n' + dslLibModuleStr + "\n}")};
            monaco.languages.typescript.typescriptDefaults.addExtraLib(dslLib, 'ts:filename/dsl.d.ts');
            monaco.languages.typescript.typescriptDefaults.addExtraLib(dslModuleDecl, 'file:///node_modules/@modelscript/language/index.d.ts');
            monaco.languages.typescript.typescriptDefaults.addExtraLib(dslModuleDecl, 'node_modules/@modelscript/language/index.d.ts');
            monaco.languages.typescript.typescriptDefaults.addExtraLib(dslModuleDecl, 'ts:filename/dsl-module.d.ts');

            monaco.editor.defineTheme('dark-modern', {
                base: 'vs-dark',
                inherit: true,
                semanticHighlighting: true,
                rules: [
                    { token: 'keyword', foreground: '569cd6' },
                    { token: 'keyword.control', foreground: 'c586c0' },
                    { token: 'keyword.flow', foreground: 'c586c0' },
                    { token: 'type', foreground: '4ec9b0' },
                    { token: 'class', foreground: '4ec9b0' },
                    { token: 'class.declaration', foreground: '4ec9b0' },
                    { token: 'interface', foreground: '4ec9b0' },
                    { token: 'struct', foreground: '4ec9b0' },
                    { token: 'enum', foreground: '4ec9b0' },
                    { token: 'typeParameter', foreground: '4ec9b0' },
                    { token: 'function', foreground: 'dcdcaa' },
                    { token: 'method', foreground: 'dcdcaa' },
                    { token: 'property', foreground: '9cdcfe' },
                    { token: 'property.declaration', foreground: '9cdcfe' },
                    { token: 'variable', foreground: '9cdcfe' },
                    { token: 'variable.name', foreground: '9cdcfe' },
                    { token: 'variable.parameter', foreground: '9cdcfe' },
                    { token: 'parameter', foreground: '9cdcfe' },
                    { token: 'enumMember', foreground: '4fc1ff' },
                    { token: 'number', foreground: 'b5cea8' },
                    { token: 'string', foreground: 'ce9178' },
                    { token: 'comment', foreground: '6a9955', fontStyle: 'italic' },
                    { token: 'constant', foreground: '4fc1ff' },
                    { token: 'delimiter', foreground: 'd4d4d4' },
                    { token: 'operator', foreground: 'd4d4d4' },
                    { token: 'namespace', foreground: '4ec9b0' },
                    { token: 'tag', foreground: '569cd6' }
                ],
                colors: {
                    'editor.background': '#1f1f1f',
                    'editor.foreground': '#cccccc',
                    'editor.lineHighlightBackground': '#282828',
                    'editorCursor.foreground': '#aeafad',
                    'editor.selectionBackground': '#264f78',
                    'editor.inactiveSelectionBackground': '#3a3d41',
                    'editorLineNumber.foreground': '#6e7681',
                    'editorLineNumber.activeForeground': '#cccccc',
                    'editorIndentGuide.background1': '#3b3b3b',
                    'editorIndentGuide.activeBackground1': '#707070'
                }
            });

            monaco.editor.defineTheme('light-modern', {
                base: 'vs',
                inherit: true,
                semanticHighlighting: true,
                rules: [
                    { token: 'keyword', foreground: '0000ff' },
                    { token: 'keyword.control', foreground: 'af00db' },
                    { token: 'keyword.flow', foreground: 'af00db' },
                    { token: 'type', foreground: '267f99' },
                    { token: 'class', foreground: '267f99' },
                    { token: 'class.declaration', foreground: '267f99' },
                    { token: 'interface', foreground: '267f99' },
                    { token: 'struct', foreground: '267f99' },
                    { token: 'enum', foreground: '267f99' },
                    { token: 'typeParameter', foreground: '267f99' },
                    { token: 'function', foreground: '795e26' },
                    { token: 'method', foreground: '795e26' },
                    { token: 'property', foreground: '001080' },
                    { token: 'property.declaration', foreground: '001080' },
                    { token: 'variable', foreground: '001080' },
                    { token: 'variable.name', foreground: '001080' },
                    { token: 'variable.parameter', foreground: '001080' },
                    { token: 'parameter', foreground: '001080' },
                    { token: 'enumMember', foreground: '0070c1' },
                    { token: 'number', foreground: '098658' },
                    { token: 'string', foreground: 'a31515' },
                    { token: 'comment', foreground: '008000', fontStyle: 'italic' },
                    { token: 'constant', foreground: '0070c1' },
                    { token: 'delimiter', foreground: '000000' },
                    { token: 'operator', foreground: '000000' },
                    { token: 'namespace', foreground: '267f99' },
                    { token: 'tag', foreground: '800000' }
                ],
                colors: {
                    'editor.background': '#ffffff',
                    'editor.foreground': '#3b3b3b',
                    'editor.lineHighlightBackground': '#f8f8f8',
                    'editorCursor.foreground': '#000000',
                    'editor.selectionBackground': '#add6ff',
                    'editor.inactiveSelectionBackground': '#e5ebf1',
                    'editorLineNumber.foreground': '#6e7681',
                    'editorLineNumber.activeForeground': '#0b216f',
                    'editorIndentGuide.background1': '#d3d3d3',
                    'editorIndentGuide.activeBackground1': '#939393'
                }
            });

            const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
            const editorTheme = prefersDark ? 'dark-modern' : 'light-modern';

            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
                const newTheme = e.matches ? 'dark-modern' : 'light-modern';
                monaco.editor.setTheme(newTheme);
            });

            const exampleDSL = ${JSON.stringify(initialDsl)};
            const exampleCode = ${JSON.stringify(initialCode)};

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
                quickSuggestions: { other: true, comments: true, strings: true },
                suggestOnTriggerCharacters: true,
                acceptSuggestionOnEnter: 'on',
                tabCompletion: 'on',
                wordBasedSuggestions: 'off',
                'semanticHighlighting.enabled': true,
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
            lspWorker.addEventListener('message', (e) => {
                const msg = e.data;
                if (msg && (msg.type === 'astPatch' || msg.type === 'astPatchBinary')) {
                    window['__latestAstPatch'] = msg;
                    window.dispatchEvent(new CustomEvent('astPatch', { detail: msg }));
                    if (window['__semanticTokensEmitter']) {
                        window['__semanticTokensEmitter'].fire();
                    }

                    // Request diagram data if active
                    if (window['__activeTab'] === 'diagram' && window['__requestDiagramData']) {
                        if (window['__diagramDebounceTimer']) clearTimeout(window['__diagramDebounceTimer']);
                        window['__diagramDebounceTimer'] = setTimeout(() => {
                            window['__requestDiagramData']();
                        }, 400);
                    }

                    // Request pipeline data if active
                    if (window['__activeTab'] && window['__activeTab'] !== 'ast' && window['__activeTab'] !== 'diagram' && window['__activeTab'] !== 'diagnostics' && window['__activeTab'] !== 'grammar-conflicts') {
                        if (window['__pipelineDebounceTimer']) clearTimeout(window['__pipelineDebounceTimer']);
                        window['__pipelineDebounceTimer'] = setTimeout(() => {
                            if (window['__requestPipelineData']) window['__requestPipelineData'](window['__activeTab']);
                        }, 300);
                    }
                }
                if (msg && msg.result && msg.result.pipelineId) {
                    window['__latestPipelineData_' + msg.result.pipelineId] = msg.result;
                    window.dispatchEvent(new CustomEvent('pipelineDataUpdated', { detail: msg.result }));
                }
                if (msg && msg.result && (msg.result.nodes || msg.result.edges)) {
                    window['__latestDiagramData'] = msg.result;
                    window.dispatchEvent(new CustomEvent('diagramDataUpdated', { detail: msg.result }));
                }
                if (msg && msg.result && typeof msg.result.text === 'string' && msg.result.text.length > 0) {
                    const cleanText = msg.result.text.replace(/\0/g, '');
                    if (cleanText.length > 0 && window.codeEditor && window.codeEditor.getValue() !== cleanText) {
                        const pos = window.codeEditor.getPosition();
                        window.codeEditor.setValue(cleanText);
                        if (pos) window.codeEditor.setPosition(pos);
                    }
                }
            });

            window['__requestPipelineData'] = (pipelineId) => {
                lspWorker.postMessage({
                    jsonrpc: '2.0',
                    id: Date.now(),
                    method: 'modelscript/pipeline/execute',
                    params: { pipelineId }
                });
            };

            window['__requestDiagramData'] = () => {
                lspWorker.postMessage({
                    jsonrpc: '2.0',
                    id: Date.now(),
                    method: 'modelscript/diagram/getData',
                    params: {}
                });
            };

            window['__applyDiagramEdits'] = (actions) => {
                lspWorker.postMessage({
                    jsonrpc: '2.0',
                    id: Date.now(),
                    method: 'modelscript/diagram/applyEdits',
                    params: { actions }
                });
            };

            const compileBtn = document.getElementById('btn-compile') || document.getElementById('compile-btn');
            if (compileBtn) {
                compileBtn.onclick = () => {
                    document.getElementById('status').innerText = "Compiling DSL in browser...";
                    const dsl = window.dslEditor.getValue();
                    compilerWorker.postMessage({ type: 'compile', dsl });
                };
            }

            const formatBtn = document.getElementById('btn-format') || document.getElementById('format-btn');
            if (formatBtn) {
                formatBtn.onclick = () => {
                    if (window.codeEditor && window.codeEditor.hasTextFocus()) {
                        window.codeEditor.getAction('editor.action.formatDocument')?.run();
                    } else if (window.dslEditor) {
                        window.dslEditor.getAction('editor.action.formatDocument')?.run();
                    }
                };
            }

            const shareBtn = document.getElementById('btn-share') || document.getElementById('share-btn');
            if (shareBtn) {
                shareBtn.onclick = () => {
                    updateShareUrl(window.dslEditor.getValue(), window.codeEditor.getValue());
                    if (navigator.clipboard) {
                        navigator.clipboard.writeText(window.location.href).then(() => {
                            const originalText = shareBtn.innerText;
                            shareBtn.innerText = "Copied!";
                            setTimeout(() => { shareBtn.innerText = originalText; }, 2000);
                        });
                    }
                };
            }
            
            const updateDslGrammarMarkers = (conflicts) => {
                if (!window.dslEditor || !window.dslEditor.getModel()) return;
                const model = window.dslEditor.getModel();
                const markers = [];

                for (const conflict of (conflicts || [])) {
                    const rules = conflict.rules || [];
                    for (const rule of rules) {
                        const cleanRule = rule.replace(/^["']|["']$/g, '');
                        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(cleanRule)) continue;

                        const regexStr = '\\b' + cleanRule + '\\s*:';
                        const matches = model.findMatches(regexStr, false, true, false, null, true);
                        if (matches && matches.length > 0) {
                            for (const match of matches) {
                                markers.push({
                                    severity: monaco.MarkerSeverity.Warning,
                                    startLineNumber: match.range.startLineNumber,
                                    startColumn: match.range.startColumn,
                                    endLineNumber: match.range.endLineNumber,
                                    endColumn: match.range.startColumn + cleanRule.length,
                                    message: 'Grammar Conflict (' + conflict.type + '):\\n' + conflict.output.trim(),
                                    source: 'Grammar Analysis'
                                });
                            }
                        }
                    }
                }

                monaco.editor.setModelMarkers(model, 'grammar-conflicts', markers);
            };

            if (window.dslEditor) {
                window.dslEditor.onDidChangeModelContent(() => {
                    if (window.grammarConflicts && window.grammarConflicts.length > 0) {
                        updateDslGrammarMarkers(window.grammarConflicts);
                    }
                });
            }

            compilerWorker.onmessage = (e) => {
                if (e.data.type === 'ready') {
                    document.getElementById('status').innerText = "Compiler Worker ready. Compiling DSL...";
                    compilerWorker.postMessage({ type: 'compile', dsl: window.dslEditor.getValue() });
                } else if (e.data.type === 'error') {
                    document.getElementById('status').innerText = "Compiler Worker Error: " + e.data.error;
                    window.grammarConflicts = [];
                    window.dispatchEvent(new CustomEvent('grammarConflictsUpdated', { detail: [] }));
                    updateDslGrammarMarkers([]);
                } else if (e.data.type === 'progress') {
                    document.getElementById('status').innerText = e.data.message;
                } else if (e.data.type === 'success') {
                    const kb = (e.data.wasm.byteLength / 1024).toFixed(1);
                    document.getElementById('status').innerText = "Compiled successfully! LSP is active. (WASM: " + kb + " KB)";
                    window.syntaxNames = e.data.syntaxNames;
                    window.fieldNames = e.data.fieldNames;
                    window.diagramConfig = e.data.diagram;
                    window.pipelines = e.data.pipelines || [];
                    window.grammarConflicts = e.data.conflicts || [];
                    window.dispatchEvent(new Event('pipelinesUpdated'));
                    window.dispatchEvent(new Event('diagramDataUpdated'));
                    window.dispatchEvent(new CustomEvent('grammarConflictsUpdated', { detail: window.grammarConflicts }));
                    updateDslGrammarMarkers(window.grammarConflicts);
                    
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
                    window.currentLangId = langId;
                    window.monarchKeywords = keywords;
                    window.monarchTypeKeywords = typeKeywords;

                    function applyMonarchTokens() {
                        const enabled = document.getElementById('toggle-monarch')?.checked ?? true;
                        if (window.monarchDisposable) {
                            window.monarchDisposable.dispose();
                            window.monarchDisposable = null;
                        }
                        if (window.currentLangId) {
                            if (enabled) {
                                window.monarchDisposable = monaco.languages.setMonarchTokensProvider(window.currentLangId, {
                                    keywords: window.monarchKeywords || [],
                                    typeKeywords: window.monarchTypeKeywords || [],
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
                            } else {
                                window.monarchDisposable = monaco.languages.setMonarchTokensProvider(window.currentLangId, {
                                    tokenizer: {
                                        root: []
                                    }
                                });
                            }
                        }
                        if (window.codeEditor && window.codeEditor.getModel()) {
                            const model = window.codeEditor.getModel();
                            monaco.editor.setModelLanguage(model, 'plaintext');
                            monaco.editor.setModelLanguage(model, window.currentLangId || 'exampledsl');
                            if (model.tokenization && typeof model.tokenization.resetTokenization === 'function') {
                                model.tokenization.resetTokenization();
                            }
                        }
                    }
                    window.applyMonarchTokens = applyMonarchTokens;
                    applyMonarchTokens();

                    if (window.semanticTokensProvider) {
                        window.semanticTokensProvider.dispose();
                    }
                    if (window.semanticTokensRangeProvider) {
                        window.semanticTokensRangeProvider.dispose();
                    }
                    if (e.data.semanticLegend) {
                        const getLegend = function () { return e.data.semanticLegend; };
                        if (window['__semanticTokensEmitter']) {
                            window['__semanticTokensEmitter'].dispose();
                        }
                        const semanticTokensEmitter = new monaco.Emitter();
                        window['__semanticTokensEmitter'] = semanticTokensEmitter;

                        const providerObj = {
                            getLegend,
                            legend: e.data.semanticLegend,
                            onDidChange: semanticTokensEmitter.event,
                            provideDocumentSemanticTokens: async (model, lastResultId, token) => {
                                if (token.isCancellationRequested) return null;
                                const result = await languageClient.sendRequest('textDocument/semanticTokens/full', { textDocument: { uri: model.uri.toString() } }).catch(() => null);
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
                            legend: e.data.semanticLegend,
                            provideDocumentRangeSemanticTokens: async (model, range, token) => {
                                if (token.isCancellationRequested) return null;
                                const result = await languageClient.sendRequest('textDocument/semanticTokens/range', {
                                    textDocument: { uri: model.uri.toString() },
                                    range: {
                                        start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
                                        end: { line: range.endLineNumber - 1, character: range.endColumn - 1 }
                                    }
                                }).catch(() => null);
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
                        window.codeEditor.updateOptions({
                            'semanticHighlighting.enabled': true,
                            semanticHighlighting: { enabled: true }
                        });
                        if (model.tokenization && typeof model.tokenization.resetTokenization === 'function') {
                            model.tokenization.resetTokenization();
                        }
                    }

                    if (typeof window.registerLspProvidersForLanguage === 'function') {
                        window.registerLspProvidersForLanguage(langId);
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
                    this.editor.onDidChangeModelContent((e) => {
                        console.log("[Main Client] onDidChangeModelContent: " + e.changes.length + " change(s):", e.changes);
                        this.syncDocument('textDocument/didChange', e.changes);
                    });
                    
                    // Initialize
                    this.sendRequest('initialize', {
                        capabilities: {}
                    }).then(() => {
                        this.sendNotification('initialized', {});
                        if (this.model) {
                            console.log("[Main Client] didOpen initial text length: " + this.model.getValue().length);
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
                        monaco.editor.setModelMarkers(currentModel, 'dsl-lsp', markers);
                        window['__latestDiagnostics'] = msg.params.diagnostics || [];
                        window.dispatchEvent(new Event('diagnosticsUpdated'));
                        if (window['__semanticTokensEmitter']) {
                            window['__semanticTokensEmitter'].fire();
                        }
                    } else if (msg.type === 'statusUpdate') {
                        document.getElementById('status').innerText = msg.message;
                    } else if (msg.type === 'worker_log') {
                        console.log(...msg.args);
                    }
                }
                
                sendConfigConfig(config) {
                    this.worker.postMessage({ type: 'setConfig', config });
                }
            }
            
            // Start the client
            const languageClient = new SimpleMonacoLanguageClient(lspWorker, window.codeEditor);

            window.lspDisposablesByLang = window.lspDisposablesByLang || new Map();

            function registerLspProvidersForLanguage(langId) {
                if (!langId) return;
                if (window.lspDisposablesByLang.has(langId)) {
                    const oldDisposables = window.lspDisposablesByLang.get(langId);
                    for (const d of oldDisposables) {
                        try { d.dispose(); } catch {}
                    }
                    window.lspDisposablesByLang.delete(langId);
                }

                const disposables = [];

                disposables.push(monaco.languages.registerDefinitionProvider(langId, {
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
                }));

                disposables.push(monaco.languages.registerReferenceProvider(langId, {
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
                }));

                disposables.push(monaco.languages.registerFoldingRangeProvider(langId, {
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
                }));

                disposables.push(monaco.languages.registerDocumentSymbolProvider(langId, {
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
                }));

                disposables.push(monaco.languages.registerRenameProvider(langId, {
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
                }));

                disposables.push(monaco.languages.registerCompletionItemProvider(langId, {
                    triggerCharacters: ['.', ' ', ':', '=', '(', ','],
                    provideCompletionItems: async (model, position, context, token) => {
                        const result = await languageClient.sendRequest('textDocument/completion', {
                            textDocument: { 
                                uri: model.uri.toString(),
                                text: model.getValue()
                            },
                            position: { line: position.lineNumber - 1, character: position.column - 1 },
                            context: {
                                triggerKind: context.triggerKind,
                                triggerCharacter: context.triggerCharacter
                            }
                        });
                        
                        if (result && Array.isArray(result.items)) {
                            const word = model.getWordUntilPosition(position);
                            const defaultRange = new monaco.Range(
                                position.lineNumber,
                                word.startColumn,
                                position.lineNumber,
                                word.endColumn
                            );
                            
                            const suggestions = result.items.map((item, idx) => ({
                                label: item.label,
                                kind: item.kind !== undefined ? item.kind : monaco.languages.CompletionItemKind.Property,
                                detail: item.detail || '',
                                documentation: item.documentation || '',
                                insertText: item.insertText || item.label,
                                filterText: item.filterText || item.label,
                                insertTextRules: item.isSnippet ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
                                range: item.range ? new monaco.Range(
                                    item.range.start.line + 1,
                                    item.range.start.character + 1,
                                    item.range.end.line + 1,
                                    item.range.end.character + 1
                                ) : defaultRange,
                                sortText: item.sortText || String(idx).padStart(5, '0')
                            }));
                            return { suggestions, incomplete: false };
                        }
                        return { suggestions: [], incomplete: false };
                    }
                }));

                window.lspDisposablesByLang.set(langId, disposables);
            }

            window.registerLspProvidersForLanguage = registerLspProvidersForLanguage;
            if (window.currentLangId) {
                registerLspProvidersForLanguage(window.currentLangId);
            }
            registerLspProvidersForLanguage('plaintext');

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
            document.getElementById('toggle-monarch')?.addEventListener('change', () => {
                if (typeof window.applyMonarchTokens === 'function') {
                    window.applyMonarchTokens();
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
            const nodeMap = useRef(window['__astNodeMap'] || (window['__astNodeMap'] = new Map()));

            const [currentGeneration, setCurrentGeneration] = useState(0);

            const [lineStarts, setLineStarts] = useState(new Uint32Array([0]));

            useEffect(() => {
                let updateRaf = null;
                const processMsg = (msg) => {
                    if (!msg) return;
                    if (msg.type === 'astPatchBinary') {
                        console.log("[AstViewer] processMsg astPatchBinary: rootId=" + msg.rootId + ", isFullReset=" + msg.isFullReset + ", bufferBytes=" + (msg.buffer ? msg.buffer.byteLength : 0) + ", nodeMapPrevSize=" + nodeMap.current.size);
                        if (msg.isFullReset) {
                            nodeMap.current.clear();
                        }

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
                                } else if (op === 3) { // DELETE
                                    nodeMap.current.delete(ptr);
                                } else if (op === 2) { // UPDATE
                                    const oldNode = nodeMap.current.get(oldPtr);
                                    nodeMap.current.set(ptr, { ...oldNode, id: ptr, typeId, typeName, pad, len, flags, children });
                                    if (ptr !== oldPtr) {
                                        nodeMap.current.delete(oldPtr);
                                    }
                                } else if (op === 4) { // RETAINED_FLAG_UPDATE
                                    const existingNode = nodeMap.current.get(ptr);
                                    if (existingNode && existingNode.flags !== flags) {
                                        nodeMap.current.set(ptr, { ...existingNode, flags });
                                    }
                                }
                            }
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

                        if (msg.rootId === 0) {
                            nodeMap.current.clear();
                        }
                        setRootId(msg.rootId);
                        if (!updateRaf) {
                            updateRaf = requestAnimationFrame(() => {
                                updateRaf = null;
                                setUpdateTick(t => t + 1);
                            });
                        }
                    } else if (msg.type === 'statusUpdate') {
                        setStatus(msg.message);
                    }
                };

                const handleAstPatch = (e) => processMsg(e.detail);
                window.addEventListener('astPatch', handleAstPatch);
                if (window['__latestAstPatch']) {
                    processMsg(window['__latestAstPatch']);
                }
                return () => {
                    window.removeEventListener('astPatch', handleAstPatch);
                    if (updateRaf) cancelAnimationFrame(updateRaf);
                };
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
                let totalCalls = 0;
                
                const flatten = (ptr, depth, parentOffset, parentField) => {
                    if (++totalCalls > 10000 || nodes.length >= 5000) return parentOffset;
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
                    const isError = node.typeName === "ERROR" || isTainted || hasErrorFlag;
                    const isGhost = isInserted;
                    
                    nodes.push({ ...node, depth, isGhost, isError, currentOffset, parentField });
                    
                    let childOffset = currentOffset;
                    for (const childObj of node.children || []) {
                        const fieldName = childObj.fieldId >= 0 ? (window.fieldNames ? window.fieldNames[childObj.fieldId] : ("field_" + childObj.fieldId)) : null;
                        childOffset = flatten(childObj.ptr, depth + 1, childOffset, fieldName);
                    }
                    visited.delete(ptr);
                    return currentOffset + (node.len || 0);
                };
                
                const effectiveRoot = (rootId !== 0 && nodeMap.current.has(rootId)) ? rootId : 0;
                console.log("[AstViewer] compute flatNodes: rootId=" + rootId + ", nodeMapSize=" + nodeMap.current.size + ", hasRoot=" + nodeMap.current.has(rootId) + ", effectiveRoot=" + effectiveRoot);
                if (effectiveRoot) flatten(effectiveRoot, 0, 0, null);
                console.log("[AstViewer] computed flatNodes done: " + nodes.length + " nodes");
                return nodes;
            }, [updateTick, rootId]);

            const visibleNodes = flatNodes.slice(0, renderLimit);

            const getLineCol = (offsetBytes) => {
                if (!lineStarts || lineStarts.length === 0) return { line: 1, col: 1 };
                let low = 0, high = lineStarts.length - 1;
                while (low <= high) {
                    const mid = (low + high) >> 1;
                    if (lineStarts[mid] <= offsetBytes) low = mid + 1;
                    else high = mid - 1;
                }
                const line = Math.max(0, Math.min(high, lineStarts.length - 1));
                const charMult = window['__charMult'] || 2;
                const colChars = Math.max(0, Math.floor((offsetBytes - (lineStarts[line] || 0)) / charMult));
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
            const [data, setData] = useState(window['__latestPipelineData_' + pipeline.id] || null);
            const [activeFilter, setActiveFilter] = useState('all');
            const [viewMode, setViewMode] = useState('formatted');

            useEffect(() => {
                const handler = (e) => {
                    if (e.detail && e.detail.pipelineId === pipeline.id) {
                        setData(e.detail);
                    }
                };
                window.addEventListener('pipelineDataUpdated', handler);
                if (window['__requestPipelineData']) {
                    window['__requestPipelineData'](pipeline.id);
                }
                return () => window.removeEventListener('pipelineDataUpdated', handler);
            }, [pipeline.id]);

            const equations = data ? (data.equations || []) : [];
            const variables = data ? (data.variables || []) : [];
            const connections = data ? (data.connections || []) : [];
            const bltBlocks = data ? (data.bltBlocks || []) : [];
            const varCount = data ? data.varCount : 0;
            const eqCount = data ? data.eqCount : 0;
            const isBalanced = varCount > 0 && varCount === eqCount;

            const filteredVars = variables.filter(v => {
                if (activeFilter === 'params') return v.variability === 'parameter' || v.variability === 'constant';
                if (activeFilter === 'states') return v.variability === 'continuous' || v.variability === 'discrete';
                return true;
            });

            return (
                <div className="panel-content" style={{ padding: '16px', overflowY: 'auto' }}>
                    {/* Header Card */}
                    <div className="equation-card" style={{ marginBottom: '16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                            <div className="title" style={{ fontSize: '15px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                ⚙️ {pipeline.label}
                                <span style={{
                                    fontSize: '11px',
                                    fontWeight: 'normal',
                                    background: '#21262d',
                                    color: '#58a6ff',
                                    padding: '2px 8px',
                                    borderRadius: '12px',
                                    border: '1px solid #30363d',
                                    fontFamily: 'monospace'
                                }}>
                                    target: {pipeline.target}
                                </span>
                            </div>
                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                                <button
                                    className={"tab-btn " + (viewMode === 'formatted' ? 'active' : '')}
                                    style={{ padding: '2px 8px', fontSize: '11px' }}
                                    onClick={() => setViewMode('formatted')}
                                >
                                    📊 Formatted DAE
                                </button>
                                <button
                                    className={"tab-btn " + (viewMode === 'flat' ? 'active' : '')}
                                    style={{ padding: '2px 8px', fontSize: '11px' }}
                                    onClick={() => setViewMode('flat')}
                                >
                                    📄 Raw Flat Modelica
                                </button>
                                <button
                                    className={"tab-btn " + (viewMode === 'json' ? 'active' : '')}
                                    style={{ padding: '2px 8px', fontSize: '11px' }}
                                    onClick={() => setViewMode('json')}
                                >
                                    📋 Raw JSON
                                </button>
                                <button
                                    className="tab-btn"
                                    style={{ padding: '2px 8px', fontSize: '11px' }}
                                    onClick={() => window['__requestPipelineData'] && window['__requestPipelineData'](pipeline.id)}
                                >
                                    🔄 Refresh
                                </button>
                            </div>
                        </div>

                        {/* System Stats Bar */}
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                            gap: '8px',
                            marginTop: '12px'
                        }}>
                            <div style={{ background: '#0d1117', padding: '10px 12px', borderRadius: '6px', border: '1px solid #30363d' }}>
                                <div style={{ fontSize: '11px', color: '#8b949e' }}>Flattened Equations</div>
                                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#58a6ff' }}>{equations.length}</div>
                            </div>
                            <div style={{ background: '#0d1117', padding: '10px 12px', borderRadius: '6px', border: '1px solid #30363d' }}>
                                <div style={{ fontSize: '11px', color: '#8b949e' }}>Continuous Unknowns</div>
                                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#bc8cff' }}>{varCount}</div>
                            </div>
                            <div style={{ background: '#0d1117', padding: '10px 12px', borderRadius: '6px', border: '1px solid #30363d' }}>
                                <div style={{ fontSize: '11px', color: '#8b949e' }}>Parameters / Const</div>
                                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#79c0ff' }}>{data ? data.paramCount : 0}</div>
                            </div>
                            <div style={{ background: '#0d1117', padding: '10px 12px', borderRadius: '6px', border: '1px solid #30363d' }}>
                                <div style={{ fontSize: '11px', color: '#8b949e' }}>System Balance</div>
                                <div style={{ fontSize: '13px', fontWeight: 'bold', marginTop: '4px', color: isBalanced ? '#3fb950' : (varCount === 0 ? '#8b949e' : '#d29922') }}>
                                    {isBalanced ? '✔ Balanced (N = M)' : (varCount === 0 ? '○ Standby' : '⚠️ Unbalanced')}
                                </div>
                            </div>
                        </div>
                    </div>

                    {viewMode === 'json' ? (
                        <div className="equation-card">
                            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
                                <button
                                    className="tab-btn"
                                    style={{ fontSize: '11px', padding: '2px 8px' }}
                                    onClick={() => navigator.clipboard && navigator.clipboard.writeText(JSON.stringify(data, null, 2))}
                                >
                                    📋 Copy JSON
                                </button>
                            </div>
                            <pre style={{ margin: 0, padding: '12px', background: '#0d1117', borderRadius: '6px', color: '#c9d1d9', fontSize: '12px', overflowX: 'auto' }}>
                                {JSON.stringify(data || { status: 'loading' }, null, 2)}
                            </pre>
                        </div>
                    ) : viewMode === 'flat' ? (
                        <div className="equation-card">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                                <div className="title" style={{ fontSize: '13px', fontWeight: 'bold', color: '#e6edf3' }}>
                                    📄 Canonical Flat Code Representation
                                </div>
                                <button
                                    className="tab-btn"
                                    style={{ fontSize: '11px', padding: '2px 8px' }}
                                    onClick={() => navigator.clipboard && navigator.clipboard.writeText(data ? (data.flatText || data.flatModelica || '') : '')}
                                >
                                    📋 Copy Flat Code
                                </button>
                            </div>
                            <pre style={{
                                margin: 0,
                                padding: '14px 16px',
                                background: '#0d1117',
                                borderRadius: '6px',
                                border: '1px solid #30363d',
                                color: '#79c0ff',
                                fontSize: '12px',
                                fontFamily: 'SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace',
                                lineHeight: '1.6',
                                overflowX: 'auto',
                                whiteSpace: 'pre'
                            }}>
                                {data && (data.flatText || data.flatModelica) ? (data.flatText || data.flatModelica) : '// No flat code generated'}
                            </pre>
                        </div>
                    ) : (
                        <>
                            {/* Flattened Equations List */}
                            <div className="equation-card" style={{ marginBottom: '16px' }}>
                                <div className="title" style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '8px', color: '#e6edf3' }}>
                                    📝 Flattened Equations ({equations.length})
                                </div>
                                {equations.length === 0 ? (
                                    <div style={{ color: '#8b949e', fontSize: '12px', fontStyle: 'italic' }}>
                                        No equations lowered in current AST model.
                                    </div>
                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                        {equations.map((eq, idx) => (
                                            <div key={idx} style={{
                                                padding: '8px 12px',
                                                background: '#0d1117',
                                                borderRadius: '6px',
                                                border: '1px solid #30363d',
                                                fontFamily: 'SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace',
                                                fontSize: '12px',
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                alignItems: 'center'
                                            }}>
                                                <div>
                                                    <span style={{ color: '#6e7781', marginRight: '8px', userSelect: 'none' }}>({idx + 1})</span>
                                                    <span style={{ color: '#79c0ff' }}>{eq.text.split('=')[0]}</span>
                                                    <span style={{ color: '#ff7b72', margin: '0 6px' }}>=</span>
                                                    <span style={{ color: '#a5d6ff' }}>{eq.text.split('=').slice(1).join('=')}</span>
                                                    {eq.flowText && (
                                                        <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '4px' }}>
                                                            ↳ flow: <code style={{ color: '#e3b341' }}>{eq.flowText}</code>
                                                        </div>
                                                    )}
                                                </div>
                                                <span style={{
                                                    fontSize: '10px',
                                                    color: '#8b949e',
                                                    background: '#161b22',
                                                    padding: '2px 6px',
                                                    borderRadius: '4px',
                                                    border: '1px solid #21262d'
                                                }}>
                                                    {eq.kind || 'simple'}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Topological Connections */}
                            {connections.length > 0 && (
                                <div className="equation-card" style={{ marginBottom: '16px' }}>
                                    <div className="title" style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '8px', color: '#e6edf3' }}>
                                        ⚡ Topological Connects & Port Equivalence ({connections.length})
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '8px' }}>
                                        {connections.map((c, idx) => (
                                            <div key={idx} style={{
                                                padding: '8px 12px',
                                                background: '#0d1117',
                                                borderRadius: '6px',
                                                border: '1px solid #30363d',
                                                fontSize: '12px',
                                                fontFamily: 'monospace'
                                            }}>
                                                <span style={{ color: '#58a6ff' }}>connect</span>(
                                                <span style={{ color: '#7ee787' }}>{c.from}</span>,{' '}
                                                <span style={{ color: '#7ee787' }}>{c.to}</span>)
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* BLT Block Decomposition */}
                            {pipeline.target === 'blt' && bltBlocks.length > 0 && (
                                <div className="equation-card" style={{ marginBottom: '16px' }}>
                                    <div className="title" style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '8px', color: '#e6edf3' }}>
                                        🧩 BLT Strongly Connected Components ({bltBlocks.length} Blocks)
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {bltBlocks.map((b) => (
                                            <div key={b.id} style={{
                                                padding: '10px 12px',
                                                background: '#0d1117',
                                                borderRadius: '6px',
                                                border: '1px solid #30363d',
                                                borderLeft: '4px solid #bc8cff',
                                                fontSize: '12px'
                                            }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                                    <strong>Block {b.id}: [{b.solvedVars.join(', ')}]</strong>
                                                    <span style={{ fontSize: '11px', color: '#8b949e' }}>type: {b.type} (size: {b.size})</span>
                                                </div>
                                                <div style={{ color: '#8b949e', fontFamily: 'monospace' }}>
                                                    {b.equations.map((eq, i) => <div key={i}>• {eq}</div>)}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Variables & Parameters Table */}
                            <div className="equation-card">
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                                    <div className="title" style={{ fontSize: '13px', fontWeight: 'bold', color: '#e6edf3' }}>
                                        📊 Variables & Parameters ({variables.length})
                                    </div>
                                    <div style={{ display: 'flex', gap: '4px' }}>
                                        <button
                                            className={"tab-btn " + (activeFilter === 'all' ? 'active' : '')}
                                            style={{ padding: '2px 8px', fontSize: '11px' }}
                                            onClick={() => setActiveFilter('all')}
                                        >
                                            All ({variables.length})
                                        </button>
                                        <button
                                            className={"tab-btn " + (activeFilter === 'states' ? 'active' : '')}
                                            style={{ padding: '2px 8px', fontSize: '11px' }}
                                            onClick={() => setActiveFilter('states')}
                                        >
                                            Unknowns ({varCount})
                                        </button>
                                        <button
                                            className={"tab-btn " + (activeFilter === 'params' ? 'active' : '')}
                                            style={{ padding: '2px 8px', fontSize: '11px' }}
                                            onClick={() => setActiveFilter('params')}
                                        >
                                            Params ({data ? data.paramCount : 0})
                                        </button>
                                    </div>
                                </div>

                                {filteredVars.length === 0 ? (
                                    <div style={{ color: '#8b949e', fontSize: '12px', fontStyle: 'italic' }}>
                                        No variables found matching current filter.
                                    </div>
                                ) : (
                                    <div style={{ overflowX: 'auto' }}>
                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                                            <thead>
                                                <tr style={{ borderBottom: '1px solid #30363d', color: '#8b949e' }}>
                                                    <th style={{ padding: '6px 8px' }}>Name</th>
                                                    <th style={{ padding: '6px 8px' }}>Type</th>
                                                    <th style={{ padding: '6px 8px' }}>Variability</th>
                                                    <th style={{ padding: '6px 8px' }}>Causality</th>
                                                    <th style={{ padding: '6px 8px' }}>Start / Binding</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {filteredVars.map((v, i) => {
                                                    const isParam = v.variability === 'parameter' || v.variability === 'constant';
                                                    return (
                                                        <tr key={i} style={{ borderBottom: '1px solid #21262d' }}>
                                                            <td style={{ padding: '6px 8px', fontWeight: 'bold', color: '#58a6ff', fontFamily: 'monospace' }}>
                                                                {v.name + (v.dimensions && v.dimensions.length > 0 ? '[' + v.dimensions.join(', ') + ']' : '')}
                                                            </td>
                                                            <td style={{ padding: '6px 8px', color: '#7ee787', fontFamily: 'monospace' }}>
                                                                {v.type}
                                                            </td>
                                                            <td style={{ padding: '6px 8px' }}>
                                                                <span style={{
                                                                    padding: '2px 6px',
                                                                    borderRadius: '4px',
                                                                    fontSize: '10px',
                                                                    fontWeight: 'bold',
                                                                    background: isParam ? 'rgba(188,140,255,0.15)' : 'rgba(88,166,255,0.15)',
                                                                    color: isParam ? '#bc8cff' : '#58a6ff',
                                                                    border: '1px solid ' + (isParam ? 'rgba(188,140,255,0.3)' : 'rgba(88,166,255,0.3)')
                                                                }}>
                                                                    {v.variability}
                                                                </span>
                                                            </td>
                                                            <td style={{ padding: '6px 8px', color: '#8b949e' }}>
                                                                {v.causality || 'local'}
                                                            </td>
                                                            <td style={{ padding: '6px 8px', color: v.start ? '#e3b341' : '#6e7781', fontFamily: 'monospace' }}>
                                                                {v.start ? v.start : '—'}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </>
                    )}
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
                            🔍 Active Diagnostics & Lints ({diagnostics.length})
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

        function DiagramViewer({ isActive }) {
            const containerRef = useRef(null);
            const graphRef = useRef(null);
            const [views, setViews] = useState(['All']);
            const [activeView, setActiveView] = useState('All');

            const updateDiagramGraph = () => {
                if (!containerRef.current) return;
                const Diagram = window.DiagramModule;
                if (!Diagram || !Diagram.initGraph) return;

                const dslConfig = window.diagramConfig;
                if (dslConfig && dslConfig.views) {
                    const vKeys = Object.keys(dslConfig.views);
                    if (vKeys.length > 0) {
                        setViews(['All', ...vKeys]);
                    }
                }

                if (!graphRef.current) {
                    Diagram.setDiagramOptions({
                        container: containerRef.current,
                        isDark: true,
                        onAction: (action) => {
                            if (action && action.type === 'move' && action.items) {
                                const edits = action.items.map(item => ({
                                    type: 'move',
                                    nodePtr: parseInt(item.name.replace('node_', '')) || 0,
                                    x: Math.round(item.x),
                                    y: Math.round(item.y)
                                }));
                                if (window.diagramConfig?.mutations?.moveNode && window['__applyDiagramEdits']) {
                                    window['__applyDiagramEdits'](edits);
                                }
                            } else if (action && action.type === 'resize' && action.item) {
                                if (window.diagramConfig?.mutations?.resizeNode && window['__applyDiagramEdits']) {
                                    window['__applyDiagramEdits']([{
                                        type: 'resize',
                                        nodePtr: parseInt(action.item.name.replace('node_', '')) || 0,
                                        x: Math.round(action.item.x),
                                        y: Math.round(action.item.y),
                                        width: Math.round(action.item.width),
                                        height: Math.round(action.item.height)
                                    }]);
                                }
                            }
                        }
                    });

                    const g = Diagram.initGraph(true);
                    graphRef.current = g;
                }

                const rawData = window['__latestDiagramData'] || { nodes: [], edges: [] };
                const sourceText = window.codeEditor ? window.codeEditor.getValue() : "";
                const diagramData = (Diagram.buildDiagramFromDSL && (dslConfig || rawData.nodes?.length > 0))
                    ? Diagram.buildDiagramFromDSL(rawData, dslConfig, window.syntaxNames, activeView, sourceText)
                    : rawData;

                Diagram.renderDiagram(diagramData, true);

                setTimeout(() => {
                    if (graphRef.current && containerRef.current) {
                        const rect = containerRef.current.getBoundingClientRect();
                        if (rect.width > 50 && rect.height > 50) {
                            graphRef.current.resize(rect.width, rect.height);
                            try {
                                graphRef.current.zoomToFit({ padding: 30, maxScale: 1.0, minScale: 0.8 });
                                graphRef.current.centerContent();
                            } catch (e) {}
                        }
                    }
                }, 60);
            };

            useEffect(() => {
                let isMounted = true;

                if (window.DiagramModule) {
                    if (isActive) updateDiagramGraph();
                } else {
                    const modHandler = () => { if (isMounted && isActive) updateDiagramGraph(); };
                    window.addEventListener('diagramModuleLoaded', modHandler, { once: true });
                }

                const dataHandler = () => {
                    if (isMounted) updateDiagramGraph();
                };

                window.addEventListener('diagramDataUpdated', dataHandler);
                return () => {
                    isMounted = false;
                    window.removeEventListener('diagramDataUpdated', dataHandler);
                };
            }, [isActive, activeView]);

            useEffect(() => {
                if (!containerRef.current) return;
                const ro = new ResizeObserver((entries) => {
                    for (const entry of entries) {
                        if (entry.contentRect.width > 50 && entry.contentRect.height > 50) {
                            if (graphRef.current) {
                                graphRef.current.resize(entry.contentRect.width, entry.contentRect.height);
                                try {
                                    graphRef.current.zoomToFit({ padding: 30, maxScale: 1.0, minScale: 0.8 });
                                    graphRef.current.centerContent();
                                } catch (e) {}
                            } else {
                                updateDiagramGraph();
                            }
                        }
                    }
                });
                ro.observe(containerRef.current);
                return () => ro.disconnect();
            }, []);

            return (
                <div 
                    className="panel-content" 
                    style={{ 
                        padding: 0, 
                        flex: 1, 
                        position: 'relative', 
                        overflow: 'hidden', 
                        background: '#0d1117',
                        display: 'flex',
                        flexDirection: 'column'
                    }}
                >
                    <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 100, display: 'flex', gap: 6, background: 'rgba(22,27,34,0.85)', padding: '4px 8px', borderRadius: 6, border: '1px solid #30363d', alignItems: 'center' }}>
                        {views.length > 1 && (
                            <select 
                                value={activeView} 
                                onChange={(e) => setActiveView(e.target.value)}
                                style={{ background: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 4, padding: '3px 8px', fontSize: 12 }}
                            >
                                {views.map(v => <option key={v} value={v}>{v === 'All' ? 'Default View' : v}</option>)}
                            </select>
                        )}
                        <button className="tab-btn" onClick={() => graphRef.current?.zoom(0.15)}>🔍 +</button>
                        <button className="tab-btn" onClick={() => graphRef.current?.zoom(-0.15)}>🔍 -</button>
                        <button className="tab-btn" onClick={() => { graphRef.current?.zoomTo(1); graphRef.current?.centerContent(); }}>↺ Fit</button>
                    </div>

                    <div 
                        id="diagram-x6-container"
                        ref={containerRef} 
                        style={{ flex: 1, width: '100%', height: '100%', minHeight: '100%' }} 
                    />
                </div>
            );
        }

        function GrammarConflictsViewer() {
            const [conflicts, setConflicts] = useState(window.grammarConflicts || []);

            useEffect(() => {
                const handler = (e) => {
                    setConflicts(e.detail || window.grammarConflicts || []);
                };
                window.addEventListener('grammarConflictsUpdated', handler);
                return () => window.removeEventListener('grammarConflictsUpdated', handler);
            }, []);

            const numReduceReduce = conflicts.filter(c => c.type === 'reduce/reduce').length;
            const numShiftReduce = conflicts.filter(c => c.type === 'shift/reduce').length;

            const jumpToRule = (ruleName) => {
                if (!window.dslEditor || !window.dslEditor.getModel()) return;
                const clean = ruleName.replace(/^["']|["']$/g, '');
                const model = window.dslEditor.getModel();
                const matches = model.findMatches('\\b' + clean + '\\s*:', false, true, false, null, true);
                if (matches && matches.length > 0) {
                    const line = matches[0].range.startLineNumber;
                    window.dslEditor.revealLineInCenter(line);
                    window.dslEditor.setPosition({ lineNumber: line, column: matches[0].range.startColumn });
                    window.dslEditor.focus();
                }
            };

            const copyConflictGroup = (rules) => {
                const cleanRules = (rules || []).map(r => r.replace(/^["']|["']$/g, '')).filter(r => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(r));
                if (cleanRules.length === 0) return;
                const snippet = 'conflicts: ($) => [\\n    [' + cleanRules.map(r => '$.' + r).join(', ') + '],\\n],';
                if (navigator.clipboard) {
                    navigator.clipboard.writeText(snippet);
                }
            };

            return (
                <div className="panel-content" style={{ padding: '15px' }}>
                    <div className="equation-card" style={{ marginBottom: '14px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <div className="title" style={{ fontSize: '15px', fontWeight: 'bold' }}>
                                ⚠️ Grammar Analysis & Conflicts ({conflicts.length})
                            </div>
                            {conflicts.length > 0 && (
                                <div style={{ display: 'flex', gap: '6px', fontSize: '12px' }}>
                                    {numShiftReduce > 0 && (
                                        <span style={{ background: 'rgba(217,119,6,0.2)', color: '#d97706', padding: '2px 8px', borderRadius: '12px', border: '1px solid rgba(217,119,6,0.4)', fontWeight: 600 }}>
                                            {numShiftReduce} Shift/Reduce
                                        </span>
                                    )}
                                    {numReduceReduce > 0 && (
                                        <span style={{ background: 'rgba(207,34,46,0.2)', color: '#cf222e', padding: '2px 8px', borderRadius: '12px', border: '1px solid rgba(207,34,46,0.4)', fontWeight: 600 }}>
                                            {numReduceReduce} Reduce/Reduce
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>

                        {conflicts.length === 0 ? (
                            <div style={{ padding: '16px', background: 'rgba(46,160,67,0.1)', border: '1px solid rgba(46,160,67,0.3)', borderRadius: '6px', color: '#3fb950', fontSize: '13px' }}>
                                <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>✔ No Grammar Conflicts Detected</div>
                                <div style={{ opacity: 0.85, fontSize: '12px' }}>Your grammar is deterministic and unambiguous under LALR(1) / GLR analysis.</div>
                            </div>
                        ) : (
                            <div style={{ fontSize: '12px', color: '#8b949e', lineHeight: '1.4', marginBottom: '8px' }}>
                                Conflicts indicate parser lookahead ambiguities where multiple shift or reduce actions exist. In ModelScript GLR, unresolved conflicts are forked dynamically, but defining operator precedence (<code style={{ background: '#21262d', padding: '1px 4px', borderRadius: '3px' }}>prec.left / prec.right</code>) or whitelisting in <code style={{ background: '#21262d', padding: '1px 4px', borderRadius: '3px' }}>conflicts: ($) =&gt; [...]</code> resolves ambiguity and enhances performance.
                            </div>
                        )}
                    </div>

                    {conflicts.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {conflicts.map((c, idx) => {
                                const isReduceReduce = c.type === 'reduce/reduce';
                                return (
                                    <div key={idx} style={{
                                        padding: '12px 14px',
                                        borderRadius: '8px',
                                        background: isReduceReduce ? 'rgba(207,34,46,0.06)' : 'rgba(217,119,6,0.06)',
                                        border: '1px solid ' + (isReduceReduce ? 'rgba(207,34,46,0.3)' : 'rgba(217,119,6,0.3)'),
                                        borderLeft: '5px solid ' + (isReduceReduce ? '#cf222e' : '#d97706'),
                                        fontSize: '13px',
                                        lineHeight: '1.45'
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <span style={{
                                                    fontWeight: 'bold',
                                                    color: isReduceReduce ? '#cf222e' : '#d97706',
                                                    textTransform: 'uppercase',
                                                    fontSize: '12px',
                                                    background: isReduceReduce ? 'rgba(207,34,46,0.15)' : 'rgba(217,119,6,0.15)',
                                                    padding: '2px 6px',
                                                    borderRadius: '4px'
                                                }}>
                                                    {c.type}
                                                </span>
                                                <span style={{ fontWeight: 'bold', fontSize: '13px' }}>Conflict #{idx + 1}</span>
                                            </div>
                                            {c.rules && c.rules.length > 0 && (
                                                <button 
                                                    className="tab-btn" 
                                                    style={{ padding: '2px 8px', fontSize: '11px' }}
                                                    onClick={() => copyConflictGroup(c.rules)}
                                                    title="Copy conflicts array snippet to clipboard"
                                                >
                                                    📋 Copy Suppressor
                                                </button>
                                            )}
                                        </div>

                                        {c.rules && c.rules.length > 0 && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
                                                <span style={{ fontSize: '12px', opacity: 0.75 }}>Involved rules:</span>
                                                {c.rules.map(r => (
                                                    <span 
                                                        key={r} 
                                                        onClick={() => jumpToRule(r)}
                                                        style={{ 
                                                            cursor: 'pointer', 
                                                            background: '#21262d', 
                                                            color: '#58a6ff', 
                                                            padding: '1px 6px', 
                                                            borderRadius: '4px', 
                                                            fontSize: '11px', 
                                                            fontFamily: 'monospace',
                                                            border: '1px solid #30363d'
                                                        }}
                                                        title="Click to jump to rule definition in DSL editor"
                                                    >
                                                        {r} ↗
                                                    </span>
                                                ))}
                                            </div>
                                        )}

                                        <pre style={{
                                            margin: '6px 0 0 0',
                                            padding: '10px 12px',
                                            background: '#0d1117',
                                            border: '1px solid #30363d',
                                            borderRadius: '6px',
                                            color: '#c9d1d9',
                                            fontSize: '12px',
                                            fontFamily: 'SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace',
                                            overflowX: 'auto',
                                            whiteSpace: 'pre-wrap',
                                            lineHeight: '1.4'
                                        }}>
                                            {c.output.trim()}
                                        </pre>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            );
        }

        function PlaygroundPanels() {
            const [activeTab, setActiveTab] = useState('ast');
            const [pipelines, setPipelines] = useState([]);
            const [grammarConflicts, setGrammarConflicts] = useState(window.grammarConflicts || []);

            useEffect(() => {
                const handler = () => {
                    setPipelines(window.pipelines || []);
                };
                const conflictHandler = (e) => {
                    setGrammarConflicts(e.detail || window.grammarConflicts || []);
                };
                window.addEventListener('pipelinesUpdated', handler);
                window.addEventListener('grammarConflictsUpdated', conflictHandler);
                return () => {
                    window.removeEventListener('pipelinesUpdated', handler);
                    window.removeEventListener('grammarConflictsUpdated', conflictHandler);
                };
            }, []);

            const activePipeline = pipelines.find(p => p.id === activeTab);

            return (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
                    <div id="panel-tabs" style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        <button className={"tab-btn " + (activeTab === 'ast' ? 'active' : '')} onClick={() => { setActiveTab('ast'); window['__activeTab'] = 'ast'; }}>
                            🌳 AST Tree
                        </button>
                        <button className={"tab-btn " + (activeTab === 'diagram' ? 'active' : '')} onClick={() => { setActiveTab('diagram'); window['__activeTab'] = 'diagram'; if (window['__requestDiagramData']) window['__requestDiagramData'](); }}>
                            📊 2D Diagram
                        </button>
                        {pipelines.map(p => (
                            <button
                                key={p.id}
                                className={"tab-btn " + (activeTab === p.id ? 'active' : '')}
                                onClick={() => {
                                    setActiveTab(p.id);
                                    window['__activeTab'] = p.id;
                                    if (window['__requestPipelineData']) window['__requestPipelineData'](p.id);
                                }}
                            >
                                ⚙️ {p.label}
                            </button>
                        ))}
                        <button className={"tab-btn " + (activeTab === 'diagnostics' ? 'active' : '')} onClick={() => { setActiveTab('diagnostics'); window['__activeTab'] = 'diagnostics'; }}>
                            🔍 Code Diagnostics
                        </button>
                        <button 
                            className={"tab-btn " + (activeTab === 'grammar-conflicts' ? 'active' : '')} 
                            onClick={() => setActiveTab('grammar-conflicts')}
                            style={grammarConflicts.length > 0 ? { borderBottom: '2px solid #d97706', color: '#d97706' } : {}}
                        >
                            ⚠️ Grammar {grammarConflicts.length > 0 ? '(' + grammarConflicts.length + ')' : ''}
                        </button>
                    </div>
                    <div style={{ display: activeTab === 'ast' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                        <AstViewer />
                    </div>
                    <div style={{ display: activeTab === 'diagram' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                        <DiagramViewer isActive={activeTab === 'diagram'} />
                    </div>
                    {activePipeline && <PipelinePassViewer pipeline={activePipeline} />}
                    {activeTab === 'diagnostics' && <DiagnosticsViewer />}
                    {activeTab === 'grammar-conflicts' && <GrammarConflictsViewer />}
                </div>
            );
        }

        // Render React Tree
        const root = ReactDOM.createRoot(document.getElementById('react-ast-root'));
        root.render(<PlaygroundPanels />);
    </script>
</body>
</html>`;
}

export function getCompilerWorkerJs() {
  return `
let Language = null;
let asc = null;
let ts = null;

async function init() {
    try {
        console.log("[Worker] Loading /browser.js...");
        Language = await import('/browser.js?v=' + Date.now());
        console.log("[Worker] /browser.js loaded:", Language);

        console.log("[Worker] Loading /typescript.mjs...");
        const tsModule = await import('/typescript.mjs');
        ts = tsModule.default || tsModule;
        console.log("[Worker] /typescript.mjs loaded:", !!ts);

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

            // 1. Transpile TypeScript syntax (types, interfaces, classes) to pure JS
            if (ts && ts.transpileModule) {
                try {
                    const trans = ts.transpileModule(dslCode, {
                        compilerOptions: {
                            target: ts.ScriptTarget?.ES2022 || ts.ScriptTarget?.ESNext || 99,
                            module: ts.ModuleKind?.ESNext || 99,
                            downlevelIteration: true,
                            removeComments: false,
                        }
                    });
                    dslCode = trans.outputText;
                } catch (tsErr) {
                    console.warn("TypeScript transpilation warning:", tsErr);
                }
            }
            
            // Strip 'export * from ...;' and 'export { ... } from ...;'
            dslCode = dslCode.replace(/export\\s*\\*\\s*(?:as\\s+\\w+\\s+)?from\\s+['"][^'"]+['"];?/g, '');
            dslCode = dslCode.replace(/export\\s*\\{[\\s\\S]*?\\}(?:\\s*from\\s+['"][^'"]+['"])?;?/g, '');
            dslCode = dslCode.replace(/export\\s*\\{[\\s\\S]*?\\};?/g, '');
            
            // Remove imports
            dslCode = dslCode.replace(/import\\s+[\\s\\S]*?from\\s+['"][^'"]+['"];?/g, '');
            dslCode = dslCode.replace(/import\\s+['"][^'"]+['"];?/g, '');
            
            // Transform 'export default' into 'return'
            dslCode = dslCode.replace(/export\\s+default\\s+/, 'return ');
            
            // Transform 'export const myLanguage = language(...)' into 'return language(...)'
            dslCode = dslCode.replace(/export\\s+(?:const|let|var)\\s+\\w+\\s*=\\s*(language\\s*\\()/g, 'return $1');
            
            // Strip any remaining exports
            dslCode = dslCode.replace(/export\\s+/g, '');
            
            if (!dslCode.includes('return ')) {
                dslCode += '\\nreturn typeof __grammar !== "undefined" ? __grammar : (typeof modelicaLanguage !== "undefined" ? modelicaLanguage : null);';
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
                    grammarDef.sourceText = e.data.dsl;
                    const result = Language.buildParser(grammarDef, { sourceText: e.data.dsl });
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

                            const sanitizeForClone = (obj) => {
                                if (!obj || typeof obj !== 'object') return obj;
                                if (Array.isArray(obj)) return obj.map(sanitizeForClone);
                                const out = {};
                                for (const [k, v] of Object.entries(obj)) {
                                    if (typeof v === 'function') {
                                        out[k] = v.toString();
                                    } else if (v && typeof v === 'object') {
                                        out[k] = sanitizeForClone(v);
                                    } else {
                                        out[k] = v;
                                    }
                                }
                                return out;
                            };

                            self.postMessage({ 
                                type: 'success', 
                                wasm: vfs['parser.wasm'], 
                                jsWrapper: result.javascriptWrapper.js,
                                syntaxNames: result.javascriptWrapper.syntaxNames,
                                fieldNames: result.javascriptWrapper.fieldNames,
                                semanticLegend: result.javascriptWrapper.semanticLegend,
                                pipelines: pipelineDefs,
                                diagram: sanitizeForClone(grammarDef.diagram),
                                langName: grammarDef.name,
                                conflicts: result.conflicts || (result.table && result.table.diagnostics) || []
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
let Tree = null;
let SyntaxNode = null;
let LspFacade = null;
let latestUri = 'inmemory://example.mo';
let currentTextLength = 0;
let currentGenerationId = Date.now();
let pendingFullText = null;
let currentLangName = "ModelScript DSL";
let globalAstRoot = 0;
let isFullResetNeeded = false;

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

// Each entry is one Monaco event's changes array — must be processed sequentially
// because changes from different events use different document coordinate spaces.
let pendingEventGroups = [];
let isParsing = false;
let parseDebounceTimer = null;

function triggerDiagnostics(changes = null) {
    if (changes && changes.length > 0) {
        // Push as a single event group to preserve coordinate-space boundaries
        pendingEventGroups.push(changes);
    }
    
    if (parseDebounceTimer) clearTimeout(parseDebounceTimer);
    parseDebounceTimer = setTimeout(() => {
        if (!isParsing && pendingEventGroups.length > 0) {
            runDiagnosticsNow();
        }
    }, 40);
}

async function runDiagnosticsNow() {
    if (!lspFacade || pendingEventGroups.length === 0) return;
    
    isParsing = true;
    // Drain all currently queued event groups
    const eventGroups = pendingEventGroups.splice(0, pendingEventGroups.length);
    console.log("[LSP Worker] runDiagnosticsNow START: " + eventGroups.length + " event group(s), currentTextLength=" + currentTextLength);
    
    try {
        const charMult = (lspFacade && typeof lspFacade.getInputEncoding === 'function' ? lspFacade.getInputEncoding() : 1) === 1 ? 2 : 1;
        patchOffset = 0;
        isFullResetNeeded = false;
        let lastDiags = [];
        let lastUpdatedLineStarts = null;
        let hadAnyEdit = false;

        for (let gIdx = 0; gIdx < eventGroups.length; gIdx++) {
            const group = eventGroups[gIdx];
            const lineStarts = lspFacade.getLineStarts();

            let groupEdits = [];
            let isGroupFullReplacement = false;
            let groupFullText = null;

            for (const change of group) {
                if (change.text !== undefined && change.range === undefined && change.rangeOffset === undefined) {
                    isGroupFullReplacement = true;
                    isFullResetNeeded = true;
                    groupFullText = change.text;
                    groupEdits = [];
                } else if (!isGroupFullReplacement) {
                    let rangeOffset = change.rangeOffset;
                    let rangeLength = change.rangeLength;
                    if (rangeOffset === undefined && change.range) {
                        const startLine = change.range.startLineNumber !== undefined ? change.range.startLineNumber - 1 : change.range.start.line;
                        const startCol = change.range.startColumn !== undefined ? change.range.startColumn - 1 : change.range.start.character;
                        const endLine = change.range.endLineNumber !== undefined ? change.range.endLineNumber - 1 : change.range.end.line;
                        const endCol = change.range.endColumn !== undefined ? change.range.endColumn - 1 : change.range.end.character;
                        
                        const maxLineIdx = lineStarts && lineStarts.length > 0 ? lineStarts.length - 1 : 0;
                        const validStartLine = Math.min(Math.max(0, startLine), maxLineIdx);
                        const validEndLine = Math.min(Math.max(0, endLine), maxLineIdx);

                        const startByte = (lineStarts && lineStarts.length > 0 ? lineStarts[validStartLine] : 0) + (startCol * charMult);
                        const endByte = (lineStarts && lineStarts.length > 0 ? lineStarts[validEndLine] : 0) + (endCol * charMult);
                        
                        rangeOffset = Math.floor(startByte / charMult);
                        rangeLength = Math.max(0, Math.floor((endByte - startByte) / charMult));
                    }
                    if (rangeOffset !== undefined) {
                        groupEdits.push({
                            rangeOffset: rangeOffset,
                            rangeLength: rangeLength || 0,
                            text: change.text || ""
                        });
                    }
                }
            }

            if (isGroupFullReplacement && groupFullText !== null) {
                const oldLen = currentTextLength;
                currentTextLength = groupFullText.length;
                lspFacade.lastAstRoot = 0;
                globalAstRoot = lspFacade.parseIncremental(groupFullText, 0, oldLen, groupFullText.length, latestUri);
                hadAnyEdit = true;
            } else if (groupEdits.length > 0) {
                let newTotalLen = currentTextLength;
                for (const edit of groupEdits) {
                    newTotalLen = newTotalLen - edit.rangeLength + edit.text.length;
                }
                currentTextLength = newTotalLen;
                if (groupEdits.length === 1) {
                    const edit = groupEdits[0];
                    globalAstRoot = lspFacade.parseIncremental(edit.text, edit.rangeOffset, edit.rangeLength, newTotalLen, latestUri);
                } else {
                    groupEdits.sort((a, b) => b.rangeOffset - a.rangeOffset);
                    globalAstRoot = lspFacade.parseIncrementalBatch(groupEdits, newTotalLen, latestUri);
                }
                hadAnyEdit = true;
            }
        }
        lastUpdatedLineStarts = lspFacade.getLineStarts();

        if (!hadAnyEdit) {
            console.log("[LSP Worker] No edits applied in runDiagnosticsNow");
            return;
        }

        const rawDiags = lspFacade.getDiagnostics(globalAstRoot);
        lastDiags = (rawDiags || []).map(d => ({
            range: d.range,
            severity: d.severity,
            code: d.code,
            message: d.message,
            source: currentLangName,
            startCharOffset: d.startCharOffset,
            endCharOffset: d.endCharOffset
        }));
        console.log("[LSP Worker] getDiagnostics returned " + lastDiags.length + " diagnostic(s)");
        
        let patchBufToTransfer = patchBuffer.slice(0, patchOffset * 4);
        patchBuffer = (patchBuffer === patchBufferA) ? patchBufferB : patchBufferA;
        patchInt32 = new Int32Array(patchBuffer);
        
        let lineStartsBuf = null;
        if (lastUpdatedLineStarts && lastUpdatedLineStarts.length > 0) {
            const copy = new Uint32Array(lastUpdatedLineStarts.length);
            copy.set(lastUpdatedLineStarts);
            lineStartsBuf = copy.buffer;
        }
        
        const patchMsg = {
            type: 'astPatchBinary',
            rootId: globalAstRoot,
            buffer: patchBufToTransfer,
            lineStartsBuffer: lineStartsBuf,
            diagnostics: lastDiags,
            isFullReset: isFullResetNeeded,
            charMult: charMult
        };
        
        console.log("[LSP Worker] Posting astPatchBinary: rootId=" + globalAstRoot + ", patchBytes=" + patchBufToTransfer.byteLength + ", isFullReset=" + isFullResetNeeded);
        const transferables = lineStartsBuf ? [patchBufToTransfer, lineStartsBuf] : [patchBufToTransfer];
        self.postMessage(patchMsg, transferables);
        self.postMessage({
            jsonrpc: '2.0',
            method: 'textDocument/publishDiagnostics',
            params: { uri: latestUri, diagnostics: lastDiags }
        });
    } catch(err) {
        console.error("[LSP Worker] ERROR in runDiagnosticsNow:", err);
    } finally {
        isParsing = false;
        if (pendingEventGroups.length > 0) {
            if (parseDebounceTimer) clearTimeout(parseDebounceTimer);
            parseDebounceTimer = setTimeout(() => {
                if (!isParsing && pendingEventGroups.length > 0) {
                    runDiagnosticsNow();
                }
            }, 20);
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
                let text = "";
                if (lspFacade.exports.getInputBuffer) {
                    const raw = new Uint8Array(lspFacade.wasmMemory.buffer, lspFacade.exports.getInputBuffer(), currentTextLength * 2);
                    text = new TextDecoder('utf-16le').decode(new Uint8Array(raw));
                }
                
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
                engine: { debugLog: function(cat, v1, v2, v3) { console.log("[WASM debugLog] cat=" + cat + ", v1=" + v1 + ", v2=" + v2 + ", v3=" + v3); } },
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
            
            try {
                const cleanedJs = jsWrapper
                    .replace(/^\\s*export\\s+\\{[\\s\\S]*?\\};?/gm, "")
                    .replace(/^\\s*export\\s+default\\s+/gm, "")
                    .replace(/^\\s*export\\s+(var|let|const|class|function|enum|interface|type|declare|async function)\\s+/gm, "$1 ")
                    .replace(/^\\s*export\\b.*/gm, "// $&");
                const evalFn = new Function(cleanedJs + "; return { LspFacade, Tree, SyntaxNode };");
                const res = evalFn();
                LspFacade = res.LspFacade;
                Tree = res.Tree;
                SyntaxNode = res.SyntaxNode;
            } catch (e1) {
                console.error("Evaluation failed for LspFacade in worker-lsp:", e1);
                throw e1;
            }

            const origLog = console.log;
            console.log = function(...args) {
                if (args[0] && typeof args[0] === 'string' && (args[0].startsWith('[') || args[0].includes('LSP') || args[0].includes('Bindings') || args[0].includes('WASM') || args[0].includes('CHILD_CALC'))) {
                    self.postMessage({ type: 'worker_log', args: args });
                }
                origLog.apply(console, args);
            };
            
            const origWarn = console.warn;
            console.warn = function(...args) {
                self.postMessage({ type: 'worker_log', args: ['[WARN]', ...args] });
                origWarn.apply(console, args);
            };

            const origError = console.error;
            console.error = function(...args) {
                self.postMessage({ type: 'worker_log', args: ['[ERROR]', ...args] });
                origError.apply(console, args);
            };
            
            lspFacade = new LspFacade(memory, instance.exports);
            if (syntaxNames) lspFacade.syntaxNames = syntaxNames;
            
            lspFacade.addAstChangeListener({
                onFullReset: (newRoot) => {
                    isFullResetNeeded = true;
                    patchOffset = 0;
                },
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
            console.log("[LSP Worker] textDocument/didOpen: uri=" + uri + ", textLength=" + (fullText ? fullText.length : 0));
            if (!lspFacade) {
                pendingFullText = fullText;
            } else {
                if (lspFacade.resetParser) lspFacade.resetParser();
                currentTextLength = 0;
                triggerDiagnostics([{ text: fullText }]);
            }
        } else {
            console.log("[LSP Worker] textDocument/didChange: uri=" + uri + ", contentChanges count=" + (params.contentChanges ? params.contentChanges.length : 0));
            triggerDiagnostics(params.contentChanges);
        }
    } else if (e.data.method === 'textDocument/didClose') {
        const uri = e.data.params?.textDocument?.uri;
        if (uri && lspFacade && lspFacade.removeDocument) {
            lspFacade.removeDocument(uri);
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
    } else if (e.data.method === 'textDocument/completion') {
        try {
            const params = e.data.params;
            const pos = params.position; // { line, character }
            
            let docText = (params.textDocument && typeof params.textDocument.text === 'string') 
                ? params.textDocument.text 
                : "";
            
            if (!docText && lspFacade && lspFacade.exports && lspFacade.exports.getInputBuffer && currentTextLength > 0) {
                const inputBuf = lspFacade.exports.getInputBuffer();
                if (inputBuf > 0) {
                    const isUtf16 = (lspFacade.getInputEncoding ? lspFacade.getInputEncoding() : 1) === 1;
                    const decoder = isUtf16 ? new TextDecoder('utf-16le') : new TextDecoder('utf-8');
                    const rawBytes = new Uint8Array(lspFacade.wasmMemory.buffer, inputBuf, currentTextLength * (isUtf16 ? 2 : 1));
                    const copyBytes = new Uint8Array(rawBytes);
                    docText = decoder.decode(copyBytes).replace(/\0/g, '');
                }
            }
            
            const NL = String.fromCharCode(10);
            const lines = docText.split(NL);
            const lineText = lines[pos.line] || '';
            const textBeforeCursor = lineText.slice(0, pos.character);
            
            const items = [];
            
            const lineStarts = (lspFacade && typeof lspFacade.getLineStarts === 'function')
                ? lspFacade.getLineStarts()
                : new Uint32Array([0]);
            const isUtf16 = (lspFacade && lspFacade.getInputEncoding ? lspFacade.getInputEncoding() : 1) === 1;
            const charMult = isUtf16 ? 2 : 1;

            let cursorOffset = 0;
            if (lspFacade && typeof lspFacade.posToOffset === 'function') {
                cursorOffset = lspFacade.posToOffset(pos.line, pos.character, lineStarts);
            } else if (lineStarts && pos.line < lineStarts.length) {
                cursorOffset = lineStarts[pos.line] + (pos.character * charMult);
            }

            const cstCtx = (lspFacade && globalAstRoot > 0 && typeof lspFacade.getCompletionContext === 'function')
                ? lspFacade.getCompletionContext(globalAstRoot, cursorOffset)
                : null;

            let targetExpr = "";
            let replaceRange = null;

            // Universal member access delimiter regex: supports dot '.', arrow '->', double-colon '::', etc.
            const memberAccessRegex = new RegExp('([a-zA-Z_][a-zA-Z0-9_.\\[\\]()]*)(?:\\.|->|::)([a-zA-Z0-9_]*)$');
            const memberMatch = textBeforeCursor.match(memberAccessRegex);
            const isMemberContext = Boolean(memberMatch || (cstCtx && cstCtx.hasTarget && cstCtx.targetText));

            if (cstCtx && cstCtx.hasTarget && cstCtx.targetText) {
                targetExpr = cstCtx.targetText;
                const startPos = (lspFacade && typeof lspFacade.offsetToPos === 'function')
                    ? lspFacade.offsetToPos(cstCtx.replaceRange.start, lineStarts)
                    : { line: pos.line, character: pos.character };
                const endPos = (lspFacade && typeof lspFacade.offsetToPos === 'function')
                    ? lspFacade.offsetToPos(cstCtx.replaceRange.end, lineStarts)
                    : { line: pos.line, character: pos.character };
                replaceRange = { start: startPos, end: endPos };
            } else if (memberMatch) {
                targetExpr = memberMatch[1];
                const prefixLen = memberMatch[2] ? memberMatch[2].length : 0;
                replaceRange = {
                    start: { line: pos.line, character: pos.character - prefixLen },
                    end: { line: pos.line, character: pos.character }
                };
            }

            // =========================================================================
            // 1. GENERIC AST-BASED SYMBOL & SCOPE GRAPH
            // =========================================================================
            let tree = null;
            if (Tree && lspFacade && globalAstRoot > 0) {
                try {
                    tree = new Tree(lspFacade, globalAstRoot, docText);
                } catch (errTree) {}
            }

            const typeDefinitions = new Map(); // TypeName -> { name, typeNode, members: Array<{ name, type }> }
            const scopeDeclarations = new Map(); // ScopeKey -> Array<{ name, type }>

            // Recursive AST Symbol & Type Harvester
            function walkAstForSymbols(node, currentScope) {
                if (!node || node.ptr === 0) return;

                const nameNode = node.childForFieldName ? node.childForFieldName("name") : null;
                const typeNode = node.childForFieldName ? node.childForFieldName("type") : null;

                let isContainer = false;
                let containerName = "";

                if (nameNode && nameNode.text && node.childCount > 2) {
                    const nText = nameNode.text.trim();
                    if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(nText)) {
                        containerName = nText;
                        if (!typeDefinitions.has(containerName)) {
                            typeDefinitions.set(containerName, {
                                name: containerName,
                                typeNode: node,
                                members: []
                            });
                        }
                        isContainer = true;
                    }
                }

                if (nameNode && nameNode.text) {
                    const varName = nameNode.text.trim();
                    let varType = typeNode ? typeNode.text.trim() : "";
                    
                    if (!varType && node.children) {
                        for (const child of node.children) {
                            if (child.ptr !== nameNode.ptr && /^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(child.text.trim()) && child.startIndex < nameNode.startIndex) {
                                varType = child.text.trim();
                                break;
                            }
                        }
                    }

                    if (varName && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(varName) && varName !== containerName) {
                        const decl = { name: varName, type: varType };
                        if (currentScope && typeDefinitions.has(currentScope)) {
                            typeDefinitions.get(currentScope).members.push(decl);
                        }
                        const scopeKey = currentScope || "global";
                        if (!scopeDeclarations.has(scopeKey)) scopeDeclarations.set(scopeKey, []);
                        scopeDeclarations.get(scopeKey).push(decl);
                    }
                }

                const nextScope = isContainer ? containerName : currentScope;
                if (node.children) {
                    for (const child of node.children) {
                        walkAstForSymbols(child, nextScope);
                    }
                }
            }

            if (tree && tree.rootNode) {
                walkAstForSymbols(tree.rootNode, null);
            }

            // Universal text scanner for in-flight / partial grammar declarations
            function scanGenericTextDeclarations() {
                let currentContainer = null;
                const containerStartRegex = new RegExp('^\\s*(?:[a-zA-Z0-9_]+\\s+)*?(model|connector|record|block|class|function|package|type|interface|struct|enum|actor|component|entity|module|def)\\s+([a-zA-Z_][a-zA-Z0-9_]*)');
                const containerEndRegex = new RegExp('^\\s*(?:end(?:\\s+([a-zA-Z_][a-zA-Z0-9_]*))?\\s*;?|\\})');
                const cDeclLineRegex = new RegExp('^\\s*(?:[a-zA-Z0-9_]+\\s+)*?([a-zA-Z_][a-zA-Z0-9_.]*)\\s+([^;]+);?');
                const colonDeclRegex = new RegExp('^\\s*(?:[a-zA-Z0-9_]+\\s+)*?([a-zA-Z_][a-zA-Z0-9_]*)\\s*:\\s*([a-zA-Z_][a-zA-Z0-9_.]*)');

                for (let i = 0; i < lines.length; i++) {
                    const l = lines[i].trim();
                    if (!l || l.startsWith('//') || l.startsWith('/*')) continue;

                    const cStart = l.match(containerStartRegex);
                    if (cStart) {
                        if (currentContainer && typeDefinitions.has(currentContainer)) {
                            typeDefinitions.get(currentContainer).endLine = i - 1;
                        }
                        currentContainer = cStart[2];
                        if (!typeDefinitions.has(currentContainer)) {
                            typeDefinitions.set(currentContainer, { 
                                name: currentContainer, 
                                startLine: i, 
                                endLine: lines.length - 1, 
                                typeNode: null, 
                                members: [] 
                            });
                        } else {
                            const def = typeDefinitions.get(currentContainer);
                            def.startLine = i;
                            def.endLine = lines.length - 1;
                        }
                        continue;
                    }

                    const cEnd = l.match(containerEndRegex);
                    if (cEnd) {
                        const endName = cEnd[1];
                        if (!endName || endName === currentContainer) {
                            if (currentContainer && typeDefinitions.has(currentContainer)) {
                                typeDefinitions.get(currentContainer).endLine = i;
                            }
                            currentContainer = null;
                            continue;
                        }
                    }

                    if (l.startsWith('connect(') || l.startsWith('equation') || l.startsWith('algorithm')) continue;

                    const colonMatch = l.match(colonDeclRegex);
                    if (colonMatch) {
                        const vName = colonMatch[1];
                        const vType = colonMatch[2];
                        if (vName && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(vName)) {
                            const decl = { name: vName, type: vType };
                            if (currentContainer && typeDefinitions.has(currentContainer)) {
                                const def = typeDefinitions.get(currentContainer);
                                if (!def.members.some(m => m.name === vName)) def.members.push(decl);
                            }
                            const scopeKey = currentContainer || "global";
                            if (!scopeDeclarations.has(scopeKey)) scopeDeclarations.set(scopeKey, []);
                            const sDecls = scopeDeclarations.get(scopeKey);
                            if (!sDecls.some(d => d.name === vName)) sDecls.push(decl);
                        }
                        continue;
                    }

                    const cMatch = l.match(cDeclLineRegex);
                    if (cMatch) {
                        const vType = cMatch[1];
                        const rest = cMatch[2];
                        const vars = rest.split(',');
                        for (let v of vars) {
                            v = v.trim();
                            const vNameMatch = v.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
                            if (vNameMatch) {
                                const vName = vNameMatch[1];
                                if (vName && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(vName) && vName !== 'equation' && vName !== 'algorithm' && vName !== 'end') {
                                    const decl = { name: vName, type: vType };
                                    if (currentContainer && typeDefinitions.has(currentContainer)) {
                                        const def = typeDefinitions.get(currentContainer);
                                        if (!def.members.some(m => m.name === vName)) def.members.push(decl);
                                    }
                                    const scopeKey = currentContainer || "global";
                                    if (!scopeDeclarations.has(scopeKey)) scopeDeclarations.set(scopeKey, []);
                                    const sDecls = scopeDeclarations.get(scopeKey);
                                    if (!sDecls.some(d => d.name === vName)) sDecls.push(decl);
                                }
                            }
                        }
                    }
                }
            }

            scanGenericTextDeclarations();

            // Find current scope at cursor position
            let enclosingScopeName = "";
            for (const [tName, def] of typeDefinitions.entries()) {
                if (pos.line >= def.startLine && pos.line <= def.endLine) {
                    enclosingScopeName = tName;
                }
            }
            if (!enclosingScopeName) {
                const containerStartRegex = new RegExp('^\\s*(?:[a-zA-Z0-9_]+\\s+)*?(model|connector|record|block|class|function|package|type|interface|struct|enum|actor|component|entity|module|def)\\s+([a-zA-Z_][a-zA-Z0-9_]*)');
                for (let i = pos.line; i >= 0; i--) {
                    const m = lines[i].match(containerStartRegex);
                    if (m) {
                        enclosingScopeName = m[2];
                        break;
                    }
                }
            }

            // Universal Type Resolver
            function resolveGenericType(exprStr, scopeName) {
                if (!exprStr) return "";
                let clean = exprStr.trim();
                while (clean.startsWith('(') && clean.endsWith(')')) clean = clean.slice(1, -1).trim();

                // Array / Index
                if (clean.endsWith(']')) {
                    const openBracket = clean.lastIndexOf('[');
                    if (openBracket > 0) return resolveGenericType(clean.slice(0, openBracket), scopeName);
                }

                // Call / Invocation
                if (clean.endsWith(')')) {
                    const openParen = clean.lastIndexOf('(');
                    if (openParen > 0) {
                        const callee = clean.slice(0, openParen);
                        return resolveGenericType(callee, scopeName);
                    }
                }

                // Chained Member Access e.g. a.b.c
                if (clean.includes('.')) {
                    const parts = clean.split('.');
                    let currType = resolveGenericType(parts[0], scopeName);
                    for (let idx = 1; idx < parts.length; idx++) {
                        const prop = parts[idx].trim();
                        if (!currType || !typeDefinitions.has(currType)) return "";
                        const def = typeDefinitions.get(currType);
                        const member = def.members.find(m => m.name === prop);
                        if (member) currType = member.type;
                        else return "";
                    }
                    return currType;
                }

                // Scope lookups (innermost scope -> global scope)
                const scopesToSearch = [scopeName, "global"].filter(Boolean);
                for (const s of scopesToSearch) {
                    if (scopeDeclarations.has(s)) {
                        const decl = scopeDeclarations.get(s).find(d => d.name === clean);
                        if (decl && decl.type) return decl.type;
                    }
                    if (typeDefinitions.has(s)) {
                        const member = typeDefinitions.get(s).members.find(m => m.name === clean);
                        if (member && member.type) return member.type;
                    }
                }

                // Fallback: search across all scopes in document
                for (const [s, decls] of scopeDeclarations.entries()) {
                    const decl = decls.find(d => d.name === clean);
                    if (decl && decl.type) return decl.type;
                }
                for (const [t, def] of typeDefinitions.entries()) {
                    const member = def.members.find(m => m.name === clean);
                    if (member && member.type) return member.type;
                }

                if (typeDefinitions.has(clean)) return clean;
                return "";
            }

            // =========================================================================
            // 2. DISPATCH COMPLETIONS BY CONTEXT
            // =========================================================================
            if (isMemberContext) {
                // In Member Context: ONLY return members of the target expression
                if (targetExpr) {
                    const resolvedType = resolveGenericType(targetExpr, enclosingScopeName);
                    if (resolvedType && typeDefinitions.has(resolvedType)) {
                        const typeDef = typeDefinitions.get(resolvedType);
                        for (const m of typeDef.members) {
                            items.push({
                                label: m.name,
                                kind: 6 /* Property / Field */,
                                detail: (m.type ? m.type + " " : "") + m.name,
                                documentation: "Member of " + resolvedType,
                                insertText: m.name,
                                filterText: m.name,
                                range: replaceRange
                            });
                        }
                    }
                }
            } else {
                // Non-member context: Grammar Keywords + In-Scope Declarations + Document Types
                // 1. Dynamic Grammar Keywords from Syntax Names
                const syntaxList = (lspFacade && Array.isArray(lspFacade.syntaxNames))
                    ? lspFacade.syntaxNames
                    : (self.syntaxNames && Array.isArray(self.syntaxNames))
                        ? self.syntaxNames
                        : [];

                const seenKeywords = new Set();
                for (const sym of syntaxList) {
                    if (sym && typeof sym === 'string' && sym.startsWith('"') && sym.endsWith('"')) {
                        const kw = sym.slice(1, -1);
                        if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(kw) && !seenKeywords.has(kw)) {
                            seenKeywords.add(kw);
                            items.push({
                                label: kw,
                                kind: 14, // Keyword
                                detail: "Keyword",
                                insertText: kw
                            });
                        }
                    }
                }

                // 2. Document Defined Types
                for (const [tName] of typeDefinitions.entries()) {
                    items.push({
                        label: tName,
                        kind: 7, // Class / Type
                        detail: "Type " + tName,
                        documentation: "Defined in document",
                        insertText: tName
                    });
                }

                // 3. Declarations In Current Scope
                const inScope = [enclosingScopeName, "global"].filter(Boolean);
                const seenVars = new Set();
                for (const s of inScope) {
                    if (scopeDeclarations.has(s)) {
                        for (const decl of scopeDeclarations.get(s)) {
                            if (!seenVars.has(decl.name)) {
                                seenVars.add(decl.name);
                                items.push({
                                    label: decl.name,
                                    kind: 6, // Variable
                                    detail: (decl.type ? decl.type + " " : "") + decl.name,
                                    documentation: "Declared in " + (s === "global" ? "document" : s),
                                    insertText: decl.name
                                });
                            }
                        }
                    }
                }
            }
            
            self.postMessage({ jsonrpc: '2.0', id: e.data.id, result: { items } });
        } catch (err) {
            console.error('[Completion Error]:', err);
            self.postMessage({ jsonrpc: '2.0', id: e.data.id, result: { items: [] } });
        }
    } else if (e.data.method === 'workspace/symbol') {
        if (!lspFacade) return self.postMessage({ jsonrpc: '2.0', id: e.data.id, result: [] });
        const query = e.data.params ? (e.data.params.query || "") : "";
        const symbols = lspFacade.fuzzyFindSymbols(query, 50);
        const lineStarts = lspFacade.getLineStarts();
        const result = (symbols || []).map(s => {
            const typeName = self.syntaxNames && self.syntaxNames[s.kind] ? self.syntaxNames[s.kind] : "Symbol";
            return {
                name: typeName,
                kind: s.kind || 5,
                location: {
                    uri: latestUri,
                    range: {
                        start: lspFacade.offsetToPos(s.startByte, lineStarts),
                        end: lspFacade.offsetToPos(s.endByte, lineStarts)
                    }
                }
            };
        });
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
            
            const tokensList = Array.from(data.subarray(0, dataIdx));
            self.postMessage({ jsonrpc: '2.0', id: e.data.id, result: { data: tokensList } });
        } catch (err) {
            console.error("Semantic Tokens Worker Error:", err);
            self.postMessage({ jsonrpc: '2.0', id: e.data.id, result: null });
        }
    } else if (e.data.method === 'modelscript/diagram/getData') {
        if (!lspFacade || !globalAstRoot) return self.postMessage({ jsonrpc: '2.0', id: e.data.id, result: { nodes: [], edges: [] } });
        const data = lspFacade.getDiagramData(globalAstRoot);
        self.postMessage({ jsonrpc: '2.0', id: e.data.id, result: data });
    } else if (e.data.method === 'modelscript/pipeline/execute') {
        if (!lspFacade || !globalAstRoot) return self.postMessage({ jsonrpc: '2.0', id: e.data.id, result: null });
        const pipelineId = e.data.params ? e.data.params.pipelineId : 'flatten';

        try {
            const result = lspFacade.executePipeline(globalAstRoot, pipelineId);
            self.postMessage({ jsonrpc: '2.0', id: e.data.id, result: result });
        } catch (err) {
            console.error("Pipeline Execution Worker Error:", err);
            self.postMessage({ jsonrpc: '2.0', id: e.data.id, result: null });
        }
    }
};
`;
}
