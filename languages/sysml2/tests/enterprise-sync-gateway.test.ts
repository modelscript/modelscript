// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SysML2EnterpriseSyncGateway, type MmsConfig, type TwcConfig } from "../src/enterprise-sync-gateway.js";
import { getSysmlParser } from "../src/factory.js";
import { OMG_SYSML2_CONTEXT, type SysmlxDocument } from "../src/sysmlx-interchange.js";

describe("SysML v2 Enterprise Sync Gateway: Teamwork Cloud & OpenMBEE MMS (Phase 7)", () => {
  // 1. Teamwork Cloud (TWC) OSMC REST Client
  it("pulls remote model from Cameo Teamwork Cloud (TWC) via OSMC REST API", async () => {
    const mockElements = [
      {
        "@id": "urn:uuid:twc-pkg-1",
        "@type": "Package",
        name: "AvionicsArchitecture",
        ownedElement: [{ "@id": "urn:uuid:twc-part-1" }],
      },
      {
        "@id": "urn:uuid:twc-part-1",
        "@type": "PartDefinition",
        name: "FlightComputer",
        owner: { "@id": "urn:uuid:twc-pkg-1" },
        attributes: {
          declaredName: "FlightComputer",
        },
      },
    ];

    const mockFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      assert.ok(url.includes("/osmc/resources/res-space-1/branches/master/elements"));
      assert.strictEqual(init?.method, "GET");
      const headers = init?.headers as Record<string, string>;
      assert.strictEqual(headers?.Authorization, "Bearer secret-twc-token-123");

      return new Response(
        JSON.stringify({
          "@context": OMG_SYSML2_CONTEXT,
          revision: "rev-twc-42",
          elements: mockElements,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "X-TWC-Revision": "rev-twc-42",
          },
        },
      );
    };

    const config: TwcConfig = {
      baseUrl: "https://twc.aerospace.org:8443",
      resourceId: "res-space-1",
      branch: "master",
      authToken: "secret-twc-token-123",
      fetchFn: mockFetch,
    };

    const result = await SysML2EnterpriseSyncGateway.pullFromTwc(config);

    assert.strictEqual(result.target, "twc");
    assert.strictEqual(result.remoteRevision, "rev-twc-42");
    assert.strictEqual(result.elementCount, 2);
    assert.ok(result.sysmlSource.includes("package AvionicsArchitecture"));
    assert.ok(result.sysmlSource.includes("part def FlightComputer;"));

    // Verify it parses cleanly with WASM GLR parser
    const parser = await getSysmlParser();
    const tree = parser.parse(result.sysmlSource);
    assert.strictEqual(tree.rootNode.hasError(), false, "TWC imported source must parse with 0 errors");
  });

  it("pushes local changes as an atomic revision commit to Teamwork Cloud", async () => {
    let commitPayload: any = null;

    const mockFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      if (init?.method === "GET") {
        // Return base revision with only Package
        return new Response(
          JSON.stringify({
            "@context": OMG_SYSML2_CONTEXT,
            revision: "rev-twc-42",
            elements: [
              {
                "@id": "urn:uuid:twc-pkg-1",
                "@type": "Package",
                name: "AvionicsArchitecture",
                qualifiedName: "AvionicsArchitecture",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (init?.method === "POST") {
        assert.ok(url.includes("/osmc/resources/res-space-1/branches/master/revisions"));
        commitPayload = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            revisionId: "rev-twc-43",
            committed: true,
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      }

      throw new Error(`Unexpected request: ${init?.method} ${url}`);
    };

    const config: TwcConfig = {
      baseUrl: "https://twc.aerospace.org:8443",
      resourceId: "res-space-1",
      authToken: "secret-twc-token-123",
      fetchFn: mockFetch,
    };

    const updatedSysml = `
      package AvionicsArchitecture {
        part def FlightComputer {
          attribute clockSpeed : ScalarValues::Real = 2.4;
        }
      }
    `;

    const pushResult = await SysML2EnterpriseSyncGateway.pushToTwc(config, updatedSysml, {
      commitMessage: "Add FlightComputer with clockSpeed attribute",
      author: "Chief Systems Architect",
    });

    assert.strictEqual(pushResult.success, true);
    assert.strictEqual(pushResult.newRevision, "rev-twc-43");
    assert.ok(pushResult.elementsCommitted > 0);
    assert.ok(commitPayload, "Commit payload must be sent to TWC");
    assert.strictEqual(commitPayload.description, "Add FlightComputer with clockSpeed attribute");
    assert.strictEqual(commitPayload.author, "Chief Systems Architect");
    assert.ok(commitPayload.changes.added.length > 0, "FlightComputer should be registered as added");
  });

  // 2. OpenMBEE Model Management System (MMS)
  it("pulls and synchronizes elements from OpenMBEE MMS", async () => {
    const mockMmsElements = [
      {
        id: "mms-pkg-payload",
        type: "Package",
        name: "EuropaPayload",
        qualifiedName: "EuropaPayload",
      },
      {
        id: "mms-part-radar",
        type: "PartDefinition",
        name: "IcePenetratingRadar",
        qualifiedName: "EuropaPayload::IcePenetratingRadar",
        ownerId: "mms-pkg-payload",
        attributes: {
          powerKw: 1.5,
        },
      },
    ];

    const mockFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      assert.ok(url.includes("/orgs/nasa-jpl/projects/europa-clipper/refs/master/elements"));
      return new Response(
        JSON.stringify({
          commitId: "commit-mms-9901",
          elements: mockMmsElements,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const config: MmsConfig = {
      baseUrl: "https://mms.jpl.nasa.gov",
      orgId: "nasa-jpl",
      projectId: "europa-clipper",
      refId: "master",
      authToken: "mms-jwt-token-xyz",
      fetchFn: mockFetch,
    };

    const pullResult = await SysML2EnterpriseSyncGateway.pullFromMms(config);
    assert.strictEqual(pullResult.target, "mms");
    assert.strictEqual(pullResult.remoteRevision, "commit-mms-9901");
    assert.ok(pullResult.sysmlSource.includes("package EuropaPayload"));
    assert.ok(pullResult.sysmlSource.includes("part def IcePenetratingRadar;"));
  });

  it("pushes local SysML v2 updates as a commit to OpenMBEE MMS", async () => {
    let mmsPayload: any = null;

    const mockFetch: typeof fetch = async (input, init) => {
      if (init?.method === "GET") {
        return new Response(
          JSON.stringify({
            commitId: "commit-mms-9901",
            elements: [
              {
                id: "mms-pkg-payload",
                type: "Package",
                name: "EuropaPayload",
                qualifiedName: "EuropaPayload",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (init?.method === "POST") {
        mmsPayload = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            commitId: "commit-mms-9902",
            elements: mmsPayload.elements,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      throw new Error(`Unexpected request: ${init?.method}`);
    };

    const config: MmsConfig = {
      baseUrl: "https://mms.jpl.nasa.gov",
      orgId: "nasa-jpl",
      projectId: "europa-clipper",
      fetchFn: mockFetch,
    };

    const newSysml = `
      package EuropaPayload {
        part def Magnetometer;
      }
    `;

    const pushResult = await SysML2EnterpriseSyncGateway.pushToMms(config, newSysml, {
      commitMessage: "Add Magnetometer sensor payload",
    });

    assert.strictEqual(pushResult.success, true);
    assert.strictEqual(pushResult.newRevision, "commit-mms-9902");
    assert.ok(mmsPayload.elements.length > 0);
    assert.strictEqual(mmsPayload.comment, "Add Magnetometer sensor payload");
  });

  // 3. Three-way Semantic Change Detection & Merge Conflicts
  it("detects property-level semantic modifications and flags merge conflicts", () => {
    const localDoc: SysmlxDocument = {
      "@context": OMG_SYSML2_CONTEXT,
      "@graph": [
        {
          "@id": "urn:uuid:p1",
          "@type": "PartDefinition",
          name: "Thruster",
          qualifiedName: "Propulsion::Thruster",
          attributes: {
            type: "ChemicalThruster",
            defaultValue: "220N",
          },
        },
      ],
    };

    const remoteDocConflict: SysmlxDocument = {
      "@context": OMG_SYSML2_CONTEXT,
      "@graph": [
        {
          "@id": "urn:uuid:p1",
          "@type": "PartDefinition",
          name: "Thruster",
          qualifiedName: "Propulsion::Thruster",
          attributes: {
            type: "ElectricIonThruster", // Divergent edit
            defaultValue: "50mN",
          },
        },
      ],
    };

    const diff = SysML2EnterpriseSyncGateway.computeSyncDiff(localDoc, remoteDocConflict);
    assert.strictEqual(diff.hasChanges, true);
    assert.strictEqual(diff.hasConflicts, true);
    assert.strictEqual(diff.modifiedCount, 1);
    assert.strictEqual(diff.conflictCount, 1);

    const thrusterDiff = diff.diffs[0];
    assert.ok(thrusterDiff?.conflicts);
    assert.ok(thrusterDiff.conflicts.some((c) => c.includes("ChemicalThruster") && c.includes("ElectricIonThruster")));
  });

  it("prevents accidental overwrites on conflict without force flag", async () => {
    const mockFetch: typeof fetch = async (input, init) => {
      // Remote has divergent attribute
      return new Response(
        JSON.stringify({
          "@context": OMG_SYSML2_CONTEXT,
          revision: "rev-100",
          elements: [
            {
              "@id": "urn:uuid:elem-1",
              "@type": "PartDefinition",
              name: "Battery",
              qualifiedName: "Power::Battery",
              attributes: {
                type: "LiFePO4",
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const config: TwcConfig = {
      baseUrl: "https://twc.org",
      resourceId: "res-power",
      fetchFn: mockFetch,
    };

    const conflictingSysml = `
      package Power {
        part def Battery {
          attribute chemistry : NMC;
        }
      }
    `;

    // Should reject without force
    await assert.rejects(
      async () => {
        await SysML2EnterpriseSyncGateway.pushToTwc(config, conflictingSysml, {
          commitMessage: "Switch battery chemistry",
          force: false,
        });
      },
      /Merge conflict detected/,
      "Push must throw when conflict detected and force is false",
    );
  });
});
