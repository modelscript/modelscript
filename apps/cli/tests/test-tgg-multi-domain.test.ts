import { compileTGGRules } from "@modelscript/dsl/codegen/compile_tgg.js";
import { modelicaLanguage } from "@modelscript/modelica";
import { sysml2Language } from "@modelscript/sysml2";
import assert from "node:assert";
import { describe, it } from "node:test";

const expect = (val: any) => ({
  toBe: (expected: any) => assert.strictEqual(val, expected),
  toEqual: (expected: any) => assert.deepStrictEqual(val, expected),
  toBeDefined: () => assert.notStrictEqual(val, undefined),
  toContain: (str: string) => {
    if (Array.isArray(val)) {
      assert.ok(val.includes(str), `Expected array to contain ${str}, but got: ${JSON.stringify(val)}`);
    } else {
      assert.ok(String(val).includes(str), `Expected string to contain ${str}`);
    }
  },
  toBeGreaterThan: (n: number) => assert.ok(val > n),
});

describe("Multi-Domain TGG Rule Catalog", () => {
  it("should compile SysML v2 polyglot rules targeting Modelica, OWL 2, and STEP", () => {
    const sysmlRules = (sysml2Language as any).polyglot?.rules;
    expect(sysmlRules).toBeDefined();
    expect(sysmlRules.length).toBeGreaterThan(5);

    const compiled = compileTGGRules(sysmlRules);
    expect(compiled.ruleCount).toBe(sysmlRules.length);

    // Verify OWL 2 rules
    expect(compiled.ruleNames).toContain("SysML2ToOWL2SubClassOf");
    expect(compiled.ruleNames).toContain("SysML2ToOWL2ObjectProperty");
    expect(compiled.ruleNames).toContain("SysML2ToOWL2DataProperty");
    expect(compiled.ruleNames).toContain("SysML2ToOWL2Individual");

    // Verify STEP CAD rules
    expect(compiled.ruleNames).toContain("SysML2ToStepProduct");
    expect(compiled.ruleNames).toContain("SysML2ToStepMeasure");
    expect(compiled.ruleNames).toContain("SysML2ToStepPlacement");

    // Verify generated functions
    expect(compiled.sourceCode).toContain("export function tgg_forward_SysML2ToOWL2SubClassOf");
    expect(compiled.sourceCode).toContain("export function tgg_backward_SysML2ToOWL2SubClassOf");
    expect(compiled.sourceCode).toContain("export function tgg_forward_SysML2ToStepProduct");
    expect(compiled.sourceCode).toContain("export function tgg_backward_SysML2ToStepProduct");
    expect(compiled.sourceCode).toContain("export function tgg_forward_SysML2ToStepMeasure");
    expect(compiled.sourceCode).toContain("export function tgg_backward_SysML2ToStepMeasure");
  });

  it("should compile Modelica polyglot rules targeting SysML v2, OWL 2, and CSV telemetry", () => {
    const modelicaRules = (modelicaLanguage as any).polyglot?.rules;
    expect(modelicaRules).toBeDefined();

    const compiled = compileTGGRules(modelicaRules);
    expect(compiled.ruleNames).toContain("ModelicaModelToSysmlBlock");
    expect(compiled.ruleNames).toContain("ModelicaToOWL2Class");
    expect(compiled.ruleNames).toContain("ModelicaVariableToCsvChannel");

    // Verify generated CSV channel functions
    expect(compiled.sourceCode).toContain("export function tgg_forward_ModelicaVariableToCsvChannel");
    expect(compiled.sourceCode).toContain("export function tgg_backward_ModelicaVariableToCsvChannel");
  });

  it("should verify CPA confluence on multi-domain rule sets", () => {
    const sysmlRules = (sysml2Language as any).polyglot?.rules;
    const compiled = compileTGGRules(sysmlRules);
    expect(compiled.cpaReport).toBeDefined();
    // CPA report should not have cyclic errors between rules
    expect(compiled.cpaReport?.cycles.length).toBe(0);
  });
});
