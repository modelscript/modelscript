import { describe, expect, it } from "vitest";

import { ProjectionResult, UnifiedWorkspace } from "@modelscript/compiler";
import { createModelicaQueryEngine, createModelicaWorkspaceIndex } from "@modelscript/modelica/factory";
import modelicaConfig from "@modelscript/modelica/language";
import { createSysML2WorkspaceIndex } from "@modelscript/sysml2/factory";
import sysml2Config from "@modelscript/sysml2/language";

import Modelica from "@modelscript/modelica/parser";
import Parser from "tree-sitter";

describe("Cross-Language Projection: Modelica to SysML v2", () => {
  it("projects simple equations to SysML2 constraints", async () => {
    // 1. Setup parser
    const parser = new Parser();
    parser.setLanguage(Modelica);

    const sourceText = `
      model RC_Circuit
        Real R = 10.0;
        Real C = 0.1;
        Real u;
      equation
        R * u = 5.0;
      end RC_Circuit;
    `;
    const tree = parser.parse(sourceText);

    // 2. Setup Unified Workspace
    const uw = new UnifiedWorkspace();

    // Modelica setup
    const modelicaIndex = createModelicaWorkspaceIndex();
    modelicaIndex.register("file:///test.mo", () => tree.rootNode as unknown);
    await modelicaIndex.toUnifiedAsync();

    const sysmlIndex = createSysML2WorkspaceIndex();

    uw.registerWorkspace("modelica", modelicaIndex, modelicaConfig);
    uw.registerWorkspace("sysml2", sysmlIndex, sysml2Config);

    const contextTree = {
      getText: (startByte: number, endByte: number) => sourceText.substring(startByte, endByte),
      getNode: (startByte: number, endByte: number) =>
        tree.rootNode.descendantForIndex(startByte, Math.max(startByte, endByte)),
    };
    const modelicaEngine = createModelicaQueryEngine(modelicaIndex.toUnifiedPartial(), contextTree);
    uw.registerQueryEngine("modelica", modelicaEngine);

    // 3. Perform Projection
    const projections = uw.adapterRegistry.projectAll("modelica", "sysml2");

    // 4. Verify Projection
    expect(projections.length).toBeGreaterThan(0);
    const rcCircuit = projections.find((p: ProjectionResult) => p.props.name === "RC_Circuit");
    expect(rcCircuit).toBeDefined();

    // Check that constraints were extracted
    const constraints = rcCircuit.props.constraints as unknown[];
    expect(constraints).toBeDefined();
    expect(constraints.length).toBe(1);
    expect(constraints[0].kind).toBe("ConstraintUsage");
    expect(constraints[0].expression.replace(/\s+/g, "")).toContain("R*u=5.0;");
  });

  it("projects when-equations to SysML2 actions", async () => {
    const parser = new Parser();
    parser.setLanguage(Modelica);

    const sourceText = `
      model BouncingBall
        Real h(start=1.0);
        Real v;
      equation
        when h <= 0.0 then
          reinit(v, -0.9 * pre(v));
        end when;
      end BouncingBall;
    `;
    const tree = parser.parse(sourceText);

    const uw = new UnifiedWorkspace();
    const modelicaIndex = createModelicaWorkspaceIndex();
    modelicaIndex.register("file:///bounce.mo", () => tree.rootNode as unknown);
    await modelicaIndex.toUnifiedAsync();

    uw.registerWorkspace("modelica", modelicaIndex, modelicaConfig);
    const contextTree = {
      getText: (startByte: number, endByte: number) => sourceText.substring(startByte, endByte),
      getNode: (startByte: number, endByte: number) =>
        tree.rootNode.descendantForIndex(startByte, Math.max(startByte, endByte)),
    };
    const modelicaEngine = createModelicaQueryEngine(modelicaIndex.toUnifiedPartial(), contextTree);
    uw.registerQueryEngine("modelica", modelicaEngine);

    const projections = uw.adapterRegistry.projectAll("modelica", "sysml2");
    const bouncingBall = projections.find((p: ProjectionResult) => p.props.name === "BouncingBall");
    expect(bouncingBall).toBeDefined();

    const actions = bouncingBall.props.actions as unknown[];
    expect(actions).toBeDefined();
    expect(actions.length).toBe(1);
    expect(actions[0].kind).toBe("ActionUsage");
    expect(actions[0].body).toContain("reinit(v");
  });
});
