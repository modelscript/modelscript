// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAllSclWorkspaceModels, sclLanguage } from "../src/index.js";
import { getSclDiagnostics, getSclDocumentSymbols } from "../src/lsp.js";

describe("IEC 61850 SCL Language Plugin & LSP Services", () => {
  const sampleScd = `<?xml version="1.0" encoding="UTF-8"?>
<SCL xmlns="http://www.iec.ch/61850/2003/SCL" version="2007" revision="B">
  <Header id="LSP_TEST_SCD" version="2.0" revision="1.0"/>
  <Substation name="SUB_TEST">
    <VoltageLevel name="110kV">
      <Bay name="BAY1">
        <ConductingEquipment name="QA1" type="CBR">
          <Terminal name="T1" connectivityNode="SUB_TEST/110kV/BAY1/CN1"/>
        </ConductingEquipment>
      </Bay>
    </VoltageLevel>
  </Substation>
  <IED name="IED1">
    <AccessPoint name="AP1">
      <Server>
        <LDevice inst="LD0">
          <LN0 lnClass="LLN0" inst="" lnType="T_LLN0">
            <DataSet name="DS1">
              <FCDA ldInst="LD0" lnClass="XCBR" lnInst="1" doName="Pos" fc="ST"/>
            </DataSet>
            <GSEControl name="GC1" appID="APP1" datSet="DS1" confRev="1"/>
          </LN0>
          <LN lnClass="XCBR" inst="1" lnType="T_XCBR"/>
        </LDevice>
      </Server>
    </AccessPoint>
  </IED>
</SCL>`;

  it("should declare valid language metadata matching Beta tier", () => {
    assert.equal(sclLanguage.name, "scl");
    assert.ok(sclLanguage.fileExtensions?.includes(".scd"));
    assert.ok(sclLanguage.fileExtensions?.includes(".cid"));
    assert.ok(sclLanguage.fileExtensions?.includes(".icd"));
    assert.ok(sclLanguage.fileExtensions?.includes(".ssd"));
  });

  it("should extract LSP outline symbols with Substation, VoltageLevel, Bay, and IEDs", () => {
    const symbols = getSclDocumentSymbols(sampleScd);
    assert.equal(symbols.length, 2); // Substation + IEDs

    const subSymbol = symbols[0]!;
    assert.equal(subSymbol.name, "SUB_TEST");
    assert.equal(subSymbol.children?.length, 1); // 110kV

    const iedGroup = symbols[1]!;
    assert.ok(iedGroup.name.includes("Intelligent Electronic Devices"));
    assert.equal(iedGroup.children?.length, 1);
  });

  it("should provide LSP diagnostics for valid and invalid documents", () => {
    const diags = getSclDiagnostics(sampleScd);
    assert.ok(Array.isArray(diags));

    const badDiags = getSclDiagnostics("corrupted text");
    assert.ok(badDiags.length > 0);
  });

  it("should execute sclLanguage actions successfully", async () => {
    // 1. validate_scl_goose
    const gooseAction = sclLanguage.actions?.find((a) => a.id === "validate_scl_goose");
    assert.ok(gooseAction?.execute);
    const gooseRes = (await gooseAction.execute({ languageId: "scl" } as any, { documentText: sampleScd })) as {
      totalGooseStreams: number;
    } | null;
    assert.ok(gooseRes);
    assert.equal(gooseRes.totalGooseStreams, 1);

    // 2. lower_scl_dae
    const daeAction = sclLanguage.actions?.find((a) => a.id === "lower_scl_dae");
    assert.ok(daeAction?.execute);
    const daeRes = (await daeAction.execute({ languageId: "scl" } as any, { documentText: sampleScd })) as {
      variableCount: number;
      equationCount: number;
    };
    assert.ok(daeRes.variableCount > 0);

    // 3. project_scl_topology
    const topoAction = sclLanguage.actions?.find((a) => a.id === "project_scl_topology");
    assert.ok(topoAction?.execute);
    const topoRes = (await topoAction.execute({ languageId: "scl" } as any, { documentText: sampleScd })) as {
      substationName: string;
      breakerCount: number;
    } | null;
    assert.ok(topoRes);
    assert.equal(topoRes.substationName, "SUB_TEST");
    assert.equal(topoRes.breakerCount, 1);

    // 4. lint_scl_document
    const lintAction = sclLanguage.actions?.find((a) => a.id === "lint_scl_document");
    assert.ok(lintAction?.execute);
    const lintRes = (await lintAction.execute({ languageId: "scl" } as any, { documentText: sampleScd })) as unknown[];
    assert.ok(Array.isArray(lintRes));
  });

  it("should index documents in UnifiedWorkspace via sclLanguage", () => {
    const ws = new UnifiedWorkspace(sclLanguage);
    ws.setDocument("alpha.scd", sampleScd);
    const models = getAllSclWorkspaceModels(ws);
    assert.equal(models.length, 1);
    assert.equal(models[0]?.substationName, "SUB_TEST");
    assert.equal(models[0]?.iedCount, 1);
    assert.ok(ws.findSymbolsByName("SUB_TEST").length > 0);
  });
});
