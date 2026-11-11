// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getPslfCompletions,
  getPslfDocumentSymbols,
  getPslfHover,
  LspSymbolKind,
  PslfLspService,
  validatePslf,
} from "../src/lsp.js";

const VALID_PSLF_EPC = `case 'Clean 3-Bus Power Flow System'

c --- BUS DATA ---
b 1 'SLACK_BUS' 230.0 3 1 1 1.0400 0.00 1.100 0.900
b 2 'GEN_BUS'   230.0 2 1 1 1.0250 5.00 1.100 0.900
b 3 'LOAD_BUS'  230.0 1 1 1 1.0000 -2.0 1.100 0.900

c --- GENERATOR DATA ---
g 1 '1' 1 100.00 20.00 200.00 -100.00 1.0400 100.0 0.0000 0.1000 200.0 10.0
g 2 '1' 1 150.00 30.00 250.00 -100.00 1.0250 100.0 0.0000 0.1000 250.0 10.0

c --- LOAD DATA ---
ld 3 '1' 1 200.00 80.00 0.0 0.0 0.0 0.0 1 1

c --- TRANSMISSION LINE DATA ---
ln 1 2 '1' 1 0.01000 0.08000 0.10000 300.0 300.0 300.0
ln 1 3 '1' 1 0.01500 0.12000 0.15000 300.0 300.0 300.0
ln 2 3 '1' 1 0.02000 0.16000 0.20000 300.0 300.0 300.0
`;

const INVALID_PSLF_EPC = `case 'Broken Power Flow Case'

c Bus 1 is PV (2), Bus 2 is PQ (1) - No slack bus (3)
b 1 'BUS_1' 230.0 2 1 1 1.0400 0.00 1.100 0.900
b 2 'BUS_2' 230.0 1 1 1 1.0000 0.00 1.100 0.900

c Generator connects to missing bus 99
g 99 '1' 1 100.00 20.00 50.00 100.00 1.0400 100.0 0.0000 0.1000 200.0 10.0

c Line connects to missing bus 88
ln 1 88 '1' 1 0.01000 0.08000 0.10000 300.0 300.0 300.0
`;

describe("GE PSLF Language Server Protocol (LSP) Services (@modelscript/pslf)", () => {
  it("validates compliant PSLF EPC case and produces 0 fatal errors", () => {
    const diags = validatePslf(VALID_PSLF_EPC);
    const errors = diags.filter((d) => d.severity === 1);
    assert.equal(errors.length, 0, "Valid PSLF case should have 0 fatal errors");
  });

  it("produces diagnostics for missing slack bus and dangling bus references", () => {
    const diags = validatePslf(INVALID_PSLF_EPC);
    assert.ok(diags.length >= 2, "Should identify missing slack bus and dangling connections");

    const noSlack = diags.find((d) => d.code === "PSLF-E001");
    assert.ok(noSlack, "Should flag missing slack bus PSLF-E001");
    assert.equal(noSlack.severity, 1);

    const danglingGen = diags.find((d) => d.code === "PSLF-E004");
    assert.ok(danglingGen, "Should flag generator on non-existent bus 99 PSLF-E004");
  });

  it("extracts document symbols hierarchy (Buses, Generators, Branches)", () => {
    const symbols = getPslfDocumentSymbols(VALID_PSLF_EPC);
    assert.ok(symbols.length >= 3, "Should extract Buses, Generators, Branches");

    const busGroup = symbols.find((s) => s.kind === LspSymbolKind.Package && s.name.includes("Buses"));
    assert.ok(busGroup, "Should extract Buses group");
    assert.ok(busGroup.children && busGroup.children.length === 3, "Should contain 3 buses");

    const genGroup = symbols.find((s) => s.kind === LspSymbolKind.Module && s.name.includes("Generators"));
    assert.ok(genGroup, "Should extract Generators group");
    assert.ok(genGroup.children && genGroup.children.length === 2, "Should contain 2 generators");

    const branchGroup = symbols.find((s) => s.kind === LspSymbolKind.Module && s.name.includes("Branches"));
    assert.ok(branchGroup, "Should extract Branches group");
    assert.ok(branchGroup.children && branchGroup.children.length === 3, "Should contain 3 branches");
  });

  it("provides contextual hover information for PSLF EPC record types", () => {
    const lines = VALID_PSLF_EPC.split("\n");
    const busLine = lines.findIndex((l) => l.startsWith("b 1"));
    assert.ok(busLine >= 0);

    const hoverBus = getPslfHover(VALID_PSLF_EPC, { line: busLine, character: 1 });
    assert.ok(hoverBus, "Hover on 'b' should return Bus record documentation");
    assert.ok(hoverBus.contents.value.includes("Bus Record"));

    const genLine = lines.findIndex((l) => l.startsWith("g 1"));
    assert.ok(genLine >= 0);
    const hoverGen = getPslfHover(VALID_PSLF_EPC, { line: genLine, character: 1 });
    assert.ok(hoverGen, "Hover on 'g' should return Generator record documentation");
    assert.ok(hoverGen.contents.value.includes("Generator Record"));
  });

  it("provides intelligent completions for PSLF cards and dynamic models", () => {
    const completions = getPslfCompletions(VALID_PSLF_EPC, { line: 5, character: 2 });
    assert.ok(completions.length >= 6);
    assert.ok(completions.some((c) => c.label === "B"));
    assert.ok(completions.some((c) => c.label === "G"));
    assert.ok(completions.some((c) => c.label === "T"));
    assert.ok(completions.some((c) => c.label === "genrou"));
  });

  it("supports PslfLspService class wrapper methods", () => {
    const service = new PslfLspService();
    const diags = service.validate(VALID_PSLF_EPC);
    assert.equal(diags.filter((d) => d.severity === 1).length, 0);

    const symbols = service.getDocumentSymbols(VALID_PSLF_EPC);
    assert.ok(symbols.length > 0);

    const hover = service.getHover(VALID_PSLF_EPC, { line: 3, character: 0 });
    assert.ok(hover !== undefined);

    const comps = service.getCompletions(VALID_PSLF_EPC, { line: 0, character: 0 });
    assert.ok(comps.length > 0);
  });
});
