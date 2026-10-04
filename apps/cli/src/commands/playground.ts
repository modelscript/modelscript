// SPDX-License-Identifier: AGPL-3.0-or-later

import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import path, { basename, dirname, join, normalize, resolve } from "node:path";
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
      // In helper files, also strip external @modelscript/dsl imports
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

        const dslPathCandidate = join(__dirname, "../../../../packages/dsl/src/dsl/language.ts");
        const dslPath = existsSync(dslPathCandidate)
          ? dslPathCandidate
          : join(__dirname, "../../../../packages/dsl/src/dsl/dsl.ts");
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
        const browserJsPath = join(__dirname, "../../../../packages/dsl/dist/browser.js");
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
        const tsJsPath = join(__dirname, "../../../../packages/dsl/dist/typescript.mjs");
        res.end(existsSync(tsJsPath) ? readFileSync(tsJsPath) : "");
      } else if (urlPath === "/diagram.browser.js") {
        headers["Content-Type"] = "application/javascript";
        res.writeHead(200, headers);
        const diagramJsPath = join(__dirname, "../../../../packages/diagram/dist/diagram.browser.js");
        res.end(existsSync(diagramJsPath) ? readFileSync(diagramJsPath) : "");
      } else if (urlPath?.startsWith("/vendor/")) {
        headers["Content-Type"] = "application/javascript";
        res.writeHead(200, headers);
        const fileName = basename(urlPath.slice(8));
        const vendorDistDir = resolve(__dirname, "../vendor");
        const vendorSrcDir = resolve(__dirname, "../../src/vendor");
        const vendorDist = resolve(vendorDistDir, fileName);
        const vendorSrc = resolve(vendorSrcDir, fileName);
        let vendorPath = "";
        if (vendorDist.startsWith(vendorDistDir + path.sep) && existsSync(vendorDist)) {
          vendorPath = vendorDist;
        } else if (vendorSrc.startsWith(vendorSrcDir + path.sep) && existsSync(vendorSrc)) {
          vendorPath = vendorSrc;
        }
        res.end(vendorPath ? readFileSync(vendorPath) : "");
      } else if (urlPath?.startsWith("/node_modules/")) {
        const rootNodeModules = resolve(__dirname, "../../../../node_modules");
        const cliNodeModules = resolve(__dirname, "../../node_modules");
        const safeSubPath = normalize(urlPath.slice(14)).replace(/^(\.\.[/\\])+/, "");
        const cliPath = resolve(cliNodeModules, safeSubPath);
        const rootPath = resolve(rootNodeModules, safeSubPath);
        let filePath = "";
        if (cliPath.startsWith(cliNodeModules + path.sep) && existsSync(cliPath)) {
          filePath = cliPath;
        } else if (rootPath.startsWith(rootNodeModules + path.sep) && existsSync(rootPath)) {
          filePath = rootPath;
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
        const faviconPath = join(__dirname, "../../../../apps/web/public/favicon.ico");
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
      } else if (urlPath === "/api/export-extension" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", async () => {
          try {
            const payload = JSON.parse(body);
            const { bundleExtension } = await import("@modelscript/dsl");
            const langInput = payload.languages || payload.language || { name: payload.name || "dsl", rules: {} };
            const files = bundleExtension(langInput, payload.options);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, files }));
          } catch (_e: any) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: "Failed to bundle extension" }));
          }
        });
      } else if (urlPath === "/api/thread/hypergraph") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            version: "1.0",
            threads: [
              {
                threadId: "THREAD-EV-001",
                status: "synced",
                revision: 1,
                domains: {
                  sysml2: { name: "ElectricPowertrain", kind: "PartDef", properties: { torque: 350.0, mass: 12.5 } },
                  modelica: {
                    name: "ElectricPowertrain",
                    kind: "ModelicaClass",
                    properties: { tau_max: 350.0, mass: 12.5 },
                  },
                  cad: { name: "Powertrain_Assembly", kind: "StepComponent", properties: { mass: 12.5 } },
                  requirements: {
                    name: "REQ-01",
                    kind: "Requirement",
                    properties: { targetTorque: 350.0, status: "Verified" },
                  },
                },
              },
            ],
          }),
        );
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

let cachedPlaygroundHtml: string | null = null;

function loadPlaygroundHtml(): string {
  if (cachedPlaygroundHtml !== null) return cachedPlaygroundHtml;
  const candidates = [
    resolve(__dirname, "../vendor/playground.html"),
    resolve(__dirname, "../../src/vendor/playground.html"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      cachedPlaygroundHtml = readFileSync(p, "utf-8");
      return cachedPlaygroundHtml;
    }
  }
  throw new Error("Could not find vendor/playground.html");
}

export function getIndexHtml(dslLibStr = "", dslLibModuleStr = "", initialDsl = "", initialCode = ""): string {
  const template = loadPlaygroundHtml();
  const dslModuleDecl = 'declare module "@modelscript/dsl" {\n' + dslLibModuleStr + "\n}";
  return template
    .replace("__DSL_LIB__", JSON.stringify(dslLibStr))
    .replace("__DSL_LIB_MODULE__", JSON.stringify(dslLibModuleStr))
    .replace("__DSL_MODULE_DECL__", JSON.stringify(dslModuleDecl))
    .replace("__INITIAL_DSL__", JSON.stringify(initialDsl))
    .replace("__INITIAL_CODE__", JSON.stringify(initialCode));
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
const uriByFileId = new Map();
const fileIdByUri = new Map();
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

// Each entry is one Monaco event's changes array with version — must be processed sequentially
// because changes from different events use different document coordinate spaces.
let pendingEventGroups = [];
let isParsing = false;
let parseDebounceTimer = null;

function triggerDiagnostics(changes = null, version = undefined) {
    if (changes && changes.length > 0) {
        pendingEventGroups.push({ changes, version });
    }
    
    if (parseDebounceTimer) clearTimeout(parseDebounceTimer);
    parseDebounceTimer = setTimeout(() => {
        if (!isParsing && pendingEventGroups.length > 0) {
            runDiagnosticsNow();
        }
    }, 50);
}

async function runDiagnosticsNow() {
    if (!lspFacade || pendingEventGroups.length === 0) return;
    
    isParsing = true;
    let latestProcessedVersion = undefined;

    try {
        const charMult = (lspFacade && typeof lspFacade.getInputEncoding === 'function' ? lspFacade.getInputEncoding() : 1) === 1 ? 2 : 1;
        patchOffset = 0;
        isFullResetNeeded = false;
        let lastDiags = [];
        let lastUpdatedLineStarts = null;
        let hadAnyEdit = false;

        while (pendingEventGroups.length > 0) {
            const eventGroups = pendingEventGroups.splice(0, pendingEventGroups.length);

            for (let gIdx = 0; gIdx < eventGroups.length; gIdx++) {
                const groupEntry = eventGroups[gIdx];
                const group = groupEntry.changes || groupEntry;
                if (groupEntry.version !== undefined) {
                    latestProcessedVersion = groupEntry.version;
                }
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
        }

        lastUpdatedLineStarts = lspFacade.getLineStarts();

        if (!hadAnyEdit) {
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
        
        const transferables = lineStartsBuf ? [patchBufToTransfer, lineStartsBuf] : [patchBufToTransfer];
        self.postMessage(patchMsg, transferables);
        self.postMessage({
            jsonrpc: '2.0',
            method: 'textDocument/publishDiagnostics',
            params: { uri: latestUri, version: latestProcessedVersion, diagnostics: lastDiags }
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
            }, 50);
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
        if (uri) {
            latestUri = uri;
            if (lspFacade && typeof lspFacade.getOrCreateDocumentId === 'function') {
                try {
                    const fid = lspFacade.getOrCreateDocumentId(uri);
                    if (fid) {
                        uriByFileId.set(fid, uri);
                        fileIdByUri.set(uri, fid);
                    }
                } catch(e) {}
            }
        }
        
        if (e.data.method === 'textDocument/didOpen') {
            const fullText = params.textDocument?.text || params.contentChanges?.[0]?.text;
            console.log("[LSP Worker] textDocument/didOpen: uri=" + uri + ", textLength=" + (fullText ? fullText.length : 0));
            if (!lspFacade) {
                pendingFullText = fullText;
            } else {
                if (lspFacade.resetParser) lspFacade.resetParser();
                currentTextLength = 0;
                triggerDiagnostics([{ text: fullText }], params.textDocument?.version);
            }
        } else {
            console.log("[LSP Worker] textDocument/didChange: uri=" + uri + ", contentChanges count=" + (params.contentChanges ? params.contentChanges.length : 0));
            triggerDiagnostics(params.contentChanges, params.textDocument?.version);
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
            const targetUri = (def.fileId && uriByFileId.get(def.fileId)) || latestUri;
            self.postMessage({
                jsonrpc: '2.0',
                id: e.data.id,
                result: { uri: targetUri, range: { start: startPos, end: endPos } }
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
            uri: (ref.fileId && uriByFileId.get(ref.fileId)) || latestUri,
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
    } else if (e.data.method === 'textDocument/hover') {
        if (!lspFacade || !globalAstRoot) return self.postMessage({ jsonrpc: '2.0', id: e.data.id, result: null });
        const pos = e.data.params.position;
        const lineStarts = lspFacade.getLineStarts();
        const charMult = (lspFacade && typeof lspFacade.getInputEncoding === 'function' ? lspFacade.getInputEncoding() : 1) === 1 ? 2 : 1;
        let offset = 0;
        if (pos.line < lineStarts.length) {
            offset = lineStarts[pos.line] + (pos.character * charMult);
        }
        const node = (lspFacade.getNodeAtByteOffset ? lspFacade.getNodeAtByteOffset(globalAstRoot, offset) : 0);
        if (node > 0) {
            const typeId = lspFacade.getNodeType(node);
            const typeName = self.syntaxNames ? self.syntaxNames[typeId] : ("Node #" + typeId);
            const nodeLen = lspFacade.exports && lspFacade.exports.getNodeLength ? lspFacade.exports.getNodeLength(node) : charMult;
            const startPos = lspFacade.offsetToPos(offset, lineStarts);
            const endPos = lspFacade.offsetToPos(offset + nodeLen, lineStarts);
            self.postMessage({
                jsonrpc: '2.0',
                id: e.data.id,
                result: {
                    contents: [
                        { value: "**Syntax Kind:** " + typeName }
                    ],
                    range: { start: startPos, end: endPos }
                }
            });
        } else {
            self.postMessage({ jsonrpc: '2.0', id: e.data.id, result: null });
        }
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
            
            const lineStarts = (lspFacade && typeof lspFacade.getLineStarts === 'function')
                ? lspFacade.getLineStarts()
                : new Uint32Array([0]);
            const isUtf16 = (lspFacade && lspFacade.getInputEncoding ? lspFacade.getInputEncoding() : 1) === 1;
            const charMult = isUtf16 ? 2 : 1;

            let lineText = '';
            if (params.textDocument && typeof params.textDocument.text === 'string') {
                const NL = String.fromCharCode(10);
                const lines = params.textDocument.text.split(NL);
                lineText = lines[pos.line] || '';
            } else if (lspFacade && lspFacade.exports && lspFacade.exports.getInputBuffer && currentTextLength > 0 && pos.line < lineStarts.length) {
                const inputBuf = lspFacade.exports.getInputBuffer();
                if (inputBuf > 0) {
                    const lineStartByte = lineStarts[pos.line];
                    const nextLineByte = (pos.line + 1 < lineStarts.length) ? lineStarts[pos.line + 1] : (currentTextLength * charMult);
                    const lineByteLen = Math.max(0, nextLineByte - lineStartByte);
                    const decoder = isUtf16 ? new TextDecoder('utf-16le') : new TextDecoder('utf-8');
                    const copyBytes = new Uint8Array(lineByteLen);
                    copyBytes.set(new Uint8Array(lspFacade.wasmMemory.buffer, inputBuf + lineStartByte, lineByteLen));
                    lineText = decoder.decode(copyBytes).replace(/\\r?\\n$/, '');
                }
            }
            const textBeforeCursor = lineText.slice(0, pos.character);
            
            const items = [];

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
