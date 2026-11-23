// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DiagramComponentSpec, DiagramPortSpec, LibrarySymbolStub } from "./library-manifest.js";

/**
 * Typed linear-memory views backed by a `WebAssembly.Memory`.
 * Automatically refreshed when `ensureMemoryCapacity` grows the backing `ArrayBuffer`.
 */
export interface CachedMemoryViews {
  mem: WebAssembly.Memory;
  buf: ArrayBufferLike;
  f64: Float64Array;
  i32: Int32Array;
  u32: Uint32Array;
}

const compiledModuleCache = new WeakMap<Uint8Array, WebAssembly.Module>();

/**
 * Compiles and caches a `WebAssembly.Module` keyed by its backing `Uint8Array`.
 */
export function getOrCompileWasmModule(wasmBytes: Uint8Array): WebAssembly.Module | undefined {
  let mod = compiledModuleCache.get(wasmBytes);
  if (mod) return mod;
  try {
    const copy = new Uint8Array(wasmBytes);
    mod = new WebAssembly.Module(copy);
    compiledModuleCache.set(wasmBytes, mod);
    return mod;
  } catch {
    return undefined;
  }
}

/**
 * Instantiates an isolated `WebAssembly.Instance` with a default AssemblyScript `env.abort` stub
 * and optional `maxMemoryPages` capability enforcement (64 KiB per page).
 */
export function createIsolatedWasmInstance(
  wasmBytes: Uint8Array,
  extraImports?: WebAssembly.Imports,
  maxMemoryPages?: number,
): WebAssembly.Instance | undefined {
  const mod = getOrCompileWasmModule(wasmBytes);
  if (!mod) return undefined;
  try {
    const envImports: Record<string, WebAssembly.ImportValue> = {
      abort() {
        // no-op abort stub for AssemblyScript runtimes
      },
      ...((extraImports?.["env"] as Record<string, WebAssembly.ImportValue> | undefined) ?? {}),
    };
    const instance = new WebAssembly.Instance(mod, {
      ...extraImports,
      env: envImports,
    });
    if (maxMemoryPages !== undefined && instance.exports["memory"] instanceof WebAssembly.Memory) {
      const currentPages = Math.ceil(instance.exports["memory"].buffer.byteLength / 65536);
      if (currentPages > maxMemoryPages) {
        throw new RangeError(
          `WASM instance initial memory (${currentPages} pages) exceeds capability cap of ${maxMemoryPages} pages.`,
        );
      }
    }
    return instance;
  } catch (err) {
    if (err instanceof RangeError) throw err;
    return undefined;
  }
}

/**
 * Creates typed `Float64Array`, `Int32Array`, and `Uint32Array` views over a `WebAssembly.Memory`.
 */
export function createMemoryViews(mem: WebAssembly.Memory): CachedMemoryViews {
  const buf = mem.buffer;
  return {
    mem,
    buf,
    f64: new Float64Array(buf),
    i32: new Int32Array(buf),
    u32: new Uint32Array(buf),
  };
}

/**
 * Ensures the underlying `WebAssembly.Memory` has at least `requiredBytes` capacity,
 * refreshing all typed-array views if the buffer was grown or detached.
 */
export function ensureMemoryCapacity(views: CachedMemoryViews, requiredBytes: number, maxMemoryPages?: number): void {
  if (views.mem.buffer.byteLength < requiredBytes) {
    const currentPages = Math.ceil(views.mem.buffer.byteLength / 65536);
    const neededPages = Math.ceil((requiredBytes - views.mem.buffer.byteLength) / 65536);
    if (maxMemoryPages !== undefined && currentPages + neededPages > maxMemoryPages) {
      throw new RangeError(
        `WASM memory growth to ${currentPages + neededPages} pages exceeds capability cap of ${maxMemoryPages} pages.`,
      );
    }
    views.mem.grow(neededPages);
  }
  if (views.buf !== views.mem.buffer) {
    views.buf = views.mem.buffer;
    views.f64 = new Float64Array(views.buf);
    views.i32 = new Int32Array(views.buf);
    views.u32 = new Uint32Array(views.buf);
  }
}

/**
 * Isomorphic base64 → `Uint8Array` decoder for zero-I/O WASM payloads in Node.js, Browsers, and Web Workers.
 */
export function decodeBase64Wasm(base64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    const buf = Buffer.from(base64, "base64");
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Parameter metadata for a cleanroom standard library component or model.
 */
export interface CleanroomParameterSchema {
  key: string;
  label?: string | undefined;
  type: "real" | "integer" | "boolean" | "string" | "enum";
  defaultValue: number | boolean | string;
  unit?: string | undefined;
  min?: number | undefined;
  max?: number | undefined;
  description?: string | undefined;
}

/**
 * Declarative cleanroom standard library component/model schema shared across languages.
 */
export interface CleanroomModelSchema {
  /** Canonical qualified or short model identifier (e.g. `"pslf:genrou"`, `"simulink:Integrator"`). */
  namePath: string;
  /** Short display/lookup name (e.g. `"genrou"`, `"Integrator"`). */
  name: string;
  /** Alternative names or legacy aliases. */
  aliases?: string[] | undefined;
  /** Human-readable label. */
  label: string;
  /** Domain category (e.g. `"Generator"`, `"Exciter"`, `"Continuous"`, `"UnitOperation"`). */
  category: string;
  /** Physical domain (e.g. `"electrical"`, `"control"`, `"thermal"`, `"mechanical"`, `"fluid"`, `"pkpd"`). */
  domain: string;
  /** Short technical description. */
  description: string;
  /** Public specification or textbook provenance citation (cleanroom IP hygiene). */
  provenance: string;
  /** Component symbol kind registered in `LibrarySymbolStub.kind`. */
  symbolKind: string;
  /** Default diagram box width in pixels. */
  width?: number | undefined;
  /** Default diagram box height in pixels. */
  height?: number | undefined;
  /** Optional parametric cleanroom SVG icon markup. */
  svg?: string | undefined;
  /** Port layout specifications for diagram rendering & wiring. */
  ports: DiagramPortSpec[];
  /** Ordered model parameters. */
  parameters: CleanroomParameterSchema[];
  /** Optional WASM exported kernel function prefix (e.g. `"GENROU"` → `GENROU_init`, `GENROU_step`). */
  wasmKernel?: string | undefined;
  /** Optional extra language-specific metadata. */
  extra?: Record<string, unknown> | undefined;
}

/**
 * Converts `CleanroomModelSchema[]` into `@modelscript/runtime` `LibrarySymbolStub[]`
 * and `DiagramComponentSpec[]` payloads for `modelscript.yaml` / `globalLibraryRegistry`.
 */
export function cleanroomSchemasToLibraryPayloads(schemas: readonly CleanroomModelSchema[]): {
  symbols: LibrarySymbolStub[];
  diagrams: DiagramComponentSpec[];
} {
  const symbols: LibrarySymbolStub[] = [];
  const diagrams: DiagramComponentSpec[] = [];

  for (const s of schemas) {
    symbols.push({
      name: s.name,
      kind: s.symbolKind,
      namePath: s.namePath,
      exports: s.parameters.map((p) => p.key),
      inherits: [],
      metadata: {
        label: s.label,
        category: s.category,
        domain: s.domain,
        description: s.description,
        provenance: s.provenance,
        aliases: s.aliases ?? [],
        parameters: s.parameters,
        wasmKernel: s.wasmKernel,
        ...(s.extra ?? {}),
      },
    });

    diagrams.push({
      namePath: s.namePath,
      aliases: s.aliases,
      label: s.label,
      category: s.category,
      domain: s.domain,
      width: s.width ?? 64,
      height: s.height ?? 48,
      svg: s.svg,
      ports: s.ports,
    });
  }

  return { symbols, diagrams };
}

/**
 * Compiles user-authored AssemblyScript source into a sandboxed `runtime.wasm` binary
 * for custom cleanroom user models (`S-Function`, `USER2`, `MODELS`, `UMAT`, `epcmod`, `USRMDL`, etc.).
 * Uses dynamic `assemblyscript/asc` import so browser bundles remain lightweight.
 */
export async function compileAssemblyScriptCleanroomModel(
  sourceTs: string,
): Promise<{ wasmBytes?: Uint8Array; diagnostics: string[] }> {
  const diagnostics: string[] = [];
  try {
    const ascSpec = "assemblyscript/asc";
    const asc = (await import(/* @vite-ignore */ ascSpec)) as {
      main(
        argv: string[],
        options: {
          readFile(filename: string): string | null;
          writeFile(filename: string, contents: Uint8Array | string): void;
          listFiles(): string[];
        },
      ): Promise<{ error: Error | null; stderr?: { toString(): string } }>;
    };
    let outWasm: Uint8Array | undefined;
    const { error, stderr } = await asc.main(
      ["model.ts", "--outFile", "runtime.wasm", "--bindings", "raw", "--optimize", "--noAssert"],
      {
        readFile: (filename: string) => (filename === "model.ts" ? sourceTs : null),
        writeFile: (filename: string, contents: Uint8Array | string) => {
          if (filename === "runtime.wasm") {
            outWasm = typeof contents === "string" ? new TextEncoder().encode(contents) : contents;
          }
        },
        listFiles: () => [],
      },
    );
    const errText = stderr?.toString?.() ?? "";
    if (errText.trim().length > 0) diagnostics.push(errText.trim());
    if (error) diagnostics.push(error.message);
    return outWasm ? { wasmBytes: outWasm, diagnostics } : { diagnostics };
  } catch (e) {
    diagnostics.push(e instanceof Error ? e.message : String(e));
    return { diagnostics };
  }
}
