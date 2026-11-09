// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/psse — Wasm-Machina In-Browser / Node Binary Runner for PSS/E `dsusr.dll` (`USRMDL`)
 *
 * Executes compiled Windows PE32+ (`dsusr.dll`), Linux ELF64 (`libdsusr.so`), and macOS Mach-O
 * user-written dynamic models directly inside ModelScript's Wasm-Machina x86_64/ARM64 CPU
 * emulator (`@modelscript/exchange`) without native host FFI dependencies.
 *
 * Supports the standard PSS/E `MODE = 1` (initialization), `MODE = 2` (rate-of-change `DSTATE`
 * evaluation), and `MODE = 3` (algebraic output `EFD`/`PMECH` evaluation) calling convention:
 *   `SUBROUTINE <MODEL_NAME>(MC, ISLOT, MODE)`
 * as well as direct pointer-marshaled C/Fortran user-defined excitation, governor, and IBR DLLs.
 */

import {
  AArch64Cpu,
  CPU_TYPE_ARM64,
  CRuntimeManager,
  ElfLoader,
  type GuestMemorySpace,
  MachoLoader,
  PeLoader,
  X86Cpu,
} from "@modelscript/exchange";

export interface PsseUsrDllStepContext {
  /** 1-based machine or device index (`MC`, default 1). */
  mc?: number | undefined;
  /** 1-based starting offset into `CON`/`STATE`/`DSTATE` (`ISLOT`, default 1). */
  islot?: number | undefined;
  /** Current simulation time in seconds (`TIME`). */
  time: number;
  /** Integration time step in seconds (`DELT`). */
  delt: number;
  /** Model parameter array (`CON`). */
  con: readonly number[] | Float64Array;
  /** State vector (`STATE`). */
  state: Float64Array;
  /** State derivative vector (`DSTATE`). */
  dstate: Float64Array;
  /** Generator terminal voltage magnitude in pu (`ETERM(MC)`). */
  eterm: number;
  /** Generator rotor speed deviation in pu (`SPEED(MC)`). */
  speed: number;
  /** Current field voltage command in pu (`EFD(MC)`). */
  efd: number;
  /** Current mechanical power in pu (`PMECH(MC)`). */
  pmech: number;
}

export interface PsseUsrDllStepResult {
  efd: number;
  pmech: number;
  state: Float64Array;
  dstate: Float64Array;
}

export class PsseWasmMachinaDllRunner {
  public readonly format: "pe" | "elf" | "macho";
  public readonly loader: PeLoader | ElfLoader | MachoLoader;
  public readonly memory: GuestMemorySpace;
  public readonly cruntime: CRuntimeManager;
  public readonly cpu: X86Cpu | AArch64Cpu;

  private readonly exportAddresses = new Map<string, bigint>();
  public readonly mcPtr: bigint;
  public readonly islotPtr: bigint;
  public readonly modePtr: bigint;
  public readonly conPtr: bigint;
  public readonly statePtr: bigint;
  public readonly dstatePtr: bigint;
  public readonly varPtr: bigint;
  public readonly etermPtr: bigint;
  public readonly efdPtr: bigint;
  public readonly pmechPtr: bigint;
  public readonly speedPtr: bigint;

  constructor(binaryBuffer: Uint8Array, options?: { preferredBase?: bigint | undefined }) {
    if (binaryBuffer.length >= 2 && binaryBuffer[0] === 0x4d && binaryBuffer[1] === 0x5a) {
      this.format = "pe";
      const peLoader = new PeLoader(binaryBuffer);
      this.loader = peLoader;
      this.memory = peLoader.mapImageToMemory(options?.preferredBase);
      this.cruntime = new CRuntimeManager(this.memory);
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
    } else {
      throw new Error(
        "Unsupported PSS/E USRMDL binary format: expected Windows PE ('dsusr.dll'), Linux ELF ('libdsusr.so'), or macOS Mach-O ('.dylib').",
      );
    }

    // Allocate PSS/E global dynamics arrays in guest memory
    this.mcPtr = this.cruntime.malloc(16);
    this.islotPtr = this.cruntime.malloc(16);
    this.modePtr = this.cruntime.malloc(16);
    this.conPtr = this.cruntime.malloc(1024 * 8);
    this.statePtr = this.cruntime.malloc(1024 * 8);
    this.dstatePtr = this.cruntime.malloc(1024 * 8);
    this.varPtr = this.cruntime.malloc(512 * 8);
    this.etermPtr = this.cruntime.malloc(256 * 8);
    this.efdPtr = this.cruntime.malloc(256 * 8);
    this.pmechPtr = this.cruntime.malloc(256 * 8);
    this.speedPtr = this.cruntime.malloc(256 * 8);

    this.registerPsseHostShims();

    if (this.loader instanceof PeLoader) {
      this.cpu = new X86Cpu(this.memory, this.loader.header.is64Bit, this.cruntime, "win64");
      this.hookPeImports(this.loader);
      for (const [name, sym] of this.loader.exports) {
        this.exportAddresses.set(name, this.memory.baseAddress + BigInt(sym.rva));
      }
      if (this.loader.header.entryPointRva > 0) {
        const dllMainAddr = this.memory.baseAddress + BigInt(this.loader.header.entryPointRva);
        this.cpu.callFunction(dllMainAddr, [this.memory.baseAddress, 1n, 0n]);
      }
    } else if (this.loader instanceof ElfLoader) {
      if (this.loader.header.machine === 0xb7) {
        this.cpu = new AArch64Cpu(this.memory, this.cruntime);
      } else {
        this.cpu = new X86Cpu(this.memory, this.loader.header.is64Bit, this.cruntime, "systemv");
      }
      this.hookElfRelocations(this.loader);
      for (const [name, sym] of this.loader.symbols) {
        this.exportAddresses.set(name, this.memory.baseAddress + sym.value);
      }
      if (this.loader.initArrayRvas.length > 0) {
        const addrs = this.loader.initArrayRvas.map((rva) => this.memory.baseAddress + rva);
        this.cpu.executeStaticConstructors(addrs);
      }
    } else {
      const machoLoader = this.loader;
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
    }
  }

  private registerPsseHostShims(): void {
    this.cruntime.handlers.set("psse_con_ptr", (ctx) => ctx.cpu.setReturnInt(this.conPtr));
    this.cruntime.handlers.set("psse_state_ptr", (ctx) => ctx.cpu.setReturnInt(this.statePtr));
    this.cruntime.handlers.set("psse_dstate_ptr", (ctx) => ctx.cpu.setReturnInt(this.dstatePtr));
    this.cruntime.handlers.set("psse_eterm_ptr", (ctx) => ctx.cpu.setReturnInt(this.etermPtr));
    this.cruntime.handlers.set("psse_efd_ptr", (ctx) => ctx.cpu.setReturnInt(this.efdPtr));
    this.cruntime.handlers.set("psse_pmech_ptr", (ctx) => ctx.cpu.setReturnInt(this.pmechPtr));
    this.cruntime.handlers.set("psse_speed_ptr", (ctx) => ctx.cpu.setReturnInt(this.speedPtr));
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

  public getExportAddr(symbolName: string): bigint | undefined {
    const lower = symbolName.toLowerCase();
    const upper = symbolName.toUpperCase();
    return (
      this.exportAddresses.get(symbolName) ??
      this.exportAddresses.get(upper) ??
      this.exportAddresses.get(lower) ??
      this.exportAddresses.get(`${lower}_`) ??
      this.exportAddresses.get(`_${symbolName}`) ??
      this.exportAddresses.get(`_${lower}_`)
    );
  }

  public getExportedSymbols(): string[] {
    return Array.from(this.exportAddresses.keys());
  }

  /**
   * Executes a PSS/E user-written model subroutine for `MODE = 1` (init), `MODE = 2` (`DSTATE`),
   * or `MODE = 3` (`EFD`/`PMECH` outputs) inside the Wasm-Machina binary emulator.
   *
   * Passes `(conPtr, statePtr, dstatePtr, etermPtr, efdPtr, pmechPtr, speedPtr, mcPtr, islotPtr, modePtr)`
   * in integer/pointer registers (RCX/RDX/R8/R9 on Win64; RDI/RSI/RDX/RCX/R8/R9 on System V)
   * and `(time, delt)` in floating-point registers.
   */
  public stepModel(symbolName: string, mode: 1 | 2 | 3, ctx: PsseUsrDllStepContext): PsseUsrDllStepResult {
    const fnAddr = this.getExportAddr(symbolName);
    if (!fnAddr) {
      throw new Error(
        `PSS/E USRMDL subroutine '${symbolName}' not found in binary exports: [${this.getExportedSymbols().join(", ")}]`,
      );
    }

    const mc = Math.max(1, ctx.mc ?? 1);
    const islot = Math.max(1, ctx.islot ?? 1);
    const mcIdx = mc - 1;
    const slotIdx = islot - 1;

    const mcOff = Number(this.mcPtr - this.memory.baseAddress);
    const islotOff = Number(this.islotPtr - this.memory.baseAddress);
    const modeOff = Number(this.modePtr - this.memory.baseAddress);
    const conOff = Number(this.conPtr - this.memory.baseAddress);
    const stateOff = Number(this.statePtr - this.memory.baseAddress);
    const dstateOff = Number(this.dstatePtr - this.memory.baseAddress);
    const etermOff = Number(this.etermPtr - this.memory.baseAddress);
    const efdOff = Number(this.efdPtr - this.memory.baseAddress);
    const pmechOff = Number(this.pmechPtr - this.memory.baseAddress);
    const speedOff = Number(this.speedPtr - this.memory.baseAddress);

    this.memory.dataView.setInt32(mcOff, mc, true);
    this.memory.dataView.setInt32(islotOff, islot, true);
    this.memory.dataView.setInt32(modeOff, mode, true);

    const nCon = Math.min(ctx.con.length, 1024 - slotIdx);
    for (let i = 0; i < nCon; i++) {
      this.memory.dataView.setFloat64(conOff + (slotIdx + i) * 8, ctx.con[i]!, true);
    }
    const nState = Math.min(ctx.state.length, 1024 - slotIdx);
    for (let i = 0; i < nState; i++) {
      this.memory.dataView.setFloat64(stateOff + (slotIdx + i) * 8, ctx.state[i]!, true);
      this.memory.dataView.setFloat64(dstateOff + (slotIdx + i) * 8, ctx.dstate[i] ?? 0.0, true);
    }

    this.memory.dataView.setFloat64(etermOff + mcIdx * 8, ctx.eterm, true);
    this.memory.dataView.setFloat64(efdOff + mcIdx * 8, ctx.efd, true);
    this.memory.dataView.setFloat64(pmechOff + mcIdx * 8, ctx.pmech, true);
    this.memory.dataView.setFloat64(speedOff + mcIdx * 8, ctx.speed, true);

    // First 4 pointers fit directly in Win64 RCX, RDX, R8, R9 (and System V RDI, RSI, RDX, RCX):
    // arg0 = conPtr + slotOffset, arg1 = statePtr + slotOffset, arg2 = dstatePtr + slotOffset, arg3 = efdPtr + mcOffset
    const slotByteOff = BigInt(slotIdx * 8);
    const mcByteOff = BigInt(mcIdx * 8);
    this.cpu.callFunction(
      fnAddr,
      [
        this.conPtr + slotByteOff,
        this.statePtr + slotByteOff,
        this.dstatePtr + slotByteOff,
        this.efdPtr + mcByteOff,
        this.etermPtr + mcByteOff,
        this.pmechPtr + mcByteOff,
        this.speedPtr + mcByteOff,
        this.mcPtr,
        this.islotPtr,
        this.modePtr,
      ],
      [ctx.eterm, ctx.delt],
    );

    const updatedState = new Float64Array(ctx.state.length);
    const updatedDstate = new Float64Array(ctx.dstate.length);
    for (let i = 0; i < nState; i++) {
      updatedState[i] = this.memory.dataView.getFloat64(stateOff + (slotIdx + i) * 8, true);
      updatedDstate[i] = this.memory.dataView.getFloat64(dstateOff + (slotIdx + i) * 8, true);
    }

    const updatedEfd = this.memory.dataView.getFloat64(efdOff + mcIdx * 8, true);
    const updatedPmech = this.memory.dataView.getFloat64(pmechOff + mcIdx * 8, true);

    return {
      efd: updatedEfd,
      pmech: updatedPmech,
      state: updatedState,
      dstate: updatedDstate,
    };
  }
}
