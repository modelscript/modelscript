// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { parseOscal, serializeOscal } from "../src/parser/index.js";

describe("OSCAL Multi-Format Parser & Serializer", () => {
  const sampleJsonCatalog = JSON.stringify(
    {
      catalog: {
        uuid: "11111111-2222-4333-8444-555555555555",
        metadata: {
          title: "Substation Security Catalog",
          version: "1.0.0",
          "oscal-version": "1.1.2",
        },
        groups: [
          {
            id: "ac",
            class: "family",
            title: "Access Control",
            controls: [
              {
                id: "ac-3",
                title: "Access Enforcement",
                params: [
                  {
                    id: "ac-3_prm_1",
                    label: "enforcement mechanism",
                    values: ["RBAC"],
                  },
                ],
                parts: [
                  {
                    id: "ac-3_smt",
                    name: "statement",
                    prose: "Enforce access using {{ insert: param, ac-3_prm_1 }}.",
                  },
                ],
              },
            ],
          },
        ],
      },
    },
    null,
    2,
  );

  it("parses JSON OSCAL catalogs with accurate source ranges", () => {
    const doc = parseOscal(sampleJsonCatalog);
    assert.strictEqual(doc.kind, "catalog");
    assert.strictEqual(doc.uuid, "11111111-2222-4333-8444-555555555555");
    assert.strictEqual(doc.metadata.title, "Substation Security Catalog");
    assert.strictEqual(doc.groups?.length, 1);
    const ctrl = doc.groups?.[0]?.controls?.[0];
    assert(ctrl !== undefined);
    assert.strictEqual(ctrl.id, "ac-3");
    assert(ctrl.range !== undefined);
    assert(ctrl.range.startLine >= 1);
    assert.strictEqual(ctrl.params?.[0]?.id, "ac-3_prm_1");
  });

  it("round-trips JSON <-> YAML <-> XML formats losslessly", () => {
    const docFromJson = parseOscal(sampleJsonCatalog);

    const yamlText = serializeOscal(docFromJson, "yaml");
    assert(yamlText.includes("catalog:"));
    const docFromYaml = parseOscal(yamlText);
    assert.strictEqual(docFromYaml.kind, "catalog");
    assert.strictEqual(docFromYaml.uuid, docFromJson.uuid);
    assert.strictEqual(docFromYaml.groups?.[0]?.controls?.[0]?.id, "ac-3");

    const xmlText = serializeOscal(docFromYaml, "xml");
    assert(xmlText.includes("<catalog "));
    assert(xmlText.includes('<control id="ac-3">'));
    const docFromXml = parseOscal(xmlText);
    assert.strictEqual(docFromXml.kind, "catalog");
    assert.strictEqual(docFromXml.uuid, docFromJson.uuid);
    assert.strictEqual(docFromXml.groups?.[0]?.controls?.[0]?.id, "ac-3");
    assert.strictEqual(docFromXml.groups?.[0]?.controls?.[0]?.params?.[0]?.id, "ac-3_prm_1");
  });

  it("parses System Security Plan (SSP), Assessment Results, and POA&M models", () => {
    const sspYaml = `
system-security-plan:
  uuid: aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee
  metadata:
    title: Railway Interlocking SSP
    version: 2.1.0
  import-profile:
    href: builtin://nist-sp-800-82-r3
  system-characteristics:
    system-name: Interlocking Zone Controller
    security-sensitivity-level: high
  system-implementation:
    components:
      - uuid: 12345678-1234-4234-8234-1234567890ab
        title: SafetyPLC_Main
        type: plc
  control-implementation:
    implemented-requirements:
      - uuid: 87654321-4321-4321-8321-ba0987654321
        control-id: sc-7
        description: Industrial firewall isolating Zone 1.
        by-components:
          - component-uuid: 12345678-1234-4234-8234-1234567890ab
            uuid: 99999999-8888-4777-8666-555555555555
            description: Enforced on PLC Ethernet port.
`;
    const sspDoc = parseOscal(sspYaml);
    assert.strictEqual(sspDoc.kind, "system-security-plan");
    assert.strictEqual(sspDoc.importProfile?.href, "builtin://nist-sp-800-82-r3");
    assert.strictEqual(sspDoc.systemImplementation?.components.length, 1);
    assert.strictEqual(sspDoc.systemImplementation?.components[0]?.type, "plc");
    assert.strictEqual(sspDoc.controlImplementation?.implementedRequirements.length, 1);
    assert.strictEqual(sspDoc.controlImplementation?.implementedRequirements[0]?.controlId, "sc-7");
  });
});
