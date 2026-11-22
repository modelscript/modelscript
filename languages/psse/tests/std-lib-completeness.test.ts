// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry, initBltWasm } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  DYR_SCHEMA_LIST,
  PSSE_ARCHETYPE_CODE,
  calculateSotaDiscrepancy,
  createPsseDiagramBackend,
  createWasmDyrBatchSession,
  ensureBuiltInPsseLibraryRegistered,
  normalizeConForArchetype,
  parseDyr,
  parseRaw,
  registerBuiltInPsseLibrarySync,
  simulatePsseTransient,
  type PsseCase,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/psse-std-lib");

const TWO_BUS_RAW = `0, 100.0, 33, 0, 1, 60.0 / STD LIB PARITY TEST
STD LIB TEST
CASE 1
1, 'GEN1_BUS    ', 138.0, 3, 1, 1, 1, 1.02, 0.0
2, 'LOAD2_BUS   ', 138.0, 1, 1, 1, 1, 1.00, -2.0
0 / END OF BUS DATA
2, '1 ', 1, 1, 1, 50.0, 10.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0
0 / END OF LOAD DATA
0 / END OF FIXED SHUNT DATA
1, '1 ', 50.0, 10.0, 100.0, -50.0, 1.02, 0, 100.0, 0.0, 0.2, 0.0, 0.0, 1.0, 1, 100.0, 100.0, 0.0
0 / END OF GENERATOR DATA
1, 2, '1 ', 0.01, 0.05, 0.0, 200.0, 200.0, 200.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0
0 / END OF BRANCH DATA
0 / END OF TRANSFORMER DATA
Q
`;

describe("@modelscript/psse-std-lib — 100% Completeness, Robustness & Batched WASM Efficiency", () => {
  it("provides cleanroom SVG block icons and multi-port geometry for 100% (366/366) of standard models", async () => {
    await ensureBuiltInPsseLibraryRegistered();
    const diagPath = path.join(STD_LIB_DIR, "dist", "diagrams.json");
    const diagrams = JSON.parse(fs.readFileSync(diagPath, "utf-8")) as Array<{
      namePath: string;
      width: number;
      height: number;
      ports: Array<{ name: string; side: string; dx: number; dy: number }>;
      svg?: string;
    }>;

    assert.equal(diagrams.length, DYR_SCHEMA_LIST.length, "Expected 1:1 diagram coverage for all DYR schemas");

    for (const d of diagrams) {
      assert.ok(
        typeof d.svg === "string" && d.svg.startsWith("<svg ") && d.svg.endsWith("</svg>"),
        `Missing SVG on ${d.namePath}`,
      );
      assert.ok(d.ports.length >= 2, `Expected >= 2 ports on ${d.namePath}`);
      // Verify no two ports on the same side overlap at the same (dx, dy)
      const coords = new Set<string>();
      for (const p of d.ports) {
        const key = `${p.side}:${p.dx}:${p.dy}`;
        assert.ok(!coords.has(key), `Overlapping port ${p.name} on ${d.namePath} at ${key}`);
        coords.add(key);
      }
    }

    // Verify multi-port models expose all expected pins
    const genrou = diagrams.find((d) => d.namePath === "psse:GENROU");
    assert.ok(genrou && genrou.ports.length === 4, "Expected 4 ports on GENROU");
    const regca = diagrams.find((d) => d.namePath === "psse:REGC_A");
    assert.ok(regca && regca.ports.length === 5, "Expected 5 ports on REGC_A");

    // Verify diagram backend palette includes cleanroom SVG icons
    const backend = createPsseDiagramBackend({});
    const palette = backend.getPalette!();
    const dynCats = palette.categories.filter((c) => c.name.startsWith("Dynamic:"));
    assert.ok(dynCats.length >= 6, `Expected dynamic palette categories, got ${dynCats.length}`);
    const sampleItem = dynCats[0]!.items[0]!;
    assert.ok(sampleItem.iconSvg?.startsWith("<svg "), "Expected iconSvg on dynamic palette item");
  });

  it("assigns 52 distinct archetype codes with zero collisions (lim_vhz != comp_rc_xc)", () => {
    const entries = Object.entries(PSSE_ARCHETYPE_CODE);
    assert.equal(entries.length, 52);
    const seen = new Map<number, string>();
    for (const [arch, code] of entries) {
      assert.ok(!seen.has(code), `Archetype code collision: ${arch} and ${seen.get(code)} both use ${code}`);
      seen.set(code, arch);
    }
    assert.notEqual(PSSE_ARCHETYPE_CODE.lim_vhz, PSSE_ARCHETYPE_CODE.comp_rc_xc);

    // Verify canonical CON parameter normalization for shifted-CON variants (e.g. AC10C / exc_pid)
    const normPid = normalizeConForArchetype(PSSE_ARCHETYPE_CODE.exc_pid, [0.02, 80.0, 20.0], {
      TR: 0.02,
      KPR: 80.0,
      KIR: 20.0,
      VRMAX: 6.5,
      VRMIN: -5.5,
    });
    assert.equal(normPid[0], 0.02);
    assert.equal(normPid[3], 80.0);
    assert.equal(normPid[4], 20.0);
    assert.equal(normPid[5], 6.5);
    assert.equal(normPid[6], -5.5);
  });

  it("verifies cleanroom WASM blackbox primitives (evalQuadraticSat, evalExponentialSat, evalFex)", async () => {
    await ensureBuiltInPsseLibraryRegistered();
    const c = parseRaw(TWO_BUS_RAW);
    c.dyr = parseDyr(`1 'GENROU' '1' 6.5 0.035 1.0 0.05 4.5 1.0 1.8 1.7 0.3 0.55 0.2 0.14 0.1 0.3 /`);
    const session = createWasmDyrBatchSession(c);
    assert.ok(session, "Expected createWasmDyrBatchSession to return session");

    const evalQuad = session.exports["evalQuadraticSat"] as (
      e: number,
      e1: number,
      se1: number,
      e2: number,
      se2: number,
    ) => number;
    const evalExp = session.exports["evalExponentialSat"] as (
      e: number,
      e1: number,
      se1: number,
      e2: number,
      se2: number,
    ) => number;
    const evalFex = session.exports["evalFex"] as (inVal: number) => number;

    assert.equal(typeof evalQuad, "function");
    assert.equal(typeof evalExp, "function");
    assert.equal(typeof evalFex, "function");

    // Quadratic saturation exact interpolation at (1.0, 0.1) and (1.2, 0.3)
    assert.ok(Math.abs(evalQuad(1.0, 1.0, 0.1, 1.2, 0.3) - 0.1) < 1e-9);
    assert.ok(Math.abs(evalQuad(1.2, 1.0, 0.1, 1.2, 0.3) - 0.3) < 1e-9);

    // Exponential saturation exact interpolation at (1.0, 0.1) and (1.2, 0.3)
    assert.ok(Math.abs(evalExp(1.0, 1.0, 0.1, 1.2, 0.3) - 0.1) < 1e-9);
    assert.ok(Math.abs(evalExp(1.2, 1.0, 0.1, 1.2, 0.3) - 0.3) < 1e-6);

    // IEEE 421.5 F_EX 3-mode piecewise rectifier regulation curve
    assert.ok(Math.abs(evalFex(0.0) - 1.0) < 1e-9);
    assert.ok(Math.abs(evalFex(0.2) - (1.0 - 0.577 * 0.2)) < 1e-9);
    assert.ok(Math.abs(evalFex(0.6) - Math.sqrt(0.75 - 0.36)) < 1e-9);
    assert.ok(Math.abs(evalFex(0.9) - 1.732 * 0.1) < 1e-9);
    assert.equal(evalFex(1.2), 0.0);
  });

  it("initializes 100% (366/366) of standard models in batched WASM with flat-start equilibrium and fault survival", async () => {
    await ensureBuiltInPsseLibraryRegistered();
    const psseCase: PsseCase = parseRaw(TWO_BUS_RAW);
    psseCase.dyr = {
      records: DYR_SCHEMA_LIST.map((s) => ({
        ibus: 1,
        model: s.model,
        id: "1",
        category: s.category,
        icons: (s.icons ?? []).map((ic) => ic.defaultValue ?? 0),
        con: s.params.map((p) => p.defaultValue ?? 0.5),
        namedParams: {},
      })),
      diagnostics: [],
    };

    const session = createWasmDyrBatchSession(psseCase);
    assert.ok(session, "Expected batched WASM session");
    assert.equal(session.count, DYR_SCHEMA_LIST.length, "Expected all 366 models in WASM batch session");

    const steadyIo = { eterm: 1.02, speedDev: 0.0, efd: 1.35, pmech: 0.5, vr: 1.02, vi: 0.0 };
    for (let i = 0; i < session.count; i++) {
      session.writeSlotIo(i, steadyIo);
    }
    session.initAll();

    // Verify flat-start equilibrium for all 366 models
    for (let i = 0; i < session.count; i++) {
      const residual = session.checkFlatStart(i);
      assert.ok(
        Number.isFinite(residual) && residual < 1e-6,
        `Flat-start residual too high on ${session.slots[i]!.modelName}: ${residual}`,
      );
    }

    // Step through 0.1s steady, 0.15s voltage-dip fault (V=0.45 pu), 0.25s post-fault recovery
    const dt = 0.01;
    for (let step = 0; step < 50; step++) {
      const t = step * dt;
      const isFault = t >= 0.1 && t < 0.25;
      const io = isFault
        ? { eterm: 0.45, speedDev: 0.005, efd: 1.35, pmech: 0.5, vr: 0.44, vi: -0.09 }
        : { eterm: 1.0, speedDev: -0.001, efd: 1.35, pmech: 0.5, vr: 1.0, vi: 0.0 };
      for (let i = 0; i < session.count; i++) {
        session.writeSlotIo(i, io);
      }
      session.stepAll(t, dt);
    }

    // Verify all 366 models produce finite, non-NaN outputs after fault + recovery
    for (let i = 0; i < session.count; i++) {
      const out = session.readSlotOutput(i);
      for (const [k, v] of Object.entries(out)) {
        assert.ok(Number.isFinite(v), `Non-finite output ${k}=${v} on ${session.slots[i]!.modelName}`);
      }
    }
  });

  it("isolates concurrent WASM simulations and scales cleanly to 5,000+ batched dynamic models", async () => {
    await ensureBuiltInPsseLibraryRegistered();
    const baseCase = parseRaw(TWO_BUS_RAW);
    const makeRecords = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        ibus: 1,
        model: i % 3 === 0 ? "ESAC1A" : i % 3 === 1 ? "TGOV1" : "GENROU",
        id: "1",
        category: i % 3 === 0 ? ("exciter" as const) : i % 3 === 1 ? ("governor" as const) : ("generator" as const),
        icons: [],
        con: [0.02, 0.0, 0.0, 200.0, 0.04, 5.0, -4.0, 1.0, 0.8, 0.03, 1.0, 0.2, 0.38, 3.1, 0.03, 4.18, 0.1],
        namedParams: {},
      }));

    // 2,500 models in session A + 2,500 models in session B = 5,000 concurrent models (exceeds old 510-model 1MiB cap!)
    const sA = createWasmDyrBatchSession({ ...baseCase, dyr: { records: makeRecords(2500), diagnostics: [] } });
    const sB = createWasmDyrBatchSession({ ...baseCase, dyr: { records: makeRecords(2500), diagnostics: [] } });
    assert.ok(sA && sB);
    assert.equal(sA.count, 2500);
    assert.equal(sB.count, 2500);

    const ioA = { eterm: 1.02, speedDev: 0.0, efd: 1.4, pmech: 0.6, vr: 1.02, vi: 0.0 };
    const ioB = { eterm: 0.95, speedDev: 0.0, efd: 1.1, pmech: 0.4, vr: 0.95, vi: 0.0 };
    for (let i = 0; i < 2500; i++) {
      sA.writeSlotIo(i, ioA);
      sB.writeSlotIo(i, ioB);
    }
    sA.initAll();
    sB.initAll();

    // Perturb only session A; session B must remain completely unaffected (concurrency isolation)
    const t0 = performance.now();
    for (let step = 0; step < 20; step++) {
      for (let i = 0; i < 2500; i++) {
        sA.writeSlotIo(i, { ...ioA, eterm: 0.7 });
        sB.writeSlotIo(i, ioB);
      }
      sA.stepAll(step * 0.01, 0.01);
      sB.stepAll(step * 0.01, 0.01);
    }
    const elapsedMs = performance.now() - t0;

    const outA = sA.readSlotOutput(0);
    const outB = sB.readSlotOutput(0);
    assert.ok(outA.efd > 1.5, `Expected session A exciter to boost Efd during voltage dip, got ${outA.efd}`);
    assert.ok(Math.abs(outB.efd - 1.1) < 1e-4, `Expected isolated session B Efd to stay at 1.1, got ${outB.efd}`);
    assert.ok(
      elapsedMs < 2000,
      `Expected 5,000-model x 20-step batched WASM run < 2000ms, took ${elapsedMs.toFixed(1)}ms`,
    );
  });

  it("maintains trajectory parity between batched WASM standard library and dae_ida Sundials solver", async () => {
    await initBltWasm();
    await ensureBuiltInPsseLibraryRegistered();
    assert.ok(globalLibraryRegistry.getPackagesForLanguage("psse").length > 0);
    const c = parseRaw(TWO_BUS_RAW);
    c.dyr = parseDyr(`
1 'GENROU' '1' 6.5 0.035 1.0 0.05 4.5 0.0 1.8 1.7 0.3 0.55 0.2 0.14 0.05 0.15 /
1 'ESAC1A' '1' 0.02 0.0 0.0 200.0 0.04 5.0 -4.0 1.0 0.8 0.03 1.0 0.2 0.38 3.1 0.03 4.18 0.1 /
1 'TGOV1' '1' 0.05 0.5 1.05 0.0 2.1 7.0 0.0 /
`);

    const wasmSim = simulatePsseTransient(c, {
      stopTime: 0.6,
      timeStep: 0.01,
      events: [{ timeSec: 0.15, type: "shed_load", busNumber: 2, loadScale: 0.85 }],
      useWasmStdLib: true,
    });
    const daeSim = simulatePsseTransient(c, {
      solverMode: "dae_ida",
      stopTime: 0.6,
      timeStep: 0.01,
      events: [{ timeSec: 0.15, type: "shed_load", busNumber: 2, loadScale: 0.85 }],
    });

    const vKeyWasm = wasmSim.states.find((k) => k === "Vm_Bus2_pu" || k.startsWith("Vm_Bus2")) ?? wasmSim.states[0]!;
    const vKeyDae = daeSim.states.find((k) => k.includes("Bus_2_Vm")) ?? daeSim.states[0]!;
    const len = Math.min(wasmSim.variables[vKeyWasm]!.length, daeSim.variables[vKeyDae]!.length);
    const metrics = calculateSotaDiscrepancy(
      wasmSim.variables[vKeyWasm]!.slice(0, len),
      daeSim.variables[vKeyDae]!.slice(0, len),
    );
    assert.ok(metrics.theilTic < 0.2, `Expected WASM vs dae_ida Theil TIC < 0.2, got ${metrics.theilTic}`);
  });

  it("supports zero-I/O synchronous browser bundle registration and Park d/q generator Norton injections in WASM", () => {
    globalLibraryRegistry.clear();
    registerBuiltInPsseLibrarySync();
    const pkgs = globalLibraryRegistry.getPackagesForLanguage("psse");
    assert.equal(pkgs.length, 1);
    assert.equal(pkgs[0]!.symbols.length, DYR_SCHEMA_LIST.length);
    assert.equal(pkgs[0]!.diagrams.length, DYR_SCHEMA_LIST.length);
    assert.ok(pkgs[0]!.diagrams.every((d) => d.svg?.startsWith("<svg ")));
    assert.ok(pkgs[0]!.wasmBytes && pkgs[0]!.wasmBytes.byteLength > 10000);

    // Verify Park d/q Norton current injections (irInj, iiInj) from GENROU in batched WASM
    const c = parseRaw(TWO_BUS_RAW);
    c.dyr = parseDyr(`1 'GENROU' '1' 6.5 0.035 1.0 0.05 4.5 1.0 1.8 1.7 0.3 0.55 0.2 0.14 0.05 0.15 /`);
    const session = createWasmDyrBatchSession(c);
    assert.ok(session);
    session.writeSlotIo(0, { eterm: 1.02, speedDev: 0.0, efd: 1.35, pmech: 0.5, vr: 1.02, vi: 0.0 });
    session.initAll();
    const out0 = session.readSlotOutput(0);
    assert.ok(Number.isFinite(out0.irInj) && Math.abs(out0.irInj) > 0.1, `Expected non-zero irInj, got ${out0.irInj}`);
    assert.ok(Number.isFinite(out0.iiInj) && out0.iiInj < -1.0, `Expected inductive iiInj < -1, got ${out0.iiInj}`);
  });
});
