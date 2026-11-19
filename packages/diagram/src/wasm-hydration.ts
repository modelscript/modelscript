// SPDX-License-Identifier: AGPL-3.0-or-later

let diagramWasmHydrationPromise: Promise<boolean> | null = null;

/**
 * Registers runtime WebAssembly exports on `globalThis.__modelscript_wasm_exports__` so
 * UI-thread diagram layout (`diagram_tsm_compact_1d`, `diagram_port_align_1d`) and
 * orthogonal A* routing (`diagram_route_orthogonal_astar`) run in WASM rather than JS fallbacks.
 */
export function setDiagramWasmExports(exports: unknown): void {
  if (typeof globalThis !== "undefined" && exports) {
    (globalThis as { __modelscript_wasm_exports__?: unknown }).__modelscript_wasm_exports__ = exports;
  }
}

/**
 * Returns the currently registered diagram/runtime WASM exports, if hydrated.
 */
export function getDiagramWasmExports(): unknown {
  return typeof globalThis !== "undefined"
    ? (globalThis as { __modelscript_wasm_exports__?: unknown }).__modelscript_wasm_exports__
    : undefined;
}

/**
 * Asynchronously fetches and instantiates `release.wasm` in browser/webview UI threads when
 * `__modelscript_wasm_exports__` has not yet been hydrated. Safe and idempotent across callers.
 */
export async function hydrateDiagramWasm(wasmUrl = "/lsp/server/dist/release.wasm"): Promise<boolean> {
  if (getDiagramWasmExports()) return true;
  if (typeof fetch !== "function" || typeof WebAssembly !== "object") return false;
  if (diagramWasmHydrationPromise) return diagramWasmHydrationPromise;

  diagramWasmHydrationPromise = (async () => {
    try {
      const imports = {
        env: {
          abort: () => {
            console.error("[diagram:wasm] abort invoked");
          },
        },
      };
      const resp = await fetch(wasmUrl);
      if (!resp.ok) return false;
      let instance: WebAssembly.Instance;
      if (typeof WebAssembly.instantiateStreaming === "function") {
        try {
          const streamed = await WebAssembly.instantiateStreaming(resp.clone(), imports);
          instance = streamed.instance;
        } catch {
          const bytes = await resp.arrayBuffer();
          const compiled = await WebAssembly.instantiate(bytes, imports);
          instance = compiled.instance;
        }
      } else {
        const bytes = await resp.arrayBuffer();
        const compiled = await WebAssembly.instantiate(bytes, imports);
        instance = compiled.instance;
      }
      setDiagramWasmExports(instance.exports);
      return true;
    } catch {
      diagramWasmHydrationPromise = null;
      return false;
    }
  })();

  return diagramWasmHydrationPromise;
}
