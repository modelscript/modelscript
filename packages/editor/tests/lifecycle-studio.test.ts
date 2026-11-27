// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runLocalModalityCertification } from "../src/workbench/panels/AnsatzLifecycleStudioSections.js";
import { EdgeOpfsMiniDiskAnn } from "../src/workbench/util/opfs-mini-diskann.js";
import { createInitialZonotopeWorkbenchState } from "../src/workbench/util/zonotope-workbench-state.js";

describe("Ansatz AI Lifecycle Studio — Local Certification & OPFS Edge Cache", () => {
  it("certifies a valid Modelica model and produces a renaming-invariant physical fingerprint", () => {
    const state = createInitialZonotopeWorkbenchState();
    const m1 = `model ThermalRC
  parameter Real R = 10.0;
  parameter Real C = 2.0;
equation
  der(T) = -T / (R * C);
end ThermalRC;`;
    const m2 = `model HeatLoop
  parameter Real res = 100.0;
  parameter Real cap = 20.0;
equation
  der(temp) = -temp / (res * cap);
end HeatLoop;`;

    const c1 = runLocalModalityCertification(m1, "modelica", null, state);
    const c2 = runLocalModalityCertification(m2, "modelica", null, state);

    assert.equal(c1.modality, "code");
    assert.equal(c1.passed, true);
    assert.equal(c1.gate1Syntax, true);
    assert.equal(c1.gate2Units, true);
    assert.equal(c1.gate3Smt, true);
    assert.equal(c1.gate4Dae, true);
    assert.equal(c1.physicalFingerprint, c2.physicalFingerprint);
  });

  it("detects infeasible GD&T linear constraints and WAM passivity violations", () => {
    const base = createInitialZonotopeWorkbenchState();
    const cadInfeasible = {
      ...base,
      constraints: [
        {
          id: "gdt-impossible",
          expression: "clearance <= -5",
          coeffs: { clearance: 1 },
          sense: "<=" as const,
          rhs: -5,
          modality: "3d" as const,
        },
      ],
    };
    const cadCert = runLocalModalityCertification("cube([10, 10, 5]);", "scad", null, cadInfeasible);
    assert.equal(cadCert.modality, "cad");
    assert.equal(cadCert.gdtFeasible, false);
    assert.equal(cadCert.passed, false);

    const wamUnstable = { ...base, stressScale: 3.0 };
    const wamCert = runLocalModalityCertification("<robot name='arm'/>", "urdf", null, wamUnstable);
    assert.equal(wamCert.modality, "wam");
    assert.equal(wamCert.passivityViolated, true);
    assert.equal(wamCert.passed, false);
  });

  it("indexes and retrieves verified engineering chunks from EdgeOpfsMiniDiskAnn", () => {
    const cache = new EdgeOpfsMiniDiskAnn(64);
    cache.upsert({
      chunkId: "fix-1",
      sourceUri: "ansatz://thermal-pid.mo",
      dialect: "modelica",
      content: "parameter Real Kp = 2.5; parameter Real Ti = 0.4; // verified PID tuning",
      symbolTags: ["modelica", "Kp", "PID"],
      formalVerified: true,
    });
    cache.upsert({
      chunkId: "fix-2",
      sourceUri: "ansatz://bracket.scad",
      dialect: "scad",
      content: "module bracket(t=4) { cube([40, 20, t]); }",
      symbolTags: ["scad", "bracket"],
      formalVerified: false,
    });
    assert.equal(cache.size(), 2);

    const hits = cache.query("PID Kp modelica", { dialect: "modelica", topK: 3 });
    assert.ok(hits.length >= 1);
    assert.equal(hits[0]!.chunkId, "fix-1");
    assert.equal(hits[0]!.formalVerified, true);
  });
});
