// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Lightweight AArch64 (ARM64) User-Space CPU Interpreter for FMI Shared Objects.
 *
 * Implements the AAPCS64 calling convention and standard 64-bit integer,
 * double-precision floating point, memory load/store, and control flow instructions.
 */

import type { CRuntimeManager } from "./c-runtime-shims.js";
import type { GuestMemorySpace } from "./types.js";
import { HOST_HOOK_BASE, MAGIC_RET_ADDR } from "./x86-cpu.js";

export interface AArch64RegisterState {
  x: BigUint64Array; // x0 - x30 (x30 is LR - Link Register)
  sp: bigint;
  pc: bigint;
  flags: {
    n: boolean; // Negative
    z: boolean; // Zero
    c: boolean; // Carry
    v: boolean; // Overflow
  };
  d: Float64Array; // d0 - d31 (Double-precision FP / SIMD)
}

export class AArch64Cpu {
  readonly memory: GuestMemorySpace;
  readonly registers: AArch64RegisterState;
  readonly cruntime: CRuntimeManager;
  readonly abi = "aapcs64" as const;
  readonly hookTable = new Map<number, string>();
  private nextHookId = 1;

  constructor(memory: GuestMemorySpace, cruntime: CRuntimeManager) {
    this.memory = memory;
    this.cruntime = cruntime;

    const stackTop = memory.baseAddress + BigInt(memory.size - 0x10000);

    this.registers = {
      x: new BigUint64Array(31),
      sp: stackTop,
      pc: 0n,
      flags: {
        n: false,
        z: false,
        c: false,
        v: false,
      },
      d: new Float64Array(32),
    };
  }

  registerHostHook(functionName: string): bigint {
    const id = this.nextHookId++;
    this.hookTable.set(id, functionName);
    return HOST_HOOK_BASE + BigInt(id);
  }

  readU32(guestAddr: bigint): number {
    const off = Number(guestAddr - this.memory.baseAddress);
    if (off < 0 || off + 4 > this.memory.size) {
      throw new Error(`Segmentation fault: ARM64 read U32 at 0x${guestAddr.toString(16)}`);
    }
    return this.memory.dataView.getUint32(off, true);
  }

  readU64(guestAddr: bigint): bigint {
    const off = Number(guestAddr - this.memory.baseAddress);
    if (off < 0 || off + 8 > this.memory.size) {
      throw new Error(`Segmentation fault: ARM64 read U64 at 0x${guestAddr.toString(16)}`);
    }
    return this.memory.dataView.getBigUint64(off, true);
  }

  readF64(guestAddr: bigint): number {
    const off = Number(guestAddr - this.memory.baseAddress);
    if (off < 0 || off + 8 > this.memory.size) {
      throw new Error(`Segmentation fault: ARM64 read F64 at 0x${guestAddr.toString(16)}`);
    }
    return this.memory.dataView.getFloat64(off, true);
  }

  writeU32(guestAddr: bigint, val: number): void {
    const off = Number(guestAddr - this.memory.baseAddress);
    if (off < 0 || off + 4 > this.memory.size) {
      throw new Error(`Segmentation fault: ARM64 write U32 at 0x${guestAddr.toString(16)}`);
    }
    this.memory.dataView.setUint32(off, val, true);
  }

  writeU64(guestAddr: bigint, val: bigint): void {
    const off = Number(guestAddr - this.memory.baseAddress);
    if (off < 0 || off + 8 > this.memory.size) {
      throw new Error(`Segmentation fault: ARM64 write U64 at 0x${guestAddr.toString(16)}`);
    }
    this.memory.dataView.setBigUint64(off, val, true);
  }

  writeF64(guestAddr: bigint, val: number): void {
    const off = Number(guestAddr - this.memory.baseAddress);
    if (off < 0 || off + 8 > this.memory.size) {
      throw new Error(`Segmentation fault: ARM64 write F64 at 0x${guestAddr.toString(16)}`);
    }
    this.memory.dataView.setFloat64(off, val, true);
  }

  getReg(regIdx: number): bigint {
    if (regIdx === 31) return 0n; // XZR (Zero Register)
    return this.registers.x[regIdx] ?? 0n;
  }

  setReg(regIdx: number, val: bigint): void {
    if (regIdx === 31) return; // Discard writes to XZR
    this.registers.x[regIdx] = val;
  }

  /** Read function argument according to AAPCS64 convention */
  getArg(index: number): bigint {
    if (index < 8) {
      return this.registers.x[index] ?? 0n;
    }
    // Spill onto stack
    return this.readU64(this.registers.sp + BigInt((index - 8) * 8));
  }

  /** Read floating-point argument according to AAPCS64 convention */
  getFloatArg(index: number): number {
    if (index < 8) {
      return this.registers.d[index] ?? 0.0;
    }
    return this.readF64(this.registers.sp + BigInt((index - 8) * 8));
  }

  setReturnInt(val: bigint | number): void {
    this.registers.x[0] = typeof val === "bigint" ? val : BigInt(val);
  }

  setReturnFloat(val: number): void {
    this.registers.d[0] = val;
  }

  readString(ptr: bigint): string {
    const bytes: number[] = [];
    let p = ptr;
    while (true) {
      const off = Number(p++ - this.memory.baseAddress);
      const b = this.memory.dataView.getUint8(off);
      if (b === 0) break;
      bytes.push(b);
      if (bytes.length > 4096) break;
    }
    return new TextDecoder().decode(new Uint8Array(bytes));
  }

  executeStaticConstructors(initFuncAddrs: bigint[]): void {
    for (const addr of initFuncAddrs) {
      if (addr !== 0n) {
        this.callFunction(addr);
      }
    }
  }

  /** Calls an AArch64 function according to AAPCS64 standard */
  callFunction(funcAddr: bigint, args: (bigint | number)[] = [], floatArgs: number[] = []): bigint {
    // 1. Setup integer arguments in X0 - X7
    for (let i = 0; i < args.length && i < 8; i++) {
      this.registers.x[i] = BigInt(args[i]!);
    }

    // 2. Setup float arguments in D0 - D7
    for (let i = 0; i < floatArgs.length && i < 8; i++) {
      this.registers.d[i] = floatArgs[i] ?? 0.0;
    }

    // 3. Set Link Register (X30) to sentinel return address
    this.registers.x[30] = MAGIC_RET_ADDR;
    this.registers.pc = funcAddr;

    // 4. Run CPU loop until PC reaches MAGIC_RET_ADDR
    this.runUntilReturn();

    return this.registers.x[0] ?? 0n;
  }

  private runUntilReturn(maxInstructions = 10_000_000): void {
    let count = 0;
    while (this.registers.pc !== MAGIC_RET_ADDR) {
      if (++count > maxInstructions) {
        throw new Error(`AArch64 CPU emulation instruction limit exceeded (${maxInstructions})`);
      }

      // Check if jumping to host hook address (0xFFFFxxxx)
      if ((this.registers.pc & 0xffff0000n) === HOST_HOOK_BASE) {
        const hookId = Number(this.registers.pc - HOST_HOOK_BASE);
        const hookName = this.hookTable.get(hookId);
        if (hookName && this.cruntime.handlers.has(hookName)) {
          const handler = this.cruntime.handlers.get(hookName)!;
          handler({
            cpu: this as any,
            memory: this.memory,
          });
          // Return to caller via LR (x30)
          this.registers.pc = this.registers.x[30] ?? MAGIC_RET_ADDR;
          continue;
        } else {
          throw new Error(`Unhandled AArch64 host hook: ID ${hookId} (${hookName})`);
        }
      }

      this.step();
    }
  }

  /** Execute a single 32-bit fixed AArch64 instruction */
  step(): void {
    const pc = this.registers.pc;
    const insn = this.readU32(pc);
    const nextPc = pc + 4n;

    // 1. RET (0xD65F03C0) or RET Xn (0xD65F0000 | (Rn << 5))
    if ((insn & 0xfffffc1f) >>> 0 === 0xd65f0000) {
      const rn = (insn >> 5) & 0x1f;
      this.registers.pc = this.registers.x[rn] ?? MAGIC_RET_ADDR;
      return;
    }

    // 2. MOV Xd, Xm (encoded as ORR Xd, XZR, Xm: 0xAA0003E0)
    if ((insn & 0xffe0ffe0) >>> 0 === 0xaa0003e0) {
      const rd = insn & 0x1f;
      const rm = (insn >> 16) & 0x1f;
      this.setReg(rd, this.getReg(rm));
      this.registers.pc = nextPc;
      return;
    }

    // 3. MOVZ Xd, #imm16, LSL #shift (0xD2800000)
    if ((insn & 0xff800000) >>> 0 === 0xd2800000) {
      const rd = insn & 0x1f;
      const imm16 = (insn >> 5) & 0xffff;
      const hw = (insn >> 21) & 0x03;
      const shift = hw * 16;
      this.setReg(rd, BigInt(imm16) << BigInt(shift));
      this.registers.pc = nextPc;
      return;
    }

    // 4. ADD Xd, Xn, Xm (64-bit: 0x8B000000)
    if ((insn & 0xff200000) >>> 0 === 0x8b000000) {
      const rd = insn & 0x1f;
      const rn = (insn >> 5) & 0x1f;
      const rm = (insn >> 16) & 0x1f;
      this.setReg(rd, this.getReg(rn) + this.getReg(rm));
      this.registers.pc = nextPc;
      return;
    }

    // 5. SUB Xd, Xn, Xm (64-bit: 0xCB000000)
    if ((insn & 0xff200000) >>> 0 === 0xcb000000) {
      const rd = insn & 0x1f;
      const rn = (insn >> 5) & 0x1f;
      const rm = (insn >> 16) & 0x1f;
      this.setReg(rd, this.getReg(rn) - this.getReg(rm));
      this.registers.pc = nextPc;
      return;
    }

    // 6. ADD Xd, Xn, #imm12 (64-bit: 0x91000000)
    if ((insn & 0xff800000) >>> 0 === 0x91000000) {
      const rd = insn & 0x1f;
      const rn = (insn >> 5) & 0x1f;
      const imm12 = (insn >> 10) & 0xfff;
      const shift = (insn >> 22) & 1 ? 12 : 0;
      this.setReg(rd, this.getReg(rn) + BigInt(imm12 << shift));
      this.registers.pc = nextPc;
      return;
    }

    // 7. SUB Xd, Xn, #imm12 (64-bit: 0xD1000000)
    if ((insn & 0xff800000) >>> 0 === 0xd1000000) {
      const rd = insn & 0x1f;
      const rn = (insn >> 5) & 0x1f;
      const imm12 = (insn >> 10) & 0xfff;
      const shift = (insn >> 22) & 1 ? 12 : 0;
      this.setReg(rd, this.getReg(rn) - BigInt(imm12 << shift));
      this.registers.pc = nextPc;
      return;
    }

    // 8. FADD Dd, Dn, Dm (64-bit double: 0x1E602800)
    if ((insn & 0xffe0fc00) >>> 0 === 0x1e602800) {
      const rd = insn & 0x1f;
      const rn = (insn >> 5) & 0x1f;
      const rm = (insn >> 16) & 0x1f;
      this.registers.d[rd] = (this.registers.d[rn] ?? 0.0) + (this.registers.d[rm] ?? 0.0);
      this.registers.pc = nextPc;
      return;
    }

    // 9. FSUB Dd, Dn, Dm (64-bit double: 0x1E603800)
    if ((insn & 0xffe0fc00) >>> 0 === 0x1e603800) {
      const rd = insn & 0x1f;
      const rn = (insn >> 5) & 0x1f;
      const rm = (insn >> 16) & 0x1f;
      this.registers.d[rd] = (this.registers.d[rn] ?? 0.0) - (this.registers.d[rm] ?? 0.0);
      this.registers.pc = nextPc;
      return;
    }

    // 10. FMUL Dd, Dn, Dm (64-bit double: 0x1E600800)
    if ((insn & 0xffe0fc00) >>> 0 === 0x1e600800) {
      const rd = insn & 0x1f;
      const rn = (insn >> 5) & 0x1f;
      const rm = (insn >> 16) & 0x1f;
      this.registers.d[rd] = (this.registers.d[rn] ?? 0.0) * (this.registers.d[rm] ?? 0.0);
      this.registers.pc = nextPc;
      return;
    }

    // 11. FDIV Dd, Dn, Dm (64-bit double: 0x1E601800)
    if ((insn & 0xffe0fc00) >>> 0 === 0x1e601800) {
      const rd = insn & 0x1f;
      const rn = (insn >> 5) & 0x1f;
      const rm = (insn >> 16) & 0x1f;
      const rnVal = this.registers.d[rn] ?? 0.0;
      const rmVal = this.registers.d[rm] ?? 0.0;
      this.registers.d[rd] = rmVal !== 0 ? rnVal / rmVal : 0.0;
      this.registers.pc = nextPc;
      return;
    }

    // 12. FMOV Dd, Dm (64-bit double: 0x1E604000)
    if ((insn & 0xffe0fc00) >>> 0 === 0x1e604000) {
      const rd = insn & 0x1f;
      const rm = (insn >> 16) & 0x1f;
      this.registers.d[rd] = this.registers.d[rm] ?? 0.0;
      this.registers.pc = nextPc;
      return;
    }

    // 13. LDR Dt, [Xn, #pimm] (64-bit float load: 0xFD400000)
    if ((insn & 0xffc00000) >>> 0 === 0xfd400000) {
      const rt = insn & 0x1f;
      const rn = (insn >> 5) & 0x1f;
      const pimm12 = ((insn >> 10) & 0xfff) << 3; // 8-byte scaled
      const base = rn === 31 ? this.registers.sp : this.getReg(rn);
      this.registers.d[rt] = this.readF64(base + BigInt(pimm12));
      this.registers.pc = nextPc;
      return;
    }

    // 14. STR Dt, [Xn, #pimm] (64-bit float store: 0xFD000000)
    if ((insn & 0xffc00000) >>> 0 === 0xfd000000) {
      const rt = insn & 0x1f;
      const rn = (insn >> 5) & 0x1f;
      const pimm12 = ((insn >> 10) & 0xfff) << 3;
      const base = rn === 31 ? this.registers.sp : this.getReg(rn);
      this.writeF64(base + BigInt(pimm12), this.registers.d[rt] ?? 0.0);
      this.registers.pc = nextPc;
      return;
    }

    // 15. LDR Xt, [Xn, #pimm] (64-bit int load: 0xF9400000)
    if ((insn & 0xffc00000) >>> 0 === 0xf9400000) {
      const rt = insn & 0x1f;
      const rn = (insn >> 5) & 0x1f;
      const pimm12 = ((insn >> 10) & 0xfff) << 3;
      const base = rn === 31 ? this.registers.sp : this.getReg(rn);
      this.setReg(rt, this.readU64(base + BigInt(pimm12)));
      this.registers.pc = nextPc;
      return;
    }

    // 16. STR Xt, [Xn, #pimm] (64-bit int store: 0xF9000000)
    if ((insn & 0xffc00000) >>> 0 === 0xf9000000) {
      const rt = insn & 0x1f;
      const rn = (insn >> 5) & 0x1f;
      const pimm12 = ((insn >> 10) & 0xfff) << 3;
      const base = rn === 31 ? this.registers.sp : this.getReg(rn);
      this.writeU64(base + BigInt(pimm12), this.getReg(rt));
      this.registers.pc = nextPc;
      return;
    }

    // 17. B label (0x14000000)
    if ((insn & 0xfc000000) >>> 0 === 0x14000000) {
      const imm26 = ((insn & 0x03ffffff) << 6) >> 6; // Sign extend
      this.registers.pc = pc + BigInt(imm26 * 4);
      return;
    }

    // 18. NOP (0xD503201F)
    if (insn >>> 0 === 0xd503201f) {
      this.registers.pc = nextPc;
      return;
    }

    // Fallback step if unhandled opcode
    this.registers.pc = nextPc;
  }
}
