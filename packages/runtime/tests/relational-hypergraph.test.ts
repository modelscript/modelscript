// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyHypergraphOverrides,
  bucketHypergraphExamples,
  compileRelationalHypergraph,
  RelTypeId,
} from "../src/index.js";

describe("4-Column Typed Relational Hypergraph Compiler (Dynamic-m Zonotope Front-End)", () => {
  it("compiles Modelica with locked keywords, shared group_ids, flow conservation, and unit scaling", () => {
    const source = `
model RC
  parameter Real R(unit = "Ohm") = 100.0;
  Real v;
equation
  v = R * i;
  connect(res.p, cap.n);
end RC;
`;
    const record = compileRelationalHypergraph({
      source,
      uri: "memory://rc.mo",
      dialect: "modelica",
    });

    // All 4 parallel columns + spans must be strictly aligned
    assert.equal(record.tokenIds.length, record.groupIds.length);
    assert.equal(record.tokenIds.length, record.relTypeIds.length);
    assert.equal(record.tokenIds.length, record.relSigns.length);
    assert.equal(record.tokenIds.length, record.spans.length);
    assert.ok(record.mInit >= 4, `Expected mInit >= 4, got ${record.mInit}`);

    // Syntax keywords like `model`, `equation`, `end` must be locked to group_id = 0
    const modelSpan = record.spans.find((s) => s.text === "model");
    const eqSpan = record.spans.find((s) => s.text === "equation");
    assert.equal(modelSpan?.groupId, 0);
    assert.equal(eqSpan?.groupId, 0);
    assert.equal(modelSpan?.relSign, 0);

    // All occurrences of `R` must share the exact same non-zero groupId
    const rSpans = record.spans.filter((s) => s.text === "R");
    assert.equal(rSpans.length, 2);
    assert.ok(rSpans[0]!.groupId > 0);
    assert.equal(rSpans[0]!.groupId, rSpans[1]!.groupId);
    assert.equal(rSpans[0]!.relTypeId, RelTypeId.IDENTITY_SYNC);

    // connect(res.p, cap.n) must emit FLOW_CONSERVATION with +1.0 and -1.0 signs on the same generator
    const resFlow = record.spans.find((s) => s.text === "res");
    const capFlow = record.spans.find((s) => s.text === "cap");
    assert.ok(resFlow && capFlow);
    assert.equal(resFlow.relTypeId, RelTypeId.FLOW_CONSERVATION);
    assert.equal(capFlow.relTypeId, RelTypeId.FLOW_CONSERVATION);
    assert.equal(resFlow.groupId, capFlow.groupId);
    assert.equal(resFlow.relSign, 1.0);
    assert.equal(capFlow.relSign, -1.0);

    // SI unit string `"Ohm"` must be tagged UNIT_SCALE
    const ohmSpan = record.spans.find((s) => s.text === '"Ohm"');
    assert.ok(ohmSpan);
    assert.equal(ohmSpan.relTypeId, RelTypeId.UNIT_SCALE);
  });

  it("compiles OpenSCAD CAD with GDT_TOLERANCE_CONE and INVERSE_COUPLE signs", () => {
    const source = `
wall_thickness = 2.5;
hole_radius = 4.0;
difference() {
  cube([20, 20, wall_thickness]);
  translate([-hole_radius, hole_radius, 0]) cylinder(r = hole_radius, h = 5);
}
`;
    const record = compileRelationalHypergraph({
      source,
      uri: "memory://bracket.scad",
      dialect: "scad",
    });

    const wallSpans = record.spans.filter((s) => s.text === "wall_thickness");
    assert.equal(wallSpans.length, 2);
    assert.equal(wallSpans[0]!.relTypeId, RelTypeId.GDT_TOLERANCE_CONE);
    assert.equal(wallSpans[0]!.groupId, wallSpans[1]!.groupId);

    const holeSpans = record.spans.filter((s) => s.text === "hole_radius");
    assert.ok(holeSpans.length >= 3);
    // The `-hole_radius` occurrence must carry INVERSE_COUPLE with sign -1.0 while keeping the same groupId
    const negHole = holeSpans.find((s) => s.relSign === -1.0);
    assert.ok(negHole, "Expected negated -hole_radius to have relSign = -1.0");
    assert.equal(negHole.relTypeId, RelTypeId.INVERSE_COUPLE);
    assert.equal(negHole.groupId, holeSpans[0]!.groupId);
  });

  it("compiles English Markdown + YAML frontmatter + OWL2 ontology subsumption cones", () => {
    const source = `---
symbols: [ThermalCapacitor, HeatPort]
ontology_isa: ThermalCapacitor is_a EnergyStorage
---
ThermalCapacitor is a EnergyStorage component connected via HeatPort.
ThermalCapacitor stores heat through HeatPort.
`;
    const record = compileRelationalHypergraph({
      source,
      uri: "memory://thermal.md",
      dialect: "markdown",
    });

    // Stopwords like `is`, `a`, `via` must remain locked (group_id = 0)
    const viaSpan = record.spans.find((s) => s.text === "via");
    assert.equal(viaSpan?.groupId, 0);

    // ThermalCapacitor must be tagged with ONTOLOGY_ISA subsumption cone
    const capSpans = record.spans.filter((s) => s.text === "ThermalCapacitor");
    assert.ok(capSpans.length >= 2);
    assert.equal(capSpans[0]!.relTypeId, RelTypeId.ONTOLOGY_ISA);
    assert.equal(capSpans[0]!.ontologyIri, "owl:EnergyStorage");
    assert.equal(capSpans[0]!.groupId, capSpans[1]!.groupId);
  });

  it("applies interactive annotator overrides and recomputes mInit cleanly", () => {
    const base = compileRelationalHypergraph({
      source: "model M Real x; Real y; equation x = y; end M;",
      dialect: "modelica",
    });
    const prevM = base.mInit;

    const updated = applyHypergraphOverrides(base, [
      { symbolName: "x", groupId: 0 }, // Lock x as invariant syntax/safety token
      {
        symbolName: "y",
        relTypeId: RelTypeId.GDT_TOLERANCE_CONE,
        relSign: -1,
        toleranceSpec: { lower: -0.5, upper: 0.5, unit: "mm" },
      },
    ]);

    assert.equal(updated.mInit, prevM - 1);
    for (const s of updated.spans.filter((sp) => sp.text === "x")) {
      assert.equal(s.groupId, 0);
      assert.equal(s.relTypeId, RelTypeId.NONE);
      assert.equal(s.relSign, 0);
    }
    const yGroup = updated.groups.find((g) => g.symbolName === "y");
    assert.ok(yGroup);
    assert.deepEqual(yGroup.toleranceSpec, { lower: -0.5, upper: 0.5, unit: "mm" });
  });

  it("buckets examples by mInit for zero-waste Dynamic-m GPU batching", () => {
    const tiny1 = compileRelationalHypergraph({ source: "model A Real x; end A;", dialect: "modelica" });
    const tiny2 = compileRelationalHypergraph({ source: "model B Real y; end B;", dialect: "modelica" });
    const complex1 = compileRelationalHypergraph({
      source: "model C Real a; Real b; Real c; Real d; Real e; Real f; Real g; end C;",
      dialect: "modelica",
    });
    const complex2 = compileRelationalHypergraph({
      source: "model D Real h; Real i; Real j; Real k; Real l; Real m; Real n; Real o; end D;",
      dialect: "modelica",
    });

    const buckets = bucketHypergraphExamples([complex2, tiny1, complex1, tiny2], 2, 32);
    assert.equal(buckets.length, 2);
    assert.ok(buckets[0]!.mBatchMax < buckets[1]!.mBatchMax);
    assert.equal(buckets[0]!.examples.length, 2);
    assert.equal(buckets[1]!.examples.length, 2);
  });
});
