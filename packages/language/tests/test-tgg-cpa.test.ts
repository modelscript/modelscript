import assert from "node:assert";
import { describe, it } from "node:test";
import { compileTGGRules } from "../src/codegen/compile_tgg.js";
import { runCPA } from "../src/codegen/cpa.js";
import { tggRule } from "../src/dsl/language.js";

const expect = (val: any) => ({
  toBe: (expected: any) => assert.strictEqual(val, expected),
  toEqual: (expected: any) => assert.deepStrictEqual(val, expected),
  toBeDefined: () => assert.notStrictEqual(val, undefined),
  toBeGreaterThan: (n: number) => assert.ok(val > n),
  toHaveLength: (n: number) => assert.strictEqual(val?.length, n),
  toContain: (str: string) => assert.ok(String(val).includes(str)),
});

describe("TGG Critical Pair Analysis (CPA) & Confluence Checker", () => {
  it("should detect overlapping rules with equal priority matching the same source type", () => {
    const rules = [
      tggRule({
        name: "PartToModelA",
        priority: 0,
        source: ($, v) => $.PartDefinition({ name: v("name") }),
        target: ($, v) => $.ModelicaClass({ name: v("name") }),
      }),
      tggRule({
        name: "PartToBlockB",
        priority: 0,
        source: ($, v) => $.PartDefinition({ name: v("name") }),
        target: ($, v) => $.ModelicaBlock({ name: v("name") }),
      }),
    ];

    const report = runCPA(rules);
    expect(report.hasConflicts).toBe(true);
    expect(report.conflicts.length).toBeGreaterThan(0);
    const overlap = report.conflicts.find((c) => c.kind === "overlap");
    expect(overlap).toBeDefined();
    expect(overlap?.rule1).toBe("PartToModelA");
    expect(overlap?.rule2).toBe("PartToBlockB");
    expect(overlap?.severity).toBe("warning");
  });

  it("should not flag conflict if overlapping rules have different priorities", () => {
    const rules = [
      tggRule({
        name: "DefaultPartToClass",
        priority: 0,
        source: ($, v) => $.PartDefinition({ name: v("name") }),
        target: ($, v) => $.ModelicaClass({ name: v("name") }),
      }),
      tggRule({
        name: "SpecializedPartToBlock",
        priority: 10, // Higher priority disambiguates the match
        source: ($, v) => $.PartDefinition({ name: v("name") }),
        target: ($, v) => $.ModelicaBlock({ name: v("name") }),
      }),
    ];

    const report = runCPA(rules);
    const overlaps = report.conflicts.filter((c) => c.kind === "overlap");
    expect(overlaps.length).toBe(0);
  });

  it("should detect cyclic ping-pong dependencies between rules", () => {
    const rules = [
      tggRule({
        name: "SysMLToModelica",
        source: ($, v) => $.SysMLBlock({ id: v("id") }),
        target: ($, v) => $.ModelicaModel({ id: v("id") }),
      }),
      tggRule({
        name: "ModelicaToSysML",
        source: ($, v) => $.ModelicaModel({ id: v("id") }),
        target: ($, v) => $.SysMLBlock({ id: v("id") }),
      }),
    ];

    const report = runCPA(rules);
    expect(report.hasConflicts).toBe(true);
    const cycle = report.conflicts.find((c) => c.kind === "cycle");
    expect(cycle).toBeDefined();
    expect(cycle?.severity).toBe("error");
    expect(report.cycles.length).toBeGreaterThan(0);
  });

  it("should return clean report for orthogonal confluent rules", () => {
    const rules = [
      tggRule({
        name: "PartDefToModel",
        source: ($, v) => $.PartDefinition({ name: v("name") }),
        target: ($, v) => $.ModelicaClass({ name: v("name") }),
      }),
      tggRule({
        name: "PortDefToConnector",
        source: ($, v) => $.PortDefinition({ portName: v("p") }),
        target: ($, v) => $.ModelicaConnector({ pinName: v("p") }),
      }),
    ];

    const report = runCPA(rules);
    expect(report.hasConflicts).toBe(false);
    expect(report.conflicts).toHaveLength(0);
    expect(report.cycles).toHaveLength(0);
  });

  it("should integrate CPA report seamlessly into compileTGGRules()", () => {
    const rules = [
      tggRule({
        name: "PartToClass",
        source: ($, v) => $.PartDefinition({ name: v("n") }),
        target: ($, v) => $.ModelicaClass({ name: v("n") }),
      }),
    ];

    const compiled = compileTGGRules(rules);
    expect(compiled.cpaReport).toBeDefined();
    expect(compiled.cpaReport?.hasConflicts).toBe(false);
    expect(compiled.cpaReport?.ruleCount).toBe(1);
  });
});
