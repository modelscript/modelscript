// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * WebAssembly Runtime Singleton Loader & FinalizationRegistry for `DAEBuilder`.
 */

let cachedWasmExports: any = null;

/**
 * Registers a pre-instantiated WebAssembly runtime exports object as the process-wide default.
 */
export function setCachedWasmExports(exports: any): void {
  cachedWasmExports = exports;
  if (typeof globalThis !== "undefined") {
    (globalThis as any).__modelscript_wasm_exports__ = exports;
  }
}

/**
 * Returns the cached WebAssembly runtime exports, lazily loading `build/release.wasm`
 * from disk when running in Node.js if not yet initialized.
 */
export function getDefaultWasmExports(): any {
  if (cachedWasmExports) return cachedWasmExports;
  if (typeof globalThis !== "undefined" && (globalThis as any).__modelscript_wasm_exports__) {
    cachedWasmExports = (globalThis as any).__modelscript_wasm_exports__;
    return cachedWasmExports;
  }
  if (typeof process !== "undefined" && process.versions?.node != null) {
    try {
      let fsModule: { existsSync: (p: string) => boolean; readFileSync: (p: string) => Uint8Array } | undefined;
      let pathModule: { join: (...p: string[]) => string } | undefined;
      const proc = process as { getBuiltinModule?: (m: string) => unknown };
      if (typeof proc.getBuiltinModule === "function") {
        fsModule = proc.getBuiltinModule("node:fs") as typeof fsModule;
        pathModule = proc.getBuiltinModule("node:path") as typeof pathModule;
      }
      if (!fsModule || !pathModule) {
        try {
          const req = typeof require !== "undefined" ? (require as (id: string) => unknown) : null;
          if (req) {
            fsModule = fsModule || (req("node:fs") as typeof fsModule);
            pathModule = pathModule || (req("node:path") as typeof pathModule);
          }
        } catch {}
      }
      if (!fsModule || !pathModule) return null;

      // Prefer platform-native wasm2c addon in Node.js unless MODELSCRIPT_BACKEND=wasm
      const backendPref = process.env["MODELSCRIPT_BACKEND"] ?? "auto";
      if (backendPref !== "wasm") {
        try {
          const nativeAddon = (globalThis as Record<string, unknown>)["__modelscript_native_addon__"] as
            { runtime?: unknown } | undefined;
          if (nativeAddon?.runtime) {
            cachedWasmExports = nativeAddon.runtime;
            (globalThis as Record<string, unknown>)["__modelscript_wasm_exports__"] = cachedWasmExports;
            return cachedWasmExports;
          }
        } catch {}
      }

      const dir = typeof import.meta.dirname === "string" ? import.meta.dirname : "";
      const candidates = [
        dir ? pathModule.join(dir, "..", "build", "release.wasm") : null,
        dir ? pathModule.join(dir, "..", "..", "build", "release.wasm") : null,
        pathModule.join(process.cwd(), "packages", "runtime", "build", "release.wasm"),
        pathModule.join(process.cwd(), "build", "release.wasm"),
      ].filter((p): p is string => Boolean(p));

      let wasmPath: string | null = null;
      for (const cand of candidates) {
        if (fsModule.existsSync(cand)) {
          wasmPath = cand;
          break;
        }
      }

      if (wasmPath) {
        const bytes = fsModule.readFileSync(wasmPath);
        const mod = new WebAssembly.Module(bytes as BufferSource);
        const inst = new WebAssembly.Instance(mod, {
          env: {
            abort: () => {
              console.error("[WASM:dae] abort invoked");
            },
          },
        });
        cachedWasmExports = inst.exports;
        if (typeof globalThis !== "undefined") {
          (globalThis as any).__modelscript_wasm_exports__ = cachedWasmExports;
        }
        return cachedWasmExports;
      }
    } catch {
      // Fallback
    }
  }
  return null;
}

export interface DaeCleanupPayload {
  exports: any;
  ptr: number;
}

export const daeFinalizationRegistry =
  typeof FinalizationRegistry !== "undefined"
    ? new FinalizationRegistry<DaeCleanupPayload>((heldValue) => {
        if (heldValue.ptr && heldValue.exports?.dae_free) {
          try {
            heldValue.exports.dae_free(heldValue.ptr);
          } catch {
            // ignore
          }
        }
      })
    : null;
