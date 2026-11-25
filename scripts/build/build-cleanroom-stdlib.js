// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { runLanguageWasmBuild } from "./build-language-wasm.js";

/**
 * @typedef {Object} CleanroomStdLibBuildOptions
 * @property {string} langName - Language identifier (e.g. "pslf", "powerworld", "simulink")
 * @property {string} packageName - Library package name (e.g. "@modelscript/pslf-std-lib")
 * @property {string} description - Human-readable description for modelscript.yaml
 * @property {string} stdLibDir - Absolute path to `languages/<lang>/assets/<lang>-std-lib`
 * @property {string} entryFile - Relative AssemblyScript entry file inside `stdLibDir` (e.g. "src/models.ts")
 * @property {string} outTsPath - Absolute path to generated zero-I/O TS bundle (e.g. `src/catalog/pslf-std-lib-data.ts`)
 * @property {string} constPrefix - Exported constant prefix (e.g. "PSLF_STD_LIB")
 * @property {string} wasmGetterName - Exported WASM getter name (e.g. "getPslfStdLibWasmBytes")
 * @property {string} [version] - Library version (default: "0.1.0")
 * @property {string} [license] - SPDX license (default: "AGPL-3.0-or-later")
 */

/**
 * Formats generated TypeScript with the repository's Prettier config (when available)
 * and writes `outTsPath` only when the contents differ.
 *
 * @param {string} outTsPath
 * @param {string} content
 */
export async function writeFormattedTsIfChanged(outTsPath, content) {
  let finalContent = content;
  try {
    const prettierMod = await import("prettier");
    const prettier = prettierMod.default ?? prettierMod;
    const config = await prettier.resolveConfig(outTsPath);
    finalContent = await prettier.format(content, { ...(config ?? {}), filepath: outTsPath });
  } catch {
    // Prettier may not be installed in minimal/packaged environments; fall back to raw output.
  }

  fs.mkdirSync(path.dirname(outTsPath), { recursive: true });
  if (!fs.existsSync(outTsPath) || fs.readFileSync(outTsPath, "utf-8") !== finalContent) {
    fs.writeFileSync(outTsPath, finalContent, "utf-8");
  }
}

/**
 * Writes `filePath` only when the contents differ.
 *
 * @param {string} filePath
 * @param {string | Buffer} content
 */
function writeFileIfChanged(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (typeof content === "string") {
    if (!fs.existsSync(filePath) || fs.readFileSync(filePath, "utf-8") !== content) {
      fs.writeFileSync(filePath, content, "utf-8");
    }
  } else {
    if (!fs.existsSync(filePath) || !fs.readFileSync(filePath).equals(content)) {
      fs.writeFileSync(filePath, content);
    }
  }
}

/**
 * Externalizes cleanroom library `symbols.json` and `diagrams.json` alongside `outTsPath`,
 * generates TypeScript `.d.json.ts` ambient declaration stubs, and mirrors the `.json` files
 * into `dist/src/catalog/` so compiled ESM output can load them at runtime.
 *
 * @param {object} params
 * @param {string} params.outTsPath - Absolute path to `<stem>-data.ts`
 * @param {string} params.symbolsPath - Absolute path to source `symbols.json`
 * @param {string} params.diagramsPath - Absolute path to source `diagrams.json`
 * @returns {Promise<{ symbolsJsonName: string; diagramsJsonName: string }>}
 */
export async function emitCleanroomCatalogJsonArtifacts({ outTsPath, symbolsPath, diagramsPath }) {
  const catalogSrcDir = path.dirname(outTsPath);
  const stem = path.basename(outTsPath).replace(/-data\.ts$/, "");
  const symbolsJsonName = `${stem}-symbols.json`;
  const diagramsJsonName = `${stem}-diagrams.json`;

  const symbolsBuf = fs.readFileSync(symbolsPath);
  const diagramsBuf = fs.readFileSync(diagramsPath);

  writeFileIfChanged(path.join(catalogSrcDir, symbolsJsonName), symbolsBuf);
  writeFileIfChanged(path.join(catalogSrcDir, diagramsJsonName), diagramsBuf);

  // Mirror JSON payloads to dist/src/catalog/ when outTsPath resides under <pkg>/src/catalog/
  if (path.basename(path.dirname(catalogSrcDir)) === "src") {
    const pkgDir = path.resolve(catalogSrcDir, "..", "..");
    const catalogDistDir = path.join(pkgDir, "dist", "src", "catalog");
    writeFileIfChanged(path.join(catalogDistDir, symbolsJsonName), symbolsBuf);
    writeFileIfChanged(path.join(catalogDistDir, diagramsJsonName), diagramsBuf);
  }

  const symbolsDts = [
    "// SPDX-License-Identifier: AGPL-3.0-or-later",
    "",
    'import type { LibrarySymbolStub } from "@modelscript/runtime";',
    "",
    "declare const symbols: LibrarySymbolStub[];",
    "export = symbols;",
    "",
  ].join("\n");

  const diagramsDts = [
    "// SPDX-License-Identifier: AGPL-3.0-or-later",
    "",
    'import type { DiagramComponentSpec } from "@modelscript/runtime";',
    "",
    "declare const diagrams: DiagramComponentSpec[];",
    "export = diagrams;",
    "",
  ].join("\n");

  await writeFormattedTsIfChanged(path.join(catalogSrcDir, `${stem}-symbols.d.json.ts`), symbolsDts);
  await writeFormattedTsIfChanged(path.join(catalogSrcDir, `${stem}-diagrams.d.json.ts`), diagramsDts);

  return { symbolsJsonName, diagramsJsonName };
}

/**
 * Builds a cleanroom standard library package (`modelscript.yaml` + `dist/symbols.json` +
 * `dist/diagrams.json` + `dist/runtime.wasm`) and emits a zero-I/O isomorphic TypeScript bundle
 * for Browsers, Web Workers, and Node.js.
 *
 * @param {CleanroomStdLibBuildOptions} options
 */
export async function buildCleanroomStdLib(options) {
  const {
    langName,
    packageName,
    description,
    stdLibDir,
    entryFile,
    outTsPath,
    constPrefix,
    wasmGetterName,
    version = "0.1.0",
    license = "AGPL-3.0-or-later",
  } = options;

  const stdLibSrc = path.join(stdLibDir, "src");
  const stdLibDist = path.join(stdLibDir, "dist");
  fs.mkdirSync(stdLibDist, { recursive: true });

  // 1. Copy generated JSON payloads from src/ to dist/
  for (const file of ["symbols.json", "diagrams.json"]) {
    const srcFile = path.join(stdLibSrc, file);
    if (fs.existsSync(srcFile)) {
      fs.copyFileSync(srcFile, path.join(stdLibDist, file));
    }
  }

  // 2. Ensure modelscript.yaml manifest exists and is up to date
  const manifestPath = path.join(stdLibDir, "modelscript.yaml");
  const manifestContent = [
    `name: "${packageName}"`,
    `version: "${version}"`,
    `license: "${license}"`,
    `description: "${description.replace(/"/g, '\\"')}"`,
    `library:`,
    `  category: library`,
    `  language: ${langName}`,
    `  symbols: ./dist/symbols.json`,
    `  diagrams: ./dist/diagrams.json`,
    `  runtime:`,
    `    wasm: ./dist/runtime.wasm`,
    "",
  ].join("\n");
  if (!fs.existsSync(manifestPath) || fs.readFileSync(manifestPath, "utf-8") !== manifestContent) {
    fs.writeFileSync(manifestPath, manifestContent, "utf-8");
  }

  // 3. Compile AssemblyScript cleanroom runtime to dist/runtime.wasm
  runLanguageWasmBuild({
    langName: `${langName}-std-lib`,
    dir: stdLibDir,
    entryFile,
    outWasmFile: "dist/runtime.wasm",
  });

  // 4. Emit externalized JSON + .d.json.ts stubs + thin typed TS shim (symbols + diagrams + base64 runtime.wasm)
  const symbolsPath = path.join(stdLibDist, "symbols.json");
  const diagramsPath = path.join(stdLibDist, "diagrams.json");
  const runtimeWasmPath = path.join(stdLibDist, "runtime.wasm");
  if (!fs.existsSync(symbolsPath) || !fs.existsSync(diagramsPath) || !fs.existsSync(runtimeWasmPath)) {
    throw new Error(
      `[buildCleanroomStdLib] Missing dist artifacts in ${stdLibDist} (symbols.json, diagrams.json, runtime.wasm)`,
    );
  }

  const { symbolsJsonName, diagramsJsonName } = await emitCleanroomCatalogJsonArtifacts({
    outTsPath,
    symbolsPath,
    diagramsPath,
  });

  const pkgJsonText = JSON.stringify(
    {
      name: packageName,
      version,
      license,
      modelscript: {
        category: "library",
        language: langName,
        symbols: "./dist/symbols.json",
        diagrams: "./dist/diagrams.json",
        runtime: { wasm: "./dist/runtime.wasm" },
      },
    },
    null,
    2,
  );
  const wasmBase64 = fs.readFileSync(runtimeWasmPath).toString("base64");

  const content = [
    "// SPDX-License-Identifier: AGPL-3.0-or-later",
    `// AUTO-GENERATED by scripts/build-cleanroom-stdlib.js for @modelscript/${langName} — do not edit manually.`,
    "",
    'import { decodeBase64Wasm, type DiagramComponentSpec, type LibrarySymbolStub, type ModelscriptLibraryManifest } from "@modelscript/runtime";',
    `import rawDiagrams from "./${diagramsJsonName}" with { type: "json" };`,
    `import rawSymbols from "./${symbolsJsonName}" with { type: "json" };`,
    "",
    `export const ${constPrefix}_PKG_JSON = ${pkgJsonText} as {`,
    "  name: string;",
    "  version: string;",
    "  license: string;",
    "  modelscript: ModelscriptLibraryManifest;",
    "};",
    "",
    `export const ${constPrefix}_SYMBOLS: LibrarySymbolStub[] = rawSymbols;`,
    "",
    `export const ${constPrefix}_DIAGRAMS: DiagramComponentSpec[] = rawDiagrams;`,
    "",
    `export const ${constPrefix}_WASM_BASE64 = "${wasmBase64}";`,
    "",
    "let cachedWasmBytes: Uint8Array | undefined;",
    "",
    `/**`,
    ` * Decodes the pre-bundled \`${packageName}\` \`runtime.wasm\` binary in Node.js, Browsers, or Web Workers.`,
    ` */`,
    `export function ${wasmGetterName}(): Uint8Array {`,
    "  if (!cachedWasmBytes) {",
    `    cachedWasmBytes = decodeBase64Wasm(${constPrefix}_WASM_BASE64);`,
    "  }",
    "  return cachedWasmBytes;",
    "}",
    "",
  ].join("\n");

  await writeFormattedTsIfChanged(outTsPath, content);
}

