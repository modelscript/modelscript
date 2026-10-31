// SPDX-License-Identifier: AGPL-3.0-or-later

import react from "@vitejs/plugin-react";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

interface StaticCopyTarget {
  src?: string;
  content?: string;
  dest: string;
  rename?: string;
}

const LANGUAGE_EXTENSIONS_MAP: Record<string, string[]> = {
  adams: [".adm", ".cmd", ".acf"],
  aspen: [".bkp", ".inp", ".apw"],
  autosar: [".arxml"],
  c: [".c", ".h"],
  ccsds: [".oem", ".omm", ".opm", ".ocm", ".tdm", ".ndm"],
  cfd: [".su2", ".cfg"],
  csv: [".csv", ".tsv"],
  easy5: [".ezmf", ".ez5", ".easy5"],
  eclipse: [".data", ".inc", ".grdecl"],
  energyplus: [".idf", ".epJSON"],
  epanet: [".inp", ".net"],
  fea: [".inp", ".bdf", ".dat", ".fem", ".k"],
  fortran: [".f90", ".f95", ".f03", ".f08", ".f", ".for"],
  gensys: [".gen", ".tsimf", ".runf", ".mplotf", ".optif", ".fresf"],
  gtsuite: [".gtm", ".gtp"],
  ibis: [".ibs", ".ebd", ".pkg"],
  jsbsim: [".xml"],
  lps: [".lps", ".lpsx"],
  modelica: [".mo"],
  modelscript: [".msx", ".modelscript"],
  olga: [".genkey", ".key", ".inp"],
  opendrive: [".xodr"],
  opendss: [".dss"],
  openscenario: [".xosc"],
  owl2: [".ofn", ".owl", ".owl2", ".fss", ".ttl"],
  plcopen: [".st", ".iec", ".plcopen"],
  pscad: [".pscx", ".pslx"],
  psse: [".raw", ".dyr", ".seq"],
  relap5: [".i", ".relap"],
  reqif: [".reqif", ".reqifz"],
  rocets: [".roc", ".rocets", ".inp"],
  sbml: [".sbml", ".xml"],
  scad: [".scad"],
  sima: [".sima", ".stask"],
  simpack: [".spck", ".sim", ".sub"],
  simulink: [".slx", ".mdl"],
  spice: [".sp", ".cir", ".net", ".lib", ".sub"],
  ssp: [".ssd", ".ssv", ".ssm", ".ssp"],
  step: [".step", ".stp", ".p21"],
  swmm: [".inp", ".swmm"],
  sysml2: [".sysml", ".kerml", ".sysml2"],
  touchstone: [".s1p", ".s2p", ".s3p", ".s4p", ".snp", ".ts"],
  urdf: [".urdf", ".sdf", ".xacro"],
  "verilog-a": [".va", ".vams"],
};

function discoverLanguageWasmTargets(): {
  targets: StaticCopyTarget[];
  manifest: { id: string; extensions: string[]; wasm: string }[];
} {
  const languagesRoot = path.resolve(import.meta.dirname, "../../languages");
  const targets: StaticCopyTarget[] = [];
  const manifest: { id: string; extensions: string[]; wasm: string }[] = [];

  if (fs.existsSync(languagesRoot)) {
    const entries = fs.readdirSync(languagesRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const lang = entry.name;
      const distWasm = path.join(languagesRoot, lang, "dist", "parser.wasm");
      const rootWasm = path.join(languagesRoot, lang, "parser.wasm");
      const wasmPath = fs.existsSync(distWasm)
        ? `../../languages/${lang}/dist/parser.wasm`
        : fs.existsSync(rootWasm)
          ? `../../languages/${lang}/parser.wasm`
          : null;

      if (wasmPath) {
        const wasmFileName = `${lang}.wasm`;
        targets.push({
          src: wasmPath,
          dest: "lsp/server/dist",
          rename: wasmFileName,
        });
        manifest.push({
          id: lang,
          extensions: LANGUAGE_EXTENSIONS_MAP[lang] ?? [`.${lang}`],
          wasm: wasmFileName,
        });
      }
    }
  }

  return { targets, manifest };
}

function inlineStaticCopy(targets: StaticCopyTarget[]): Plugin {
  return {
    name: "inline-static-copy",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const reqPath = req.url?.split("?")[0] || "";
        for (const target of targets) {
          const fileName = target.rename || (target.src ? path.basename(target.src) : "");
          const servedPath = "/" + path.join(target.dest, fileName).replace(/\\/g, "/");
          if (reqPath === servedPath) {
            if (target.content !== undefined) {
              if (fileName.endsWith(".json")) {
                res.setHeader("Content-Type", "application/json");
              }
              res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
              res.end(target.content);
              return;
            }
            if (target.src) {
              const fullSrc = path.resolve(import.meta.dirname, target.src);
              if (fs.existsSync(fullSrc)) {
                if (fileName.endsWith(".wasm")) {
                  res.setHeader("Content-Type", "application/wasm");
                  res.setHeader("Cache-Control", "no-cache");
                } else if (fileName.endsWith(".js")) {
                  res.setHeader("Content-Type", "application/javascript");
                  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
                } else if (fileName.endsWith(".json")) {
                  res.setHeader("Content-Type", "application/json");
                  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
                } else if (fileName.endsWith(".zip")) {
                  res.setHeader("Content-Type", "application/zip");
                }
                fs.createReadStream(fullSrc).pipe(res);
                return;
              }
            }
          }
        }
        if (reqPath.startsWith("/lsp/server/dist/") && reqPath.endsWith(".wasm")) {
          res.statusCode = 404;
          res.end("WASM binary not found");
          return;
        }
        next();
      });
    },
    async closeBundle() {
      const outDir = path.resolve(import.meta.dirname, "dist");
      for (const target of targets) {
        const fileName = target.rename || (target.src ? path.basename(target.src) : "");
        if (!fileName) continue;
        if (target.content !== undefined) {
          const destDir = path.resolve(outDir, target.dest);
          await fs.promises.mkdir(destDir, { recursive: true });
          const destFile = path.resolve(destDir, fileName);
          await fs.promises.writeFile(destFile, target.content, "utf-8");
          continue;
        }
        if (target.src) {
          const fullSrc = path.resolve(import.meta.dirname, target.src);
          if (fs.existsSync(fullSrc)) {
            const destDir = path.resolve(outDir, target.dest);
            await fs.promises.mkdir(destDir, { recursive: true });
            const destFile = path.resolve(destDir, fileName);
            await fs.promises.copyFile(fullSrc, destFile);
          }
        }
      }
    },
  };
}

const DOCS_ROUTE_PREFIXES = [
  "/docs",
  "/guide",
  "/ansatz",
  "/architecture",
  "/algorithms",
  "/cli",
  "/languages",
  "/reference",
  "/industries",
  "/pricing",
  "/vp-icons",
];

const DOCS_EXACT_PATHS = new Set([
  "/",
  "/docs",
  "/docs/",
  "/vp-icons.css",
  "/llms.txt",
  "/llms-full.txt",
  "/sitemap.xml",
  "/hashmap.json",
  "/modelscript-reference-manual.pdf",
]);

function getMimeTypeForDocFile(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
    case ".mjs":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".ico":
      return "image/x-icon";
    case ".pdf":
      return "application/pdf";
    case ".xml":
      return "application/xml; charset=utf-8";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

function unifiedDocsPlugin(): Plugin {
  const docsWorkspaceDir = path.resolve(import.meta.dirname, "../docs");
  const docsSourceDir = path.resolve(docsWorkspaceDir, "docs");
  const docsDistDir = path.resolve(docsSourceDir, ".vitepress/dist");

  let isBuildingDocs = false;
  let pendingRebuild = false;

  const triggerDocsBuild = (fullBuild: boolean) => {
    if (isBuildingDocs) {
      pendingRebuild = true;
      return;
    }
    isBuildingDocs = true;
    const args = fullBuild ? ["run", "build"] : ["vitepress", "build", "docs"];
    const cmd = fullBuild ? "npm" : "npx";
    const child = spawn(cmd, args, {
      cwd: docsWorkspaceDir,
      stdio: "ignore",
    });
    child.on("close", () => {
      isBuildingDocs = false;
      if (pendingRebuild) {
        pendingRebuild = false;
        triggerDocsBuild(false);
      }
    });
  };

  return {
    name: "unified-docs-portal",
    configureServer(server) {
      if (fs.existsSync(docsWorkspaceDir) && !fs.existsSync(path.join(docsDistDir, "index.html"))) {
        try {
          execFileSync("npm", ["run", "build"], { cwd: docsWorkspaceDir, stdio: "inherit" });
        } catch {
          triggerDocsBuild(true);
        }
      }

      if (fs.existsSync(docsSourceDir)) {
        server.watcher.add(docsSourceDir);
        server.watcher.on("change", (changedPath) => {
          const norm = changedPath.replace(/\\/g, "/");
          if (
            norm.startsWith(docsSourceDir.replace(/\\/g, "/")) &&
            !norm.includes("/.vitepress/dist/") &&
            !norm.includes("/.vitepress/cache/")
          ) {
            triggerDocsBuild(false);
          }
        });
      }

      server.middlewares.use((req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          next();
          return;
        }
        const rawUrl = req.url?.split("?")[0] || "";
        if (!rawUrl) {
          next();
          return;
        }

        if (rawUrl === "/docs" || rawUrl === "/docs/") {
          res.statusCode = 302;
          res.setHeader("Location", "/guide/introduction");
          res.end();
          return;
        }

        if (!fs.existsSync(docsDistDir)) {
          next();
          return;
        }

        const matchesPrefix = DOCS_ROUTE_PREFIXES.some((p) => rawUrl === p || rawUrl.startsWith(`${p}/`));
        const matchesExact = DOCS_EXACT_PATHS.has(rawUrl);
        const isDocsAsset = rawUrl.startsWith("/assets/");

        if (!matchesPrefix && !matchesExact && !isDocsAsset) {
          next();
          return;
        }

        const strippedPath =
          rawUrl === "/"
            ? "index.html"
            : rawUrl.startsWith("/docs/")
              ? rawUrl.slice("/docs/".length)
              : rawUrl.replace(/^\/+/, "");

        const safeRel = path
          .normalize(strippedPath)
          .replace(/^(\.\.[/\\])+/, "")
          .replace(/^[/\\]+/, "");
        const candidates = [
          path.resolve(docsDistDir, safeRel),
          path.resolve(docsDistDir, `${safeRel}.html`),
          path.resolve(docsDistDir, safeRel, "index.html"),
        ];

        for (const candidate of candidates) {
          const relToRoot = path.relative(docsDistDir, candidate);
          if (!relToRoot || relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
            continue;
          }
          if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            res.setHeader("Content-Type", getMimeTypeForDocFile(candidate));
            fs.createReadStream(candidate).pipe(res);
            return;
          }
        }

        next();
      });
    },
  };
}

const { targets: languageWasmTargets, manifest: languagesManifest } = discoverLanguageWasmTargets();

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    unifiedDocsPlugin(),
    react(),
    tsconfigPaths({ root: import.meta.dirname }),
    inlineStaticCopy(
      [
        // LSP WebWorker bundle + assets (WASM, standard library zips)
        // The LSP server resolves paths as ${extensionUri}/server/dist/...
        // With extensionUri = origin + "/lsp", files are served at /lsp/server/dist/...
        {
          src: "../../packages/lsp/dist/browserServerMain.js",
          dest: "lsp/server/dist",
        },
        {
          src: "../../packages/lsp/dist/workers/indexer.worker.js",
          dest: "lsp/server/dist/workers",
        },
        {
          content: JSON.stringify(languagesManifest, null, 2),
          dest: "lsp/server/dist",
          rename: "languages-manifest.json",
        },
        ...languageWasmTargets,
        {
          src: "../../packages/runtime/build/release.wasm",
          dest: "lsp/server/dist",
        },
        {
          src: "../../node_modules/occt-import-js/dist/occt-import-js.wasm",
          dest: "lsp/server/dist",
        },
        {
          src: "../../scripts/ModelicaStandardLibrary_v4.1.0.zip",
          dest: "lsp/server/dist",
        },
        {
          src: "../../scripts/SysML-v2-Release-2026-03.zip",
          dest: "lsp/server/dist",
        },
      ].filter((t) => {
        if (t.content !== undefined) return true;
        if (!t.src) return false;
        const resolved = path.resolve(import.meta.dirname, t.src);
        const exists = fs.existsSync(resolved);
        if (!exists && process.env["VITE_REQUIRE_STDLIBS"] === "true") {
          throw new Error(
            `[vite.config.ts] Required standard library asset is missing: ${resolved}. Run scripts/fetch-stdlibs.sh first.`,
          );
        }
        if (!exists && process.env["NODE_ENV"] === "production" && !process.env["VITEST"]) {
          console.warn(`[vite.config.ts] Optional standard library asset not found: ${t.src}`);
        }
        return exists;
      }),
    ),
  ],
  build: {
    target: "esnext",
    minify: "esbuild",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("packages/cad") || id.includes("@modelscript/cad") || id.includes("occt-import-js")) {
            return "vendor-cad";
          }
          if (
            id.includes("packages/dsl") ||
            id.includes("@modelscript/dsl") ||
            id.includes("languages/modelica") ||
            id.includes("@modelscript/modelica")
          ) {
            return "vendor-compiler";
          }
          if (id.includes("node_modules")) {
            if (id.includes("monaco-editor") || id.includes("@monaco-editor")) {
              return "vendor-monaco";
            }
            if (id.includes("three") || id.includes("@react-three")) {
              return "vendor-three";
            }
            if (
              id.includes("mermaid") ||
              id.includes("cytoscape") ||
              id.includes("dagre") ||
              id.includes("katex") ||
              id.includes("elkjs")
            ) {
              return "vendor-mermaid";
            }
            if (id.includes("@antv")) {
              return "vendor-antv";
            }
            if (id.includes("recharts") || id.includes("d3-scale") || id.includes("vega")) {
              return "vendor-charts";
            }
            if (id.includes("@primer")) {
              return "vendor-primer";
            }
            if (id.includes("@mlc-ai/web-llm")) {
              return "vendor-webllm";
            }
          }
          return undefined;
        },
      },
    },
  },
  define: {
    "process.env": {},
    "process.browser": true,
    "process.versions": {},
  },
  resolve: {
    dedupe: ["react", "react-dom", "react-router-dom", "styled-components", "@primer/react", "three"],
  },
  optimizeDeps: {
    include: [
      "@antv/layout",
      "@antv/x6",
      "@monaco-editor/react",
      "@primer/octicons-react",
      "@primer/react",
      "@react-three/drei",
      "@react-three/fiber",
      "pako",
      "recharts",
      "three",
    ],
  },
  server: {
    port: 3001,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
        xfwd: true,
      },
      "/.well-known": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
        xfwd: true,
      },
      "/nodeinfo": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
        xfwd: true,
      },
      "/actor": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
        xfwd: true,
      },
      "/thumbnails": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
        xfwd: true,
      },
      "/vscode": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
        xfwd: true,
        ws: true,
      },
      "/vscode-static": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
        xfwd: true,
      },
      "/static": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
        xfwd: true,
      },
    },
  },
});
