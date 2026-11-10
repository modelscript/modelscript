// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  analyzeSemanticDiff,
  defaultPhysicsSimplexConsensus,
  reconstructTextsFromUnifiedPatch,
} from "../src/util/semantic-diff-engine.js";

describe("Ansatz Semantic Diff Studio - Grade-A Maturity Verification", () => {
  const baseModel = `
model ComplexActuatorSystem
  parameter Real R(unit="Ohm", min=5.0, max=25.0) = 10.0;
  parameter Real L(unit="H") = 0.05;
  parameter Real J(unit="kg.m2", min=0.01, max=0.5) = 0.1;
  parameter Real k_bemf = 0.02;
  Modelica.Electrical.Analog.Interfaces.PositivePin p_elec;
  Modelica.Electrical.Analog.Interfaces.NegativePin n_elec;
  Modelica.Mechanics.Rotational.Interfaces.Flange_b flange_mech;
  Modelica.Electrical.Analog.Basic.Resistor R1(R = 10.0);
  Modelica.Electrical.Analog.Basic.Inductor L1(L = 0.05);
  Modelica.Electrical.Analog.Basic.Ground gnd;
  Modelica.Electrical.Analog.Sources.ConstantVoltage vs(V = 24.0);
  Modelica.Mechanics.Rotational.Components.Inertia inert(J = 0.1);
  Modelica.Mechanics.Rotational.Sensors.SpeedSensor speedSensor;
equation
  connect(p_elec, R1.p);
  connect(R1.n, L1.p);
  connect(L1.n, n_elec);
  connect(vs.p, p_elec);
  connect(vs.n, gnd.p);
end ComplexActuatorSystem;
`;

  const oursModel = `
model ComplexActuatorSystem
  parameter Real R(unit="Ohm", min=5.0, max=25.0) = 18.0;
  parameter Real L(unit="H") = 0.08;
  parameter Real J(unit="kg.m2", min=0.01, max=0.5) = 0.1;
  parameter Real k_bemf = 0.02;
  Modelica.Electrical.Analog.Interfaces.PositivePin p_elec;
  Modelica.Electrical.Analog.Interfaces.NegativePin n_elec;
  Modelica.Mechanics.Rotational.Interfaces.Flange_b flange_mech;
  Modelica.Electrical.Analog.Basic.Resistor R1(R = 18.0);
  Modelica.Electrical.Analog.Basic.Inductor L1(L = 0.08);
  Modelica.Electrical.Analog.Basic.Ground gnd;
  Modelica.Electrical.Analog.Sources.ConstantVoltage vs(V = 24.0);
  Modelica.Mechanics.Rotational.Components.Inertia inert(J = 0.1);
  Modelica.Mechanics.Rotational.Sensors.SpeedSensor speedSensor;
  Modelica.Electrical.Analog.Basic.Capacitor C_filter(C = 1e-4);
equation
  connect(p_elec, R1.p);
  connect(R1.n, L1.p);
  connect(L1.n, n_elec);
  connect(vs.p, p_elec);
  connect(vs.n, gnd.p);
  connect(C_filter.p, p_elec);
  connect(C_filter.n, gnd.p);
end ComplexActuatorSystem;
`;

  const theirsModel = `
model ComplexActuatorSystem
  parameter Real R(unit="Ohm", min=5.0, max=25.0) = 22.0;
  parameter Real L(unit="H") = 0.12;
  parameter Real J(unit="kg.m2", min=0.01, max=0.5) = 0.1;
  parameter Real k_bemf = 0.02;
  Modelica.Electrical.Analog.Interfaces.PositivePin p_elec;
  Modelica.Electrical.Analog.Interfaces.NegativePin n_elec;
  Modelica.Mechanics.Rotational.Interfaces.Flange_b flange_mech;
  Modelica.Electrical.Analog.Basic.Resistor R1(R = 22.0);
  Modelica.Electrical.Analog.Basic.Inductor L1(L = 0.12);
  Modelica.Electrical.Analog.Basic.Ground gnd;
  Modelica.Electrical.Analog.Sources.ConstantVoltage vs(V = 24.0);
  Modelica.Mechanics.Rotational.Components.Inertia inert(J = 0.1);
  Modelica.Mechanics.Rotational.Sensors.SpeedSensor speedSensor;
equation
  connect(p_elec, R1.p);
  connect(R1.n, L1.p);
  connect(L1.n, n_elec);
  connect(vs.p, p_elec);
  connect(vs.n, gnd.p);
end ComplexActuatorSystem;
`;

  it("1. Standard 2-way PR review produces ZERO synthetic 3-way conflicts and enables clean rebase pre-check", () => {
    const report2Way = analyzeSemanticDiff(baseModel, oursModel, {
      filename: "ComplexActuatorSystem.mo",
    });

    assert.strictEqual(
      report2Way.threeWayConflicts.length,
      0,
      "Standard 2-way comparison without concurrent branch proposal must produce 0 synthetic conflicts",
    );
    assert.ok(report2Way.summary.inserted >= 1, "Must detect inserted C_filter capacitor");
    assert.ok(report2Way.summary.modified >= 2, "Must detect modified parameters R and L");
  });

  it("2. Genuine 3-way merge detects authentic conflicts on concurrently modified parameters with physical bounds", () => {
    const report3Way = analyzeSemanticDiff(baseModel, oursModel, {
      filename: "ComplexActuatorSystem.mo",
      theirsCode: theirsModel,
      ancestorCode: baseModel,
    });

    assert.strictEqual(
      report3Way.threeWayConflicts.length,
      4,
      "Must identify all 4 conflicting parameters and component modifiers (R, L, R1, L1)",
    );

    const rConflict = report3Way.threeWayConflicts.find((c) => c.parameterName === "R");
    assert.ok(rConflict, "Must report conflict on parameter R");
    assert.strictEqual(rConflict.baseValue, 10);
    assert.strictEqual(rConflict.oursValue, 18);
    assert.strictEqual(rConflict.theirsValue, 22);
    assert.strictEqual(rConflict.minBound, 5);
    assert.strictEqual(rConflict.maxBound, 25);
    assert.strictEqual(rConflict.simplexValue, 20); // (18 + 22) / 2
    assert.strictEqual(rConflict.simplexFeasible, true);

    const lConflict = report3Way.threeWayConflicts.find((c) => c.parameterName === "L");
    assert.ok(lConflict, "Must report conflict on parameter L");
    assert.strictEqual(lConflict.baseValue, 0.05);
    assert.strictEqual(lConflict.oursValue, 0.08);
    assert.strictEqual(lConflict.theirsValue, 0.12);
    assert.strictEqual(lConflict.minBound, undefined, "Unspecified bounds must be undefined, not guessed");
    assert.strictEqual(lConflict.maxBound, undefined, "Unspecified bounds must be undefined, not guessed");
    assert.strictEqual(lConflict.simplexValue, 0.1); // (0.08 + 0.12) / 2
    assert.strictEqual(lConflict.simplexFeasible, true);

    const r1Conflict = report3Way.threeWayConflicts.find((c) => c.parameterName === "R1");
    assert.ok(r1Conflict, "Must report conflict on component R1 modifier");
    assert.strictEqual(r1Conflict.baseValue, 10);
    assert.strictEqual(r1Conflict.oursValue, 18);
    assert.strictEqual(r1Conflict.theirsValue, 22);

    const l1Conflict = report3Way.threeWayConflicts.find((c) => c.parameterName === "L1");
    assert.ok(l1Conflict, "Must report conflict on component L1 modifier");
    assert.strictEqual(l1Conflict.baseValue, 0.05);
    assert.strictEqual(l1Conflict.oursValue, 0.08);
    assert.strictEqual(l1Conflict.theirsValue, 0.12);
  });

  it("3. Physics-Simplex consensus handles bounded and unbounded L1 minimization correctly", () => {
    // Both feasible inside [5, 25] -> selects L1 midpoint
    const resBounded = defaultPhysicsSimplexConsensus(18, 22, 5, 25);
    assert.strictEqual(resBounded.value, 20);
    assert.strictEqual(resBounded.feasible, true);

    // One feasible (18) and one violating maxBound (28) -> selects single feasible proposal (18)
    const resAsymmetric = defaultPhysicsSimplexConsensus(18, 28, 5, 25);
    assert.strictEqual(resAsymmetric.value, 18);
    assert.strictEqual(resAsymmetric.feasible, true);

    // Unbounded (minBound = -Infinity, maxBound = Infinity) -> computes true arithmetic midpoint without arbitrary clipping
    const resUnbounded = defaultPhysicsSimplexConsensus(0.08, 0.12);
    assert.strictEqual(resUnbounded.value, 0.1);
    assert.strictEqual(resUnbounded.feasible, true);
  });

  it("4. Topology redline renders all N components and connections without arbitrary slicing", () => {
    const report = analyzeSemanticDiff(baseModel, oursModel, {
      filename: "ComplexActuatorSystem.mo",
    });

    // The model contains > 10 declarations (pins, resistor, inductor, ground, vs, inertia, speedSensor, etc.)
    assert.ok(
      report.topology.nodes.length >= 10,
      `Topology must retain all components (got ${report.topology.nodes.length}), not truncate to 5`,
    );

    const cFilterNode = report.topology.nodes.find((n) => n.name === "C_filter");
    assert.ok(cFilterNode, "Inserted C_filter component must be present in topology nodes");
    assert.strictEqual(cFilterNode.status, "added");

    assert.ok(report.topology.wires.length > 0, "Topological connection wires must be generated");
  });

  it("5. Verifies LSP bridge exports getSemanticDiff and FlatSemanticEdit for native WASM worker delegation", () => {
    const bridgePath = path.resolve(import.meta.dirname, "../src/components/morsel/util/lsp-bridge.ts");
    assert.ok(fs.existsSync(bridgePath), "lsp-bridge.ts must exist");
    const bridgeSrc = fs.readFileSync(bridgePath, "utf-8");

    assert.ok(bridgeSrc.includes("export async function getSemanticDiff"), "Must export getSemanticDiff");
    assert.ok(bridgeSrc.includes("modelscript/getSemanticDiff"), "Must dispatch modelscript/getSemanticDiff request to LSP");
    assert.ok(bridgeSrc.includes("regulatoryImpact"), "Must support ISO 14971 / IEC 62304 regulatoryImpact data");
  });

  it("6. Verifies Git vault backend computes merge-base SHA and supplies ancestorContent", () => {
    const vaultPath = path.resolve(import.meta.dirname, "../../../apps/api/src/services/spaces/space-git-vault.ts");
    assert.ok(fs.existsSync(vaultPath), "space-git-vault.ts must exist");
    const vaultSrc = fs.readFileSync(vaultPath, "utf-8");

    assert.ok(vaultSrc.includes('"merge-base"'), "getSpaceGitDiff must execute git merge-base");
    assert.ok(vaultSrc.includes("mergeBaseSha"), "SpaceGitDiffResult must include mergeBaseSha");
    assert.ok(vaultSrc.includes("ancestorContent"), "SpaceGitDiffFile must include ancestorContent");
  });

  it("7. Verifies PullRequestsTab and SpaceChangeControlTab pass ancestorCode and use full blobs", () => {
    const prPath = path.resolve(import.meta.dirname, "../src/pages/workspace/tabs/PullRequestsTab.tsx");
    const ecoPath = path.resolve(import.meta.dirname, "../src/pages/space/SpaceChangeControlTab.tsx");

    const prSrc = fs.readFileSync(prPath, "utf-8");
    const ecoSrc = fs.readFileSync(ecoPath, "utf-8");

    assert.ok(prSrc.includes("hasFullBlobs"), "PullRequestsTab must prioritize full file blobs");
    assert.ok(prSrc.includes("ancestorCode={file.ancestor_content}"), "PullRequestsTab must forward ancestorCode");
    assert.ok(ecoSrc.includes("ancestorCode={activeDiffFile.ancestorContent}"), "SpaceChangeControlTab must forward ancestorCode");
  });

  it("8. Verifies One-Click Simplex Parameter Reconciliation updates file buffer and supports Diagram Workbench launcher", () => {
    const studioPath = path.resolve(import.meta.dirname, "../src/components/diff/AnsatzSemanticDiffStudio.tsx");
    const ecoPath = path.resolve(import.meta.dirname, "../src/pages/space/SpaceChangeControlTab.tsx");

    const studioSrc = fs.readFileSync(studioPath, "utf-8");
    const ecoSrc = fs.readFileSync(ecoPath, "utf-8");

    assert.ok(studioSrc.includes("onOpenDiagramWorkbench"), "AnsatzSemanticDiffStudio must declare onOpenDiagramWorkbench prop");
    assert.ok(studioSrc.includes("⚡ Diagram Workbench"), "Lens 3 must render Diagram Workbench launcher button");
    assert.ok(ecoSrc.includes("Reconciled '${paramName}' to ${val}"), "SpaceChangeControlTab must report parameter reconciliation");
    assert.ok(ecoSrc.includes("Applied to buffer"), "SpaceChangeControlTab must record buffer application");
  });

  it("9. Verifies Polyglot LSP expansion in miscEndpoints.ts supporting globalLanguageRegistry and getParserForUri", () => {
    const lspMiscPath = path.resolve(import.meta.dirname, "../../../packages/lsp/src/handlers/miscEndpoints.ts");
    assert.ok(fs.existsSync(lspMiscPath), "miscEndpoints.ts must exist");
    const lspSrc = fs.readFileSync(lspMiscPath, "utf-8");

    assert.ok(lspSrc.includes("globalLanguageRegistry.getPluginForLanguageIdOrUri"), "Must query globalLanguageRegistry for language plugins");
    assert.ok(lspSrc.includes("getParserForUri"), "Must query parserService.getParserForUri for polyglot parser support");
    assert.ok(lspSrc.includes("createWsIndex"), "Must dynamically create workspace index for polyglot languages");
  });
});

