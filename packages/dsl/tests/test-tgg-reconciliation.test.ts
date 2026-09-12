import { tggEq, tggReconcile, tggRule } from "@modelscript/dsl";
import { compileTGGRules } from "@modelscript/dsl/codegen/compile_tgg.js";
import { PolyglotTransformer } from "@modelscript/runtime/polyglot-transformer.js";
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

describe("TGG Multi-Master Conflict Reconciliation", () => {
  it("should compile reconciliation policies into AssemblyScript propagate kernel", () => {
    const rules = [
      tggRule({
        name: "SyncVoltageWithReconciliation",
        source: ($, v) => $.SysMLPort({ voltage: v("vSys") }),
        target: ($, v) => $.ModelicaPin({ voltage: v("vMod") }),
        where: (v) => [tggEq(v("vSys"), v("vMod")), tggReconcile(v("vSys"), v("vMod"), "smt-simplex")],
      }),
      tggRule({
        name: "SyncMassSourceWins",
        source: ($, v) => $.Part({ mass: v("mSys") }),
        target: ($, v) => $.Inertia({ J: v("mMod") }),
        where: (v) => [tggReconcile(v("mSys"), v("mMod"), "source-wins")],
      }),
    ];

    const compiled = compileTGGRules(rules);
    expect(compiled.sourceCode).toContain("Conflict reconciliation policy: __var_vSys <-> __var_vMod (smt-simplex)");
    expect(compiled.sourceCode).toContain("Conflict reconciliation policy: __var_mSys <-> __var_mMod (source-wins)");
    expect(compiled.sourceCode).toContain("tgg_reconcile_scalar(slot, 0.0, 0.0, 0, corr)");
    expect(compiled.sourceCode).toContain("tgg_reconcile_scalar(slot, 0.0, 0.0, 1, corr)");
    expect(compiled.sourceCode).toContain("export function tgg_reconcile_all_conflicts");
  });

  it("should track and resolve multi-master conflicts in PolyglotTransformer", () => {
    const transformer = new PolyglotTransformer();

    // 1. Record concurrent edit conflict (e.g. SysML set voltage=24, Modelica set voltage=12)
    transformer.recordConflict("port_1_voltage", 24.0, 12.0, "SyncVoltageWithReconciliation");
    transformer.recordConflict("bracket_mass", 15.5, 18.0, "SyncMassSourceWins");

    const conflicts = transformer.getConflicts();
    expect(conflicts).toHaveLength(2);
    expect(conflicts[0].isResolved).toBe(false);

    // 2. Reconcile with target-wins for voltage
    transformer.resolveConflict("port_1_voltage", "target");
    expect(transformer.getConflicts().find((c) => c.id === "port_1_voltage")?.resolved).toBe(12.0);
    expect(transformer.getConflicts().find((c) => c.id === "port_1_voltage")?.isResolved).toBe(true);

    // 3. Reconcile with source-wins for mass
    transformer.resolveConflict("bracket_mass", "source");
    expect(transformer.getConflicts().find((c) => c.id === "bracket_mass")?.resolved).toBe(15.5);
    expect(transformer.getConflicts().find((c) => c.id === "bracket_mass")?.isResolved).toBe(true);

    // 4. Custom consensus reconciliation (e.g. SMT-computed compromise value)
    transformer.recordConflict("operating_temp", 350.0, 370.0);
    transformer.resolveConflict("operating_temp", 360.0);
    expect(transformer.getConflicts().find((c) => c.id === "operating_temp")?.resolved).toBe(360.0);
  });
});
