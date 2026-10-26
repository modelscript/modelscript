// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Universal In-Browser Binary FMU Runner ("Wasm-Machina").
 *
 * Automatically inspects uploaded binary headers (Windows PE DLL vs Linux ELF .so),
 * maps memory sections, applies relocations, configures the matching CPU ABI
 * (Microsoft x64 vs System V AMD64), executes static constructors, and drives
 * simulation stepping in the browser tab.
 */

import type { WasmFmuRunner } from "../wasm-compiler-worker.js";
import { AArch64Cpu } from "./aarch64-cpu.js";
import { CRuntimeManager } from "./c-runtime-shims.js";
import { ElfLoader } from "./elf-loader.js";
import { CPU_TYPE_ARM64, MachoLoader } from "./macho-loader.js";
import { PeLoader } from "./pe-loader.js";
import type { BatchSimulationOptions, BatchSimulationResult, GuestMemorySpace } from "./types.js";
import { X86Cpu } from "./x86-cpu.js";

export interface UniversalRunnerVariable {
  name: string;
  valueReference: number;
  causality?: "input" | "output" | "parameter" | "local" | "independent" | string | undefined;
  start?: number | undefined;
}

export interface UniversalFmuRunnerOptions {
  modelName?: string | undefined;
  variables?: UniversalRunnerVariable[] | undefined;
  guid?: string | undefined;
  preferredBase?: bigint | undefined;
}

export class UniversalBinaryRunner implements WasmFmuRunner {
  readonly format: "pe" | "elf" | "macho" | "unknown";
  readonly instance: any = null;
  readonly loader: PeLoader | ElfLoader | MachoLoader;
  readonly memory: GuestMemorySpace;
  readonly cruntime: CRuntimeManager;
  readonly cpu: X86Cpu | AArch64Cpu;
  readonly options: UniversalFmuRunnerOptions;

  private instancePtr: bigint = 0n;
  private currentTime = 0.0;
  private readonly varMap = new Map<string, number>();
  private readonly vrToName = new Map<number, string>();
  private readonly outputVrs: number[] = [];
  private readonly inputVrs: number[] = [];
  private readonly shadowVars = new Map<number, number>();
  private exportAddresses = new Map<string, bigint>();

  constructor(binaryBuffer: Uint8Array, options: UniversalFmuRunnerOptions = {}) {
    this.options = options;

    if (binaryBuffer.length >= 2 && binaryBuffer[0] === 0x4d && binaryBuffer[1] === 0x5a) {
      // 0x5A4D ('MZ') -> Windows PE DLL
      this.format = "pe";
      const peLoader = new PeLoader(binaryBuffer);
      this.loader = peLoader;
      this.memory = peLoader.mapImageToMemory(options.preferredBase);
      this.cruntime = new CRuntimeManager(this.memory);
      this.cpu = new X86Cpu(this.memory, peLoader.header.is64Bit, this.cruntime, "win64");
      this.hookPeImports(peLoader);

      // Extract export addresses
      for (const [name, sym] of peLoader.exports) {
        this.exportAddresses.set(name, this.memory.baseAddress + BigInt(sym.rva));
      }

      // Execute DllMain(hModule, DLL_PROCESS_ATTACH, NULL) if entry point exists
      if (peLoader.header.entryPointRva > 0) {
        const dllMainAddr = this.memory.baseAddress + BigInt(peLoader.header.entryPointRva);
        this.cpu.callFunction(dllMainAddr, [this.memory.baseAddress, 1n, 0n]);
      }
    } else if (
      binaryBuffer.length >= 4 &&
      binaryBuffer[0] === 0x7f &&
      binaryBuffer[1] === 0x45 &&
      binaryBuffer[2] === 0x4c &&
      binaryBuffer[3] === 0x46
    ) {
      // 0x7F 'E' 'L' 'F' -> Linux ELF Shared Object
      this.format = "elf";
      const elfLoader = new ElfLoader(binaryBuffer);
      this.loader = elfLoader;
      this.memory = elfLoader.mapImageToMemory(options.preferredBase);
      this.cruntime = new CRuntimeManager(this.memory);
      if (elfLoader.header.machine === 0xb7) {
        // EM_AARCH64 (0xB7 = 183)
        this.cpu = new AArch64Cpu(this.memory, this.cruntime);
      } else {
        this.cpu = new X86Cpu(this.memory, elfLoader.header.is64Bit, this.cruntime, "systemv");
      }
      this.hookElfRelocations(elfLoader);

      // Extract dynamic export addresses
      for (const [name, sym] of elfLoader.symbols) {
        this.exportAddresses.set(name, this.memory.baseAddress + sym.value);
      }

      // Execute static constructors (.init_array / DT_INIT)
      if (elfLoader.initArrayRvas.length > 0) {
        const addrs = elfLoader.initArrayRvas.map((rva) => this.memory.baseAddress + rva);
        this.cpu.executeStaticConstructors(addrs);
      }
    } else if (
      binaryBuffer.length >= 4 &&
      ((binaryBuffer[0] === 0xcf && binaryBuffer[1] === 0xfa && binaryBuffer[2] === 0xed && binaryBuffer[3] === 0xfe) ||
        (binaryBuffer[0] === 0xfe &&
          binaryBuffer[1] === 0xed &&
          binaryBuffer[2] === 0xfa &&
          binaryBuffer[3] === 0xcf) ||
        (binaryBuffer[0] === 0xce &&
          binaryBuffer[1] === 0xfa &&
          binaryBuffer[2] === 0xed &&
          binaryBuffer[3] === 0xfe) ||
        (binaryBuffer[0] === 0xfe &&
          binaryBuffer[1] === 0xed &&
          binaryBuffer[2] === 0xfa &&
          binaryBuffer[3] === 0xce) ||
        (binaryBuffer[0] === 0xca &&
          binaryBuffer[1] === 0xfe &&
          binaryBuffer[2] === 0xba &&
          binaryBuffer[3] === 0xbe) ||
        (binaryBuffer[0] === 0xbe && binaryBuffer[1] === 0xba && binaryBuffer[2] === 0xfe && binaryBuffer[3] === 0xca))
    ) {
      // Mach-O Dynamic Library (.dylib) or Universal Fat Binary
      this.format = "macho";
      const machoLoader = new MachoLoader(binaryBuffer);
      this.loader = machoLoader;
      this.memory = machoLoader.mapImageToMemory(options.preferredBase);
      this.cruntime = new CRuntimeManager(this.memory);

      if (machoLoader.header.cputype === CPU_TYPE_ARM64) {
        this.cpu = new AArch64Cpu(this.memory, this.cruntime);
      } else {
        // macOS x86_64 uses System V AMD64 ABI
        this.cpu = new X86Cpu(this.memory, machoLoader.header.is64Bit, this.cruntime, "systemv");
      }
      this.hookMachoImports();

      // Extract exported symbol addresses
      for (const [name, sym] of machoLoader.symbols) {
        this.exportAddresses.set(name, machoLoader.resolveSymbolAddress(sym));
      }

      // Execute static constructors (__mod_init_func)
      if (machoLoader.initFuncAddresses.length > 0) {
        this.cpu.executeStaticConstructors(machoLoader.initFuncAddresses);
      }
    } else {
      throw new Error(
        "Unsupported binary format: expected Windows PE DLL ('MZ'), Linux ELF ('\\x7FELF'), or macOS Mach-O ('\\xCF\\xFA\\xED\\xFE' / '\\xCA\\xFE\\xBA\\xBE')",
      );
    }

    // Index variables
    if (options.variables) {
      for (const v of options.variables) {
        this.varMap.set(v.name, v.valueReference);
        this.vrToName.set(v.valueReference, v.name);
        if (v.start !== undefined) {
          this.shadowVars.set(v.valueReference, v.start);
        }
        if (v.causality === "output") {
          this.outputVrs.push(v.valueReference);
        } else if (v.causality === "input") {
          this.inputVrs.push(v.valueReference);
        }
      }
    }
  }

  private hookPeImports(peLoader: PeLoader): void {
    const hookMap = new Map<string, bigint>();
    for (const [funcName] of this.cruntime.handlers) {
      const hookAddr = this.cpu.registerHostHook(funcName);
      hookMap.set(funcName, hookAddr);
    }
    for (const imp of peLoader.imports) {
      let hookAddr = hookMap.get(imp.functionName);
      if (!hookAddr) {
        hookAddr = this.cpu.registerHostHook(imp.functionName);
        hookMap.set(imp.functionName, hookAddr);
      }
      const targetOff = imp.iatRva;
      if (targetOff >= 0 && targetOff + (peLoader.header.is64Bit ? 8 : 4) <= this.memory.size) {
        if (peLoader.header.is64Bit) {
          this.memory.dataView.setBigUint64(targetOff, hookAddr, true);
        } else {
          this.memory.dataView.setUint32(targetOff, Number(hookAddr & 0xffffffffn), true);
        }
      }
    }
  }

  private hookElfRelocations(elfLoader: ElfLoader): void {
    const hookMap = new Map<string, bigint>();
    for (const [funcName] of this.cruntime.handlers) {
      const hookAddr = this.cpu.registerHostHook(funcName);
      hookMap.set(funcName, hookAddr);
    }
    elfLoader.applyDynamicRelocations((name) => {
      let hookAddr = hookMap.get(name);
      if (!hookAddr && this.cruntime.handlers.has(name)) {
        hookAddr = this.cpu.registerHostHook(name);
        hookMap.set(name, hookAddr);
      }
      return hookAddr ?? null;
    });
  }

  private hookMachoImports(): void {
    for (const [funcName] of this.cruntime.handlers) {
      this.cpu.registerHostHook(funcName);
    }
  }

  getExportAddr(name: string): bigint | undefined {
    return (
      this.exportAddresses.get(name) ??
      this.exportAddresses.get(`_${name}`) ??
      this.exportAddresses.get(name.replace("fmi2", "fmi3"))
    );
  }

  init(startTime = 0.0): void {
    this.currentTime = startTime;

    // Allocate instance name and GUID in guest memory
    const instName = this.options.modelName || "UniversalModelInstance";
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

    // 1. Call fmi2Instantiate
    const instantiateAddr = this.getExportAddr("fmi2Instantiate") ?? this.getExportAddr("fmi3InstantiateCoSimulation");

    if (instantiateAddr) {
      this.instancePtr = this.cpu.callFunction(instantiateAddr, [
        instNamePtr, // instanceName
        1n, // fmuType (1 = fmi2CoSimulation)
        guidPtr, // fmuGUID
        0n, // fmuResourceLocation
        0n, // callbacks
        0n, // visible
        0n, // loggingOn
      ]);
      if (this.instancePtr === 0n) {
        this.instancePtr = this.cruntime.malloc(1024);
      }
    } else {
      this.instancePtr = this.cruntime.malloc(1024);
    }

    // 2. Call fmi2SetupExperiment if exported
    const setupAddr = this.getExportAddr("fmi2SetupExperiment");
    if (setupAddr) {
      this.cpu.callFunction(setupAddr, [this.instancePtr, 0n, 0n], [startTime, 100.0, 0.0]);
    }

    // 3. Call fmi2EnterInitializationMode & fmi2ExitInitializationMode
    const enterInit = this.getExportAddr("fmi2EnterInitializationMode");
    if (enterInit) {
      this.cpu.callFunction(enterInit, [this.instancePtr]);
    }

    // Set initial variable values
    if (this.options.variables) {
      for (const v of this.options.variables) {
        if (v.start !== undefined) {
          this.setVar(v.valueReference, v.start);
        }
      }
    }

    const exitInit = this.getExportAddr("fmi2ExitInitializationMode");
    if (exitInit) {
      this.cpu.callFunction(exitInit, [this.instancePtr]);
    }
  }

  setVar(nameOrVr: string | number, value: number): void {
    const vr = typeof nameOrVr === "number" ? nameOrVr : (this.varMap.get(nameOrVr) ?? 0);
    this.shadowVars.set(vr, value);
    const setRealAddr = this.getExportAddr("fmi2SetReal") ?? this.getExportAddr("fmi3SetFloat64");

    if (setRealAddr) {
      const vrPtr = this.cruntime.malloc(8);
      const valPtr = this.cruntime.malloc(8);

      const vrOff = Number(vrPtr - this.memory.baseAddress);
      const valOff = Number(valPtr - this.memory.baseAddress);

      this.memory.dataView.setUint32(vrOff, vr, true);
      this.memory.dataView.setFloat64(valOff, value, true);

      // fmi2SetReal(c, const fmi2ValueReference vr[], size_t nvr, const fmi2Real value[])
      this.cpu.callFunction(setRealAddr, [this.instancePtr, vrPtr, 1n, valPtr]);
    }
  }

  getVar(nameOrVr: string | number): number {
    const vr = typeof nameOrVr === "number" ? nameOrVr : (this.varMap.get(nameOrVr) ?? 0);
    const getRealAddr = this.getExportAddr("fmi2GetReal") ?? this.getExportAddr("fmi3GetFloat64");

    if (getRealAddr) {
      const vrPtr = this.cruntime.malloc(8);
      const valPtr = this.cruntime.malloc(8);

      const vrOff = Number(vrPtr - this.memory.baseAddress);
      const valOff = Number(valPtr - this.memory.baseAddress);

      this.memory.dataView.setUint32(vrOff, vr, true);
      this.memory.dataView.setFloat64(valOff, 0.0, true);

      // fmi2GetReal(c, const fmi2ValueReference vr[], size_t nvr, fmi2Real value[])
      this.cpu.callFunction(getRealAddr, [this.instancePtr, vrPtr, 1n, valPtr]);

      const val = this.memory.dataView.getFloat64(valOff, true);
      this.shadowVars.set(vr, val);
      return val;
    }

    return this.shadowVars.get(vr) ?? 0.0;
  }

  step(currentTime: number, dt: number, inputs?: Record<string, number>): Record<string, number> {
    this.currentTime = Math.round((currentTime + dt) * 1e9) / 1e9;

    // Apply input values
    if (inputs) {
      for (const [name, val] of Object.entries(inputs)) {
        this.setVar(name, val);
      }
    }

    // Call fmi2DoStep
    const doStepAddr = this.getExportAddr("fmi2DoStep") ?? this.getExportAddr("fmi3DoStep");

    if (doStepAddr) {
      if (this.cpu.abi === "win64") {
        this.cpu.callFunction(doStepAddr, [this.instancePtr, 1n], [0.0, currentTime, dt]);
      } else {
        // System V AMD64 and AAPCS64 ARM64 both pass:
        // arg0 = instancePtr, arg1 = noSetFMUState (1n)
        // float0 = currentTime, float1 = dt
        this.cpu.callFunction(doStepAddr, [this.instancePtr, 1n], [currentTime, dt]);
      }
    }

    // Collect outputs
    const results: Record<string, number> = {};
    if (this.outputVrs.length > 0) {
      for (const vr of this.outputVrs) {
        const name = this.vrToName.get(vr) || `var_${vr}`;
        results[name] = this.getVar(vr);
      }
    } else {
      for (const [name, vr] of this.varMap) {
        results[name] = this.getVar(vr);
      }
    }

    return results;
  }

  /**
   * Executes a high-throughput batch simulation across a time horizon in a tight loop.
   * Eliminates per-step JavaScript-to-guest context-switching and returns contiguous TypedArrays.
   */
  stepBatch(options: BatchSimulationOptions = {}): BatchSimulationResult {
    const tStart = performance.now();
    const startTime = options.startTime ?? this.currentTime;
    const dt = options.stepSize ?? 0.01;
    const decimation = Math.max(1, options.sampleDecimation ?? 1);

    const hasStepsCount = options.stepsCount !== undefined;
    const totalSteps = hasStepsCount
      ? Math.max(1, options.stepsCount!)
      : Math.max(1, Math.round(((options.stopTime ?? startTime + 1.0) - startTime) / dt));

    const includeInitial = options.includeInitial ?? !hasStepsCount;

    // Determine output variables to record
    let vrsToRecord: number[] = [];
    let namesToRecord: string[] = [];
    if (options.outputValueReferences && options.outputValueReferences.length > 0) {
      vrsToRecord = options.outputValueReferences;
      namesToRecord = vrsToRecord.map((vr) => this.vrToName.get(vr) || `var_${vr}`);
    } else if (this.outputVrs.length > 0) {
      vrsToRecord = this.outputVrs;
      namesToRecord = vrsToRecord.map((vr) => this.vrToName.get(vr) || `var_${vr}`);
    } else {
      for (const [name, vr] of this.varMap) {
        namesToRecord.push(name);
        vrsToRecord.push(vr);
      }
    }

    const nOutputs = vrsToRecord.length;
    const maxFrames = Math.floor(totalSteps / decimation) + (includeInitial ? 2 : 1);

    const timeBuffer = new Float64Array(maxFrames);
    const outputMatrix = new Float64Array(maxFrames * nOutputs);

    const doStepAddr = this.getExportAddr("fmi2DoStep") ?? this.getExportAddr("fmi3DoStep");
    const getRealAddr = this.getExportAddr("fmi2GetReal") ?? this.getExportAddr("fmi3GetFloat64");

    // Pre-allocate guest buffers once for batch queries
    let vrBufPtr = 0n;
    let valBufPtr = 0n;
    let vrBufOff = 0;
    let valBufOff = 0;

    if (nOutputs > 0 && getRealAddr) {
      vrBufPtr = this.cruntime.malloc(nOutputs * 4);
      valBufPtr = this.cruntime.malloc(nOutputs * 8);
      vrBufOff = Number(vrBufPtr - this.memory.baseAddress);
      valBufOff = Number(valBufPtr - this.memory.baseAddress);

      for (let i = 0; i < nOutputs; i++) {
        this.memory.dataView.setUint32(vrBufOff + i * 4, vrsToRecord[i]!, true);
      }
    }

    let frameCount = 0;
    let curTime = startTime;

    // Record initial point at startTime if requested
    if (includeInitial) {
      timeBuffer[frameCount] = curTime;
      if (nOutputs > 0) {
        if (getRealAddr) {
          if ((this.cpu as any).callGetRealFast) {
            (this.cpu as any).callGetRealFast(getRealAddr, this.instancePtr, vrBufPtr, BigInt(nOutputs), valBufPtr);
          } else {
            this.cpu.callFunction(getRealAddr, [this.instancePtr, vrBufPtr, BigInt(nOutputs), valBufPtr]);
          }
          for (let i = 0; i < nOutputs; i++) {
            outputMatrix[frameCount * nOutputs + i] = this.memory.dataView.getFloat64(valBufOff + i * 8, true);
          }
        } else {
          for (let i = 0; i < nOutputs; i++) {
            outputMatrix[frameCount * nOutputs + i] = this.shadowVars.get(vrsToRecord[i]!) ?? 0.0;
          }
        }
      }
      frameCount++;
    }

    try {
      for (let s = 1; s <= totalSteps; s++) {
        // 1. Apply inputs if scheduled
        if (options.inputs) {
          for (const [name, valOrFn] of Object.entries(options.inputs)) {
            const v = typeof valOrFn === "function" ? valOrFn(curTime) : valOrFn;
            this.setVar(name, v);
          }
        }

        // 2. DoStep
        if (doStepAddr) {
          if ((this.cpu as any).callDoStepFast) {
            (this.cpu as any).callDoStepFast(doStepAddr, this.instancePtr, curTime, dt);
          } else {
            if (this.cpu.abi === "win64") {
              this.cpu.callFunction(doStepAddr, [this.instancePtr, 1n], [0.0, curTime, dt]);
            } else {
              this.cpu.callFunction(doStepAddr, [this.instancePtr, 1n], [curTime, dt]);
            }
          }
        }

        curTime = Math.round((startTime + s * dt) * 1e9) / 1e9;
        this.currentTime = curTime;

        // 3. Record sample if decimation hits
        if (s % decimation === 0 && frameCount < maxFrames) {
          timeBuffer[frameCount] = curTime;
          if (nOutputs > 0) {
            if (getRealAddr) {
              if ((this.cpu as any).callGetRealFast) {
                (this.cpu as any).callGetRealFast(getRealAddr, this.instancePtr, vrBufPtr, BigInt(nOutputs), valBufPtr);
              } else {
                this.cpu.callFunction(getRealAddr, [this.instancePtr, vrBufPtr, BigInt(nOutputs), valBufPtr]);
              }
              for (let i = 0; i < nOutputs; i++) {
                outputMatrix[frameCount * nOutputs + i] = this.memory.dataView.getFloat64(valBufOff + i * 8, true);
              }
            } else {
              for (let i = 0; i < nOutputs; i++) {
                outputMatrix[frameCount * nOutputs + i] = this.shadowVars.get(vrsToRecord[i]!) ?? 0.0;
              }
            }
          }
          frameCount++;
        }
      }
    } finally {
      // Free temporary guest scratch buffers
      if (vrBufPtr !== 0n) this.cruntime.free(vrBufPtr);
      if (valBufPtr !== 0n) this.cruntime.free(valBufPtr);
    }

    // Shrink typed arrays to actual frames recorded
    const finalTimes = timeBuffer.subarray(0, frameCount);
    const finalMatrix = outputMatrix.subarray(0, frameCount * nOutputs);

    // Build column-wise map for convenient variable access
    const outputMap = new Map<string, Float64Array>();
    for (let i = 0; i < nOutputs; i++) {
      const col = new Float64Array(frameCount);
      for (let f = 0; f < frameCount; f++) {
        col[f] = finalMatrix[f * nOutputs + i]!;
      }
      outputMap.set(namesToRecord[i]!, col);
    }

    const executionTimeMs = performance.now() - tStart;

    return {
      timeSteps: frameCount,
      finalTime: curTime,
      timeBuffer: finalTimes,
      outputMatrix: finalMatrix,
      outputMap,
      executionTimeMs,
    };
  }

  getTime(): number {
    return this.currentTime;
  }

  terminate(): void {
    const terminateAddr = this.getExportAddr("fmi2Terminate");
    if (terminateAddr && this.instancePtr !== 0n) {
      this.cpu.callFunction(terminateAddr, [this.instancePtr]);
    }

    const freeAddr = this.getExportAddr("fmi2FreeInstance");
    if (freeAddr && this.instancePtr !== 0n) {
      this.cpu.callFunction(freeAddr, [this.instancePtr]);
    }

    // Static Destructors (.fini_array)
    if (this.loader instanceof ElfLoader && this.loader.finiArrayRvas.length > 0) {
      const addrs = this.loader.finiArrayRvas.map((rva) => this.memory.baseAddress + rva);
      this.cpu.executeStaticConstructors(addrs);
    }

    // Windows DllMain(hModule, DLL_PROCESS_DETACH, NULL)
    if (this.loader instanceof PeLoader && this.loader.header.entryPointRva > 0) {
      const dllMainAddr = this.memory.baseAddress + BigInt(this.loader.header.entryPointRva);
      this.cpu.callFunction(dllMainAddr, [this.memory.baseAddress, 0n, 0n]);
    }
  }
}

/**
 * Creates an in-browser universal binary runner for executing Windows PE DLL
 * or Linux ELF .so FMUs without host binaries.
 */
export function createUniversalFmuRunner(
  binaryBuffer: Uint8Array,
  options?: UniversalFmuRunnerOptions,
): UniversalBinaryRunner {
  const runner = new UniversalBinaryRunner(binaryBuffer, options);
  runner.init(0.0);
  return runner;
}
