// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getPowerFactoryCompletions,
  getPowerFactoryDocumentSymbols,
  getPowerFactoryHover,
  LspSymbolKind,
  PowerFactoryLspService,
  validatePowerFactory,
} from "../src/lsp.js";

const VALID_PF_XML = `<?xml version="1.0" encoding="UTF-8"?>
<PowerFactory version="2024">
  <DataObject class="ElmTerm" loc_name="Bus_110kV_1">
    <uknom>110.0</uknom>
    <fnom>50.0</fnom>
  </DataObject>
  <DataObject class="ElmTerm" loc_name="Bus_110kV_2">
    <uknom>110.0</uknom>
    <fnom>50.0</fnom>
  </DataObject>
  <DataObject class="TypLne" loc_name="LineType_110">
    <r1>0.12</r1>
    <x1>0.39</x1>
  </DataObject>
  <DataObject class="ElmLne" loc_name="Line_1_2">
    <bus1>Bus_110kV_1</bus1>
    <bus2>Bus_110kV_2</bus2>
    <dline>25.0</dline>
    <typ_id>LineType_110</typ_id>
  </DataObject>
  <DataObject class="ElmSym" loc_name="Gen_1">
    <bus1>Bus_110kV_1</bus1>
    <pgini>50.0</pgini>
    <sgini>100.0</sgini>
    <usetp>1.02</usetp>
  </DataObject>
</PowerFactory>`;

const INVALID_PF_XML = `<?xml version="1.0" encoding="UTF-8"?>
<PowerFactory version="2024">
  <DataObject class="ElmTerm" loc_name="Bus_1">
    <uknom>110.0</uknom>
  </DataObject>
  <DataObject class="ElmLne" loc_name="Line_Ghost">
    <bus1>Bus_1</bus1>
    <bus2>Non_Existent_Bus_99</bus2>
    <dline>-10.0</dline>
  </DataObject>
</PowerFactory>`;

describe("DIgSILENT PowerFactory Language Server Protocol (LSP) Services (@modelscript/powerfactory)", () => {
  it("validates compliant PowerFactory document and produces 0 fatal errors", () => {
    const diags = validatePowerFactory(VALID_PF_XML);
    const errors = diags.filter((d) => d.severity === 1);
    assert.equal(errors.length, 0, "Valid PowerFactory document should have 0 fatal errors");
  });

  it("produces diagnostics for unresolved terminals and invalid line parameters", () => {
    const diags = validatePowerFactory(INVALID_PF_XML);
    assert.ok(diags.length >= 2, "Should identify unresolved terminal and invalid line parameters");

    const unres = diags.find((d) => d.code === "PF1008");
    assert.ok(unres, "Should flag PF1008 unresolved terminal");
    assert.equal(unres.severity, 1);

    const badLine = diags.find((d) => d.code === "PF1002");
    assert.ok(badLine, "Should flag PF1002 invalid line parameters");
  });

  it("extracts document symbols hierarchy (Terminals, Lines, Generators)", () => {
    const symbols = getPowerFactoryDocumentSymbols(VALID_PF_XML);
    assert.ok(symbols.length >= 2, "Should extract symbols categories");

    const termPkg = symbols.find((s) => s.kind === LspSymbolKind.Package && s.name.includes("Terminals"));
    assert.ok(termPkg, "Should find Terminals group");
    assert.ok(termPkg.children && termPkg.children.length === 2, "Should contain 2 terminals");

    const lineMod = symbols.find((s) => s.kind === LspSymbolKind.Module && s.name.includes("Lines"));
    assert.ok(lineMod, "Should find Lines group");
    assert.ok(lineMod.children && lineMod.children.length === 1);
  });

  it("provides contextual hover information for PowerFactory DGS classes", () => {
    const lines = VALID_PF_XML.split("\n");
    const termLine = lines.findIndex((l) => l.includes('class="ElmTerm"'));
    assert.ok(termLine >= 0);

    const hoverTerm = getPowerFactoryHover(VALID_PF_XML, { line: termLine, character: 15 });
    assert.ok(hoverTerm, "Hover on ElmTerm should return ElmTerm class docs");
    assert.ok(hoverTerm.contents.value.includes("ElmTerm"));
    assert.ok(hoverTerm.contents.value.includes("Busbar / Terminal"));

    const genLine = lines.findIndex((l) => l.includes('class="ElmSym"'));
    assert.ok(genLine >= 0);
    const hoverGen = getPowerFactoryHover(VALID_PF_XML, { line: genLine, character: 15 });
    assert.ok(hoverGen, "Hover on ElmSym should return generator docs");
    assert.ok(hoverGen.contents.value.includes("Synchronous Machine"));
  });

  it("provides intelligent completions for PowerFactory model elements", () => {
    const completions = getPowerFactoryCompletions(VALID_PF_XML, { line: 5, character: 2 });
    assert.ok(completions.length >= 5);
    assert.ok(completions.some((c) => c.label === "ElmTerm"));
    assert.ok(completions.some((c) => c.label === "ElmLne"));
    assert.ok(completions.some((c) => c.label === "ElmTr2"));
    assert.ok(completions.some((c) => c.label === "ElmSym"));
  });

  it("supports PowerFactoryLspService class wrapper methods", () => {
    const service = new PowerFactoryLspService();
    const diags = service.validate(VALID_PF_XML);
    assert.equal(diags.filter((d) => d.severity === 1).length, 0);

    const symbols = service.getDocumentSymbols(VALID_PF_XML);
    assert.ok(symbols.length > 0);

    const hover = service.getHover(VALID_PF_XML, { line: 2, character: 10 });
    assert.ok(hover !== undefined);

    const comps = service.getCompletions(VALID_PF_XML, { line: 0, character: 0 });
    assert.ok(comps.length > 0);
  });
});
