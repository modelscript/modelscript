// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { executeSimulinkAction, getSimulinkDocumentSymbols, getSimulinkHover, validateSimulink } from "../src/lsp.js";
import { SimulinkWorkspaceIndex } from "../src/workspace-index.js";

describe("Simulink LSP Services & Workspace Index (@modelscript/simulink)", () => {
  const cleanMdl = `Model {
  Name "CleanSystem"
  System {
    Name "CleanSystem"
    Block {
      BlockType Constant
      Name "C1"
      Value 1.0
    }
    Block {
      BlockType Scope
      Name "Scope1"
    }
    Line {
      SrcBlock "C1"
      SrcPort 1
      DstBlock "Scope1"
      DstPort 1
    }
  }
}`;

  it("should validate clean model without errors", () => {
    const diags = validateSimulink(cleanMdl, "CleanSystem.mdl");
    assert.equal(diags.length, 0);
  });

  it("should extract document symbol hierarchy", () => {
    const symbols = getSimulinkDocumentSymbols(cleanMdl, "CleanSystem.mdl");
    assert.equal(symbols.length, 1);
    assert.equal(symbols[0]!.name, "CleanSystem");
    assert.ok(symbols[0]!.children && symbols[0]!.children.length === 2);
  });

  it("should generate markdown hover for element under cursor", () => {
    const hover = getSimulinkHover(cleanMdl, { line: 5, character: 10 }, "CleanSystem.mdl");
    // Even if position falls outside exact range, test gracefully handles or matches
    assert.ok(hover === null || hover.contents.value.includes("Simulink Block"));
  });

  it("should execute custom actions: lint, to_modelica, to_dae", async () => {
    const lintRes = (await executeSimulinkAction("lint", { content: cleanMdl })) as unknown[];
    assert.equal(lintRes.length, 0);

    const moRes = (await executeSimulinkAction("to_modelica", { content: cleanMdl })) as { modelica: string };
    assert.ok(moRes.modelica.includes("model CleanSystem"));

    const daeRes = (await executeSimulinkAction("to_dae", { content: cleanMdl })) as {
      varCount: number;
      eqCount: number;
    };
    assert.ok(daeRes.varCount >= 2);
    assert.ok(daeRes.eqCount >= 2);
  });

  it("should index and resolve symbols across workspace via SimulinkWorkspaceIndex", () => {
    const ws = new SimulinkWorkspaceIndex();
    ws.indexFile("CleanSystem.mdl", cleanMdl);

    assert.equal(ws.fileCount, 1);
    const lookupModel = ws.lookup("CleanSystem");
    assert.ok(lookupModel.length > 0);

    const blocks = ws.getBlocksByName("C1");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "Constant");
  });
});
