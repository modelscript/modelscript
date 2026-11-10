// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { asmLanguage } from "../src/language.js";
import { getAsmDiagnostics, getAsmDocumentSymbols } from "../src/lsp.js";
import { AsmWorkspaceIndex } from "../src/workspace-index.js";

describe("IWA ASM Language Plugin & LSP Services", () => {
  const sampleText = `plant BSM1 {
  model: ASM1;
  influent {
    flow: 18446.0 m3/day;
    S_S: 69.5;
  }
  bioreactor TANK1 {
    type: Anoxic;
    volume: 1000.0 m3;
  }
  clarifier CLARIFIER1 {
    area: 1500.0 m2;
    depth: 4.0 m;
  }
}`;

  it("should declare valid language metadata matching Beta tier", () => {
    assert.equal(asmLanguage.name, "asm");
    assert.ok(asmLanguage.fileExtensions?.includes(".asm"));
    assert.ok(asmLanguage.fileExtensions?.includes(".bsm"));
    assert.ok(asmLanguage.fileExtensions?.includes(".wrrf"));
  });

  it("should extract LSP outline symbols with Bioreactors and Clarifiers", () => {
    const symbols = getAsmDocumentSymbols(sampleText);
    assert.equal(symbols.length, 1);
    const root = symbols[0]!;
    assert.equal(root.name, "BSM1");
    assert.equal(root.children?.length, 2); // Bioreactors + Clarifiers
  });

  it("should provide LSP diagnostics for valid and invalid documents", () => {
    const diags = getAsmDiagnostics(sampleText);
    assert.ok(Array.isArray(diags));

    const badDiags = getAsmDiagnostics("corrupted text");
    assert.ok(badDiags.length > 0);
  });

  it("should execute asmLanguage actions successfully", async () => {
    // 1. evaluate_asm_kinetics
    const kineticsAction = asmLanguage.actions?.find((a) => a.id === "evaluate_asm_kinetics");
    assert.ok(kineticsAction?.execute);
    const kRes = (await kineticsAction.execute({ languageId: "asm" } as any, { documentText: sampleText })) as {
      processRates: number[];
      conversionRates: Record<string, number>;
    } | null;
    assert.ok(kRes);
    assert.equal(kRes.processRates.length, 8);

    // 2. lower_asm_dae
    const daeAction = asmLanguage.actions?.find((a) => a.id === "lower_asm_dae");
    assert.ok(daeAction?.execute);
    const daeRes = (await daeAction.execute({ languageId: "asm" } as any, { documentText: sampleText })) as {
      variableCount: number;
      equationCount: number;
    };
    assert.ok(daeRes.variableCount > 0);

    // 3. simulate_takacs_clarifier
    const clarifierAction = asmLanguage.actions?.find((a) => a.id === "simulate_takacs_clarifier");
    assert.ok(clarifierAction?.execute);
    const cRes = (await clarifierAction.execute({ languageId: "asm" } as any, { documentText: sampleText })) as {
      effluentTss: number;
      underflowTss: number;
    } | null;
    assert.ok(cRes);
    assert.ok(cRes.effluentTss > 0);

    // 4. lint_asm_plant
    const lintAction = asmLanguage.actions?.find((a) => a.id === "lint_asm_plant");
    assert.ok(lintAction?.execute);
    const lintRes = (await lintAction.execute({ languageId: "asm" } as any, { documentText: sampleText })) as unknown[];
    assert.ok(Array.isArray(lintRes));
  });

  it("should index documents in AsmWorkspaceIndex", () => {
    const index = new AsmWorkspaceIndex();
    index.indexDocument("plant1.asm", sampleText);
    const models = index.getAllModels();
    assert.equal(models.length, 1);
    assert.equal(models[0]?.plantName, "BSM1");
    assert.equal(models[0]?.reactorCount, 1);
  });
});
