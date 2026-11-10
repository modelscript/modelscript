// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/pscad — EMTDC Fortran/C Binary ABI Host Bridge & `mhi.pscad` Automation Layer
 *
 * Implements:
 * 1. The standard Manitoba Hydro International EMTDC `/EMTDC_S1/`, `/ND2/`, and `/S0/`
 *    COMMON block memory layout (`STORF`, `STORI`, `STORL`, `STORC`, `NSTORF`, `NSTORI`,
 *    `NSTORL`, `NSTORC`, `TIME`, `DELT`, `TIMEZERO`, `FIRSTSTEP`, `LASTSTEP`) so compiled
 *    vendor Fortran `.obj`/`.dll`/`.so`/WASM user-defined models (UDMs) and `#SUBROUTINE`
 *    callbacks can execute seamlessly across `DSDYN` (pre-network) and `DSOUT` (post-network)
 *    lifecycle hooks.
 * 2. An FMI 3.0 Co-Simulation C wrapper generator (`generateEmtdcFmi3WrapperC`) that wraps
 *    existing EMTDC Fortran/C subroutines into standard FMI 3.0 binaries.
 * 3. A programmatic `mhi.pscad` compatibility API (`MhiPscadApplication`, `MhiPscadProject`,
 *    `MhiPscadCanvas`) mirroring the commercial `mhi.pscad` Python automation interface.
 */

import {
  AArch64Cpu,
  CPU_TYPE_ARM64,
  CRuntimeManager,
  type DrmAccessEvent,
  type DrmLicenseOptions,
  ElfLoader,
  type GuestMemorySpace,
  MachoLoader,
  PeLoader,
  registerDrmShims,
  X86Cpu,
} from "@modelscript/exchange";
import { extractEmtNetlist } from "../netlist/emt-netlist.js";
import { parsePscx } from "../parser/pscx-parser.js";
import { EmtSolver, type EmtSolverResult } from "../solver/emt-solver.js";
import type { EmtCustomFortranBlock, PscxComponent, PscxProject } from "../types.js";

/**
 * Standard EMTDC Fortran COMMON block state layout (`/S0/`, `/S1/`, `/ND2/`).
 * Note: In Fortran EMTDC, `STORF(NSTORF)` is 1-indexed; we allocate index 0 as padding
 * so both 1-indexed Fortran offsets (`NSTORF` starting at 1) and 0-indexed C offsets work safely.
 */
export interface EmtdcCommonBlockState {
  /** Real storage array `REAL*8 STORF(:)` (1-indexed starting at NSTORF = 1). */
  STORF: Float64Array;
  /** Integer storage array `INTEGER*4 STORI(:)` (1-indexed starting at NSTORI = 1). */
  STORI: Int32Array;
  /** Logical storage array `LOGICAL*4 STORL(:)` (0 = .FALSE., 1 = .TRUE.). */
  STORL: Uint8Array;
  /** Complex storage array interleaved `[re, im, ...]` `COMPLEX*16 STORC(:)`. */
  STORC: Float64Array;
  /** Current pointer into `STORF` (incremented by each UDM during `DSDYN`/`DSOUT`). */
  NSTORF: number;
  /** Current pointer into `STORI`. */
  NSTORI: number;
  /** Current pointer into `STORL`. */
  NSTORL: number;
  /** Current pointer into `STORC`. */
  NSTORC: number;
  /** Current simulation time in seconds (`REAL*8 TIME`). */
  TIME: number;
  /** Simulation time step in seconds (`REAL*8 DELT`). */
  DELT: number;
  /** True (`1`) at `t == 0.0` initialization step (`LOGICAL TIMEZERO`). */
  TIMEZERO: boolean;
  /** True (`1`) on the very first time step (`LOGICAL FIRSTSTEP`). */
  FIRSTSTEP: boolean;
  /** True (`1`) on the final time step (`LOGICAL LASTSTEP`). */
  LASTSTEP: boolean;
  /** Subsystem electrical node voltages `VDC(node, subsystem)`. */
  VDC: Float64Array;
  /** Branch currents `CBR(branch, subsystem)`. */
  CBR: Float64Array;
  /** Companion current source injections `CCIN(node, subsystem)`. */
  CCIN: Float64Array;
  /** Companion equivalent shunt conductances `GGIN(node, subsystem)`. */
  GGIN: Float64Array;
}

export type EmtdcSubroutineCallback = (state: EmtdcCommonBlockState, ports: Record<string, number>) => void;

export interface EmtdcRegisteredUdm {
  id: string;
  subroutineName: string;
  numRealStates: number;
  numIntStates: number;
  numLogicalStates: number;
  storfBaseOffset: number;
  storiBaseOffset: number;
  storlBaseOffset: number;
  ports: Record<string, number>;
  dsdyn?: EmtdcSubroutineCallback | undefined;
  dsout?: EmtdcSubroutineCallback | undefined;
}

export interface EmtdcHostBridgeOptions {
  maxRealStorage?: number | undefined;
  maxIntStorage?: number | undefined;
  maxLogicalStorage?: number | undefined;
  maxComplexStorage?: number | undefined;
  maxNodes?: number | undefined;
  maxBranches?: number | undefined;
  timeStepSec?: number | undefined;
}

/**
 * Host runtime managing EMTDC `STORF`/`STORI`/`STORL` state pointers and invoking
 * registered `DSDYN` and `DSOUT` user-defined model (UDM) subroutines every EMT step.
 */
export class EmtdcHostBridge {
  public readonly state: EmtdcCommonBlockState;
  private readonly udms: EmtdcRegisteredUdm[] = [];
  private totalRealAllocated = 1; // 1-based Fortran indexing
  private totalIntAllocated = 1;
  private totalLogicalAllocated = 1;

  constructor(options?: EmtdcHostBridgeOptions) {
    const maxR = options?.maxRealStorage ?? 16384;
    const maxI = options?.maxIntStorage ?? 8192;
    const maxL = options?.maxLogicalStorage ?? 4096;
    const maxC = options?.maxComplexStorage ?? 2048;
    const maxNodes = options?.maxNodes ?? 1024;
    const maxBranches = options?.maxBranches ?? 2048;

    this.state = {
      STORF: new Float64Array(maxR + 1),
      STORI: new Int32Array(maxI + 1),
      STORL: new Uint8Array(maxL + 1),
      STORC: new Float64Array(2 * (maxC + 1)),
      NSTORF: 1,
      NSTORI: 1,
      NSTORL: 1,
      NSTORC: 1,
      TIME: 0.0,
      DELT: options?.timeStepSec ?? 50e-6,
      TIMEZERO: true,
      FIRSTSTEP: true,
      LASTSTEP: false,
      VDC: new Float64Array(maxNodes + 1),
      CBR: new Float64Array(maxBranches + 1),
      CCIN: new Float64Array(maxNodes + 1),
      GGIN: new Float64Array(maxNodes + 1),
    };
  }

  /**
   * Registers an external C/Fortran/WASM UDM or compiled `#DSDYN`/`#DSOUT` block
   * and reserves its contiguous slice in `STORF`, `STORI`, and `STORL`.
   */
  public registerUdm(config: {
    id: string;
    subroutineName: string;
    numRealStates?: number | undefined;
    numIntStates?: number | undefined;
    numLogicalStates?: number | undefined;
    initialPorts?: Record<string, number> | undefined;
    dsdyn?: EmtdcSubroutineCallback | undefined;
    dsout?: EmtdcSubroutineCallback | undefined;
  }): EmtdcRegisteredUdm {
    const nR = Math.max(0, config.numRealStates ?? 16);
    const nI = Math.max(0, config.numIntStates ?? 8);
    const nL = Math.max(0, config.numLogicalStates ?? 4);

    const udm: EmtdcRegisteredUdm = {
      id: config.id,
      subroutineName: config.subroutineName,
      numRealStates: nR,
      numIntStates: nI,
      numLogicalStates: nL,
      storfBaseOffset: this.totalRealAllocated,
      storiBaseOffset: this.totalIntAllocated,
      storlBaseOffset: this.totalLogicalAllocated,
      ports: { ...(config.initialPorts ?? {}) },
      dsdyn: config.dsdyn,
      dsout: config.dsout,
    };

    this.totalRealAllocated += nR;
    this.totalIntAllocated += nI;
    this.totalLogicalAllocated += nL;
    this.udms.push(udm);
    return udm;
  }

  /**
   * Wraps an `EmtCustomFortranBlock` compiled by `@modelscript/pscad` into the EMTDC ABI bridge.
   */
  public registerCustomFortranBlock(block: EmtCustomFortranBlock): EmtdcRegisteredUdm {
    return this.registerUdm({
      id: block.id,
      subroutineName: block.name,
      numRealStates: Math.max(16, block.numRealStates),
      numIntStates: Math.max(8, block.numIntStates),
      dsdyn: (state, ports) => {
        block.step?.({
          inputs: ports,
          outputs: ports,
          storf: state.STORF,
          stori: state.STORI,
          time: state.TIME,
          dt: state.DELT,
          firstStep: state.FIRSTSTEP,
        });
      },
    });
  }

  /**
   * Executes the pre-network `DSDYN` phase across all registered UDMs, resetting
   * `NSTORF`, `NSTORI`, and `NSTORL` to each UDM's base offset prior to invocation
   * exactly as EMTDC's main `DSDYN` subroutine does.
   */
  public stepDsdyn(timeSec: number, isFirstStep = false, isLastStep = false): void {
    this.state.TIME = timeSec;
    this.state.TIMEZERO = timeSec === 0.0;
    this.state.FIRSTSTEP = isFirstStep;
    this.state.LASTSTEP = isLastStep;

    for (const udm of this.udms) {
      this.state.NSTORF = udm.storfBaseOffset;
      this.state.NSTORI = udm.storiBaseOffset;
      this.state.NSTORL = udm.storlBaseOffset;
      if (udm.dsdyn) {
        udm.dsdyn(this.state, udm.ports);
      }
    }
  }

  /**
   * Executes the post-network `DSOUT` phase across all registered UDMs after the
   * nodal conductance solver updates `VDC` and `CBR`.
   */
  public stepDsout(): void {
    for (const udm of this.udms) {
      this.state.NSTORF = udm.storfBaseOffset;
      this.state.NSTORI = udm.storiBaseOffset;
      this.state.NSTORL = udm.storlBaseOffset;
      if (udm.dsout) {
        udm.dsout(this.state, udm.ports);
      }
    }
  }

  /**
   * Loads a compiled vendor Windows PE `.dll`, Linux ELF `.so`, or macOS Mach-O `.dylib`
   * directly into the Wasm-Machina x86_64/ARM64 binary emulator and registers its
   * `DSDYN` and `DSOUT` subroutines into the EMTDC `STORF`/`STORI` host bridge.
   */
  public registerBinaryDll(config: {
    id: string;
    binaryBuffer: Uint8Array;
    dsdynSymbol?: string | undefined;
    dsoutSymbol?: string | undefined;
    portNames?: string[] | undefined;
    initialPorts?: Record<string, number> | undefined;
    numRealStates?: number | undefined;
    numIntStates?: number | undefined;
    drmOptions?: DrmLicenseOptions | undefined;
  }): { udm: EmtdcRegisteredUdm; runner: EmtdcWasmMachinaDllRunner } {
    const runner = new EmtdcWasmMachinaDllRunner(config.binaryBuffer, {
      drmOptions: config.drmOptions,
    });
    const portNames = config.portNames ?? (config.initialPorts ? Object.keys(config.initialPorts) : ["in0", "out0"]);
    const initialPorts: Record<string, number> = {};
    for (const p of portNames) {
      initialPorts[p] = config.initialPorts?.[p] ?? 0.0;
    }

    const nR = config.numRealStates ?? 16;
    const nI = config.numIntStates ?? 8;
    const dsdynSym = config.dsdynSymbol ?? config.id;
    const dsoutSym = config.dsoutSymbol;

    const udm = this.registerUdm({
      id: config.id,
      subroutineName: dsdynSym,
      numRealStates: nR,
      numIntStates: nI,
      initialPorts,
      dsdyn: (state, ports) => {
        const vals = portNames.map((p) => ports[p] ?? 0.0);
        const updated = runner.invokeSubroutine(dsdynSym, state, vals, nR, nI);
        for (let i = 0; i < portNames.length; i++) {
          ports[portNames[i]!] = updated[i]!;
        }
      },
      dsout: dsoutSym
        ? (state, ports) => {
            const vals = portNames.map((p) => ports[p] ?? 0.0);
            const updated = runner.invokeSubroutine(dsoutSym, state, vals, nR, nI);
            for (let i = 0; i < portNames.length; i++) {
              ports[portNames[i]!] = updated[i]!;
            }
          }
        : undefined,
    });

    return { udm, runner };
  }

  public getRegisteredUdms(): readonly EmtdcRegisteredUdm[] {
    return this.udms;
  }
}

/**
 * In-Browser / Node Wasm-Machina Binary Emulator for compiled EMTDC vendor `.dll`, `.so`,
 * and `.dylib` user-defined models (UDMs) and HVDC vendor black-box controllers.
 *
 * Maps Windows PE32+ (`MZ`), Linux ELF64 (`\x7FELF`), or macOS Mach-O binaries into an
 * isolated `GuestMemorySpace`, binds EMTDC `STORF`/`STORI` host intrinsics, and invokes
 * exported Fortran/C subroutines using Microsoft x64, System V AMD64, or AAPCS64 ABIs.
 */
export class EmtdcWasmMachinaDllRunner {
  public readonly format: "pe" | "elf" | "macho";
  public readonly loader: PeLoader | ElfLoader | MachoLoader;
  public readonly memory: GuestMemorySpace;
  public readonly cruntime: CRuntimeManager;
  public readonly cpu: X86Cpu | AArch64Cpu;
  public readonly messages: string[] = [];
  public hasLicenseFailure = false;
  public dllMainFailed = false;
  public readonly drmEvents: DrmAccessEvent[] = [];

  private readonly exportAddresses = new Map<string, bigint>();
  private readonly storfGuestPtr: bigint;
  private readonly storiGuestPtr: bigint;
  private readonly portsGuestPtr: bigint;
  private activeState: EmtdcCommonBlockState | null = null;

  constructor(
    binaryBuffer: Uint8Array,
    options?: {
      preferredBase?: bigint | undefined;
      drmOptions?: DrmLicenseOptions | undefined;
    },
  ) {
    const initDrm = (cruntime: CRuntimeManager) => {
      if (options?.drmOptions) {
        const drmOpts: DrmLicenseOptions = {
          ...options.drmOptions,
          onLicenseAccess: (evt) => {
            this.drmEvents.push(evt);
            if (evt.status === "denied") {
              this.hasLicenseFailure = true;
            }
            options?.drmOptions?.onLicenseAccess?.(evt);
          },
        };
        registerDrmShims(cruntime, drmOpts);
      }
    };

    if (binaryBuffer.length >= 2 && binaryBuffer[0] === 0x4d && binaryBuffer[1] === 0x5a) {
      this.format = "pe";
      const peLoader = new PeLoader(binaryBuffer);
      this.loader = peLoader;
      this.memory = peLoader.mapImageToMemory(options?.preferredBase);
      this.cruntime = new CRuntimeManager(this.memory);
      initDrm(this.cruntime);
      this.registerEmtdcHostShims();
      this.cpu = new X86Cpu(this.memory, peLoader.header.is64Bit, this.cruntime, "win64");
      this.hookPeImports(peLoader);
      for (const [name, sym] of peLoader.exports) {
        this.exportAddresses.set(name, this.memory.baseAddress + BigInt(sym.rva));
      }
      if (peLoader.header.entryPointRva > 0) {
        const dllMainAddr = this.memory.baseAddress + BigInt(peLoader.header.entryPointRva);
        const res = this.cpu.callFunction(dllMainAddr, [this.memory.baseAddress, 1n, 0n]);
        if (res === 0n) {
          this.dllMainFailed = true;
        }
      }
    } else if (
      binaryBuffer.length >= 4 &&
      binaryBuffer[0] === 0x7f &&
      binaryBuffer[1] === 0x45 &&
      binaryBuffer[2] === 0x4c &&
      binaryBuffer[3] === 0x46
    ) {
      this.format = "elf";
      const elfLoader = new ElfLoader(binaryBuffer);
      this.loader = elfLoader;
      this.memory = elfLoader.mapImageToMemory(options?.preferredBase);
      this.cruntime = new CRuntimeManager(this.memory);
      initDrm(this.cruntime);
      this.registerEmtdcHostShims();
      if (elfLoader.header.machine === 0xb7) {
        this.cpu = new AArch64Cpu(this.memory, this.cruntime);
      } else {
        this.cpu = new X86Cpu(this.memory, elfLoader.header.is64Bit, this.cruntime, "systemv");
      }
      this.hookElfRelocations(elfLoader);
      for (const [name, sym] of elfLoader.symbols) {
        this.exportAddresses.set(name, this.memory.baseAddress + sym.value);
      }
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
        (binaryBuffer[0] === 0xca && binaryBuffer[1] === 0xfe && binaryBuffer[2] === 0xba && binaryBuffer[3] === 0xbe))
    ) {
      this.format = "macho";
      const machoLoader = new MachoLoader(binaryBuffer);
      this.loader = machoLoader;
      this.memory = machoLoader.mapImageToMemory(options?.preferredBase);
      this.cruntime = new CRuntimeManager(this.memory);
      initDrm(this.cruntime);
      this.registerEmtdcHostShims();
      if (machoLoader.header.cputype === CPU_TYPE_ARM64) {
        this.cpu = new AArch64Cpu(this.memory, this.cruntime);
      } else {
        this.cpu = new X86Cpu(this.memory, machoLoader.header.is64Bit, this.cruntime, "systemv");
      }
      for (const [funcName] of this.cruntime.handlers) {
        this.cpu.registerHostHook(funcName);
      }
      for (const [name, sym] of machoLoader.symbols) {
        this.exportAddresses.set(name, machoLoader.resolveSymbolAddress(sym));
      }
      if (machoLoader.initFuncAddresses.length > 0) {
        this.cpu.executeStaticConstructors(machoLoader.initFuncAddresses);
      }
    } else {
      throw new Error(
        "Unsupported EMTDC binary UDM format: expected Windows PE DLL ('MZ'), Linux ELF ('.so'), or macOS Mach-O ('.dylib').",
      );
    }

    // Allocate persistent guest marshaling buffers for STORF, STORI, and pass-by-ref ports
    this.storfGuestPtr = this.cruntime.malloc(1024 * 8);
    this.storiGuestPtr = this.cruntime.malloc(512 * 4);
    this.portsGuestPtr = this.cruntime.malloc(64 * 8);
  }

  private registerEmtdcHostShims(): void {
    const getStorf = (ctx: { cpu: { getArg(i: number): bigint; setReturnFloat(v: number): void } }) => {
      const idx = Number(ctx.cpu.getArg(0));
      const val =
        this.activeState && idx >= 0 && idx < this.activeState.STORF.length ? this.activeState.STORF[idx]! : 0.0;
      ctx.cpu.setReturnFloat(val);
    };
    const setStorf = (ctx: {
      cpu: { getArg(i: number): bigint; getFloatArg(i: number): number; setReturnInt(v: number): void };
    }) => {
      const idx = Number(ctx.cpu.getArg(0));
      const val = ctx.cpu.getFloatArg(1);
      if (this.activeState && idx >= 0 && idx < this.activeState.STORF.length) {
        this.activeState.STORF[idx] = val;
      }
      ctx.cpu.setReturnInt(0);
    };
    const emtdcMesg = (ctx: {
      cpu: { getArg(i: number): bigint; readString(p: bigint): string; setReturnInt(v: number): void };
    }) => {
      const ptr = ctx.cpu.getArg(0);
      if (ptr !== 0n) {
        this.messages.push(ctx.cpu.readString(ptr));
      }
      ctx.cpu.setReturnInt(0);
    };

    for (const name of ["get_storf_", "GET_STORF", "get_storf"]) {
      this.cruntime.handlers.set(name, getStorf);
    }
    for (const name of ["set_storf_", "SET_STORF", "set_storf"]) {
      this.cruntime.handlers.set(name, setStorf);
    }
    for (const name of ["emtdc_mesg_", "EMTDC_MESG", "emtdc_mesg"]) {
      this.cruntime.handlers.set(name, emtdcMesg);
    }
  }

  private hookPeImports(peLoader: PeLoader): void {
    const hookMap = new Map<string, bigint>();
    for (const [funcName] of this.cruntime.handlers) {
      hookMap.set(funcName, this.cpu.registerHostHook(funcName));
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
      hookMap.set(funcName, this.cpu.registerHostHook(funcName));
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

  /** Resolves an exported Fortran/C subroutine address across standard mangling conventions. */
  public getExportAddr(symbolName: string): bigint | undefined {
    const lower = symbolName.toLowerCase();
    const upper = symbolName.toUpperCase();
    return (
      this.exportAddresses.get(symbolName) ??
      this.exportAddresses.get(`${lower}_`) ??
      this.exportAddresses.get(lower) ??
      this.exportAddresses.get(upper) ??
      this.exportAddresses.get(`_${symbolName}`) ??
      this.exportAddresses.get(`_${lower}_`)
    );
  }

  public getExportedSymbols(): string[] {
    return Array.from(this.exportAddresses.keys());
  }

  /**
   * Marshals `STORF`, `STORI`, and pass-by-reference `double*` port arguments into guest memory,
   * executes the compiled subroutine in Wasm-Machina, and copies updated states and ports back.
   */
  public invokeSubroutine(
    symbolName: string,
    state: EmtdcCommonBlockState,
    portValues: number[],
    numRealStates = 16,
    numIntStates = 8,
  ): number[] {
    const fnAddr = this.getExportAddr(symbolName);
    if (!fnAddr) {
      throw new Error(
        `EMTDC subroutine '${symbolName}' not found in binary exports: [${this.getExportedSymbols().join(", ")}]`,
      );
    }

    this.activeState = state;
    const storfOff = Number(this.storfGuestPtr - this.memory.baseAddress);
    const storiOff = Number(this.storiGuestPtr - this.memory.baseAddress);
    const portsOff = Number(this.portsGuestPtr - this.memory.baseAddress);

    const baseR = state.NSTORF;
    const baseI = state.NSTORI;
    const countR = Math.min(numRealStates, 1024, Math.max(0, state.STORF.length - baseR));
    const countI = Math.min(numIntStates, 512, Math.max(0, state.STORI.length - baseI));
    const countPorts = Math.min(portValues.length, 64);

    for (let i = 0; i < countR; i++) {
      this.memory.dataView.setFloat64(storfOff + i * 8, state.STORF[baseR + i]!, true);
    }
    for (let i = 0; i < countI; i++) {
      this.memory.dataView.setInt32(storiOff + i * 4, state.STORI[baseI + i]!, true);
    }

    const intArgs: bigint[] = [];
    for (let i = 0; i < countPorts; i++) {
      this.memory.dataView.setFloat64(portsOff + i * 8, portValues[i]!, true);
      intArgs.push(this.portsGuestPtr + BigInt(i * 8));
    }
    // Append pointers to guest STORF and STORI slices for C/Fortran subroutines that accept them directly
    intArgs.push(this.storfGuestPtr, this.storiGuestPtr);

    this.cpu.callFunction(fnAddr, intArgs, [state.TIME, state.DELT]);

    // Copy back modified STORF, STORI, and pass-by-reference port values
    for (let i = 0; i < countR; i++) {
      state.STORF[baseR + i] = this.memory.dataView.getFloat64(storfOff + i * 8, true);
    }
    for (let i = 0; i < countI; i++) {
      state.STORI[baseI + i] = this.memory.dataView.getInt32(storiOff + i * 4, true);
    }
    state.NSTORF = baseR + countR;
    state.NSTORI = baseI + countI;

    const updatedPorts = portValues.slice();
    for (let i = 0; i < countPorts; i++) {
      updatedPorts[i] = this.memory.dataView.getFloat64(portsOff + i * 8, true);
    }
    this.activeState = null;
    return updatedPorts;
  }
}

/**
 * Generates an FMI 3.0 Co-Simulation C wrapper source file that bridges a legacy
 * EMTDC Fortran subroutine (`SUBROUTINE <name>(...)`) and its `STORF`/`STORI`
 * COMMON blocks into a standard FMI 3.0 shared library.
 */
export function generateEmtdcFmi3WrapperC(options: {
  modelIdentifier: string;
  subroutineName: string;
  inputs: string[];
  outputs: string[];
  numStorf?: number | undefined;
  numStori?: number | undefined;
}): string {
  const nStorf = options.numStorf ?? 1024;
  const nStori = options.numStori ?? 512;
  const subLower = options.subroutineName.toLowerCase();
  const totalPorts = options.inputs.length + options.outputs.length;
  const argList = Array.from({ length: totalPorts }, (_, i) => `&inst->ports[${i}]`).join(", ");
  const protoArgs = Array.from({ length: totalPorts }, () => "double*").join(", ");

  return `/* Auto-generated FMI 3.0 Co-Simulation Wrapper for EMTDC Subroutine ${options.subroutineName} */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

/* EMTDC Fortran COMMON Block Declarations */
struct {
  double TIME;
  double DELT;
  int32_t ICH;
  int32_t PRINT;
  int32_t FSTP;
  int32_t TZERO;
} s0_;

struct {
  double STORF[${nStorf}];
  int32_t STORI[${nStori}];
  int32_t NSTORF;
  int32_t NSTORI;
} emtdc_s1_;

extern void ${subLower}_(${protoArgs});

typedef struct {
  double ports[${Math.max(1, totalPorts)}];
  double currentTime;
  int32_t firstStep;
} EmtdcFmi3Instance;

void* fmi3InstantiateCoSimulation(const char* instanceName, const char* instantiationToken) {
  (void)instanceName;
  (void)instantiationToken;
  EmtdcFmi3Instance* inst = (EmtdcFmi3Instance*)calloc(1, sizeof(EmtdcFmi3Instance));
  inst->firstStep = 1;
  memset(&s0_, 0, sizeof(s0_));
  memset(&emtdc_s1_, 0, sizeof(emtdc_s1_));
  return inst;
}

int fmi3DoStep(
  void* instance,
  double currentCommunicationPoint,
  double communicationStepSize
) {
  EmtdcFmi3Instance* inst = (EmtdcFmi3Instance*)instance;
  s0_.TIME = currentCommunicationPoint;
  s0_.DELT = communicationStepSize;
  s0_.TZERO = (currentCommunicationPoint == 0.0) ? 1 : 0;
  s0_.FSTP = inst->firstStep;
  emtdc_s1_.NSTORF = 1;
  emtdc_s1_.NSTORI = 1;
  ${totalPorts > 0 ? `${subLower}_(${argList});` : `${subLower}_();`}
  inst->currentTime = currentCommunicationPoint + communicationStepSize;
  inst->firstStep = 0;
  return 0; /* fmi3OK */
}

void fmi3FreeInstance(void* instance) {
  if (instance) free(instance);
}
`;
}

// ============================================================================
// MHI PSCAD Python Automation Compatibility Layer (`mhi.pscad`)
// ============================================================================

/**
 * Canvas automation wrapper mirroring `mhi.pscad.Canvas` for programmatic
 * component discovery and parameter modification.
 */
export class MhiPscadCanvas {
  constructor(
    private readonly project: PscxProject,
    private readonly namespace: string = "Main",
  ) {}

  /** Finds a component on the canvas by definition name or instance name (`canvas.component(id)`). */
  public component(idOrName: string): PscxComponent | undefined {
    const mod =
      this.namespace === "Main" || this.namespace === this.project.rootModule.name
        ? this.project.rootModule
        : (this.project.subModules.get(this.namespace) ?? this.project.rootModule);
    return mod.components.find(
      (c: PscxComponent) =>
        c.id === idOrName || c.instanceName === idOrName || c.definitionName.endsWith(`:${idOrName}`),
    );
  }

  /** Lists all components on the canvas (`canvas.components()`). */
  public components(): PscxComponent[] {
    const mod =
      this.namespace === "Main" || this.namespace === this.project.rootModule.name
        ? this.project.rootModule
        : (this.project.subModules.get(this.namespace) ?? this.project.rootModule);
    return mod.components;
  }
}

/**
 * Project automation wrapper mirroring `mhi.pscad.Project` (`project.parameters(...)`,
 * `project.canvas('Main')`, `project.run()`, `project.messages()`).
 */
export class MhiPscadProject {
  private lastResult: EmtSolverResult | undefined;
  private sampleStepUs = 250.0;

  constructor(public readonly parsed: PscxProject) {}

  public get name(): string {
    return this.parsed.name;
  }

  /** Gets or sets project-level simulation settings (`time_duration`, `time_step`, `sample_step`). */
  public parameters(updates?: {
    time_duration?: number | undefined;
    time_step?: number | undefined;
    sample_step?: number | undefined;
  }): { time_duration: number; time_step: number; sample_step: number } {
    if (updates) {
      if (updates.time_duration !== undefined) {
        this.parsed.settings.durationSec = updates.time_duration;
      }
      if (updates.time_step !== undefined) {
        // MHI PSCAD specifies time_step in microseconds when > 0.1, or seconds when <= 0.1
        this.parsed.settings.timeStepUs = updates.time_step > 0.1 ? updates.time_step : updates.time_step * 1e6;
      }
      if (updates.sample_step !== undefined) {
        this.sampleStepUs = updates.sample_step > 0.1 ? updates.sample_step : updates.sample_step * 1e6;
      }
    }
    return {
      time_duration: this.parsed.settings.durationSec,
      time_step: this.parsed.settings.timeStepUs,
      sample_step: this.sampleStepUs,
    };
  }

  /** Sets a component parameter by component ID/name (`project.set_component_parameters(name, params)`). */
  public set_component_parameters(componentIdOrName: string, params: Record<string, string | number>): boolean {
    const cmp = this.canvas("Main").component(componentIdOrName);
    if (!cmp) return false;
    for (const [k, v] of Object.entries(params)) {
      cmp.parameters[k] = String(v);
    }
    return true;
  }

  /** Returns a canvas object for the specified module (`project.canvas('Main')`). */
  public canvas(name = "Main"): MhiPscadCanvas {
    return new MhiPscadCanvas(this.parsed, name);
  }

  /** Compiles and runs the EMT simulation (`project.run()`). */
  public run(): EmtSolverResult {
    const netlist = extractEmtNetlist(this.parsed);
    const solver = new EmtSolver(netlist, {
      timeStepSec: this.parsed.settings.timeStepUs * 1e-6,
      durationSec: this.parsed.settings.durationSec,
      nominalFrequencyHz: this.parsed.settings.frequencyHz,
    });
    this.lastResult = solver.solve();
    return this.lastResult;
  }

  public getLastResult(): EmtSolverResult | undefined {
    return this.lastResult;
  }
}

/**
 * Top-level `mhi.pscad.Application` drop-in automation controller.
 */
export class MhiPscadApplication {
  private readonly loadedProjects = new Map<string, MhiPscadProject>();

  /** Loads a `.pscx` XML string into the automation workspace. */
  public loadXml(xmlContent: string): MhiPscadProject {
    const parsed = parsePscx(xmlContent);
    const proj = new MhiPscadProject(parsed);
    this.loadedProjects.set(proj.name, proj);
    return proj;
  }

  /** Looks up an already loaded project by name (`pscad.project(name)`). */
  public project(name: string): MhiPscadProject | undefined {
    return this.loadedProjects.get(name);
  }

  /** Lists all loaded projects (`pscad.projects()`). */
  public projects(): MhiPscadProject[] {
    return Array.from(this.loadedProjects.values());
  }
}
