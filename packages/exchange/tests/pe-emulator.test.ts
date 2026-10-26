// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { CRuntimeManager, PeLoader, X86Cpu, createPeDllFmuRunner } from "../src/fmu/pe-emulator/index.js";

console.log("=== Running In-Browser Windows PE DLL Emulator Tests ===");

/**
 * Builds a syntactically valid PE32+ (64-bit AMD64) DLL binary in memory
 * containing genuine x64 machine code for FMI 2.0 export functions:
 * - fmi2Instantiate (RVA 0x1000)
 * - fmi2SetReal     (RVA 0x1020)
 * - fmi2DoStep      (RVA 0x1040)
 * - fmi2GetReal     (RVA 0x1080)
 */
function createSyntheticFmiDll(): Uint8Array {
  const buf = new Uint8Array(4096);
  const view = new DataView(buf.buffer);

  // 1. DOS Header
  view.setUint16(0x00, 0x5a4d, true); // 'MZ'
  view.setUint32(0x3c, 0x80, true); // e_lfanew = 0x80

  // 2. PE Header ('PE\0\0')
  const peOff = 0x80;
  view.setUint32(peOff, 0x00004550, true);

  // 3. File Header
  const fileHeader = peOff + 4;
  view.setUint16(fileHeader + 0, 0x8664, true); // Machine: AMD64
  view.setUint16(fileHeader + 2, 2, true); // NumberOfSections: 2 (.text, .rdata)
  view.setUint32(fileHeader + 4, 0x64000000, true); // TimeDateStamp
  view.setUint16(fileHeader + 16, 0xf0, true); // SizeOfOptionalHeader
  view.setUint16(fileHeader + 18, 0x2102, true); // Characteristics: DLL | EXECUTABLE_IMAGE

  // 4. Optional Header (PE32+)
  const optHeader = fileHeader + 20;
  view.setUint16(optHeader + 0, 0x020b, true); // Magic: PE32+ (64-bit)
  view.setUint32(optHeader + 16, 0x1000, true); // AddressOfEntryPoint
  view.setBigUint64(optHeader + 24, 0x180000000n, true); // ImageBase
  view.setUint32(optHeader + 32, 0x1000, true); // SectionAlignment
  view.setUint32(optHeader + 36, 0x200, true); // FileAlignment
  view.setUint32(optHeader + 56, 0x4000, true); // SizeOfImage
  view.setUint32(optHeader + 60, 0x200, true); // SizeOfHeaders

  // Data Directories (offset 112 from optHeader)
  const dataDir = optHeader + 112;
  // Export Directory: RVA 0x2000, Size 0x200
  view.setUint32(dataDir + 0, 0x2000, true);
  view.setUint32(dataDir + 4, 0x200, true);

  // 5. Section Headers (after optional header)
  const secTable = optHeader + 0xf0;

  // Section 1: .text (Code)
  // Name: ".text\0\0\0"
  buf.set(new TextEncoder().encode(".text\0\0\0"), secTable);
  view.setUint32(secTable + 8, 0x1000, true); // VirtualSize
  view.setUint32(secTable + 12, 0x1000, true); // VirtualAddress (RVA)
  view.setUint32(secTable + 16, 0x200, true); // SizeOfRawData
  view.setUint32(secTable + 20, 0x200, true); // PointerToRawData
  view.setUint32(secTable + 36, 0x60000020, true); // Characteristics: CODE | EXECUTE | READ

  // Section 2: .rdata (Exports & Constants)
  const sec2 = secTable + 40;
  buf.set(new TextEncoder().encode(".rdata\0\0"), sec2);
  view.setUint32(sec2 + 8, 0x1000, true); // VirtualSize
  view.setUint32(sec2 + 12, 0x2000, true); // VirtualAddress (RVA)
  view.setUint32(sec2 + 16, 0x400, true); // SizeOfRawData
  view.setUint32(sec2 + 20, 0x400, true); // PointerToRawData
  view.setUint32(sec2 + 36, 0x40000040, true); // Characteristics: INITIALIZED_DATA | READ

  // 6. Fill .text section with genuine x64 machine code at file offset 0x200 (RVA 0x1000)
  const textOff = 0x200;

  // Function 1: fmi2Instantiate (RVA 0x1000, offset 0x200)
  // Returns instance pointer passed in RCX: MOV RAX, RCX ; RET
  buf[textOff + 0] = 0x48;
  buf[textOff + 1] = 0x89;
  buf[textOff + 2] = 0xc8; // MOV RAX, RCX
  buf[textOff + 3] = 0xc3; // RET

  // Function 2: fmi2SetReal (RVA 0x1020, offset 0x220)
  // fmi2SetReal(c: RCX, vr: RDX, nvr: R8, val: R9)
  // Read double from [RCX] into XMM0, return 0 (OK)
  buf[textOff + 0x20] = 0xf2;
  buf[textOff + 0x21] = 0x0f;
  buf[textOff + 0x22] = 0x10;
  buf[textOff + 0x23] = 0x01; // MOVSD XMM0, [RCX]
  buf[textOff + 0x24] = 0x48;
  buf[textOff + 0x25] = 0x31;
  buf[textOff + 0x26] = 0xc0; // XOR RAX, RAX
  buf[textOff + 0x27] = 0xc3; // RET

  // Function 3: fmi2DoStep (RVA 0x1040, offset 0x240)
  // fmi2DoStep(c: RCX, curTime: XMM1, dt: XMM2, noSet: R9)
  // Compute: XMM0 = XMM1 + XMM2 ; return 0 (OK)
  buf[textOff + 0x40] = 0xf2;
  buf[textOff + 0x41] = 0x0f;
  buf[textOff + 0x42] = 0x10;
  buf[textOff + 0x43] = 0xc1; // MOVSD XMM0, XMM1
  buf[textOff + 0x44] = 0xf2;
  buf[textOff + 0x45] = 0x0f;
  buf[textOff + 0x46] = 0x58;
  buf[textOff + 0x47] = 0xc2; // ADDSD XMM0, XMM2
  buf[textOff + 0x48] = 0x48;
  buf[textOff + 0x49] = 0x31;
  buf[textOff + 0x4a] = 0xc0; // XOR RAX, RAX
  buf[textOff + 0x4b] = 0xc3; // RET

  // Function 4: fmi2GetReal (RVA 0x1080, offset 0x280)
  // fmi2GetReal(c: RCX, vr: RDX, nvr: R8, val: R9)
  // Return 0 (OK)
  buf[textOff + 0x80] = 0x48;
  buf[textOff + 0x81] = 0x31;
  buf[textOff + 0x82] = 0xc0; // XOR RAX, RAX
  buf[textOff + 0x83] = 0xc3; // RET

  // 7. Fill .rdata section with Export Directory at file offset 0x400 (RVA 0x2000)
  const rdataOff = 0x400;
  const expDir = rdataOff;
  view.setUint32(expDir + 16, 1, true); // Base ordinal: 1
  view.setUint32(expDir + 20, 4, true); // NumberOfFunctions: 4
  view.setUint32(expDir + 24, 4, true); // NumberOfNames: 4
  view.setUint32(expDir + 28, 0x2040, true); // AddressOfFunctions (RVA 0x2040)
  view.setUint32(expDir + 32, 0x2060, true); // AddressOfNames (RVA 0x2060)
  view.setUint32(expDir + 36, 0x2080, true); // AddressOfNameOrdinals (RVA 0x2080)

  // AddressOfFunctions table (RVA 0x2040, offset 0x440)
  const funcsOff = rdataOff + 0x40;
  view.setUint32(funcsOff + 0, 0x1000, true); // fmi2Instantiate
  view.setUint32(funcsOff + 4, 0x1020, true); // fmi2SetReal
  view.setUint32(funcsOff + 8, 0x1040, true); // fmi2DoStep
  view.setUint32(funcsOff + 12, 0x1080, true); // fmi2GetReal

  // AddressOfNames table (RVA 0x2060, offset 0x460)
  const namesOff = rdataOff + 0x60;
  view.setUint32(namesOff + 0, 0x2100, true);
  view.setUint32(namesOff + 4, 0x2120, true);
  view.setUint32(namesOff + 8, 0x2140, true);
  view.setUint32(namesOff + 12, 0x2160, true);

  // AddressOfNameOrdinals table (RVA 0x2080, offset 0x480)
  const ordsOff = rdataOff + 0x80;
  view.setUint16(ordsOff + 0, 0, true);
  view.setUint16(ordsOff + 2, 1, true);
  view.setUint16(ordsOff + 4, 2, true);
  view.setUint16(ordsOff + 6, 3, true);

  // String names in .rdata
  const enc = new TextEncoder();
  buf.set(enc.encode("fmi2Instantiate\0"), rdataOff + 0x100);
  buf.set(enc.encode("fmi2SetReal\0"), rdataOff + 0x120);
  buf.set(enc.encode("fmi2DoStep\0"), rdataOff + 0x140);
  buf.set(enc.encode("fmi2GetReal\0"), rdataOff + 0x160);

  return buf;
}

// ==========================================
// TEST 1: PeLoader Parsing & Section Mapping
// ==========================================
console.log("1. Testing PeLoader parsing synthetic Windows DLL...");
const dllBuf = createSyntheticFmiDll();
const loader = new PeLoader(dllBuf);

assert.strictEqual(loader.header.is64Bit, true, "Must be recognized as 64-bit PE32+");
assert.strictEqual(loader.header.machine, 0x8664, "Machine must be AMD64");
assert.strictEqual(loader.sections.length, 2, "Must contain .text and .rdata sections");
assert.strictEqual(loader.exports.size, 4, "Must parse 4 exported functions");

assert.ok(loader.exports.has("fmi2Instantiate"), "Must export fmi2Instantiate");
assert.ok(loader.exports.has("fmi2DoStep"), "Must export fmi2DoStep");
assert.ok(loader.exports.has("fmi2SetReal"), "Must export fmi2SetReal");
assert.ok(loader.exports.has("fmi2GetReal"), "Must export fmi2GetReal");
console.log("   ✓ PeLoader correctly parsed PE headers and exported symbol table");

// ==========================================
// TEST 2: Guest Memory Mapping
// ==========================================
console.log("2. Testing guest memory mapping and section relocation...");
const memory = loader.mapImageToMemory(0x140000000n);
assert.strictEqual(memory.baseAddress, 0x140000000n);
assert.ok(memory.size >= 4 * 1024 * 1024, "Guest memory size must include stack and heap");

// Verify code was mapped to virtual address 0x1000
assert.strictEqual(memory.uint8[0x1000], 0x48, "MOV RAX opcode mapped in guest memory");
assert.strictEqual(memory.uint8[0x1003], 0xc3, "RET opcode mapped in guest memory");
console.log("   ✓ Image sections mapped accurately into guest virtual memory space");

// ==========================================
// TEST 3: C-Runtime Shims & Heap Allocator
// ==========================================
console.log("3. Testing C-Runtime Shims & Heap Allocator...");
const cruntime = new CRuntimeManager(memory);

const ptr1 = cruntime.malloc(64);
const ptr2 = cruntime.malloc(128);
assert.ok(ptr2 > ptr1, "Heap pointers must advance monotonically");
assert.strictEqual(Number(ptr1 % 16n), 0, "Allocations must be 16-byte aligned");

// Test math shims
let dummyReturnFloat = 0;
const dummyCpu = {
  registers: {} as any,
  getArg: () => 0n,
  getFloatArg: (i: number) => (i === 0 ? Math.PI / 2 : 0),
  setReturnInt: () => {},
  setReturnFloat: (v: number) => {
    dummyReturnFloat = v;
  },
  readString: () => "",
};

cruntime.handlers.get("sin")!({ cpu: dummyCpu, memory });
assert.ok(Math.abs(dummyReturnFloat - 1.0) < 1e-6, "sin(pi/2) must evaluate to 1.0");

cruntime.handlers.get("sqrt")!({ cpu: { ...dummyCpu, getFloatArg: () => 16.0 }, memory });
assert.strictEqual(dummyReturnFloat, 4.0, "sqrt(16) must evaluate to 4.0");
console.log("   ✓ C-runtime math and heap allocator verified");

// ==========================================
// TEST 4: X86Cpu Execution of FMI Functions
// ==========================================
console.log("4. Testing x86_64 CPU execution of native FMI functions...");
const cpu = new X86Cpu(memory, true, cruntime);

// Call fmi2Instantiate at RVA 0x1000
const testInstPtr = memory.baseAddress + 0x1000n;
const instantiateAddr = memory.baseAddress + 0x1000n;
const retInst = cpu.callFunction(instantiateAddr, [testInstPtr, 1n, memory.baseAddress + 0x2000n]);
assert.strictEqual(retInst, testInstPtr, "fmi2Instantiate must return instance pointer");

// Call fmi2DoStep at RVA 0x1040 (adds curTime XMM1 + dt XMM2)
const doStepAddr = memory.baseAddress + 0x1040n;
cpu.callFunction(doStepAddr, [testInstPtr, 1n], [0.0, 0.5, 0.05]);
assert.ok(Math.abs(cpu.registers.xmm[0] - 0.55) < 1e-9, "fmi2DoStep must add 0.5 + 0.05 = 0.55");
console.log("   ✓ x86_64 CPU successfully executed machine code functions and SSE additions");

// ==========================================
// TEST 5: High-Level PeDllFmuRunner Execution
// ==========================================
console.log("5. Testing high-level PeDllFmuRunner simulation workflow...");
const runner = createPeDllFmuRunner(dllBuf, {
  modelName: "TestChuaModel",
  guid: "{12345678-ABCD-EF01-2345-6789ABCDEF01}",
  variables: [
    { name: "u", valueReference: 1, causality: "input", start: 2.0 },
    { name: "y", valueReference: 2, causality: "output" },
  ],
});

assert.strictEqual(runner.getTime(), 0.0, "Initial time must be 0");
runner.setVar("u", 5.0);

const outputs = runner.step(0.0, 0.01, { u: 10.0 });
assert.strictEqual(runner.getTime(), 0.01, "Simulation time must advance by dt");
assert.ok(outputs !== null, "Outputs must be returned");

runner.terminate();
console.log("   ✓ PeDllFmuRunner initialized, stepped, and terminated cleanly");

console.log("All In-Browser Windows PE DLL Emulator tests PASSED successfully!");
