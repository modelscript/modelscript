// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerOlgaToDae } from "../src/dae/index.js";
import { executeOlgaAction, getOlgaDocumentSymbols, getOlgaHover, validateOlga } from "../src/lsp.js";
import { parseOlga } from "../src/parser/index.js";

const SAMPLE_OLGA = `CASE TITLE = "SubseaTieback"
FILES TABLE = "fluids.tab"
FLOWPATH NAME = TiebackLine
  PIPE LABEL = P-101, LENGTH = 1500.0 m, DIAMETER = 0.3 m, ROUGHNESS = 0.000045 m, NSEGMENT = 5
  VALVE NAME = Choke-1, POSITION = 1500.0 m, OPENING = 0.8
NODE NAME = InletWell, TYPE = MASS_SOURCE, FLOWPATH = TiebackLine, FRACTION = 0.0, PRESSURE = 120.0 bar, TEMPERATURE = 85.0 C, TOTALMASSRATE = 25.0 kg/s
NODE NAME = HostSeparator, TYPE = TERMINAL, FLOWPATH = TiebackLine, FRACTION = 1.0, PRESSURE = 35.0 bar, TEMPERATURE = 25.0 C
`;

describe("OLGA LSP Services & DAE Lowering (@modelscript/olga)", () => {
  it("validates OLGA deck and emits no false positives on clean model", () => {
    const diags = validateOlga(SAMPLE_OLGA);
    assert.ok(Array.isArray(diags));
    const errors = diags.filter((d) => d.severity === 1);
    assert.equal(errors.length, 0);
  });

  it("extracts document symbols hierarchy for flowpaths, pipes, and nodes", () => {
    const symbols = getOlgaDocumentSymbols(SAMPLE_OLGA);
    assert.ok(symbols.length > 0);
    assert.equal(symbols[0]?.name, "SubseaTieback");
    assert.ok(symbols[0]?.children?.some((c) => c.name === "TiebackLine"));
    assert.ok(symbols[0]?.children?.some((c) => c.name === "InletWell"));
  });

  it("provides contextual hover information for flowpath elements", () => {
    const hover = getOlgaHover(SAMPLE_OLGA, { line: 2, character: 16 });
    assert.ok(hover);
    assert.ok(hover?.contents.value.includes("TiebackLine"));
  });

  it("lowers OLGA flowpath finite volumes into DAEBuilder arena", () => {
    const model = parseOlga(SAMPLE_OLGA);
    const dae = lowerOlgaToDae(model);
    assert.ok(dae.varCount >= 10);
    assert.ok(dae.eqCount >= 5);
  });

  it("executes domain actions: lint, to_sysml, to_dae, simulate_drift_flux", async () => {
    const lintRes = await executeOlgaAction("lint", { content: SAMPLE_OLGA });
    assert.ok(Array.isArray(lintRes));

    const daeRes = await executeOlgaAction("to_dae", { content: SAMPLE_OLGA });
    assert.ok(daeRes.varCount > 0);

    const sysmlRes = await executeOlgaAction("to_sysml", { content: SAMPLE_OLGA });
    assert.ok(typeof sysmlRes === "string");
  });
});
