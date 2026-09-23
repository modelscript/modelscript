// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SysML2ActivityVerifier } from "../src/activity-verifier.js";

describe("SysML v2 Activity BMC & k-Induction Formal Verifier", () => {
  it("should certify safety when hazard action is unreachable", () => {
    const sysml = `
      action Start;
      action ProcessNormal;
      action HazardAction #hazard;

      first Start then ProcessNormal;
    `;

    const res = SysML2ActivityVerifier.verify(sysml, { boundK: 10 });
    assert.strictEqual(res.isCertified, true);
    assert.strictEqual(res.violationTrace, undefined);
    assert.ok(res.summary.includes("passed"));
  });

  it("should detect safety violation and produce counterexample trace when hazard action is reached", () => {
    const sysml = `
      action Start;
      action TransitionStep;
      action CriticalHazard #hazard;

      first Start then TransitionStep;
      first TransitionStep then CriticalHazard;
    `;

    const res = SysML2ActivityVerifier.verify(sysml, { boundK: 5 });
    assert.strictEqual(res.isCertified, false);
    assert.ok(res.violationTrace !== undefined);
    assert.ok(res.violationTrace!.length > 0);
    assert.ok(res.summary.includes("Safety violation detected"));
  });

  it("should prove safety using k-induction", () => {
    const sysml = `
      action Init;
      action LoopA;
      action LoopB;
      action DangerousState #hazard;

      first Init then LoopA;
      first LoopA then LoopB;
      first LoopB then LoopA;
    `;

    const res = SysML2ActivityVerifier.verify(sysml, { useKInduction: true, boundK: 5 });
    assert.strictEqual(res.isCertified, true);
    assert.strictEqual(res.method, "k-induction");
    assert.ok(res.summary.includes("certified"));
  });
});
