// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  executeOscalAction,
  getOscalCompletions,
  getOscalDefinition,
  getOscalDocumentSymbols,
  getOscalHover,
  validateOscal,
} from "../src/lsp.js";

describe("OSCAL Language Server Protocol (LSP) Services", () => {
  const validSspJson = JSON.stringify(
    {
      "system-security-plan": {
        uuid: "11111111-2222-4333-8444-555555555555",
        metadata: {
          title: "SCADA Control Center SSP",
          version: "1.2.0",
        },
        "system-implementation": {
          components: [
            {
              uuid: "22222222-2222-4333-8444-555555555555",
              title: "MainSCADAServer",
              type: "software",
            },
          ],
        },
        "control-implementation": {
          "set-parameters": [
            {
              "param-id": "sc-7_prm_1",
              values: ["redundant industrial DMZ firewalls"],
            },
          ],
          "implemented-requirements": [
            {
              uuid: "33333333-2222-4333-8444-555555555555",
              "control-id": "sc-7",
              description: "Boundary protection via DMZ.",
              "by-components": [
                {
                  "component-uuid": "22222222-2222-4333-8444-555555555555",
                  uuid: "44444444-2222-4333-8444-555555555555",
                  description: "Configured on MainSCADAServer.",
                },
              ],
            },
          ],
        },
      },
    },
    null,
    2,
  );

  it("validates OSCAL documents and returns 0 diagnostics for valid SSP", () => {
    const diags = validateOscal(validSspJson);
    assert.strictEqual(diags.length, 0);
  });

  it("extracts hierarchical LSP document symbols", () => {
    const symbols = getOscalDocumentSymbols(validSspJson);
    assert.strictEqual(symbols.length, 1);
    assert.strictEqual(symbols[0]?.name, "SCADA Control Center SSP");
    assert((symbols[0]?.children?.length ?? 0) >= 2);
  });

  it("provides live resolved NIST SP 800-53 control prose with parameter substitution on hover", () => {
    const sc7Offset = validSspJson.indexOf("sc-7") + 1;
    const hover = getOscalHover(validSspJson, sc7Offset);
    assert(hover !== null);
    assert(hover.contents.value.includes("SC-7"));
    assert(hover.contents.value.includes("Boundary Protection"));
    assert(hover.contents.value.includes("redundant industrial DMZ firewalls"));
  });

  it("provides completions for NIST SP 800-53 controls, parameters, and component UUIDs", () => {
    const completions = getOscalCompletions(validSspJson);
    assert(completions.some((c) => c.label === "sc-7"));
    assert(completions.some((c) => c.label === "ac-3"));
    assert(completions.some((c) => c.label === "22222222-2222-4333-8444-555555555555"));
  });

  it("resolves go-to-definition for component UUID references", () => {
    const refOffset = validSspJson.lastIndexOf("22222222-2222-4333-8444-555555555555") + 3;
    const defRange = getOscalDefinition(validSspJson, refOffset);
    assert(defRange !== null);
    assert(defRange.start.line >= 0);
  });

  it("executes custom OSCAL domain actions via executeOscalAction", async () => {
    const sysml = await executeOscalAction("oscal_to_sysml2", validSspJson);
    assert(sysml.includes("Control_SC_7"));

    const yaml = await executeOscalAction("oscal_convert", validSspJson, { format: "yaml" });
    assert(yaml.includes("system-security-plan:"));
  });
});
