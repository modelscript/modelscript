// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateReferenceEndf6Tape } from "../src/catalog/reference-tapes.js";
import { parseEndf6Tape } from "../src/parser/tape-parser.js";
import { endf6ToCsv, endf6ToMcnpMaterial, endf6ToScaleComposition } from "../src/projections/index.js";

describe("ENDF-6 Polyglot Projections (MCNP, SCALE, CSV)", () => {
  it("projects an ENDF-6 tape to an MCNP Mn material card", () => {
    const tape = parseEndf6Tape(generateReferenceEndf6Tape("U-235"));
    const mcnp = endf6ToMcnpMaterial(tape, { materialNumber: 10, librarySuffix: "80c" });

    assert.ok(mcnp.includes("M10"), "Expected M10 card");
    assert.ok(mcnp.includes("92235.80c"), "Expected ZAID 92235.80c");
    assert.ok(mcnp.includes("U-235"), "Expected U-235 comment");
  });

  it("projects an ENDF-6 tape to a SCALE standard composition block", () => {
    const tape = parseEndf6Tape(generateReferenceEndf6Tape("Pu-239"));
    const scale = endf6ToScaleComposition(tape, { mixtureId: 3, temperatureK: 600.0 });

    assert.ok(scale.includes("read comp"));
    assert.ok(scale.includes("pu-239 3 0"));
    assert.ok(scale.includes("600.0"));
    assert.ok(scale.includes("end comp"));
  });

  it("projects MF=3 pointwise cross-sections to RFC-4180 CSV", () => {
    const tape = parseEndf6Tape(generateReferenceEndf6Tape("B-10"));
    const csv = endf6ToCsv(tape, { mts: [1, 102] });
    const lines = csv.trim().split("\n");

    assert.equal(lines[0], "mat,za,nuclide,mt,energy_eV,sigma_barns");
    // 2 MTs * 6 points + 1 header = 13 lines
    assert.equal(lines.length, 13);
    assert.ok(lines.some((l) => l.startsWith("525,5010,B-10,102,")));
  });
});
