// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerPsseToDae } from "../src/dae/index.js";
import { executePsseAction, getPsseDocumentSymbols, getPsseHover, validatePsse } from "../src/lsp.js";
import { parseRaw } from "../src/parser/raw-parser.js";

const IEEE_14_RAW = `0, 100.00, 33, 0, 0, 60.00 / PSS/E-33.0 IEEE 14 BUS TEST CASE
IEEE 14 BUS TEST CASE
TRANSMISSION PLANNING MODEL
1, 'BUS 1       ', 0.6900, 3, 1, 1, 1, 1.0600, 0.0000
2, 'BUS 2       ', 0.6900, 2, 1, 1, 1, 1.0450, -4.9800
3, 'BUS 3       ', 0.6900, 2, 1, 1, 1, 1.0100, -12.7200
4, 'BUS 4       ', 0.6900, 1, 1, 1, 1, 1.0190, -10.3300
5, 'BUS 5       ', 0.6900, 1, 1, 1, 1, 1.0200, -8.7800
0 / END OF BUS DATA
2, '1 ', 1, 1, 1, 21.700, 12.700, 0.000, 0.000, 0.000, 0.000, 1, 1, 1
3, '1 ', 1, 1, 1, 94.200, 19.000, 0.000, 0.000, 0.000, 0.000, 1, 1, 1
4, '1 ', 1, 1, 1, 47.800, -3.900, 0.000, 0.000, 0.000, 0.000, 1, 1, 1
5, '1 ', 1, 1, 1, 7.600, 1.600, 0.000, 0.000, 0.000, 0.000, 1, 1, 1
0 / END OF LOAD DATA
0 / END OF FIXED SHUNT DATA
1, '1 ', 232.400, -16.900, 10.000, -9999.000, 1.0600, 0, 100.00, 0.00000, 1.00000, 0.00000, 0.00000, 1.0000, 1, 100.0, 9999.000, -9999.000
2, '1 ', 40.000, 42.400, 50.000, -40.000, 1.0450, 0, 100.00, 0.00000, 1.00000, 0.00000, 0.00000, 1.0000, 1, 100.0, 9999.000, -9999.000
3, '1 ', 0.000, 23.400, 40.000, 0.000, 1.0100, 0, 100.00, 0.00000, 1.00000, 0.00000, 0.00000, 1.0000, 1, 100.0, 9999.000, -9999.000
0 / END OF GENERATOR DATA
1, 2, '1 ', 0.01938, 0.05917, 0.05280, 0.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 0.00
1, 5, '1 ', 0.05403, 0.22304, 0.04920, 0.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 0.00
2, 3, '1 ', 0.04699, 0.19797, 0.04380, 0.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 0.00
2, 4, '1 ', 0.05811, 0.17632, 0.03400, 0.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 0.00
2, 5, '1 ', 0.05695, 0.17388, 0.03460, 0.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 0.00
3, 4, '1 ', 0.06701, 0.17103, 0.01280, 0.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 0.00
4, 5, '1 ', 0.01335, 0.04211, 0.00000, 0.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 0.00
0 / END OF BRANCH DATA
0 / END OF TRANSFORMER DATA
0 / END OF AREA DATA
0 / END OF TWO-TERMINAL DC DATA
0 / END OF VSC DC DATA
0 / END OF SWITCHED SHUNT DATA
`;

describe("PSS/E LSP Services & DAE Lowering (@modelscript/psse)", () => {
  it("validates RAW case and produces 0 error diagnostics for valid model", () => {
    const diags = validatePsse(IEEE_14_RAW);
    assert.ok(Array.isArray(diags));
    const errors = diags.filter((d) => d.severity === 1);
    assert.equal(errors.length, 0);
  });

  it("extracts document symbols hierarchy for buses, generators, and branches", () => {
    const symbols = getPsseDocumentSymbols(IEEE_14_RAW);
    assert.ok(symbols.length > 0);
    assert.ok(symbols[0]?.name.includes("IEEE 14 BUS TEST CASE"));
    assert.ok(symbols[0]?.children?.some((c) => c.name.includes("Bus 1")));
    assert.ok(symbols[0]?.children?.some((c) => c.name.includes("Gen Bus 1")));
    assert.ok(symbols[0]?.children?.some((c) => c.name.includes("Line 1 -> 2")));
  });

  it("provides contextual hover information for bus nodes", () => {
    const hover = getPsseHover(IEEE_14_RAW, { line: 3, character: 10 });
    assert.ok(hover);
    assert.ok(hover?.contents.value.includes("BUS 1"));
    assert.ok(hover?.contents.value.includes("Swing / Slack"));
  });

  it("lowers PSS/E case into linear-memory DAE arena", () => {
    const psseCase = parseRaw(IEEE_14_RAW);
    const dae = lowerPsseToDae(psseCase);
    assert.ok(dae.varCount >= 20);
    assert.ok(dae.eqCount >= 10);
  });

  it("executes domain actions: lint, to_modelica, to_pscad, to_dae, solve_powerflow", async () => {
    const lintRes = await executePsseAction("lint", { content: IEEE_14_RAW });
    assert.ok(Array.isArray(lintRes));

    const moRes = await executePsseAction("to_modelica", { content: IEEE_14_RAW });
    assert.ok(typeof moRes === "string" && moRes.includes("model"));

    const pscadRes = await executePsseAction("to_pscad", { content: IEEE_14_RAW });
    assert.ok(pscadRes);

    const daeRes = await executePsseAction("to_dae", { content: IEEE_14_RAW });
    assert.ok(daeRes.varCount > 0);
    assert.ok(daeRes.eqCount > 0);

    const pfRes = await executePsseAction("solve_powerflow", { content: IEEE_14_RAW });
    assert.ok(pfRes.converged);
  });
});
