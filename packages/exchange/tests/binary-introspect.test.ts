// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { createZip } from "../src/fmu/archive.js";
import { introspectBlackboxBinary } from "../src/fmu/binary-introspect.js";

console.log("=== Running Universal Black-Box Binary Introspector Tests ===");

// 1. Test FMU Archive Introspection
console.log("1. Testing FMU archive introspection...");
const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<fmiModelDescription fmiVersion="2.0" modelName="InverterController" guid="{1234-abcd}" generationTool="ModelScript">
  <CoSimulation modelIdentifier="InverterController" canHandleVariableCommunicationStepSize="true"/>
  <ModelVariables>
    <ScalarVariable name="v_dc" valueReference="1" causality="input" variability="continuous">
      <Real start="750.0" unit="V"/>
    </ScalarVariable>
    <ScalarVariable name="i_ac_ref" valueReference="2" causality="input" variability="continuous">
      <Real start="100.0" unit="A"/>
    </ScalarVariable>
    <ScalarVariable name="p_out" valueReference="3" causality="output" variability="continuous">
      <Real unit="W"/>
    </ScalarVariable>
    <ScalarVariable name="gain" valueReference="4" causality="parameter" variability="fixed">
      <Real start="2.5"/>
    </ScalarVariable>
  </ModelVariables>
</fmiModelDescription>`;

const fileMap = new Map<string, Uint8Array>();
fileMap.set("modelDescription.xml", new TextEncoder().encode(xmlContent));
fileMap.set("binaries/linux64/InverterController.so", new Uint8Array([0x7f, 0x45, 0x4c, 0x46]));
fileMap.set("binaries/win64/InverterController.dll", new Uint8Array([0x4d, 0x5a]));

const fmuZipBytes = createZip(fileMap);
const fmuInfo = introspectBlackboxBinary(fmuZipBytes, "InverterController.fmu");

assert.strictEqual(fmuInfo.format, "fmu");
assert.strictEqual(fmuInfo.modelName, "InverterController");
assert.strictEqual(fmuInfo.fmiVersion, "2.0");
assert.strictEqual(fmuInfo.guid, "{1234-abcd}");
assert.strictEqual(fmuInfo.hasCoSimulation, true);
assert.strictEqual(fmuInfo.variables.length, 4);

const vDc = fmuInfo.variables.find((v) => v.name === "v_dc");
assert.ok(vDc);
assert.strictEqual(vDc.causality, "input");
assert.strictEqual(vDc.unit, "V");
assert.strictEqual(vDc.start, 750);

const pOut = fmuInfo.variables.find((v) => v.name === "p_out");
assert.ok(pOut);
assert.strictEqual(pOut.causality, "output");

assert.ok(fmuInfo.architectures.some((a) => a.os === "linux" && a.arch === "x86_64"));
assert.ok(fmuInfo.architectures.some((a) => a.os === "windows" && a.arch === "x86_64"));

// 2. Test PE DLL Header Introspection
console.log("2. Testing PE DLL header introspection...");
const peBuf = new Uint8Array(512);
const peView = new DataView(peBuf.buffer);
// 'MZ' signature
peBuf[0] = 0x4d;
peBuf[1] = 0x5a;
// e_lfanew = 128
peView.setUint32(0x3c, 128, true);
// 'PE\0\0'
peView.setUint32(128, 0x00004550, true);
// Machine = 0x8664 (x86_64)
peView.setUint16(128 + 4, 0x8664, true);

const peInfo = introspectBlackboxBinary(peBuf, "dsusr.dll");
assert.strictEqual(peInfo.format, "pe_dll");
assert.strictEqual(peInfo.modelName, "dsusr");
assert.strictEqual(peInfo.architectures[0]?.os, "windows");
assert.strictEqual(peInfo.architectures[0]?.arch, "x86_64");
assert.strictEqual(peInfo.architectures[0]?.bits, 64);

// 3. Test ELF SO Header Introspection
console.log("3. Testing ELF SO header introspection...");
const elfBuf = new Uint8Array(512);
const elfView = new DataView(elfBuf.buffer);
// '\x7FELF'
elfBuf[0] = 0x7f;
elfBuf[1] = 0x45;
elfBuf[2] = 0x4c;
elfBuf[3] = 0x46;
elfBuf[4] = 2; // 64-bit
elfBuf[5] = 1; // Little-endian
// Machine = 0x3E (x86_64)
elfView.setUint16(18, 0x3e, true);

// Inject symbol string
const symText = "fmi2DoStep fmi2Instantiate fmi2SetReal";
const symBytes = new TextEncoder().encode(symText);
elfBuf.set(symBytes, 64);

const elfInfo = introspectBlackboxBinary(elfBuf, "libcontroller.so");
assert.strictEqual(elfInfo.format, "elf_so");
assert.strictEqual(elfInfo.modelName, "libcontroller");
assert.strictEqual(elfInfo.architectures[0]?.os, "linux");
assert.strictEqual(elfInfo.architectures[0]?.arch, "x86_64");
assert.strictEqual(elfInfo.hasCoSimulation, true);
assert.ok(elfInfo.exportedSymbols.includes("fmi2DoStep"));

// 4. Test Mach-O Dylib Header Introspection
console.log("4. Testing Mach-O dylib header introspection...");
const machoBuf = new Uint8Array(512);
const machoView = new DataView(machoBuf.buffer);
// MH_MAGIC_64 = 0xfeedfacf (little-endian: 0xcf, 0xfa, 0xed, 0xfe)
machoView.setUint32(0, 0xfeedfacf, true);
// CPU_TYPE_X86_64 = 0x01000007
machoView.setInt32(4, 0x01000007, true);
machoView.setInt32(8, 3, true);
machoView.setUint32(12, 6, true); // MH_DYLIB
machoView.setUint32(16, 0, true); // ncmds = 0 for heuristic fallback test
machoView.setUint32(20, 0, true);
machoView.setUint32(24, 2, true);

// Inject symbol strings for fallback scan
const machoSymText = "fmi2DoStep fmi2Instantiate fmi2SetReal";
machoBuf.set(new TextEncoder().encode(machoSymText), 64);

const machoInfo = introspectBlackboxBinary(machoBuf, "libengine.dylib");
assert.strictEqual(machoInfo.format, "macho_dylib");
assert.strictEqual(machoInfo.modelName, "libengine");
assert.strictEqual(machoInfo.architectures[0]?.os, "darwin");
assert.strictEqual(machoInfo.architectures[0]?.arch, "x86_64");
assert.strictEqual(machoInfo.architectures[0]?.bits, 64);
assert.strictEqual(machoInfo.hasCoSimulation, true);
assert.ok(machoInfo.exportedSymbols.includes("fmi2DoStep"));

console.log("All Universal Black-Box Binary Introspector tests PASSED!");
