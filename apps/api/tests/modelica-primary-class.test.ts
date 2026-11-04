// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { preprocessModelicaArtifact } from "../src/services/modelica-artifact-renderer.js";

const SOURCE = `model A
  Real x;
equation
  der(x) = 1;
end A;

model B
  A a1;
  A a2;
end B;
`;

describe("preprocessModelicaArtifact primaryClass hint", () => {
  it("defaults to the first class in the file", async () => {
    assert.equal((await preprocessModelicaArtifact(SOURCE, "t")).className, "A");
  });

  it("renders the requested class, matching the last segment of a dotted name", async () => {
    assert.equal((await preprocessModelicaArtifact(SOURCE, "t", { primaryClass: "B" })).className, "B");
    assert.equal((await preprocessModelicaArtifact(SOURCE, "t", { primaryClass: "Pkg.B" })).className, "B");
  });

  it("falls back to the first class in the file when the hint matches nothing", async () => {
    assert.equal((await preprocessModelicaArtifact(SOURCE, "t", { primaryClass: "Nope" })).className, "A");
  });
});
