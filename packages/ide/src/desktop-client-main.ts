// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Desktop VS Code Extension Host Entry Point (`package.json#main`).
 *
 * Bootstraps the platform-native `@modelscript/native` (`wasm2c` + Dawn WebGPU)
 * N-API addon bundled under `<extensionPath>/native/modelscript_native.node`
 * before delegating to the shared Ansatz Studio activation lifecycle.
 *
 * Falls back transparently to WebAssembly if the native binary is absent or
 * if `MODELSCRIPT_BACKEND=wasm` is set.
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type * as vscode from "vscode";

interface SharedClientModule {
  activate(context: vscode.ExtensionContext): Promise<void> | void;
  deactivate?(): Promise<void> | void;
}

interface RawNativeAddon {
  backend: string;
  runtime: Record<string, unknown> & { __getMemoryBuffer?: () => ArrayBuffer };
  simulate: Record<string, unknown> & { __getMemoryBuffer?: () => ArrayBuffer };
  selftest(): number;
  getGpuCapabilities(): {
    dawnCompiled: boolean;
    dawnAvailable: boolean;
    hardwareFp64: boolean;
    backendName: string;
    adapterName: string;
  };
}

let loadedSharedClient: SharedClientModule | null = null;

function wrapNativeMemory(raw: Record<string, unknown> & { __getMemoryBuffer?: () => ArrayBuffer }) {
  const memory = {
    get buffer(): ArrayBuffer {
      if (typeof raw.__getMemoryBuffer !== "function") {
        throw new Error("[modelscript-desktop] Native kernel missing __getMemoryBuffer()");
      }
      return raw.__getMemoryBuffer();
    },
  };
  return Object.defineProperty(Object.assign({}, raw), "memory", {
    value: memory,
    enumerable: true,
    configurable: false,
  });
}

function bootstrapNativeAddon(extensionPath: string): void {
  if (process.env["MODELSCRIPT_BACKEND"] === "wasm") {
    console.log("[ModelScript Desktop] MODELSCRIPT_BACKEND=wasm set; using WebAssembly backend.");
    return;
  }

  const bundledAddon = path.join(extensionPath, "native", "modelscript_native.node");
  const addonPath = process.env["MODELSCRIPT_NATIVE_ADDON"] || bundledAddon;

  if (!fs.existsSync(addonPath)) {
    console.log("[ModelScript Desktop] No native addon found at", addonPath, "— falling back to WebAssembly.");
    return;
  }

  try {
    process.env["MODELSCRIPT_NATIVE_ADDON"] = addonPath;
    const req = createRequire(__filename);
    const raw = req(addonPath) as RawNativeAddon;
    const wrapped = {
      backend: raw.backend,
      addonPath,
      runtime: wrapNativeMemory(raw.runtime),
      simulate: wrapNativeMemory(raw.simulate),
      selftest: () => raw.selftest(),
      getGpuCapabilities: () => raw.getGpuCapabilities(),
    };
    (globalThis as Record<string, unknown>)["__modelscript_native_addon__"] = wrapped;
    (globalThis as Record<string, unknown>)["__modelscript_wasm_exports__"] = wrapped.runtime;

    const caps = wrapped.getGpuCapabilities();
    console.log(
      `[ModelScript Desktop] Native backend active (${wrapped.backend}, gpu=${caps.backendName}, fp64=${caps.hardwareFp64})`,
    );
  } catch (err) {
    console.warn("[ModelScript Desktop] Failed to load native addon; falling back to WebAssembly:", err);
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  bootstrapNativeAddon(context.extensionPath);
  const req = createRequire(__filename);
  loadedSharedClient = req("./browserClientMain.js") as SharedClientModule;
  return loadedSharedClient.activate(context);
}

export async function deactivate(): Promise<void> {
  if (loadedSharedClient && typeof loadedSharedClient.deactivate === "function") {
    await loadedSharedClient.deactivate();
  }
}
