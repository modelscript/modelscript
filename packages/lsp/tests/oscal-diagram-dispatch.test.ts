// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { createDiagramDispatch } from "../src/diagramApi.js";

test("OSCAL Diagram Dispatch & Data Generation", async (t) => {
  const dummyOscalUri = "file:///workspace/SmartFactoryWorkcell_OT_SSP.oscal.json";

  const sampleOscalJson = JSON.stringify({
    "system-security-plan": {
      uuid: "770e8400-e29b-41d4-a716-446655440000",
      metadata: {
        title: "SmartFactoryWorkcell_OT_SSP",
        version: "1.0.0",
        "oscal-version": "1.1.2",
      },
      "system-characteristics": {
        "system-name": "SmartFactoryWorkcell_OT",
        "security-sensitivity-level": "high",
      },
      "system-implementation": {
        components: [
          {
            uuid: "11111111-e29b-41d4-a716-446655440001",
            title: "SafetyCellControllerPLC",
            type: "plc",
            status: "operational",
          },
          {
            uuid: "22222222-e29b-41d4-a716-446655440002",
            title: "IndustrialDmzFirewall",
            type: "interconnection",
            status: "operational",
          },
          {
            uuid: "33333333-e29b-41d4-a716-446655440003",
            title: "OpcUaTelemetryHistorian",
            type: "service",
            status: "operational",
          },
          {
            uuid: "44444444-e29b-41d4-a716-446655440004",
            title: "QifMetrologyEnterprise",
            type: "software",
            status: "operational",
          },
        ],
      },
      "control-implementation": {
        "implemented-requirements": [
          {
            uuid: "55555555-e29b-41d4-a716-446655440011",
            "control-id": "sc-7",
            "by-components": [
              {
                uuid: "66666666-e29b-41d4-a716-446655440101",
                "component-uuid": "22222222-e29b-41d4-a716-446655440002",
              },
            ],
          },
          {
            uuid: "55555555-e29b-41d4-a716-446655440012",
            "control-id": "ac-3",
            "by-components": [
              {
                uuid: "66666666-e29b-41d4-a716-446655440102",
                "component-uuid": "33333333-e29b-41d4-a716-446655440003",
              },
            ],
          },
        ],
      },
    },
  });

  const genericBackend: any = {
    deps: {
      getDocumentText: (uri: string) => {
        if (uri === dummyOscalUri) return sampleOscalJson;
        return undefined;
      },
    },
    getData: async () => null,
    getComponentProperties: () => null,
    applyEdits: async () => ({ seq: 1, edits: [], renderHint: "none" }),
  };

  const dispatch = createDiagramDispatch({
    generic: genericBackend,
  });

  await t.test(
    "should route .oscal.json to OSCAL domain diagram builder and generate zones and components",
    async () => {
      const data = await dispatch.getData({ uri: dummyOscalUri });

      assert.ok(data, "OSCAL diagram data should be returned");
      assert.strictEqual(data.metadata?.title, "SmartFactoryWorkcell_OT_SSP");

      // Must NOT be the single RootModel fallback
      assert.notStrictEqual(data.nodes.length, 1, "Must not return single RootModel fallback");
      const hasRootModel = data.nodes.some((n: any) => n.id === "RootModel" || n.name === "RootModel");
      assert.strictEqual(hasRootModel, false, "Must not contain RootModel fallback node");

      // Verify boundary and zones
      assert.ok(
        data.nodes.some((n: any) => n.id === "boundary_ato"),
        "Must contain boundary_ato",
      );
      assert.ok(
        data.nodes.some((n: any) => n.id === "zone_Enterprise"),
        "Must contain Enterprise zone",
      );
      assert.ok(
        data.nodes.some((n: any) => n.id === "zone_DMZ"),
        "Must contain DMZ zone",
      );
      assert.ok(
        data.nodes.some((n: any) => n.id === "zone_Supervisory"),
        "Must contain Supervisory zone",
      );
      assert.ok(
        data.nodes.some((n: any) => n.id === "zone_Field-OT"),
        "Must contain Field-OT zone",
      );

      // Verify component nodes
      assert.ok(
        data.nodes.some((n: any) => n.id === "11111111-e29b-41d4-a716-446655440001"),
        "Must contain SafetyCellControllerPLC component",
      );
      assert.ok(
        data.nodes.some((n: any) => n.id === "22222222-e29b-41d4-a716-446655440002"),
        "Must contain IndustrialDmzFirewall component",
      );

      // Verify conduit edges
      assert.ok(data.edges.length > 0, "Must contain synthesized conduit edges");
    },
  );
});
