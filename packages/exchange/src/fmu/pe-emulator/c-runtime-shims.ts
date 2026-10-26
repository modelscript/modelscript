// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Standard C Runtime (msvcrt / ucrtbase) and Win32 (kernel32) Shims
 * for FMI Dynamic Link Libraries.
 */

import type { GuestMemorySpace, X86RegisterState } from "./types.js";

export interface SyscallContext {
  cpu: {
    registers: X86RegisterState;
    getArg(index: number): bigint;
    getFloatArg(index: number): number;
    setReturnInt(val: bigint | number): void;
    setReturnFloat(val: number): void;
    readString(ptr: bigint): string;
  };
  memory: GuestMemorySpace;
}

export type SyscallHandler = (ctx: SyscallContext) => void;

interface AllocatedBlock {
  offset: number;
  size: number;
  requestedSize: number;
}

interface FreeBlock {
  offset: number;
  size: number;
}

export class CRuntimeManager {
  private readonly memory: GuestMemorySpace;
  private readonly allocatedBlocks = new Map<bigint, AllocatedBlock>();
  private freeBlocks: FreeBlock[] = [];
  readonly handlers = new Map<string, SyscallHandler>();

  constructor(memory: GuestMemorySpace) {
    this.memory = memory;
    this.registerShims();
  }

  /** Allocates a block on the guest heap aligned to 16 bytes using a best-fit freelist. */
  malloc(size: number): bigint {
    const alignedSize = Math.max(16, (size + 15) & ~15);

    // 1. Search free list for best fit block
    let bestIdx = -1;
    let bestSize = Infinity;
    for (let i = 0; i < this.freeBlocks.length; i++) {
      const fb = this.freeBlocks[i]!;
      if (fb.size >= alignedSize && fb.size < bestSize) {
        bestIdx = i;
        bestSize = fb.size;
      }
    }

    if (bestIdx >= 0) {
      const fb = this.freeBlocks[bestIdx]!;
      this.freeBlocks.splice(bestIdx, 1);

      let allocatedSize = fb.size;
      // Split block if remaining space is at least 32 bytes
      if (fb.size >= alignedSize + 32) {
        allocatedSize = alignedSize;
        const remainder: FreeBlock = {
          offset: fb.offset + alignedSize,
          size: fb.size - alignedSize,
        };
        this.insertFreeBlock(remainder);
      }

      const guestAddr = this.memory.baseAddress + BigInt(fb.offset);
      this.allocatedBlocks.set(guestAddr, {
        offset: fb.offset,
        size: allocatedSize,
        requestedSize: size,
      });
      return guestAddr;
    }

    // 2. Bump heap pointer
    const currentOff = this.memory.heapPointer ?? this.memory.heapStart ?? 0x1000;
    if (currentOff + alignedSize > this.memory.size) {
      throw new Error("Guest memory out of heap space");
    }
    this.memory.heapPointer = currentOff + alignedSize;

    const guestAddr = this.memory.baseAddress + BigInt(currentOff);
    this.allocatedBlocks.set(guestAddr, {
      offset: currentOff,
      size: alignedSize,
      requestedSize: size,
    });
    return guestAddr;
  }

  free(ptr: bigint): void {
    if (ptr === 0n) return;
    const block = this.allocatedBlocks.get(ptr);
    if (!block) return;

    this.allocatedBlocks.delete(ptr);
    this.insertFreeBlock({ offset: block.offset, size: block.size });
  }

  realloc(ptr: bigint, newSize: number): bigint {
    if (ptr === 0n) return this.malloc(newSize);
    if (newSize === 0) {
      this.free(ptr);
      return 0n;
    }

    const block = this.allocatedBlocks.get(ptr);
    if (!block) {
      return this.malloc(newSize);
    }

    const newAligned = Math.max(16, (newSize + 15) & ~15);
    if (block.size >= newAligned) {
      block.requestedSize = newSize;
      return ptr;
    }

    const newPtr = this.malloc(newSize);
    const copyLen = Math.min(block.requestedSize, newSize);
    const srcOff = block.offset;
    const dstOff = Number(newPtr - this.memory.baseAddress);
    if (dstOff >= 0 && srcOff >= 0 && dstOff + copyLen <= this.memory.size && srcOff + copyLen <= this.memory.size) {
      this.memory.uint8.copyWithin(dstOff, srcOff, srcOff + copyLen);
    }
    this.free(ptr);
    return newPtr;
  }

  private insertFreeBlock(fb: FreeBlock): void {
    this.freeBlocks.push(fb);
    this.freeBlocks.sort((a, b) => a.offset - b.offset);

    // Coalesce contiguous free blocks
    const merged: FreeBlock[] = [];
    for (const b of this.freeBlocks) {
      if (merged.length > 0) {
        const prev = merged[merged.length - 1]!;
        if (prev.offset + prev.size === b.offset) {
          prev.size += b.size;
          continue;
        }
      }
      merged.push({ offset: b.offset, size: b.size });
    }
    this.freeBlocks = merged;
  }

  private registerShims(): void {
    // Math functions
    this.handlers.set("sin", (ctx) => {
      ctx.cpu.setReturnFloat(Math.sin(ctx.cpu.getFloatArg(0)));
    });
    this.handlers.set("cos", (ctx) => {
      ctx.cpu.setReturnFloat(Math.cos(ctx.cpu.getFloatArg(0)));
    });
    this.handlers.set("tan", (ctx) => {
      ctx.cpu.setReturnFloat(Math.tan(ctx.cpu.getFloatArg(0)));
    });
    this.handlers.set("asin", (ctx) => {
      ctx.cpu.setReturnFloat(Math.asin(ctx.cpu.getFloatArg(0)));
    });
    this.handlers.set("acos", (ctx) => {
      ctx.cpu.setReturnFloat(Math.acos(ctx.cpu.getFloatArg(0)));
    });
    this.handlers.set("atan", (ctx) => {
      ctx.cpu.setReturnFloat(Math.atan(ctx.cpu.getFloatArg(0)));
    });
    this.handlers.set("atan2", (ctx) => {
      ctx.cpu.setReturnFloat(Math.atan2(ctx.cpu.getFloatArg(0), ctx.cpu.getFloatArg(1)));
    });
    this.handlers.set("exp", (ctx) => {
      ctx.cpu.setReturnFloat(Math.exp(ctx.cpu.getFloatArg(0)));
    });
    this.handlers.set("log", (ctx) => {
      ctx.cpu.setReturnFloat(Math.log(ctx.cpu.getFloatArg(0)));
    });
    this.handlers.set("log10", (ctx) => {
      ctx.cpu.setReturnFloat(Math.log10(ctx.cpu.getFloatArg(0)));
    });
    this.handlers.set("pow", (ctx) => {
      ctx.cpu.setReturnFloat(Math.pow(ctx.cpu.getFloatArg(0), ctx.cpu.getFloatArg(1)));
    });
    this.handlers.set("sqrt", (ctx) => {
      ctx.cpu.setReturnFloat(Math.sqrt(ctx.cpu.getFloatArg(0)));
    });
    this.handlers.set("fabs", (ctx) => {
      ctx.cpu.setReturnFloat(Math.abs(ctx.cpu.getFloatArg(0)));
    });
    this.handlers.set("floor", (ctx) => {
      ctx.cpu.setReturnFloat(Math.floor(ctx.cpu.getFloatArg(0)));
    });
    this.handlers.set("ceil", (ctx) => {
      ctx.cpu.setReturnFloat(Math.ceil(ctx.cpu.getFloatArg(0)));
    });
    this.handlers.set("copysign", (ctx) => {
      const x = ctx.cpu.getFloatArg(0);
      const y = ctx.cpu.getFloatArg(1);
      const isNeg = Object.is(y, -0) || y < 0;
      ctx.cpu.setReturnFloat(isNeg ? -Math.abs(x) : Math.abs(x));
    });
    this.handlers.set("_copysign", (ctx) => this.handlers.get("copysign")!(ctx));
    this.handlers.set("fmin", (ctx) => {
      ctx.cpu.setReturnFloat(Math.min(ctx.cpu.getFloatArg(0), ctx.cpu.getFloatArg(1)));
    });
    this.handlers.set("fmax", (ctx) => {
      ctx.cpu.setReturnFloat(Math.max(ctx.cpu.getFloatArg(0), ctx.cpu.getFloatArg(1)));
    });
    this.handlers.set("ldexp", (ctx) => {
      const x = ctx.cpu.getFloatArg(0);
      const exp = Number(ctx.cpu.getArg(1));
      ctx.cpu.setReturnFloat(x * Math.pow(2, exp));
    });

    // Memory Allocation Shims
    this.handlers.set("malloc", (ctx) => {
      const size = Number(ctx.cpu.getArg(0));
      const ptr = this.malloc(size);
      ctx.cpu.setReturnInt(ptr);
    });

    this.handlers.set("calloc", (ctx) => {
      const num = Number(ctx.cpu.getArg(0));
      const size = Number(ctx.cpu.getArg(1));
      const total = num * size;
      const ptr = this.malloc(total);
      const off = Number(ptr - this.memory.baseAddress);
      this.memory.uint8.fill(0, off, off + total);
      ctx.cpu.setReturnInt(ptr);
    });

    this.handlers.set("realloc", (ctx) => {
      const ptr = ctx.cpu.getArg(0);
      const size = Number(ctx.cpu.getArg(1));
      ctx.cpu.setReturnInt(this.realloc(ptr, size));
    });

    this.handlers.set("free", (ctx) => {
      const ptr = ctx.cpu.getArg(0);
      this.free(ptr);
      ctx.cpu.setReturnInt(0n);
    });

    // Memory buffer & string operations
    this.handlers.set("memcpy", (ctx) => {
      const dst = Number(ctx.cpu.getArg(0) - this.memory.baseAddress);
      const src = Number(ctx.cpu.getArg(1) - this.memory.baseAddress);
      const n = Number(ctx.cpu.getArg(2));
      if (dst >= 0 && src >= 0 && dst + n <= this.memory.size && src + n <= this.memory.size) {
        this.memory.uint8.copyWithin(dst, src, src + n);
      }
      ctx.cpu.setReturnInt(ctx.cpu.getArg(0));
    });

    this.handlers.set("memset", (ctx) => {
      const dst = Number(ctx.cpu.getArg(0) - this.memory.baseAddress);
      const val = Number(ctx.cpu.getArg(1)) & 0xff;
      const n = Number(ctx.cpu.getArg(2));
      if (dst >= 0 && dst + n <= this.memory.size) {
        this.memory.uint8.fill(val, dst, dst + n);
      }
      ctx.cpu.setReturnInt(ctx.cpu.getArg(0));
    });

    this.handlers.set("strlen", (ctx) => {
      const ptr = ctx.cpu.getArg(0);
      const off = Number(ptr - this.memory.baseAddress);
      if (off < 0 || off >= this.memory.size) {
        ctx.cpu.setReturnInt(0n);
        return;
      }
      let len = 0;
      while (off + len < this.memory.size && this.memory.uint8[off + len] !== 0) {
        len++;
      }
      ctx.cpu.setReturnInt(BigInt(len));
    });

    this.handlers.set("strcpy", (ctx) => {
      const dstPtr = ctx.cpu.getArg(0);
      const srcPtr = ctx.cpu.getArg(1);
      let dstOff = Number(dstPtr - this.memory.baseAddress);
      let srcOff = Number(srcPtr - this.memory.baseAddress);
      if (dstOff >= 0 && srcOff >= 0) {
        while (srcOff < this.memory.size && dstOff < this.memory.size) {
          const b = this.memory.uint8[srcOff++]!;
          this.memory.uint8[dstOff++] = b;
          if (b === 0) break;
        }
      }
      ctx.cpu.setReturnInt(dstPtr);
    });

    this.handlers.set("strncpy", (ctx) => {
      const dstPtr = ctx.cpu.getArg(0);
      const srcPtr = ctx.cpu.getArg(1);
      const n = Number(ctx.cpu.getArg(2));
      const dstOff = Number(dstPtr - this.memory.baseAddress);
      const srcOff = Number(srcPtr - this.memory.baseAddress);
      let nullPadded = false;
      for (let i = 0; i < n && dstOff + i < this.memory.size; i++) {
        if (!nullPadded && srcOff + i < this.memory.size) {
          const b = this.memory.uint8[srcOff + i]!;
          this.memory.uint8[dstOff + i] = b;
          if (b === 0) nullPadded = true;
        } else {
          this.memory.uint8[dstOff + i] = 0;
        }
      }
      ctx.cpu.setReturnInt(dstPtr);
    });

    this.handlers.set("strcmp", (ctx) => {
      const s1Ptr = ctx.cpu.getArg(0);
      const s2Ptr = ctx.cpu.getArg(1);
      let s1Off = Number(s1Ptr - this.memory.baseAddress);
      let s2Off = Number(s2Ptr - this.memory.baseAddress);
      let diff = 0;
      while (s1Off < this.memory.size && s2Off < this.memory.size) {
        const b1 = this.memory.uint8[s1Off++]!;
        const b2 = this.memory.uint8[s2Off++]!;
        if (b1 !== b2) {
          diff = b1 - b2;
          break;
        }
        if (b1 === 0) break;
      }
      ctx.cpu.setReturnInt(BigInt(diff));
    });

    this.handlers.set("strncmp", (ctx) => {
      const s1Ptr = ctx.cpu.getArg(0);
      const s2Ptr = ctx.cpu.getArg(1);
      const n = Number(ctx.cpu.getArg(2));
      const s1Off = Number(s1Ptr - this.memory.baseAddress);
      const s2Off = Number(s2Ptr - this.memory.baseAddress);
      let diff = 0;
      for (let i = 0; i < n; i++) {
        const b1 = s1Off + i < this.memory.size ? this.memory.uint8[s1Off + i]! : 0;
        const b2 = s2Off + i < this.memory.size ? this.memory.uint8[s2Off + i]! : 0;
        if (b1 !== b2) {
          diff = b1 - b2;
          break;
        }
        if (b1 === 0) break;
      }
      ctx.cpu.setReturnInt(BigInt(diff));
    });

    const formatString = (ctx: SyscallContext, fmtPtr: bigint, startArgIndex: number): string => {
      const fmt = ctx.cpu.readString(fmtPtr);
      let out = "";
      let argIdx = startArgIndex;
      for (let i = 0; i < fmt.length; i++) {
        if (fmt[i] === "%" && i + 1 < fmt.length) {
          i++;
          const ch = fmt[i];
          if (ch === "s") {
            const strPtr = ctx.cpu.getArg(argIdx++);
            out += ctx.cpu.readString(strPtr);
          } else if (ch === "d" || ch === "i") {
            const val = ctx.cpu.getArg(argIdx++);
            out += (Number(val & 0xffffffffn) | 0).toString();
          } else if (ch === "u") {
            const val = ctx.cpu.getArg(argIdx++);
            out += (Number(val & 0xffffffffn) >>> 0).toString();
          } else if (ch === "x" || ch === "X") {
            const val = ctx.cpu.getArg(argIdx++);
            out += (Number(val & 0xffffffffn) >>> 0).toString(16);
          } else if (ch === "p") {
            const val = ctx.cpu.getArg(argIdx++);
            out += "0x" + val.toString(16);
          } else if (ch === "f" || ch === "g") {
            const f = ctx.cpu.getFloatArg(argIdx++);
            out += f.toString();
          } else if (ch === "%") {
            out += "%";
          } else {
            out += "%" + ch;
          }
        } else {
          out += fmt[i];
        }
      }
      return out;
    };

    this.handlers.set("sprintf", (ctx) => {
      const dstPtr = ctx.cpu.getArg(0);
      const fmtPtr = ctx.cpu.getArg(1);
      const formatted = formatString(ctx, fmtPtr, 2);
      const enc = new TextEncoder().encode(formatted);
      const dstOff = Number(dstPtr - this.memory.baseAddress);
      if (dstOff >= 0 && dstOff + enc.length + 1 <= this.memory.size) {
        this.memory.uint8.set(enc, dstOff);
        this.memory.uint8[dstOff + enc.length] = 0;
      }
      ctx.cpu.setReturnInt(BigInt(enc.length));
    });

    this.handlers.set("snprintf", (ctx) => {
      const dstPtr = ctx.cpu.getArg(0);
      const maxLen = Number(ctx.cpu.getArg(1));
      const fmtPtr = ctx.cpu.getArg(2);
      const formatted = formatString(ctx, fmtPtr, 3);
      const enc = new TextEncoder().encode(formatted);
      const dstOff = Number(dstPtr - this.memory.baseAddress);
      if (dstOff >= 0 && maxLen > 0 && dstOff < this.memory.size) {
        const copyLen = Math.min(enc.length, maxLen - 1);
        this.memory.uint8.set(enc.subarray(0, copyLen), dstOff);
        this.memory.uint8[dstOff + copyLen] = 0;
      }
      ctx.cpu.setReturnInt(BigInt(enc.length));
    });

    // Windows Kernel32 timing and synchronization shims
    this.handlers.set("QueryPerformanceCounter", (ctx) => {
      const lpCounter = ctx.cpu.getArg(0);
      const off = Number(lpCounter - this.memory.baseAddress);
      if (off >= 0 && off + 8 <= this.memory.size) {
        const timeUs = BigInt(Math.floor(performance.now() * 1000));
        this.memory.dataView.setBigInt64(off, timeUs, true);
        ctx.cpu.setReturnInt(1n); // TRUE
      } else {
        ctx.cpu.setReturnInt(0n);
      }
    });

    this.handlers.set("QueryPerformanceFrequency", (ctx) => {
      const lpFreq = ctx.cpu.getArg(0);
      const off = Number(lpFreq - this.memory.baseAddress);
      if (off >= 0 && off + 8 <= this.memory.size) {
        this.memory.dataView.setBigInt64(off, 1000000n, true); // 1 MHz
        ctx.cpu.setReturnInt(1n);
      } else {
        ctx.cpu.setReturnInt(0n);
      }
    });

    this.handlers.set("GetTickCount", (ctx) => {
      ctx.cpu.setReturnInt(BigInt(Math.floor(performance.now())));
    });

    this.handlers.set("GetSystemTimeAsFileTime", (ctx) => {
      const lpFileTime = ctx.cpu.getArg(0);
      const off = Number(lpFileTime - this.memory.baseAddress);
      if (off >= 0 && off + 8 <= this.memory.size) {
        // 100-nanosecond intervals since Jan 1, 1601
        const nowMs = BigInt(Date.now());
        const fileTime = (nowMs + 11644473600000n) * 10000n;
        this.memory.dataView.setBigUint64(off, fileTime, true);
      }
      ctx.cpu.setReturnInt(0n);
    });

    // Critical section stubs (single-threaded in browser)
    this.handlers.set("InitializeCriticalSection", (ctx) => ctx.cpu.setReturnInt(0n));
    this.handlers.set("InitializeCriticalSectionAndSpinCount", (ctx) => ctx.cpu.setReturnInt(1n));
    this.handlers.set("EnterCriticalSection", (ctx) => ctx.cpu.setReturnInt(0n));
    this.handlers.set("LeaveCriticalSection", (ctx) => ctx.cpu.setReturnInt(0n));
    this.handlers.set("DeleteCriticalSection", (ctx) => ctx.cpu.setReturnInt(0n));

    // Win32 Heap functions
    this.handlers.set("GetProcessHeap", (ctx) => ctx.cpu.setReturnInt(0x10000n));
    this.handlers.set("HeapAlloc", (ctx) => {
      const size = Number(ctx.cpu.getArg(2));
      ctx.cpu.setReturnInt(this.malloc(size));
    });
    this.handlers.set("HeapFree", (ctx) => {
      this.free(ctx.cpu.getArg(2));
      ctx.cpu.setReturnInt(1n);
    });

    // POSIX / Linux glibc Shims
    this.handlers.set("clock_gettime", (ctx) => {
      const tp = ctx.cpu.getArg(1);
      const off = Number(tp - this.memory.baseAddress);
      if (off >= 0 && off + 16 <= this.memory.size) {
        const now = performance.now();
        const sec = BigInt(Math.floor(now / 1000));
        const nsec = BigInt(Math.floor((now % 1000) * 1e6));
        this.memory.dataView.setBigInt64(off, sec, true);
        this.memory.dataView.setBigInt64(off + 8, nsec, true);
        ctx.cpu.setReturnInt(0n); // Success
      } else {
        ctx.cpu.setReturnInt(-1n);
      }
    });

    this.handlers.set("gettimeofday", (ctx) => {
      const tv = ctx.cpu.getArg(0);
      const off = Number(tv - this.memory.baseAddress);
      if (off >= 0 && off + 16 <= this.memory.size) {
        const now = performance.now();
        const sec = BigInt(Math.floor(now / 1000));
        const usec = BigInt(Math.floor((now % 1000) * 1000));
        this.memory.dataView.setBigInt64(off, sec, true);
        this.memory.dataView.setBigInt64(off + 8, usec, true);
        ctx.cpu.setReturnInt(0n);
      } else {
        ctx.cpu.setReturnInt(-1n);
      }
    });

    // Thread-local errno slot
    let errnoSlotPtr = 0n;
    this.handlers.set("__errno_location", (ctx) => {
      if (errnoSlotPtr === 0n) {
        errnoSlotPtr = this.malloc(8);
      }
      ctx.cpu.setReturnInt(errnoSlotPtr);
    });

    this.handlers.set("mmap", (ctx) => {
      const len = Number(ctx.cpu.getArg(1));
      ctx.cpu.setReturnInt(this.malloc(len));
    });

    this.handlers.set("munmap", (ctx) => {
      this.free(ctx.cpu.getArg(0));
      ctx.cpu.setReturnInt(0n);
    });

    this.handlers.set("pthread_mutex_init", (ctx) => ctx.cpu.setReturnInt(0n));
    this.handlers.set("pthread_mutex_lock", (ctx) => ctx.cpu.setReturnInt(0n));
    this.handlers.set("pthread_mutex_unlock", (ctx) => ctx.cpu.setReturnInt(0n));
    this.handlers.set("pthread_mutex_destroy", (ctx) => ctx.cpu.setReturnInt(0n));

    // Fortran GNU & Intel Runtime Shims
    this.handlers.set("_gfortran_st_write", (ctx) => ctx.cpu.setReturnInt(0n));
    this.handlers.set("_gfortran_st_write_done", (ctx) => ctx.cpu.setReturnInt(0n));
    this.handlers.set("_gfortran_transfer_real_write", (ctx) => ctx.cpu.setReturnInt(0n));
    this.handlers.set("_gfortran_transfer_integer_write", (ctx) => ctx.cpu.setReturnInt(0n));
    this.handlers.set("_gfortran_stop_numeric", (ctx) => ctx.cpu.setReturnInt(0n));
    this.handlers.set("for_write_seq_fmt", (ctx) => ctx.cpu.setReturnInt(0n));

    // C++ dynamic registration shims
    this.handlers.set("__cxa_atexit", (ctx) => ctx.cpu.setReturnInt(0n));
    this.handlers.set("__tls_get_addr", (ctx) => ctx.cpu.setReturnInt(errnoSlotPtr || 0x20000n));
  }
}
