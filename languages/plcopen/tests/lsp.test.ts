// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { executePlcopenAction, getPlcopenDocumentSymbols, getPlcopenHover, validatePlcopen } from "../src/lsp.js";

describe("PLCopen LSP Services", () => {
  const sampleSt = `
    PROGRAM Feeder
      VAR_INPUT
        PartSensor : BOOL;
      END_VAR
      VAR_OUTPUT
        Pusher : BOOL;
      END_VAR
      Pusher := PartSensor;
    END_PROGRAM
  `;

  it("validates code and produces diagnostics", () => {
    const diags = validatePlcopen(sampleSt);
    assert.strictEqual(diags.length, 0);

    const badCode = `
      PROGRAM BadFeeder
        VAR LocalX : INT; END_VAR
        RETURN;
        LocalX := 10;
      END_PROGRAM
    `;
    const badDiags = validatePlcopen(badCode);
    assert(badDiags.length > 0);
    assert(badDiags.some((d) => d.code === "M7709"));
  });

  it("extracts LSP document symbols", () => {
    const symbols = getPlcopenDocumentSymbols(sampleSt);
    assert.strictEqual(symbols.length, 1);
    assert.strictEqual(symbols[0]!.name, "Feeder");
    assert(symbols[0]!.children !== undefined);
    assert.strictEqual(symbols[0]!.children.length, 2);
  });

  it("provides hover details on POU and variables", () => {
    const hover = getPlcopenHover(sampleSt, 10);
    assert(hover !== null);
    assert(hover.contents.value.includes("Feeder"));
  });

  it("executes custom domain actions via executePlcopenAction", async () => {
    const daeRes = await executePlcopenAction("plcopen_to_dae", sampleSt);
    assert(daeRes.variableCount >= 2);

    const moRes = await executePlcopenAction("plcopen_to_modelica", sampleSt);
    assert(typeof moRes === "string");
    assert(moRes.includes("block Feeder"));

    const scanRes = await executePlcopenAction("plcopen_run_scan", sampleSt, {
      cycles: 3,
      dtMs: 10,
    });
    assert.strictEqual(scanRes.cycles, 3);
  });
});
