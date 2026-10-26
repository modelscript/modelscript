// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import {
  CRuntimeManager,
  ElfLoader,
  PeLoader,
  R_AARCH64_GLOB_DAT,
  R_AARCH64_JUMP_SLOT,
  R_AARCH64_RELATIVE,
  R_X86_64_GLOB_DAT,
  R_X86_64_JUMP_SLOT,
  R_X86_64_RELATIVE,
  X86Cpu,
  type GuestMemorySpace,
} from "../src/fmu/pe-emulator/index.js";

console.log("=== Running PE Imports, ELF Relocations & C-Runtime Hardening Tests ===");

function createMockGuestMemory(size = 1024 * 1024): GuestMemorySpace {
  const buffer = new ArrayBuffer(size);
  const dataView = new DataView(buffer);
  const uint8 = new Uint8Array(buffer);
  const baseAddress = 0x140000000n;
  const heapStart = 0x10000;
  return {
    buffer,
    dataView,
    uint8,
    baseAddress,
    size,
    heapStart,
    heapPointer: heapStart,
  };
}

// ============================================================================
// TEST 1: CRuntimeManager Freelist Allocator with Block Splitting & Coalescing
// ============================================================================
console.log("1. Testing CRuntimeManager freelist allocator...");
const mem = createMockGuestMemory();
const cruntime = new CRuntimeManager(mem);

// Allocate three contiguous blocks
const ptrA = cruntime.malloc(64);
const ptrB = cruntime.malloc(128);
const ptrC = cruntime.malloc(64);

assert.strictEqual(ptrA, mem.baseAddress + BigInt(mem.heapStart!));
assert.ok(ptrB > ptrA);
assert.ok(ptrC > ptrB);

// Free middle block B
cruntime.free(ptrB);

// Allocate block of 64 bytes - should reuse B's slot via best-fit and split!
const ptrB1 = cruntime.malloc(64);
assert.strictEqual(ptrB1, ptrB, "Must reuse freed block ptrB");

// Free B1, A, and C
cruntime.free(ptrB1);
cruntime.free(ptrA);
cruntime.free(ptrC);

// Allocating a large block should now fit into the coalesced free space!
const largePtr = cruntime.malloc(200);
assert.strictEqual(largePtr, ptrA, "Coalesced contiguous free blocks must satisfy large allocation");

console.log("✓ Test 1 passed: Freelist best-fit and block coalescing verified.");

// ============================================================================
// TEST 2: CRuntimeManager realloc() Implementation
// ============================================================================
console.log("2. Testing CRuntimeManager realloc()...");
const rMem = createMockGuestMemory();
const rCruntime = new CRuntimeManager(rMem);

// Allocate initial block and write data
const initialPtr = rCruntime.malloc(32);
const initialOff = Number(initialPtr - rMem.baseAddress);
rMem.uint8.set([1, 2, 3, 4, 5, 6, 7, 8], initialOff);

// In-place grow if capacity permits
const samePtr = rCruntime.realloc(initialPtr, 32);
assert.strictEqual(samePtr, initialPtr);

// Grow larger than original block
const biggerPtr = rCruntime.realloc(initialPtr, 256);
assert.ok(biggerPtr !== 0n);
const biggerOff = Number(biggerPtr - rMem.baseAddress);
assert.deepStrictEqual(Array.from(rMem.uint8.subarray(biggerOff, biggerOff + 8)), [1, 2, 3, 4, 5, 6, 7, 8]);

// realloc(ptr, 0) behaves as free
const freedZero = rCruntime.realloc(biggerPtr, 0);
assert.strictEqual(freedZero, 0n);

console.log("✓ Test 2 passed: realloc() memory preservation and reallocation verified.");

// ============================================================================
// TEST 3: C-Runtime Math & String Shims (strlen, strcpy, strncpy, strcmp, snprintf, copysign)
// ============================================================================
console.log("3. Testing C-Runtime string and math shims...");
const sMem = createMockGuestMemory();
const sCruntime = new CRuntimeManager(sMem);
const cpu = new X86Cpu(sMem, true, sCruntime);

// Mock CPU SyscallContext
const createCtx = (intArgs: bigint[], floatArgs: number[] = []) => {
  let retInt = 0n;
  let retFloat = 0.0;
  return {
    ctx: {
      cpu: {
        registers: cpu.registers,
        getArg: (idx: number) => intArgs[idx] ?? 0n,
        getFloatArg: (idx: number) => floatArgs[idx] ?? 0.0,
        setReturnInt: (val: bigint | number) => {
          retInt = typeof val === "bigint" ? val : BigInt(val);
        },
        setReturnFloat: (val: number) => {
          retFloat = val;
        },
        readString: (ptr: bigint) => cpu.readString(ptr),
      },
      memory: sMem,
    },
    getRetInt: () => retInt,
    getRetFloat: () => retFloat,
  };
};

// Test strlen
const helloStr = new TextEncoder().encode("ModelScript\0");
const strPtr = sCruntime.malloc(32);
sMem.uint8.set(helloStr, Number(strPtr - sMem.baseAddress));

const { ctx: strlenCtx, getRetInt: getStrlen } = createCtx([strPtr]);
sCruntime.handlers.get("strlen")!(strlenCtx);
assert.strictEqual(getStrlen(), 11n, "strlen must return 11 for 'ModelScript'");

// Test strcmp & strncmp
const str2Ptr = sCruntime.malloc(32);
sMem.uint8.set(new TextEncoder().encode("ModelEngine\0"), Number(str2Ptr - sMem.baseAddress));

const { ctx: strcmpCtx, getRetInt: getStrcmp } = createCtx([strPtr, str2Ptr]);
sCruntime.handlers.get("strcmp")!(strcmpCtx);
assert.ok(getStrcmp() !== 0n, "strcmp must detect string mismatch");

const { ctx: strncmpCtx, getRetInt: getStrncmp } = createCtx([strPtr, str2Ptr, 5n]);
sCruntime.handlers.get("strncmp")!(strncmpCtx);
assert.strictEqual(getStrncmp(), 0n, "strncmp first 5 chars 'Model' must match");

// Test snprintf
const fmtPtr = sCruntime.malloc(32);
sMem.uint8.set(new TextEncoder().encode("val: %d, str: %s\0"), Number(fmtPtr - sMem.baseAddress));
const outBufPtr = sCruntime.malloc(64);
const argStrPtr = sCruntime.malloc(16);
sMem.uint8.set(new TextEncoder().encode("ok\0"), Number(argStrPtr - sMem.baseAddress));

const { ctx: snprintfCtx, getRetInt: getSnprintf } = createCtx([outBufPtr, 64n, fmtPtr, 42n, argStrPtr]);
sCruntime.handlers.get("snprintf")!(snprintfCtx);
assert.ok(getSnprintf() > 0n);
const formattedResult = cpu.readString(outBufPtr);
assert.strictEqual(formattedResult, "val: 42, str: ok");

// Test math shims
const { ctx: copysignCtx, getRetFloat: getCopysign } = createCtx([], [5.5, -1.0]);
sCruntime.handlers.get("copysign")!(copysignCtx);
assert.strictEqual(getCopysign(), -5.5);

const { ctx: fminCtx, getRetFloat: getFmin } = createCtx([], [3.14, 2.71]);
sCruntime.handlers.get("fmin")!(fminCtx);
assert.strictEqual(getFmin(), 2.71);

const { ctx: ldexpCtx, getRetFloat: getLdexp } = createCtx([0n, 3n], [1.5]);
sCruntime.handlers.get("ldexp")!(ldexpCtx);
assert.strictEqual(getLdexp(), 12.0); // 1.5 * 2^3 = 12.0

console.log("✓ Test 3 passed: Standard C string and math shims validated.");

// ============================================================================
// TEST 4: PE Import Table Parsing in PeLoader
// ============================================================================
console.log("4. Testing PE Import Table parsing in PeLoader...");

function createPeWithImportTable(): Uint8Array {
  const buf = new Uint8Array(4096);
  const view = new DataView(buf.buffer);

  // DOS Header ('MZ')
  buf[0] = 0x4d;
  buf[1] = 0x5a;
  view.setUint32(60, 128, true); // e_lfanew = 128

  const pe = 128;
  buf[pe + 0] = 0x50;
  buf[pe + 1] = 0x45;

  // COFF Header
  view.setUint16(pe + 4, 0x8664, true); // AMD64
  view.setUint16(pe + 6, 2, true); // 2 sections (.text, .idata)
  view.setUint16(pe + 20, 240, true);
  view.setUint16(pe + 22, 0x2022, true);

  // Optional Header
  const opt = pe + 24;
  view.setUint16(opt + 0, 0x020b, true); // PE32+
  view.setBigUint64(opt + 24, 0x140000000n, true);
  view.setUint32(opt + 32, 0x1000, true); // SectionAlignment
  view.setUint32(opt + 36, 0x200, true); // FileAlignment
  view.setUint32(opt + 56, 0x3000, true);
  view.setUint32(opt + 60, 0x200, true);

  // Data Directory 1: Import Table (RVA 0x2000, Size 0x200)
  view.setUint32(opt + 120, 0x2000, true);
  view.setUint32(opt + 124, 0x200, true);

  // Section 0: .text
  const sec0 = opt + 240;
  buf.set(new TextEncoder().encode(".text\0\0\0"), sec0);
  view.setUint32(sec0 + 8, 0x200, true);
  view.setUint32(sec0 + 12, 0x1000, true);
  view.setUint32(sec0 + 16, 0x200, true);
  view.setUint32(sec0 + 20, 0x200, true);

  // Section 1: .idata (RVA 0x2000, offset 0x400)
  const sec1 = sec0 + 40;
  buf.set(new TextEncoder().encode(".idata\0\0"), sec1);
  view.setUint32(sec1 + 8, 0x400, true);
  view.setUint32(sec1 + 12, 0x2000, true);
  view.setUint32(sec1 + 16, 0x400, true);
  view.setUint32(sec1 + 20, 0x400, true);

  // .idata content (at file offset 0x400)
  const idata = 0x400;
  // IMAGE_IMPORT_DESCRIPTOR:
  // OriginalFirstThunk (RVA 0x2030 -> idata + 0x30)
  view.setUint32(idata + 0, 0x2030, true);
  // Name RVA (0x2060 -> idata + 0x60)
  view.setUint32(idata + 12, 0x2060, true);
  // FirstThunk (IAT) RVA (0x2040 -> idata + 0x40)
  view.setUint32(idata + 16, 0x2040, true);

  // ILT (at 0x2030, file offset idata + 0x30)
  view.setBigUint64(idata + 0x30, 0x2080n, true); // points to Hint/Name at 0x2080
  view.setBigUint64(idata + 0x38, 0n, true); // terminating 0

  // IAT (at 0x2040, file offset idata + 0x40)
  view.setBigUint64(idata + 0x40, 0x2080n, true);
  view.setBigUint64(idata + 0x48, 0n, true);

  // DLL Name string at 0x2060 (idata + 0x60)
  buf.set(new TextEncoder().encode("msvcrt.dll\0"), idata + 0x60);

  // Hint/Name at 0x2080 (idata + 0x80): uint16 Hint + "malloc\0"
  view.setUint16(idata + 0x80, 1, true);
  buf.set(new TextEncoder().encode("malloc\0"), idata + 0x82);

  return buf;
}

const peWithImports = createPeWithImportTable();
const peLoader = new PeLoader(peWithImports);
assert.ok(peLoader.imports.length > 0, "Must parse imported symbols from Import Table");
const mallocImport = peLoader.imports.find((i) => i.functionName === "malloc");
assert.ok(mallocImport, "Must find 'malloc' in imports");
assert.strictEqual(mallocImport.dllName, "msvcrt.dll");
assert.strictEqual(mallocImport.iatRva, 0x2040);
console.log("✓ Test 4 passed: PeLoader successfully parsed Import Table, DLL name, and IAT slot.");

// ============================================================================
// TEST 5: ELF Loader Dynamic Relocations (GLOB_DAT / JUMP_SLOT) & Resolution
// ============================================================================
console.log("5. Testing ELF Loader dynamic relocations and AArch64 constants...");

assert.strictEqual(R_X86_64_RELATIVE, 8);
assert.strictEqual(R_X86_64_GLOB_DAT, 6);
assert.strictEqual(R_X86_64_JUMP_SLOT, 7);
assert.strictEqual(R_AARCH64_RELATIVE, 1027);
assert.strictEqual(R_AARCH64_GLOB_DAT, 1025);
assert.strictEqual(R_AARCH64_JUMP_SLOT, 1026);

function createElfWithRelocations(): Uint8Array {
  const buf = new Uint8Array(4096);
  const view = new DataView(buf.buffer);

  // ELF Header (64 bytes)
  buf[0] = 0x7f;
  buf[1] = 0x45;
  buf[2] = 0x4c;
  buf[3] = 0x46;
  buf[4] = 2; // 64-bit
  buf[5] = 1; // Little-endian
  buf[6] = 1;

  view.setUint16(16, 3, true); // ET_DYN
  view.setUint16(18, 0x3e, true); // EM_X86_64
  view.setUint32(20, 1, true);
  view.setBigUint64(24, 0x1000n, true); // entry
  view.setBigUint64(32, 64n, true); // phOff
  view.setUint16(52, 64, true);
  view.setUint16(54, 56, true);
  view.setUint16(56, 2, true); // 2 program headers: PT_LOAD and PT_DYNAMIC

  // PH 0: PT_LOAD (offset 0, vaddr 0, size 4096)
  const ph0 = 64;
  view.setUint32(ph0 + 0, 1, true);
  view.setUint32(ph0 + 4, 7, true);
  view.setBigUint64(ph0 + 8, 0n, true);
  view.setBigUint64(ph0 + 16, 0n, true);
  view.setBigUint64(ph0 + 32, 4096n, true);
  view.setBigUint64(ph0 + 40, 4096n, true);

  // PH 1: PT_DYNAMIC (offset 0x200, vaddr 0x200, size 0x100)
  const ph1 = ph0 + 56;
  view.setUint32(ph1 + 0, 2, true);
  view.setUint32(ph1 + 4, 6, true);
  view.setBigUint64(ph1 + 8, 0x200n, true);
  view.setBigUint64(ph1 + 16, 0x200n, true);
  view.setBigUint64(ph1 + 32, 0x100n, true);
  view.setBigUint64(ph1 + 40, 0x100n, true);

  // Dynamic Entries at 0x200
  let dyn = 0x200;
  // DT_STRTAB (5) -> 0x500
  view.setBigInt64(dyn, 5n, true);
  view.setBigUint64(dyn + 8, 0x500n, true);
  dyn += 16;
  // DT_STRSZ (10) -> 128
  view.setBigInt64(dyn, 10n, true);
  view.setBigUint64(dyn + 8, 128n, true);
  dyn += 16;
  // DT_SYMTAB (6) -> 0x600
  view.setBigInt64(dyn, 6n, true);
  view.setBigUint64(dyn + 8, 0x600n, true);
  dyn += 16;
  // DT_RELA (7) -> 0x700
  view.setBigInt64(dyn, 7n, true);
  view.setBigUint64(dyn + 8, 0x700n, true);
  dyn += 16;
  // DT_RELASZ (8) -> 48 (2 entries of 24 bytes)
  view.setBigInt64(dyn, 8n, true);
  view.setBigUint64(dyn + 8, 48n, true);
  dyn += 16;
  // DT_RELAENT (9) -> 24
  view.setBigInt64(dyn, 9n, true);
  view.setBigUint64(dyn + 8, 24n, true);
  dyn += 16;
  // DT_NULL (0)
  view.setBigInt64(dyn, 0n, true);

  // String Table at 0x500
  buf[0x500] = 0;
  buf.set(new TextEncoder().encode("cos\0"), 0x501);

  // Symbol Table at 0x600: Entry 0 (NULL), Entry 1 ("cos")
  // Entry 1 at 0x600 + 24 = 0x618
  view.setUint32(0x618, 1, true); // st_name = 1 ("cos")

  // Relocations at 0x700:
  // Entry 0: R_X86_64_RELATIVE at offset 0x800 with addend 0x123
  view.setBigUint64(0x700, 0x800n, true); // offset
  view.setBigUint64(0x708, BigInt(R_X86_64_RELATIVE), true); // info
  view.setBigInt64(0x710, 0x123n, true); // addend

  // Entry 1: R_X86_64_JUMP_SLOT at offset 0x808 for symIndex 1 ("cos")
  view.setBigUint64(0x718, 0x808n, true);
  const jumpSlotInfo = (1n << 32n) | BigInt(R_X86_64_JUMP_SLOT);
  view.setBigUint64(0x720, jumpSlotInfo, true);
  view.setBigInt64(0x728, 0n, true);

  return buf;
}

const elfData = createElfWithRelocations();
const elfLoader = new ElfLoader(elfData);
assert.strictEqual(elfLoader.relocations.length, 2);

// Map image and resolve dynamic hooks
const hostHookAddr = 0xffff0042n;
const elfGuestMem = elfLoader.mapImageToMemory(0x140000000n, (symName) => {
  if (symName === "cos") return hostHookAddr;
  return null;
});

// Verify R_X86_64_RELATIVE applied (Base + Addend)
const relVal = elfGuestMem.dataView.getBigUint64(0x800, true);
assert.strictEqual(relVal, 0x140000000n + 0x123n);

// Verify R_X86_64_JUMP_SLOT resolved to hostHookAddr
const jumpSlotVal = elfGuestMem.dataView.getBigUint64(0x808, true);
assert.strictEqual(jumpSlotVal, hostHookAddr);

console.log("✓ Test 5 passed: ELF relative and JUMP_SLOT dynamic relocations verified.");

console.log("\n=======================================================");
console.log("ALL PE IMPORTS, RELOCATIONS & C-RUNTIME TESTS PASSED!");
console.log("=======================================================\n");
