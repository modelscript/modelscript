// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser, type BuildOptions } from "../dsl/api.js";
import type { LanguageOptions } from "../dsl/language.js";

export interface DynamicCompileOptions extends BuildOptions {
  extensions?: string[];
  optimize?: boolean;
  shrink?: boolean;
}

export interface CompiledLanguageBundle {
  id: string;
  name: string;
  extensions: string[];
  wasmBytes: Uint8Array;
  monarch: any;
  textmate: any;
  jsWrapper: string;
  parserInfo: any;
}

/**
 * Compiles a DSL grammar definition into WebAssembly bytecode, Monaco Monarch tokens,
 * TextMate grammars, and JavaScript runtime wrappers purely in-memory using AssemblyScript.
 */
export async function compileDslToWasm(
  langDef: LanguageOptions,
  options?: DynamicCompileOptions,
): Promise<CompiledLanguageBundle> {
  const id = langDef.name.toLowerCase();

  let extensions: string[] = [];
  const anyLang = langDef as any;
  if (anyLang.lsp?.fileExtensions && Array.isArray(anyLang.lsp.fileExtensions)) {
    extensions = anyLang.lsp.fileExtensions.map((e: string) => (e.startsWith(".") ? e : `.${e}`));
  } else if (anyLang.fileExtensions && Array.isArray(anyLang.fileExtensions)) {
    extensions = anyLang.fileExtensions.map((e: string) => (e.startsWith(".") ? e : `.${e}`));
  } else if (options?.extensions && options.extensions.length > 0) {
    extensions = options.extensions.map((e: string) => (e.startsWith(".") ? e : `.${e}`));
  } else {
    extensions = [`.${id}`];
  }

  // 1. Generate LR tables, recovery sets, Monaco Monarch & TextMate grammars
  const buildResult = buildParser(langDef, options);

  // 2. Prepare Virtual Filesystem Map for in-memory AssemblyScript compilation
  const vfs: Record<string, string> = {};
  for (const file of buildResult.assemblyScriptFiles) {
    vfs[file.filename] = file.content;
  }

  // Extract Monarch and TextMate
  const monarchFile = buildResult.assemblyScriptFiles.find((f) => f.filename === "monarch.json");
  const tmFile = buildResult.assemblyScriptFiles.find((f) => f.filename === "tmLanguage.json");
  const monarch = monarchFile ? JSON.parse(monarchFile.content) : null;
  const textmate = tmFile ? JSON.parse(tmFile.content) : null;

  // 3. Compile AssemblyScript to WASM in-memory
  let ascModule: any = null;
  try {
    ascModule = await import("assemblyscript/asc");
  } catch {
    ascModule = await import("assemblyscript/dist/asc.js");
  }
  const asc = ascModule?.default ?? ascModule;

  let stderrOutput = "";
  const stderrStream = {
    write(chunk: string) {
      stderrOutput += chunk;
    },
  };

  const outputFiles: Record<string, Uint8Array | string> = {};
  const flags = [
    "parser.ts",
    "--outFile",
    "parser.wasm",
    "--exportRuntime",
    "--enable",
    "threads",
    "--optimize",
    "--runtime",
    "stub",
  ];

  if (options?.shrink) {
    flags.push("--shrinkLevel", "2");
  }

  const { error } = await asc.main(flags, {
    stderr: stderrStream,
    readFile(filename: string) {
      const cleanName = filename.replace(/^\.\//, "").replace(/.*[/\\]/, "");
      if (vfs[cleanName]) return vfs[cleanName];
      if (vfs[`${cleanName}.ts`]) return vfs[`${cleanName}.ts`];
      if (vfs[filename]) return vfs[filename];
      return null;
    },
    writeFile(filename: string, contents: Uint8Array | string) {
      outputFiles[filename] = contents;
    },
    listFiles() {
      return Object.keys(vfs);
    },
  });

  const wasmOutput = outputFiles["parser.wasm"];
  if (error || !wasmOutput) {
    throw new Error(
      `AssemblyScript in-memory compilation failed: ${error?.message ?? "unknown error"}\nSTDERR:\n${stderrOutput}`,
    );
  }

  const wasmBytes = typeof wasmOutput === "string" ? new TextEncoder().encode(wasmOutput) : (wasmOutput as Uint8Array);

  return {
    id,
    name: langDef.name,
    extensions,
    wasmBytes,
    monarch,
    textmate,
    jsWrapper: buildResult.javascriptWrapper.js,
    parserInfo: buildResult.parserInfo,
  };
}
