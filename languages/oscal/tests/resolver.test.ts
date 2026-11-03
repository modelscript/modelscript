// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { parseOscal } from "../src/parser/index.js";
import { resolveOscalProfile } from "../src/resolver/index.js";

describe("OSCAL Profile Resolution Pipeline", () => {
  it("resolves imports (include-controls / exclude-controls), set-parameter overrides, and alter prose additions", () => {
    const profileJson = JSON.stringify({
      profile: {
        uuid: "f0f0f0f0-1111-4222-8333-444444444444",
        metadata: {
          title: "Substation OT Tailored Profile",
          version: "1.0.0",
        },
        imports: [
          {
            href: "builtin://nist-sp-800-53-r5",
            "include-controls": ["ac-2", "ac-3", "sc-7", "si-7"],
            "exclude-controls": ["ac-2"],
          },
        ],
        modify: {
          "set-parameters": [
            {
              "param-id": "sc-7_prm_1",
              values: ["unidirectional optical data diodes at Purdue Level 3.5"],
            },
          ],
          alters: [
            {
              "control-id": "sc-7",
              adds: [
                {
                  position: "ending",
                  parts: [
                    {
                      name: "substation-supplement",
                      prose: "All IEC 61850 GOOSE traffic must remain strictly within the station bus VLAN.",
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    });

    const profileDoc = parseOscal(profileJson);
    const resolved = resolveOscalProfile(profileDoc);

    // ac-2 was excluded; ac-3, sc-7, si-7 remain
    assert.strictEqual(resolved.controls.length, 3);
    assert(!resolved.controls.some((c) => c.id === "ac-2"));

    const sc7 = resolved.controls.find((c) => c.id === "sc-7");
    assert(sc7 !== undefined);
    assert(
      sc7.resolvedProse.includes("unidirectional optical data diodes at Purdue Level 3.5"),
      "Expected parameter sc-7_prm_1 to be substituted into sc-7 prose",
    );
    assert(
      sc7.resolvedProse.includes("All IEC 61850 GOOSE traffic must remain strictly within the station bus VLAN."),
      "Expected alter addition part to be appended to sc-7 prose",
    );
    assert.strictEqual(
      resolved.parameterValues["sc-7_prm_1"],
      "unidirectional optical data diodes at Purdue Level 3.5",
    );
  });
});
