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
import { fileURLToPath } from "node:url";
import { Worker as NodeWorkerThread } from "node:worker_threads";
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
let resolvedNativeAddonPath: string | undefined;

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
    resolvedNativeAddonPath = addonPath;
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

/**
 * Bootstrap script executed inside a Node.js `worker_threads` worker so the
 * browser-targeted `browserServerMain.js` LSP bundle runs seamlessly inside
 * VS Code Desktop's Node.js Extension Host (with `file://` fetch and native
 * addon acceleration).
 */
const WORKER_BOOTSTRAP_CODE = `
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { fileURLToPath } = require("node:url");
const { parentPort, workerData } = require("node:worker_threads");

const listeners = new Map();
globalThis.self = globalThis;
globalThis.location = {
  href: workerData.scriptUrl,
  origin: "null",
  protocol: "file:",
  hostname: "",
  pathname: workerData.scriptPath,
};

globalThis.addEventListener = (type, fn) => {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
};
globalThis.removeEventListener = (type, fn) => {
  listeners.get(type)?.delete(fn);
};
globalThis.postMessage = (message, transfer) => {
  parentPort.postMessage(message, transfer);
};

parentPort.on("message", (data) => {
  const event = { data };
  if (typeof globalThis.onmessage === "function") {
    globalThis.onmessage(event);
  }
  const fns = listeners.get("message");
  if (fns) {
    for (const fn of fns) {
      if (typeof fn === "function") fn(event);
      else if (fn && typeof fn.handleEvent === "function") fn.handleEvent(event);
    }
  }
});

// Shim file:// support on global fetch() for loading bundled .wasm / .zip assets
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const urlStr = typeof input === "string" ? input : input instanceof URL ? input.href : String(input?.url ?? input);
  if (urlStr.startsWith("file://")) {
    const filePath = fileURLToPath(urlStr);
    const data = await fs.promises.readFile(filePath);
    const contentType = filePath.endsWith(".wasm")
      ? "application/wasm"
      : filePath.endsWith(".json")
        ? "application/json"
        : filePath.endsWith(".zip")
          ? "application/zip"
          : "application/octet-stream";
    return new Response(data, { status: 200, headers: { "content-type": contentType } });
  }
  return nativeFetch(input, init);
};

// Bootstrap native addon inside the LSP worker thread if available
if (workerData.nativeAddonPath && fs.existsSync(workerData.nativeAddonPath) && process.env.MODELSCRIPT_BACKEND !== "wasm") {
  try {
    const req = createRequire(workerData.scriptPath);
    const raw = req(workerData.nativeAddonPath);
    const wrapMem = (m) =>
      Object.defineProperty(Object.assign({}, m), "memory", {
        value: { get buffer() { return m.__getMemoryBuffer(); } },
        enumerable: true,
        configurable: false,
      });
    const wrapped = {
      backend: raw.backend,
      addonPath: workerData.nativeAddonPath,
      runtime: wrapMem(raw.runtime),
      simulate: wrapMem(raw.simulate),
      selftest: () => raw.selftest(),
      getGpuCapabilities: () => raw.getGpuCapabilities(),
    };
    globalThis.__modelscript_native_addon__ = wrapped;
    globalThis.__modelscript_wasm_exports__ = wrapped.runtime;
  } catch (err) {
    console.warn("[ModelScript Desktop Worker] Native addon load failed; using WASM:", err);
  }
}

const serverReq = createRequire(workerData.scriptPath);
serverReq(workerData.scriptPath);
`;

function resolveWorkerScriptPath(scriptUrl: string): string {
  if (scriptUrl.startsWith("file://")) {
    return fileURLToPath(scriptUrl);
  }
  if (scriptUrl.startsWith("vscode-file://")) {
    const parsed = new URL(scriptUrl);
    return decodeURIComponent(parsed.pathname);
  }
  return scriptUrl;
}

class DesktopNodeWorker {
  private readonly wt: NodeWorkerThread;
  private readonly listeners = new Map<string, Set<(ev: unknown) => void>>();
  public onmessage: ((ev: { data: unknown }) => void) | null = null;
  public onerror: ((ev: { message: string; error: unknown }) => void) | null = null;

  constructor(scriptUrl: string | URL) {
    const urlStr = typeof scriptUrl === "string" ? scriptUrl : scriptUrl.toString();
    const scriptPath = resolveWorkerScriptPath(urlStr);
    this.wt = new NodeWorkerThread(WORKER_BOOTSTRAP_CODE, {
      eval: true,
      workerData: {
        scriptUrl: urlStr,
        scriptPath,
        nativeAddonPath: resolvedNativeAddonPath,
      },
    });

    this.wt.on("message", (data: unknown) => {
      const ev = { data };
      this.onmessage?.(ev);
      const set = this.listeners.get("message");
      if (set) {
        for (const fn of set) fn(ev);
      }
    });

    this.wt.on("error", (error: Error) => {
      const ev = { message: error?.message ?? String(error), error };
      this.onerror?.(ev);
      const set = this.listeners.get("error");
      if (set) {
        for (const fn of set) fn(ev);
      }
    });
  }

  public postMessage(message: unknown, transfer?: unknown[]): void {
    if (transfer && transfer.length > 0) {
      this.wt.postMessage(message, transfer as never);
    } else {
      this.wt.postMessage(message);
    }
  }

  public addEventListener(type: string, listener: (ev: unknown) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  public removeEventListener(type: string, listener: (ev: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  public terminate(): void {
    void this.wt.terminate();
  }
}

function installDesktopWorkerPolyfill(): void {
  if (typeof (globalThis as Record<string, unknown>)["Worker"] === "undefined") {
    (globalThis as Record<string, unknown>)["Worker"] = DesktopNodeWorker;
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  bootstrapNativeAddon(context.extensionPath);
  installDesktopWorkerPolyfill();
  const req = createRequire(__filename);
  loadedSharedClient = req("./browserClientMain.js") as SharedClientModule;
  return loadedSharedClient.activate(context);
}

export async function deactivate(): Promise<void> {
  if (loadedSharedClient && typeof loadedSharedClient.deactivate === "function") {
    await loadedSharedClient.deactivate();
  }
}
