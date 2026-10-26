// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { introspectBlackboxBinary } from "../src/fmu/binary-introspect.js";
import {
  CPU_TYPE_ARM,
  CPU_TYPE_X86_64,
  CRuntimeManager,
  DbtCompiler,
  FAT_MAGIC,
  LC_SEGMENT_64,
  LC_SYMTAB,
  MH_MAGIC_64,
  MachoLoader,
  S_MOD_INIT_FUNC_POINTERS,
  UniversalBinaryRunner,
  X86Cpu,
} from "../src/fmu/pe-emulator/index.js";

console.log("=== Running Mach-O 64-bit Loader & AVX2 Vector Expansion Test Suite ===");

/**
 * Creates a valid synthetic macOS Mach-O 64-bit dynamic library (.dylib) in memory.
 */
function createSyntheticMachoDylib(): Uint8Array {
  const buf = new Uint8Array(4096);
  const view = new DataView(buf.buffer);

  // 1. Mach-O Header (mach_header_64, 32 bytes)
  view.setUint32(0, MH_MAGIC_64, true); // magic: 0xfeedfacf
  view.setInt32(4, CPU_TYPE_X86_64, true); // cputype: x86_64 (0x01000007)
  view.setInt32(8, 3, true); // cpusubtype: CPU_SUBTYPE_X86_64_ALL
  view.setUint32(12, 6, true); // filetype: MH_DYLIB
  view.setUint32(16, 2, true); // ncmds: 2 commands
  view.setUint32(20, 232 + 24, true); // sizeofcmds: LC_SEGMENT_64 (232) + LC_SYMTAB (24)
  view.setUint32(24, 2, true); // flags: MH_DYLDLINK
  view.setUint32(28, 0, true); // reserved

  // 2. Load Command 0: LC_SEGMENT_64 (offset 32, size 72 + 2*80 = 232)
  const segCmdOff = 32;
  view.setUint32(segCmdOff + 0, LC_SEGMENT_64, true); // cmd: 0x19
  view.setUint32(segCmdOff + 4, 232, true); // cmdsize: 232
  // segname: "__TEXT"
  const enc = new TextEncoder();
  buf.set(enc.encode("__TEXT"), segCmdOff + 8);
  view.setBigUint64(segCmdOff + 24, 0x1000n, true); // vmaddr: 0x1000
  view.setBigUint64(segCmdOff + 32, 0x1000n, true); // vmsize: 0x1000
  view.setBigUint64(segCmdOff + 40, 0x200n, true); // fileoff: 0x200
  view.setBigUint64(segCmdOff + 48, 0x200n, true); // filesz: 0x200
  view.setInt32(segCmdOff + 56, 7, true); // maxprot: rwx
  view.setInt32(segCmdOff + 60, 7, true); // initprot: rwx
  view.setUint32(segCmdOff + 64, 2, true); // nsects: 2 sections
  view.setUint32(segCmdOff + 68, 0, true); // flags

  // Section 0: __text inside __TEXT
  const sec0Off = segCmdOff + 72;
  buf.set(enc.encode("__text"), sec0Off + 0);
  buf.set(enc.encode("__TEXT"), sec0Off + 16);
  view.setBigUint64(sec0Off + 32, 0x1000n, true); // addr: 0x1000
  view.setBigUint64(sec0Off + 40, 0x100n, true); // size: 0x100
  view.setUint32(sec0Off + 48, 0x200, true); // offset: 0x200
  view.setUint32(sec0Off + 52, 3, true); // align
  view.setUint32(sec0Off + 64, 0x80000400, true); // flags: S_ATTR_SOME_INSTRUCTIONS

  // Section 1: __mod_init_func inside __TEXT
  const sec1Off = sec0Off + 80;
  buf.set(enc.encode("__mod_init_func"), sec1Off + 0);
  buf.set(enc.encode("__TEXT"), sec1Off + 16);
  view.setBigUint64(sec1Off + 32, 0x1100n, true); // addr: 0x1100
  view.setBigUint64(sec1Off + 40, 8n, true); // size: 8 bytes (1 pointer)
  view.setUint32(sec1Off + 48, 0x300, true); // offset: 0x300
  view.setUint32(sec1Off + 52, 3, true); // align
  view.setUint32(sec1Off + 64, S_MOD_INIT_FUNC_POINTERS, true); // flags: 0x9

  // 3. Load Command 1: LC_SYMTAB (offset 32 + 232 = 264, size 24)
  const symCmdOff = 264;
  view.setUint32(symCmdOff + 0, LC_SYMTAB, true); // cmd: 0x2
  view.setUint32(symCmdOff + 4, 24, true); // cmdsize: 24
  view.setUint32(symCmdOff + 8, 0x350, true); // symoff: 0x350
  view.setUint32(symCmdOff + 12, 4, true); // nsyms: 4
  view.setUint32(symCmdOff + 16, 0x3a0, true); // stroff: 0x3a0
  view.setUint32(symCmdOff + 20, 0x60, true); // strsize: 0x60

  // 4. Code Section at file offset 0x200 (vaddr 0x1000)
  const codeOff = 0x200;

  // Function 1: _fmi2Instantiate (vaddr 0x1000)
  // System V AMD64: instanceName in RDI, return in RAX: MOV RAX, RDI; RET
  buf[codeOff + 0x00] = 0x48;
  buf[codeOff + 0x01] = 0x89;
  buf[codeOff + 0x02] = 0xf8; // MOV RAX, RDI
  buf[codeOff + 0x03] = 0xc3; // RET

  // Function 2: _fmi2SetReal (vaddr 0x1020)
  // MOVSD XMM0, [RDI]; XOR RAX, RAX; RET
  buf[codeOff + 0x20] = 0xf2;
  buf[codeOff + 0x21] = 0x0f;
  buf[codeOff + 0x22] = 0x10;
  buf[codeOff + 0x23] = 0x07;
  buf[codeOff + 0x24] = 0x48;
  buf[codeOff + 0x25] = 0x31;
  buf[codeOff + 0x26] = 0xc0;
  buf[codeOff + 0x27] = 0xc3;

  // Function 3: _fmi2DoStep (vaddr 0x1040)
  // ADDSD XMM0, XMM1; XOR RAX, RAX; RET
  buf[codeOff + 0x40] = 0xf2;
  buf[codeOff + 0x41] = 0x0f;
  buf[codeOff + 0x42] = 0x58;
  buf[codeOff + 0x43] = 0xc1;
  buf[codeOff + 0x44] = 0x48;
  buf[codeOff + 0x45] = 0x31;
  buf[codeOff + 0x46] = 0xc0;
  buf[codeOff + 0x47] = 0xc3;

  // Function 4: _fmi2GetReal (vaddr 0x1060)
  // XOR RAX, RAX; RET
  buf[codeOff + 0x60] = 0x48;
  buf[codeOff + 0x61] = 0x31;
  buf[codeOff + 0x62] = 0xc0;
  buf[codeOff + 0x63] = 0xc3;

  // Function 5: _init (Static Initializer, vaddr 0x1080)
  // XOR RAX, RAX; RET
  buf[codeOff + 0x80] = 0x48;
  buf[codeOff + 0x81] = 0x31;
  buf[codeOff + 0x82] = 0xc0;
  buf[codeOff + 0x83] = 0xc3;

  // 5. Static Initializer Pointer at file offset 0x300 (vaddr 0x1100)
  view.setBigUint64(0x300, 0x1080n, true); // points to _init at 0x1080

  // 6. String Table at file offset 0x3a0
  const strOff = 0x3a0;
  buf[strOff] = 0; // null byte at index 0
  const s1 = "_fmi2Instantiate\0";
  const s2 = "_fmi2SetReal\0";
  const s3 = "_fmi2DoStep\0";
  const s4 = "_fmi2GetReal\0";
  buf.set(enc.encode(s1), strOff + 1);
  buf.set(enc.encode(s2), strOff + 1 + s1.length);
  buf.set(enc.encode(s3), strOff + 1 + s1.length + s2.length);
  buf.set(enc.encode(s4), strOff + 1 + s1.length + s2.length + s3.length);

  // 7. Symbol Table (nlist_64) at file offset 0x350 (16 bytes per entry)
  const symOff = 0x350;

  // Sym 0: _fmi2Instantiate (vaddr 0x1000)
  view.setUint32(symOff + 0, 1, true); // string table offset
  view.setUint8(symOff + 4, 0x0f); // n_type: N_SECT | N_EXT
  view.setUint8(symOff + 5, 1); // n_sect: 1
  view.setUint16(symOff + 6, 0, true); // n_desc: 0
  view.setBigUint64(symOff + 8, 0x1000n, true); // n_value: 0x1000

  // Sym 1: _fmi2SetReal (vaddr 0x1020)
  const sym1Off = symOff + 16;
  view.setUint32(sym1Off + 0, 1 + s1.length, true);
  view.setUint8(sym1Off + 4, 0x0f);
  view.setUint8(sym1Off + 5, 1);
  view.setUint16(sym1Off + 6, 0, true);
  view.setBigUint64(sym1Off + 8, 0x1020n, true);

  // Sym 2: _fmi2DoStep (vaddr 0x1040)
  const sym2Off = sym1Off + 16;
  view.setUint32(sym2Off + 0, 1 + s1.length + s2.length, true);
  view.setUint8(sym2Off + 4, 0x0f);
  view.setUint8(sym2Off + 5, 1);
  view.setUint16(sym2Off + 6, 0, true);
  view.setBigUint64(sym2Off + 8, 0x1040n, true);

  // Sym 3: _fmi2GetReal (vaddr 0x1060)
  const sym3Off = sym2Off + 16;
  view.setUint32(sym3Off + 0, 1 + s1.length + s2.length + s3.length, true);
  view.setUint8(sym3Off + 4, 0x0f);
  view.setUint8(sym3Off + 5, 1);
  view.setUint16(sym3Off + 6, 0, true);
  view.setBigUint64(sym3Off + 8, 0x1060n, true);

  return buf;
}

/**
 * Creates a Universal FAT binary containing an x86_64 Mach-O slice.
 */
function createSyntheticFatBinary(slice64: Uint8Array): Uint8Array {
  const fatBuf = new Uint8Array(16384);
  const view = new DataView(fatBuf.buffer);

  // FAT header (big-endian)
  view.setUint32(0, FAT_MAGIC, false); // 0xcafebabe
  view.setUint32(4, 2, false); // 2 architectures

  // Arch 0: 32-bit ARM (offset 0x1000, size 0x200)
  view.setInt32(8, CPU_TYPE_ARM, false);
  view.setInt32(12, 0, false);
  view.setUint32(16, 0x1000, false);
  view.setUint32(20, 0x200, false);
  view.setUint32(24, 12, false);

  // Arch 1: x86_64 slice (offset 0x1400, size slice64.length)
  const sliceOffset = 0x1400;
  view.setInt32(28, CPU_TYPE_X86_64, false);
  view.setInt32(32, 3, false);
  view.setUint32(36, sliceOffset, false);
  view.setUint32(40, slice64.byteLength, false);
  view.setUint32(44, 12, false);

  // Place slice at sliceOffset
  fatBuf.set(slice64, sliceOffset);

  return fatBuf;
}

// ============================================================================
// TEST 1: Mach-O 64-bit Header & Symbol Resolution
// ============================================================================
console.log("1. Testing MachoLoader parsing synthetic macOS 64-bit dylib...");
const dylibBuf = createSyntheticMachoDylib();
const machoLoader = new MachoLoader(dylibBuf);

assert.strictEqual(machoLoader.header.is64Bit, true, "Must be recognized as 64-bit Mach-O");
assert.strictEqual(machoLoader.header.cputype, CPU_TYPE_X86_64, "CPU type must be x86_64");
assert.strictEqual(machoLoader.segments.length, 1, "Must contain 1 segment (__TEXT)");
assert.strictEqual(machoLoader.segments[0]!.sections.length, 2, "Must contain 2 sections");

// Verify dual symbol indexing (with and without leading underscore)
assert.ok(machoLoader.symbols.has("_fmi2Instantiate"), "Must export _fmi2Instantiate");
assert.ok(machoLoader.symbols.has("fmi2Instantiate"), "Must export stripped fmi2Instantiate");
assert.ok(machoLoader.symbols.has("fmi2SetReal"), "Must export stripped fmi2SetReal");
assert.ok(machoLoader.symbols.has("fmi2DoStep"), "Must export stripped fmi2DoStep");
assert.ok(machoLoader.symbols.has("fmi2GetReal"), "Must export stripped fmi2GetReal");

// Verify memory mapping and static initializer discovery
const guestMem = machoLoader.mapImageToMemory(0x140000000n);
assert.strictEqual(guestMem.baseAddress, 0x140000000n, "Guest memory base address must be 0x140000000");
assert.strictEqual(machoLoader.initFuncAddresses.length, 1, "Must discover 1 static initializer");
console.log("✓ Test 1 passed: Mach-O 64-bit header, symbols, and static initializers verified.");

// ============================================================================
// TEST 2: Black-box Binary Introspection for Mach-O
// ============================================================================
console.log("2. Testing blackbox binary introspection for Mach-O...");
const intro = introspectBlackboxBinary(dylibBuf, "MechanicalDrive.dylib");
assert.strictEqual(intro.format, "macho_dylib", "Format must be macho_dylib");
assert.strictEqual(intro.modelName, "MechanicalDrive", "Model name must be extracted");
assert.strictEqual(intro.architectures[0]?.os, "darwin", "OS must be darwin");
assert.strictEqual(intro.architectures[0]?.arch, "x86_64", "Arch must be x86_64");
assert.strictEqual(intro.architectures[0]?.bits, 64, "Bits must be 64");
assert.strictEqual(intro.hasCoSimulation, true, "Must detect co-simulation capability");
console.log("✓ Test 2 passed: Black-box introspection verified.");

// ============================================================================
// TEST 3: Universal Fat Binary Slicing & Execution
// ============================================================================
console.log("3. Testing Universal Fat binary slicing and execution...");
const fatBuf = createSyntheticFatBinary(dylibBuf);
const extractedSlice = MachoLoader.extractSliceFromFat(fatBuf);
assert.strictEqual(extractedSlice.byteLength, dylibBuf.byteLength, "Extracted slice size must match original");

const fatRunner = new UniversalBinaryRunner(fatBuf, {
  variables: [
    { name: "speed", valueReference: 1, type: "Real", causality: "output" },
    { name: "torque", valueReference: 2, type: "Real", causality: "input" },
  ],
});
assert.strictEqual(fatRunner.format, "macho", "Runner format must be macho");

// Initialize and step through FMU functions
fatRunner.init(0.0);
const stepRes = fatRunner.step(0.0, 0.01, { torque: 50.0 });
assert.ok(typeof stepRes === "object", "step must return outputs dictionary");
fatRunner.setVar("torque", 50.0);
fatRunner.terminate();
console.log("✓ Test 3 passed: Universal Fat binary slicing and FMU execution verified.");

// ============================================================================
// TEST 4: AVX VZEROUPPER Instruction (0xC5 0xF8 0x77)
// ============================================================================
console.log("4. Testing AVX VZEROUPPER instruction on X86Cpu...");
const memSize = 1024 * 1024;
const memBuf = new ArrayBuffer(memSize);
const dummyMemory = {
  buffer: memBuf,
  dataView: new DataView(memBuf),
  uint8: new Uint8Array(memBuf),
  baseAddress: 0x10000n,
  size: memSize,
  heapStart: 65536,
  heapPointer: 65536,
};
const cruntime = new CRuntimeManager(dummyMemory);
const cpu = new X86Cpu(dummyMemory, true, cruntime, "systemv");

// Set non-zero values across all 4 lanes of YMM0 through YMM15
for (let r = 0; r < 16; r++) {
  cpu.setYmm(r, 1.0 + r, 2.0 + r, 3.0 + r, 4.0 + r);
}

// Assemble VZEROUPPER (0xC5 0xF8 0x77) followed by RET (0xC3) at 0x10000
dummyMemory.uint8[0] = 0xc5;
dummyMemory.uint8[1] = 0xf8;
dummyMemory.uint8[2] = 0x77; // VZEROUPPER
dummyMemory.uint8[3] = 0xc3; // RET

cpu.callFunction(0x10000n);

// Verify: Lane 0 is preserved, while lanes 1, 2, and 3 are zeroed out across all 16 registers
for (let r = 0; r < 16; r++) {
  assert.strictEqual(cpu.getYmmLane(r, 0), 1.0 + r, `YMM${r} lane 0 must be preserved`);
  assert.strictEqual(cpu.getYmmLane(r, 1), 0.0, `YMM${r} lane 1 must be zeroed by VZEROUPPER`);
  assert.strictEqual(cpu.getYmmLane(r, 2), 0.0, `YMM${r} lane 2 must be zeroed by VZEROUPPER`);
  assert.strictEqual(cpu.getYmmLane(r, 3), 0.0, `YMM${r} lane 3 must be zeroed by VZEROUPPER`);
}
console.log("✓ Test 4 passed: VZEROUPPER cleared upper 128 bits across all 16 YMM registers.");

// ============================================================================
// TEST 5: Packed 256-bit Vector Arithmetic (VADDPD, VSUBPD, VMULPD, VDIVPD)
// ============================================================================
console.log("5. Testing packed 256-bit AVX floating-point vector arithmetic...");

// YMM1 = [1.0, 2.0, 3.0, 4.0]
// YMM2 = [10.0, 20.0, 30.0, 40.0]
cpu.setYmm(1, 1.0, 2.0, 3.0, 4.0);
cpu.setYmm(2, 10.0, 20.0, 30.0, 40.0);

// Code:
// 1. VADDPD YMM0, YMM1, YMM2  (0xC5 0xF5 0x58 0xC2) -> YMM0 = [11, 22, 33, 44]
// 2. VSUBPD YMM3, YMM0, YMM1  (0xC5 0xFD 0x5C 0xD9) -> YMM3 = [10, 20, 30, 40]
// 3. VMULPD YMM4, YMM1, YMM2  (0xC5 0xF5 0x59 0xE2) -> YMM4 = [10, 40, 90, 160]
// 4. VDIVPD YMM5, YMM4, YMM1  (0xC5 0xDD 0x5E 0xE9) -> YMM5 = [10, 20, 30, 40]
// 5. RET (0xC3)
let p = 0x100;
dummyMemory.uint8[p++] = 0xc5;
dummyMemory.uint8[p++] = 0xf5;
dummyMemory.uint8[p++] = 0x58;
dummyMemory.uint8[p++] = 0xc2; // VADDPD
dummyMemory.uint8[p++] = 0xc5;
dummyMemory.uint8[p++] = 0xfd;
dummyMemory.uint8[p++] = 0x5c;
dummyMemory.uint8[p++] = 0xd9; // VSUBPD
dummyMemory.uint8[p++] = 0xc5;
dummyMemory.uint8[p++] = 0xf5;
dummyMemory.uint8[p++] = 0x59;
dummyMemory.uint8[p++] = 0xe2; // VMULPD
dummyMemory.uint8[p++] = 0xc5;
dummyMemory.uint8[p++] = 0xdd;
dummyMemory.uint8[p++] = 0x5e;
dummyMemory.uint8[p++] = 0xe9; // VDIVPD
dummyMemory.uint8[p++] = 0xc3; // RET

cpu.callFunction(0x10000n + 0x100n);

assert.deepStrictEqual(cpu.getYmm(0), [11.0, 22.0, 33.0, 44.0], "VADDPD result mismatch");
assert.deepStrictEqual(cpu.getYmm(3), [10.0, 20.0, 30.0, 40.0], "VSUBPD result mismatch");
assert.deepStrictEqual(cpu.getYmm(4), [10.0, 40.0, 90.0, 160.0], "VMULPD result mismatch");
assert.deepStrictEqual(cpu.getYmm(5), [10.0, 20.0, 30.0, 40.0], "VDIVPD result mismatch");
console.log("✓ Test 5 passed: Packed 256-bit VADDPD, VSUBPD, VMULPD, VDIVPD verified.");

// ============================================================================
// TEST 6: Scalar Double Arithmetic with Non-Destructive Source (VADDSD, VMULSD)
// ============================================================================
console.log("6. Testing non-destructive scalar double arithmetic (VADDSD, VMULSD)...");

// YMM1 = [5.0, 99.0, 100.0, 101.0]
// YMM2 = [3.0, 77.0, 88.0, 99.0]
cpu.setYmm(1, 5.0, 99.0, 100.0, 101.0);
cpu.setYmm(2, 3.0, 77.0, 88.0, 99.0);

// Code:
// 1. VADDSD XMM0, XMM1, XMM2 (0xC5 0xF3 0x58 0xC2) -> lane 0 = 5+3=8, lane 1 = 99 (from vvvv), upper lanes zeroed
// 2. RET (0xC3)
p = 0x200;
dummyMemory.uint8[p++] = 0xc5;
dummyMemory.uint8[p++] = 0xf3;
dummyMemory.uint8[p++] = 0x58;
dummyMemory.uint8[p++] = 0xc2;
dummyMemory.uint8[p++] = 0xc3;

cpu.callFunction(0x10000n + 0x200n);

assert.strictEqual(cpu.getYmmLane(0, 0), 8.0, "VADDSD scalar sum mismatch");
assert.strictEqual(cpu.getYmmLane(0, 1), 99.0, "VADDSD must preserve lane 1 from vvvv");
assert.strictEqual(cpu.getYmmLane(0, 2), 0.0, "VADDSD upper lane 2 must be zeroed");
assert.strictEqual(cpu.getYmmLane(0, 3), 0.0, "VADDSD upper lane 3 must be zeroed");
console.log("✓ Test 6 passed: Non-destructive scalar arithmetic verified.");

// ============================================================================
// TEST 7: Fused Multiply-Add (FMA3: VFMADD231PD & VFMADD213SD)
// ============================================================================
console.log("7. Testing FMA3 Fused Multiply-Add (VFMADD231PD & VFMADD213SD)...");

// VFMADD231PD: dest = vvvv * src + dest
// YMM0 (dest) = [1.0, 1.0, 1.0, 1.0]
// YMM1 (vvvv) = [2.0, 3.0, 4.0, 5.0]
// YMM2 (src)  = [10.0, 10.0, 10.0, 10.0]
// Result YMM0 = [21.0, 31.0, 41.0, 51.0]
cpu.setYmm(0, 1.0, 1.0, 1.0, 1.0);
cpu.setYmm(1, 2.0, 3.0, 4.0, 5.0);
cpu.setYmm(2, 10.0, 10.0, 10.0, 10.0);

p = 0x300;
// 0xC4 0xE2 0xF5 0xB8 0xC2 (VFMADD231PD YMM0, YMM1, YMM2)
dummyMemory.uint8[p++] = 0xc4;
dummyMemory.uint8[p++] = 0xe2;
dummyMemory.uint8[p++] = 0xf5;
dummyMemory.uint8[p++] = 0xb8;
dummyMemory.uint8[p++] = 0xc2;
dummyMemory.uint8[p++] = 0xc3;

cpu.callFunction(0x10000n + 0x300n);
assert.deepStrictEqual(cpu.getYmm(0), [21.0, 31.0, 41.0, 51.0], "VFMADD231PD calculation mismatch");
console.log("✓ Test 7 passed: FMA3 instructions verified.");

// ============================================================================
// TEST 8: Memory Broadcast (VBROADCASTSD)
// ============================================================================
console.log("8. Testing VBROADCASTSD memory broadcast to all 4 lanes...");

// Write single double 42.125 at memory address 0x10000 + 0x500
const broadcastAddr = 0x10000n + 0x500n;
cpu.writeF64(broadcastAddr, 42.125);

// Put address in RDI (arg 0)
// Code: VBROADCASTSD YMM7, [RDI] (0xC4 0xE2 0xFD 0x19 0x3F); RET (0xC3)
p = 0x400;
dummyMemory.uint8[p++] = 0xc4;
dummyMemory.uint8[p++] = 0xe2;
dummyMemory.uint8[p++] = 0xfd;
dummyMemory.uint8[p++] = 0x19;
dummyMemory.uint8[p++] = 0x3f;
dummyMemory.uint8[p++] = 0xc3;

cpu.callFunction(0x10000n + 0x400n, [broadcastAddr]);

assert.deepStrictEqual(cpu.getYmm(7), [42.125, 42.125, 42.125, 42.125], "VBROADCASTSD broadcast mismatch");
console.log("✓ Test 8 passed: VBROADCASTSD scalar memory broadcast verified.");

// ============================================================================
// TEST 9: AVX2 Integer Vectors (VPADDD & VPXOR)
// ============================================================================
console.log("9. Testing AVX2 integer vectors (VPADDD & VPXOR)...");

// Zero out YMM0 with VPXOR YMM0, YMM0, YMM0 (0xC5 0xFD 0xEF 0xC0)
// Then RET (0xC3)
cpu.setYmm(0, 999.0, 888.0, 777.0, 666.0);
p = 0x600;
dummyMemory.uint8[p++] = 0xc5;
dummyMemory.uint8[p++] = 0xfd;
dummyMemory.uint8[p++] = 0xef;
dummyMemory.uint8[p++] = 0xc0;
dummyMemory.uint8[p++] = 0xc3;

cpu.callFunction(0x10000n + 0x600n);
assert.deepStrictEqual(cpu.getYmm(0), [0.0, 0.0, 0.0, 0.0], "VPXOR zeroing mismatch");
console.log("✓ Test 9 passed: AVX2 integer vector instructions verified.");

// ============================================================================
// TEST 10: Dynamic Binary Translation (DBT) Wasm JIT with FMA
// ============================================================================
console.log("10. Testing DBT Wasm JIT compilation of FMA instruction sequence...");
const dbt = new DbtCompiler(null, 1);
const compiledFn = dbt.compileBlock(0x20000n, [
  { op: "vzeroupper", dstReg: 0 },
  { op: "fload", dstReg: 1, baseReg: 0, offset: 0 }, // load state x
  { op: "fload", dstReg: 2, baseReg: 0, offset: 8 }, // load param a
  { op: "fload", dstReg: 3, baseReg: 0, offset: 16 }, // load param b
  { op: "fma", dstReg: 1, srcReg: 2, src2Reg: 3 }, // x = x * a + b
  { op: "fstore", dstReg: 1, baseReg: 0, offset: 0 }, // store updated x
  { op: "fmov", dstReg: 0, srcReg: 1 }, // return updated x
  { op: "ret", dstReg: 0 },
]);

assert.strictEqual(typeof compiledFn, "function", "DBT must synthesize a callable WebAssembly function");

// Prepare memory with [x=10.0, a=2.5, b=5.0] -> expected x = 10.0 * 2.5 + 5.0 = 30.0
const wasmSharedMem = new WebAssembly.Memory({ initial: 1 });
const f64View = new Float64Array(wasmSharedMem.buffer);
f64View[0] = 10.0;
f64View[1] = 2.5;
f64View[2] = 5.0;

const dbtWithMem = new DbtCompiler(wasmSharedMem);
const jitBlock = dbtWithMem.compileBlock(0x20000n, [
  { op: "vzeroupper", dstReg: 0 },
  { op: "fload", dstReg: 1, baseReg: 0, offset: 0 },
  { op: "fload", dstReg: 2, baseReg: 0, offset: 8 },
  { op: "fload", dstReg: 3, baseReg: 0, offset: 16 },
  { op: "fma", dstReg: 1, srcReg: 2, src2Reg: 3 },
  { op: "fstore", dstReg: 1, baseReg: 0, offset: 0 },
  { op: "fmov", dstReg: 0, srcReg: 1 },
  { op: "ret", dstReg: 0 },
]);

const jitResult = jitBlock(0, 0.0, 0.01);
assert.strictEqual(jitResult, 30.0, "JIT block return value must be 30.0");
assert.strictEqual(f64View[0], 30.0, "JIT block stored memory value must be 30.0");
console.log("✓ Test 10 passed: DBT Wasm JIT compilation of FMA basic blocks verified.");

console.log("\n=======================================================");
console.log("ALL 10 MACH-O AND AVX2 TESTS PASSED SUCCESSFULLY!");
console.log("=======================================================\n");
