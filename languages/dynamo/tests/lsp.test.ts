// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dynamoIndexing,
  getDynamoCompletions,
  getDynamoDocumentSymbols,
  getDynamoHover,
  validateDynamo,
} from "../src/index.js";

const SAMPLE_DYNAMO = `NOTE WORLD POPULATION MODEL
L POP.K=POP.J+(DT)*(BIRTH.JK-DEATH.JK)
N POP=1000
R BIRTH.KL=POP.K*BR
R DEATH.KL=POP.K*DR
A SMOOTHED.K=SMOOTH(POP.K, 5)
C BR=0.04, DR=0.02
SPEC DT=0.25/LENGTH=50
RUN
`;

describe("@modelscript/dynamo LSP & Workspace Indexing Suite", () => {
  it("validates DYNAMO source and reports LSP diagnostics", () => {
    const clean = validateDynamo(SAMPLE_DYNAMO, "world.dyn");
    assert.strictEqual(clean.length, 0);

    const broken = validateDynamo("L STOCK.K=STOCK.J+(DT)*(INFLOW.JK)\nR INFLOW.KL=MISSING", "broken.dyn");
    assert.ok(broken.length >= 2);
    assert.ok(broken.every((d) => d.source === "modelscript-dynamo"));
    assert.ok(broken.some((d) => d.code === "DYN4001"));
    assert.ok(broken.some((d) => d.code === "DYN2001"));
  });

  it("extracts hierarchical document symbols for Levels, Rates, Auxiliaries, and Constants", () => {
    const symbols = getDynamoDocumentSymbols(SAMPLE_DYNAMO, "world.dyn");
    assert.strictEqual(symbols.length, 1);
    const root = symbols[0]!;
    assert.strictEqual(root.name, "WORLD_POPULATION_MODEL");
    assert.ok(root.children && root.children.length >= 7);
    assert.ok(root.children.some((c) => c.name === "POP.K"));
    assert.ok(root.children.some((c) => c.name === "BIRTH.KL"));
    assert.ok(root.children.some((c) => c.name === "BR"));
  });

  it("provides contextual hover for declared symbols and built-in DYNAMO stdlib functions", () => {
    const lines = SAMPLE_DYNAMO.split("\n");
    const smoothLine = lines.findIndex((l) => l.includes("SMOOTH("));
    const smoothChar = lines[smoothLine]!.indexOf("SMOOTH(") + 2;

    const hoverFn = getDynamoHover(SAMPLE_DYNAMO, { line: smoothLine, character: smoothChar });
    assert.ok(hoverFn, "Expected hover for SMOOTH");
    assert.ok(hoverFn.contents.value.includes("SMOOTH(IN, DEL)"));

    const popLine = lines.findIndex((l) => l.startsWith("L POP.K"));
    const hoverPop = getDynamoHover(SAMPLE_DYNAMO, { line: popLine, character: 3 });
    assert.ok(hoverPop, "Expected hover for POP");
    assert.ok(hoverPop.contents.value.includes("Level (Stock)"));
  });

  it("provides completions for directives, stdlib functions, and model symbols", () => {
    const items = getDynamoCompletions(SAMPLE_DYNAMO);
    const labels = new Set(items.map((i) => i.label));
    assert.ok(labels.has("SPEC"));
    assert.ok(labels.has("SMOOTH"));
    assert.ok(labels.has("TABHL"));
    assert.ok(labels.has("DELAY3"));
    assert.ok(labels.has("POP"));
    assert.ok(labels.has("BIRTH"));
  });

  it("supports declarative UnifiedWorkspace indexing via dynamoIndexing", () => {
    assert.strictEqual(dynamoIndexing.canIndex("model.dyn", ""), true);
    assert.strictEqual(dynamoIndexing.canIndex("model.dynamo", ""), true);
    assert.strictEqual(dynamoIndexing.canIndex("unknown.txt", SAMPLE_DYNAMO), true);

    const added: Array<{ name: string; kind: string }> = [];
    let parsedModel: unknown = null;
    const mockCtx: any = {
      text: SAMPLE_DYNAMO,
      setParsedModel: (m: unknown) => {
        parsedModel = m;
      },
      addSymbol: (name: string, kind: string) => {
        added.push({ name, kind });
        return added.length;
      },
    };
    dynamoIndexing.indexFile(mockCtx);
    assert.ok(parsedModel !== null);
    assert.ok(added.some((s) => s.name === "WORLD_POPULATION_MODEL" && s.kind === "Package"));
    assert.ok(added.some((s) => s.name === "POP [L]" && s.kind === "State"));
    assert.ok(added.some((s) => s.name === "BIRTH [R]" && s.kind === "Flow"));
  });
});
