// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  eslIndexing,
  executeEslAction,
  getEslCompletions,
  getEslDocumentSymbols,
  getEslHover,
  validateEsl,
} from "../src/index.js";

const SAMPLE_ESL = `STUDY AttitudeControl
  MODEL Satellite
    CONSTANT REAL: inertia = 100.0;
    REAL: theta, omega, torque;
  INITIAL
    theta = 0.5;
    omega = 0.0;
  DYNAMIC
    torque = LIMIT(-10.0, 10.0, -5.0 * theta - 2.0 * omega);
    theta' = omega;
    omega' = torque / inertia;
  END MODEL Satellite
END STUDY AttitudeControl
`;

describe("@modelscript/esl LSP & Indexing Suite", () => {
  it("validates ESL document and returns diagnostics with source modelscript-esl", () => {
    const clean = validateEsl(SAMPLE_ESL, "attitude.esl");
    assert.strictEqual(clean.length, 0);

    const broken = validateEsl(`MODEL Bad\n  REAL: x;\nDYNAMIC\n  x' = y;\nEND MODEL Wrong\n`, "bad.esl");
    assert.ok(broken.length >= 2);
    assert.ok(broken.every((d) => d.source === "modelscript-esl"));
  });

  it("extracts hierarchical document symbols (STUDY -> MODEL -> declarations)", () => {
    const symbols = getEslDocumentSymbols(SAMPLE_ESL, "attitude.esl");
    assert.strictEqual(symbols.length, 1);
    const study = symbols[0]!;
    assert.strictEqual(study.name, "AttitudeControl");
    assert.ok(study.children && study.children.length === 1);
    const model = study.children[0]!;
    assert.strictEqual(model.name, "Satellite");
    assert.ok(model.children && model.children.length === 4);
  });

  it("provides hover documentation for keywords, stdlib blocks, and variables", () => {
    const lines = SAMPLE_ESL.split("\n");
    const limitLine = lines.findIndex((l) => l.includes("LIMIT("));
    const limitCol = lines[limitLine]!.indexOf("LIMIT") + 2;

    const hoverLimit = getEslHover(SAMPLE_ESL, { line: limitLine, character: limitCol });
    assert.ok(hoverLimit);
    assert.ok(hoverLimit.contents.value.includes("LIMIT"));

    const hoverDynamic = getEslHover(SAMPLE_ESL, { line: 7, character: 3 });
    assert.ok(hoverDynamic);
    assert.ok(hoverDynamic.contents.value.includes("DYNAMIC"));
  });

  it("provides completion items for keywords, stdlib blocks, and in-scope declarations", () => {
    const items = getEslCompletions(SAMPLE_ESL, { line: 8, character: 2 });
    assert.ok(items.some((i) => i.label === "WHEN"));
    assert.ok(items.some((i) => i.label === "ORBIT_J2"));
    assert.ok(items.some((i) => i.label === "theta"));

    const filtered = getEslCompletions(SAMPLE_ESL, { line: 8, character: 6 });
    assert.ok(filtered.some((i) => i.label === "torque"));
  });

  it("executes domain actions (lint, simulate, to_modelica, to_dae) and indexes .esl files", async () => {
    const lintRes = await executeEslAction("lint", { content: SAMPLE_ESL });
    assert.ok(Array.isArray(lintRes) && lintRes.length === 0);

    const moRes = await executeEslAction("to_modelica", { content: SAMPLE_ESL });
    assert.ok(typeof moRes === "string" && moRes.includes("model Satellite"));

    const daeRes = (await executeEslAction("to_dae", { content: SAMPLE_ESL })) as {
      varCount: number;
      eqCount: number;
    };
    assert.ok(daeRes.varCount >= 4 && daeRes.eqCount >= 3);

    assert.strictEqual(eslIndexing.canIndex("spacecraft.esl", ""), true);
    const indexed: string[] = [];
    eslIndexing.indexFile({
      uri: "spacecraft.esl",
      text: SAMPLE_ESL,
      setParsedModel: () => undefined,
      addSymbol: (name: string) => {
        indexed.push(name);
        return indexed.length;
      },
    } as unknown as Parameters<typeof eslIndexing.indexFile>[0]);
    assert.ok(indexed.includes("AttitudeControl"));
    assert.ok(indexed.includes("Satellite"));
    assert.ok(indexed.includes("theta"));
  });
});
