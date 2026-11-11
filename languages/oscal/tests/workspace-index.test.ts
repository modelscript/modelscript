// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert";
import { describe, it } from "node:test";
import { oscalLanguage, resolveOscalInScope } from "../src/index.js";

describe("OSCAL UnifiedWorkspace Indexing", () => {
  const catalogJson = JSON.stringify({
    catalog: {
      uuid: "11111111-2222-4333-8444-555555555555",
      metadata: { title: "OT Catalog", version: "1.0.0" },
      groups: [
        {
          id: "sc",
          title: "System and Communications Protection",
          controls: [
            {
              id: "sc-7",
              title: "Boundary Protection",
              params: [{ id: "sc-7_prm_1", label: "boundary mechanisms" }],
            },
          ],
        },
      ],
    },
  });

  const sspJson = JSON.stringify({
    "system-security-plan": {
      uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      metadata: { title: "Substation SSP", version: "1.0.0" },
      "system-implementation": {
        components: [
          {
            uuid: "22222222-3333-4444-8555-666666666666",
            title: "BayControllerIED",
            type: "ied",
          },
        ],
      },
      "control-implementation": {
        "implemented-requirements": [
          {
            uuid: "77777777-3333-4444-8555-666666666666",
            "control-id": "sc-7",
          },
        ],
      },
    },
  });

  it("indexes multiple OSCAL files and resolves controls, parameters, and components across the workspace", () => {
    const ws = new UnifiedWorkspace(oscalLanguage);
    ws.setDocument("file:///workspace/catalog.oscal.json", catalogJson);
    ws.setDocument("file:///workspace/ssp.oscal.json", sspJson);

    assert.strictEqual(ws.fileCount, 2);
    assert(ws.hasDocument("file:///workspace/catalog.oscal.json"));
    assert(ws.hasDocument("file:///workspace/ssp.oscal.json"));

    const sc7Entries = ws.findSymbolsByName("sc-7");
    assert.strictEqual(sc7Entries.length, 2);

    const iedByTitle = ws.findSymbolsByName("BayControllerIED");
    assert.strictEqual(iedByTitle.length, 1);
    assert.strictEqual(iedByTitle[0]?.kind, "Component");

    const iedByUuid = ws.findSymbolsByName("22222222-3333-4444-8555-666666666666");
    assert.strictEqual(iedByUuid.length, 1);

    const resolvedParam = resolveOscalInScope(ws, "sc-7_prm_1", null, "file:///workspace/catalog.oscal.json");
    assert(resolvedParam !== null);
    assert.strictEqual(resolvedParam.ruleName, "oscal_parameter");

    ws.clear();
    assert.strictEqual(ws.fileCount, 0);
  });
});
