// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { lintOscalDocument } from "../src/lints/index.js";
import { parseOscal } from "../src/parser/index.js";

describe("OSCAL Constraint & CPS Compliance Linter (M8201–M8208)", () => {
  it("detects M8201 (malformed or duplicate UUID)", () => {
    const doc = parseOscal(
      JSON.stringify({
        "component-definition": {
          uuid: "not-a-valid-uuid",
          metadata: { title: "Bad UUID Test", version: "1.0" },
          components: [
            {
              uuid: "11111111-2222-4333-8444-555555555555",
              title: "CompA",
              type: "software",
            },
            {
              uuid: "11111111-2222-4333-8444-555555555555",
              title: "CompB_Duplicate",
              type: "software",
            },
          ],
        },
      }),
    );
    const diags = lintOscalDocument(doc);
    const m8201 = diags.filter((d) => d.code === "M8201");
    assert.strictEqual(m8201.length, 2);
  });

  it("detects M8202 (unresolved control-id)", () => {
    const doc = parseOscal(
      JSON.stringify({
        profile: {
          uuid: "11111111-2222-4333-8444-555555555555",
          metadata: { title: "Profile", version: "1.0" },
          imports: [
            {
              href: "builtin://nist-sp-800-53-r5",
              "include-controls": ["ac-3", "xx-999"],
            },
          ],
        },
      }),
    );
    const diags = lintOscalDocument(doc);
    assert(diags.some((d) => d.code === "M8202" && d.message.includes("'xx-999'")));
  });

  it("detects M8203 (unset required parameter)", () => {
    const doc = parseOscal(
      JSON.stringify({
        profile: {
          uuid: "11111111-2222-4333-8444-555555555555",
          metadata: { title: "Profile Unset Param", version: "1.0" },
          imports: [
            {
              href: "builtin://nist-sp-800-53-r5",
              "include-controls": ["ac-17"],
            },
          ],
        },
      }),
    );
    const diags = lintOscalDocument(doc);
    assert(diags.some((d) => d.code === "M8203" && d.message.includes("'ac-17_prm_1'")));
  });

  it("detects M8204 (unimplemented baseline control) and M8205 (orphaned by-component)", () => {
    const doc = parseOscal(
      JSON.stringify({
        "system-security-plan": {
          uuid: "11111111-2222-4333-8444-555555555555",
          metadata: { title: "Incomplete SSP", version: "1.0" },
          "import-profile": {
            href: "builtin://nist-sp-800-82-r3-ot",
          },
          "system-implementation": {
            components: [
              {
                uuid: "22222222-2222-4333-8444-555555555555",
                title: "HMI_Server",
                type: "software",
              },
            ],
          },
          "control-implementation": {
            "implemented-requirements": [
              {
                uuid: "33333333-2222-4333-8444-555555555555",
                "control-id": "sc-7",
                "by-components": [
                  {
                    "component-uuid": "99999999-9999-4999-8999-999999999999",
                    uuid: "44444444-2222-4333-8444-555555555555",
                    description: "References non-existent component UUID",
                  },
                ],
              },
            ],
          },
        },
      }),
    );
    const diags = lintOscalDocument(doc);
    assert(diags.some((d) => d.code === "M8204" && d.message.includes("'ac-3'")));
    assert(diags.some((d) => d.code === "M8205" && d.message.includes("'99999999-9999-4999-8999-999999999999'")));
  });

  it("detects M8206 (unmapped CPS architecture block) and M8207 (OT/ICS overlay violation)", () => {
    const doc = parseOscal(
      JSON.stringify({
        "system-security-plan": {
          uuid: "11111111-2222-4333-8444-555555555555",
          metadata: { title: "OT Plant SSP", version: "1.0" },
          "system-implementation": {
            components: [
              {
                uuid: "22222222-2222-4333-8444-555555555555",
                title: "TurbineGovernorPLC",
                type: "plc",
              },
            ],
          },
          "control-implementation": {
            "implemented-requirements": [
              {
                uuid: "33333333-2222-4333-8444-555555555555",
                "control-id": "sc-7",
              },
            ],
          },
        },
      }),
    );
    const diags = lintOscalDocument(doc, {
      externalArchComponents: ["TurbineGovernorPLC", "BoilerSafetyIED"],
    });
    assert(diags.some((d) => d.code === "M8206" && d.message.includes("'BoilerSafetyIED'")));
    assert(diags.some((d) => d.code === "M8207" && d.message.includes("'TurbineGovernorPLC'")));
  });

  it("detects M8208 (unmitigated high/critical open finding without POA&M)", () => {
    const doc = parseOscal(
      JSON.stringify({
        "assessment-results": {
          uuid: "11111111-2222-4333-8444-555555555555",
          metadata: { title: "Penetration Test Results", version: "1.0" },
          findings: [
            {
              uuid: "22222222-2222-4333-8444-555555555555",
              title: "Unauthenticated Modbus Write Access",
              "target-control-id": "ac-3",
              severity: "critical",
              status: "open",
            },
          ],
        },
      }),
    );
    const diags = lintOscalDocument(doc);
    assert(diags.some((d) => d.code === "M8208" && d.message.includes("'Unauthenticated Modbus Write Access'")));
  });

  it("detects M8209, M8210, M8211, M8212, and M8213", () => {
    const sspDoc = parseOscal(
      JSON.stringify({
        "system-security-plan": {
          uuid: "11111111-2222-4333-8444-555555555555",
          metadata: {
            title: "Extended Compliance SSP",
            version: "1.0",
            parties: [{ uuid: "aaaaaaaa-2222-4333-8444-555555555555", type: "organization", name: "OpsTeam" }],
            "responsible-parties": [
              { "role-id": "system-owner", "party-uuids": ["bbbbbbbb-2222-4333-8444-555555555555"] },
            ],
            props: [{ name: "hash-algorithm", value: "SHA-1" }],
          },
          "system-characteristics": {
            "system-name": "SubstationGateway",
            "authorization-boundary": { description: "Substation ESP boundary" },
          },
          "system-implementation": {
            components: [
              {
                uuid: "22222222-2222-4333-8444-555555555555",
                title: "UnassignedGateway",
                type: "software",
              },
            ],
          },
          "control-implementation": {
            "implemented-requirements": [
              {
                uuid: "33333333-2222-4333-8444-555555555555",
                "control-id": "ac-3",
                statements: [
                  {
                    "statement-id": "ac-3_smt.a",
                    uuid: "44444444-2222-4333-8444-555555555555",
                  },
                ],
              },
            ],
          },
        },
      }),
    );
    const diags = lintOscalDocument(sspDoc, {
      poamItems: [
        {
          uuid: "55555555-2222-4333-8444-555555555555",
          title: "POAM-01",
          status: "in-progress",
          milestones: [
            {
              uuid: "66666666-2222-4333-8444-555555555555",
              title: "Patch Firmware",
              dueDate: "2020-01-15T00:00:00Z",
            },
          ],
        },
      ],
    });
    assert(diags.some((d) => d.code === "M8209" && d.message.includes("'ac-3_smt.a'")));
    assert(diags.some((d) => d.code === "M8210" && d.message.includes("'UnassignedGateway'")));
    assert(diags.some((d) => d.code === "M8211" && d.message.includes("'SHA-1'")));
    assert(diags.some((d) => d.code === "M8212" && d.message.includes("'bbbbbbbb-2222-4333-8444-555555555555'")));
    assert(diags.some((d) => d.code === "M8213" && d.message.includes("'2020-01-15T00:00:00Z'")));
  });
});
