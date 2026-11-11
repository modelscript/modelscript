// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CgmesLspService,
  getCgmesCompletions,
  getCgmesDocumentSymbols,
  getCgmesHover,
  LspSymbolKind,
  validateCgmes,
} from "../src/lsp.js";

const VALID_CGMES_EQ = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns:cim="http://iec.ch/TC57/2013/CIM-schema-cim16#">
  <cim:Substation rdf:ID="_sub1">
    <cim:IdentifiedObject.name>Berlin Central Substation</cim:IdentifiedObject.name>
  </cim:Substation>
  <cim:BaseVoltage rdf:ID="_bv380">
    <cim:BaseVoltage.nominalVoltage>380.0</cim:BaseVoltage.nominalVoltage>
  </cim:BaseVoltage>
  <cim:VoltageLevel rdf:ID="_vl380">
    <cim:IdentifiedObject.name>Berlin 380kV</cim:IdentifiedObject.name>
    <cim:VoltageLevel.BaseVoltage rdf:resource="#_bv380"/>
    <cim:VoltageLevel.Substation rdf:resource="#_sub1"/>
  </cim:VoltageLevel>
  <cim:TopologicalNode rdf:ID="_node1">
    <cim:IdentifiedObject.name>BUS_380_1</cim:IdentifiedObject.name>
    <cim:TopologicalNode.BaseVoltage rdf:resource="#_bv380"/>
    <cim:TopologicalNode.ConnectivityNodeContainer rdf:resource="#_vl380"/>
  </cim:TopologicalNode>
  <cim:SynchronousMachine rdf:ID="_gen1">
    <cim:IdentifiedObject.name>GEN_CENTRAL</cim:IdentifiedObject.name>
    <cim:RotatingMachine.ratedS>500.0</cim:RotatingMachine.ratedS>
    <cim:SynchronousMachine.p>300.0</cim:SynchronousMachine.p>
    <cim:SynchronousMachine.q>50.0</cim:SynchronousMachine.q>
    <cim:SynchronousMachine.minP>50.0</cim:SynchronousMachine.minP>
    <cim:SynchronousMachine.maxP>450.0</cim:SynchronousMachine.maxP>
  </cim:SynchronousMachine>
  <cim:Terminal rdf:ID="_term1">
    <cim:IdentifiedObject.name>Gen_T1</cim:IdentifiedObject.name>
    <cim:Terminal.ConductingEquipment rdf:resource="#_gen1"/>
    <cim:Terminal.TopologicalNode rdf:resource="#_node1"/>
    <cim:Terminal.sequenceNumber>1</cim:Terminal.sequenceNumber>
  </cim:Terminal>
</rdf:RDF>`;

const CGMES_WITH_LINT_ERRORS = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns:cim="http://iec.ch/TC57/2013/CIM-schema-cim16#">
  <cim:SynchronousMachine rdf:ID="_gen_bad">
    <cim:IdentifiedObject.name>BadGen</cim:IdentifiedObject.name>
    <cim:SynchronousMachine.minP>500.0</cim:SynchronousMachine.minP>
    <cim:SynchronousMachine.maxP>100.0</cim:SynchronousMachine.maxP>
  </cim:SynchronousMachine>
  <cim:Terminal rdf:ID="_orphan_t">
    <cim:Terminal.ConductingEquipment rdf:resource="#_missing_equip"/>
  </cim:Terminal>
</rdf:RDF>`;

describe("CGMES Language Server Protocol (LSP) Services (@modelscript/cgmes)", () => {
  it("validates clean CGMES model and produces 0 fatal errors", () => {
    const diags = validateCgmes(VALID_CGMES_EQ);
    const errors = diags.filter((d) => d.severity === 1);
    assert.equal(errors.length, 0, "Clean CGMES model should have 0 fatal errors");
  });

  it("produces diagnostics for orphan terminals and inverted generator limits", () => {
    const diags = validateCgmes(CGMES_WITH_LINT_ERRORS);
    assert.ok(diags.length >= 2, "Should identify orphan terminal and limit inversion");

    const orphanDiag = diags.find((d) => d.code === "C1002");
    assert.ok(orphanDiag, "Should flag C1002 orphan terminal");
    assert.equal(orphanDiag.severity, 1);

    const genLimitDiag = diags.find((d) => d.code === "C1006");
    assert.ok(genLimitDiag, "Should flag C1006 generator limit inversion");
    assert.equal(genLimitDiag.severity, 1);
  });

  it("extracts document symbols hierarchy (Substation -> VoltageLevel -> Equipment)", () => {
    const symbols = getCgmesDocumentSymbols(VALID_CGMES_EQ);
    assert.ok(symbols.length > 0, "Should extract symbols");

    const subSym = symbols.find((s) => s.kind === LspSymbolKind.Package && s.name.includes("Berlin Central"));
    assert.ok(subSym, "Should extract Substation symbol");
    assert.ok(subSym.children && subSym.children.length === 1, "Substation should contain 1 voltage level");

    const vlSym = subSym.children[0]!;
    assert.ok(vlSym.name.includes("380 kV"), "VoltageLevel symbol name should include nominal voltage");

    const genModule = symbols.find((s) => s.name === "Synchronous Machines");
    assert.ok(genModule, "Should group generators under Synchronous Machines module");
  });

  it("provides contextual hover information for CIM classes and mRIDs", () => {
    const lines = VALID_CGMES_EQ.split("\n");
    const subLine = lines.findIndex((l) => l.includes("<cim:Substation"));
    assert.ok(subLine >= 0);

    const hoverSub = getCgmesHover(VALID_CGMES_EQ, { line: subLine, character: 10 });
    assert.ok(hoverSub, "Hover on Substation should return CIM class doc");
    assert.ok(hoverSub.contents.value.includes("cim:Substation"));

    const genLine = lines.findIndex((l) => l.includes("<cim:SynchronousMachine"));
    assert.ok(genLine >= 0);
    const hoverGen = getCgmesHover(VALID_CGMES_EQ, { line: genLine, character: 10 });
    assert.ok(hoverGen, "Hover on SynchronousMachine should return generator doc");
    assert.ok(hoverGen.contents.value.includes("electromechanical device"));
  });

  it("provides intelligent completions for CIM XML schema tags", () => {
    const completions = getCgmesCompletions(VALID_CGMES_EQ, { line: 5, character: 2 });
    assert.ok(completions.length >= 6);
    assert.ok(completions.some((c) => c.label === "cim:Substation"));
    assert.ok(completions.some((c) => c.label === "cim:VoltageLevel"));
    assert.ok(completions.some((c) => c.label === "cim:ACLineSegment"));
    assert.ok(completions.some((c) => c.label === "cim:SynchronousMachine"));
  });

  it("supports CgmesLspService class wrapper methods", () => {
    const service = new CgmesLspService();
    const diags = service.validate(VALID_CGMES_EQ);
    assert.equal(diags.filter((d) => d.severity === 1).length, 0);

    const symbols = service.getDocumentSymbols(VALID_CGMES_EQ);
    assert.ok(symbols.length > 0);

    const hover = service.getHover(VALID_CGMES_EQ, { line: 3, character: 5 });
    assert.ok(hover !== undefined);

    const comps = service.getCompletions(VALID_CGMES_EQ, { line: 0, character: 0 });
    assert.ok(comps.length > 0);
  });
});
