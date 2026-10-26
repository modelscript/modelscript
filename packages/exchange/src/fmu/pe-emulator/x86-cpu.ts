// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Lightweight x86 / x86_64 User-Space CPU Interpreter for FMI Dynamic Libraries.
 */

import type { CRuntimeManager } from "./c-runtime-shims.js";
import type { GuestMemorySpace, X86RegisterState } from "./types.js";

export const HOST_HOOK_BASE = 0xffff0000n;
export const MAGIC_RET_ADDR = 0xdeadbeefcafe0000n;

export class X86Cpu {
  readonly memory: GuestMemorySpace;
  readonly is64Bit: boolean;
  readonly abi: "win64" | "systemv";
  readonly registers: X86RegisterState;
  readonly cruntime: CRuntimeManager;
  readonly hookTable = new Map<number, string>();
  private nextHookId = 1;

  constructor(memory: GuestMemorySpace, is64Bit = true, cruntime: CRuntimeManager, abi: "win64" | "systemv" = "win64") {
    this.memory = memory;
    this.is64Bit = is64Bit;
    this.abi = abi;
    this.cruntime = cruntime;

    // Allocate stack at end of image
    const stackTop = memory.baseAddress + BigInt(memory.size - 0x10000);

    this.registers = {
      rax: 0n,
      rbx: 0n,
      rcx: 0n,
      rdx: 0n,
      rsi: 0n,
      rdi: 0n,
      rbp: stackTop,
      rsp: stackTop,
      r8: 0n,
      r9: 0n,
      r10: 0n,
      r11: 0n,
      r12: 0n,
      r13: 0n,
      r14: 0n,
      r15: 0n,
      rip: 0n,
      eflags: {
        cf: false,
        zf: false,
        sf: false,
        of: false,
        pf: false,
        af: false,
      },
      xmm: new Float64Array(16),
      ymm: new Float64Array(64),
    };
  }

  /** Read 2 x 64-bit floats (128-bit vector) from guest virtual address */
  readF64x2(guestAddr: bigint): [number, number] {
    return [this.readF64(guestAddr), this.readF64(guestAddr + 8n)];
  }

  /** Write 2 x 64-bit floats (128-bit vector) to guest virtual address */
  writeF64x2(guestAddr: bigint, vals: [number, number]): void {
    this.writeF64(guestAddr, vals[0]);
    this.writeF64(guestAddr + 8n, vals[1]);
  }

  /** Read 4 x 64-bit floats (256-bit vector) from guest virtual address */
  readF64x4(guestAddr: bigint): [number, number, number, number] {
    return [
      this.readF64(guestAddr),
      this.readF64(guestAddr + 8n),
      this.readF64(guestAddr + 16n),
      this.readF64(guestAddr + 24n),
    ];
  }

  /** Write 4 x 64-bit floats (256-bit vector) to guest virtual address */
  writeF64x4(guestAddr: bigint, vals: [number, number, number, number]): void {
    this.writeF64(guestAddr, vals[0]);
    this.writeF64(guestAddr + 8n, vals[1]);
    this.writeF64(guestAddr + 16n, vals[2]);
    this.writeF64(guestAddr + 24n, vals[3]);
  }

  /** Get 256-bit YMM register lanes as array of 4 doubles */
  getYmm(reg: number): [number, number, number, number] {
    const base = reg * 4;
    return [
      this.registers.ymm[base] ?? 0.0,
      this.registers.ymm[base + 1] ?? 0.0,
      this.registers.ymm[base + 2] ?? 0.0,
      this.registers.ymm[base + 3] ?? 0.0,
    ];
  }

  /** Set 256-bit YMM register lanes */
  setYmm(reg: number, l0: number, l1 = 0.0, l2 = 0.0, l3 = 0.0): void {
    const base = reg * 4;
    this.registers.ymm[base] = l0;
    this.registers.ymm[base + 1] = l1;
    this.registers.ymm[base + 2] = l2;
    this.registers.ymm[base + 3] = l3;
    // Lower 64 bits alias XMM[reg]
    this.registers.xmm[reg] = l0;
  }

  /** Get a specific lane of a YMM register (0, 1, 2, or 3) */
  getYmmLane(reg: number, lane: number): number {
    return this.registers.ymm[reg * 4 + lane] ?? 0.0;
  }

  /** Set a specific lane of a YMM register */
  setYmmLane(reg: number, lane: number, val: number): void {
    this.registers.ymm[reg * 4 + lane] = val;
    if (lane === 0) {
      this.registers.xmm[reg] = val;
    }
  }

  /** Registers a host C-runtime hook and returns its synthetic guest virtual address. */
  registerHostHook(functionName: string): bigint {
    const id = this.nextHookId++;
    this.hookTable.set(id, functionName);
    return HOST_HOOK_BASE + BigInt(id);
  }

  /** Read 8-bit unsigned integer from guest virtual address */
  readU8(guestAddr: bigint): number {
    const off = Number(guestAddr - this.memory.baseAddress);
    if (off < 0 || off >= this.memory.size) {
      throw new Error(`Segmentation fault: read U8 at out-of-bounds address 0x${guestAddr.toString(16)}`);
    }
    return this.memory.dataView.getUint8(off);
  }

  /** Read 32-bit unsigned integer from guest virtual address */
  readU32(guestAddr: bigint): number {
    const off = Number(guestAddr - this.memory.baseAddress);
    if (off < 0 || off + 4 > this.memory.size) {
      throw new Error(`Segmentation fault: read U32 at out-of-bounds address 0x${guestAddr.toString(16)}`);
    }
    return this.memory.dataView.getUint32(off, true);
  }

  /** Read 64-bit unsigned integer from guest virtual address */
  readU64(guestAddr: bigint): bigint {
    const off = Number(guestAddr - this.memory.baseAddress);
    if (off < 0 || off + 8 > this.memory.size) {
      throw new Error(`Segmentation fault: read U64 at out-of-bounds address 0x${guestAddr.toString(16)}`);
    }
    return this.memory.dataView.getBigUint64(off, true);
  }

  /** Read 64-bit float from guest virtual address */
  readF64(guestAddr: bigint): number {
    const off = Number(guestAddr - this.memory.baseAddress);
    if (off < 0 || off + 8 > this.memory.size) {
      throw new Error(`Segmentation fault: read F64 at out-of-bounds address 0x${guestAddr.toString(16)}`);
    }
    return this.memory.dataView.getFloat64(off, true);
  }

  /** Write 8-bit unsigned integer to guest virtual address */
  writeU8(guestAddr: bigint, val: number): void {
    const off = Number(guestAddr - this.memory.baseAddress);
    if (off < 0 || off >= this.memory.size) {
      throw new Error(`Segmentation fault: write U8 at out-of-bounds address 0x${guestAddr.toString(16)}`);
    }
    this.memory.dataView.setUint8(off, val);
  }

  /** Write 32-bit unsigned integer to guest virtual address */
  writeU32(guestAddr: bigint, val: number): void {
    const off = Number(guestAddr - this.memory.baseAddress);
    if (off < 0 || off + 4 > this.memory.size) {
      throw new Error(`Segmentation fault: write U32 at out-of-bounds address 0x${guestAddr.toString(16)}`);
    }
    this.memory.dataView.setUint32(off, val, true);
  }

  /** Write 64-bit unsigned integer to guest virtual address */
  writeU64(guestAddr: bigint, val: bigint): void {
    const off = Number(guestAddr - this.memory.baseAddress);
    if (off < 0 || off + 8 > this.memory.size) {
      throw new Error(`Segmentation fault: write U64 at out-of-bounds address 0x${guestAddr.toString(16)}`);
    }
    this.memory.dataView.setBigUint64(off, val, true);
  }

  /** Write 64-bit float to guest virtual address */
  writeF64(guestAddr: bigint, val: number): void {
    const off = Number(guestAddr - this.memory.baseAddress);
    if (off < 0 || off + 8 > this.memory.size) {
      throw new Error(`Segmentation fault: write F64 at out-of-bounds address 0x${guestAddr.toString(16)}`);
    }
    this.memory.dataView.setFloat64(off, val, true);
  }

  /** Push 64-bit or 32-bit value onto the stack */
  push(val: bigint): void {
    if (this.is64Bit) {
      this.registers.rsp -= 8n;
      this.writeU64(this.registers.rsp, val);
    } else {
      this.registers.rsp -= 4n;
      this.writeU32(this.registers.rsp, Number(val & 0xffffffffn));
    }
  }

  /** Pop 64-bit or 32-bit value from the stack */
  pop(): bigint {
    if (this.is64Bit) {
      const val = this.readU64(this.registers.rsp);
      this.registers.rsp += 8n;
      return val;
    } else {
      const val = BigInt(this.readU32(this.registers.rsp));
      this.registers.rsp += 4n;
      return val;
    }
  }

  /** Get argument according to calling convention */
  getArg(index: number): bigint {
    if (this.is64Bit) {
      if (this.abi === "systemv") {
        // System V AMD64 ABI: RDI, RSI, RDX, RCX, R8, R9, stack
        switch (index) {
          case 0:
            return this.registers.rdi;
          case 1:
            return this.registers.rsi;
          case 2:
            return this.registers.rdx;
          case 3:
            return this.registers.rcx;
          case 4:
            return this.registers.r8;
          case 5:
            return this.registers.r9;
          default:
            return this.readU64(this.registers.rsp + BigInt(8 + (index - 6) * 8));
        }
      } else {
        // Microsoft x64: RCX, RDX, R8, R9, stack
        switch (index) {
          case 0:
            return this.registers.rcx;
          case 1:
            return this.registers.rdx;
          case 2:
            return this.registers.r8;
          case 3:
            return this.registers.r9;
          default:
            return this.readU64(this.registers.rsp + BigInt(0x28 + (index - 4) * 8));
        }
      }
    } else {
      // x86-32 stdcall/cdecl: stack [ESP + 4 + index*4]
      return BigInt(this.readU32(this.registers.rsp + BigInt(4 + index * 4)));
    }
  }

  /** Get floating point argument (double) */
  getFloatArg(index: number): number {
    if (this.is64Bit) {
      if (this.abi === "systemv") {
        // System V: XMM0 through XMM7
        if (index < 8) {
          return this.registers.xmm[index] ?? 0.0;
        }
        return this.readF64(this.registers.rsp + BigInt(8 + (index - 8) * 8));
      } else {
        // Microsoft x64: XMM0, XMM1, XMM2, XMM3, stack
        if (index < 4) {
          return this.registers.xmm[index] ?? 0.0;
        }
        return this.readF64(this.registers.rsp + BigInt(0x28 + (index - 4) * 8));
      }
    } else {
      // x86-32: double pushed as 8-byte stack value
      return this.readF64(this.registers.rsp + BigInt(4 + index * 8));
    }
  }

  setReturnInt(val: bigint | number): void {
    this.registers.rax = typeof val === "bigint" ? val : BigInt(val);
  }

  setReturnFloat(val: number): void {
    this.registers.xmm[0] = val;
  }

  readString(ptr: bigint): string {
    const bytes: number[] = [];
    let p = ptr;
    while (true) {
      const b = this.readU8(p++);
      if (b === 0) break;
      bytes.push(b);
      if (bytes.length > 4096) break;
    }
    return new TextDecoder().decode(new Uint8Array(bytes));
  }

  /** Executes static C++/Fortran constructor functions */
  executeStaticConstructors(initFuncAddrs: bigint[]): void {
    for (const addr of initFuncAddrs) {
      if (addr !== 0n) {
        this.callFunction(addr);
      }
    }
  }

  /** Calls a guest function at virtual address and runs until return */
  callFunction(funcAddr: bigint, args: (bigint | number)[] = [], floatArgs: number[] = []): bigint {
    // 1. Setup calling convention parameters
    if (this.is64Bit) {
      if (this.abi === "systemv") {
        // System V AMD64 ABI: RDI, RSI, RDX, RCX, R8, R9
        if (args[0] !== undefined) this.registers.rdi = BigInt(args[0]);
        if (args[1] !== undefined) this.registers.rsi = BigInt(args[1]);
        if (args[2] !== undefined) this.registers.rdx = BigInt(args[2]);
        if (args[3] !== undefined) this.registers.rcx = BigInt(args[3]);
        if (args[4] !== undefined) this.registers.r8 = BigInt(args[4]);
        if (args[5] !== undefined) this.registers.r9 = BigInt(args[5]);

        // Floats in XMM0 - XMM7
        for (let i = 0; i < floatArgs.length && i < 8; i++) {
          this.registers.xmm[i] = floatArgs[i] ?? 0.0;
        }

        // System V has NO shadow space: CALL directly pushes return address
        this.push(MAGIC_RET_ADDR);
      } else {
        // Microsoft x64: RCX, RDX, R8, R9
        if (args[0] !== undefined) this.registers.rcx = BigInt(args[0]);
        if (args[1] !== undefined) this.registers.rdx = BigInt(args[1]);
        if (args[2] !== undefined) this.registers.r8 = BigInt(args[2]);
        if (args[3] !== undefined) this.registers.r9 = BigInt(args[3]);

        // Floats in XMM0 - XMM3
        for (let i = 0; i < floatArgs.length && i < 4; i++) {
          this.registers.xmm[i] = floatArgs[i] ?? 0.0;
        }

        // Allocate shadow space (32 bytes) before CALL pushes return address
        this.registers.rsp -= 32n;
        this.push(MAGIC_RET_ADDR);
      }
    } else {
      // Push args right-to-left
      for (let i = args.length - 1; i >= 0; i--) {
        this.push(BigInt(args[i]!));
      }
      this.push(MAGIC_RET_ADDR);
    }

    this.registers.rip = funcAddr;

    // 2. Execute CPU step loop until return to MAGIC_RET_ADDR
    this.runUntilReturn();

    // Clean up shadow space only in Win64 mode
    if (this.is64Bit && this.abi === "win64") {
      this.registers.rsp += 32n;
    }

    return this.registers.rax;
  }

  /** Run instructions until RIP reaches MAGIC_RET_ADDR */
  private runUntilReturn(maxInstructions = 10_000_000): void {
    let count = 0;
    while (this.registers.rip !== MAGIC_RET_ADDR) {
      if (++count > maxInstructions) {
        throw new Error(`x86 CPU emulation instruction limit exceeded (${maxInstructions})`);
      }

      // Check if jumping to host hook address (0xFFFFxxxx)
      if ((this.registers.rip & 0xffff0000n) === HOST_HOOK_BASE) {
        const hookId = Number(this.registers.rip - HOST_HOOK_BASE);
        const hookName = this.hookTable.get(hookId);
        if (hookName && this.cruntime.handlers.has(hookName)) {
          const handler = this.cruntime.handlers.get(hookName)!;
          handler({
            cpu: this,
            memory: this.memory,
          });
          // Return to caller
          this.registers.rip = this.pop();
          continue;
        } else {
          throw new Error(`Unhandled host C-runtime hook: ID ${hookId} (${hookName})`);
        }
      }

      this.step();
    }
  }

  /** Executes a single x86 instruction */
  step(): void {
    let rip = this.registers.rip;
    let b1 = this.readU8(rip++);

    // Handle REX prefix (64-bit mode: 0x40 - 0x4F)
    let rexW = false;
    let rexR = false;
    let rexX = false;
    let rexB = false;

    if (this.is64Bit && b1 >= 0x40 && b1 <= 0x4f) {
      rexW = (b1 & 0x08) !== 0;
      rexR = (b1 & 0x04) !== 0;
      rexX = (b1 & 0x02) !== 0;
      rexB = (b1 & 0x01) !== 0;
      b1 = this.readU8(rip++);
    }

    // 0. Handle VEX Prefix (AVX / AVX2): 2-byte VEX (0xC5) or 3-byte VEX (0xC4)
    if (this.is64Bit && (b1 === 0xc5 || b1 === 0xc4)) {
      let vexR = false;
      let vexX = false;
      let vexB = false;
      let map = 1; // 1 = 0F, 2 = 0F38, 3 = 0F3A
      let vvvv = 0;
      let is256 = false;
      let pp = 0; // 0 = none, 1 = 66, 2 = F3, 3 = F2
      let opcode = 0;

      if (b1 === 0xc5) {
        const b2 = this.readU8(rip++);
        vexR = (b2 & 0x80) === 0;
        vvvv = ~(b2 >> 3) & 0x0f;
        is256 = (b2 & 0x04) !== 0;
        pp = b2 & 0x03;
        opcode = this.readU8(rip++);
      } else {
        const b2 = this.readU8(rip++);
        const b3 = this.readU8(rip++);
        vexR = (b2 & 0x80) === 0;
        vexX = (b2 & 0x40) === 0;
        vexB = (b2 & 0x20) === 0;
        map = b2 & 0x1f;
        const _rexW = (b3 & 0x80) !== 0;
        void _rexW;
        vvvv = ~(b3 >> 3) & 0x0f;
        is256 = (b3 & 0x04) !== 0;
        pp = b3 & 0x03;
        opcode = this.readU8(rip++);
      }

      // VZEROUPPER: 0xC5 0xF8 0x77 (map 1, opcode 0x77)
      if (map === 1 && opcode === 0x77 && !is256) {
        for (let r = 0; r < 16; r++) {
          this.registers.ymm[r * 4 + 1] = 0.0;
          this.registers.ymm[r * 4 + 2] = 0.0;
          this.registers.ymm[r * 4 + 3] = 0.0;
        }
        this.registers.rip = rip;
        return;
      }

      const modrm = this.readU8(rip++);
      const reg = ((modrm >> 3) & 7) + (vexR ? 8 : 0);
      const rm = (modrm & 7) + (vexB ? 8 : 0);
      const mod = modrm >> 6;

      // VMOVUPD / VMOVAPD (map 1, pp 1) or VMOVUPS / VMOVAPS (map 1, pp 0)
      if (map === 1 && (pp === 1 || pp === 0) && (opcode === 0x10 || opcode === 0x28)) {
        if (mod === 3) {
          const src = this.getYmm(rm);
          if (is256) {
            this.setYmm(reg, src[0], src[1], src[2], src[3]);
          } else {
            this.setYmm(reg, src[0], src[1], 0.0, 0.0);
          }
        } else {
          const [addr, nextRip] = this.resolveEffectiveAddress(mod, rm, rip, vexB, vexX);
          if (is256) {
            const vals = this.readF64x4(addr);
            this.setYmm(reg, vals[0], vals[1], vals[2], vals[3]);
          } else {
            const vals = this.readF64x2(addr);
            this.setYmm(reg, vals[0], vals[1], 0.0, 0.0);
          }
          rip = nextRip;
        }
        this.registers.rip = rip;
        return;
      }

      if (map === 1 && (pp === 1 || pp === 0) && (opcode === 0x11 || opcode === 0x29)) {
        if (mod === 3) {
          const src = this.getYmm(reg);
          if (is256) {
            this.setYmm(rm, src[0], src[1], src[2], src[3]);
          } else {
            this.setYmm(rm, src[0], src[1], 0.0, 0.0);
          }
        } else {
          const [addr, nextRip] = this.resolveEffectiveAddress(mod, rm, rip, vexB, vexX);
          if (is256) {
            this.writeF64x4(addr, this.getYmm(reg));
          } else {
            const y = this.getYmm(reg);
            this.writeF64x2(addr, [y[0], y[1]]);
          }
          rip = nextRip;
        }
        this.registers.rip = rip;
        return;
      }

      // VMOVSD (map 1, pp 3)
      if (map === 1 && pp === 3 && opcode === 0x10) {
        if (mod === 3) {
          const val = this.getYmmLane(rm, 0);
          const v1 = this.getYmmLane(vvvv, 1);
          this.setYmm(reg, val, v1, 0.0, 0.0);
        } else {
          const [addr, nextRip] = this.resolveEffectiveAddress(mod, rm, rip, vexB, vexX);
          const val = this.readF64(addr);
          this.setYmm(reg, val, 0.0, 0.0, 0.0);
          rip = nextRip;
        }
        this.registers.rip = rip;
        return;
      }

      if (map === 1 && pp === 3 && opcode === 0x11) {
        const [addr, nextRip] = this.resolveEffectiveAddress(mod, rm, rip, vexB, vexX);
        this.writeF64(addr, this.getYmmLane(reg, 0));
        this.registers.rip = nextRip;
        return;
      }

      // Packed Double Arithmetic: VADDPD (0x58), SUBSD (0x5C), MULPD (0x59), DIVPD (0x5E), MAXPD (0x5F), MINPD (0x5D)
      if (
        map === 1 &&
        pp === 1 &&
        (opcode === 0x58 || opcode === 0x5c || opcode === 0x59 || opcode === 0x5e || opcode === 0x5f || opcode === 0x5d)
      ) {
        let src: [number, number, number, number];
        if (mod === 3) {
          src = this.getYmm(rm);
        } else {
          const [addr, nextRip] = this.resolveEffectiveAddress(mod, rm, rip, vexB, vexX);
          if (is256) {
            src = this.readF64x4(addr);
          } else {
            const vals = this.readF64x2(addr);
            src = [vals[0], vals[1], 0.0, 0.0];
          }
          rip = nextRip;
        }

        const v = this.getYmm(vvvv);
        const calc = (a: number, b: number) => {
          if (opcode === 0x58) return a + b;
          if (opcode === 0x5c) return a - b;
          if (opcode === 0x59) return a * b;
          if (opcode === 0x5e) return b !== 0 ? a / b : 0.0;
          if (opcode === 0x5f) return Math.max(a, b);
          if (opcode === 0x5d) return Math.min(a, b);
          return 0;
        };

        const r0 = calc(v[0], src[0]);
        const r1 = calc(v[1], src[1]);
        const r2 = is256 ? calc(v[2], src[2]) : 0.0;
        const r3 = is256 ? calc(v[3], src[3]) : 0.0;
        this.setYmm(reg, r0, r1, r2, r3);
        this.registers.rip = rip;
        return;
      }

      // Scalar Double Arithmetic: VADDSD (0x58), VSUBSD (0x5C), VMULSD (0x59), VDIVSD (0x5E), VMAXSD (0x5F), VMINSD (0x5D)
      if (
        map === 1 &&
        pp === 3 &&
        (opcode === 0x58 || opcode === 0x5c || opcode === 0x59 || opcode === 0x5e || opcode === 0x5f || opcode === 0x5d)
      ) {
        let src0 = 0.0;
        if (mod === 3) {
          src0 = this.getYmmLane(rm, 0);
        } else {
          const [addr, nextRip] = this.resolveEffectiveAddress(mod, rm, rip, vexB, vexX);
          src0 = this.readF64(addr);
          rip = nextRip;
        }

        const v0 = this.getYmmLane(vvvv, 0);
        const v1 = this.getYmmLane(vvvv, 1);
        const calc = (a: number, b: number) => {
          if (opcode === 0x58) return a + b;
          if (opcode === 0x5c) return a - b;
          if (opcode === 0x59) return a * b;
          if (opcode === 0x5e) return b !== 0 ? a / b : 0.0;
          if (opcode === 0x5f) return Math.max(a, b);
          if (opcode === 0x5d) return Math.min(a, b);
          return 0;
        };

        const r0 = calc(v0, src0);
        this.setYmm(reg, r0, v1, 0.0, 0.0);
        this.registers.rip = rip;
        return;
      }

      // Bitwise: VXORPD (0x57), VANDPD (0x54), VORPD (0x56)
      if (map === 1 && pp === 1 && (opcode === 0x57 || opcode === 0x54 || opcode === 0x56)) {
        if (opcode === 0x57 && mod === 3 && reg === vvvv && vvvv === rm) {
          this.setYmm(reg, 0.0, 0.0, 0.0, 0.0);
        } else {
          let src: [number, number, number, number];
          if (mod === 3) {
            src = this.getYmm(rm);
          } else {
            const [addr, nextRip] = this.resolveEffectiveAddress(mod, rm, rip, vexB, vexX);
            src = is256 ? this.readF64x4(addr) : [...this.readF64x2(addr), 0.0, 0.0];
            rip = nextRip;
          }
          const v = this.getYmm(vvvv);
          const buf = new ArrayBuffer(16);
          const fView = new Float64Array(buf);
          const iView = new BigUint64Array(buf);
          const bitOp = (a: number, b: number) => {
            fView[0] = a;
            fView[1] = b;
            const res =
              opcode === 0x57 ? iView[0]! ^ iView[1]! : opcode === 0x54 ? iView[0]! & iView[1]! : iView[0]! | iView[1]!;
            iView[0] = res;
            return fView[0]!;
          };
          this.setYmm(
            reg,
            bitOp(v[0], src[0]),
            bitOp(v[1], src[1]),
            is256 ? bitOp(v[2], src[2]) : 0.0,
            is256 ? bitOp(v[3], src[3]) : 0.0,
          );
        }
        this.registers.rip = rip;
        return;
      }

      // FMA3: VFMADD132PD/SD (0x98/0x99), VFMADD213PD/SD (0xA8/0xA9), VFMADD231PD/SD (0xB8/0xB9)
      if (
        map === 2 &&
        (pp === 1 || pp === 3) &&
        (opcode === 0x98 ||
          opcode === 0x99 ||
          opcode === 0xa8 ||
          opcode === 0xa9 ||
          opcode === 0xb8 ||
          opcode === 0xb9 ||
          opcode === 0x9a ||
          opcode === 0x9b ||
          opcode === 0xaa ||
          opcode === 0xab ||
          opcode === 0xba ||
          opcode === 0xbb ||
          opcode === 0x9c ||
          opcode === 0x9d ||
          opcode === 0xac ||
          opcode === 0xad ||
          opcode === 0xbc ||
          opcode === 0xbd)
      ) {
        const isScalar = pp === 3;
        let src: [number, number, number, number];
        if (mod === 3) {
          src = this.getYmm(rm);
        } else {
          const [addr, nextRip] = this.resolveEffectiveAddress(mod, rm, rip, vexB, vexX);
          if (isScalar) {
            src = [this.readF64(addr), 0.0, 0.0, 0.0];
          } else if (is256) {
            src = this.readF64x4(addr);
          } else {
            const vals = this.readF64x2(addr);
            src = [vals[0], vals[1], 0.0, 0.0];
          }
          rip = nextRip;
        }

        const v = this.getYmm(vvvv);
        const d = this.getYmm(reg);

        const fmaOp = (dest: number, vvv: number, s: number, opCode: number) => {
          switch (opCode) {
            case 0x98:
            case 0x99:
              return dest * s + vvv;
            case 0xa8:
            case 0xa9:
              return vvv * dest + s;
            case 0xb8:
            case 0xb9:
              return vvv * s + dest;
            case 0x9a:
            case 0x9b:
              return dest * s - vvv;
            case 0xaa:
            case 0xab:
              return vvv * dest - s;
            case 0xba:
            case 0xbb:
              return vvv * s - dest;
            case 0x9c:
            case 0x9d:
              return -(dest * s) + vvv;
            case 0xac:
            case 0xad:
              return -(vvv * dest) + s;
            case 0xbc:
            case 0xbd:
              return -(vvv * s) + dest;
            default:
              return 0;
          }
        };

        if (isScalar) {
          const r0 = fmaOp(d[0], v[0], src[0], opcode);
          this.setYmm(reg, r0, v[1], 0.0, 0.0);
        } else {
          const r0 = fmaOp(d[0], v[0], src[0], opcode);
          const r1 = fmaOp(d[1], v[1], src[1], opcode);
          const r2 = is256 ? fmaOp(d[2], v[2], src[2], opcode) : 0.0;
          const r3 = is256 ? fmaOp(d[3], v[3], src[3], opcode) : 0.0;
          this.setYmm(reg, r0, r1, r2, r3);
        }
        this.registers.rip = rip;
        return;
      }

      // VBROADCASTSD (map 2, opcode 0x19, pp 1)
      if (map === 2 && opcode === 0x19 && pp === 1) {
        const [addr, nextRip] = this.resolveEffectiveAddress(mod, rm, rip, vexB, vexX);
        const val = this.readF64(addr);
        if (is256) {
          this.setYmm(reg, val, val, val, val);
        } else {
          this.setYmm(reg, val, val, 0.0, 0.0);
        }
        this.registers.rip = nextRip;
        return;
      }

      // AVX2 Integer Operations: VPADDD (0xFE), VPSUBD (0xFA), VPXOR (0xEF)
      if (map === 1 && pp === 1 && (opcode === 0xfe || opcode === 0xfa || opcode === 0xef)) {
        if (opcode === 0xef && mod === 3 && reg === vvvv && vvvv === rm) {
          this.setYmm(reg, 0.0, 0.0, 0.0, 0.0);
        } else {
          const destBuf = new ArrayBuffer(32);
          const vvvBuf = new ArrayBuffer(32);
          const srcBuf = new ArrayBuffer(32);
          const dI32 = new Int32Array(destBuf);
          const vI32 = new Int32Array(vvvBuf);
          const sI32 = new Int32Array(srcBuf);
          const dF64 = new Float64Array(destBuf);
          const vF64 = new Float64Array(vvvBuf);
          const sF64 = new Float64Array(srcBuf);

          const curV = this.getYmm(vvvv);
          vF64.set(curV);

          if (mod === 3) {
            sF64.set(this.getYmm(rm));
          } else {
            const [addr, nextRip] = this.resolveEffectiveAddress(mod, rm, rip, vexB, vexX);
            const vals = is256 ? this.readF64x4(addr) : [...this.readF64x2(addr), 0.0, 0.0];
            sF64.set(vals);
            rip = nextRip;
          }

          const laneCount = is256 ? 8 : 4;
          for (let i = 0; i < laneCount; i++) {
            if (opcode === 0xfe) dI32[i] = (vI32[i]! + sI32[i]!) | 0;
            if (opcode === 0xfa) dI32[i] = (vI32[i]! - sI32[i]!) | 0;
            if (opcode === 0xef) dI32[i] = (vI32[i]! ^ sI32[i]!) | 0;
          }
          this.setYmm(reg, dF64[0]!, dF64[1]!, is256 ? dF64[2]! : 0.0, is256 ? dF64[3]! : 0.0);
        }
        this.registers.rip = rip;
        return;
      }
    }

    // 1. RET (0xC3)
    if (b1 === 0xc3) {
      this.registers.rip = this.pop();
      return;
    }

    // 2. RET imm16 (0xC2)
    if (b1 === 0xc2) {
      const imm16 = this.readU8(rip) | (this.readU8(rip + 1n) << 8);
      rip += 2n;
      this.registers.rip = this.pop();
      this.registers.rsp += BigInt(imm16);
      return;
    }

    // 3. MOV reg, imm (0xB8 - 0xBF)
    if (b1 >= 0xb8 && b1 <= 0xbf) {
      const regId = b1 - 0xb8 + (rexB ? 8 : 0);
      if (rexW) {
        const imm64 = this.readU64(rip);
        rip += 8n;
        this.setRegById(regId, imm64);
      } else {
        const imm32 = this.readU32(rip);
        rip += 4n;
        this.setRegById(regId, BigInt(imm32));
      }
      this.registers.rip = rip;
      return;
    }

    // 4. PUSH reg (0x50 - 0x57)
    if (b1 >= 0x50 && b1 <= 0x57) {
      const regId = b1 - 0x50 + (rexB ? 8 : 0);
      this.push(this.getRegById(regId));
      this.registers.rip = rip;
      return;
    }

    // 4. POP reg (0x58 - 0x5F)
    if (b1 >= 0x58 && b1 <= 0x5f) {
      const regId = b1 - 0x58 + (rexB ? 8 : 0);
      this.setRegById(regId, this.pop());
      this.registers.rip = rip;
      return;
    }

    // 5. CALL rel32 (0xE8)
    if (b1 === 0xe8) {
      const rel32 = this.readI32(rip);
      rip += 4n;
      this.push(rip);
      this.registers.rip = rip + BigInt(rel32);
      return;
    }

    // 6. JMP rel32 (0xE9)
    if (b1 === 0xe9) {
      const rel32 = this.readI32(rip);
      rip += 4n;
      this.registers.rip = rip + BigInt(rel32);
      return;
    }

    // 7. JMP rel8 (0xEB)
    if (b1 === 0xeb) {
      const rel8 = (this.readU8(rip++) << 24) >> 24; // Sign extend
      this.registers.rip = rip + BigInt(rel8);
      return;
    }

    // 8. Conditional jumps Jcc rel8 (0x70 - 0x7F)
    if (b1 >= 0x70 && b1 <= 0x7f) {
      const rel8 = (this.readU8(rip++) << 24) >> 24;
      const cond = this.checkCondition(b1 & 0x0f);
      if (cond) {
        this.registers.rip = rip + BigInt(rel8);
      } else {
        this.registers.rip = rip;
      }
      return;
    }

    // 9. SSE Double Precision (Prefix 0xF2)
    if (b1 === 0xf2 && this.readU8(rip) === 0x0f) {
      rip++; // Skip 0x0F
      const op = this.readU8(rip++);
      const modrm = this.readU8(rip++);
      const reg = ((modrm >> 3) & 7) + (rexR ? 8 : 0);
      const rm = (modrm & 7) + (rexB ? 8 : 0);
      const mod = modrm >> 6;

      if (op === 0x10) {
        // MOVSD xmm, m64/xmm
        if (mod === 3) {
          this.registers.xmm[reg] = this.registers.xmm[rm] ?? 0.0;
        } else {
          const [addr, nextRip] = this.resolveEffectiveAddress(mod, rm, rip, rexB, rexX);
          this.registers.xmm[reg] = this.readF64(addr);
          rip = nextRip;
        }
        this.registers.ymm[reg * 4] = this.registers.xmm[reg] ?? 0.0;
        this.registers.rip = rip;
        return;
      }

      if (op === 0x11) {
        // MOVSD m64/xmm, xmm
        if (mod === 3) {
          this.registers.xmm[rm] = this.registers.xmm[reg] ?? 0.0;
          this.registers.ymm[rm * 4] = this.registers.xmm[rm] ?? 0.0;
        } else {
          const [addr, nextRip] = this.resolveEffectiveAddress(mod, rm, rip, rexB, rexX);
          this.writeF64(addr, this.registers.xmm[reg] ?? 0.0);
          rip = nextRip;
        }
        this.registers.rip = rip;
        return;
      }

      if (op === 0x58 || op === 0x5c || op === 0x59 || op === 0x5e) {
        // ADDSD (0x58), SUBSD (0x5C), MULSD (0x59), DIVSD (0x5E)
        let val2 = 0.0;
        if (mod === 3) {
          val2 = this.registers.xmm[rm] ?? 0.0;
        } else {
          const [addr, nextRip] = this.resolveEffectiveAddress(mod, rm, rip, rexB, rexX);
          val2 = this.readF64(addr);
          rip = nextRip;
        }

        const v1 = this.registers.xmm[reg] ?? 0.0;
        if (op === 0x58) this.registers.xmm[reg] = v1 + val2;
        if (op === 0x5c) this.registers.xmm[reg] = v1 - val2;
        if (op === 0x59) this.registers.xmm[reg] = v1 * val2;
        if (op === 0x5e) this.registers.xmm[reg] = val2 !== 0 ? v1 / val2 : 0.0;

        this.registers.ymm[reg * 4] = this.registers.xmm[reg] ?? 0.0;
        this.registers.rip = rip;
        return;
      }
    }

    // 10. LEA r64, m (0x8D)
    if (b1 === 0x8d) {
      const modrm = this.readU8(rip++);
      const reg = ((modrm >> 3) & 7) + (rexR ? 8 : 0);
      const rm = (modrm & 7) + (rexB ? 8 : 0);
      const mod = modrm >> 6;
      const [addr, nextRip] = this.resolveEffectiveAddress(mod, rm, rip, rexB, rexX);
      this.setRegById(reg, addr);
      this.registers.rip = nextRip;
      return;
    }

    // 11. MOV r/m, r (0x89) and MOV r, r/m (0x8B)
    if (b1 === 0x89 || b1 === 0x8b) {
      const modrm = this.readU8(rip++);
      const reg = ((modrm >> 3) & 7) + (rexR ? 8 : 0);
      const rm = (modrm & 7) + (rexB ? 8 : 0);
      const mod = modrm >> 6;

      if (b1 === 0x89) {
        // MOV r/m, reg
        if (mod === 3) {
          this.setRegById(rm, this.getRegById(reg));
        } else {
          const [addr, nextRip] = this.resolveEffectiveAddress(mod, rm, rip, rexB, rexX);
          if (rexW || this.is64Bit) {
            this.writeU64(addr, this.getRegById(reg));
          } else {
            this.writeU32(addr, Number(this.getRegById(reg) & 0xffffffffn));
          }
          rip = nextRip;
        }
      } else {
        // MOV reg, r/m
        if (mod === 3) {
          this.setRegById(reg, this.getRegById(rm));
        } else {
          const [addr, nextRip] = this.resolveEffectiveAddress(mod, rm, rip, rexB, rexX);
          if (rexW || this.is64Bit) {
            this.setRegById(reg, this.readU64(addr));
          } else {
            this.setRegById(reg, BigInt(this.readU32(addr)));
          }
          rip = nextRip;
        }
      }
      this.registers.rip = rip;
      return;
    }

    // 12. XOR r, r/m (0x33) or XOR r/m, r (0x31)
    if (b1 === 0x31 || b1 === 0x33) {
      const modrm = this.readU8(rip++);
      const reg = ((modrm >> 3) & 7) + (rexR ? 8 : 0);
      const rm = (modrm & 7) + (rexB ? 8 : 0);
      if (modrm >> 6 === 3) {
        const res = this.getRegById(reg) ^ this.getRegById(rm);
        this.setRegById(b1 === 0x31 ? rm : reg, res);
        this.registers.eflags.zf = res === 0n;
        this.registers.eflags.sf = (res & (rexW ? 0x8000000000000000n : 0x80000000n)) !== 0n;
      }
      this.registers.rip = rip;
      return;
    }

    // 13. NOP (0x90)
    if (b1 === 0x90) {
      this.registers.rip = rip;
      return;
    }

    // Advance 1 byte if unrecognized opcode to prevent infinite stall
    this.registers.rip = rip;
  }

  private readI32(addr: bigint): number {
    return this.readU32(addr) << 0;
  }

  private checkCondition(code: number): boolean {
    const f = this.registers.eflags;
    switch (code) {
      case 0x4:
        return f.zf; // JE / JZ
      case 0x5:
        return !f.zf; // JNE / JNZ
      case 0x2:
        return f.cf; // JB / JNAE
      case 0x3:
        return !f.cf; // JAE / JNB
      case 0x6:
        return f.cf || f.zf; // JBE / JNA
      case 0x7:
        return !f.cf && !f.zf; // JA / JNBE
      case 0xc:
        return f.sf !== f.of; // JL
      case 0xd:
        return f.sf === f.of; // JGE
      case 0xe:
        return f.zf || f.sf !== f.of; // JLE
      case 0xf:
        return !f.zf && f.sf === f.of; // JG
      default:
        return false;
    }
  }

  private resolveEffectiveAddress(
    mod: number,
    rm: number,
    rip: bigint,
    rexB: boolean,
    rexX: boolean,
  ): [bigint, bigint] {
    let base = 0n;
    let nextRip = rip;

    if (rm === 4) {
      // SIB Byte present
      const sib = this.readU8(nextRip++);
      const scale = 1 << (sib >> 6);
      const index = ((sib >> 3) & 7) + (rexX ? 8 : 0);
      const baseReg = (sib & 7) + (rexB ? 8 : 0);

      base = this.getRegById(baseReg);
      if (index !== 4) {
        base += this.getRegById(index) * BigInt(scale);
      }
    } else if (mod === 0 && rm === 5) {
      // RIP-relative displacement
      const disp32 = this.readI32(nextRip);
      nextRip += 4n;
      return [nextRip + BigInt(disp32), nextRip];
    } else {
      base = this.getRegById(rm);
    }

    if (mod === 1) {
      // 8-bit sign-extended displacement
      const disp8 = (this.readU8(nextRip++) << 24) >> 24;
      base += BigInt(disp8);
    } else if (mod === 2) {
      // 32-bit displacement
      const disp32 = this.readI32(nextRip);
      nextRip += 4n;
      base += BigInt(disp32);
    }

    return [base, nextRip];
  }

  getRegById(id: number): bigint {
    switch (id) {
      case 0:
        return this.registers.rax;
      case 1:
        return this.registers.rcx;
      case 2:
        return this.registers.rdx;
      case 3:
        return this.registers.rbx;
      case 4:
        return this.registers.rsp;
      case 5:
        return this.registers.rbp;
      case 6:
        return this.registers.rsi;
      case 7:
        return this.registers.rdi;
      case 8:
        return this.registers.r8;
      case 9:
        return this.registers.r9;
      case 10:
        return this.registers.r10;
      case 11:
        return this.registers.r11;
      case 12:
        return this.registers.r12;
      case 13:
        return this.registers.r13;
      case 14:
        return this.registers.r14;
      case 15:
        return this.registers.r15;
      default:
        return 0n;
    }
  }

  setRegById(id: number, val: bigint): void {
    const masked = this.is64Bit ? val : val & 0xffffffffn;
    switch (id) {
      case 0:
        this.registers.rax = masked;
        break;
      case 1:
        this.registers.rcx = masked;
        break;
      case 2:
        this.registers.rdx = masked;
        break;
      case 3:
        this.registers.rbx = masked;
        break;
      case 4:
        this.registers.rsp = masked;
        break;
      case 5:
        this.registers.rbp = masked;
        break;
      case 6:
        this.registers.rsi = masked;
        break;
      case 7:
        this.registers.rdi = masked;
        break;
      case 8:
        this.registers.r8 = masked;
        break;
      case 9:
        this.registers.r9 = masked;
        break;
      case 10:
        this.registers.r10 = masked;
        break;
      case 11:
        this.registers.r11 = masked;
        break;
      case 12:
        this.registers.r12 = masked;
        break;
      case 13:
        this.registers.r13 = masked;
        break;
      case 14:
        this.registers.r14 = masked;
        break;
      case 15:
        this.registers.r15 = masked;
        break;
    }
  }
}
