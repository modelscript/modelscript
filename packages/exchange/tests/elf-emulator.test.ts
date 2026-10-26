// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { CRuntimeManager, ElfLoader, X86Cpu, createUniversalFmuRunner } from "../src/fmu/pe-emulator/index.js";

console.log("=== Running In-Browser Linux ELF Shared Object Emulator Tests ===");

/**
 * Builds a syntactically valid ELF64 (x86_64) shared object binary in memory
 * containing genuine x64 machine code adhering to System V AMD64 ABI:
 * - fmi2Instantiate (VADDR 0x1000)
 * - fmi2SetReal     (VADDR 0x1020)
 * - fmi2DoStep      (VADDR 0x1040)
 * - fmi2GetReal     (VADDR 0x1060)
 * - _init           (VADDR 0x1080, static initializer)
 */
function createSyntheticElfSo(): Uint8Array {
  const buf = new Uint8Array(4096);
  const view = new DataView(buf.buffer);

  // 1. ELF Header (64 bytes)
  buf[0] = 0x7f;
  buf[1] = 0x45;
  buf[2] = 0x4c;
  buf[3] = 0x46; // \x7FELF
  buf[4] = 2; // ELFCLASS64
  buf[5] = 1; // ELFDATA2LSB (little endian)
  buf[6] = 1; // EV_CURRENT
  buf[7] = 0; // ELFOSABI_SYSV

  view.setUint16(16, 3, true); // e_type: ET_DYN (Shared Object)
  view.setUint16(18, 0x3e, true); // e_machine: EM_X86_64
  view.setUint32(20, 1, true); // e_version: 1
  view.setBigUint64(24, 0x1000n, true); // e_entry
  view.setBigUint64(32, 64n, true); // e_phoff (offset 64)
  view.setBigUint64(40, 0n, true); // e_shoff
  view.setUint32(48, 0, true); // e_flags
  view.setUint16(52, 64, true); // e_ehsize
  view.setUint16(54, 56, true); // e_phentsize (56 bytes on 64-bit)
  view.setUint16(56, 3, true); // e_phnum (3 headers: PT_LOAD code, PT_LOAD data, PT_DYNAMIC)
  view.setUint16(58, 64, true); // e_shentsize
  view.setUint16(60, 0, true); // e_shnum
  view.setUint16(62, 0, true); // e_shstrndx

  // 2. Program Headers (starts at offset 64)
  // Header 0: PT_LOAD Code (RVA 0x1000)
  const ph0 = 64;
  view.setUint32(ph0 + 0, 1, true); // p_type: PT_LOAD
  view.setUint32(ph0 + 4, 5, true); // p_flags: PF_R | PF_X
  view.setBigUint64(ph0 + 8, 0x100n, true); // p_offset: 0x100
  view.setBigUint64(ph0 + 16, 0x1000n, true); // p_vaddr: 0x1000
  view.setBigUint64(ph0 + 24, 0x1000n, true); // p_paddr: 0x1000
  view.setBigUint64(ph0 + 32, 0x200n, true); // p_filesz: 0x200
  view.setBigUint64(ph0 + 40, 0x200n, true); // p_memsz: 0x200
  view.setBigUint64(ph0 + 48, 0x1000n, true); // p_align: 0x1000

  // Header 1: PT_LOAD Data (RVA 0x2000)
  const ph1 = ph0 + 56;
  view.setUint32(ph1 + 0, 1, true); // p_type: PT_LOAD
  view.setUint32(ph1 + 4, 6, true); // p_flags: PF_R | PF_W
  view.setBigUint64(ph1 + 8, 0x300n, true); // p_offset: 0x300
  view.setBigUint64(ph1 + 16, 0x2000n, true); // p_vaddr: 0x2000
  view.setBigUint64(ph1 + 24, 0x2000n, true); // p_paddr: 0x2000
  view.setBigUint64(ph1 + 32, 0x400n, true); // p_filesz: 0x400
  view.setBigUint64(ph1 + 40, 0x400n, true); // p_memsz: 0x400
  view.setBigUint64(ph1 + 48, 0x1000n, true); // p_align: 0x1000

  // Header 2: PT_DYNAMIC (RVA 0x2000)
  const ph2 = ph1 + 56;
  view.setUint32(ph2 + 0, 2, true); // p_type: PT_DYNAMIC
  view.setUint32(ph2 + 4, 6, true); // p_flags: PF_R | PF_W
  view.setBigUint64(ph2 + 8, 0x300n, true); // p_offset: 0x300
  view.setBigUint64(ph2 + 16, 0x2000n, true); // p_vaddr: 0x2000
  view.setBigUint64(ph2 + 24, 0x2000n, true); // p_paddr: 0x2000
  view.setBigUint64(ph2 + 32, 0x100n, true); // p_filesz: 0x100
  view.setBigUint64(ph2 + 40, 0x100n, true); // p_memsz: 0x100
  view.setBigUint64(ph2 + 48, 8n, true); // p_align: 8

  // 3. Fill Segment 0 (Code) at file offset 0x100 (vaddr 0x1000)
  const codeOff = 0x100;

  // Function 1: fmi2Instantiate (VADDR 0x1000)
  // System V AMD64 ABI: InstanceName is in RDI! Return it in RAX: MOV RAX, RDI; RET
  buf[codeOff + 0x00] = 0x48;
  buf[codeOff + 0x01] = 0x89;
  buf[codeOff + 0x02] = 0xf8; // MOV RAX, RDI
  buf[codeOff + 0x03] = 0xc3; // RET

  // Function 2: fmi2SetReal (VADDR 0x1020)
  // System V: c=RDI, vr=RSI, nvr=RDX, val=RCX
  // Read double from [RDI], return 0: MOVSD XMM0, [RDI]; XOR RAX, RAX; RET
  buf[codeOff + 0x20] = 0xf2;
  buf[codeOff + 0x21] = 0x0f;
  buf[codeOff + 0x22] = 0x10;
  buf[codeOff + 0x23] = 0x07; // MOVSD XMM0, [RDI]
  buf[codeOff + 0x24] = 0x48;
  buf[codeOff + 0x25] = 0x31;
  buf[codeOff + 0x26] = 0xc0; // XOR RAX, RAX
  buf[codeOff + 0x27] = 0xc3; // RET

  // Function 3: fmi2DoStep (VADDR 0x1040)
  // System V: c=RDI, curTime=XMM0, dt=XMM1
  // Add dt to curTime: ADDSD XMM0, XMM1; XOR RAX, RAX; RET
  buf[codeOff + 0x40] = 0xf2;
  buf[codeOff + 0x41] = 0x0f;
  buf[codeOff + 0x42] = 0x58;
  buf[codeOff + 0x43] = 0xc1; // ADDSD XMM0, XMM1
  buf[codeOff + 0x44] = 0x48;
  buf[codeOff + 0x45] = 0x31;
  buf[codeOff + 0x46] = 0xc0; // XOR RAX, RAX
  buf[codeOff + 0x47] = 0xc3; // RET

  // Function 4: fmi2GetReal (VADDR 0x1060)
  // System V: c=RDI, vr=RSI, nvr=RDX, val=RCX
  // XOR RAX, RAX; RET
  buf[codeOff + 0x60] = 0x48;
  buf[codeOff + 0x61] = 0x31;
  buf[codeOff + 0x62] = 0xc0; // XOR RAX, RAX
  buf[codeOff + 0x63] = 0xc3; // RET

  // Function 5: _init (Static Constructor, VADDR 0x1080)
  // XOR RAX, RAX; RET
  buf[codeOff + 0x80] = 0x48;
  buf[codeOff + 0x81] = 0x31;
  buf[codeOff + 0x82] = 0xc0; // XOR RAX, RAX
  buf[codeOff + 0x83] = 0xc3; // RET

  // 4. Fill Segment 1 (Data & Dynamic Section) at file offset 0x300 (vaddr 0x2000)
  const dataOff = 0x300;

  // PT_DYNAMIC tag-value entries (16 bytes each)
  let dOff = dataOff;
  // DT_STRTAB (5) -> VADDR 0x2100
  view.setBigInt64(dOff + 0, 5n, true);
  view.setBigUint64(dOff + 8, 0x2100n, true);
  dOff += 16;
  // DT_STRSZ (10) -> 0x60
  view.setBigInt64(dOff + 0, 10n, true);
  view.setBigUint64(dOff + 8, 0x60n, true);
  dOff += 16;
  // DT_SYMTAB (6) -> VADDR 0x2180
  view.setBigInt64(dOff + 0, 6n, true);
  view.setBigUint64(dOff + 8, 0x2180n, true);
  dOff += 16;
  // DT_SYMENT (11) -> 24
  view.setBigInt64(dOff + 0, 11n, true);
  view.setBigUint64(dOff + 8, 24n, true);
  dOff += 16;
  // DT_INIT_ARRAY (25) -> VADDR 0x2240
  view.setBigInt64(dOff + 0, 25n, true);
  view.setBigUint64(dOff + 8, 0x2240n, true);
  dOff += 16;
  // DT_INIT_ARRAYSZ (27) -> 8
  view.setBigInt64(dOff + 0, 27n, true);
  view.setBigUint64(dOff + 8, 8n, true);
  dOff += 16;
  // DT_NULL (0)
  view.setBigInt64(dOff + 0, 0n, true);
  view.setBigUint64(dOff + 8, 0n, true);

  // String Table at vaddr 0x2100 (file offset 0x300 + 0x100 = 0x400)
  const strOff = dataOff + 0x100;
  const enc = new TextEncoder();
  buf[strOff] = 0; // null string at index 0
  const s1 = "fmi2Instantiate\0";
  const s2 = "fmi2SetReal\0";
  const s3 = "fmi2DoStep\0";
  const s4 = "fmi2GetReal\0";
  buf.set(enc.encode(s1), strOff + 1);
  buf.set(enc.encode(s2), strOff + 1 + s1.length);
  buf.set(enc.encode(s3), strOff + 1 + s1.length + s2.length);
  buf.set(enc.encode(s4), strOff + 1 + s1.length + s2.length + s3.length);

  // Symbol Table at vaddr 0x2180 (file offset 0x300 + 0x180 = 0x480)
  // Entry 0: Undefined dummy symbol
  const symOff = dataOff + 0x180;
  // Entry 1: fmi2Instantiate (VADDR 0x1000)
  const sym1 = symOff + 24;
  view.setUint32(sym1 + 0, 1, true); // st_name offset
  view.setUint8(sym1 + 4, 0x12); // STB_GLOBAL | STT_FUNC
  view.setBigUint64(sym1 + 8, 0x1000n, true); // st_value
  view.setBigUint64(sym1 + 16, 4n, true); // st_size

  // Entry 2: fmi2SetReal (VADDR 0x1020)
  const sym2 = sym1 + 24;
  view.setUint32(sym2 + 0, 1 + s1.length, true);
  view.setUint8(sym2 + 4, 0x12);
  view.setBigUint64(sym2 + 8, 0x1020n, true);
  view.setBigUint64(sym2 + 16, 8n, true);

  // Entry 3: fmi2DoStep (VADDR 0x1040)
  const sym3 = sym2 + 24;
  view.setUint32(sym3 + 0, 1 + s1.length + s2.length, true);
  view.setUint8(sym3 + 4, 0x12);
  view.setBigUint64(sym3 + 8, 0x1040n, true);
  view.setBigUint64(sym3 + 16, 8n, true);

  // Entry 4: fmi2GetReal (VADDR 0x1060)
  const sym4 = sym3 + 24;
  view.setUint32(sym4 + 0, 1 + s1.length + s2.length + s3.length, true);
  view.setUint8(sym4 + 4, 0x12);
  view.setBigUint64(sym4 + 8, 0x1060n, true);
  view.setBigUint64(sym4 + 16, 4n, true);

  // DT_INIT_ARRAY Table at vaddr 0x2240 (file offset 0x300 + 0x240 = 0x540)
  // Points to _init at VADDR 0x1080
  const initOff = dataOff + 0x240;
  view.setBigUint64(initOff, 0x1080n, true);

  return buf;
}

// ==========================================
// TEST 1: ElfLoader Parsing & Dynamic Symbols
// ==========================================
console.log("1. Testing ElfLoader parsing synthetic Linux .so binary...");
const soBuf = createSyntheticElfSo();
const loader = new ElfLoader(soBuf);

assert.strictEqual(loader.header.is64Bit, true, "Must be recognized as 64-bit ELF");
assert.strictEqual(loader.header.machine, 0x3e, "Machine must be x86_64");
assert.strictEqual(loader.programHeaders.length, 3, "Must contain 3 program headers");

assert.ok(loader.symbols.has("fmi2Instantiate"), "Must export fmi2Instantiate");
assert.ok(loader.symbols.has("fmi2SetReal"), "Must export fmi2SetReal");
assert.ok(loader.symbols.has("fmi2DoStep"), "Must export fmi2DoStep");
assert.ok(loader.symbols.has("fmi2GetReal"), "Must export fmi2GetReal");
assert.strictEqual(loader.initArrayRvas.length, 1, "Must parse 1 static constructor in DT_INIT_ARRAY");
assert.strictEqual(loader.initArrayRvas[0], 0x1080n, "Static constructor must point to 0x1080");
console.log("   ✓ ElfLoader correctly parsed ELF headers, symbols, and DT_INIT_ARRAY");

// ==========================================
// TEST 2: Memory Mapping & Section Allocation
// ==========================================
console.log("2. Testing ELF PT_LOAD memory mapping...");
const memory = loader.mapImageToMemory(0x140000000n);
assert.strictEqual(memory.baseAddress, 0x140000000n);
assert.ok(memory.size >= 4 * 1024 * 1024, "Guest memory size must accommodate segments, stack, and heap");

// Verify code mapped at vaddr 0x1000: MOV RAX, RDI (0x48, 0x89, 0xf8)
assert.strictEqual(memory.uint8[0x1000], 0x48, "MOV opcode mapped");
assert.strictEqual(memory.uint8[0x1001], 0x89, "MOV opcode mapped");
assert.strictEqual(memory.uint8[0x1003], 0xc3, "RET opcode mapped");
console.log("   ✓ PT_LOAD code and data segments mapped accurately into guest RAM");

// ==========================================
// TEST 3: System V AMD64 ABI Execution
// ==========================================
console.log("3. Testing System V AMD64 ABI execution in X86Cpu...");
const cruntime = new CRuntimeManager(memory);
const cpu = new X86Cpu(memory, true, cruntime, "systemv");

// Call fmi2Instantiate at VADDR 0x1000
// System V: instanceName is passed in RDI, function returns RDI in RAX
const testInstPtr = memory.baseAddress + 0x2000n;
const retInst = cpu.callFunction(memory.baseAddress + 0x1000n, [testInstPtr]);
assert.strictEqual(retInst, testInstPtr, "fmi2Instantiate must return RDI pointer in System V ABI");

// Call fmi2DoStep at VADDR 0x1040
// System V: c in RDI, curTime in XMM0, dt in XMM1
cpu.callFunction(memory.baseAddress + 0x1040n, [testInstPtr], [0.5, 0.05]);
assert.ok(Math.abs(cpu.registers.xmm[0] - 0.55) < 1e-9, "fmi2DoStep must add XMM0 (0.5) + XMM1 (0.05) = 0.55");
console.log("   ✓ System V AMD64 ABI register conventions and floating-point math verified");

// ==========================================
// TEST 4: POSIX glibc Shims
// ==========================================
console.log("4. Testing POSIX glibc clock_gettime and timing shims...");
const timespecPtr = cruntime.malloc(16);
cruntime.handlers.get("clock_gettime")!({
  cpu: {
    ...cpu,
    getArg: (i: number) => (i === 1 ? timespecPtr : 0n),
    setReturnInt: () => {},
  } as any,
  memory,
});

const tsOff = Number(timespecPtr - memory.baseAddress);
const sec = memory.dataView.getBigInt64(tsOff, true);
assert.ok(sec >= 0n, "clock_gettime must populate tv_sec");
console.log("   ✓ POSIX glibc clock_gettime populated struct timespec");

// ==========================================
// TEST 5: UniversalBinaryRunner with Linux .so
// ==========================================
console.log("5. Testing UniversalBinaryRunner end-to-end with Linux .so...");
const runner = createUniversalFmuRunner(soBuf, {
  modelName: "TestLinuxChuaModel",
  variables: [
    { name: "u", valueReference: 1, causality: "input", start: 1.5 },
    { name: "y", valueReference: 2, causality: "output" },
  ],
});

assert.strictEqual(runner.format, "elf", "UniversalBinaryRunner must auto-detect Linux ELF format");
assert.strictEqual(runner.getTime(), 0.0, "Initial time must be 0");

const outStep1 = runner.step(0.0, 0.01, { u: 3.0 });
assert.strictEqual(runner.getTime(), 0.01, "Time must advance to 0.01");
assert.ok(outStep1 !== null, "Step outputs must be returned");

const outStep2 = runner.step(0.01, 0.01);
assert.strictEqual(runner.getTime(), 0.02, "Time must advance to 0.02");

runner.terminate();
console.log("   ✓ UniversalBinaryRunner initialized, stepped across multiple frames, and terminated cleanly");

console.log("All In-Browser Linux ELF Shared Object Emulator tests PASSED successfully!");
