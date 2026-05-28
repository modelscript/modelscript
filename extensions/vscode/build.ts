import * as esbuild from "esbuild";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const isWatch = process.argv.includes("--watch");
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Copy assets
function copyAssets() {
  const assets = [
    ["../../node_modules/web-tree-sitter/web-tree-sitter.wasm", "server/dist/web-tree-sitter.wasm"],
    ["../../languages/modelica/tree-sitter-modelica.wasm", "server/dist/tree-sitter-modelica.wasm"],
    ["../../languages/sysml2/tree-sitter-sysml2.wasm", "server/dist/tree-sitter-sysml2.wasm"],
    ["../../languages/step/tree-sitter-step.wasm", "server/dist/tree-sitter-step.wasm"],
    ["../../languages/owl2/tree-sitter-owl2.wasm", "server/dist/tree-sitter-owl2.wasm"],
    ["../../languages/csv/tree-sitter-csv.wasm", "server/dist/tree-sitter-csv.wasm"],
    ["../../node_modules/occt-import-js/dist/occt-import-js.wasm", "server/dist/occt-import-js.wasm"],
    ["../../scripts/ModelicaStandardLibrary_v4.1.0.zip", "server/dist/ModelicaStandardLibrary_v4.1.0.zip"],
    ["../../scripts/SysML-v2-Release-2026-03.zip", "server/dist/SysML-v2-Release-2026-03.zip"],
    ["../../packages/lsp/dist", "server/dist"],
  ];

  for (const [src, dest] of assets) {
    const srcPath = path.resolve(__dirname, src);
    const destPath = path.resolve(__dirname, dest);
    if (fs.existsSync(srcPath)) {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.cpSync(srcPath, destPath, { recursive: true });
    } else {
      console.warn(`Warning: Could not find asset to copy: ${srcPath}`);
    }
  }
}

// Configs
const browserClientConfig: esbuild.BuildOptions = {
  entryPoints: ["src/browserClientMain.ts"],
  outdir: "dist",
  bundle: true,
  format: "cjs",
  platform: "browser",
  external: ["vscode"],
  define: {
    "process.env": JSON.stringify({}),
    "process.browser": "true",
  },
  sourcemap: "inline",
};

const webviewConfig: esbuild.BuildOptions = {
  entryPoints: [
    "src/webview/diagram.ts",
    "src/webview/simulationWebview.ts",
    "src/webview/cosimWebview.ts",
    "src/webview/chatWebview.ts",
    "src/webview/chatWorker.ts",
    "src/webview/cadWebview.tsx",
    "src/webview/stepWebview.tsx",
    "src/webview/multibodyAnimationWebview.tsx",
    "src/webview/analysisWebview.ts",
    "src/webview/calibrationWebview.tsx",
    "src/webview/optimizationWebview.tsx",
    "src/webview/uncertaintyWebview.tsx",
    "src/webview/markdownPreview.ts",
    "src/webview/surrogateWebview.tsx",
  ],
  outdir: "dist",
  bundle: true,
  format: "esm",
  platform: "browser",
  sourcemap: "inline",
};

const notebookRendererConfig: esbuild.BuildOptions = {
  entryPoints: ["src/webview/notebookRenderer.ts"],
  outdir: "dist",
  bundle: true,
  format: "esm",
  platform: "browser",
  sourcemap: "inline",
};

async function build() {
  copyAssets();

  const configs = [browserClientConfig, webviewConfig, notebookRendererConfig];

  if (isWatch) {
    for (const config of configs) {
      const ctx = await esbuild.context(config);
      await ctx.watch();
    }
    console.log("Watching for changes...");
  } else {
    for (const config of configs) {
      await esbuild.build(config);
    }
    console.log("Build complete.");
  }
}

build().catch(console.error);
