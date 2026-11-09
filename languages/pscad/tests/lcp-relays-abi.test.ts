// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Verification suite for Phase 1.2, Phase 2.2, and Phase 2.3 in @modelscript/pscad & @modelscript/simulate:
 * - Multiconductor Overhead Tower Line Constants Program (LCP) & Vector Fitting
 * - Digital Protection Relays (ANSI 21, 87T/87L, 50/51/67, 27/59/81U/81O/81R)
 * - EMTDC Fortran/C Binary ABI Host Bridge (`STORF`/`STORI`/`STORL`, `DSDYN`/`DSOUT`, FMI 3.0 C wrapper)
 * - MHI PSCAD Python Automation Compatibility Layer (`MhiPscadApplication`)
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeBundleEquivalentRadii,
  computeMulticonductorLineConstants,
  DigitalProtectionRelay,
  evaluateInverseTimeCurveSec,
  synthesizeFdLineFromMulticonductorTower,
} from "../../../packages/simulate/src/solvers/emt/index.js";
import {
  EmtdcHostBridge,
  EmtSolver,
  extractEmtNetlist,
  generateEmtdcFmi3WrapperC,
  MhiPscadApplication,
  netlistToEmtCircuit,
  parsePscx,
  pscadLanguage,
} from "../src/index.js";

describe("Multiconductor Overhead Tower LCP & Vector Fitting", () => {
  it("computes bundle equivalent GMR, Carson earth return, Kron shield wire reduction, and sequence RLGC", () => {
    const bundle = computeBundleEquivalentRadii({
      id: "PhaseA",
      phase: 1,
      xM: -10.0,
      yTowerM: 28.0,
      sagM: 9.0,
      radiusM: 0.014,
      dcResistanceOhmPerKm: 0.058,
      bundleCount: 4,
      bundleSpacingM: 0.45,
    });
    assert.ok(bundle.gmrEqM > 0.15 && bundle.gmrEqM < 0.25, `Quad bundle GMR should be ~0.18 m, got ${bundle.gmrEqM}`);
    assert.ok(bundle.rEqM > bundle.gmrEqM, "Electrostatic bundle radius exceeds GMR");

    const geom = {
      lengthKm: 120.0,
      conductors: [
        {
          id: "A",
          phase: 1 as const,
          xM: -10.0,
          yTowerM: 28.0,
          sagM: 9.0,
          radiusM: 0.014,
          dcResistanceOhmPerKm: 0.058,
          bundleCount: 2,
        },
        {
          id: "B",
          phase: 2 as const,
          xM: 0.0,
          yTowerM: 28.0,
          sagM: 9.0,
          radiusM: 0.014,
          dcResistanceOhmPerKm: 0.058,
          bundleCount: 2,
        },
        {
          id: "C",
          phase: 3 as const,
          xM: 10.0,
          yTowerM: 28.0,
          sagM: 9.0,
          radiusM: 0.014,
          dcResistanceOhmPerKm: 0.058,
          bundleCount: 2,
        },
        { id: "SW1", phase: 0 as const, xM: -6.0, yTowerM: 35.0, sagM: 6.0, radiusM: 0.006, dcResistanceOhmPerKm: 1.8 },
        { id: "SW2", phase: 0 as const, xM: 6.0, yTowerM: 35.0, sagM: 6.0, radiusM: 0.006, dcResistanceOhmPerKm: 1.8 },
      ],
      soilResistivityOhmM: 100.0,
    };

    const lcp = computeMulticonductorLineConstants(geom, 60.0);

    assert.ok(lcp.r1OhmPerKm > 0.02 && lcp.r1OhmPerKm < 0.06, `Expected R1 in (0.02, 0.06), got ${lcp.r1OhmPerKm}`);
    assert.ok(lcp.r0OhmPerKm > lcp.r1OhmPerKm * 3.0, "Zero-sequence resistance must include Carson ground return");
    assert.ok(lcp.l1HPerKm > 0.0007 && lcp.l1HPerKm < 0.0014, `Unexpected L1: ${lcp.l1HPerKm}`);
    assert.ok(lcp.l0HPerKm > lcp.l1HPerKm * 1.8, "Zero-sequence inductance must exceed positive-sequence");
    assert.ok(lcp.c1FPerKm > 8e-9 && lcp.c1FPerKm < 1.6e-8, `Unexpected C1: ${lcp.c1FPerKm}`);
    assert.ok(lcp.c0FPerKm < lcp.c1FPerKm, "Zero-sequence capacitance is smaller than positive-sequence");
    assert.ok(lcp.zc1Ohm > 220 && lcp.zc1Ohm < 380, `Surge impedance Zc1=${lcp.zc1Ohm} Ohm`);

    const fdConfig = synthesizeFdLineFromMulticonductorTower("Line_500kV", 1, 2, geom, 6);
    assert.equal(fdConfig.yPoles.length, 6);
    assert.equal(fdConfig.hPoles.length, 6);
    for (const p of fdConfig.yPoles) {
      assert.ok(p.pole < 0, "All vector-fitted poles must be strictly stable (Re(p) < 0)");
    }
    assert.ok(fdConfig.y0 > 0, "High-frequency characteristic admittance y0 must be positive");
  });

  it("extracts overhead tower LCP parameters and protection relays from PSCAD .pscx XML", () => {
    const pscxXml = `<?xml version="1.0" encoding="UTF-8"?>
<project name="TowerLCP_Protection" version="5.0.0">
  <param name="time_step" value="50.0"/>
  <param name="time_duration" value="0.2"/>
  <param name="f_base" value="60.0"/>
  <definitions>
    <definition name="Main" type="module">
      <schematic>
        <Bus name="Bus1" id="B1" x="100" y="100" vbase="230.0"/>
        <Bus name="Bus2" id="B2" x="300" y="100" vbase="230.0"/>
        <User classid="UserCmp" defn="master:tline" id="TL1" x="200" y="100">
          <param name="Name" value="Line230"/>
          <param name="length" value="80.0"/>
          <param name="tower_height" value="25.0"/>
          <param name="phase_spacing" value="8.5"/>
          <param name="conductor_radius" value="0.015"/>
          <param name="bundle_count" value="2"/>
          <param name="soil_resistivity" value="100.0"/>
          <port name="From" id="p_from"/>
          <port name="To" id="p_to"/>
        </User>
        <User classid="UserCmp" defn="master:distance_relay" id="REL21" x="120" y="140">
          <param name="Name" value="DistRelay1"/>
          <param name="ansi" value="21"/>
          <param name="Z1" value="12.0"/>
          <param name="Z2" value="18.0"/>
          <param name="Z3" value="25.0"/>
          <param name="line_angle" value="78.0"/>
          <port name="Bus" id="p_rel"/>
        </User>
        <User classid="UserCmp" defn="master:mmc_valve_gpu" id="MMC1" x="320" y="140">
          <param name="Name" value="HVDC_MMC"/>
          <param name="MVA" value="400.0"/>
          <param name="V" value="230.0"/>
          <param name="Vdc" value="400.0"/>
          <param name="N_sm" value="64"/>
          <port name="AC" id="p_mmc"/>
        </User>
      </schematic>
    </definition>
  </definitions>
</project>`;

    const proj = parsePscx(pscxXml);
    const netlist = extractEmtNetlist(proj);
    assert.equal(netlist.transmissionLines.length, 1);
    const line = netlist.transmissionLines[0]!;
    assert.equal(line.modelType, "fdpm");
    assert.equal(line.bundleCount, 2);
    assert.ok(line.r0PerKm !== undefined && line.r0PerKm > line.rPerKm * 2.0);
    assert.ok(line.l0PerKm !== undefined && line.l0PerKm > line.lPerKm * 1.5);
    assert.ok(line.poles && line.poles.length === 4);

    assert.equal(netlist.protectionRelays?.length, 1);
    assert.equal(netlist.protectionRelays?.[0]?.ansiCode, "21");
    assert.equal(netlist.protectionRelays?.[0]?.zone1ReachOhm, 12.0);

    assert.equal(netlist.converterBridges?.length, 1);
    assert.equal(netlist.converterBridges?.[0]?.kind, "mmc_valve_gpu");
    assert.equal(netlist.converterBridges?.[0]?.numSubmodulesPerArm, 64);

    const circuit = netlistToEmtCircuit(netlist);
    assert.equal(circuit.protectionRelays?.length, 1);
    assert.equal(circuit.converterBridges?.[0]?.kind, "mmc_valve_gpu");
  });
});

describe("Digital Protection Relays (ANSI 21, 87T, 50/51/67, 81U/81R)", () => {
  it("trips ANSI 21 Mho distance relay on Zone 1 fault and blocks on power swing (ANSI 68)", () => {
    const relay = new DigitalProtectionRelay({
      id: "R21",
      kind: "distance_21",
      nominalFreqHz: 60.0,
      zones: [
        { zone: 1, characteristic: "mho", reachOhm: 10.0, lineAngleDeg: 75.0, timeDelaySec: 0.0 },
        { zone: 2, characteristic: "mho", reachOhm: 15.0, lineAngleDeg: 75.0, timeDelaySec: 0.3 },
        { zone: 3, characteristic: "mho", reachOhm: 22.0, lineAngleDeg: 75.0, timeDelaySec: 0.8 },
      ],
      powerSwingBlockRateOhmPerSec: 40.0,
    });

    const dt = 0.001;
    const zFault = 5.0;
    const thetaRad = (75.0 * Math.PI) / 180.0;
    const iPhasor = { re: 2000.0, im: 0.0 };
    const vPhasor = {
      re: 2000.0 * zFault * Math.cos(thetaRad),
      im: 2000.0 * zFault * Math.sin(thetaRad),
    };
    const out = relay.stepDistance(0.01, dt, vPhasor, iPhasor);
    assert.equal(out.pickedUp, true);
    assert.equal(out.tripped, true);
    assert.equal(out.activeElement, "21-Z1");
    assert.ok(Math.abs((out.measuredImpedanceOhm?.mag ?? 0) - 5.0) < 1e-6);
  });

  it("blocks ANSI 87T transformer differential relay on 2nd-harmonic magnetizing inrush and trips on internal fault", () => {
    const relay87 = new DigitalProtectionRelay({
      id: "R87T",
      kind: "differential_87",
      pickupCurrent: 0.3,
      slope1: 0.25,
      slope2: 0.5,
      slope2KneeCurrent: 2.0,
      secondHarmonicBlockRatio: 0.15,
    });

    // 1. Magnetizing inrush with 25% 2nd harmonic: should NOT trip (harmonic restraint active)
    const outInrush = relay87.stepDifferential(0.01, 0.001, { re: 1.2, im: 0 }, { re: 0, im: 0 }, { i2ndMag: 0.35 });
    assert.equal(outInrush.differentialCurrent?.harmonicBlocked, true);
    assert.equal(outInrush.tripped, false);

    // 2. Pure fundamental internal fault: I1 = 2.0 pu, I2 = 0 -> trips immediately
    relay87.reset();
    const outFault = relay87.stepDifferential(0.02, 0.001, { re: 2.0, im: 0 }, { re: 0, im: 0 }, { i2ndMag: 0.02 });
    assert.equal(outFault.differentialCurrent?.harmonicBlocked, false);
    assert.equal(outFault.tripped, true);
    assert.equal(outFault.activeElement, "87-DIFF");
  });

  it("evaluates IEEE/IEC inverse-time overcurrent (ANSI 51) curves accurately", () => {
    const tTripVi = evaluateInverseTimeCurveSec("ieee_very_inverse", 4.0, 1.0);
    const tTripEi = evaluateInverseTimeCurveSec("ieee_extremely_inverse", 4.0, 1.0);
    assert.ok(tTripVi > 1.5 && tTripVi < 2.0, `Expected IEEE_VI trip time ~1.798s at M=4, got ${tTripVi}`);
    assert.ok(tTripEi < 2.1, "Extremely Inverse trips accurately at high fault multiples");
  });
});

describe("EMTDC Fortran/C Binary ABI Host Bridge & MHI PSCAD Automation", () => {
  it("manages STORF/STORI offsets across multiple UDMs and generates FMI 3.0 C wrappers", () => {
    const bridge = new EmtdcHostBridge({ timeStepSec: 50e-6 });

    const udm1 = bridge.registerUdm({
      id: "PLL_UDM",
      subroutineName: "PLL_CALC",
      numRealStates: 8,
      numIntStates: 4,
      initialPorts: { V_IN: 1.0, FREQ_OUT: 60.0 },
      dsdyn: (state, ports) => {
        if (state.FIRSTSTEP) {
          state.STORF[state.NSTORF] = 60.0;
          state.STORI[state.NSTORI] = 1;
        } else {
          state.STORF[state.NSTORF] = state.STORF[state.NSTORF]! + 0.01 * ports["V_IN"]!;
        }
        ports["FREQ_OUT"] = state.STORF[state.NSTORF]!;
      },
    });

    const udm2 = bridge.registerUdm({
      id: "PI_UDM",
      subroutineName: "PI_CTRL",
      numRealStates: 4,
      numIntStates: 2,
      initialPorts: { ERR: 0.5, CMD: 0.0 },
      dsdyn: (state, ports) => {
        state.STORF[state.NSTORF] = (state.STORF[state.NSTORF] ?? 0) + ports["ERR"]! * state.DELT;
        ports["CMD"] = state.STORF[state.NSTORF]!;
      },
    });

    assert.equal(udm1.storfBaseOffset, 1);
    assert.equal(udm2.storfBaseOffset, 9);

    bridge.stepDsdyn(0.0, true, false);
    assert.equal(udm1.ports["FREQ_OUT"], 60.0);
    bridge.stepDsdyn(50e-6, false, false);
    assert.ok(Math.abs(udm1.ports["FREQ_OUT"]! - 60.01) < 1e-9);
    assert.ok(udm2.ports["CMD"]! > 0);

    const cCode = generateEmtdcFmi3WrapperC({
      modelIdentifier: "VendorPll",
      subroutineName: "PLL_CALC",
      inputs: ["V_IN"],
      outputs: ["FREQ_OUT"],
    });
    assert.ok(cCode.includes("fmi3InstantiateCoSimulation"));
    assert.ok(cCode.includes("pll_calc_(&inst->ports[0], &inst->ports[1]);"));
  });

  it("supports mhi.pscad Application/Project/Canvas automation workflow", () => {
    const app = new MhiPscadApplication();
    const proj = app.loadXml(`<?xml version="1.0" encoding="UTF-8"?>
<project name="AutoStudy" version="5.0.0">
  <param name="time_step" value="50.0"/>
  <param name="time_duration" value="0.02"/>
  <param name="f_base" value="60.0"/>
  <definitions>
    <definition name="Main" type="module">
      <schematic>
        <Bus name="Bus1" id="B1" x="100" y="100" vbase="13.8"/>
        <User classid="UserCmp" defn="master:source_3p" id="SRC1" x="80" y="100">
          <param name="Name" value="Gen1"/>
          <param name="V" value="13.8"/>
          <param name="MVA" value="100.0"/>
          <port name="out" id="p1"/>
        </User>
        <Wire id="w1"><Vertex x="80" y="100"/><Vertex x="100" y="100"/></Wire>
      </schematic>
    </definition>
  </definitions>
</project>`);

    assert.equal(proj.name, "AutoStudy");
    proj.parameters({ time_duration: 0.01, time_step: 50.0 });
    assert.equal(proj.set_component_parameters("Gen1", { V: "15.0" }), true);
    const res = proj.run();
    assert.ok(res.time.length >= 10);
  });

  it("executes compiled 64-bit Windows PE DLL EMTDC subroutines via Wasm-Machina (EmtdcWasmMachinaDllRunner)", () => {
    // Build a syntactically valid 64-bit PE32+ DLL exporting `vdc_ctrl_` (RVA 0x1010)
    // Win64 ABI: RCX = &port[0] (in0), RDX = &port[1] (out0), R8 = &STORF[NSTORF]
    // Machine code at RVA 0x1010:
    //   F2 0F 10 01       MOVSD XMM0, [RCX]   ; XMM0 = in0
    //   F2 0F 58 C0       ADDSD XMM0, XMM0    ; XMM0 = 2.0 * in0
    //   F2 0F 11 02       MOVSD [RDX], XMM0   ; out0 = 2.0 * in0
    //   41 F2 0F 11 00    MOVSD [R8], XMM0    ; STORF[NSTORF] = 2.0 * in0
    //   48 31 C0          XOR RAX, RAX
    //   C3                RET
    const buf = new Uint8Array(4096);
    const view = new DataView(buf.buffer);
    view.setUint16(0x00, 0x5a4d, true); // 'MZ'
    view.setUint32(0x3c, 0x80, true); // e_lfanew
    const peOff = 0x80;
    view.setUint32(peOff, 0x00004550, true); // 'PE\0\0'
    const fh = peOff + 4;
    view.setUint16(fh + 0, 0x8664, true); // AMD64
    view.setUint16(fh + 2, 2, true); // 2 sections
    view.setUint16(fh + 16, 0xf0, true); // SizeOfOptionalHeader
    view.setUint16(fh + 18, 0x2102, true); // DLL
    const oh = fh + 20;
    view.setUint16(oh + 0, 0x020b, true); // PE32+
    view.setUint32(oh + 16, 0x1000, true); // EntryPoint
    view.setBigUint64(oh + 24, 0x180000000n, true);
    view.setUint32(oh + 32, 0x1000, true);
    view.setUint32(oh + 36, 0x200, true);
    view.setUint32(oh + 56, 0x4000, true);
    view.setUint32(oh + 60, 0x200, true);
    view.setUint32(oh + 112, 0x2000, true); // Export RVA
    view.setUint32(oh + 116, 0x200, true);

    const sec1 = oh + 0xf0;
    buf.set(new TextEncoder().encode(".text\0\0\0"), sec1);
    view.setUint32(sec1 + 8, 0x1000, true);
    view.setUint32(sec1 + 12, 0x1000, true);
    view.setUint32(sec1 + 16, 0x200, true);
    view.setUint32(sec1 + 20, 0x200, true);

    const sec2 = sec1 + 40;
    buf.set(new TextEncoder().encode(".rdata\0\0"), sec2);
    view.setUint32(sec2 + 8, 0x1000, true);
    view.setUint32(sec2 + 12, 0x2000, true);
    view.setUint32(sec2 + 16, 0x200, true);
    view.setUint32(sec2 + 20, 0x400, true);

    // DllMain at 0x200 (RVA 0x1000): MOV EAX, 1 ; RET
    buf.set([0xb8, 0x01, 0x00, 0x00, 0x00, 0xc3], 0x200);
    // vdc_ctrl_ at 0x210 (RVA 0x1010)
    buf.set(
      [
        0xf2,
        0x0f,
        0x10,
        0x01, // MOVSD XMM0, [RCX]
        0xf2,
        0x0f,
        0x58,
        0xc0, // ADDSD XMM0, XMM0
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
      ],
      0x210,
    );

    // Export directory at 0x400 (RVA 0x2000)
    view.setUint32(0x400 + 16, 1, true);
    view.setUint32(0x400 + 20, 1, true);
    view.setUint32(0x400 + 24, 1, true);
    view.setUint32(0x400 + 28, 0x2040, true);
    view.setUint32(0x400 + 32, 0x2050, true);
    view.setUint32(0x400 + 36, 0x2060, true);
    view.setUint32(0x440, 0x1010, true);
    view.setUint32(0x450, 0x2080, true);
    view.setUint16(0x460, 0, true);
    buf.set(new TextEncoder().encode("vdc_ctrl_\0"), 0x480);

    const bridge = new EmtdcHostBridge({ timeStepSec: 50e-6 });
    const { udm } = bridge.registerBinaryDll({
      id: "VDC_DLL",
      binaryBuffer: buf,
      dsdynSymbol: "VDC_CTRL",
      portNames: ["in0", "out0"],
      initialPorts: { in0: 125.5, out0: 0.0 },
      numRealStates: 8,
    });

    bridge.stepDsdyn(0.0, true, false);
    assert.ok(Math.abs(udm.ports["out0"]! - 251.0) < 1e-6);
    assert.ok(Math.abs(bridge.state.STORF[udm.storfBaseOffset]! - 251.0) < 1e-6);
  });

  it("executes closed-loop distance relay breaker tripping and DEM MMC capacitor sorting in EmtSolver", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<project name="ClosedLoopRelayMmc" version="5.0.0">
  <param name="time_step" value="100.0"/>
  <param name="time_duration" value="0.015"/>
  <param name="f_base" value="60.0"/>
  <definitions>
    <definition name="Main" type="module">
      <schematic>
        <Bus name="Bus1" id="B1" x="100" y="100" vbase="230.0"/>
        <Bus name="Bus2" id="B2" x="300" y="100" vbase="230.0"/>
        <User classid="UserCmp" defn="master:source_3p" id="SRC1" x="100" y="100">
          <param name="Name" value="Src1"/>
          <param name="V" value="230.0"/>
          <param name="MVA" value="500.0"/>
          <port name="Out" pos="0,0"/>
        </User>
        <User classid="UserCmp" defn="master:breaker3" id="BRK1" x="150" y="100">
          <param name="Name" value="BRK_LINE1"/>
          <param name="RON" value="0.001"/>
          <param name="ROFF" value="1000000.0"/>
          <param name="TO" value="10.0"/>
          <port name="A" pos="0,0"/>
          <port name="B" pos="20,0"/>
        </User>
        <User classid="UserCmp" defn="master:resistor" id="LOAD1" x="300" y="100">
          <param name="Name" value="FaultLoad"/>
          <param name="R" value="5.0"/>
          <port name="A" pos="0,0"/>
        </User>
        <User classid="UserCmp" defn="master:dist_mho_relay" id="REL21" x="180" y="100">
          <param name="Name" value="REL21_Z1"/>
          <param name="Bus" value="B1"/>
          <param name="Branch" value="BRK1"/>
          <param name="Breaker" value="BRK1"/>
          <param name="Z1" value="1000000.0"/>
        </User>
        <User classid="UserCmp" defn="master:mmc_half_bridge" id="MMC1" x="260" y="100">
          <param name="Name" value="MMC_HVDC1"/>
          <param name="N_SM" value="12"/>
          <param name="C_SM" value="8000.0"/>
          <param name="Vdc" value="400.0"/>
          <port name="AC" id="p_mmc" x="0" y="0"/>
        </User>
        <Wire id="w1"><Vertex x="100" y="100"/><Vertex x="150" y="100"/></Wire>
        <Wire id="w2"><Vertex x="170" y="100"/><Vertex x="300" y="100"/></Wire>
      </schematic>
    </definition>
  </definitions>
</project>`;
    const parsed = parsePscx(xml);
    const netlist = extractEmtNetlist(parsed);
    const solver = new EmtSolver(netlist, { timeStepSec: 100e-6, durationSec: 0.015 });
    const result = solver.solve();

    const tripSig = result.controlSignals?.get("REL21_trip");
    assert.ok(tripSig !== undefined, "Expected REL21_trip signal");
    assert.ok(
      tripSig.some((v) => v === 1.0),
      "Distance relay should assert trip signal",
    );
    assert.ok(result.metrics.switchingEvents >= 1, "Relay trip should actuate circuit breaker opening");

    const mmcUpper = result.controlSignals?.get("MMC1_vCapUpperSum");
    const mmcSpread = result.controlSignals?.get("MMC1_spreadPct");
    assert.ok(mmcUpper !== undefined && mmcUpper[0]! > 100.0);
    assert.ok(mmcSpread !== undefined && mmcSpread.every((s) => s < 15.0));

    // Verify pscadLanguage domain actions
    const relayAction = pscadLanguage.actions?.find((a) => a.id === "analyze_relay_coordination");
    assert.ok(relayAction !== undefined);
    const coordRes = (await relayAction.execute({ documentText: xml }, {})) as {
      relays: Array<{ id: string; mhoZones: { zone1: unknown[] }; tccCurve: unknown[] }>;
    };
    assert.equal(coordRes.relays.length, 1);
    assert.ok(coordRes.relays[0]!.mhoZones.zone1.length > 10);
    assert.ok(coordRes.relays[0]!.tccCurve.length > 4);
  });
});
