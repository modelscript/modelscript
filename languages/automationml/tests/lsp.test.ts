// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { automationMLLanguage } from "../src/language.js";
import {
  executeAutomationMLAction,
  getAutomationMLCompletions,
  getAutomationMLDefinition,
  getAutomationMLDocumentSymbols,
  getAutomationMLHover,
  validateAutomationML,
} from "../src/lsp.js";

describe("AutomationML LSP Services & Language Definition", () => {
  const sampleAml = `aml "Workcell.aml" version "2.15"
roleClassLib "CellRoles" {
  roleClass ConveyorRole extends "AutomationMLBaseRoleClassLib/AutomationMLBaseRole/Resource" {
    attribute speed: REAL = 1.0
  }
}
instanceHierarchy "MainCell" {
  element ConvA [id="conv-a", ppr=Resource] {
    roleRequirement "CellRoles/ConveyorRole" requiresAttributes=[speed]
    frame (x=1.0, y=2.0, z=0.0, rx=0, ry=0, rz=0)
    attribute speed: REAL = 1.5 [m/s]
    interface outReady: Out BOOL
  }
  element ConvB [id="conv-b", ppr=Resource] {
    interface inStart: In BOOL
  }
  link "Handover" conv-a:outReady -> conv-b:inStart
}`;

  it("validates valid and invalid AutomationML documents", () => {
    const cleanDiags = validateAutomationML(sampleAml);
    assert.strictEqual(cleanDiags.length, 0);

    const invalidAml = `aml "Bad.aml"
instanceHierarchy "BadCell" {
  element E1 [id="e1"] {
    link "BadLink" e1:missingA -> e2:missingB
  }
}`;
    const badDiags = validateAutomationML(invalidAml);
    assert(badDiags.length >= 2);
    assert(badDiags.some((d) => d.code === "M8303"));
  });

  it("extracts hierarchical LSP document symbols", () => {
    const symbols = getAutomationMLDocumentSymbols(sampleAml);
    assert.strictEqual(symbols.length, 2); // MainCell + CellRoles
    const ihSym = symbols.find((s) => s.name === "MainCell");
    assert(ihSym !== undefined);
    assert.strictEqual(ihSym.children?.length, 2);
  });

  it("provides hover markdown on InternalElements, ExternalInterfaces, and Attributes", () => {
    const idx = sampleAml.indexOf("outReady");
    const hover = getAutomationMLHover(sampleAml, idx);
    assert(hover !== null);
    assert(hover.contents.value.includes("outReady"));

    const elIdx = sampleAml.indexOf("ConvA");
    const elHover = getAutomationMLHover(sampleAml, elIdx);
    assert(elHover !== null);
    assert(elHover.contents.value.includes("ConvA"));
  });

  it("provides completions for standard base classes, declared classes, and partner ports", () => {
    const completions = getAutomationMLCompletions(sampleAml);
    assert(completions.some((c) => c.label.includes("AutomationMLBaseRoleClassLib")));
    assert(completions.some((c) => c.label === "CellRoles/ConveyorRole"));
    assert(completions.some((c) => c.label === "conv-a:outReady"));
  });

  it("resolves Go-to-Definition for InternalLink partner endpoints and RoleRequirements", () => {
    const linkIdx = sampleAml.indexOf("conv-a:outReady ->");
    const defLoc = getAutomationMLDefinition(sampleAml, linkIdx, "Workcell.aml");
    assert(defLoc !== null);
    assert.strictEqual(defLoc.uri, "Workcell.aml");

    const roleReqIdx = sampleAml.indexOf("roleRequirement");
    const roleLoc = getAutomationMLDefinition(sampleAml, roleReqIdx, "Workcell.aml");
    assert(roleLoc !== null);
    assert.strictEqual(roleLoc.range.start.line, 2);
  });

  it("executes all AutomationML domain actions via executeAutomationMLAction and automationMLLanguage", async () => {
    assert.strictEqual(automationMLLanguage.name, "automationml");

    const daeRes = await executeAutomationMLAction("aml_to_dae", sampleAml);
    assert(daeRes.variableCount >= 4);

    const sspRes = await executeAutomationMLAction("aml_to_ssp", sampleAml);
    assert(sspRes.includes("<ssd:SystemStructureDescription"));

    const sysmlRes = await executeAutomationMLAction("aml_to_sysml2", sampleAml);
    assert(sysmlRes.includes("package MainCell"));

    const moRes = await executeAutomationMLAction("aml_to_modelica", sampleAml);
    assert(moRes.includes("model MainCell"));

    const cosimRes = await executeAutomationMLAction("aml_virtual_commissioning", sampleAml, {
      cycles: 4,
      dtMs: 10,
    });
    assert.strictEqual(cosimRes.cycles, 4);
  });
});
