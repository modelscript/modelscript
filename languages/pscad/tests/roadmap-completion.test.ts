// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeControlZonotopes } from "../src/analysis/control-intervals.js";
import {
  compileCleanRoomCompanionsForNetlist,
  generateCleanRoomCompanionFromFortran,
} from "../src/catalog/wasm-companion-loader.js";
import { planDiagramActions } from "../src/edit/diagram-actions.js";
import { planPscadEdits } from "../src/edit/edit-engine.js";
import {
  clearPscadIncrementalCache,
  extractEmtNetlistFromXml,
  getPscadIncrementalStats,
} from "../src/netlist/emt-netlist.js";
import { checkRationalPassivity, enforceRationalPassivity } from "../src/solver/vector-fitting.js";

describe("PSCAD Roadmap Completion (M6063 zonotopes, editing ergonomics, ULM passivity, AST->WASM & incremental cache)", () => {
  it("cancels instantaneously correlated signals with zonotope tracking (M6063) while staying sound across tdelay", () => {
    const zono = analyzeControlZonotopes([
      { id: "lo", kind: "const", inputs: [], params: { value: -2 } },
      { id: "hi", kind: "const", inputs: [], params: { value: 4 } },
      { id: "src", kind: "select", inputs: ["lo", "hi"], params: {} },
      { id: "lim", kind: "limit", inputs: ["src"], params: { min: -10, max: 10 } },
      { id: "g1", kind: "gain", inputs: ["lim"], params: { K: 1 } },
      { id: "instDiff", kind: "sum", inputs: ["lim", "g1"], params: { s1: 1, s2: -1 } },
      { id: "dly", kind: "tdelay", inputs: ["lim"], params: {} },
      { id: "dlyDiff", kind: "sum", inputs: ["lim", "dly"], params: { s1: 1, s2: -1 } },
    ]);
    // Instantaneous correlated paths (lim - 1*lim) cancel soundly to [0, 0]
    const instEntry = zono.get("instDiff");
    assert.ok(instEntry, "Expected zonotope entry for instantaneous sum block 'instDiff'");
    assert.equal(instEntry.interval.lo, 0);
    assert.equal(instEntry.interval.hi, 0);
    assert.equal(instEntry.plainInterval.lo, -6);
    assert.equal(instEntry.plainInterval.hi, 6);
    assert.equal(instEntry.tightenedByZonotope, true);

    // Delayed path x(t) - x(t - tau) must NOT unsoundly cancel to [0, 0]
    const dlyEntry = zono.get("dlyDiff");
    assert.ok(dlyEntry, "Expected zonotope entry for delayed sum block 'dlyDiff'");
    assert.equal(dlyEntry.interval.lo, -6);
    assert.equal(dlyEntry.interval.hi, 6);
  });

  it("supports copySelection, syncSubmodulePorts, and rotate wire rerouting in edit engine", () => {
    const pscx = `<project name="edit_test" version="5.0.2">
  <definitions>
    <Definition name="SubMod" classid="UserCmpDefn">
      <graphic>
        <port name="OldStale" x="-54" y="0" dim="1" mode="In" type="" />
      </graphic>
      <schematic>
        <User classid="UserCmp" id="10" name="xnode" defn="master:xnode" x="100" y="100" w="20" h="20" orient="0" disable="false">
          <paramlist link="-1" name="" crc="0">
            <param name="Name" value="VA_IN" />
            <param name="Dim" value="3" />
          </paramlist>
        </User>
      </schematic>
    </Definition>
    <Definition name="Main" classid="StationDefn">
      <schematic>
        <User classid="UserCmp" id="20" name="res" defn="master:resistor" x="108" y="108" w="40" h="20" orient="0" disable="false">
          <paramlist link="-1" name="" crc="0" />
        </User>
      </schematic>
    </Definition>
  </definitions>
</project>`;

    const editRes = planPscadEdits(pscx, [
      { type: "copySelection", ids: ["20"], targetDefinition: "Main", dx: 72, dy: 36 },
      { type: "syncSubmodulePorts", definition: "SubMod" },
    ]);
    assert.equal(editRes.errors.length, 0);
    assert.equal(editRes.createdIds.length, 1);
    assert.ok(editRes.text.includes('name="VA_IN"'));
    assert.ok(!editRes.text.includes('name="OldStale"'));
    assert.ok(editRes.text.includes('x="180" y="144"'));

    const diaRes = planDiagramActions(editRes.text, [{ type: "rotate", item: { name: "cmp_20", rotation: 90 } }]);
    assert.equal(diaRes.unresolved.length, 0);
    assert.ok(diaRes.edits.some((e) => e.newText === "1"));
  });

  it("enforces ULM rational passivity via minimum-norm residue projection preserving d0", () => {
    const poles = new Float64Array([-10, -100, -1000]);
    const residues = new Float64Array([0.05, -2.5, 0.2]);
    const origD0 = 0.01;
    assert.equal(checkRationalPassivity(poles, residues, origD0).passive, false);
    const enforced = enforceRationalPassivity(poles, residues, origD0);
    assert.equal(enforced.d0, origD0, "Expected d0 to stay unperturbed when residue projection fixes passivity");
    assert.equal(checkRationalPassivity(poles, enforced.residues, enforced.d0).passive, true);
  });

  it("memoizes XML netlists incrementally and compiles Fortran AST to real WASM equations", async () => {
    clearPscadIncrementalCache();
    const xml = `<project name="inc_wasm" version="5.0.2">
  <definitions>
    <Definition name="MyGainUdm" classid="UserCmpDefn">
      <script>
        <segment name="Fortran"><![CDATA[
          $Y_out = $V_in * 2.5 + SIN(0.0)
        ]]></segment>
      </script>
    </Definition>
    <Definition name="Main" classid="UserCmpDefn">
      <schematic classid="UserCanvas">
        <User classid="UserCmp" id="50" name="udm1" defn="MyGainUdm" x="100" y="100" w="40" h="40" orient="0" disable="false">
          <paramlist link="-1" name="" crc="0" />
        </User>
      </schematic>
    </Definition>
  </definitions>
</project>`;

    const n1 = extractEmtNetlistFromXml(xml);
    const n2 = extractEmtNetlistFromXml(xml);
    assert.equal(n1, n2);
    const stats = getPscadIncrementalStats();
    assert.equal(stats.misses, 1);
    assert.equal(stats.hits, 1);
    assert.ok((n1.customFortranBlocks?.length ?? 0) === 1);

    const block = n1.customFortranBlocks![0]!;
    const asSrc = generateCleanRoomCompanionFromFortran(block);
    assert.ok(asSrc.includes("2.5"), `Expected compiled AST constant 2.5 in AS kernel:\n${asSrc}`);
    assert.ok(asSrc.includes("Math.sin"), `Expected compiled Math.sin in AS kernel:\n${asSrc}`);

    const compiledMap = await compileCleanRoomCompanionsForNetlist(n1);
    const inst = compiledMap.get(block.id);
    assert.ok(inst, "Expected compiled WASM companion instance from AST-lowered kernel");
    inst.doStep(0.01, 50e-6, new Float64Array([4.0, 0.0, 0.0]));
    const stamped = inst.stampCompanion(0.01, 50e-6);
    assert.equal(stamped.gEq.length, 9);
  });

  it("executes PSCAD Multiple-Run (runMultipleRunSweep) and EmtSolver default WASM path", async () => {
    const { pscadLanguage } = await import("../src/language.js");
    const { runMultipleRunSweep } = await import("../src/solver/parametric-sweep.js");
    const { EmtSolver } = await import("../src/solver/emt-solver.js");

    const sweep = runMultipleRunSweep(
      {
        buses: new Map([
          ["B1", { id: "B1", name: "B1", baseKv: 138, connectedBranchIds: ["L1"] }],
          ["B2", { id: "B2", name: "B2", baseKv: 138, connectedBranchIds: ["L1", "R1"] }],
        ]),
        branches: [
          { id: "L1", fromBus: "B1", toBus: "B2", kind: "rlc", resistanceOhm: 1.0, inductanceH: 0.01, capacitanceF: 0 },
          { id: "R1", fromBus: "B2", toBus: "GND", kind: "rlc", resistanceOhm: 50.0, inductanceH: 0, capacitanceF: 0 },
        ],
        transformers: [],
        transmissionLines: [],
        fmuInstances: [],
        sources: [
          {
            id: "S1",
            name: "S1",
            bus: "B1",
            vPeakKv: 112.68,
            frequencyHz: 60,
            phaseRad: 0,
            mvaRating: 100,
            rSourceOhm: 1.0,
          },
        ],
        nominalFrequencyHz: 60,
      },
      {
        numRuns: 5,
        durationSec: 0.02,
        timeStepSec: 50e-6,
        parameters: [{ targetId: "S1", paramName: "vPeakKv", min: 100, max: 120, distribution: "grid" }],
      },
    );
    assert.equal(sweep.totalRuns, 5);
    assert.ok(sweep.maxPeakKv >= sweep.minPeakKv);
    assert.ok(sweep.p98PeakKv >= sweep.minPeakKv);

    // Default EmtSolver without explicit useWasm uses native WASM kernel on linear RLC circuits
    const defaultSim = new EmtSolver(
      {
        buses: new Map([["B1", { id: "B1", name: "B1", baseKv: 13.8, connectedBranchIds: ["R1"] }]]),
        branches: [
          { id: "R1", fromBus: "B1", toBus: "GND", kind: "rlc", resistanceOhm: 10, inductanceH: 0, capacitanceF: 0 },
        ],
        transformers: [],
        transmissionLines: [],
        fmuInstances: [],
        sources: [
          { id: "S1", name: "S1", bus: "B1", vPeakKv: 10, frequencyHz: 60, phaseRad: 0, mvaRating: 10, rSourceOhm: 1 },
        ],
        nominalFrequencyHz: 60,
      },
      { timeStepSec: 50e-6, durationSec: 0.01 },
    ).solve();
    assert.ok(defaultSim.time.length > 0);
    assert.equal(defaultSim.metrics.luFactorizations, 1, "Expected native WASM single coupled LU factorization");
    assert.ok(pscadLanguage.actions?.some((a) => a.id === "run_mrun_sweep"));
  });

  it("scaffolds minimal .pscx project XML when dropping components onto blank or broken files", async () => {
    const { createPscadDiagramBackend } = await import("../src/diagram-backend.js");
    const { parsePscx } = await import("../src/parser/pscx-parser.js");

    for (const initial of ["", '<project name="Broken">']) {
      let doc = initial;
      const uri = "file:///tmp/blank-pscad.pscx";
      const backend = createPscadDiagramBackend({ getDocumentText: (u) => (u === uri ? doc : undefined) });
      const res = await backend.applyEdits!({
        uri,
        seq: 1,
        actions: [{ type: "addComponent", className: "master:resistor", x: 180, y: 120 }],
      });
      assert.equal(res.renderHint, "immediate");
      assert.equal(res.edits.length, 1);
      doc = res.edits[0]!.newText;
      const parsed = parsePscx(doc);
      assert.ok(
        parsed.rootModule.components.length >= 1,
        `expected component after scaffolding from ${JSON.stringify(initial)}`,
      );
    }
  });
});
