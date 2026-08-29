/* eslint-disable */
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// init command — scaffold a modelscript language project
// ---------------------------------------------------------------------------

export interface InitOptions {
  /** Directory to initialize. Created if it doesn't exist. */
  dir: string;
  /** Language name (e.g. "modelica", "sysml"). Defaults to directory basename. */
  langName?: string;
  /** Skip npm install. */
  skipInstall?: boolean;
}

/**
 * Scaffold or update a modelscript language project directory.
 *
 * Creates:
 *   package.json     — deps (tree-sitter-cli, web-tree-sitter, @modelscript/language) + scripts
 *   language.ts      — starter template (only if missing)
 *   tree-sitter.json — tree-sitter config for WASM build
 *
 * Then runs `npm install`.
 */
export function initProject(options: InitOptions): void {
  const dir = path.resolve(options.dir);
  const langName = options.langName ?? path.basename(dir);

  // Create directory
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Created ${dir}/`);
  }

  // -------------------------------------------------------------------------
  // package.json
  // -------------------------------------------------------------------------
  const pkgPath = path.join(dir, "package.json");
  const existingPkg = fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, "utf-8")) : {};

  const pkg = {
    name: existingPkg.name ?? `tree-sitter-${langName}`,
    version: existingPkg.version ?? "0.0.0",
    description: existingPkg.description ?? `Tree-sitter grammar for ${langName} (via @modelscript/language)`,
    main: existingPkg.main ?? "bindings/node",
    scripts: {
      ...(existingPkg.scripts ?? {}),
      generate: `modelscript-language generate language.ts`,
      "build:parser": "tree-sitter generate",
      "build:wasm": "tree-sitter build --wasm -o tree-sitter-" + langName + ".wasm",
      build: "npm run generate && npm run build:parser && npm run build:wasm",
      playground: `modelscript-language playground language.ts`,
    },
    dependencies: {
      ...(existingPkg.dependencies ?? {}),
      "@modelscript/language": existingPkg.dependencies?.["@modelscript/language"] ?? "*",
      "node-addon-api": existingPkg.dependencies?.["node-addon-api"] ?? "^8.5.0",
      "node-gyp-build": existingPkg.dependencies?.["node-gyp-build"] ?? "^4.8.4",
    },
    devDependencies: {
      ...(existingPkg.devDependencies ?? {}),
      prebuildify: existingPkg.devDependencies?.["prebuildify"] ?? "^6.0.1",
      "tree-sitter": existingPkg.devDependencies?.["tree-sitter"] ?? "^0.22.4",
      "tree-sitter-cli": existingPkg.devDependencies?.["tree-sitter-cli"] ?? "^0.25.10",
    },
    peerDependencies: {
      ...(existingPkg.peerDependencies ?? {}),
      "tree-sitter": existingPkg.peerDependencies?.["tree-sitter"] ?? "^0.22.4",
    },
    peerDependenciesMeta: {
      ...(existingPkg.peerDependenciesMeta ?? {}),
      "tree-sitter": {
        optional: true,
      },
    },
  };

  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
  console.log(`${fs.existsSync(pkgPath) ? "Updated" : "Created"} ${pkgPath}`);

  // -------------------------------------------------------------------------
  // tree-sitter.json (required for `tree-sitter` CLI to find the grammar)
  // -------------------------------------------------------------------------
  ensureTreeSitterJson(dir, langName);

  // -------------------------------------------------------------------------
  // language.ts — starter template (only if missing)
  // -------------------------------------------------------------------------
  const langPath = path.join(dir, "language.ts");
  if (!fs.existsSync(langPath)) {
    const template = `import {
  language,
  def,
  seq,
  optional,
  repeat,
  choice,
  token,
  field,
} from "@modelscript/language";

export default language({
  name: ${JSON.stringify(langName)},

  rules: {
    // Define your grammar rules here.
    // Use def() to create symbol-producing rules.
    // See: https://github.com/modelscript/modelscript

    source_file: ($) =>
      repeat($.definition),

    definition: ($) =>
      def({
        syntax: seq(field("name", $.identifier), ";"),
        symbol: (self) => ({
          kind: "Definition",
          name: self.name,
        }),
        model: {
          visitable: true,
        },
      }),

    identifier: () => token(/[a-zA-Z_][a-zA-Z0-9_]*/),
  },
});
`;
    fs.writeFileSync(langPath, template, "utf-8");
    console.log(`Created ${langPath} (starter template)`);
  }

  // -------------------------------------------------------------------------
  // npm install
  // -------------------------------------------------------------------------
  if (!options.skipInstall) {
    console.log("\nRunning npm install...");
    try {
      execSync("npm install", { cwd: dir, stdio: "inherit" });
    } catch (e) {
      console.error("npm install failed — you may need to run it manually.");
    }
  }

  console.log(`
✅ Project initialized at ${dir}/

Next steps:
  1. Edit language.ts to define your grammar
  2. npm run build          # Generate grammar → parser → WASM
  3. npm run playground     # Launch the interactive playground
`);
}

/**
 * Find the WASM file for a language in the given directory.
 * Searches for tree-sitter-{lang}.wasm or any .wasm file.
 */
export function findWasmFile(dir: string, langName: string): string | null {
  const specific = path.join(dir, `tree-sitter-${langName}.wasm`);
  if (fs.existsSync(specific)) return specific;

  // Fallback: find any .wasm file
  try {
    const files = fs.readdirSync(dir);
    const wasm = files.find((f) => f.endsWith(".wasm") && f.startsWith("tree-sitter-"));
    return wasm ? path.join(dir, wasm) : null;
  } catch {
    return null;
  }
}

export function ensureTreeSitterJson(dir: string, langName: string): void {
  const tsConfigPath = path.join(dir, "tree-sitter.json");
  if (!fs.existsSync(tsConfigPath)) {
    const tsConfig = {
      grammars: [
        {
          name: langName,
          camelCase: false,
          scope: `source.${langName}`,
          path: ".",
          "file-types": [langName.substring(0, 3)],
        },
      ],
      attributes: {
        version: "0.1.0",
        description: `Tree-sitter parser for ${langName}`,
        links: {
          repository: "https://github.com/...",
        },
      },
      bindings: {
        node: false,
        c: false,
        go: false,
        rust: false,
        python: false,
        swift: false,
      },
    };
    fs.writeFileSync(tsConfigPath, JSON.stringify(tsConfig, null, 2) + "\n", "utf-8");
    console.log(`Created ${tsConfigPath}`);
  }
}

/**
 * Build the WASM parser for a language project.
 * Runs: generate grammar.js → tree-sitter generate → tree-sitter build --wasm
 *
 * @returns Path to the built .wasm file, or null on failure.
 */
export function buildWasm(dir: string, langName: string): string | null {
  console.log(`[init] Building WASM parser for ${langName}...`);
  ensureTreeSitterJson(dir, langName);
  try {
    // Step 1: Generate grammar.js from language.ts (if modelscript-language CLI is available)
    const grammarPath = path.join(dir, "grammar.js");
    if (!fs.existsSync(grammarPath)) {
      console.log("[init] Generating grammar.js...");
      execSync("npm run generate", { cwd: dir, stdio: "inherit" });
    }

    // Step 2: Generate the parser C code
    console.log("[init] Running tree-sitter generate...");
    execSync("npx --yes tree-sitter-cli generate", { cwd: dir, stdio: "inherit" });

    // Step 3: Build WASM
    console.log("[init] Building WASM...");
    const wasmFile = `tree-sitter-${langName}.wasm`;
    execSync(`npx --yes tree-sitter-cli build --wasm -o ${wasmFile}`, { cwd: dir, stdio: "inherit" });

    const wasmPath = path.join(dir, wasmFile);
    if (fs.existsSync(wasmPath)) {
      console.log(`[init] ✅ Built ${wasmPath}`);
      return wasmPath;
    }
  } catch (e) {
    console.error(`[init] WASM build failed: ${e}`);
  }
  return null;
}
