// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  compileAssemblyScriptInWorker,
  generateCleanRoomCompanionFromFortran,
  type EmtCustomFortranBlock,
} from "@modelscript/pscad";

export interface AnsatzCompanionCompileResult {
  source?: string | undefined;
  wasmBytes?: Uint8Array | undefined;
  stderr: string;
}

/**
 * Compiles custom PSCAD AssemblyScript companion code off the main thread in Ansatz
 * using a Web Worker when an `ascModuleUrl` is available, falling back cleanly otherwise.
 */
export async function compilePscadCompanionInAnsatz(
  sources: string | Record<string, string>,
  options?: { optimizeLevel?: number; memoryBase?: number; ascModuleUrl?: string },
): Promise<AnsatzCompanionCompileResult> {
  const defaultAscUrl =
    typeof window !== "undefined" &&
    typeof (import.meta as { env?: Record<string, string> }).env?.VITE_ASC_MODULE_URL === "string"
      ? (import.meta as { env?: Record<string, string> }).env!.VITE_ASC_MODULE_URL
      : undefined;

  return compileAssemblyScriptInWorker(sources, {
    optimizeLevel: options?.optimizeLevel,
    memoryBase: options?.memoryBase,
    ascModuleUrl: options?.ascModuleUrl ?? defaultAscUrl,
  });
}

/**
 * Generates a clean-room AssemblyScript `fmi-ls-emt` scaffold from a `P6104`
 * `EmtCustomFortranBlock` and compiles it off the main thread in Ansatz.
 */
export async function generateAndCompilePscadCompanionInAnsatz(
  block: EmtCustomFortranBlock,
  options?: { optimizeLevel?: number; memoryBase?: number; ascModuleUrl?: string },
): Promise<AnsatzCompanionCompileResult> {
  const source = generateCleanRoomCompanionFromFortran(block);
  const compiled = await compilePscadCompanionInAnsatz(source, options);
  return { source, ...compiled };
}
