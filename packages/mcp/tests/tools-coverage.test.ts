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
    const res = await tool.handler({});
    assert.ok(res.content[0].text.includes("compiler query engine"));
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
});
