// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintTwentySim, runScap } from "../src/lints/index.js";
import { parseTwentySim } from "../src/parser/index.js";

describe("20-sim SCAP Causality & Semantic Lints", () => {
  it("passes cleanly on a well-posed Mass-Spring-Damper bond graph with integral causality", () => {
    const sid = `
model CleanMSD
  submodels
    Se F (effort = 10);
    OneJunction j1;
    I m (i = 2);
    R b (r = 1);
    C k (c = 0.5);
  connections
    F.p => j1.p;
    j1.p => m.p;
    j1.p => b.p;
    j1.p => k.p;
end CleanMSD;
`;
    const model = parseTwentySim(sid);
    const scap = runScap(model.root);
    assert.strictEqual(scap.conflicts.length, 0);
    assert.strictEqual(scap.derivativeCausality.length, 0);

    const diags = lintTwentySim(model);
    assert.strictEqual(diags.length, 0, `Expected 0 diagnostics, got: ${diags.map((d) => d.message).join("; ")}`);
  });

  it("reports TS4001 SCAP causality conflict when two Se sources drive the same 0-junction", () => {
    const sid = `
model ConflictEffort
  submodels
    Se V1 (effort = 5);
    Se V2 (effort = 10);
    ZeroJunction j0;
    R load (r = 2);
  connections
    V1.p => j0.p;
    V2.p => j0.p;
    j0.p => load.p;
end ConflictEffort;
`;
    const diags = lintTwentySim(sid);
    assert.ok(
      diags.some((d) => d.id === "TS4001"),
      "Expected TS4001 causality conflict",
    );
  });

  it("reports TS4002 derivative causality warning when two I elements share a 1-junction", () => {
    const sid = `
model DependentInertias
  submodels
    Se F (effort = 5);
    OneJunction j1;
    I m1 (i = 1);
    I m2 (i = 2);
    R b (r = 0.5);
  connections
    F.p => j1.p;
    j1.p => m1.p;
    j1.p => m2.p;
    j1.p => b.p;
end DependentInertias;
`;
    const diags = lintTwentySim(sid);
    assert.ok(
      diags.some((d) => d.id === "TS4002"),
      "Expected TS4002 derivative causality warning",
    );
  });

  it("reports TS2001 unresolved reference and TS5001 unconnected power port", () => {
    const sid = `
model BrokenRefs
  submodels
    Se F (effort = 5);
    R b (r = 1);
  connections
    F.p => Ghost.p;
end BrokenRefs;
`;
    const diags = lintTwentySim(sid);
    assert.ok(
      diags.some((d) => d.id === "TS2001"),
      "Expected TS2001 unresolved reference",
    );
    assert.ok(
      diags.some((d) => d.id === "TS5001"),
      "Expected TS5001 unconnected power port",
    );
  });

  it("reports TS3001 port kind mismatch and TS4003 signal algebraic loop", () => {
    const xml = `<?xml version="1.0"?>
<Document version="5.1">
  <Model name="SignalLoop">
    <Submodels>
      <Submodel name="A" type="Signal">
        <Ports>
          <Port name="in" type="signal" direction="in"/>
          <Port name="out" type="signal" direction="out"/>
        </Ports>
      </Submodel>
      <Submodel name="B" type="Signal">
        <Ports>
          <Port name="in" type="signal" direction="in"/>
          <Port name="out" type="signal" direction="out"/>
        </Ports>
      </Submodel>
      <Submodel name="R1" type="R"/>
    </Submodels>
    <Connections>
      <Connection id="s1" type="signal" from="A.out" to="B.in"/>
      <Connection id="s2" type="signal" from="B.out" to="A.in"/>
      <Connection id="bad" type="bond" from="R1.p" to="A.in"/>
    </Connections>
  </Model>
</Document>`;
    const diags = lintTwentySim(xml);
    assert.ok(
      diags.some((d) => d.id === "TS3001"),
      "Expected TS3001 port kind mismatch",
    );
    assert.ok(
      diags.some((d) => d.id === "TS4003"),
      "Expected TS4003 algebraic loop",
    );
  });
});
