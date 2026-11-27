// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BROWSER_BUFFER_AND_PROCESS_BANNER,
  BROWSER_BUFFER_BANNER,
  BROWSER_PROCESS_BANNER,
  createNodeBuiltinsIgnorePlugin,
} from "@modelscript/dsl";
import type { Plugin } from "esbuild";
import type * as FsTypes from "node:fs";
import type * as PathTypes from "node:path";
import type * as UrlTypes from "node:url";
import {
  generateExtensionBootstrap,
  generateFileIconTheme,
  generateLanguageGrammarAndConfigFiles,
} from "./grammar-and-config-generator.js";
import { discoverWorkspaceLanguages, type DiscoveredUiPanel } from "./language-discovery.js";
import {
  normalizeLanguages,
  type ExtensionGeneratedFile,
  type ExtensionOptions,
  type LanguageInputLike,
} from "./language-normalization.js";
import { generatePackageJson } from "./manifest-generator.js";

export const DEFAULT_VSCODEIGNORE = ["**/*.map", "**/*.ts", "tsconfig.json", "src/**", "*.vsix", ".DS_Store", ""].join(
  "\n",
);

/**
 * Generates the complete set of files for a VS Code Extension in-memory.
 * Returns a list of relative paths and string/binary contents.
 */
export function bundleExtension(
  languagesInput: LanguageInputLike[] | LanguageInputLike,
  options?: ExtensionOptions,
): ExtensionGeneratedFile[] {
  const rawList = Array.isArray(languagesInput) ? languagesInput : [languagesInput];
  const languages = normalizeLanguages(rawList);
  const files: ExtensionGeneratedFile[] = [];

  // 1. package.json
  const packageJson = generatePackageJson(languages, options);
  files.push({
    path: "package.json",
    content: JSON.stringify(packageJson, null, 2),
  });

  // 2. tsconfig.json & .vscodeignore
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
  files.push({
    path: "tsconfig.json",
    content: JSON.stringify(tsconfig, null, 2),
  });
  files.push({
    path: ".vscodeignore",
    content: DEFAULT_VSCODEIGNORE,
  });

  // 3. Language configurations & TextMate grammars for each language
  files.push(...generateLanguageGrammarAndConfigFiles(languages));

  // 4. Client bootstrap TypeScript source (src/extension.ts)
  files.push({
    path: "src/extension.ts",
    content: generateExtensionBootstrap(languages, options),
  });

  // 5. README.md & LICENSE.md
  files.push({
    path: "README.md",
    content: `# ${packageJson["displayName"] || "ModelScript"}\n\n${packageJson["description"] || ""}\n`,
  });
  files.push({
    path: "LICENSE.md",
    content: `GNU AFFERO GENERAL PUBLIC LICENSE Version 3\n\nCopyright © 2025-2026 Mohamad Omar Nachawati and ModelScript Contributors\n`,
  });

  return files;
}

/** Alias for `bundleExtension` for callers expecting `generateExtensionFiles`. */
export const generateExtensionFiles = bundleExtension;

function buildDslPanelBootstrapSource(panel: DiscoveredUiPanel): string {
  const importExpr =
    panel.exportName === "default"
      ? `import PanelComponent from ${JSON.stringify(panel.resolvedEntryPath)};`
      : `import { ${panel.exportName} as PanelComponent } from ${JSON.stringify(panel.resolvedEntryPath)};`;

  return `
import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "@modelscript/design-tokens/tokens.css";
import "@modelscript/design-tokens/tokens-vscode.css";
${importExpr}

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();
const pendingLsp = new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
let lspSeq = 0;

function DslPanelHostApp() {
  const [state, setState] = useState({
    code: "",
    dialect: ${JSON.stringify(panel.languageId)},
    colorMode: (document.body.classList.contains("vscode-light") ? "light" : "dark") as "dark" | "light",
    documentUri: undefined as string | undefined,
  });

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "syncDocument") {
        setState((prev) => ({
          code: typeof msg.code === "string" ? msg.code : prev.code,
          dialect: typeof msg.dialect === "string" ? msg.dialect : prev.dialect,
          colorMode: msg.colorMode === "light" || msg.colorMode === "dark" ? msg.colorMode : prev.colorMode,
          documentUri: typeof msg.documentUri === "string" ? msg.documentUri : prev.documentUri,
        }));
      } else if (msg.type === "lspResponse" && typeof msg.requestId === "string") {
        const entry = pendingLsp.get(msg.requestId);
        if (entry) {
          pendingLsp.delete(msg.requestId);
          if (msg.error) entry.reject(new Error(String(msg.error)));
          else entry.resolve(msg.result);
        }
      }
    };
    window.addEventListener("message", onMessage);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const host = useMemo(
    () => ({
      onCodeChange: (newCode: string) => vscode.postMessage({ type: "applyEdit", code: newCode }),
      onRevealLine: (line: number, identifier?: string) =>
        vscode.postMessage({ type: "revealLine", line, identifier }),
      onUpdateProjectFile: (relativePath: string, content: string) =>
        vscode.postMessage({ type: "updateProjectFile", relativePath, content }),
      requestLsp: <R = unknown>(method: string, params?: unknown) =>
        new Promise<R>((resolve, reject) => {
          const requestId = "lsp_" + (++lspSeq);
          pendingLsp.set(requestId, { resolve: resolve as (v: unknown) => void, reject });
          vscode.postMessage({ type: "requestLsp", requestId, method, params });
        }),
      exportFile: (filename: string, content: string | Uint8Array, mimeType?: string) => {
        const text = typeof content === "string" ? content : new TextDecoder().decode(content);
        vscode.postMessage({ type: "exportFile", filename, content: text, mimeType });
      },
      notify: (level: "info" | "warning" | "error", message: string) =>
        vscode.postMessage({ type: "notify", level, message }),
      openExternal: (url: string) => vscode.postMessage({ type: "openExternal", url }),
    }),
    [],
  );

  return React.createElement(PanelComponent, {
    code: state.code,
    dialect: state.dialect,
    colorMode: state.colorMode,
    mode: "workbench",
    documentUri: state.documentUri,
    host,
  });
}

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(React.createElement(DslPanelHostApp));
}
`;
}

/**
 * Builds the complete production ModelScript VS Code IDE extension to a target directory.
 */
export async function buildIdeExtension(outDir: string, options?: ExtensionOptions): Promise<void> {
  const fsSpec = "node:fs";
  const pathSpec = "node:path";
  const urlSpec = "node:url";
  const esbuildSpec = "esbuild";
  const fs = (await import(fsSpec)) as typeof FsTypes;
  const path = (await import(pathSpec)) as typeof PathTypes;
  const { fileURLToPath } = (await import(urlSpec)) as typeof UrlTypes;
  const esbuild = await import(esbuildSpec);

  const shouldMinify = options?.minify ?? true;
  const shouldSourcemap = options?.sourcemap ?? false;

  // Clean stale bundle directories so outdated or duplicate bundles never leak into the VSIX
  fs.rmSync(path.join(outDir, "dist"), { recursive: true, force: true });
  fs.rmSync(path.join(outDir, "server"), { recursive: true, force: true });
  fs.rmSync(path.join(outDir, "wasm"), { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(path.join(outDir, "dist"), { recursive: true });
  fs.mkdirSync(path.join(outDir, "server", "dist"), { recursive: true });

  // 1. Locate repository root and discover workspace languages
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  let repoRoot = currentDir;
  let workspaceVersion = "0.1.0";
  while (repoRoot !== path.dirname(repoRoot)) {
    if (fs.existsSync(path.join(repoRoot, "package.json"))) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
          name?: string;
          version?: string;
        };
        if (pkg.name === "modelscript") {
          if (pkg.version && pkg.version !== "0.0.0") {
            workspaceVersion = pkg.version;
          } else if (fs.existsSync(path.join(repoRoot, "packages/runtime/package.json"))) {
            const rtPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "packages/runtime/package.json"), "utf8")) as {
              version?: string;
            };
            if (rtPkg.version) workspaceVersion = rtPkg.version;
          }
          break;
        }
      } catch {
        // Optional candidate file probe ignored
      }
    }
    repoRoot = path.dirname(repoRoot);
  }

  const languagesDir = path.join(repoRoot, "languages");
  const discovered = await discoverWorkspaceLanguages(languagesDir);
  const languages =
    discovered.languages.length > 0
      ? discovered.languages
      : normalizeLanguages([{ name: "modelica", lsp: { fileExtensions: [".mo"] } }]);

  // Write languages manifest for runtime & web worker loading
  fs.writeFileSync(
    path.join(outDir, "server", "dist", "languages-manifest.json"),
    JSON.stringify(discovered.manifest, null, 2),
    "utf-8",
  );

  // 2. Generate package.json manifest
  const pkg = generatePackageJson(languages, {
    name: "modelscript",
    displayName: "ModelScript — Polyglot Systems Engineering & Simulation IDE",
    description: `Polyglot IDE for ${languages.length} engineering languages (Modelica, SysML v2, SPICE, KiCad, STEP, OWL2, and more) — visual diagrams, real-time simulation, notebooks, and bundled MSL.`,
    version: options?.version || workspaceVersion,
    icon: options?.icon || "images/icon.png",
    ...options,
    features: {
      diagramEditor: true,
      cad3dViewer: true,
      simulationPanels: true,
      notebooks: true,
      mcpBridge: true,
      chatParticipant: true,
      ...options?.features,
    },
  });

  // Marketplace metadata
  pkg["bugs"] = { url: "https://github.com/modelscript/modelscript/issues" };
  pkg["qna"] = "https://github.com/modelscript/modelscript/discussions";
  pkg["galleryBanner"] = { color: "#0b1120", theme: "dark" };

  // Set browser client entry point (always present for VS Code for Web & fallback)
  pkg["browser"] = "./dist/browserClientMain.js";
  const isDesktopTarget = Boolean(options?.platformTarget && options.platformTarget !== "web");
  if (isDesktopTarget) {
    pkg["main"] = "./dist/desktopClientMain.js";
  } else {
    delete pkg["main"];
  }
  fs.rmSync(path.join(outDir, "native"), { recursive: true, force: true });
  fs.writeFileSync(path.join(outDir, "package.json"), JSON.stringify(pkg, null, 2), "utf-8");
  fs.writeFileSync(path.join(outDir, "package.nls.json"), "{}", "utf-8");
  fs.writeFileSync(path.join(outDir, ".vscodeignore"), DEFAULT_VSCODEIGNORE, "utf-8");

  // Copy full AGPL-3.0 license text (COPYING), rich Marketplace README, and CHANGELOG
  const rootCopying = path.join(repoRoot, "COPYING");
  if (fs.existsSync(rootCopying)) {
    fs.copyFileSync(rootCopying, path.join(outDir, "LICENSE.md"));
  } else {
    fs.writeFileSync(
      path.join(outDir, "LICENSE.md"),
      "GNU AFFERO GENERAL PUBLIC LICENSE Version 3\n\nCopyright © 2025-2026 Mohamad Omar Nachawati and ModelScript Contributors\n",
      "utf-8",
    );
  }

  const ideReadme = path.join(repoRoot, "packages", "ide", "README.md");
  if (fs.existsSync(ideReadme)) {
    fs.copyFileSync(ideReadme, path.join(outDir, "README.md"));
  } else {
    fs.writeFileSync(path.join(outDir, "README.md"), `# ${pkg["displayName"]}\n\n${pkg["description"]}\n`, "utf-8");
  }

  const rootChangelog = path.join(repoRoot, "CHANGELOG.md");
  if (fs.existsSync(rootChangelog)) {
    fs.copyFileSync(rootChangelog, path.join(outDir, "CHANGELOG.md"));
  }

  // 3. Write language configs and syntaxes
  for (const file of generateLanguageGrammarAndConfigFiles(languages)) {
    const destPath = path.join(outDir, file.path);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, file.content, "utf-8");
  }

  // 4. Compile with esbuild
  const ideDir =
    [
      path.resolve(repoRoot, "packages/ide/src"),
      path.resolve(repoRoot, "packages/ide"),
      path.resolve(currentDir, "../../ide/src"),
      path.resolve(currentDir, "../../../packages/ide/src"),
    ].find((p) => fs.existsSync(p)) ?? path.resolve(repoRoot, "packages/ide/src");

  const ignorePlugin = createNodeBuiltinsIgnorePlugin();

  // Build browser client
  const clientMainPath = fs.existsSync(path.join(ideDir, "browser-client-main.ts"))
    ? path.join(ideDir, "browser-client-main.ts")
    : path.join(ideDir, "browserClientMain.ts");
  if (fs.existsSync(clientMainPath)) {
    await esbuild.build({
      entryPoints: [clientMainPath],
      outfile: path.join(outDir, "dist", "browserClientMain.js"),
      bundle: true,
      format: "cjs",
      platform: "browser",
      target: "es2022",
      minify: shouldMinify,
      sourcemap: shouldSourcemap,
      external: ["vscode"],
      define: {
        "process.env": JSON.stringify({}),
        "process.browser": "true",
      },
      banner: {
        js: BROWSER_BUFFER_AND_PROCESS_BANNER,
      },
      plugins: [ignorePlugin],
      logOverride: {
        "duplicate-object-key": "silent",
        "empty-import-meta": "silent",
      },
    });
  }

  // Build desktop Node extension host client & stage native addon (only for platform-native VSIXs)
  if (isDesktopTarget) {
    const desktopMainPath = path.join(ideDir, "desktop-client-main.ts");
    if (fs.existsSync(desktopMainPath)) {
      await esbuild.build({
        entryPoints: [desktopMainPath],
        outfile: path.join(outDir, "dist", "desktopClientMain.js"),
        bundle: true,
        format: "cjs",
        platform: "node",
        target: "node20",
        minify: shouldMinify,
        sourcemap: shouldSourcemap,
        external: ["vscode"],
        logOverride: {
          "duplicate-object-key": "silent",
          "empty-import-meta": "silent",
        },
      });
    }

    const platformTarget = options!.platformTarget!;
    const addonCandidate =
      options?.nativeAddonPath ||
      path.join(repoRoot, "packages", "native", "prebuilds", platformTarget, "modelscript_native.node");
    if (fs.existsSync(addonCandidate)) {
      const nativeOutDir = path.join(outDir, "native");
      fs.mkdirSync(nativeOutDir, { recursive: true });
      fs.copyFileSync(addonCandidate, path.join(nativeOutDir, "modelscript_native.node"));
      // Copy any sibling shared libraries (e.g. libwebgpu_dawn.so/.dylib/.dll)
      const srcDir = path.dirname(addonCandidate);
      for (const entry of fs.readdirSync(srcDir)) {
        if (entry.endsWith(".so") || entry.endsWith(".dylib") || entry.endsWith(".dll")) {
          fs.copyFileSync(path.join(srcDir, entry), path.join(nativeOutDir, entry));
        }
      }
    }
  }

  // Build webviews
  const webviewDir = path.join(ideDir, "webview");
  const webviewEntries: string[] = [];
  if (fs.existsSync(webviewDir)) {
    const files = fs.readdirSync(webviewDir);
    for (const f of files) {
      if (
        (f.endsWith(".ts") || f.endsWith(".tsx")) &&
        f !== "notebook-renderer.ts" &&
        f !== "notebookRenderer.ts" &&
        f !== "chat-worker.ts" &&
        !f.startsWith("base-")
      ) {
        const fullPath = path.join(webviewDir, f);
        if (fs.statSync(fullPath).isFile()) {
          webviewEntries.push(fullPath);
        }
      }
    }
  }

  if (webviewEntries.length > 0) {
    await esbuild.build({
      entryPoints: webviewEntries,
      outdir: path.join(outDir, "dist"),
      bundle: true,
      format: "iife",
      platform: "browser",
      minify: shouldMinify,
      sourcemap: shouldSourcemap,
      external: ["vscode", "@kitware/vtk.js", "@kitware/vtk.js/*"],
      define: {
        "process.env": JSON.stringify({}),
        "process.browser": "true",
      },
      logOverride: {
        "duplicate-object-key": "silent",
        "empty-import-meta": "silent",
      },
      banner: {
        js: BROWSER_BUFFER_BANNER,
      },
      plugins: [ignorePlugin],
    });
  }

  // Build declarative Language DSL UI panels (`languages/<lang>/src/ui/*`)
  const vscodeUiPanels = discovered.ui.panels.filter((p) => p.targets.includes("vscode"));
  const uiManifestPayload = {
    panels: vscodeUiPanels.map((p) => ({
      languageId: p.languageId,
      id: p.id,
      viewType: p.viewType,
      title: p.title,
      retainContextWhenHidden: p.retainContextWhenHidden,
      supportsMultipleEditorsPerDocument: p.supportsMultipleEditorsPerDocument,
      webviewScriptName: p.webviewScriptName,
      openCommandId: p.openCommand?.id,
    })),
  };
  fs.mkdirSync(path.join(outDir, "dist"), { recursive: true });
  fs.writeFileSync(path.join(outDir, "dist", "ui-manifest.json"), JSON.stringify(uiManifestPayload, null, 2), "utf-8");

  if (vscodeUiPanels.length > 0) {
    fs.mkdirSync(path.join(outDir, "dist", "webviews"), { recursive: true });
    for (const panel of vscodeUiPanels) {
      const virtualEntryId = `ms-dsl-panel:${panel.languageId}:${panel.id}`;
      const bootstrapSource = buildDslPanelBootstrapSource(panel);

      const virtualPlugin: Plugin = {
        name: "ms-dsl-panel-bootstrap",
        setup(build) {
          build.onResolve({ filter: /^ms-dsl-panel:/ }, (args) => ({
            path: args.path,
            namespace: "ms-dsl-panel",
          }));
          build.onLoad({ filter: /.*/, namespace: "ms-dsl-panel" }, () => ({
            contents: bootstrapSource,
            loader: "tsx",
            resolveDir: panel.packageDir,
          }));
        },
      };

      await esbuild.build({
        entryPoints: [virtualEntryId],
        outfile: path.join(outDir, "dist", panel.webviewScriptName),
        bundle: true,
        format: "iife",
        platform: "browser",
        target: "es2022",
        minify: shouldMinify,
        sourcemap: shouldSourcemap,
        external: ["vscode", "@kitware/vtk.js", "@kitware/vtk.js/*"],
        define: {
          "process.env": JSON.stringify({}),
          "process.browser": "true",
        },
        logOverride: {
          "duplicate-object-key": "silent",
          "empty-import-meta": "silent",
        },
        banner: {
          js: BROWSER_BUFFER_BANNER,
        },
        plugins: [virtualPlugin, ignorePlugin],
      });
    }
  }

  // Build notebook renderer
  const notebookRendererPath = [
    path.join(ideDir, "webview", "notebook-renderer.ts"),
    path.join(ideDir, "webview", "notebookRenderer.ts"),
  ].find((p) => fs.existsSync(p));

  if (notebookRendererPath) {
    const nbOut = path.join(outDir, "dist", "notebook-renderer.js");
    await esbuild.build({
      entryPoints: [notebookRendererPath],
      outfile: nbOut,
      bundle: true,
      format: "esm",
      platform: "browser",
      minify: shouldMinify,
      sourcemap: shouldSourcemap,
      logOverride: {
        "duplicate-object-key": "silent",
        "empty-import-meta": "silent",
      },
    });
  }

  // 5. Copy WASM and library assets
  for (const asset of discovered.wasmAssets) {
    const destPath = path.join(outDir, asset.dest);
    if (fs.existsSync(asset.src)) {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      if (shouldMinify && asset.dest.endsWith(".js") && fs.statSync(asset.src).isFile()) {
        const rawJs = fs.readFileSync(asset.src, "utf-8");
        const minified = await esbuild.transform(rawJs, {
          loader: "js",
          minify: true,
          target: "es2022",
        });
        fs.writeFileSync(destPath, minified.code, "utf-8");
      } else {
        fs.cpSync(asset.src, destPath, { recursive: true });
      }
    }
  }

  const candidateAssets: Array<[string, string]> = [
    [path.join(repoRoot, "packages/runtime/build/release.wasm"), "server/dist/release.wasm"],
    [path.join(repoRoot, "packages/simulate/src/wasm/sundials.wasm"), "server/dist/sundials.wasm"],
    [path.join(repoRoot, "packages/simulate/src/wasm/sundials.js"), "server/dist/sundials.js"],
    [path.join(repoRoot, "node_modules/occt-import-js/dist/occt-import-js.wasm"), "server/dist/occt-import-js.wasm"],
    [
      path.join(repoRoot, "scripts/ModelicaStandardLibrary_v4.1.0.zip"),
      "server/dist/ModelicaStandardLibrary_v4.1.0.zip",
    ],
    [path.join(repoRoot, "scripts/OpenIPSL_v3.1.0.zip"), "server/dist/OpenIPSL_v3.1.0.zip"],
    [path.join(repoRoot, "scripts/SysML-v2-Release-2026-03.zip"), "server/dist/SysML-v2-Release-2026-03.zip"],
    [path.join(repoRoot, "scripts/SPICE-Standard-1.0.0.zip"), "server/dist/SPICE-Standard-1.0.0.zip"],
    [path.join(repoRoot, "languages/modelica/assets"), "assets"],
    [path.join(repoRoot, "apps/web/public/ms-logo.png"), "images/icon.png"],
  ];

  for (const [src, dest] of candidateAssets) {
    const destPath = path.join(outDir, dest);
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.cpSync(src, destPath, { recursive: true });
    }
  }

  // Copy discovered language assets (languages/<lang>/assets -> assets/<lang>/)
  if (fs.existsSync(languagesDir)) {
    const langDirs = fs.readdirSync(languagesDir, { withFileTypes: true });
    for (const d of langDirs) {
      if (!d.isDirectory()) continue;
      const langAssetDir = path.join(languagesDir, d.name, "assets");
      if (fs.existsSync(langAssetDir)) {
        const destLangAssets = path.join(outDir, "assets", d.name);
        fs.mkdirSync(destLangAssets, { recursive: true });
        fs.cpSync(langAssetDir, destLangAssets, { recursive: true });
      }
    }
  }

  // Package shared file-icons and generate VS Code icon theme JSON using the same language names as Ansatz Editor
  const fileIconsSrcDir = path.join(repoRoot, "apps/web/public/file-icons");
  if (fs.existsSync(fileIconsSrcDir)) {
    const destFileIconsDir = path.join(outDir, "file-icons");
    fs.mkdirSync(destFileIconsDir, { recursive: true });
    const availableIcons = new Map<string, string>();
    for (const entry of fs.readdirSync(fileIconsSrcDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const lower = entry.name.toLowerCase();
      if (!lower.endsWith(".svg") && !lower.endsWith(".png")) continue;
      fs.copyFileSync(path.join(fileIconsSrcDir, entry.name), path.join(destFileIconsDir, entry.name));
      const base = lower.slice(0, -4);
      if (lower.endsWith(".svg") || !availableIcons.has(base)) {
        availableIcons.set(base, entry.name);
      }
    }
    const iconTheme = generateFileIconTheme(languages, availableIcons);
    fs.writeFileSync(path.join(destFileIconsDir, "theme.json"), JSON.stringify(iconTheme, null, 2), "utf-8");
  }

  // 6. Bundle LSP browser server into standalone IIFE (or copy & minify from lsp dist/browser)
  const lspDir = path.join(repoRoot, "packages/lsp");
  const browserServerMain = path.join(lspDir, "src/browserServerMain.ts");
  const destBrowserServer = path.join(outDir, "server/dist/browserServerMain.js");
  const lspBrowserDist = path.join(lspDir, "dist", "browser");
  const processPolyfill = path.join(lspDir, "scripts/process-polyfill.js");
  const serverInject = fs.existsSync(processPolyfill) ? [processPolyfill] : [];
  if (fs.existsSync(browserServerMain)) {
    await esbuild.build({
      entryPoints: [browserServerMain],
      outfile: destBrowserServer,
      bundle: true,
      format: "iife",
      platform: "browser",
      target: "es2022",
      minify: shouldMinify,
      keepNames: true,
      sourcemap: shouldSourcemap,
      banner: {
        js: `${BROWSER_PROCESS_BANNER}\nvar process = globalThis.process;\n`,
      },
      define: {
        "process.env": "{}",
        "process.browser": "true",
        "import.meta.url": "self.location.href",
      },
      inject: serverInject,
      logOverride: {
        "duplicate-object-key": "silent",
        "empty-import-meta": "silent",
      },
      plugins: [ignorePlugin],
    });
  } else if (fs.existsSync(path.join(lspBrowserDist, "browserServerMain.js"))) {
    fs.mkdirSync(path.dirname(destBrowserServer), { recursive: true });
    const rawServerJs = fs.readFileSync(path.join(lspBrowserDist, "browserServerMain.js"), "utf-8");
    if (shouldMinify) {
      const minifiedServer = await esbuild.transform(rawServerJs, {
        loader: "js",
        minify: true,
        keepNames: true,
        target: "es2022",
      });
      fs.writeFileSync(destBrowserServer, minifiedServer.code, "utf-8");
    } else {
      fs.writeFileSync(destBrowserServer, rawServerJs, "utf-8");
    }
  }
}
