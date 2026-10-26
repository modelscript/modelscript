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

export class CRuntimeManager {
  private readonly memory: GuestMemorySpace;
  private readonly allocatedBlocks = new Map<bigint, number>();
  readonly handlers = new Map<string, SyscallHandler>();

  constructor(memory: GuestMemorySpace) {
    this.memory = memory;
    this.registerShims();
  }

  /** Allocates a block on the guest heap aligned to 16 bytes. */
  malloc(size: number): bigint {
    const alignedSize = (size + 15) & ~15;
    const currentOff = this.memory.heapPointer ?? this.memory.heapStart ?? 0x1000;
    if (currentOff + alignedSize > this.memory.size) {
      throw new Error("Guest memory out of heap space");
    }
    this.memory.heapPointer = currentOff + alignedSize;

    const guestAddr = this.memory.baseAddress + BigInt(currentOff);
    this.allocatedBlocks.set(guestAddr, size);
    return guestAddr;
  }

  free(ptr: bigint): void {
    this.allocatedBlocks.delete(ptr);
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

    this.handlers.set("free", (ctx) => {
      const ptr = ctx.cpu.getArg(0);
      this.free(ptr);
      ctx.cpu.setReturnInt(0n);
    });

    // Memory buffer operations
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
