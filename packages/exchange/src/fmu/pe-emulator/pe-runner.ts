// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * High-Level In-Browser Windows DLL FMU Runner.
 *
 * Emulates Win32/Win64 PE binaries inside the browser using a lightweight
 * user-space x86 CPU interpreter and standard C-runtime shims.
 */

import type { WasmFmuRunner } from "../wasm-compiler-worker.js";
import { CRuntimeManager } from "./c-runtime-shims.js";
import { PeLoader } from "./pe-loader.js";
import type { GuestMemorySpace } from "./types.js";
import { X86Cpu } from "./x86-cpu.js";

export interface PeRunnerVariable {
  name: string;
  valueReference: number;
  causality?: "input" | "output" | "parameter" | "local" | "independent" | string | undefined;
  start?: number | undefined;
}

export interface PeDllFmuRunnerOptions {
  modelName?: string | undefined;
  variables?: PeRunnerVariable[] | undefined;
  guid?: string | undefined;
}

export class PeDllFmuRunner implements WasmFmuRunner {
  readonly instance: WebAssembly.Instance | null = null;
  readonly loader: PeLoader;
  readonly memory: GuestMemorySpace;
  readonly cruntime: CRuntimeManager;
  readonly cpu: X86Cpu;
  readonly options: PeDllFmuRunnerOptions;

  private instancePtr: bigint = 0n;
  private currentTime = 0.0;
  private readonly varMap = new Map<string, number>();
  private readonly vrToName = new Map<number, string>();
  private readonly outputVrs: number[] = [];
  private readonly inputVrs: number[] = [];

  constructor(dllBuffer: Uint8Array, options: PeDllFmuRunnerOptions = {}) {
    this.options = options;
    this.loader = new PeLoader(dllBuffer);
    this.memory = this.loader.mapImageToMemory();
    this.cruntime = new CRuntimeManager(this.memory);
    this.cpu = new X86Cpu(this.memory, this.loader.header.is64Bit, this.cruntime);

    // Index variables
    if (options.variables) {
      for (const v of options.variables) {
        this.varMap.set(v.name, v.valueReference);
        this.vrToName.set(v.valueReference, v.name);
        if (v.causality === "output") {
          this.outputVrs.push(v.valueReference);
        } else if (v.causality === "input") {
          this.inputVrs.push(v.valueReference);
        }
      }
    }

    // Hook IAT entries if any imported symbols were discovered
    this.hookImports();
  }

  private hookImports(): void {
    // 1. Register common C-runtime hooks into CPU hook table
    const hookMap = new Map<string, bigint>();
    for (const [funcName] of this.cruntime.handlers) {
      const hookAddr = this.cpu.registerHostHook(funcName);
      hookMap.set(funcName, hookAddr);
    }

    // 2. Patch IAT entries for imported functions
    for (const imp of this.loader.imports) {
      let hookAddr = hookMap.get(imp.functionName);
      if (!hookAddr) {
        hookAddr = this.cpu.registerHostHook(imp.functionName);
        hookMap.set(imp.functionName, hookAddr);
      }
      const targetOff = imp.iatRva;
      if (targetOff >= 0 && targetOff + (this.loader.header.is64Bit ? 8 : 4) <= this.memory.size) {
        if (this.loader.header.is64Bit) {
          this.memory.dataView.setBigUint64(targetOff, hookAddr, true);
        } else {
          this.memory.dataView.setUint32(targetOff, Number(hookAddr & 0xffffffffn), true);
        }
      }
    }
  }

  init(startTime = 0.0): void {
    this.currentTime = startTime;

    // Allocate instance name and GUID in guest memory
    const instName = this.options.modelName || "PeModelInstance";
    const instNamePtr = this.cruntime.malloc(instName.length + 1);
    const instOff = Number(instNamePtr - this.memory.baseAddress);
    const enc = new TextEncoder();
    this.memory.uint8.set(enc.encode(instName), instOff);
    this.memory.uint8[instOff + instName.length] = 0;

    const guid = this.options.guid || "{00000000-0000-0000-0000-000000000000}";
    const guidPtr = this.cruntime.malloc(guid.length + 1);
    const guidOff = Number(guidPtr - this.memory.baseAddress);
    this.memory.uint8.set(enc.encode(guid), guidOff);
    this.memory.uint8[guidOff + guid.length] = 0;

    // 1. Call fmi2Instantiate if exported
    const instantiateSym =
      this.loader.exports.get("fmi2Instantiate") ??
      this.loader.exports.get("_fmi2Instantiate") ??
      this.loader.exports.get("fmi3InstantiateCoSimulation");

    if (instantiateSym) {
      const funcAddr = this.memory.baseAddress + BigInt(instantiateSym.rva);
      // fmi2Instantiate(instanceName, fmuType, fmuGUID, fmuResourceLocation, functions, visible, loggingOn)
      this.instancePtr = this.cpu.callFunction(funcAddr, [
        instNamePtr, // instanceName
        1n, // fmuType (1 = fmi2CoSimulation)
        guidPtr, // fmuGUID
        0n, // fmuResourceLocation
        0n, // functions callback struct
        0n, // visible
        0n, // loggingOn
      ]);
      if (this.instancePtr === 0n) {
        // Fallback default non-null pointer if allocator stub returned 0
        this.instancePtr = this.cruntime.malloc(1024);
      }
    } else {
      this.instancePtr = this.cruntime.malloc(1024);
    }

    // 2. Call fmi2SetupExperiment if exported
    const setupSym = this.loader.exports.get("fmi2SetupExperiment");
    if (setupSym) {
      const setupAddr = this.memory.baseAddress + BigInt(setupSym.rva);
      this.cpu.callFunction(setupAddr, [this.instancePtr, 0n, 0n], [startTime, 100.0, 0.0]);
    }

    // 3. Call fmi2EnterInitializationMode & fmi2ExitInitializationMode if exported
    const enterInit = this.loader.exports.get("fmi2EnterInitializationMode");
    if (enterInit) {
      this.cpu.callFunction(this.memory.baseAddress + BigInt(enterInit.rva), [this.instancePtr]);
    }

    // Set start values for parameters/inputs
    if (this.options.variables) {
      for (const v of this.options.variables) {
        if (v.start !== undefined) {
          this.setVar(v.valueReference, v.start);
        }
      }
    }

    const exitInit = this.loader.exports.get("fmi2ExitInitializationMode");
    if (exitInit) {
      this.cpu.callFunction(this.memory.baseAddress + BigInt(exitInit.rva), [this.instancePtr]);
    }
  }

  setVar(nameOrVr: string | number, value: number): void {
    const vr = typeof nameOrVr === "number" ? nameOrVr : (this.varMap.get(nameOrVr) ?? 0);

    const setRealSym =
      this.loader.exports.get("fmi2SetReal") ??
      this.loader.exports.get("_fmi2SetReal") ??
      this.loader.exports.get("fmi3SetFloat64");

    if (setRealSym) {
      const funcAddr = this.memory.baseAddress + BigInt(setRealSym.rva);

      // Allocate small scratch buffer on heap for VR and Value
      const vrPtr = this.cruntime.malloc(8);
      const valPtr = this.cruntime.malloc(8);

      const vrOff = Number(vrPtr - this.memory.baseAddress);
      const valOff = Number(valPtr - this.memory.baseAddress);

      this.memory.dataView.setUint32(vrOff, vr, true);
      this.memory.dataView.setFloat64(valOff, value, true);

      // fmi2SetReal(c, const fmi2ValueReference vr[], size_t nvr, const fmi2Real value[])
      this.cpu.callFunction(funcAddr, [this.instancePtr, vrPtr, 1n, valPtr]);
    }
  }

  getVar(nameOrVr: string | number): number {
    const vr = typeof nameOrVr === "number" ? nameOrVr : (this.varMap.get(nameOrVr) ?? 0);

    const getRealSym =
      this.loader.exports.get("fmi2GetReal") ??
      this.loader.exports.get("_fmi2GetReal") ??
      this.loader.exports.get("fmi3GetFloat64");

    if (getRealSym) {
      const funcAddr = this.memory.baseAddress + BigInt(getRealSym.rva);

      const vrPtr = this.cruntime.malloc(8);
      const valPtr = this.cruntime.malloc(8);

      const vrOff = Number(vrPtr - this.memory.baseAddress);
      const valOff = Number(valPtr - this.memory.baseAddress);

      this.memory.dataView.setUint32(vrOff, vr, true);
      this.memory.dataView.setFloat64(valOff, 0.0, true);

      // fmi2GetReal(c, const fmi2ValueReference vr[], size_t nvr, fmi2Real value[])
      this.cpu.callFunction(funcAddr, [this.instancePtr, vrPtr, 1n, valPtr]);

      return this.memory.dataView.getFloat64(valOff, true);
    }

    return 0.0;
  }

  step(currentTime: number, dt: number, inputs?: Record<string, number>): Record<string, number> {
    this.currentTime = currentTime + dt;

    // 1. Set input values
    if (inputs) {
      for (const [name, val] of Object.entries(inputs)) {
        this.setVar(name, val);
      }
    }

    // 2. Call fmi2DoStep
    const doStepSym =
      this.loader.exports.get("fmi2DoStep") ??
      this.loader.exports.get("_fmi2DoStep") ??
      this.loader.exports.get("fmi3DoStep");

    if (doStepSym) {
      const funcAddr = this.memory.baseAddress + BigInt(doStepSym.rva);
      // fmi2DoStep(c, currentCommunicationPoint, communicationStepSize, noSetFMUStatePriorToCurrentPoint)
      this.cpu.callFunction(funcAddr, [this.instancePtr, 1n], [currentTime, dt]);
    }

    // 3. Collect output values
    const results: Record<string, number> = {};
    if (this.outputVrs.length > 0) {
      for (const vr of this.outputVrs) {
        const name = this.vrToName.get(vr) || `var_${vr}`;
        results[name] = this.getVar(vr);
      }
    } else {
      // If no outputs specified, read all indexed variables
      for (const [name, vr] of this.varMap) {
        results[name] = this.getVar(vr);
      }
    }

    return results;
  }

  getTime(): number {
    return this.currentTime;
  }

  terminate(): void {
    const terminateSym = this.loader.exports.get("fmi2Terminate") ?? this.loader.exports.get("_fmi2Terminate");
    if (terminateSym && this.instancePtr !== 0n) {
      this.cpu.callFunction(this.memory.baseAddress + BigInt(terminateSym.rva), [this.instancePtr]);
    }

    const freeSym = this.loader.exports.get("fmi2FreeInstance") ?? this.loader.exports.get("_fmi2FreeInstance");
    if (freeSym && this.instancePtr !== 0n) {
      this.cpu.callFunction(this.memory.baseAddress + BigInt(freeSym.rva), [this.instancePtr]);
    }
  }
}

/**
 * Creates an in-browser PE DLL runner for executing Windows FMUs without host binaries.
 */
export function createPeDllFmuRunner(dllBuffer: Uint8Array, options?: PeDllFmuRunnerOptions): PeDllFmuRunner {
  const runner = new PeDllFmuRunner(dllBuffer, options);
  runner.init(0.0);
  return runner;
}
