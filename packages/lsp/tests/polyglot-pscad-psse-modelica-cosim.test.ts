// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl/bindings";
import { Context as ModelicaContext } from "@modelscript/modelica";
import { FIELD_NAMES as modelicaFieldNames, SYNTAX_NAMES as modelicaSyntaxNames } from "@modelscript/modelica/parser";
import { pscadLanguage } from "@modelscript/pscad";
import { parseRaw, psseLanguage } from "@modelscript/psse";
import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { resolveCrossLanguageComponentDrop } from "../src/cross-language-drop.js";
import {
  detectPolyglotPlan,
  extractPolyglotBoundaryBindings,
  runHybridPssePscadModelicaCosim,
  runModelicaPscadCosim,
} from "../src/services/polyglot-cosim-runner.js";

const require = createRequire(import.meta.url);

let modelicaParserReady = false;
async function ensureModelicaParser(): Promise<void> {
  if (modelicaParserReady) return;
  const wasmPath = require.resolve("@modelscript/modelica/parser.wasm");
  const { parser } = await createWasmParser(wasmPath, {
    syntaxNames: modelicaSyntaxNames,
    fieldNames: modelicaFieldNames,
  });
  ModelicaContext.registerParser(".mo", parser as never);
  modelicaParserReady = true;
}

test("PSCAD builtins materialize in UnifiedWorkspace and resolve directly without _BlackBox", () => {
  const uw = new UnifiedWorkspace(pscadLanguage);
  const idx = uw.getIndex();
  assert.ok(idx.byName.has("PSCAD"), "PSCAD root package must be materialized from pscadLanguage.indexing.builtins");
  assert.ok(idx.byName.has("ElectricalPin"), "PSCAD.Interfaces.ElectricalPin must be materialized");

  const dropRes = resolveCrossLanguageComponentDrop(idx, "PSCAD.Interfaces.ElectricalPin", "modelica", "");
  assert.equal(dropRes.className, "PSCAD.Interfaces.ElectricalPin");
  assert.equal(dropRes.stubName, undefined);
  assert.equal(dropRes.stubBlock, undefined);
});

test("Polyglot Modelica + PSCAD detection and MultiRateCosimOrchestrator simulation", async () => {
  await ensureModelicaParser();
  const uw = new UnifiedWorkspace([pscadLanguage, psseLanguage]);

  const pscxUri = "file:///workspace/InverterLeaf.pscx";
  const pscxText = `<project name="InverterLeaf" version="5.0">
  <definitions>
    <Definition classid="UserCmpDefn" name="Main" id="1">
      <schematic id="2">
        <User classid="UserCmp" id="10" name="master:source_3" defn="master:source_3" x="0" y="0">
          <paramlist><param name="Name" value="GridSrc" /><param name="Vm" value="13.8" /></paramlist>
        </User>
      </schematic>
    </Definition>
  </definitions>
</project>`;
  uw.setDocument(pscxUri, pscxText);

  const moUri = "file:///workspace/Controller.mo";
  const moText = `model PiController
  parameter Real kp = 1.5;
  parameter Real u = 1.0;
  Real y(start = 0.0);
equation
  der(y) = kp * (u - y);
end PiController;
`;

  const hostMoUri = "file:///workspace/System.mo";
  const hostMoText = `model System
  PSCAD.Interfaces.ElectricalPin pcc;
  PiController ctrl;
equation
end System;
`;
  const plan = detectPolyglotPlan(uw, hostMoUri, hostMoText);
  assert.ok(plan, "detectPolyglotPlan must detect direct PSCAD reference in Modelica");
  assert.equal(plan.kind, "modelica-pscad");

  const ctx = new ModelicaContext();
  ctx.load(moText, moUri);
  const dae = ctx.flattenArena("PiController", undefined, moUri);
  assert.ok(dae, "Modelica PiController must flatten to DAEBuilder");

  const simRes = await runModelicaPscadCosim({
    modelicaDae: dae,
    pscadText: pscxText,
    stopTime: 0.05,
    dtSlowSec: 1e-3,
    dtFastSec: 50e-6,
  });

  assert.ok(simRes.t.length >= 40, `Expected >= 40 macro steps, got ${simRes.t.length}`);
  assert.equal(simRes.telemetry.mode, "polyglot-multi-rate-cosim(modelica+pscad)");
  assert.ok(simRes.states.some((s) => s.includes("V_rms")));
  assert.ok(simRes.states.includes("y"), `Expected Modelica state 'y' in ${JSON.stringify(simRes.states)}`);
  for (const row of simRes.y) {
    for (const v of row) {
      assert.ok(Number.isFinite(v), `Expected finite trajectory value, got ${v}`);
    }
  }
});

test("3-way PSS/E + PSCAD + Modelica hybrid co-simulation via HybridEmtTsCoordinator", async () => {
  await ensureModelicaParser();
  const rawText = [
    "0, 100.0, 33, 0, 0, 60.0 / IEEE 2-BUS",
    "TEST CASE",
    "1, 'SLACK', 230.0, 3, 1, 1, 1, 1.02, 0.0",
    "2, 'PCC',   230.0, 1, 1, 1, 1, 1.00, -2.0",
    "0 / END OF BUS DATA, BEGIN LOAD DATA",
    "2, '1 ', 1, 1, 1, 50.0, 10.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0",
    "0 / END OF LOAD DATA, BEGIN FIXED SHUNT DATA",
    "0 / END OF FIXED SHUNT DATA, BEGIN GENERATOR DATA",
    "1, '1 ', 60.0, 10.0, 100.0, -50.0, 1.02, 0, 100.0, 0.0, 0.2, 0.0, 0.0, 1.0, 1, 100.0, 100.0, 0.0",
    "0 / END OF GENERATOR DATA, BEGIN BRANCH DATA",
    "1, 2, '1 ', 0.002, 0.02, 0.0, 100.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1",
    "0 / END OF BRANCH DATA",
  ].join("\n");

  const psseCase = parseRaw(rawText);
  const moText = `model SupervisoryCtrl
  Real v_ref(start = 1.0);
equation
  der(v_ref) = -0.5 * (v_ref - 1.02);
end SupervisoryCtrl;
`;
  const ctx = new ModelicaContext();
  ctx.load(moText, "file:///workspace/SupervisoryCtrl.mo");
  const dae = ctx.flattenArena("SupervisoryCtrl", undefined, "file:///workspace/SupervisoryCtrl.mo");
  assert.ok(dae);

  const pscadIslandXml = `<project name="EmtIsland" version="5.0">
  <definitions>
    <Definition classid="UserCmpDefn" name="Main" id="1">
      <schematic id="2">
        <User classid="UserCmp" id="10" name="master:source_3" defn="master:source_3" x="0" y="0">
          <paramlist><param name="Name" value="GridSrc" /><param name="Vm" value="230.0" /></paramlist>
        </User>
      </schematic>
    </Definition>
  </definitions>
</project>`;

  const simRes = await runHybridPssePscadModelicaCosim({
    psseCase,
    pscadText: pscadIslandXml,
    boundaryBusNumber: 2,
    modelicaDae: dae,
    stopTime: 0.04,
    dtTsSec: 1e-3,
    dtEmtSec: 20e-6,
  });

  assert.ok(simRes.t.length >= 30);
  assert.equal(simRes.telemetry.mode, "polyglot-hybrid-emt-ts-modelica");
  assert.ok(simRes.states.some((s) => s.startsWith("TS.")));
  assert.ok(simRes.states.some((s) => s.startsWith("EMT.")));
  assert.ok(simRes.states.some((s) => s.startsWith("PSSE.")));
  assert.ok(simRes.states.some((s) => s.startsWith("Modelica.")));
  for (const row of simRes.y) {
    for (const v of row) {
      assert.ok(Number.isFinite(v), `Expected finite 3-way trajectory value, got ${v}`);
    }
  }

  const coupledMo = `model GridCoupled
  GRID_CASE.Bus_2 pccBus;
  PSCAD.Interfaces.ElectricalPin emtPin;
  SupervisoryCtrl ctrl;
equation
  connect(pccBus.v_pu, emtPin);
  connect(emtPin, ctrl.v_ref);
end GridCoupled;
`;
  const bindings = extractPolyglotBoundaryBindings(coupledMo, psseCase);
  assert.equal(bindings.boundaryBusNumber, 2);
  assert.ok(bindings.signalBindings.some((b) => b.modelicaVar === "ctrl.v_ref" && b.pscadSignal === "emtPin"));
});
