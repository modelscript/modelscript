// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  generateFmiLsEmtAnnotationXml,
  parseFmiLsEmtAnnotations,
  type FmiLsEmtCompanionInstance,
} from "@modelscript/exchange";
import { globalLibraryRegistry, LibraryPackageRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import { analyzeControlIntervals } from "../src/analysis/control-intervals.js";
import { compileAssemblyScriptInWorker } from "../src/catalog/wasm-companion-loader.js";
import {
  buildFmuFromLibraryPackage,
  buildProjectModel,
  compileAssemblyScriptCompanion,
  compileCleanRoomCompanionsForNetlist,
  CsmfControlEvaluator,
  EmtSolver,
  ensureBuiltInPscadLibraryRegistered,
  exportSchemasToLibraryPackageDir,
  extractEmtNetlist,
  extractPscadLibraryPackage,
  fmuToPscadComponent,
  generateCleanRoomCompanionFromFortran,
  getPscadDiagramSpecFromLibraries,
  instantiateWasmCompanionsForNetlist,
  mergeCleanRoomWithCatalog,
  mineCleanRoomLibraryFromPscx,
  parsePscx,
  registerFmuComponentsAsPscadLibrary,
  registerMinedCleanRoomLibrary,
  writeExtractedPscadPackage,
} from "../src/index.js";
import { runPscadSimulationPipeline } from "../src/language.js";

describe("package.json#modelscript Pre-Indexed Libraries, FMU & Clean-Room Mining", () => {
  afterEach(() => {
    globalLibraryRegistry.clear();
  });

  it("exports MASTER_LIBRARY_SCHEMAS to a package.json library directory and loads it via LibraryPackageRegistry", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msx-pscad-lib-"));
    try {
      await exportSchemasToLibraryPackageDir(tmpDir, { name: "@modelscript/test-pscad-lib" });

      const pkgJson = JSON.parse(fs.readFileSync(path.join(tmpDir, "package.json"), "utf-8"));
      assert.equal(pkgJson.name, "@modelscript/test-pscad-lib");
      assert.equal(pkgJson.modelscript.category, "library");
      assert.equal(pkgJson.modelscript.language, "pscad");

      const registry = new LibraryPackageRegistry();
      const loaded = await registry.loadLibraryFromDir(tmpDir);
      assert.ok(loaded);
      assert.ok(loaded.symbols.length > 10);
      assert.ok(loaded.diagrams.length > 10);

      const idx = registry.materializeSymbolIndex("pscad");
      assert.ok((idx.byName.get("source3")?.length ?? 0) > 0);
      const source3Diag = registry.getDiagramSpec("pscad", "master:source3");
      assert.ok(source3Diag);
      assert.equal(source3Diag.ports[0]?.name, "Term");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("registers built-in PSCAD master library into globalLibraryRegistry", () => {
    const pkg = ensureBuiltInPscadLibraryRegistered();
    assert.ok(pkg);
    assert.equal(pkg.packageName, "@modelscript/pscad-master-lib");
    const spec = getPscadDiagramSpecFromLibraries("master:resistor");
    assert.ok(spec);
    assert.equal(spec.ports.length, 2);
  });

  it("ingests an FMI 3.0 FMU with terminalsAndIcons.xml into PSCAD symbols and diagram ports", () => {
    const modelDescriptionXml = `<?xml version="1.0" encoding="UTF-8"?>
<fmiModelDescription fmiVersion="3.0" modelName="GridFormingInverter" instantiationToken="{gfm-1}">
  <CoSimulation modelIdentifier="GridFormingInverter"/>
  <ModelVariables>
    <Float64 name="Vnom_kV" causality="parameter" variability="fixed" start="34.5" unit="kV"/>
    <Float64 name="P_ref" causality="input" start="100.0"/>
    <Float64 name="Va" causality="output"/>
    <Float64 name="Ia" causality="output"/>
  </ModelVariables>
</fmiModelDescription>`;

    const terminalsAndIconsXml = `<?xml version="1.0" encoding="UTF-8"?>
<fmiTerminalsAndIcons fmiVersion="3.0">
  <Terminals>
    <Terminal name="AC_Term" terminalKind="electrical">
      <TerminalMemberVariable variableName="Va" memberName="v" variableKind="potential"/>
      <TerminalMemberVariable variableName="Ia" memberName="i" variableKind="flow"/>
      <Position x="36" y="0"/>
    </Terminal>
    <Terminal name="P_ref" terminalKind="signal">
      <TerminalMemberVariable variableName="P_ref" memberName="u" variableKind="signal"/>
      <Position x="-36" y="0"/>
    </Terminal>
  </Terminals>
</fmiTerminalsAndIcons>`;

    const converted = fmuToPscadComponent(modelDescriptionXml, terminalsAndIconsXml);
    assert.equal(converted.schema.className, "fmu:GridFormingInverter");
    assert.equal(converted.schema.domain, "electrical");
    assert.equal(converted.schema.ports.length, 2);
    assert.equal(converted.schema.ports[0]?.kind, "electrical");
    assert.equal(converted.schema.ports[0]?.offsetX, 36);

    registerFmuComponentsAsPscadLibrary("@modelscript/test-fmu-lib", [{ modelDescriptionXml, terminalsAndIconsXml }]);

    const pscx = `<project name="FmuTest">
  <definitions>
    <Definition classid="UserCmpDefn" name="Main">
      <schematic>
        <User classid="UserCmp" defn="fmu:GridFormingInverter" id="10" x="100" y="100" w="72" h="60">
          <paramlist><param name="Vnom_kV" value="34.5"/></paramlist>
        </User>
      </schematic>
    </Definition>
  </definitions>
</project>`;
    const model = buildProjectModel(pscx);
    const inst = model.definitions.get("Main")?.instances[0];
    assert.ok(inst);
    assert.equal(inst.ports.length, 2);
    assert.equal(inst.ports[0]?.x, 136);
    assert.equal(inst.ports[1]?.x, 64);
  });

  it("mines clean-room symbols and wire-inferred ports from arbitrary .pscx files", () => {
    const pscx = `<project name="CleanRoomMine">
  <definitions>
    <Definition classid="UserCmpDefn" name="Main">
      <schematic>
        <User classid="UserCmp" defn="master:custom_chopper" id="1" x="200" y="200" w="60" h="60">
          <paramlist>
            <param name="Freq" value="2000 [Hz]"/>
            <param name="Duty" value="0.5"/>
          </paramlist>
        </User>
        <Wire classid="Wire" id="2">
          <vertex x="164" y="200"/>
          <vertex x="100" y="200"/>
        </Wire>
        <Wire classid="Wire" id="3">
          <vertex x="236" y="200"/>
          <vertex x="300" y="200"/>
        </Wire>
      </schematic>
    </Definition>
  </definitions>
</project>`;

    const mined = mineCleanRoomLibraryFromPscx([pscx]);
    assert.equal(mined.symbols.length, 1);
    assert.equal(mined.symbols[0]?.namePath, "master:custom_chopper");
    assert.deepEqual(mined.symbols[0]?.exports, ["Freq", "Duty"]);
    assert.equal(mined.diagrams[0]?.ports.length, 2);

    registerMinedCleanRoomLibrary("@modelscript/pscad-mined-lib", [pscx]);
    const spec = globalLibraryRegistry.getDiagramSpec("pscad", "master:custom_chopper");
    assert.ok(spec);
    assert.equal(spec.ports.length, 2);
  });

  it("un-orients rotated instances, mines Bus endpoints, snaps to 18px grid, and merges with authored catalog", () => {
    const pscx = `<project name="BusAndOrient">
  <definitions>
    <Definition classid="UserCmpDefn" name="Main">
      <schematic>
        <User classid="UserCmp" defn="master:source_3" id="1" x="200" y="200" orient="1">
          <paramlist>
            <param name="Vm" value="230 [kV]"/>
          </paramlist>
        </User>
        <Wire classid="Bus" id="2" x="200" y="164">
          <vertex x="0" y="0"/>
          <vertex x="0" y="-72"/>
        </Wire>
      </schematic>
    </Definition>
  </definitions>
</project>`;

    const mined = mineCleanRoomLibraryFromPscx([pscx]);
    const diag = mined.diagrams.find((d) => d.namePath === "master:source_3");
    assert.ok(diag);
    // World delta (0, -36) with orient="1" un-rotates to local (-36, 0)
    assert.ok(diag.ports.some((p) => p.dx === -36 && p.dy === 0));

    const merged = mergeCleanRoomWithCatalog(mined, {
      symbols: [
        {
          name: "source_3",
          kind: "pscad_component",
          ruleName: "UserCmpDefn",
          namePath: "master:source_3",
          exports: ["Name"],
          inherits: [],
          metadata: {
            parameters: [
              {
                key: "Name",
                label: "Name",
                tab: "General",
                group: "General",
                kind: "string",
                defaultValue: "Src",
                description: "Name",
              },
            ],
          },
        },
      ],
      diagrams: [
        {
          namePath: "master:source_3",
          label: "3-Phase Source",
          category: "Sources",
          domain: "electrical",
          width: 72,
          height: 72,
          ports: [{ name: "A", kind: "electrical", side: "right", dx: 36, dy: 0 }],
        },
      ],
    });

    const mergedSym = merged.symbols.find((s) => s.namePath === "master:source_3");
    const mergedDiag = merged.diagrams.find((d) => d.namePath === "master:source_3");
    assert.ok(mergedSym && mergedDiag);
    assert.deepEqual(mergedSym.exports, ["Name", "Vm"]);
    assert.equal(mergedDiag.ports.length, 1);
    assert.equal(mergedDiag.ports[0]?.name, "A");
  });

  it("round-trips fmi-ls-emt annotations and stamps companion G_eq/I_hist in EmtSolver", () => {
    const xml = generateFmiLsEmtAnnotationXml({
      version: "1.0",
      supportsHalfStepCda: true,
      supportsNewtonIteration: false,
      terminals: [
        {
          terminalName: "AC_Term",
          phases: 3,
          vNodeVar: "v_node",
          gEqVar: "G_eq",
          iHistVar: "I_hist",
        },
      ],
    });
    const parsed = parseFmiLsEmtAnnotations(xml);
    assert.ok(parsed);
    assert.equal(parsed.supportsHalfStepCda, true);
    assert.equal(parsed.terminals[0]?.terminalName, "AC_Term");

    let doStepCalls = 0;
    const companion: FmiLsEmtCompanionInstance = {
      stampCompanion: () => ({
        gEq: [0.1, 0, 0, 0, 0.1, 0, 0, 0, 0.1],
        iHist: [50.0, -25.0, -25.0],
      }),
      doStep: (_t, _dt, vNode) => {
        doStepCalls++;
        assert.equal(vNode.length, 3);
      },
    };

    const solver = new EmtSolver(
      {
        nominalFrequencyHz: 60,
        buses: new Map([["POI", { id: "POI", baseKv: 13.8, connectedBranchIds: [] }]]),
        branches: [],
        transformers: [],
        transmissionLines: [],
        sources: [{ id: "GRID", bus: "POI", voltageKv: 13.8, frequencyHz: 60, phaseDeg: 0, rSourceOhm: 1.0 }],
        currentSources: [],
        fmuInstances: [{ id: "FMU_1", busConnection: "POI", ratedMva: 10, ratedKv: 13.8, fmuPath: "dummy.fmu" }],
        controlBlocks: [],
        faults: [],
      } as any,
      {
        timeStepSec: 50e-6,
        durationSec: 0.001,
        fmuCompanions: new Map([["FMU_1", companion]]),
      },
    );

    const res = solver.solve();
    assert.ok(doStepCalls >= 10);
    const iBranch = res.branchPhaseCurrents?.get("FMU_1");
    assert.ok(iBranch);
    assert.ok(Math.abs(iBranch.a[0]!) > 0);
  });

  it("extracts a .pslx/.pscx into an IP-stripped package with AS stubs and builds an .fmu archive", () => {
    const pslx = `<project name="PropLib">
  <definitions>
    <Definition classid="UserCmpDefn" name="MyBlock">
      <paramlist>
        <param name="Gain" value="2.5"/>
      </paramlist>
      <schematic>
        <port name="In1" x="-36" y="0" dim="1" electype="0" mode="0"/>
        <port name="Out1" x="36" y="0" dim="3" electype="2" mode="0"/>
      </schematic>
      <script>
        <segment name="FlyBy"><![CDATA[Proprietary vendor help text]]></segment>
        <segment name="Fortran"><![CDATA[      REAL SECRET_VAR]]></segment>
      </script>
    </Definition>
  </definitions>
</project>`;

    const stripped = extractPscadLibraryPackage(pslx);
    assert.equal(stripped.symbols[0]?.namePath, "PropLib:MyBlock");
    assert.equal(stripped.symbols[0]?.metadata?.["description"], undefined);
    assert.equal(stripped.files.has("src/legacy/MyBlock.fortran.txt"), false);
    assert.ok(stripped.files.get("src/MyBlock.ts")?.includes("MyBlock_stampCompanion"));
    assert.ok(stripped.files.get("fmus/MyBlock/modelDescription.xml")?.includes("org.fmi-standard.fmi-ls-emt"));

    const withIp = extractPscadLibraryPackage(pslx, {
      includeComments: true,
      includeScripts: true,
      implLang: "c",
    });
    assert.ok(withIp.symbols[0]?.metadata?.["description"]);
    assert.ok(withIp.files.has("src/legacy/MyBlock.fortran.txt"));
    assert.ok(withIp.files.has("src/MyBlock.c"));

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msx-extract-"));
    try {
      writeExtractedPscadPackage(tmpDir, stripped);
      const outFmu = path.join(tmpDir, "MyBlock.fmu");
      const bytes = buildFmuFromLibraryPackage(tmpDir, "MyBlock", outFmu);
      assert.ok(bytes.byteLength > 100);
      assert.ok(fs.existsSync(outFmu));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("loads built-in pscad-master-lib runtime.wasm and compiles AssemblyScript companions on the fly", async () => {
    ensureBuiltInPscadLibraryRegistered();
    const pkg = globalLibraryRegistry
      .getPackagesForLanguage("pscad")
      .find((p) => p.packageName === "@modelscript/pscad-master-lib");
    assert.ok(pkg);
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 100);

    const companions = instantiateWasmCompanionsForNetlist({
      fmuInstances: [
        {
          id: "R1",
          modelName: "resistor",
          fmuPath: "",
          terminals: ["N1"],
          params: {},
        } as never,
      ],
    } as never);
    const rComp = companions.get("R1");
    assert.ok(rComp);
    const stamped = rComp.stampCompanion(0, 50e-6);
    assert.equal(stamped.gEq[0], 0.01);

    const compiled = await compileAssemblyScriptCompanion(`
      export function custom_res_stampCompanion(_t: f64, _dt: f64, gPtr: usize, iPtr: usize): void {
        store<f64>(gPtr + 0, 0.25);
        store<f64>(gPtr + 32, 0.25);
        store<f64>(gPtr + 64, 0.25);
        store<f64>(iPtr + 0, 1.5);
      }
      export function custom_res_doStep(_t: f64, _dt: f64, _vPtr: usize): void {}
    `);
    assert.ok(compiled.wasmBytes && compiled.wasmBytes.byteLength > 50, compiled.stderr);

    const mod = new WebAssembly.Module(new Uint8Array(compiled.wasmBytes));
    const inst = new WebAssembly.Instance(mod, {});
    const exp = inst.exports as {
      memory: WebAssembly.Memory;
      custom_res_stampCompanion: (t: number, dt: number, gPtr: number, iPtr: number) => void;
    };
    exp.custom_res_stampCompanion(0, 50e-6, 1024, 1096);
    const f64 = new Float64Array(exp.memory.buffer);
    assert.equal(f64[1024 >> 3], 0.25);
    assert.equal(f64[1096 >> 3], 1.5);
  });

  it("initializes parameterized resistor/inductor/capacitor WASM companions and worker fallback", async () => {
    ensureBuiltInPscadLibraryRegistered();
    const companions = instantiateWasmCompanionsForNetlist({
      fmuInstances: [
        { id: "R_custom", modelName: "resistor", fmuPath: "", terminals: ["N1"], params: { R: 25 } },
        { id: "L_custom", modelName: "inductor", fmuPath: "", terminals: ["N1"], params: { L: 0.1 } },
        { id: "C_custom", modelName: "capacitor", fmuPath: "", terminals: ["N1"], params: { C: 20e-6 } },
      ],
    } as never);

    const dt = 50e-6;
    const rComp = companions.get("R_custom");
    const lComp = companions.get("L_custom");
    const cComp = companions.get("C_custom");
    assert.ok(rComp && lComp && cComp);
    assert.ok(Math.abs(rComp.stampCompanion(0, dt).gEq[0]! - 1 / 25) < 1e-12);
    assert.ok(Math.abs(lComp.stampCompanion(0, dt).gEq[0]! - dt / (2 * 0.1)) < 1e-12);
    assert.ok(Math.abs(cComp.stampCompanion(0, dt).gEq[0]! - (2 * 20e-6) / dt) < 1e-12);

    const workerCompiled = await compileAssemblyScriptInWorker(`
      export function worker_ok(): i32 { return 42; }
    `);
    assert.ok(workerCompiled.wasmBytes && workerCompiled.wasmBytes.byteLength > 20, workerCompiled.stderr);
  });

  it("strictNetlist rejects sourceless projects with P6100 error", () => {
    const emptyPscx = `<project name="empty_strict">
      <paramlist name="Settings">
        <param name="time_step" value="50" />
        <param name="time_duration" value="0.02" />
      </paramlist>
      <definitions>
        <Definition classid="Station" name="empty_strict">
          <schematic classid="UserCanvas">
            <User classid="UserCmp" name="master:resistor" id="10" x="180" y="180">
              <paramlist>
                <param name="R" value="10" />
              </paramlist>
            </User>
          </schematic>
        </Definition>
      </definitions>
    </project>`;

    const result = runPscadSimulationPipeline({
      documentText: emptyPscx,
      runSimulation: true,
      strictNetlist: true,
    });
    assert.equal(result.simulationResult, undefined);
    assert.ok(
      result.diagnostics.some((d) => d.code === "P6100" && d.severity === "error"),
      `Expected P6100 error, got: ${JSON.stringify(result.diagnostics)}`,
    );
  });

  it("matches analytical steady-state current on a 3-phase RL circuit within tight RMSE", () => {
    const f = 60;
    const omega = 2 * Math.PI * f;
    const vPeakKv = 0.1; // 100 V peak phase-to-ground
    const R = 10;
    const L = 0.02;
    const dt = 25e-6;
    const durationSec = 0.12; // >7 cycles so transient decays (tau = L/R = 2 ms)

    const netlist = {
      buses: new Map([
        ["Bus1", { id: "Bus1", name: "Bus1", nominalKv: 0.1, isReference: false, connectedBranchIds: ["RL1"] }],
        ["GND", { id: "GND", name: "GND", nominalKv: 0, isReference: true, connectedBranchIds: ["RL1"] }],
      ]),
      branches: [
        {
          id: "RL1",
          name: "RL1",
          kind: "rlc",
          fromBus: "Bus1",
          toBus: "GND",
          rOhm: R,
          lH: L,
          cF: 0,
        },
      ],
      transformers: [],
      transmissionLines: [],
      fmuInstances: [],
      sources: [
        {
          id: "Src1",
          name: "Src1",
          bus: "Bus1",
          vPeakKv,
          frequencyHz: f,
          phaseRad: 0,
          mvaRating: 10,
          rSourceOhm: 1e-4,
          lSourceH: 0,
        },
      ],
      nominalFrequencyHz: f,
    };

    const solver = new EmtSolver(netlist as never, {
      timeStepSec: dt,
      durationSec,
      nominalFrequencyHz: f,
      enableCda: true,
    });
    const sim = solver.solve();
    const iPhaseA = sim.branchPhaseCurrents?.get("RL1")?.a;
    assert.ok(iPhaseA && iPhaseA.length > 100);

    // Steady-state impedance magnitude & phase: Z = R + j*omega*L
    const vPeakV = vPeakKv * 1000;
    const xL = omega * L;
    const zMag = Math.hypot(R, xL);
    const phi = Math.atan2(xL, R);
    const iPeakAnalytical = vPeakV / zMag;

    // Compare last 2 cycles (t >= 0.08 s, where exp(-t/tau) < 4e-18)
    let sqErr = 0;
    let count = 0;
    for (let k = 0; k < sim.time.length; k++) {
      const t = sim.time[k]!;
      if (t < 0.08) continue;
      const iAnalytic = iPeakAnalytical * Math.sin(omega * t - phi);
      const err = iPhaseA[k]! - iAnalytic;
      sqErr += err * err;
      count++;
    }
    const rmse = Math.sqrt(sqErr / count);
    const nrmse = rmse / iPeakAnalytical;
    assert.ok(nrmse < 0.02, `Expected NRMSE < 2%, got ${(nrmse * 100).toFixed(3)}% (RMSE=${rmse.toFixed(4)} A)`);
  });

  it("initializes parameterized transformer, arrester, diode, and pi WASM companions", () => {
    ensureBuiltInPscadLibraryRegistered();
    const companions = instantiateWasmCompanionsForNetlist({
      fmuInstances: [
        { id: "X1", modelName: "transformer", fmuPath: "", terminals: ["N1"], params: { R: 0.2, L_leak: 0.02 } },
        { id: "A1", modelName: "arrester", fmuPath: "", terminals: ["N1"], params: { Vref: 100 } },
        { id: "D1", modelName: "diode", fmuPath: "", terminals: ["N1"], params: { Ron: 0.05 } },
        { id: "PI1", modelName: "pi", fmuPath: "", terminals: ["N1"], params: { Kp: 2.5, Ki: 50 } },
      ],
    } as never);

    const dt = 50e-6;
    const xComp = companions.get("X1");
    const aComp = companions.get("A1");
    const dComp = companions.get("D1");
    const piComp = companions.get("PI1");
    assert.ok(xComp && aComp && dComp && piComp);

    const expectedXg = 1 / (0.2 + (2 * 0.02) / dt);
    assert.ok(Math.abs(xComp.stampCompanion(0, dt).gEq[0]! - expectedXg) < 1e-12);

    assert.ok(Math.abs(dComp.stampCompanion(0, dt).gEq[0]! - 1 / 0.05) < 1e-12);
    dComp.doStep(0, dt, [-10, -10, -10]);
    assert.ok(dComp.stampCompanion(dt, dt).gEq[0]! < 1e-4);

    assert.ok(aComp.stampCompanion(0, dt).gEq[0]! < 1e-6);
    aComp.doStep(0, dt, [150e3, 0, 0]);
    assert.equal(aComp.stampCompanion(dt, dt).gEq[0], 1.0);

    assert.equal(piComp.stampCompanion(0, dt).gEq[0], 2.5);
    piComp.doStep(0, dt, [2, 2, 2]);
    assert.ok(Math.abs(piComp.stampCompanion(dt, dt).iHist[0]! - 50 * 2 * dt) < 1e-12);
  });

  it("verifies series RLC underdamped response and breaker CDA switching transient", () => {
    // 1. Series RLC AC steady-state impedance: V = 100 V peak @ 60 Hz, R = 10, L = 0.05, C = 100 uF
    const f = 60;
    const omega = 2 * Math.PI * f;
    const R = 10;
    const L = 0.05;
    const C = 100e-6;
    const dt = 25e-6;
    const netlistRlc = {
      buses: new Map([
        ["Bus1", { id: "Bus1", name: "Bus1", nominalKv: 0.1, isReference: false, connectedBranchIds: ["RL1"] }],
        [
          "BusMid",
          { id: "BusMid", name: "BusMid", nominalKv: 0.1, isReference: false, connectedBranchIds: ["RL1", "C1"] },
        ],
        ["GND", { id: "GND", name: "GND", nominalKv: 0, isReference: true, connectedBranchIds: ["C1"] }],
      ]),
      branches: [
        {
          id: "RL1",
          name: "RL1",
          kind: "passive",
          fromBus: "Bus1",
          toBus: "BusMid",
          resistanceOhm: R,
          inductanceH: L,
          capacitanceF: 0,
        },
        {
          id: "C1",
          name: "C1",
          kind: "passive",
          fromBus: "BusMid",
          toBus: "GND",
          resistanceOhm: 0,
          inductanceH: 0,
          capacitanceF: C,
        },
      ],
      transformers: [],
      transmissionLines: [],
      fmuInstances: [],
      sources: [
        {
          id: "Src1",
          name: "Src1",
          bus: "Bus1",
          vPeakKv: 0.1,
          frequencyHz: f,
          phaseRad: 0,
          mvaRating: 10,
          rSourceOhm: 1e-4,
          lSourceH: 0,
        },
      ],
      nominalFrequencyHz: f,
    };

    const simRlc = new EmtSolver(netlistRlc as never, {
      timeStepSec: dt,
      durationSec: 0.25,
      nominalFrequencyHz: f,
      enableCda: true,
    }).solve();
    const iRlc = simRlc.branchPhaseCurrents?.get("RL1")?.a;
    assert.ok(iRlc && iRlc.length > 100);
    const xNet = omega * L - 1 / (omega * C);
    const zMag = Math.hypot(R, xNet);
    const phi = Math.atan2(xNet, R);
    const iPeak = 100 / zMag;
    let sqErr = 0;
    let count = 0;
    for (let k = 0; k < simRlc.time.length; k++) {
      const t = simRlc.time[k]!;
      if (t < 0.2) continue;
      const err = iRlc[k]! - iPeak * Math.sin(omega * t - phi);
      sqErr += err * err;
      count++;
    }
    const nrmse = Math.sqrt(sqErr / count) / iPeak;
    assert.ok(nrmse < 0.03, `RLC NRMSE too high: ${(nrmse * 100).toFixed(2)}%`);

    // 2. Breaker CDA switching: opens at t = 0.02s, current collapses cleanly without NaN or blowup
    const netlistBrk = {
      buses: new Map([
        ["Bus1", { id: "Bus1", name: "Bus1", nominalKv: 0.1, isReference: false, connectedBranchIds: ["BRK1"] }],
        [
          "Bus2",
          { id: "Bus2", name: "Bus2", nominalKv: 0.1, isReference: false, connectedBranchIds: ["BRK1", "Rload"] },
        ],
        ["GND", { id: "GND", name: "GND", nominalKv: 0, isReference: true, connectedBranchIds: ["Rload"] }],
      ]),
      branches: [
        {
          id: "BRK1",
          name: "BRK1",
          kind: "switch",
          fromBus: "Bus1",
          toBus: "Bus2",
          resistanceOhm: 0.01,
          inductanceH: 0,
          capacitanceF: 0,
          status: "closed",
          openTimeSec: 0.02,
        },
        {
          id: "Rload",
          name: "Rload",
          kind: "passive",
          fromBus: "Bus2",
          toBus: "GND",
          resistanceOhm: 10,
          inductanceH: 0,
          capacitanceF: 0,
        },
      ],
      transformers: [],
      transmissionLines: [],
      fmuInstances: [],
      sources: [
        {
          id: "Src1",
          name: "Src1",
          bus: "Bus1",
          vPeakKv: 0.1,
          frequencyHz: f,
          phaseRad: 0,
          mvaRating: 10,
          rSourceOhm: 1e-4,
          lSourceH: 0,
        },
      ],
      nominalFrequencyHz: f,
    };
    const simBrk = new EmtSolver(netlistBrk as never, {
      timeStepSec: 50e-6,
      durationSec: 0.05,
      nominalFrequencyHz: f,
      enableCda: true,
    }).solve();
    const iBrk = simBrk.branchPhaseCurrents?.get("Rload")?.a;
    assert.ok(iBrk && iBrk.length > 100);
    const tailMax = Math.max(...Array.from(iBrk.slice(-50)).map((v) => Math.abs(v)));
    assert.ok(
      Number.isFinite(tailMax) && tailMax < 0.05,
      `Expected breaker current to collapse after opening, got tailMax=${tailMax}`,
    );
  });

  it("lowers master:abs, master:tdelay, and master:zminusone to dedicated kinds and computes sound intervals", () => {
    const pscx = `<project name="ctrl_kinds">
      <definitions>
        <Definition classid="Station" name="ctrl_kinds">
          <schematic classid="UserCanvas">
            <User classid="UserCmp" name="master:const" id="1" x="18" y="18"><paramlist><param name="Name" value="C1" /><param name="Value" value="-5" /></paramlist></User>
            <User classid="UserCmp" name="master:abs" id="2" x="54" y="18"><paramlist><param name="Name" value="A1" /></paramlist></User>
            <User classid="UserCmp" name="master:tdelay" id="3" x="90" y="18"><paramlist><param name="Name" value="D1" /><param name="T" value="0.01" /></paramlist></User>
            <User classid="UserCmp" name="master:zminusone" id="4" x="126" y="18"><paramlist><param name="Name" value="Z1" /></paramlist></User>
          </schematic>
        </Definition>
      </definitions>
    </project>`;
    const netlist = extractEmtNetlist(parsePscx(pscx));
    const blocks = netlist.controlBlocks ?? [];
    assert.equal(blocks.find((b) => b.id === "2" || b.id === "A1")?.kind, "abs");
    assert.equal(blocks.find((b) => b.id === "3" || b.id === "D1")?.kind, "tdelay");
    assert.equal(blocks.find((b) => b.id === "4" || b.id === "Z1")?.kind, "zminusone");

    const intervals = analyzeControlIntervals([
      { id: "C1", kind: "const", inputs: [], params: { value: -5 } },
      { id: "A1", kind: "abs", inputs: ["C1"], params: {} },
      { id: "D1", kind: "tdelay", inputs: ["A1"], params: { T: 0.01 } },
      { id: "Z1", kind: "zminusone", inputs: ["D1"], params: {} },
    ]);
    assert.deepEqual(intervals.get("A1"), { lo: 0, hi: 5 });
    assert.deepEqual(intervals.get("D1"), { lo: 0, hi: 5 });
    assert.deepEqual(intervals.get("Z1"), { lo: 0, hi: 5 });

    const evaluator = new CsmfControlEvaluator([
      { id: "C1", kind: "const", inputs: [], params: { value: -5 } },
      { id: "A1", kind: "abs", inputs: ["C1"], params: {} },
      { id: "D1", kind: "tdelay", inputs: ["A1"], params: { T: 2e-3 } },
      { id: "Z1", kind: "zminusone", inputs: ["D1"], params: {} },
    ]);
    const s1 = evaluator.step(1e-3); // 2-step tdelay ring buffer
    assert.equal(s1.get("A1"), 5);
    assert.equal(s1.get("D1"), 0);
    assert.equal(s1.get("Z1"), 0);
    const s2 = evaluator.step(1e-3);
    assert.equal(s2.get("D1"), 0);
    const s3 = evaluator.step(1e-3);
    assert.equal(s3.get("D1"), 5);
    assert.equal(s3.get("Z1"), 0);
    const s4 = evaluator.step(1e-3);
    assert.equal(s4.get("Z1"), 5);
  });

  it("closes the EmtSolver loop from sensor_v -> abs -> tdelay -> breaker_status", () => {
    const netlist = {
      name: "ClosedLoopTripTest",
      nominalFrequencyHz: 60,
      buses: new Map([
        ["B_SRC", { id: "B_SRC", name: "B_SRC", nominalKv: 1.0, isReference: false, connectedBranchIds: ["BRK_1"] }],
        [
          "B_LOAD",
          { id: "B_LOAD", name: "B_LOAD", nominalKv: 1.0, isReference: false, connectedBranchIds: ["BRK_1", "R_LOAD"] },
        ],
        ["GND", { id: "GND", name: "GND", nominalKv: 0, isReference: true, connectedBranchIds: ["R_LOAD"] }],
      ]),
      branches: [
        {
          id: "BRK_1",
          name: "BRK_1",
          kind: "switch" as const,
          status: "closed" as const,
          fromBus: "B_SRC",
          toBus: "B_LOAD",
          rClosedOhm: 0.01,
          rOpenOhm: 1e6,
        },
        {
          id: "R_LOAD",
          name: "R_LOAD",
          kind: "rlc" as const,
          fromBus: "B_LOAD",
          toBus: "GND",
          rOhm: 10.0,
          lH: 0,
          cF: 0,
        },
      ],
      transformers: [],
      transmissionLines: [],
      fmuInstances: [],
      sources: [
        {
          id: "SRC_1",
          name: "SRC_1",
          bus: "B_SRC",
          vPeakKv: 1.0,
          frequencyHz: 60,
          phaseRad: 0,
          mvaRating: 10,
          rSourceOhm: 1e-4,
          lSourceH: 0,
        },
      ],
      controlBlocks: [
        { id: "SENS_V", kind: "sensor_v" as const, sensorTarget: "B_LOAD", inputs: [], params: {} },
        { id: "ABS_V", kind: "abs" as const, inputs: ["SENS_V"], params: {} },
        { id: "TD_1", kind: "tdelay" as const, inputs: ["ABS_V"], params: { T: 1e-3 } },
        {
          id: "TRIP_ACT",
          kind: "gain" as const,
          inputs: ["TD_1"],
          params: { K: 1.0 },
          actuator: { type: "breaker_status" as const, targetId: "BRK_1" },
        },
      ],
    };

    const solver = new EmtSolver(netlist as never, {
      durationSec: 0.01,
      timeStepSec: 50e-6,
      nominalFrequencyHz: 60,
    });
    const res = solver.solve();
    const tripTraj = res.controlSignals?.get("TRIP_ACT");
    assert.ok(tripTraj && tripTraj.length > 0, "Expected TRIP_ACT trajectory to be recorded");
    assert.equal(tripTraj[0], 0, "Trip signal starts at 0 before delay expires");
    assert.ok(tripTraj[tripTraj.length - 1]! > 0.5, "Trip signal exceeds 0.5 after tdelay");

    const vLoad = res.busPhaseVoltages.get("B_LOAD")?.a;
    assert.ok(vLoad, "Expected B_LOAD voltage trajectory");
    // Before trip (~1ms, step 20), load voltage is energized (> 100 V peak); after 1ms trip delay (step 40, t=2ms), it collapses near 0
    assert.ok(Math.abs(vLoad[15]!) > 100, `Expected energized voltage before trip, got ${vLoad[15]}`);
    assert.ok(Math.abs(vLoad[40]!) < 1.0, `Expected collapsed voltage after trip at t=2ms, got ${vLoad[40]}`);
  });

  it("generates compilable clean-room AssemblyScript fmi-ls-emt companion from EmtCustomFortranBlock", async () => {
    const src = generateCleanRoomCompanionFromFortran({
      id: "CUSTOM_STATCOM",
      name: "StatcomCtrl",
      referencedPorts: ["VA", "VB", "VC"],
      assignedPorts: ["IA_INJ", "IB_INJ", "IC_INJ"],
      numRealStates: 2,
      numIntStates: 0,
    });
    assert.ok(src.includes("StatcomCtrl_stampCompanion"));
    assert.ok(src.includes("StatcomCtrl_doStep"));
    const compiled = await compileAssemblyScriptCompanion(src);
    assert.ok(
      compiled.wasmBytes && compiled.wasmBytes.byteLength > 0,
      `Expected valid WASM bytes, stderr=${compiled.stderr}`,
    );
  });

  it("auto-registers inline librarySources (.pslx) in runPscadSimulationPipeline", () => {
    const libPslx = `<?xml version="1.0" encoding="utf-8"?>
<project name="InlineCustomLib" version="5.0">
  <definitions>
    <Definition name="CustomSubmodule" version="1.0">
      <paramlist />
      <schematic />
    </Definition>
  </definitions>
</project>`;
    const mainPscx = `<?xml version="1.0" encoding="utf-8"?>
<project name="MainWithLib" version="5.0">
  <schematics>
    <schematic name="Main">
      <User id="1" name="Main:Vsrc" defn="master:source_3" x="0" y="0">
        <paramlist><param name="Vm" value="13.8" /><param name="F" value="60" /></paramlist>
      </User>
      <User id="2" name="Main:R1" defn="master:resistor" x="100" y="0">
        <paramlist><param name="R" value="10" /></paramlist>
      </User>
      <User id="3" name="Main:Gnd" defn="master:ground" x="200" y="0" />
      <Wire id="10" name="W1"><vertex x="0" y="0" /><vertex x="100" y="0" /></Wire>
      <Wire id="11" name="W2"><vertex x="100" y="0" /><vertex x="200" y="0" /></Wire>
    </schematic>
  </schematics>
</project>`;
    const out = runPscadSimulationPipeline({
      documentText: mainPscx,
      librarySources: [libPslx],
      durationSec: 0.005,
      timeStepSec: 50e-6,
    });
    assert.ok(out.project, "Expected project parsed cleanly with librarySources");
  });

  it("simulates pure-CSMF control-only .pscx under strictNetlist: true without P6100 or dummy IBR", () => {
    const controlOnlyPscx = `<?xml version="1.0" encoding="utf-8"?>
<project name="ControlOnlyTest" version="5.0">
  <definitions>
    <Definition classid="Station" name="ControlOnlyTest">
      <schematic classid="UserCanvas">
        <User classid="UserCmp" name="master:const" id="10" x="18" y="18"><paramlist><param name="Name" value="C1" /><param name="Value" value="-3.5" /></paramlist></User>
        <User classid="UserCmp" name="master:abs" id="11" x="54" y="18"><paramlist><param name="Name" value="A1" /></paramlist></User>
        <Wire classid="WireOrthogonal" id="20" x="18" y="18" w="36" h="0"><vertex x="0" y="0" /><vertex x="36" y="0" /></Wire>
      </schematic>
    </Definition>
  </definitions>
</project>`;
    const out = runPscadSimulationPipeline({
      documentText: controlOnlyPscx,
      runSimulation: true,
      strictNetlist: true,
      durationSec: 0.001,
      timeStepSec: 50e-6,
    });
    assert.ok(out.simulationResult, "Expected simulationResult for pure-CSMF control-only project");
    assert.equal(out.simulationReport.synthesizedIbr, false);
    assert.equal(out.simulationReport.injectedReferenceBuses.length, 0);
    assert.ok(
      !out.diagnostics.some((d) => d.code === "P6100" && d.severity === "error"),
      `Did not expect P6100 error, got: ${JSON.stringify(out.diagnostics)}`,
    );
    assert.ok(
      (out.simulationResult.controlSignals?.size ?? 0) >= 2,
      `Expected controlSignals trajectories, got size=${out.simulationResult.controlSignals?.size ?? 0}`,
    );
  });

  it("compiles and instantiates clean-room fmi-ls-emt companions via compileCleanRoomCompanionsForNetlist", async () => {
    const companions = await compileCleanRoomCompanionsForNetlist({
      buses: new Map(),
      branches: [],
      transformers: [],
      transmissionLines: [],
      fmuInstances: [],
      sources: [],
      nominalFrequencyHz: 60,
      customFortranBlocks: [
        {
          id: "BLK_CUSTOM_1",
          name: "CustomVsc",
          referencedPorts: ["VA", "VB", "VC"],
          assignedPorts: ["IA_INJ", "IB_INJ", "IC_INJ"],
          numRealStates: 2,
          numIntStates: 0,
        },
      ],
    });
    const inst = companions.get("BLK_CUSTOM_1");
    assert.ok(inst, "Expected compiled FmiLsEmtCompanionInstance for BLK_CUSTOM_1");
    const stamped = inst.stampCompanion(0, 50e-6);
    assert.equal(stamped.gEq.length, 9);
    assert.equal(stamped.iHist.length, 3);
    inst.doStep(50e-6, 50e-6, [1, 0, -1]);
  });

  it("matches analytical 3-phase bolted fault depression and post-fault recovery", () => {
    const f = 60;
    const vPeakKv = 1.0; // 1000 V peak
    const dt = 50e-6;
    const netlist = {
      buses: new Map([
        ["B1", { id: "B1", name: "B1", nominalKv: 1.0, isReference: false, connectedBranchIds: ["LINE1"] }],
        ["B2", { id: "B2", name: "B2", nominalKv: 1.0, isReference: false, connectedBranchIds: ["LINE1", "RLOAD"] }],
        ["GND", { id: "GND", name: "GND", nominalKv: 0, isReference: true, connectedBranchIds: ["RLOAD"] }],
      ]),
      branches: [
        {
          id: "LINE1",
          name: "LINE1",
          kind: "passive" as const,
          fromBus: "B1",
          toBus: "B2",
          resistanceOhm: 0.5,
          inductanceH: 0.001,
          capacitanceF: 0,
        },
        {
          id: "RLOAD",
          name: "RLOAD",
          kind: "passive" as const,
          fromBus: "B2",
          toBus: "GND",
          resistanceOhm: 20.0,
          inductanceH: 0,
          capacitanceF: 0,
        },
      ],
      transformers: [],
      transmissionLines: [],
      fmuInstances: [],
      sources: [
        {
          id: "SRC1",
          name: "SRC1",
          bus: "B1",
          vPeakKv,
          frequencyHz: f,
          phaseRad: 0,
          mvaRating: 10,
          rSourceOhm: 0.05,
          lSourceH: 0,
        },
      ],
      faults: [{ id: "FLT1", bus: "B2", faultType: "3PH" as const, startSec: 0.02, endSec: 0.04, rFaultOhm: 0.001 }],
      nominalFrequencyHz: f,
    };

    const res = new EmtSolver(netlist as never, {
      timeStepSec: dt,
      durationSec: 0.06,
      nominalFrequencyHz: f,
      enableCda: true,
    }).solve();
    const vB2 = res.busPhaseVoltages.get("B2")?.a;
    assert.ok(vB2 && vB2.length >= 1200);
    // Pre-fault (10ms..19ms): peak near 970 V; during bolted fault (25ms..38ms): depressed < 20 V; post-fault (45ms..58ms): recovers > 900 V
    const prePeak = Math.max(...Array.from(vB2.slice(200, 380)).map((v) => Math.abs(v)));
    const faultPeak = Math.max(...Array.from(vB2.slice(500, 760)).map((v) => Math.abs(v)));
    const postPeak = Math.max(...Array.from(vB2.slice(900, 1160)).map((v) => Math.abs(v)));
    assert.ok(prePeak > 900, `Expected pre-fault peak > 900 V, got ${prePeak}`);
    assert.ok(faultPeak < 25, `Expected bolted fault peak < 25 V, got ${faultPeak}`);
    assert.ok(postPeak > 900, `Expected post-fault recovery peak > 900 V, got ${postPeak}`);
  });
});
