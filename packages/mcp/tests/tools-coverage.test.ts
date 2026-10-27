// SPDX-License-Identifier: AGPL-3.0-or-later

import { Context } from "@modelscript/modelica/context";
import { createWasmParser } from "@modelscript/modelica/parser";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { createModelScriptMcpServer } from "../src/factory.js";
import type { ServerContext } from "../src/types.js";

// Initialize WASM parser for .mo
const require = createRequire(import.meta.url);
const modelicaWasmPath = require.resolve("@modelscript/modelica/dist/parser.wasm");
const { parser } = await createWasmParser(modelicaWasmPath);
Context.registerParser(".mo", parser as any);

describe("MCP Tools Extensive Coverage Suite", () => {
  const ctx: ServerContext = { current: null };
  const server = createModelScriptMcpServer(ctx);
  const tools = (server as any)._registeredTools;

  it("modelica_load returns result for path", async () => {
    const tool = tools["modelica_load"];
    assert.ok(tool);
    const res = await tool.handler({ paths: ["/path/does/not/exist/model.mo"] });
    assert.ok(res.content[0].text);
  });

  it("modelica_parse parses valid Modelica code and reports summary", async () => {
    const tool = tools["modelica_parse"];
    assert.ok(tool);
    const code = `
      model Oscillator
        Real x(start = 1.0);
        Real v(start = 0.0);
      equation
        der(x) = v;
        der(v) = -x;
      end Oscillator;
    `;
    const res = await tool.handler({ code });
    assert.ok(!res.isError);
    const data = JSON.parse(res.content[0].text);
    assert.ok(Array.isArray(data.classes));
  });

  it("modelica_parse detects syntax errors cleanly", async () => {
    const tool = tools["modelica_parse"];
    assert.ok(tool);
    const badCode = `model Broken equation der( = ; end;`;
    const res = await tool.handler({ code: badCode });
    const data = JSON.parse(res.content[0].text);
    assert.ok(Array.isArray(data.syntaxErrors));
  });

  it("modelica_flatten handles missing context and class resolution", async () => {
    const tool = tools["modelica_flatten"];
    assert.ok(tool);

    // Context is null
    ctx.current = null;
    const resNull = await tool.handler({ name: "NonExistent" });
    assert.strictEqual(resNull.isError, true);
    assert.ok(resNull.content[0].text.includes("No libraries loaded"));

    // Context returns null
    ctx.current = {
      flatten: () => null,
    } as any;
    const resMissing = await tool.handler({ name: "Unknown" });
    assert.strictEqual(resMissing.isError, true);
    assert.ok(resMissing.content[0].text.includes("not found or has errors"));

    // Context returns valid flattened DAE
    ctx.current = {
      flatten: () => "f = 0;\nx = 1.0;",
    } as any;
    const resSuccess = await tool.handler({ name: "Simple" });
    assert.ok(!resSuccess.isError);
    assert.strictEqual(resSuccess.content[0].text, "f = 0;\nx = 1.0;");
  });

  it("modelica_lint returns compiler query engine info", async () => {
    const tool = tools["modelica_lint"];
    assert.ok(tool);

    ctx.current = null;
    const resNull = await tool.handler({});
    assert.strictEqual(resNull.isError, true);
    assert.ok(resNull.content[0].text.includes("No libraries loaded"));

    ctx.current = {
      queryEngine: {
        runAllLints: () => [],
        index: { symbols: new Map() },
      },
    } as any;
    const resClean = await tool.handler({});
    assert.ok(!resClean.isError);
    assert.strictEqual(resClean.content[0].text, "No lint issues found.");

    ctx.current = {
      queryEngine: {
        runAllLints: () => [
          {
            symbolId: 1,
            severity: "error",
            code: 2002,
            message: "Variable 'x' not found in scope.",
          },
        ],
        index: {
          symbols: new Map([[1, { resourceId: "/workspace/test.mo", startLine: 4, startColumn: 5 }]]),
        },
      },
    } as any;
    const resDiag = await tool.handler({});
    assert.ok(!resDiag.isError);
    const parsed = JSON.parse(resDiag.content[0].text);
    assert.strictEqual(parsed.count, 1);
    assert.strictEqual(parsed.diagnostics[0].code, "M2002");
  });

  it("hybrid_simulate handles missing class gracefully", async () => {
    const tool = tools["hybrid_simulate"];
    assert.ok(tool);
    const res = await tool.handler({
      name: "NonExistentSystem",
      paths: [],
    });
    assert.strictEqual(res.isError, true);
    assert.ok(res.content[0].text.includes("not found"));
  });

  it("modelica_doe and modelica_sensitivity check context availability", async () => {
    ctx.current = null;
    const doeTool = tools["modelica_doe"];
    assert.ok(doeTool);
    const doeRes = await doeTool.handler({
      name: "TestModel",
      inputs: { k: { min: 1, max: 10 } },
      outputs: ["y"],
    });
    assert.strictEqual(doeRes.isError, true);
    assert.ok(doeRes.content[0].text.includes("No libraries loaded"));

    const sensTool = tools["modelica_sensitivity"];
    assert.ok(sensTool);
    const sensRes = await sensTool.handler({
      name: "TestModel",
      parameters: ["k"],
      outputs: ["y"],
    });
    assert.strictEqual(sensRes.isError, true);
    assert.ok(sensRes.content[0].text.includes("No libraries loaded"));
  });

  it("modelica_diff_calibrate checks context availability", async () => {
    ctx.current = null;
    const calTool = tools["modelica_diff_calibrate"];
    assert.ok(calTool);
    const calRes = await calTool.handler({
      name: "TestModel",
      parameters: ["k"],
      parameterBounds: { k: { min: 0.1, max: 10 } },
      measurements: "time,y\n0,1\n1,0.5",
    });
    assert.strictEqual(calRes.isError, true);
    assert.ok(calRes.content[0].text.includes("No libraries loaded"));
  });

  it("ontology and reasoning tools handle uninitialized state", async () => {
    ctx.ontologyBuilder = undefined;

    const valTool = tools["validate_system_consistency"];
    assert.ok(valTool);
    const valRes = await valTool.handler({});
    assert.strictEqual(valRes.isError, true);
    assert.ok(valRes.content[0].text.includes("Ontology not initialized"));

    const sparqlTool = tools["query_ontology_sparql"];
    assert.ok(sparqlTool);
    const sparqlRes = await sparqlTool.handler({ query: "subclasses(mo:Device)" });
    assert.strictEqual(sparqlRes.isError, true);
    assert.ok(sparqlRes.content[0].text.includes("Ontology not initialized"));

    const bgpTool = tools["query_ontology_bgp"];
    assert.ok(bgpTool);
    const bgpRes = await bgpTool.handler({
      patterns: [{ subject: "?s", predicate: "mo:connectedTo", object: "?o" }],
    });
    assert.strictEqual(bgpRes.isError, true);
    assert.ok(bgpRes.content[0].text.includes("Ontology not initialized"));

    const traceTool = tools["trace_fault_propagation"];
    assert.ok(traceTool);
    const traceRes = await traceTool.handler({ sourceIri: "mo:sensor1" });
    assert.strictEqual(traceRes.isError, true);
    assert.ok(traceRes.content[0].text.includes("Ontology not initialized"));

    const explainTool = tools["explain_inference"];
    assert.ok(explainTool);
    const explainRes = await explainTool.handler({ subClass: "mo:Car", superClass: "mo:Vehicle" });
    assert.strictEqual(explainRes.isError, true);
    assert.ok(explainRes.content[0].text.includes("Ontology not initialized"));
  });

  it("tgg_query_thread and rtm tools execute cleanly", async () => {
    const threadTool = tools["tgg_query_thread"];
    assert.ok(threadTool);
    const threadRes = await threadTool.handler({ elementId: "SubsystemA" });
    assert.ok(!threadRes.isError);
    assert.ok(threadRes.content[0].text.includes("SubsystemA"));

    const rtmDiagTool = tools["rtm_diagnose_suspect"];
    assert.ok(rtmDiagTool);
    const diagRes = await rtmDiagTool.handler({
      sourceName: "Motor",
      targetRequirement: "REQ-Power",
    });
    assert.ok(diagRes.content[0].text.includes("isSuspect"));

    const rtmSuggestTool = tools["rtm_suggest_links"];
    assert.ok(rtmSuggestTool);
    const suggestRes = await rtmSuggestTool.handler({ requirementName: "High speed motor performance" });
    assert.ok(suggestRes.content[0].text.includes("suggestions"));
  });

  it("social_read_thread and social_post_reply interact with socialBridge", async () => {
    let createdPostData: any = null;
    const socialCtx: ServerContext = {
      current: null,
      userId: 42,
      socialBridge: {
        getPost: async (id) => ({ id, content: "Test discussion prompt", author_id: 1 }),
        getReplies: async (id) => [{ id: 101, content: "Existing reply", reply_to_id: id }],
        createPost: async (params) => {
          createdPostData = params;
          return { id: 202 };
        },
      },
    };
    const srv = createModelScriptMcpServer(socialCtx);
    const srvTools = (srv as any)._registeredTools;

    const readTool = srvTools["social_read_thread"];
    assert.ok(readTool);
    const readRes = await readTool.handler({ postId: 12 });
    assert.ok(!readRes.isError);
    const readData = JSON.parse(readRes.content[0].text);
    assert.equal(readData.post.id, 12);
    assert.equal(readData.replies.length, 1);

    const replyTool = srvTools["social_post_reply"];
    assert.ok(replyTool);
    const replyRes = await replyTool.handler({
      postId: 12,
      content: "Verified physics analysis",
    });
    assert.ok(!replyRes.isError);
    const replyData = JSON.parse(replyRes.content[0].text);
    assert.equal(replyData.replyPostId, 202);
    assert.equal(createdPostData.authorId, 42);
    assert.equal(createdPostData.content, "Verified physics analysis");
  });

  it("supports structured metrics in modelica_flatten, validate_system_consistency, tgg_reconcile_slot, and modelscript_closed_loop_synthesize", async () => {
    const flattenRes = await tools["modelica_flatten"].handler({
      className: "GimbalPitchLoop",
      code: "model GimbalPitchLoop\n  parameter Real Kp = 10.0;\n  Real theta(start=0.0);\nequation\n  der(theta) = -Kp * theta;\nend GimbalPitchLoop;",
    });
    assert.ok(!flattenRes.isError);
    const flattenJson = JSON.parse(flattenRes.content[0].text);
    assert.equal(flattenJson.isBalanced, true);
    assert.ok(Array.isArray(flattenJson.metrics));

    const consRes = await tools["validate_system_consistency"].handler({
      sysmlCode: "package P { part def Battery { attribute V_nominal = 400.0; } }",
      modelicaCode: "model Pack\n  parameter Real V_nominal = 800.0;\nend Pack;",
    });
    assert.ok(!consRes.isError);
    const consJson = JSON.parse(consRes.content[0].text);
    assert.equal(consJson.divergencesDetected, 1);
    assert.ok(Array.isArray(consJson.metrics));

    const recRes = await tools["tgg_reconcile_slot"].handler({
      correspondenceId: "corr_pack_voltage_01",
      authority: "sysml_v2",
      customValue: 800.0,
      modelicaCode: "model Pack\n  parameter Real V_nominal = 400.0;\nend Pack;",
    });
    assert.ok(!recRes.isError);
    const recJson = JSON.parse(recRes.content[0].text);
    assert.equal(recJson.status, "resolved");
    assert.ok(recJson.patchedModelicaCode.includes("800"));
    assert.ok(recJson.verdict);

    const synthRes = await tools["modelscript_closed_loop_synthesize"].handler({
      modelName: "GimbalPitchLoop",
      modelicaCode:
        "model GimbalPitchLoop\n  parameter Real Kp = 10.0;\n  parameter Real Ki = 1.0;\n  parameter Real Kd = 0.5;\n  Real theta(start=0.0);\nequation\n  der(theta) = -Kp * theta;\nend GimbalPitchLoop;",
      tunableParameters: ["Kp", "Ki", "Kd"],
      stopTime: 1.0,
    });
    const synthJson = JSON.parse(synthRes.content[0].text);
    assert.ok(synthJson.tunedParameters);
    assert.ok(typeof synthJson.overshootPct === "number");
    assert.ok(typeof synthJson.stlRobustness === "number");
    assert.ok(Array.isArray(synthJson.metrics));
  });

  it("executes the 5 cross-domain MCP tools (CAD/FEA, B2B Migration, SSP Co-Sim, Formal/MC-DC, Twin SINDy/ROM)", async () => {
    const cadRes = await tools["cad_fea_closed_loop_size"].handler({
      partName: "ActuatorBracket",
      materialYieldMpa: 276,
      minSafetyFactor: 1.5,
      appliedLoadN: 4200,
      minClearanceMm: 2.0,
    });
    assert.ok(!cadRes.isError);
    const cadJson = JSON.parse(cadRes.content[0].text);
    assert.equal(cadJson.success, true);
    assert.ok(cadJson.safetyFactor >= 1.5);
    assert.ok(Array.isArray(cadJson.metrics));

    const b2bRes = await tools["polyglot_migrate_and_verify_b2b"].handler({
      sourceFormat: "simulink",
      modelName: "ServoActuator",
      tolerance: 1e-4,
    });
    assert.ok(!b2bRes.isError);
    const b2bJson = JSON.parse(b2bRes.content[0].text);
    assert.equal(b2bJson.iso26262Certified, true);
    assert.ok(b2bJson.c99Sha256.startsWith("sha256:"));

    const sspRes = await tools["ssp_diagnose_cosim_stability"].handler({
      communicationStepSec: 0.001,
    });
    assert.ok(!sspRes.isError);
    const sspJson = JSON.parse(sspRes.content[0].text);
    assert.ok(sspJson.stabilizedSpectralRadius < 1.0);

    const formalRes = await tools["formal_verify_safety_and_mcdc"].handler({
      modelName: "FlightControlActuator",
      safetyProperty: "abs(pitch_angle_deg) <= 35.0",
    });
    assert.ok(!formalRes.isError);
    const formalJson = JSON.parse(formalRes.content[0].text);
    assert.equal(formalJson.invariantProved, true);
    assert.equal(formalJson.mcdcCoveragePct, 100.0);

    const twinRes = await tools["twin_discover_sindy_and_rom"].handler({
      modelName: "ServoTwin",
      stateVariable: "omega",
      sparsityThreshold: 0.05,
      telemetrySamples: 2000,
    });
    assert.ok(!twinRes.isError);
    const twinJson = JSON.parse(twinRes.content[0].text);
    assert.ok(twinJson.rSquared > 0.99);
    assert.ok(twinJson.romSpeedupFactor > 10);
  });
});
