// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import {
  JiraConnector,
  extractImpactedModels,
  mapJiraPriorityToSeverity,
  mapJiraStatusToState,
  parseAdfToMarkdown,
} from "../src/services/integrations/jira-connector.js";

test("Jira Connector — ADF to Markdown parser", () => {
  // 1. Plain text fallback
  assert.strictEqual(parseAdfToMarkdown("Simple plain text description"), "Simple plain text description");
  assert.strictEqual(parseAdfToMarkdown(""), "");
  assert.strictEqual(parseAdfToMarkdown(null), "");

  // 2. Structured ADF document
  const adf = {
    type: "doc",
    version: 1,
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Thermal Convergence Failure" }],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "The " },
          { type: "text", text: "compressor model", marks: [{ type: "strong" }] },
          { type: "text", text: " exhibits chattering around " },
          { type: "text", text: "t = 4.2s", marks: [{ type: "code" }] },
          { type: "text", text: ". See " },
          {
            type: "text",
            text: "benchmark docs",
            marks: [{ type: "link", attrs: { href: "https://ansatz.social/docs" } }],
          },
          { type: "text", text: "." },
        ],
      },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: "Solver: SUNDIALS CVODE" }] }],
          },
          {
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: "Tolerance: 1e-6" }] }],
          },
        ],
      },
      {
        type: "codeBlock",
        attrs: { language: "modelica" },
        content: [
          {
            type: "text",
            text: "model TestChattering\n  Real x(start=1.0);\nequation\n  der(x) = -x;\nend TestChattering;",
          },
        ],
      },
    ],
  };

  const md = parseAdfToMarkdown(adf);
  assert.ok(md.includes("## Thermal Convergence Failure"));
  assert.ok(md.includes("**compressor model**"));
  assert.ok(md.includes("`t = 4.2s`"));
  assert.ok(md.includes("[benchmark docs](https://ansatz.social/docs)"));
  assert.ok(md.includes("* Solver: SUNDIALS CVODE"));
  assert.ok(md.includes("```modelica\nmodel TestChattering"));

  // 3. Stringified JSON ADF
  const strAdf = JSON.stringify(adf);
  const parsedFromStr = parseAdfToMarkdown(strAdf);
  assert.ok(parsedFromStr.includes("## Thermal Convergence Failure"));
});

test("Jira Connector — Impacted Models Extractor", () => {
  const text = `
    Investigation for hydraulic subsystem.
    @model:Modelica.Fluid.Valves.TwoWay
    Found pressure spike in model: Aerospace.Propulsion.CompressorStage
    and component: SafetyReliefValve.
    Also check subsystem: HydraulicActuation and \`Modelica.Electrical.Analog.Basic.Resistor\`.
  `;

  const models = extractImpactedModels(text, ["Custom.BatteryPack", "Custom.Inverter"]);

  assert.ok(models.includes("Modelica.Fluid.Valves.TwoWay"));
  assert.ok(models.includes("Aerospace.Propulsion.CompressorStage"));
  assert.ok(models.includes("SafetyReliefValve"));
  assert.ok(models.includes("HydraulicActuation"));
  assert.ok(models.includes("Modelica.Electrical.Analog.Basic.Resistor"));
  assert.ok(models.includes("Custom.BatteryPack"));
  assert.ok(models.includes("Custom.Inverter"));
});

test("Jira Connector — Priority and Status Mapping", () => {
  // Priorities -> Severities
  assert.strictEqual(mapJiraPriorityToSeverity("Blocker"), "safety_critical");
  assert.strictEqual(mapJiraPriorityToSeverity("Highest"), "safety_critical");
  assert.strictEqual(mapJiraPriorityToSeverity("Critical"), "safety_critical");
  assert.strictEqual(mapJiraPriorityToSeverity("High"), "major");
  assert.strictEqual(mapJiraPriorityToSeverity("Medium"), "standard");
  assert.strictEqual(mapJiraPriorityToSeverity("Low"), "minor");
  assert.strictEqual(mapJiraPriorityToSeverity("Lowest"), "minor");
  assert.strictEqual(mapJiraPriorityToSeverity(undefined), "standard");

  // Status -> State
  assert.strictEqual(mapJiraStatusToState("done", "Closed"), "closed");
  assert.strictEqual(mapJiraStatusToState("indeterminate", "Resolved"), "closed");
  assert.strictEqual(mapJiraStatusToState("new", "Open"), "open");
  assert.strictEqual(mapJiraStatusToState("indeterminate", "In Progress"), "open");
});

test("Jira Connector — Issue Normalization", () => {
  const connector = new JiraConnector({
    baseUrl: "https://acme.atlassian.net",
    auth: { email: "eng@acme.com", apiToken: "token-secret" },
  });

  const rawIssue = {
    id: "10042",
    key: "AERO-501",
    fields: {
      summary: "Inverter thermal runaway at 120C",
      description: "Model verification failed for model: Modelica.Electrical.Machines.Basic.InductionMachine.",
      status: {
        name: "In Progress",
        statusCategory: { key: "indeterminate" },
      },
      priority: { name: "High" },
      labels: ["thermal", "power-electronics"],
      created: "2026-11-01T10:00:00.000Z",
      updated: "2026-11-08T15:30:00.000Z",
      assignee: { displayName: "Ada Lovelace", emailAddress: "ada@acme.com" },
      creator: { displayName: "Nikola Tesla" },
    },
  };

  const normalized = connector.normalizeIssue(rawIssue);

  assert.strictEqual(normalized.key, "AERO-501");
  assert.strictEqual(normalized.title, "Inverter thermal runaway at 120C");
  assert.strictEqual(normalized.status, "open");
  assert.strictEqual(normalized.severity, "major");
  assert.strictEqual(normalized.browseUrl, "https://acme.atlassian.net/browse/AERO-501");
  assert.deepStrictEqual(normalized.labels, ["thermal", "power-electronics"]);
  assert.ok(normalized.impactedModels.includes("Modelica.Electrical.Machines.Basic.InductionMachine"));
  assert.strictEqual(normalized.assignee?.displayName, "Ada Lovelace");
});
