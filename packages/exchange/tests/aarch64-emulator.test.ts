// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { AArch64Cpu, CRuntimeManager, ElfLoader, createUniversalFmuRunner } from "../src/fmu/pe-emulator/index.js";
import type { GuestMemorySpace } from "../src/fmu/pe-emulator/types.js";

console.log("=== Running In-Browser ARM64 (AArch64) Emulator Tests ===");

function createMockMemory(size = 0x20000, base = 0x10000000n): GuestMemorySpace {
  const buffer = new ArrayBuffer(size);
  return {
    buffer,
    uint8: new Uint8Array(buffer),
    dataView: new DataView(buffer),
    baseAddress: base,
    size,
    sections: [],
    heapStart: 0x1000,
    heapPointer: 0x1000,
  };
}

// 1. Direct AArch64 CPU Core Arithmetic & Floating Point Tests
{
  console.log("\n[Test 1] AArch64 CPU Core Arithmetic & Floating Point Instructions");
  const mem = createMockMemory();
  const crt = new CRuntimeManager(mem);
  const cpu = new AArch64Cpu(mem, crt);

  // Write a small sequence of instructions at baseAddress:
  // 1. MOVZ x1, #100, LSL #0   (0xD2800C81) -> 0x81, 0x0c, 0x80, 0xd2
  // 2. MOVZ x2, #50, LSL #0    (0xD2800642) -> 0x42, 0x06, 0x80, 0xd2
  // 3. ADD x0, x1, x2          (0x8B020020) -> 0x20, 0x00, 0x02, 0x8b
  // 4. RET                     (0xD65F03C0) -> 0xc0, 0x03, 0x5f, 0xd6
  const code = new Uint8Array([
    0x81,
    0x0c,
    0x80,
    0xd2, // MOVZ x1, #100
    0x42,
    0x06,
    0x80,
    0xd2, // MOVZ x2, #50
    0x20,
    0x00,
    0x02,
    0x8b, // ADD x0, x1, x2
    0xc0,
    0x03,
    0x5f,
    0xd6, // RET
  ]);
  mem.uint8.set(code, 0);

  const res = cpu.callFunction(mem.baseAddress);
  assert.strictEqual(res, 150n, "ADD x0, x1, x2 must equal 150");
  console.log("  ✓ Integer MOVZ & ADD instructions passed (result = 150)");

  // Test Floating Point: FADD & FMUL
  // 1. FADD d0, d0, d1  (d0 = 3.5 + 2.5 = 6.0) -> 0x1E612800 -> 0x00, 0x28, 0x61, 0x1e
  // 2. FMUL d0, d0, d2  (d0 = 6.0 * 4.0 = 24.0) -> 0x1E620800 -> 0x00, 0x08, 0x62, 0x1e
  // 3. RET              (0xD65F03C0) -> 0xc0, 0x03, 0x5f, 0xd6
  const fpCode = new Uint8Array([
    0x00,
    0x28,
    0x61,
    0x1e, // FADD d0, d0, d1
    0x00,
    0x08,
    0x62,
    0x1e, // FMUL d0, d0, d2
    0xc0,
    0x03,
    0x5f,
    0xd6, // RET
  ]);
  mem.uint8.set(fpCode, 0x100);

  cpu.callFunction(mem.baseAddress + 0x100n, [], [3.5, 2.5, 4.0]);
  assert.strictEqual(cpu.registers.d[0], 24.0, "FADD and FMUL must equal 24.0");
  console.log("  ✓ Floating Point FADD & FMUL passed (result = 24.0)");
}

// 2. AArch64 Host Hook Integration Test
{
  console.log("\n[Test 2] AArch64 Host Hook Integration (POSIX clock_gettime)");
  const mem = createMockMemory();
  const crt = new CRuntimeManager(mem);
  const cpu = new AArch64Cpu(mem, crt);

  const hookAddr = cpu.registerHostHook("clock_gettime");
  assert.ok(hookAddr >= 0xffff0000n, "Host hook address must be in high synthetic region");

  // Call clock_gettime(CLOCK_MONOTONIC=1, &timespec)
  const timespecPtr = crt.malloc(16);
  const ret = cpu.callFunction(hookAddr, [1n, timespecPtr]);
  assert.strictEqual(ret, 0n, "clock_gettime must return 0 on success");

  const off = Number(timespecPtr - mem.baseAddress);
  const tvSec = mem.dataView.getBigInt64(off, true);
  const tvNsec = mem.dataView.getBigInt64(off + 8, true);
  assert.ok(tvSec >= 0n && tvNsec >= 0n, "clock_gettime must write valid timespec");
  console.log(`  ✓ Host hook executed successfully: sec=${tvSec}, nsec=${tvNsec}`);
}

/**
 * Builds a syntactically valid ELF64 (AArch64) shared object binary in memory:
 * - e_machine: EM_AARCH64 (0xB7 = 183)
 * - fmi2Instantiate (VADDR 0x1000)
 * - fmi2SetReal     (VADDR 0x1020)
 * - fmi2DoStep      (VADDR 0x1040)
 * - fmi2GetReal     (VADDR 0x1060)
 * - _init           (VADDR 0x1080)
 */
function createSyntheticArm64ElfSo(): Uint8Array {
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
  view.setUint16(18, 0xb7, true); // e_machine: EM_AARCH64 (183)
  view.setUint32(20, 1, true); // e_version: 1
  view.setBigUint64(24, 0x1000n, true); // e_entry
  view.setBigUint64(32, 64n, true); // e_phoff (offset 64)
  view.setBigUint64(40, 0n, true); // e_shoff
  view.setUint32(48, 0, true); // e_flags
  view.setUint16(52, 64, true); // e_ehsize
  view.setUint16(54, 56, true); // e_phentsize (56 bytes)
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

  // 3. Fill Segment 0 (AArch64 Code) at file offset 0x100 (vaddr 0x1000)
  const codeOff = 0x100;

  // Function 1: fmi2Instantiate (VADDR 0x1000)
  // AAPCS64: x0 already contains instanceName pointer!
  // Just return: RET (0xD65F03C0)
  view.setUint32(codeOff + 0x00, 0xd65f03c0, true);

  // Function 2: fmi2SetReal (VADDR 0x1020)
  // c = x0, vr = x1, nvr = x2, value = x3
  // 1. LDR d0, [x3, #0] (0xFD400060)
  // 2. STR d0, [x0, #0] (0xFD000000)
  // 3. MOVZ x0, #0      (0xD2800000)
  // 4. RET              (0xD65F03C0)
  view.setUint32(codeOff + 0x20, 0xfd400060, true); // LDR d0, [x3, #0]
  view.setUint32(codeOff + 0x24, 0xfd000000, true); // STR d0, [x0, #0]
  view.setUint32(codeOff + 0x28, 0xd2800000, true); // MOVZ x0, #0
  view.setUint32(codeOff + 0x2c, 0xd65f03c0, true); // RET

  // Function 3: fmi2DoStep (VADDR 0x1040)
  // c = x0, curTime = d0, dt = d1
  // State is stored at [x0, #0]. Integrate: state += dt
  // 1. LDR d2, [x0, #0] (0xFD400002)
  // 2. FADD d2, d2, d1  (0x1E612842)
  // 3. STR d2, [x0, #0] (0xFD000002)
  // 4. MOVZ x0, #0      (0xD2800000)
  // 5. RET              (0xD65F03C0)
  view.setUint32(codeOff + 0x40, 0xfd400002, true); // LDR d2, [x0, #0]
  view.setUint32(codeOff + 0x44, 0x1e612842, true); // FADD d2, d2, d1
  view.setUint32(codeOff + 0x48, 0xfd000002, true); // STR d2, [x0, #0]
  view.setUint32(codeOff + 0x4c, 0xd2800000, true); // MOVZ x0, #0
  view.setUint32(codeOff + 0x50, 0xd65f03c0, true); // RET

  // Function 4: fmi2GetReal (VADDR 0x1060)
  // c = x0, vr = x1, nvr = x2, value = x3
  // 1. LDR d0, [x0, #0] (0xFD400000)
  // 2. STR d0, [x3, #0] (0xFD000060)
  // 3. MOVZ x0, #0      (0xD2800000)
  // 4. RET              (0xD65F03C0)
  view.setUint32(codeOff + 0x60, 0xfd400000, true); // LDR d0, [x0, #0]
  view.setUint32(codeOff + 0x64, 0xfd000060, true); // STR d0, [x3, #0]
  view.setUint32(codeOff + 0x68, 0xd2800000, true); // MOVZ x0, #0
  view.setUint32(codeOff + 0x6c, 0xd65f03c0, true); // RET

  // Function 5: _init (VADDR 0x1080)
  // Static constructor: RET
  view.setUint32(codeOff + 0x80, 0xd65f03c0, true);

  // 4. Fill Segment 1 (Data & Dynamic) at file offset 0x300 (vaddr 0x2000)
  const dataOff = 0x300;
  const dynOff = dataOff;
  const strtabRva = 0x2100;
  const symtabRva = 0x2200;
  const initArrayRva = 0x2300;

  // DT_STRTAB (tag 5)
  view.setBigInt64(dynOff + 0, 5n, true);
  view.setBigUint64(dynOff + 8, BigInt(strtabRva), true);

  // DT_SYMTAB (tag 6)
  view.setBigInt64(dynOff + 16, 6n, true);
  view.setBigUint64(dynOff + 24, BigInt(symtabRva), true);

  // DT_STRSZ (tag 10)
  view.setBigInt64(dynOff + 32, 10n, true);
  view.setBigUint64(dynOff + 40, 256n, true);

  // DT_SYMENT (tag 11)
  view.setBigInt64(dynOff + 48, 11n, true);
  view.setBigUint64(dynOff + 56, 24n, true);

  // DT_INIT_ARRAY (tag 25)
  view.setBigInt64(dynOff + 64, 25n, true);
  view.setBigUint64(dynOff + 72, BigInt(initArrayRva), true);

  // DT_INIT_ARRAYSZ (tag 27)
  view.setBigInt64(dynOff + 80, 27n, true);
  view.setBigUint64(dynOff + 88, 8n, true);

  // DT_NULL (tag 0)
  view.setBigInt64(dynOff + 96, 0n, true);
  view.setBigUint64(dynOff + 104, 0n, true);

  // String Table (RVA 0x2100 -> file offset 0x400)
  const strOff = 0x400;
  const enc = new TextEncoder();
  const strings = ["", "fmi2Instantiate", "fmi2SetReal", "fmi2DoStep", "fmi2GetReal", "_init"];
  const strOffsets: number[] = [];
  let currStrPos = 0;
  for (const s of strings) {
    strOffsets.push(currStrPos);
    const bytes = enc.encode(s);
    buf.set(bytes, strOff + currStrPos);
    buf[strOff + currStrPos + bytes.length] = 0;
    currStrPos += bytes.length + 1;
  }

  // Symbol Table (RVA 0x2200 -> file offset 0x500, each 24 bytes)
  const symOff = 0x500;
  // Symbol 0: Dummy null symbol
  // Symbol 1: fmi2Instantiate (VADDR 0x1000)
  view.setUint32(symOff + 24 + 0, strOffsets[1]!, true); // st_name
  buf[symOff + 24 + 4] = (1 << 4) | 2; // STB_GLOBAL | STT_FUNC
  view.setBigUint64(symOff + 24 + 8, 0x1000n, true); // st_value

  // Symbol 2: fmi2SetReal (VADDR 0x1020)
  view.setUint32(symOff + 48 + 0, strOffsets[2]!, true);
  buf[symOff + 48 + 4] = (1 << 4) | 2;
  view.setBigUint64(symOff + 48 + 8, 0x1020n, true);

  // Symbol 3: fmi2DoStep (VADDR 0x1040)
  view.setUint32(symOff + 72 + 0, strOffsets[3]!, true);
  buf[symOff + 72 + 4] = (1 << 4) | 2;
  view.setBigUint64(symOff + 72 + 8, 0x1040n, true);

  // Symbol 4: fmi2GetReal (VADDR 0x1060)
  view.setUint32(symOff + 96 + 0, strOffsets[4]!, true);
  buf[symOff + 96 + 4] = (1 << 4) | 2;
  view.setBigUint64(symOff + 96 + 8, 0x1060n, true);

  // Symbol 5: _init (VADDR 0x1080)
  view.setUint32(symOff + 120 + 0, strOffsets[5]!, true);
  buf[symOff + 120 + 4] = (1 << 4) | 2;
  view.setBigUint64(symOff + 120 + 8, 0x1080n, true);

  // Init Array (RVA 0x2300 -> file offset 0x600)
  const initArrOff = 0x600;
  view.setBigUint64(initArrOff, 0x1080n, true); // points to _init

  return buf;
}

// 3. ElfLoader Architecture Detection Test
{
  console.log("\n[Test 3] ElfLoader AArch64 Machine Type Detection");
  const armSo = createSyntheticArm64ElfSo();
  const loader = new ElfLoader(armSo);

  assert.strictEqual(loader.header.is64Bit, true, "Must be 64-bit ELF");
  assert.strictEqual(loader.header.machine, 0xb7, "Machine type must be EM_AARCH64 (0xB7)");
  assert.strictEqual(loader.symbols.size, 5, "Must discover 5 dynamic export symbols");
  assert.ok(loader.symbols.has("fmi2Instantiate"), "Must export fmi2Instantiate");
  assert.ok(loader.symbols.has("fmi2DoStep"), "Must export fmi2DoStep");
  console.log("  ✓ Successfully parsed AArch64 ELF header and dynamic exports");
}

// 4. UniversalBinaryRunner End-to-End Simulation with ARM64 ELF
{
  console.log("\n[Test 4] UniversalBinaryRunner End-to-End Simulation with ARM64 ELF");
  const armSo = createSyntheticArm64ElfSo();

  const runner = createUniversalFmuRunner(armSo, {
    modelName: "Arm64VehicleController",
    variables: [{ name: "speed", valueReference: 0, causality: "output", start: 10.0 }],
  });

  assert.strictEqual(runner.format, "elf");
  assert.strictEqual(runner.cpu.abi, "aapcs64");
  console.log("  ✓ Auto-detected Linux AArch64 ELF and selected AAPCS64 CPU engine");

  // Initial variable value check
  runner.setVar("speed", 50.0);
  const v0 = runner.getVar("speed");
  assert.strictEqual(v0, 50.0, "setVar and getVar must correctly roundtrip 50.0");
  console.log("  ✓ Variable memory storage roundtrip passed (v0 = 50.0)");

  // Run stepping simulation
  const res1 = runner.step(0.0, 0.01);
  // fmi2DoStep adds dt (0.01) to current value (50.0) -> 50.01
  assert.ok(Math.abs(res1["speed"]! - 50.01) < 1e-6, `Expected speed ~50.01, got ${res1["speed"]}`);
  console.log(`  ✓ Simulation step 1 (t=0.01s): speed = ${res1["speed"]}`);

  const res2 = runner.step(0.01, 0.01);
  assert.ok(Math.abs(res2["speed"]! - 50.02) < 1e-6, `Expected speed ~50.02, got ${res2["speed"]}`);
  console.log(`  ✓ Simulation step 2 (t=0.02s): speed = ${res2["speed"]}`);

  runner.terminate();
  console.log("  ✓ Successfully terminated ARM64 runner");
}

console.log("\n✅ All In-Browser ARM64 Emulator tests passed successfully!");
