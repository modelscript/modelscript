import { tggEq, tggForEach, tggNot, tggPath, tggRule } from "@modelscript/dsl";
import { compileTGGRules } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer, type PolyglotNode } from "@modelscript/runtime/polyglot-transformer.js";
import assert from "node:assert";
import { describe, it } from "node:test";

const expect = (val: any) => ({
  toBe: (expected: any) => assert.strictEqual(val, expected),
  toEqual: (expected: any) => assert.deepStrictEqual(val, expected),
  toBeDefined: () => assert.notStrictEqual(val, undefined),
  toBeGreaterThan: (n: number) => assert.ok(val > n),
  toHaveLength: (n: number) => assert.strictEqual(val?.length, n),
  toContain: (str: string) => assert.ok(String(val).includes(str)),
});

describe("TGG Non-Tree Topologies & Negative Application Conditions (NACs)", () => {
  it("should compile NAC conditions and verify forbidden patterns in generated AssemblyScript", () => {
    const rules = [
      tggRule({
        name: "ConnectThermalPortsUnlessInsulated",
        source: ($, v) => $.ThermalPort({ portId: v("p1") }),
        target: ($, v) => $.HeatPort({ portId: v("p1") }),
        where: (v) => [
          tggNot("ThermalInsulator"), // Forbidden pattern: must not be insulated
        ],
      }),
    ];

    const compiled = compileTGGRules(rules);
    expect(compiled.ruleCount).toBe(1);
    expect(compiled.sourceCode).toContain("NAC: Verify forbidden pattern 'ThermalInsulator' is absent");
    expect(compiled.sourceCode).toContain("getNodeFirstChild(sourceNodeId)");
    expect(compiled.sourceCode).toContain("getNodeNextSibling(checkChild)");
  });

  it("should enforce NACs at runtime in PolyglotTransformer", () => {
    const transformer = new PolyglotTransformer();

    const insulatedRule = tggRule({
      name: "StandardHeatConduction",
      source: ($, v) => $.Port({ name: v("n") }),
      target: ($, v) => $.ThermalPin({ name: v("n") }),
      where: (v) => [tggNot("InsulatorBlock")],
    });

    const uninsulatedNode: PolyglotNode = {
      name: "PortA",
      attributes: [{ name: "temp", type: "Real", value: "300" }],
      components: [],
    };

    const insulatedNode: PolyglotNode = {
      name: "PortB",
      attributes: [{ name: "temp", type: "Real", value: "300" }],
      components: [{ name: "InsulatorBlock", typeSpecifier: "InsulatorBlock" }],
    };

    expect(transformer.checkNAC(insulatedRule, uninsulatedNode)).toBe(true);
    expect(transformer.checkNAC(insulatedRule, insulatedNode)).toBe(false);
  });

  it("should compile and resolve multi-hop property paths on graph nodes", () => {
    const rules = [
      tggRule({
        name: "RouteTraceabilityThroughPorts",
        source: ($, v) => $.Subsystem({ id: v("subId") }),
        target: ($, v) => $.DAEBlock({ id: v("subId") }),
        where: (v) => [tggPath(v("subId"), "ports/connection/target", v("remotePort"))],
      }),
    ];

    const compiled = compileTGGRules(rules);
    expect(compiled.sourceCode).toContain("Property path: __var_subId --[ports/connection/target]--> __var_remotePort");

    const transformer = new PolyglotTransformer();
    const systemGraph: PolyglotNode = {
      name: "BatterySubsystem",
      ports: [
        {
          name: "powerOut",
          type: "ElectricalPort",
          connection: { source: "powerOut", target: "inverterInput" } as any,
        } as any,
      ],
    };

    const resolved = transformer.resolvePath(systemGraph, "ports/powerOut/connection/target");
    expect(resolved).toBe("inverterInput");
  });

  it("should compile 1-to-N multi-amalgamation constraints", () => {
    const rules = [
      tggRule({
        name: "ExpandBusPins",
        source: ($, v) => $.BusDefinition({ busName: v("b") }),
        target: ($, v) => $.MultiPinConnector({ name: v("b") }),
        where: (v) => [tggForEach(v("busPins"), v("pin"), [tggEq(v("pin"), v("targetPin"))])],
      }),
    ];

    const compiled = compileTGGRules(rules);
    expect(compiled.sourceCode).toContain("Multi-amalgamation: forEach __var_pin in __var_busPins");
  });
});
