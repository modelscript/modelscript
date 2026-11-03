// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { OscalWorkspaceIndex } from "../src/workspace-index.js";

describe("OscalWorkspaceIndex", () => {
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
    const index = new OscalWorkspaceIndex();
    index.indexFile("file:///workspace/catalog.oscal.json", catalogJson);
    index.indexFile("file:///workspace/ssp.oscal.json", sspJson);

    assert.strictEqual(index.fileCount, 2);
    assert(index.has("file:///workspace/catalog.oscal.json"));
    assert(index.has("file:///workspace/ssp.oscal.json"));

    const sc7Entries = index.findByName("sc-7");
    assert.strictEqual(sc7Entries.length, 2);

    const iedByTitle = index.findByName("BayControllerIED");
    assert.strictEqual(iedByTitle.length, 1);
    assert.strictEqual(iedByTitle[0]?.kind, "Component");

    const iedByUuid = index.findByName("22222222-3333-4444-8555-666666666666");
    assert.strictEqual(iedByUuid.length, 1);

    const resolvedParam = index.resolveInScope("sc-7_prm_1", null, "file:///workspace/catalog.oscal.json");
    assert(resolvedParam !== null);
    assert.strictEqual(resolvedParam.ruleName, "oscal_parameter");

    index.clear();
    assert.strictEqual(index.fileCount, 0);
  });
});
