// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  checkAirgapCompliance,
  exportSimulationCsv,
  getDesktopSystemInfo,
  loadDesktopBlackboxModel,
  readModelBinaryFile,
  readModelFile,
  runDesktopBlackboxSimulation,
  writeModelBinaryFile,
} from "../src/index.js";

console.log("=== Running End-to-End Desktop Black-box Simulation Test Suite ===");

const tmpDir = path.join(os.tmpdir(), "modelscript-desktop-test-" + Date.now());
fs.mkdirSync(tmpDir, { recursive: true });

/**
 * Builds a syntactically valid Windows PE x86_64 DLL in memory.
 */
function createSyntheticPeDll(): Uint8Array {
  const buf = new Uint8Array(4096);
  const view = new DataView(buf.buffer);

  // DOS Header ('MZ')
  buf[0] = 0x4d;
  buf[1] = 0x5a;
  view.setUint32(60, 128, true); // e_lfanew = 128

  // PE Signature ('PE\0\0')
  const pe = 128;
  buf[pe + 0] = 0x50;
  buf[pe + 1] = 0x45;

  // COFF File Header
  view.setUint16(pe + 4, 0x8664, true); // Machine = IMAGE_FILE_MACHINE_AMD64
  view.setUint16(pe + 6, 2, true); // NumberOfSections = 2 (.text, .edata)
  view.setUint16(pe + 20, 240, true); // SizeOfOptionalHeader
  view.setUint16(pe + 22, 0x2022, true); // Characteristics: DLL | EXECUTABLE_IMAGE | LARGE_ADDRESS_AWARE

  // Optional Header (PE32+)
  const opt = pe + 24;
  view.setUint16(opt + 0, 0x020b, true); // Magic = PE32+ (64-bit)
  view.setUint32(opt + 16, 0x1000, true); // AddressOfEntryPoint = 0x1000
  view.setBigUint64(opt + 24, 0x140000000n, true); // ImageBase = 0x140000000
  view.setUint32(opt + 32, 0x1000, true); // SectionAlignment = 4096
  view.setUint32(opt + 36, 0x200, true); // FileAlignment = 512
  view.setUint32(opt + 56, 0x3000, true); // SizeOfImage = 12288
  view.setUint32(opt + 60, 0x200, true); // SizeOfHeaders = 512
  view.setUint16(opt + 68, 2, true); // Subsystem = Windows GUI
  view.setUint32(opt + 108, 16, true); // NumberOfRvaAndSizes

  // Export Table Data Directory
  view.setUint32(opt + 112, 0x2000, true); // Export Directory RVA
  view.setUint32(opt + 116, 0x200, true); // Export Directory Size

  // Section Headers
  const sec0 = opt + 240;
  // Section 0: .text
  buf.set(new TextEncoder().encode(".text\0\0\0"), sec0);
  view.setUint32(sec0 + 8, 0x200, true); // VirtualSize
  view.setUint32(sec0 + 12, 0x1000, true); // VirtualAddress = 0x1000
  view.setUint32(sec0 + 16, 0x200, true); // SizeOfRawData
  view.setUint32(sec0 + 20, 0x200, true); // PointerToRawData = 0x200
  view.setUint32(sec0 + 36, 0x60000020, true); // Characteristics: CODE | EXECUTE | READ

  // Section 1: .edata
  const sec1 = sec0 + 40;
  buf.set(new TextEncoder().encode(".edata\0\0"), sec1);
  view.setUint32(sec1 + 8, 0x200, true); // VirtualSize
  view.setUint32(sec1 + 12, 0x2000, true); // VirtualAddress = 0x2000
  view.setUint32(sec1 + 16, 0x200, true); // SizeOfRawData
  view.setUint32(sec1 + 20, 0x400, true); // PointerToRawData = 0x400
  view.setUint32(sec1 + 36, 0x40000040, true); // Characteristics: INITIALIZED_DATA | READ

  // Fill .text (offset 0x200)
  const codeOff = 0x200;
  // fmi2Instantiate (0x1000): MOV RAX, RCX; RET
  buf[codeOff + 0x00] = 0x48;
  buf[codeOff + 0x01] = 0x89;
  buf[codeOff + 0x02] = 0xc8;
  buf[codeOff + 0x03] = 0xc3;

  // fmi2SetReal (0x1020): MOVSD XMM0, [RCX]; XOR RAX, RAX; RET
  buf[codeOff + 0x20] = 0xf2;
  buf[codeOff + 0x21] = 0x0f;
  buf[codeOff + 0x22] = 0x10;
  buf[codeOff + 0x23] = 0x01;
  buf[codeOff + 0x24] = 0x48;
  buf[codeOff + 0x25] = 0x31;
  buf[codeOff + 0x26] = 0xc0;
  buf[codeOff + 0x27] = 0xc3;

  // fmi2DoStep (0x1040): Win64: curTime in XMM1, dt in XMM2 -> ADDSD XMM1, XMM2; MOVSD XMM0, XMM1; XOR RAX, RAX; RET
  buf[codeOff + 0x40] = 0xf2;
  buf[codeOff + 0x41] = 0x0f;
  buf[codeOff + 0x42] = 0x58;
  buf[codeOff + 0x43] = 0xca;
  buf[codeOff + 0x44] = 0xf2;
  buf[codeOff + 0x45] = 0x0f;
  buf[codeOff + 0x46] = 0x10;
  buf[codeOff + 0x47] = 0xc1;
  buf[codeOff + 0x48] = 0x48;
  buf[codeOff + 0x49] = 0x31;
  buf[codeOff + 0x4a] = 0xc0;
  buf[codeOff + 0x4b] = 0xc3;

  // fmi2GetReal (0x1060): XOR RAX, RAX; RET
  buf[codeOff + 0x60] = 0x48;
  buf[codeOff + 0x61] = 0x31;
  buf[codeOff + 0x62] = 0xc0;
  buf[codeOff + 0x63] = 0xc3;

  // Fill .edata (offset 0x400)
  const edataOff = 0x400;
  view.setUint32(edataOff + 12, 0x2060, true); // Name RVA
  view.setUint32(edataOff + 16, 1, true); // Base = 1
  view.setUint32(edataOff + 20, 4, true); // NumberOfFunctions = 4
  view.setUint32(edataOff + 24, 4, true); // NumberOfNames = 4
  view.setUint32(edataOff + 28, 0x2030, true); // AddressOfFunctions
  view.setUint32(edataOff + 32, 0x2040, true); // AddressOfNames
  view.setUint32(edataOff + 36, 0x2050, true); // AddressOfNameOrdinals

  // Function RVAs at 0x2030 (offset 0x430)
  view.setUint32(edataOff + 0x30, 0x1000, true);
  view.setUint32(edataOff + 0x34, 0x1020, true);
  view.setUint32(edataOff + 0x38, 0x1040, true);
  view.setUint32(edataOff + 0x3c, 0x1060, true);

  // Name RVAs at 0x2040 (offset 0x440)
  view.setUint32(edataOff + 0x40, 0x2080, true);
  view.setUint32(edataOff + 0x44, 0x2098, true);
  view.setUint32(edataOff + 0x48, 0x20b0, true);
  view.setUint32(edataOff + 0x4c, 0x20c0, true);

  // Ordinals at 0x2050 (offset 0x450)
  view.setUint16(edataOff + 0x50, 0, true);
  view.setUint16(edataOff + 0x52, 1, true);
  view.setUint16(edataOff + 0x54, 2, true);
  view.setUint16(edataOff + 0x56, 3, true);

  // Name strings
  const enc = new TextEncoder();
  buf.set(enc.encode("SyntheticMotor.dll\0"), edataOff + 0x60);
  buf.set(enc.encode("fmi2Instantiate\0"), edataOff + 0x80);
  buf.set(enc.encode("fmi2SetReal\0"), edataOff + 0x98);
  buf.set(enc.encode("fmi2DoStep\0"), edataOff + 0xb0);
  buf.set(enc.encode("fmi2GetReal\0"), edataOff + 0xc0);

  return buf;
}

/**
 * Builds a syntactically valid Linux ELF64 Shared Object in memory.
 */
function createSyntheticElfSo(): Uint8Array {
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
  buf[7] = 0;

  view.setUint16(16, 3, true); // ET_DYN
  view.setUint16(18, 0x3e, true); // EM_X86_64
  view.setUint32(20, 1, true);
  view.setBigUint64(24, 0x1000n, true); // e_entry
  view.setBigUint64(32, 64n, true); // e_phoff
  view.setUint16(52, 64, true); // e_ehsize
  view.setUint16(54, 56, true); // e_phentsize
  view.setUint16(56, 2, true); // 2 program headers

  // PH 0: PT_LOAD Code
  const ph0 = 64;
  view.setUint32(ph0 + 0, 1, true);
  view.setUint32(ph0 + 4, 5, true);
  view.setBigUint64(ph0 + 8, 0x100n, true);
  view.setBigUint64(ph0 + 16, 0x1000n, true);
  view.setBigUint64(ph0 + 32, 0x200n, true);
  view.setBigUint64(ph0 + 40, 0x200n, true);

  // PH 1: PT_LOAD Data
  const ph1 = ph0 + 56;
  view.setUint32(ph1 + 0, 1, true);
  view.setUint32(ph1 + 4, 6, true);
  view.setBigUint64(ph1 + 8, 0x300n, true);
  view.setBigUint64(ph1 + 16, 0x2000n, true);
  view.setBigUint64(ph1 + 32, 0x200n, true);
  view.setBigUint64(ph1 + 40, 0x200n, true);

  // Code (offset 0x100, vaddr 0x1000)
  const codeOff = 0x100;
  // fmi2Instantiate: MOV RAX, RDI; RET
  buf[codeOff + 0x00] = 0x48;
  buf[codeOff + 0x01] = 0x89;
  buf[codeOff + 0x02] = 0xf8;
  buf[codeOff + 0x03] = 0xc3;
  // fmi2DoStep: ADDSD XMM0, XMM1; XOR RAX, RAX; RET
  buf[codeOff + 0x20] = 0xf2;
  buf[codeOff + 0x21] = 0x0f;
  buf[codeOff + 0x22] = 0x58;
  buf[codeOff + 0x23] = 0xc1;
  buf[codeOff + 0x24] = 0x48;
  buf[codeOff + 0x25] = 0x31;
  buf[codeOff + 0x26] = 0xc0;
  buf[codeOff + 0x27] = 0xc3;
  // fmi2SetReal: XOR RAX, RAX; RET
  buf[codeOff + 0x40] = 0x48;
  buf[codeOff + 0x41] = 0x31;
  buf[codeOff + 0x42] = 0xc0;
  buf[codeOff + 0x43] = 0xc3;
  // fmi2GetReal: XOR RAX, RAX; RET
  buf[codeOff + 0x60] = 0x48;
  buf[codeOff + 0x61] = 0x31;
  buf[codeOff + 0x62] = 0xc0;
  buf[codeOff + 0x63] = 0xc3;

  // Embed dynamic string text table for introspection fallback
  const symText = "fmi2Instantiate fmi2DoStep fmi2SetReal fmi2GetReal";
  buf.set(new TextEncoder().encode(symText), 0x300);

  return buf;
}

// ============================================================================
// TEST 1: Direct File IO & Black-box Binary Persistence on Desktop
// ============================================================================
console.log("1. Testing desktop local file persistence with synthetic PE DLL...");
const peFile = path.join(tmpDir, "TurbineGovernor.dll");
const peData = createSyntheticPeDll();
await writeModelBinaryFile(peFile, peData);

assert.ok(fs.existsSync(peFile), "TurbineGovernor.dll must exist on disk");
const readBack = await readModelBinaryFile(peFile);
assert.strictEqual(readBack.byteLength, peData.byteLength, "Binary file length must match exactly");
assert.strictEqual(readBack[0], 0x4d, "Must be valid MZ header");
console.log("✓ Test 1 passed: Native file IO written and verified.");

// ============================================================================
// TEST 2: Desktop Black-box Model Loading & Introspection
// ============================================================================
console.log("2. Testing desktop blackbox model loading and architecture introspection...");
const loaded = await loadDesktopBlackboxModel(peFile);
assert.strictEqual(loaded.modelName, "TurbineGovernor", "Model name mismatch");
assert.strictEqual(loaded.introspection.format, "pe_dll", "Format must be pe_dll");
assert.strictEqual(loaded.introspection.architectures[0]?.os, "windows", "OS must be windows");
assert.strictEqual(loaded.introspection.architectures[0]?.arch, "x86_64", "Arch must be x86_64");
assert.strictEqual(loaded.introspection.hasCoSimulation, true, "Must detect co-simulation capability");
assert.ok(loaded.runner !== null, "UniversalBinaryRunner must be instantiated");
console.log("✓ Test 2 passed: Model loaded and introspected directly from desktop disk.");

// ============================================================================
// TEST 3: End-to-End Simulation Sweeps with Input Modulation
// ============================================================================
console.log("3. Testing end-to-end desktop simulation execution across time horizon...");
let stepsReported = 0;
const simResult = await runDesktopBlackboxSimulation(
  peFile,
  {
    startTime: 0.0,
    stopTime: 0.5,
    stepSize: 0.05,
    inputs: (t) => ({ torque: 100.0 * Math.sin(t * 10) }),
    onStepProgress: (t, outputs) => {
      stepsReported++;
    },
  },
  "TurbineGovernor.dll",
);

assert.strictEqual(simResult.modelName, "TurbineGovernor");
assert.strictEqual(simResult.format, "pe_dll");
assert.ok(simResult.timeSteps >= 10, "Must record at least 10 trajectory steps");
assert.strictEqual(stepsReported, simResult.timeSteps, "Progress callback step count mismatch");
assert.ok(simResult.executionTimeMs >= 0, "Execution time must be recorded");
console.log(`✓ Test 3 passed: Completed ${simResult.timeSteps} steps in ${simResult.executionTimeMs} ms.`);

// ============================================================================
// TEST 4: Trajectory CSV Serialization & Disk Export
// ============================================================================
console.log("4. Testing trajectory CSV formatting and disk export...");
const csvFile = path.join(tmpDir, "TurbineGovernor_results.csv");
const csvContent = await exportSimulationCsv(csvFile, simResult.trajectory);

assert.ok(fs.existsSync(csvFile), "Results CSV must exist on disk");
assert.ok(csvContent.startsWith("time"), "CSV must contain header row");
const readCsv = await readModelFile(csvFile);
assert.strictEqual(readCsv, csvContent, "Read-back CSV must match exported content");
console.log("✓ Test 4 passed: Trajectory exported and validated against disk.");

// ============================================================================
// TEST 5: Linux ELF Black-box Model Simulation on Desktop
// ============================================================================
console.log("5. Testing Linux ELF shared object simulation on desktop...");
const elfFile = path.join(tmpDir, "InverterController.so");
const elfData = createSyntheticElfSo();
await writeModelBinaryFile(elfFile, elfData);

const elfSim = await runDesktopBlackboxSimulation(
  elfFile,
  {
    startTime: 0.0,
    stopTime: 0.2,
    stepSize: 0.02,
    inputs: { gridFrequency: 60.0 },
  },
  "InverterController.so",
);

assert.strictEqual(elfSim.modelName, "InverterController");
assert.strictEqual(elfSim.format, "elf_so");
assert.ok(elfSim.timeSteps >= 10, "Must step Linux ELF binary across 10 steps");
console.log("✓ Test 5 passed: Linux ELF blackbox model executed end-to-end on desktop.");

// ============================================================================
// TEST 6: CEII / NERC CIP Air-Gap Security Verification
// ============================================================================
console.log("6. Testing desktop air-gap compliance and hardware reporting...");
const sysInfo = await getDesktopSystemInfo();
assert.ok(typeof sysInfo.platform === "string", "Platform must be reported");
assert.strictEqual(sysInfo.airgapEnforced, true, "Airgap must be strictly enforced");
assert.strictEqual(sysInfo.ceiiComplianceReady, true, "CEII compliance must be ready");

const airgap = checkAirgapCompliance();
assert.strictEqual(airgap.compliant, true);
assert.strictEqual(airgap.outboundTrafficBlocked, true);
assert.strictEqual(airgap.localStorageOnly, true);
console.log("✓ Test 6 passed: Air-gap compliance confirmed for regulated utility environments.");

// Clean up temporary test files
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log("\n=======================================================");
console.log("ALL 6 END-TO-END DESKTOP SIMULATION TESTS PASSED!");
console.log("=======================================================\n");
