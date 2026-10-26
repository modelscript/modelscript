// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createWasmFmuRunner,
  CWasmCompilerClient,
  parseCSourceModel,
  type CWasmCompileRequest,
  type CWasmStage,
  type CWasmStageMessage,
  type CWasmSuccessMessage,
  type WasmFmuRunner,
} from "@modelscript/exchange";
import { useCallback, useRef, useState } from "react";

export interface CWasmCompilerHookState {
  stage: CWasmStage;
  progress: number;
  statusMessage: string;
  isCompiling: boolean;
  wasmBinary: Uint8Array | null;
  runner: WasmFmuRunner | null;
  result: CWasmSuccessMessage | null;
  error: string | null;
}

export interface UseCWasmCompilerOptions {
  onSuccess?: ((res: CWasmSuccessMessage, runner: WasmFmuRunner | null) => void) | undefined;
  onError?: ((error: string) => void) | undefined;
}

export interface UseCWasmCompilerReturn extends CWasmCompilerHookState {
  compile: (request: Omit<CWasmCompileRequest, "id">) => Promise<CWasmSuccessMessage | null>;
  abort: () => void;
  reset: () => void;
}

/**
 * React hook that coordinates background WebWorker C-to-Wasm compilation,
 * providing real-time progress indicators, SHA-256 caching, and automated
 * WebAssembly module instantiation for interactive simulation testbenches.
 */
export function useCWasmCompiler(options?: UseCWasmCompilerOptions): UseCWasmCompilerReturn {
  const [state, setState] = useState<CWasmCompilerHookState>({
    stage: "idle",
    progress: 0,
    statusMessage: "Ready",
    isCompiling: false,
    wasmBinary: null,
    runner: null,
    result: null,
    error: null,
  });

  const clientRef = useRef<CWasmCompilerClient | null>(null);

  const getClient = useCallback(() => {
    if (!clientRef.current) {
      clientRef.current = new CWasmCompilerClient();
    }
    return clientRef.current;
  }, []);

  const reset = useCallback(() => {
    setState({
      stage: "idle",
      progress: 0,
      statusMessage: "Ready",
      isCompiling: false,
      wasmBinary: null,
      runner: null,
      result: null,
      error: null,
    });
  }, []);

  const abort = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.terminate();
      clientRef.current = null;
    }
    setState((prev) => ({
      ...prev,
      stage: "idle",
      progress: 0,
      statusMessage: "Compilation aborted by user",
      isCompiling: false,
      error: "Aborted",
    }));
  }, []);

  const compile = useCallback(
    async (request: Omit<CWasmCompileRequest, "id">): Promise<CWasmSuccessMessage | null> => {
      const client = getClient();
      setState((prev) => ({
        ...prev,
        stage: "reading",
        progress: 10,
        statusMessage: "Preparing C source payload...",
        isCompiling: true,
        error: null,
      }));

      try {
        const res = await client.compile(request, (stageMsg: CWasmStageMessage) => {
          setState((prev) => ({
            ...prev,
            stage: stageMsg.stage,
            progress: stageMsg.progress,
            statusMessage: stageMsg.message,
          }));
        });

        // Instantiate WASM runner automatically
        let runner: WasmFmuRunner | null = null;
        try {
          const rawC =
            typeof request.sources === "string" ? request.sources : Object.values(request.sources).join("\n\n");
          const spec = parseCSourceModel(rawC, request.modelIdentifier || "Model");
          runner = await createWasmFmuRunner(res.wasmBinary, spec);
          runner.init(0.0);
        } catch (rErr) {
          console.warn("WASM FMU runner auto-instantiation skipped:", rErr);
        }

        setState({
          stage: "ready",
          progress: 100,
          statusMessage: res.fromCache
            ? `Loaded from cache in ${res.durationMs.toFixed(1)} ms`
            : `Compiled to WebAssembly (${(res.wasmByteLength / 1024).toFixed(1)} KB) in ${res.durationMs.toFixed(0)} ms`,
          isCompiling: false,
          wasmBinary: res.wasmBinary,
          runner,
          result: res,
          error: null,
        });

        options?.onSuccess?.(res, runner);
        return res;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setState((prev) => ({
          ...prev,
          stage: "error",
          statusMessage: `Compilation failed: ${msg}`,
          isCompiling: false,
          error: msg,
        }));
        options?.onError?.(msg);
        return null;
      }
    },
    [getClient, options],
  );

  return {
    ...state,
    compile,
    abort,
    reset,
  };
}
