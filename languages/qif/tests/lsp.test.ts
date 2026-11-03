// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  executeQifAction,
  formatFeatureControlFrame,
  getQifCompletions,
  getQifDefinition,
  getQifDocumentSymbols,
  getQifHover,
  validateQif,
} from "../src/lsp.js";
import { parseQif } from "../src/parser/index.js";

describe("QIF 3.0 LSP Services & Unicode GD&T Feature Control Frames", () => {
  const sampleQif = `QIF 3.0.0 qpId="a0a0a0a0-b1b1-4c2c-8d3d-e4e4e4e4e4e4"
DATUM A id=D1 feature=F_PLANE
DATUM B id=D2 feature=F_BORE
DATUM C id=D3 feature=F_PLANE
FEATURE F_PLANE Plane "DatumPlaneA" points=4
FEATURE F_BORE Cylinder "PrimaryBore" size=20.0 points=6
DEVICE CMM1 CMM "Zeiss_Contura" uncertainty=0.001
CHARACTERISTIC C_POS Position "Bore_Pos" zone=0.05 diametrical=true material=MMC datums=[A,B,C] features=[F_BORE] device=CMM1
STEP S1 step=1 feature=F_BORE characteristic=C_POS device=CMM1 points=6
ACTUAL ACT1 characteristic=C_POS serial="SN-01" value=0.03 actualSize=20.01 status=PASS`;

  it("renders ASME Y14.5 Unicode GD&T Feature Control Frames on hover", () => {
    const doc = parseQif(sampleQif);
    const fcf = formatFeatureControlFrame(doc.characteristics[0]!);
    assert.strictEqual(fcf, "| ⌖ | ⌀0.05 Ⓜ | A | B | C |");

    const charOffset = sampleQif.indexOf("CHARACTERISTIC C_POS") + 5;
    const hover = getQifHover(sampleQif, charOffset);
    assert(hover !== null);
    assert(hover.contents.value.includes("| ⌖ | ⌀0.05 Ⓜ | A | B | C |"));
  });

  it("validates QIF documents, extracts symbols, completions, and go-to-definition", () => {
    const diags = validateQif(sampleQif);
    assert.strictEqual(diags.length, 0);

    const symbols = getQifDocumentSymbols(sampleQif);
    assert(symbols.length >= 8);

    const completions = getQifCompletions(sampleQif);
    assert(completions.some((c) => c.label === "F_BORE"));
    assert(completions.some((c) => c.label === "MMC"));

    const refOffset = sampleQif.indexOf("feature=F_BORE") + "feature=".length + 2;
    const defLoc = getQifDefinition(sampleQif, refOffset, "file:///sample.qif");
    assert(defLoc !== null);
    assert.strictEqual(defLoc.uri, "file:///sample.qif");
    assert.strictEqual(defLoc.range.start.line, 5);
  });

  it("executes QIF LSP actions", async () => {
    const daeRes = await executeQifAction("qif_to_dae", sampleQif);
    assert(daeRes.variableCount >= 6);

    const spcRes = await executeQifAction("qif_spc", sampleQif);
    assert.strictEqual(spcRes.overallPassRate, 1.0);

    const sysmlRes = await executeQifAction("qif_to_sysml2", sampleQif);
    assert(sysmlRes.includes("requirement def"));
  });
});
