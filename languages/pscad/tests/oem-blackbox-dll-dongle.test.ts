// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Verification suite for Proprietary OEM Black-Box DLLs & Physical USB Dongle Security:
 * - Wibu-Systems CodeMeter (CmStick / Wibucm64.dll) & Thales Sentinel HASP (hasp_windows_x64.dll)
 * - In-Browser / Node Wasm-Machina Win64 PE32+ DLL binary emulation & Win64 ABI marshaling
 * - Loopback RPC DRM interception & virtual license validation
 * - Closed-loop pre-network DSDYN current injection & post-network DSOUT voltage feedback in EmtSolver
 */

import {
  BrowserDongleManager,
  CM_ERROR_CODES,
  CRuntimeManager,
  HASP_STATUS_CODES,
  registerDrmShims,
  VirtualMockDongleProvider,
  type DrmAccessEvent,
} from "@modelscript/exchange";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EmtdcHostBridge } from "../src/script/emtdc-abi-bridge.js";
import { EmtSolver, OemLicenseError } from "../src/solver/emt-solver.js";
import type { EmtNetlist } from "../src/types.js";

function buildOemPeDll(): Uint8Array {
  const buf = new Uint8Array(4096);
  const view = new DataView(buf.buffer);
  view.setUint16(0x00, 0x5a4d, true); // 'MZ'
  view.setUint32(0x3c, 0x80, true); // e_lfanew
  const peOff = 0x80;
  view.setUint32(peOff, 0x00004550, true); // 'PE\0\0'
  const fh = peOff + 4;
  view.setUint16(fh + 0, 0x8664, true); // AMD64
  view.setUint16(fh + 2, 2, true); // 2 sections (.text, .rdata)
  view.setUint16(fh + 16, 0xf0, true); // SizeOfOptionalHeader
  view.setUint16(fh + 18, 0x2102, true); // DLL
  const oh = fh + 20;
  view.setUint16(oh + 0, 0x020b, true); // PE32+
  view.setUint32(oh + 16, 0x1000, true); // EntryPoint (RVA 0x1000)
  view.setBigUint64(oh + 24, 0x140000000n, true); // ImageBase (0x140000000)
  view.setUint32(oh + 32, 0x1000, true); // SectionAlignment
  view.setUint32(oh + 36, 0x200, true); // FileAlignment
  view.setUint32(oh + 56, 0x4000, true); // SizeOfImage
  view.setUint32(oh + 60, 0x200, true); // SizeOfHeaders
  // Data directories:
  view.setUint32(oh + 112, 0x2000, true); // Export RVA
  view.setUint32(oh + 116, 0x200, true); // Export Size
  view.setUint32(oh + 120, 0x2200, true); // Import RVA
  view.setUint32(oh + 124, 0x100, true); // Import Size
  view.setUint32(oh + 208, 0x2300, true); // IAT RVA
  view.setUint32(oh + 212, 0x100, true); // IAT Size

  // Section Headers:
  const sec1 = oh + 0xf0; // .text at RVA 0x1000, raw offset 0x200, size 0x200
  buf.set(new TextEncoder().encode(".text\0\0\0"), sec1);
  view.setUint32(sec1 + 8, 0x1000, true);
  view.setUint32(sec1 + 12, 0x1000, true);
  view.setUint32(sec1 + 16, 0x200, true);
  view.setUint32(sec1 + 20, 0x200, true);

  const sec2 = sec1 + 40; // .rdata at RVA 0x2000, raw offset 0x400, size 0x800
  buf.set(new TextEncoder().encode(".rdata\0\0"), sec2);
  view.setUint32(sec2 + 8, 0x1000, true);
  view.setUint32(sec2 + 12, 0x2000, true);
  view.setUint32(sec2 + 16, 0x800, true);
  view.setUint32(sec2 + 20, 0x400, true);

  // Machine Code in .text (raw offset 0x200):
  // DllMain at 0x200 (RVA 0x1000):
  // In DllMain, calls cmAccess(0, &handle, 0) through IAT at 0x140002300:
  const dllMainCode = [
    0x48,
    0x83,
    0xec,
    0x28, // SUB RSP, 40 (shadow space)
    0x48,
    0x31,
    0xc9, // XOR RCX, RCX
    0x48,
    0x89,
    0xe2, // MOV RDX, RSP (handlePtr)
    0x4d,
    0x31,
    0xc0, // XOR R8, R8
    0x48,
    0xb8,
    0x00,
    0x23,
    0x00,
    0x40,
    0x01,
    0x00,
    0x00,
    0x00, // MOV RAX, 0x140002300
    0x48,
    0x8b,
    0x00, // MOV RAX, [RAX]
    0xff,
    0xd0, // CALL RAX (cmAccess)
    0x48,
    0x83,
    0xc4,
    0x28, // ADD RSP, 40
    0xb8,
    0x01,
    0x00,
    0x00,
    0x00, // MOV EAX, 1
    0xc3, // RET
  ];
  buf.set(dllMainCode, 0x200);

  // dsdyn_oem at 0x240 (RVA 0x1040):
  // Win64 ABI: RCX = &in0, RDX = &out0, R8 = &storf
  // out0 = 2.0 * in0; storf[0] = 2.0 * in0
  const dsdynCode = [
    0xf2,
    0x0f,
    0x10,
    0x01, // MOVSD XMM0, [RCX]
    0xf2,
    0x0f,
    0x58,
    0xc0, // ADDSD XMM0, XMM0 (2x)
    0xf2,
    0x0f,
    0x11,
    0x02, // MOVSD [RDX], XMM0
    0x41,
    0xf2,
    0x0f,
    0x11,
    0x00, // MOVSD [R8], XMM0
    0x48,
    0x31,
    0xc0, // XOR RAX, RAX
    0xc3, // RET
  ];
  buf.set(dsdynCode, 0x240);

  // .rdata section (raw offset 0x400):
  // 1. Export Directory at 0x400 (RVA 0x2000)
  view.setUint32(0x400 + 16, 1, true); // Base = 1
  view.setUint32(0x400 + 20, 1, true); // NumberOfFunctions = 1
  view.setUint32(0x400 + 24, 1, true); // NumberOfNames = 1
  view.setUint32(0x400 + 28, 0x2040, true); // AddressOfFunctions
  view.setUint32(0x400 + 32, 0x2050, true); // AddressOfNames
  view.setUint32(0x400 + 36, 0x2060, true); // AddressOfNameOrdinals
  view.setUint32(0x440, 0x1040, true); // Function RVA: dsdyn_oem (0x1040)
  view.setUint32(0x450, 0x2080, true); // Name RVA: "dsdyn_oem"
  view.setUint16(0x460, 0, true); // Ordinal 0
  buf.set(new TextEncoder().encode("dsdyn_oem\0"), 0x480);

  // 2. Import Directory at raw offset 0x600 (RVA 0x2200)
  // Entry 1: Wibucm64.dll
  view.setUint32(0x600 + 0, 0x2240, true); // OriginalFirstThunk (ILT RVA)
  view.setUint32(0x600 + 12, 0x2280, true); // Name RVA ("Wibucm64.dll")
  view.setUint32(0x600 + 16, 0x2300, true); // FirstThunk (IAT RVA)
  // Entry 2: null descriptor (20 bytes zero)

  // ILT at raw offset 0x640 (RVA 0x2240)
  view.setBigUint64(0x640, 0x22a0n, true); // Hint/Name RVA for cmAccess
  view.setBigUint64(0x648, 0n, true); // Null terminator

  // Name at raw offset 0x680 (RVA 0x2280): "Wibucm64.dll\0"
  buf.set(new TextEncoder().encode("Wibucm64.dll\0"), 0x680);

  // Hint/Name at raw offset 0x6a0 (RVA 0x22a0): Hint (uint16 = 0) + "cmAccess\0"
  view.setUint16(0x6a0, 0, true);
  buf.set(new TextEncoder().encode("cmAccess\0"), 0x6a2);

  // IAT at raw offset 0x700 (RVA 0x2300)
  view.setBigUint64(0x700, 0x22a0n, true); // Overwritten by Wasm-Machina with host hook address
  view.setBigUint64(0x708, 0n, true); // Null terminator

  return buf;
}

describe("Proprietary OEM Black-Box DLLs & Physical Dongle Security", () => {
  it("registers and executes CodeMeter (Wibucm64.dll) and Sentinel HASP (hasp_windows_x64.dll) DRM shims", () => {
    const memory = {
      baseAddress: 0x10000000n,
      size: 65536,
      buffer: new ArrayBuffer(65536),
      uint8: new Uint8Array(65536),
      dataView: new DataView(new ArrayBuffer(65536)),
    };
    const cruntime = new CRuntimeManager(memory as any);
    const events: DrmAccessEvent[] = [];
    registerDrmShims(cruntime, {
      mode: "virtual",
      allowedFirmCodes: [1001, 6000001],
      allowedProductCodes: [100, 500],
      allowedFeatureIds: [1, 42],
      onLicenseAccess: (evt) => events.push(evt),
    });

    assert.ok(cruntime.handlers.has("cmAccess"), "CodeMeter cmAccess registered");
    assert.ok(cruntime.handlers.has("cmRelease"), "CodeMeter cmRelease registered");
    assert.ok(cruntime.handlers.has("cmCrypt"), "CodeMeter cmCrypt registered");
    assert.ok(cruntime.handlers.has("hasp_login"), "Sentinel hasp_login registered");
    assert.ok(cruntime.handlers.has("hasp_logout"), "Sentinel hasp_logout registered");
    assert.ok(cruntime.handlers.has("hasp_read"), "Sentinel hasp_read registered");

    // Verify synthetic invocation of cmAccess
    let returnVal = 0n;
    const mockCpu = {
      getArg: (i: number) => (i === 1 ? 0x10001000n : 0n),
      setReturnInt: (val: bigint) => {
        returnVal = val;
      },
    };
    const cmHandler = cruntime.handlers.get("cmAccess")!;
    cmHandler({ cpu: mockCpu as any, memory: memory as any });

    assert.equal(returnVal, BigInt(CM_ERROR_CODES.CM_SUCCESS), "cmAccess returned CM_SUCCESS (0)");
    const allocatedHandle = memory.dataView.getBigUint64(0x1000, true);
    assert.ok(allocatedHandle >= 0x1000n, "Allocated non-zero guest license handle");
    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, "codemeter");
    assert.equal(events[0]?.action, "login");
    assert.equal(events[0]?.status, "granted");

    // Verify cmRelease
    const mockReleaseCpu = {
      getArg: () => allocatedHandle,
      setReturnInt: (val: bigint) => {
        returnVal = val;
      },
    };
    const cmReleaseHandler = cruntime.handlers.get("cmRelease")!;
    cmReleaseHandler({ cpu: mockReleaseCpu as any, memory: memory as any });
    assert.equal(returnVal, BigInt(CM_ERROR_CODES.CM_SUCCESS), "cmRelease returned CM_SUCCESS (0)");
    assert.equal(events.length, 2);
    assert.equal(events[1]?.action, "logout");

    // Verify Sentinel hasp_login & hasp_read
    const mockHaspCpu = {
      getArg: (i: number) => (i === 0 ? 42n : i === 2 ? 0x10002000n : 0n),
      readString: () => "OEM_TEST_VENDOR",
      setReturnInt: (val: bigint) => {
        returnVal = val;
      },
    };
    const haspLoginHandler = cruntime.handlers.get("hasp_login")!;
    haspLoginHandler({ cpu: mockHaspCpu as any, memory: memory as any });
    assert.equal(returnVal, BigInt(HASP_STATUS_CODES.HASP_STATUS_OK), "hasp_login returned HASP_STATUS_OK (0)");
    const haspHandle = memory.dataView.getUint32(0x2000, true);
    assert.ok(haspHandle > 0, "Allocated Sentinel guest handle");
  });

  it("enforces strict DRM license rejection when hardware dongle / firm code is absent", () => {
    const memory = {
      baseAddress: 0x10000000n,
      size: 65536,
      buffer: new ArrayBuffer(65536),
      uint8: new Uint8Array(65536),
      dataView: new DataView(new ArrayBuffer(65536)),
    };
    const cruntime = new CRuntimeManager(memory as any);
    registerDrmShims(cruntime, {
      mode: "strict",
      allowedFirmCodes: [9999], // Firm code 1001 will be denied
    });

    let returnVal = 0n;
    const mockCpu = {
      getArg: () => 0n,
      setReturnInt: (val: bigint) => {
        returnVal = val;
      },
    };
    const cmHandler = cruntime.handlers.get("cmAccess")!;
    cmHandler({ cpu: mockCpu as any, memory: memory as any });
    assert.equal(returnVal, BigInt(CM_ERROR_CODES.CM_ERROR_NO_LICENSE), "Strict mode rejected unlicensed firm code");
  });

  it("executes 64-bit Windows PE OEM DLL in Wasm-Machina verifying CodeMeter dongle license via IAT", () => {
    const peBuffer = buildOemPeDll();
    const bridge = new EmtdcHostBridge({ timeStepSec: 50e-6 });

    const { udm, runner } = bridge.registerBinaryDll({
      id: "VESTAS_V112_OEM",
      binaryBuffer: peBuffer,
      dsdynSymbol: "dsdyn_oem",
      portNames: ["in0", "out0"],
      initialPorts: { in0: 150.0, out0: 0.0 },
      numRealStates: 16,
      numIntStates: 8,
    });

    assert.equal(runner.format, "pe");
    assert.equal(udm.id, "VESTAS_V112_OEM");

    // Execute pre-network DSDYN step
    bridge.stepDsdyn(0.0, true, false);

    // Assert that:
    // 1. DllMain executed and validated license via cmAccess in Wibucm64.dll
    // 2. dsdyn_oem executed: out0 = 2.0 * in0 = 300.0
    // 3. STORF[NSTORF] was updated to 300.0
    assert.ok(Math.abs(udm.ports["out0"]! - 300.0) < 1e-6, `Expected out0 = 300.0, got ${udm.ports["out0"]}`);
    assert.ok(
      Math.abs(bridge.state.STORF[udm.storfBaseOffset]! - 300.0) < 1e-6,
      `Expected STORF = 300.0, got ${bridge.state.STORF[udm.storfBaseOffset]}`,
    );
  });

  it("simulates full closed-loop power grid coupling with OEM black-box DLL in EmtSolver", () => {
    const peBuffer = buildOemPeDll();

    const netlist: EmtNetlist = {
      buses: new Map([["Bus1", { id: "Bus1", baseKv: 230.0 }]]),
      branches: [],
      transformers: [],
      transmissionLines: [],
      fmuInstances: [],
      sources: [
        {
          bus: "Bus1",
          voltageKv: 230.0,
          frequencyHz: 60.0,
          rSourceOhm: 1.0,
          lSourceHenry: 0.01,
        },
      ],
      customFortranBlocks: [
        {
          id: "OEM_WIND_TURBINE",
          name: "Vestas_V112_Controller",
          binaryBuffer: peBuffer,
          dsdynSymbol: "dsdyn_oem",
          connectedBus: "Bus1",
          referencedPorts: ["VA"],
          assignedPorts: ["IA_INJ"],
          numRealStates: 16,
          numIntStates: 8,
        },
      ],
      nominalFrequencyHz: 60.0,
    };

    const solver = new EmtSolver(netlist, {
      timeStepSec: 50e-6,
      durationSec: 0.005, // 100 steps
    });

    const hostBridge = solver.getEmtdcHostBridge();
    assert.ok(hostBridge !== null, "Host bridge must be initialized");
    assert.equal(hostBridge.getRegisteredUdms().length, 1, "Exactly 1 OEM UDM registered");

    const res = solver.solve();
    assert.equal(res.metrics.totalSteps, 100);

    const vaTraj = res.busPhaseVoltages.get("Bus1")?.a;
    const oemIaInj = res.branchPhaseCurrents.get("OEM_WIND_TURBINE")?.a;
    const sigTraj = res.controlSignals?.get("OEM_WIND_TURBINE_IA_INJ");

    assert.ok(vaTraj && vaTraj.length === 100, "Bus1 phase A voltage trajectory exists");
    assert.ok(oemIaInj && oemIaInj.length === 100, "OEM block current trajectory exists");
    assert.ok(sigTraj && sigTraj.length === 100, "OEM control signal trajectory exists");

    // Verify consistency between registered branch current buffer and control signal view
    for (let k = 0; k < 100; k++) {
      assert.ok(
        Math.abs(oemIaInj[k]! - sigTraj[k]!) < 1e-9,
        `Step ${k}: branch current (${oemIaInj[k]}) and control signal (${sigTraj[k]}) must match`,
      );
    }

    // Verify non-zero grid voltage and active OEM current injection
    const maxVa = Math.max(...Array.from(vaTraj).map(Math.abs));
    const maxIa = Math.max(...Array.from(oemIaInj).map(Math.abs));
    assert.ok(maxVa > 1e3, `Max bus voltage ${maxVa} V should be realistic transmission voltage`);
    assert.ok(maxIa > 0, `Max OEM current injection ${maxIa} A should be non-zero`);
  });

  it("rejects unlicensed OEM black-box DLL pre-flight and throws OemLicenseError in strict mode", () => {
    const peBuffer = buildOemPeDll();

    const netlist: EmtNetlist = {
      buses: new Map([["Bus1", { id: "Bus1", baseKv: 230.0 }]]),
      branches: [],
      transformers: [],
      transmissionLines: [],
      fmuInstances: [],
      sources: [
        {
          bus: "Bus1",
          voltageKv: 230.0,
          frequencyHz: 60.0,
          rSourceOhm: 1.0,
          lSourceHenry: 0.01,
        },
      ],
      customFortranBlocks: [
        {
          id: "OEM_UNLICENSED_BLOCK",
          name: "Unlicensed_Wind_Model",
          binaryBuffer: peBuffer,
          dsdynSymbol: "dsdyn_oem",
          connectedBus: "Bus1",
          drmFirmCode: 9999, // Unlicensed firm code
          drmProductCode: 9999,
          referencedPorts: ["VA"],
          assignedPorts: ["IA_INJ"],
          numRealStates: 16,
          numIntStates: 8,
        },
      ],
      nominalFrequencyHz: 60.0,
    };

    const solver = new EmtSolver(netlist, {
      timeStepSec: 50e-6,
      durationSec: 0.005,
      strictDrmLicense: true,
      drmLicenseOptions: {
        mode: "strict",
        allowedFirmCodes: [1001], // Only 1001 allowed, 9999 will fail
        allowedProductCodes: [100],
      },
    });

    assert.throws(
      () => solver.solve(),
      (err) => {
        assert.ok(err instanceof OemLicenseError, "Must throw OemLicenseError");
        assert.equal(err.blockId, "OEM_UNLICENSED_BLOCK");
        return true;
      },
    );
  });

  it("validates OEM black-box DLL pre-flight with BrowserDongleManager hardware token", async () => {
    const peBuffer = buildOemPeDll();
    const dongleManager = new BrowserDongleManager([new VirtualMockDongleProvider()]);

    // Discover virtual mock hardware dongle
    const dongles = await dongleManager.scanAllDongles();
    assert.ok(dongles.length >= 1, "Discovered CodeMeter virtual dongle");

    const netlist: EmtNetlist = {
      buses: new Map([["Bus1", { id: "Bus1", baseKv: 230.0 }]]),
      branches: [],
      transformers: [],
      transmissionLines: [],
      fmuInstances: [],
      sources: [
        {
          bus: "Bus1",
          voltageKv: 230.0,
          frequencyHz: 60.0,
          rSourceOhm: 1.0,
          lSourceHenry: 0.01,
        },
      ],
      customFortranBlocks: [
        {
          id: "OEM_LICENSED_TURBINE",
          name: "Licensed_Vestas_Turbine",
          binaryBuffer: peBuffer,
          dsdynSymbol: "dsdyn_oem",
          connectedBus: "Bus1",
          drmType: "codemeter",
          drmFirmCode: 1001,
          drmProductCode: 100,
          requireHardwareDongle: true,
          referencedPorts: ["VA"],
          assignedPorts: ["IA_INJ"],
          numRealStates: 16,
          numIntStates: 8,
        },
      ],
      nominalFrequencyHz: 60.0,
    };

    const solver = new EmtSolver(netlist, {
      timeStepSec: 50e-6,
      durationSec: 0.002, // 40 steps
      strictDrmLicense: true,
      drmLicenseOptions: {
        mode: "auto",
        dongleManager,
      },
    });

    const res = solver.solve();
    assert.equal(res.metrics.totalSteps, 40);
    assert.ok(res.branchPhaseCurrents.has("OEM_LICENSED_TURBINE"), "Licensed OEM block stepped successfully");
  });
});
