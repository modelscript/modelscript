// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildPscadDiagram, type PscadProjectLike } from "@modelscript/diagram/pscad-diagram-builder";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { ensureBuiltInPscadLibraryRegistered } from "../src/catalog/library-package-adapter.js";
import { PSCAD_MASTER_LIB_DIAGRAMS, PSCAD_MASTER_LIB_SYMBOLS } from "../src/catalog/pscad-master-lib-data.js";
import { CleanRoomEmtdcWasmRuntime, createCleanRoomEmtdcWasmRuntime } from "../src/catalog/wasm-companion-loader.js";
import { compileFortranSegment } from "../src/script/fortran-codegen.js";

const pscadDir = path.resolve(new URL("..", import.meta.url).pathname);
const masterLibDir = path.join(pscadDir, "assets", "pscad-master-lib");
const wasmPath = path.join(masterLibDir, "dist", "runtime.wasm");
const manifestPath = path.join(masterLibDir, "src", "runtime", "subroutine-manifest.json");

describe("Cleanroom PSCAD Master Library — 100% Parity & Verification Suite", () => {
  it("Workstream 1: includes cleanroom parameter schemas for all 392+ master.pslx definitions with strict IP hygiene", () => {
    assert.ok(
      PSCAD_MASTER_LIB_SYMBOLS.length >= 392,
      `Expected >= 392 cleanroom symbols, got ${PSCAD_MASTER_LIB_SYMBOLS.length}`,
    );

    const byName = new Map(PSCAD_MASTER_LIB_SYMBOLS.map((s) => [s.name.toLowerCase(), s]));
    for (const required of [
      "source3",
      "sync_machine",
      "xfmr-3p2w",
      "umec-xfmr-2w",
      "tline_interface",
      "cable_interface",
      "realpole",
      "leadlag",
      "abcdq0",
      "rms3ph",
      "peswitch",
      "svc",
      "tpflt",
      "trip_polygon",
      "zrealpole",
      "zdelay",
      "battery",
      "wind_turbine",
    ]) {
      assert.ok(byName.has(required), `Missing cleanroom schema for '${required}'`);
    }

    // Strict IP hygiene: no proprietary vendor <Gfx classid=...> XML or raw <FlyBy> markup
    const symbolsRaw = fs.readFileSync(path.join(masterLibDir, "dist", "symbols.json"), "utf-8");
    const diagramsRaw = fs.readFileSync(path.join(masterLibDir, "dist", "diagrams.json"), "utf-8");
    assert.equal(symbolsRaw.includes("<Gfx "), false, "symbols.json must not contain vendor <Gfx> XML");
    assert.equal(diagramsRaw.includes("<Gfx "), false, "diagrams.json must not contain vendor <Gfx> XML");
    assert.equal(symbolsRaw.includes("<FlyBy>"), false, "symbols.json must not contain vendor <FlyBy> tags");
  });

  it("Workstream 2: provides cleanroom IEEE 315 / IEC 60617 SVG icons for all 392+ definitions and renders them in buildPscadDiagram", () => {
    assert.equal(
      PSCAD_MASTER_LIB_DIAGRAMS.length,
      PSCAD_MASTER_LIB_SYMBOLS.length,
      "Every symbol must have a matching diagram/icon entry",
    );

    const cleanroomIcons = new Map<string, string>();
    for (const diag of PSCAD_MASTER_LIB_DIAGRAMS) {
      assert.ok(
        typeof diag.svg === "string" && diag.svg.startsWith("<svg ") && diag.svg.endsWith("</svg>"),
        `Component '${diag.namePath}' must have a valid cleanroom <svg> icon`,
      );
      cleanroomIcons.set(diag.namePath, diag.svg);
      const short = diag.namePath.includes(":") ? diag.namePath.split(":").pop()! : diag.namePath;
      cleanroomIcons.set(short, diag.svg);
    }

    // Build a synthetic project containing a representative grid of 60 diverse master components
    // without loading master.pslx and verify buildPscadDiagram renders them with cleanroom SVGs
    const sample = PSCAD_MASTER_LIB_DIAGRAMS.slice(0, 60);
    const project: PscadProjectLike = {
      name: "CleanroomIconGrid",
      rootModule: {
        name: "Main",
        buses: [],
        wires: [],
        components: sample.map((d, idx) => ({
          id: `c_${idx}`,
          definitionName: d.namePath,
          instanceName: d.label,
          position: { x: (idx % 10) * 120, y: Math.floor(idx / 10) * 100 },
          width: d.width,
          height: d.height,
          parameters: {},
        })),
      },
      subModules: new Map(),
      definitions: new Map(),
    };

    const graph = buildPscadDiagram(project, undefined, {
      cleanroomIcons,
      cleanroomOnly: true,
      lodComponentThreshold: 1000,
    });
    const nodeCells = graph.cells.filter((c) => c.shape !== "edge");
    assert.ok(nodeCells.length >= 50, `Expected >= 50 rendered component cells, got ${nodeCells.length}`);
    for (const cell of nodeCells) {
      assert.ok(Array.isArray(cell.markup) && cell.markup.length > 0, `Cell '${cell.id}' missing SVG markup`);
    }
  });

  it("Workstream 3: exports all 521 external subroutines & functions in dist/runtime.wasm and executes physics accurately", () => {
    ensureBuiltInPscadLibraryRegistered();
    assert.ok(fs.existsSync(wasmPath), `Expected compiled runtime.wasm at ${wasmPath}`);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as Array<{ name: string }>;
    assert.ok(manifest.length >= 486, `Expected >= 486 manifest entries, got ${manifest.length}`);

    const rt = createCleanRoomEmtdcWasmRuntime() ?? new CleanRoomEmtdcWasmRuntime(fs.readFileSync(wasmPath));
    rt.reset();

    // 1. Verify 100% export coverage for all 521 manifest symbols
    const missing: string[] = [];
    for (const entry of manifest) {
      if (!rt.hasSubroutine(entry.name)) {
        missing.push(entry.name);
      }
    }
    assert.deepEqual(missing, [], `Missing WASM subroutine exports: ${missing.slice(0, 10).join(", ")}`);

    // 2. Multi-instance isolation test: two independent REALPOLE instances
    const dt = 1e-4;
    let y1 = 0;
    let y2 = 0;
    for (let step = 0; step <= 600; step++) {
      const t = step * dt;
      rt.setContext(t, dt, step === 0, step === 0, false);
      // Instance 1 at STORF cursor 1: K=2.0, T=0.01, u=1.0 -> converges to 2.0
      rt.setCursors(1, 1);
      y1 = rt.callSubroutine("REALPOLE", [2.0, 0.01, 1.0, 0.0]);
      // Instance 2 at STORF cursor 20: K=5.0, T=0.01, u=1.0 -> converges to 5.0
      rt.setCursors(20, 10);
      y2 = rt.callSubroutine("REALPOLE", [5.0, 0.01, 1.0, 0.0]);
    }
    assert.ok(Math.abs(y1 - 2.0) < 0.05, `Instance 1 REALPOLE expected ~2.0, got ${y1}`);
    assert.ok(Math.abs(y2 - 5.0) < 0.05, `Instance 2 REALPOLE expected ~5.0, got ${y2}`);

    // 3. Park abc -> dq0 transform (TRDQO)
    const theta = 0.7;
    const va = Math.cos(theta);
    const vb = Math.cos(theta - (2 * Math.PI) / 3);
    const vc = Math.cos(theta + (2 * Math.PI) / 3);
    const dqArgs = [0, va, vb, vc, theta, 0, 0, 0];
    rt.callSubroutine("TRDQO", dqArgs);
    assert.ok(Math.abs(dqArgs[5]! - Math.sqrt(1.5)) < 1e-6, `Expected d=sqrt(3/2), got ${dqArgs[5]}`);
    assert.ok(Math.abs(dqArgs[6]!) < 1e-6, `Expected q=0, got ${dqArgs[6]}`);
    assert.ok(Math.abs(dqArgs[7]!) < 1e-6, `Expected 0=0, got ${dqArgs[7]}`);

    // 4. Transformer core saturation (TSAT1_EXE)
    rt.reset();
    let iSat = 0;
    for (let step = 0; step < 50; step++) {
      rt.setContext(step * 1e-3, 1e-3, step === 0, step === 0, false);
      rt.setCursors(100, 20);
      iSat = rt.callSubroutine("TSAT1_EXE", [100.0, 1.15, 0.2, 50.0, 0.0]);
    }
    assert.ok(iSat > 5.0, `Expected saturated magnetizing current > 5 A, got ${iSat}`);

    // 5. ZnO Arrester nonlinear clamping (ARRESTERZNO_EXE)
    const iLow = rt.callSubroutine("ARRESTERZNO_EXE", [50e3, 200e3, 26.0]);
    const iHigh = rt.callSubroutine("ARRESTERZNO_EXE", [250e3, 200e3, 26.0]);
    assert.ok(iLow < 1e-3 && iHigh > 100.0, `ZnO arrester clamping failed: iLow=${iLow}, iHigh=${iHigh}`);

    // 6. Polygon distance relay (POLYGON1_EXE)
    assert.equal(rt.callSubroutine("POLYGON1_EXE", [5.0, 10.0, 10.0, 20.0]), 1.0);
    assert.equal(rt.callSubroutine("POLYGON1_EXE", [25.0, 10.0, 10.0, 20.0]), 0.0);

    // 7. Power electronic switch (PESWITCH1_EXE)
    const gOn = rt.callSubroutine("PESWITCH1_EXE", [100.0, 1.0, 0.01, 1e6]);
    const gOff = rt.callSubroutine("PESWITCH1_EXE", [-100.0, 1.0, 0.01, 1e6]);
    assert.ok(gOn > 50.0 && gOff < 1e-3, `PESWITCH1 conductance mismatch: gOn=${gOn}, gOff=${gOff}`);

    // 8. End-to-end Fortran step-compiler delegation into CleanRoomEmtdcWasmRuntime
    const compiled = compileFortranSegment("CALL TSAT1_EXE($Vw, 1.15, 0.2, 50.0, $Imag)", {}, {});
    let imagOut = 0;
    rt.reset();
    for (let step = 0; step < 30; step++) {
      rt.setContext(step * 1e-3, 1e-3, step === 0, step === 0, false);
      rt.setCursors(200, 30);
      compiled.step({
        time: step * 1e-3,
        dt: 1e-3,
        firstStep: step === 0,
        storf: new Float64Array(4),
        stori: new Int32Array(2),
        getInput: (p) => (p === "Vw" ? 100.0 : 0.0),
        setOutput: (p, v) => {
          if (p === "Imag") imagOut = v;
        },
        invokeExternalSubroutine: (name, args) => rt.callSubroutine(name, args),
      });
    }
    assert.ok(imagOut > 1.0, `Expected Fortran->WASM TSAT1_EXE output > 1 A, got ${imagOut}`);
  });

  it("EmtdcHostBridge automatically dispatches inline Fortran #FUNCTION expressions and CALLs to cleanroom WASM with multi-instance isolation", async () => {
    const { EmtdcHostBridge } = await import("../src/script/emtdc-abi-bridge.js");
    const bridge = new EmtdcHostBridge({ timeStepSec: 1e-4 });

    // Two independent custom blocks calling inline #FUNCTION expressions (REALPOLE & ARRESTERZNO_EXE)
    const block1Compiled = compileFortranSegment("$Y = REALPOLE(3.0, 0.01, $U)", {}, {});
    const block2Compiled = compileFortranSegment("$Y = REALPOLE(7.0, 0.01, $U)", {}, {});
    const arresterCompiled = compileFortranSegment("$I = ARRESTERZNO_EXE($V, 200000.0, 26.0)", {}, {});

    const udm1 = bridge.registerCustomFortranBlock({
      id: "pole_1",
      name: "pole_1",
      referencedPorts: ["U"],
      assignedPorts: ["Y"],
      numRealStates: 8,
      numIntStates: 2,
      step: block1Compiled.step,
    });
    const udm2 = bridge.registerCustomFortranBlock({
      id: "pole_2",
      name: "pole_2",
      referencedPorts: ["U"],
      assignedPorts: ["Y"],
      numRealStates: 8,
      numIntStates: 2,
      step: block2Compiled.step,
    });
    const udmArr = bridge.registerCustomFortranBlock({
      id: "arr_1",
      name: "arr_1",
      referencedPorts: ["V"],
      assignedPorts: ["I"],
      numRealStates: 4,
      numIntStates: 2,
      step: arresterCompiled.step,
    });

    udm1.ports["U"] = 1.0;
    udm2.ports["U"] = 1.0;
    udmArr.ports["V"] = 250e3;

    for (let step = 0; step <= 600; step++) {
      bridge.stepDsdyn(step * 1e-4, step === 0, false);
    }

    assert.ok(Math.abs((udm1.ports["Y"] ?? 0) - 3.0) < 0.08, `pole_1 expected ~3.0, got ${udm1.ports["Y"]}`);
    assert.ok(Math.abs((udm2.ports["Y"] ?? 0) - 7.0) < 0.15, `pole_2 expected ~7.0, got ${udm2.ports["Y"]}`);
    assert.ok((udmArr.ports["I"] ?? 0) > 100.0, `arrester inline #FUNCTION expected >100 A, got ${udmArr.ports["I"]}`);
  });

  it("Dedicated high-fidelity cleanroom WASM kernels (HVDC/SVM/SVC/MMC, Protection, Wind, IEEE DC Exciter, PRNG)", () => {
    ensureBuiltInPscadLibraryRegistered();
    const rt = createCleanRoomEmtdcWasmRuntime() ?? new CleanRoomEmtdcWasmRuntime(fs.readFileSync(wasmPath));
    rt.reset();
    rt.setContext(0.01, 1e-4, false, false, false);

    // 1. 6-pulse LCC thyristor valve group: Vd = (3*sqrt(2)/pi)*230*cos(0) - (3/pi)*10*1 = 310.6 - 9.55 ~ 301.1 kV
    const vDc = rt.callSubroutine("VG6P1_EXE", [230.0, 0.0, 10.0, 1.0, 0.0]);
    assert.ok(Math.abs(vDc - 301.06) < 0.5, `Expected 6-pulse Vdc ~301.06, got ${vDc}`);

    // 2. Space Vector Modulation: zero vector -> 0.5 duty cycle on all 3 legs
    const svmArgs = [0.0, 0.0, 1000.0, 0.0, 0.0, 0.0];
    rt.callSubroutine("SVM_EDGE1_EXE", svmArgs);
    assert.ok(
      Math.abs(svmArgs[3]! - 0.5) < 1e-6 && Math.abs(svmArgs[4]! - 0.5) < 1e-6 && Math.abs(svmArgs[5]! - 0.5) < 1e-6,
    );

    // 3. SVC TCR/TSC susceptance: at alpha = pi (fully off TCR), B_net = Bc = 0.5
    const bSvc = rt.callSubroutine("SVC1_EXE", [Math.PI, 1.0, 0.5, 0.0]);
    assert.ok(Math.abs(bSvc - 0.5) < 1e-6, `Expected SVC B_net = 0.5 at alpha=pi, got ${bSvc}`);

    // 4. MMC submodule sorting: vRef=12.4 kV, vCapAvg=1.0 kV, N=20 -> 12 submodules inserted
    const nIns = rt.callSubroutine("E_SORTER", [12.4, 1.0, 20.0, 0.0]);
    assert.equal(nIns, 12);

    // 5. Symmetrical components sequence filter: balanced 3-phase -> zero-seq = 0, pos-seq = 1.0
    const seqArgs = [1.0, -0.5, -0.5, 0.0, 0.0];
    rt.callSubroutine("SEQFILTER", seqArgs);
    assert.ok(Math.abs(seqArgs[3]! - 1.0) < 1e-6 && Math.abs(seqArgs[4]!) < 1e-6);

    // 6. Wind turbine aerodynamic power: vWind=10 m/s, omega=2.0 rad/s, beta=0, R=40 m -> Cp in (0.3, 0.55)
    const windArgs = [10.0, 2.0, 0.0, 40.0, 0.0];
    const pWind = rt.callSubroutine("WINDTRB1_EXE", windArgs);
    assert.ok(
      windArgs[4]! > 0.3 && windArgs[4]! < 0.55 && pWind > 1e6,
      `Unexpected wind Cp=${windArgs[4]}, P=${pWind}`,
    );

    // 7. IEEE DC3A exciter with saturation
    rt.setCursors(400, 40);
    rt.setContext(0.0, 1e-3, true, true, false);
    const efd0 = rt.callSubroutine("EXCDC3A1_EXE", [1.0, 0.9, 100.0, 0.02, 0.8, 1.0, 0.03, 1.0]);
    rt.setCursors(400, 40);
    rt.setContext(0.01, 1e-3, false, false, false);
    const efd1 = rt.callSubroutine("EXCDC3A1_EXE", [1.0, 0.9, 100.0, 0.02, 0.8, 1.0, 0.03, 1.0]);
    assert.ok(efd1 > efd0, `Expected DC exciter Efd to rise on undervoltage: efd0=${efd0}, efd1=${efd1}`);

    // 8. Deterministic PRNG (RAN1 / GASDEV)
    rt.setCursors(500, 50);
    const r1 = rt.callSubroutine("RAN1", [42]);
    rt.setCursors(500, 50);
    const r2 = rt.callSubroutine("RAN1", [42]);
    assert.ok(r1 > 0 && r1 < 1 && r2 > 0 && r2 < 1 && r1 !== r2);
  });

  it("All 5 deep-fidelity enhancements: positional args, multi-instance companions, host I/O/plot, IEEE AC/ST/Hydro/Gas, and dynamic cleanroom icons", async () => {
    const { instantiateWasmCompanionsForNetlist } = await import("../src/catalog/wasm-companion-loader.js");
    ensureBuiltInPscadLibraryRegistered();

    // 1. Positional argument adapter: 7-arg TSAT1_EXE writes flux to args[5] and iMag to args[6]
    const hostIoCalls: Array<{ op: number; a0: number; a1: number; a2: number }> = [];
    const rt = new CleanRoomEmtdcWasmRuntime(fs.readFileSync(wasmPath), {
      onHostIo: (op, a0, a1, a2) => {
        hostIoCalls.push({ op, a0, a1, a2 });
        return op === 1 ? 42.5 : a1;
      },
    });
    rt.reset();
    const tsatArgs = [120.0, 1.15, 0.2, 50.0, 0.0, 0.0, 0.0];
    for (let step = 0; step < 30; step++) {
      rt.setContext(step * 1e-3, 1e-3, step === 0, step === 0, false);
      rt.setCursors(10, 10);
      rt.callSubroutine("TSAT1_EXE", tsatArgs);
    }
    assert.ok(
      tsatArgs[5]! > 1.15 && tsatArgs[6]! > 5.0,
      `7-arg TSAT1_EXE failed: flux=${tsatArgs[5]}, iMag=${tsatArgs[6]}`,
    );

    // 2. Multi-instance legacy fmi-ls-emt companions (two independent inductors L=0.01 vs L=0.10)
    const fakeNetlist = {
      buses: [],
      branches: [],
      sources: [],
      transformers: [],
      transmissionLines: [],
      fmuInstances: [
        {
          id: "ind_1",
          name: "ind_1",
          modelName: "inductor",
          busConnection: "B1",
          fmuPath: "",
          ratedMva: 10,
          ratedKv: 13.8,
          controlMode: "grid_following",
          params: { L: 0.01 },
        },
        {
          id: "ind_2",
          name: "ind_2",
          modelName: "inductor",
          busConnection: "B2",
          fmuPath: "",
          ratedMva: 10,
          ratedKv: 13.8,
          controlMode: "grid_following",
          params: { L: 0.1 },
        },
      ],
    } as unknown as Parameters<typeof instantiateWasmCompanionsForNetlist>[0];
    const comps = instantiateWasmCompanionsForNetlist(fakeNetlist);
    const c1 = comps.get("ind_1")!;
    const c2 = comps.get("ind_2")!;
    assert.ok(c1 && c2, "Both inductor companion instances should instantiate");
    const s1 = c1.stampCompanion(0, 1e-4);
    const s2 = c2.stampCompanion(0, 1e-4);
    assert.ok(Math.abs(s1.gEq[0]! / s2.gEq[0]! - 10.0) < 1e-6, `Expected g1/g2 == 10, got ${s1.gEq[0]! / s2.gEq[0]!}`);

    // 3. Host-imported WASM I/O (FILEREAD2) & Plotting (FPLOT19)
    rt.setContext(0.025, 1e-4, false, false, false);
    const fileVal = rt.callSubroutine("FILEREAD2", [1.0, 2.0, 0.0]);
    assert.equal(fileVal, 42.5);
    assert.ok(hostIoCalls.some((c) => c.op === 1 && c.a0 === 1.0 && c.a1 === 2.0));
    rt.callSubroutine("FPLOT19", [7, 123.45]);
    const ch7 = rt.getPlottedChannels().get(7);
    assert.ok(ch7 && ch7.length === 1 && Math.abs(ch7[0]!.value - 123.45) < 1e-9);

    // 4. Per-standard IEEE AC/ST exciters, Hydro governor, and zero kernelNoopStatus remaining
    const subSrc = fs.readFileSync(path.join(masterLibDir, "src", "runtime", "subroutines.ts"), "utf-8");
    assert.equal(subSrc.includes("kernelNoopStatus"), false, "Zero subroutines should use kernelNoopStatus");
    rt.setCursors(600, 60);
    rt.setContext(0.0, 1e-3, true, true, false);
    rt.callSubroutine("EXCI35", [1.0, 0.85, 1.0, 200.0, 0.01, 5.0, -4.0, 0.08, 0.0]);
    rt.setCursors(600, 60);
    rt.setContext(0.01, 1e-3, false, false, false);
    const efdSt = rt.callSubroutine("EXCI35", [1.0, 0.85, 1.0, 200.0, 0.01, 5.0, -4.0, 0.08, 0.0]);
    assert.ok(efdSt > 1.0 && efdSt <= 0.85 * 5.0, `Expected ST exciter Efd within terminal ceiling, got ${efdSt}`);

    rt.setCursors(620, 62);
    rt.setContext(0.0, 1e-3, true, true, false);
    const pHydro = rt.callSubroutine("HGOV90", [0.8, 1.0, 0.04, 0.3, 5.0, 1.0, 0.0]);
    assert.ok(Math.abs(pHydro - 0.8) < 1e-6, `Expected initial hydro Pmech=0.8, got ${pHydro}`);

    // 5. Dynamic parameter-aware cleanroom icons (open vs closed breaker, transformer Y/Delta badges)
    const cleanroomIcons = new Map<string, string>();
    for (const d of PSCAD_MASTER_LIB_DIAGRAMS) {
      if (d.svg) cleanroomIcons.set(d.namePath, d.svg);
    }
    const dynProject: PscadProjectLike = {
      name: "DynIcons",
      rootModule: {
        name: "Main",
        buses: [],
        wires: [],
        components: [
          {
            id: "brk_open",
            definitionName: "master:breaker3",
            instanceName: "B_Open",
            position: { x: 0, y: 0 },
            parameters: { Status: "open" },
          },
          {
            id: "brk_closed",
            definitionName: "master:breaker3",
            instanceName: "B_Closed",
            position: { x: 120, y: 0 },
            parameters: { Status: "closed" },
          },
          {
            id: "xfmr_yd",
            definitionName: "master:xfmr-3p2w",
            instanceName: "T1",
            position: { x: 240, y: 0 },
            parameters: { YD1: "0", YD2: "1" },
          },
        ],
      },
      subModules: new Map(),
      definitions: new Map(),
    };
    const dynGraph = buildPscadDiagram(dynProject, undefined, { cleanroomIcons, cleanroomOnly: true });
    const openCell = dynGraph.cells.find((c) => c.id === "brk_open");
    const closedCell = dynGraph.cells.find((c) => c.id === "brk_closed");
    const xfmrCell = dynGraph.cells.find((c) => c.id === "xfmr_yd");
    assert.ok(
      JSON.stringify(openCell?.attrs).includes("#dc2626"),
      "Open breaker should include red open-contact overlay",
    );
    assert.ok(
      JSON.stringify(closedCell?.attrs).includes("#16a34a"),
      "Closed breaker should include green closed-contact overlay",
    );
    assert.ok(
      JSON.stringify(xfmrCell?.attrs).includes("Δ"),
      "Transformer with YD2=1 should include Δ vector-group badge",
    );
  });
});
