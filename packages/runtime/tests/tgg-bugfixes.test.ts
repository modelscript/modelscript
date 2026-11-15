// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggCompute, tggEq, tggInvertible, tggNot, tggRule } from "@modelscript/dsl";
import { compileTGGRules, planTGGRules } from "@modelscript/dsl/codegen/compile_tgg.js";
import { compileWcojMatcher, planWcojPattern } from "@modelscript/dsl/codegen/rewriting/compile_wcoj.js";
import { registerNodeDomain, runCPA } from "@modelscript/dsl/codegen/rewriting/cpa.js";
import { PolyglotTransformer } from "@modelscript/runtime/polyglot-transformer.js";
import { registerNodeNameKey, solveWhereConstraints } from "@modelscript/runtime/tgg-pattern-interpreter.js";
import { ThreadDomain } from "@modelscript/runtime/thread_hypergraph.js";
import assert from "node:assert";
import { describe, it } from "node:test";

describe("TGG Engine Bugfix Regressions", () => {
  it("should auto-invert omitted backwardExpr and evaluate scientific notation safely in solveWhereConstraints", () => {
    const constraints = [tggInvertible("tgtVal = 2 * srcVal + 10"), tggCompute("scaled", "1e-3 * tgtVal + sqrt(16)")];

    const fwdEnv: Record<string, any> = { srcVal: 5 };
    solveWhereConstraints(constraints, fwdEnv, "forward");
    assert.strictEqual(fwdEnv.tgtVal, 20);
    assert.strictEqual(fwdEnv.scaled, 4.02);

    const bwdEnv: Record<string, any> = { tgtVal: 20 };
    solveWhereConstraints(constraints, bwdEnv, "backward");
    assert.strictEqual(bwdEnv.srcVal, 5);
  });

  it("should assign collision-free hypergraph slots for non-numeric and same-digit thread IDs", () => {
    const transformer = new PolyglotTransformer();
    transformer.registerThread("root:Chassis", {
      modelica: { name: "Chassis", id: 10 },
      sysml2: { name: "ChassisDef", id: 20 },
    });
    transformer.registerThread("var:mass", {
      modelica: { name: "mass", id: 11 },
      sysml2: { name: "massAttr", id: 21 },
    });
    transformer.registerThread("bus:1", {
      modelica: { name: "Bus1", id: 12 },
      psse: { name: "PSSE_Bus1", id: 32 },
    });
    transformer.registerThread("gen:1", {
      modelica: { name: "Gen1", id: 13 },
      psse: { name: "PSSE_Gen1", id: 33 },
    });

    const hg = transformer.getHypergraph();
    assert.strictEqual(hg.getThreadCount(), 4);
    const tChassis = hg.findThreadByDomainNode(ThreadDomain.Modelica, 10);
    const tMass = hg.findThreadByDomainNode(ThreadDomain.Modelica, 11);
    const tBus1 = hg.findThreadByDomainNode(ThreadDomain.Modelica, 12);
    const tGen1 = hg.findThreadByDomainNode(ThreadDomain.Modelica, 13);
    assert.ok(tChassis !== undefined && tMass !== undefined && tChassis !== tMass);
    assert.ok(tBus1 !== undefined && tGen1 !== undefined && tBus1 !== tGen1);
  });

  it("should preserve metadata on propagate, retract all multi-projection rules, and prefix Math.* in AS codegen", () => {
    const rules = [
      tggRule({
        name: "ModelToSysML",
        sourceLang: "modelica",
        targetLang: "sysml2",
        source: ($, v) => $.Block({ name: v("n"), val: v("x") }),
        target: ($, v) => $.PartDef({ name: v("n"), val: v("y") }),
        where: (v) => [tggInvertible("y = sqrt(x) + ln(x)", "x = exp(y)")],
      }),
      tggRule({
        name: "ModelToFMI",
        sourceLang: "modelica",
        targetLang: "fmi3",
        source: ($, v) => $.Block({ name: v("n") }),
        target: ($, v) => $.FmiModel({ name: v("n") }),
        where: (v) => [tggEq(v("n"), v("n"))],
      }),
    ];

    const compiled = compileTGGRules(rules);
    assert.ok(compiled.sourceCode.includes("corr.clearStale(slot);"));
    assert.ok(!compiled.sourceCode.includes("corr.addLink(sourceNodeId, targetNodeId, 0, CORR_FLAG_SYNCED, 0);"));
    assert.ok(compiled.sourceCode.includes("retracted += tgg_retract_ModelToSysML(sourceNodeId, corr, arena);"));
    assert.ok(compiled.sourceCode.includes("retracted += tgg_retract_ModelToFMI(sourceNodeId, corr, arena);"));
    assert.ok(compiled.sourceCode.includes("Math.sqrt("));
    assert.ok(compiled.sourceCode.includes("Math.log("));
  });

  it("should recognize structured TGGPattern objects in CPA NAC disjointness checks", () => {
    const r1 = tggRule({
      name: "RuleA",
      sourceLang: "modelica",
      targetLang: "sysml2",
      source: ($, v) => $.Port({ name: v("n") }),
      target: ($, v) => $.SysMLPort({ name: v("n") }),
      where: () => [tggNot({ nodeType: "SpecialPort", bindings: {} })],
    });
    const r2 = tggRule({
      name: "RuleB",
      sourceLang: "modelica",
      targetLang: "sysml2",
      source: ($, v) => $.Port({ name: v("n"), kind: "SpecialPort" }),
      target: ($, v) => $.SysMLSpecialPort({ name: v("n") }),
      where: () => [],
    });

    const report = runCPA([r1, r2]);
    assert.strictEqual(report.conflicts.filter((c) => c.kind === "overlap").length, 0);
  });

  it("should support dynamic N-domain hypergraph bindings beyond 18 domains for all 93+ languages", () => {
    const transformer = new PolyglotTransformer();
    transformer.registerThread("circuit:R1", {
      modelica: { name: "R1", id: 101 },
      spice: { name: "R1", id: 201 },
      "verilog-a": { name: "R1_va", id: 301 },
      sbml: { name: "R1_rxn", id: 401 },
    });

    const hg = transformer.getHypergraph();
    const spiceId = hg.getDomainId("spice");
    const vaId = hg.getDomainId("verilog-a");
    const sbmlId = hg.getDomainId("sbml");

    assert.ok(spiceId !== undefined && spiceId >= 18);
    assert.ok(vaId !== undefined && vaId >= 18 && vaId !== spiceId);
    assert.ok(sbmlId !== undefined && sbmlId >= 18 && sbmlId !== vaId);
    assert.strictEqual(hg.findThreadByDomainNode(spiceId!, 201), hg.findThreadByDomainNode(sbmlId!, 401));
    const rec = hg.getRecord(0);
    assert.strictEqual(rec?.domainNodes[spiceId!], 201);
    assert.strictEqual(rec?.domainNodes[vaId!], 301);
    assert.strictEqual(rec?.domainNodes[sbmlId!], 401);
  });

  it("should enforce TGGRuleOptions.context prerequisites during projectGraph and synchronizeGraph", () => {
    const circuitRule = tggRule({
      name: "CircuitToSubckt",
      sourceLang: "modelica",
      targetLang: "spice",
      source: ($, v) => $.ElectricalCircuit({ name: v("cktName") }),
      target: ($, v) => $.SpiceSubckt({ name: v("cktName") }),
      where: (v) => [tggEq(v("cktName"), v("cktName"))],
    });

    const resistorInCircuitRule = tggRule({
      name: "ResistorInCircuitToSpice",
      sourceLang: "modelica",
      targetLang: "spice",
      context: {
        source: ($, v) => $.ElectricalCircuit({ name: v("parentName") }),
        target: ($, v) => $.SpiceSubckt({ name: v("parentName") }),
      },
      source: ($, v) => $.Resistor({ name: v("rName"), R: v("rVal") }),
      target: ($, v) => $.SpiceResistor({ name: v("rName"), ohms: v("rVal"), subckt: v("parentName") }),
      where: (v) => [tggEq(v("rName"), v("rName")), tggEq(v("rVal"), v("rVal"))],
    });

    const transformer = new PolyglotTransformer({ rules: [circuitRule, resistorInCircuitRule] });
    const projected = transformer.projectGraph(
      {
        kind: "ElectricalCircuit",
        name: "Filter",
        children: [{ kind: "Resistor", name: "R1", properties: { name: "R1", R: 100 } }],
      },
      "modelica",
      "spice",
    );

    const child = (projected.children as any[])[0];
    assert.strictEqual(child.kind, "SpiceResistor");
    assert.strictEqual(child.properties.subckt, "Filter");
    assert.strictEqual(child.properties.ohms, 100);

    // Without matching context, the context-guarded rule should not fire
    const noCtx = transformer.evaluateRuleForward(
      { kind: "Resistor", name: "R_orphan", properties: { name: "R_orphan", R: 50 } },
      "spice",
      "orphan:R",
      { kind: "ThermalSystem", name: "Heater" },
    );
    assert.strictEqual(noCtx, null);
  });

  it("should evaluate path, mapList, exprMap, and physicalPort constraints in solveWhereConstraints", () => {
    const constraints = [
      { kind: "path" as const, args: ["__var_root", "ports/0/name", "__var_portName"] },
      { kind: "mapList" as const, args: ["__var_srcPins", "__var_tgtPins"] },
      { kind: "exprMap" as const, args: ["__var_srcExpr", "__var_tgtExpr", "modelica-sysml2"] },
      { kind: "physicalPort" as const, args: ["__var_vAcross", "__var_tgtAcross", "electrical"] },
    ];
    const env: Record<string, any> = {
      root: { ports: [{ name: "p_in" }] },
      srcPins: ["a", "b"],
      srcExpr: "der(x) = -k * x",
      vAcross: 24,
    };
    solveWhereConstraints(constraints, env, "forward");
    assert.strictEqual(env.portName, "p_in");
    assert.deepStrictEqual(env.tgtPins, ["a", "b"]);
    assert.strictEqual(env.tgtExpr, "der(x) = -k * x");
    assert.strictEqual(env.tgtAcross, 24);
  });

  it("should satisfy GetPut and PutGet lens laws across randomized inputs with tggInvertible and tggComplement", () => {
    const rule = tggRule({
      name: "ThermalSensorLens",
      sourceLang: "modelica",
      targetLang: "sysml2",
      source: ($, v) =>
        $.ThermalSensor({
          name: v("sName"),
          tempK: v("tk"),
          tolerance: v("tol"),
          calibrationNote: v("note"),
        }),
      target: ($, v) =>
        $.SensorBlock({
          name: v("sName"),
          tempC: v("tc"),
          tolerance: v("tol"),
        }),
      where: (v) => [
        tggEq(v("sName"), v("sName")),
        tggInvertible("tc = tk - 273.15", "tk = tc + 273.15"),
        tggEq(v("tol"), v("tol")),
        tggComplement("calibrationNote"),
      ],
    });

    const transformer = new PolyglotTransformer({ rules: [rule] });

    // Deterministic LCG PRNG for reproducible property-based fuzzing
    let seed = 0x517cc1b7;
    const nextRand = () => {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };

    for (let i = 0; i < 50; i++) {
      const sName = `Sensor_${i}_${Math.floor(nextRand() * 1000)}`;
      const tk = 200 + nextRand() * 500;
      const tol = 0.001 + nextRand() * 0.1;
      const note = `cal-${Math.floor(nextRand() * 99999)}`;

      const srcAst = {
        kind: "ThermalSensor",
        name: sName,
        properties: { name: sName, tempK: tk, tolerance: tol, calibrationNote: note },
      };

      // Forward (Get)
      const fwd = transformer.evaluateRuleForward(srcAst, "sysml2", `lens:${i}`);
      assert.ok(fwd, `Forward evaluation failed at iteration ${i}`);
      const fwdTempC = (fwd!.targetNode.properties as Record<string, any>).tempC;
      assert.ok(Math.abs(fwdTempC - (tk - 273.15)) < 1e-9);

      // GetPut: Backward(Forward(s)) === s (with complement restored)
      const bwdGetPut = transformer.evaluateRuleBackward(fwd!.targetNode, "modelica", {
        threadId: `lens:${i}`,
      });
      assert.ok(bwdGetPut, `GetPut backward evaluation failed at iteration ${i}`);
      const bwdProps = bwdGetPut!.sourceNode.properties as Record<string, any>;
      assert.strictEqual(bwdProps.name, sName);
      assert.ok(Math.abs(bwdProps.tempK - tk) < 1e-9);
      assert.ok(Math.abs(bwdProps.tolerance - tol) < 1e-9);
      assert.strictEqual(bwdGetPut!.complement.calibrationNote, note);

      // PutGet: Forward(Backward(t')) === t'
      const perturbedTc = fwdTempC + (nextRand() - 0.5) * 40;
      const perturbedTgt = {
        kind: "SensorBlock",
        name: sName,
        properties: { name: sName, tempC: perturbedTc, tolerance: tol },
      };
      const bwdPut = transformer.evaluateRuleBackward(perturbedTgt, "modelica", {
        threadId: `lens:${i}`,
        strategy: "target-wins",
      });
      assert.ok(bwdPut, `PutGet backward evaluation failed at iteration ${i}`);
      const fwdPutGet = transformer.evaluateRuleForward(bwdPut!.sourceNode, "sysml2", `lens:${i}`);
      assert.ok(fwdPutGet, `PutGet forward evaluation failed at iteration ${i}`);
      const putGetTempC = (fwdPutGet!.targetNode.properties as Record<string, any>).tempC;
      assert.ok(Math.abs(putGetTempC - perturbedTc) < 1e-9);
    }
  });

  it("should share CompiledTGGPlan IR, stream syncSymbolDeltas, support dynamic CPA/name registries, and compile 4-edge WCOJ plans", () => {
    registerNodeDomain("CustomFmuBlock", "fmi3");
    registerNodeNameKey("customFmuId");

    const fmuRule = tggRule({
      name: "FmuToSysml",
      source: ($, v) => $.CustomFmuBlock({ customFmuId: v("fid"), gain: v("g") }),
      target: ($, v) => $.PartUsage({ name: v("fid"), gain: v("g") }),
      where: (v) => [tggEq(v("fid"), v("fid")), tggEq(v("g"), v("g"))],
    });

    const cpa = runCPA([fmuRule], { nodeDomainMap: { PartUsage: "sysml2" } });
    assert.strictEqual(cpa.hasConflicts, false);

    const plan = planTGGRules([fmuRule], { syntaxTypes: { CustomFmuBlock: 101, PartUsage: 202 } });
    assert.strictEqual(plan.rules.length, 1);
    assert.strictEqual(plan.rules[0]!.sourceTypeId, 101);
    assert.strictEqual(plan.rules[0]!.targetTypeId, 202);

    const transformer = new PolyglotTransformer({ plan });
    const delta1 = transformer.syncSymbolDeltas(
      {
        added: [{ kind: "CustomFmuBlock", name: "F1", properties: { customFmuId: "FMU_1", gain: 2.5 } }],
      },
      "sysml2",
    );
    assert.strictEqual(delta1.applied, 1);
    assert.strictEqual(delta1.targets[0]!.name, "FMU_1");

    const delta2 = transformer.syncSymbolDeltas({ removed: ["CustomFmuBlock:F1"] }, "sysml2");
    assert.strictEqual(delta2.retracted, 1);

    // 4-edge k-variable WCOJ plan
    const kPlan = planWcojPattern({
      name: "QuadJoin",
      variables: ["a", "b", "c", "d"],
      edges: [
        { fromVar: "a", toVar: "b", edgeType: "E1" },
        { fromVar: "b", toVar: "c", edgeType: "E2" },
        { fromVar: "c", toVar: "d", edgeType: "E3" },
        { fromVar: "d", toVar: "a", edgeType: "E4" },
      ],
    });
    const kCode = compileWcojMatcher(kPlan);
    assert.ok(kCode.includes("iter4Ptr"));
    assert.ok(kCode.includes("leapfrog_intersect_2(iter1Ptr, iter4Ptr, resultZSetPtr)"));
  });
});
