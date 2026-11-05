// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOscalDiagram,
  renderOscalBoundarySvg,
  renderOscalControlMatrixSvg,
  type OscalDocumentLike,
} from "../src/oscal-diagram-builder.js";

const sampleSspDoc: OscalDocumentLike = {
  kind: "system-security-plan",
  uuid: "770e8400-e29b-41d4-a716-446655440000",
  title: "SmartFactoryWorkcell_OT_SSP",
  systemName: "SmartFactoryWorkcell_OT",
  securitySensitivityLevel: "high",
  components: [
    {
      uuid: "comp-plc-1",
      title: "SafetyCellControllerPLC",
      type: "plc",
      status: "operational",
      zone: "Field-OT",
      implementedControls: ["SC-7", "AC-3", "SI-7", "PE-3"],
    },
    {
      uuid: "comp-historian-1",
      title: "OpcUaTelemetryHistorian",
      type: "service",
      status: "operational",
      zone: "Supervisory",
      implementedControls: ["AC-3"],
    },
    {
      uuid: "comp-firewall-1",
      title: "IndustrialDmzFirewall",
      type: "interconnection",
      status: "operational",
      zone: "DMZ",
      implementedControls: ["SC-7"],
    },
    {
      uuid: "comp-qif-1",
      title: "QifMetrologyEnterprise",
      type: "software",
      status: "operational",
      zone: "DMZ",
      implementedControls: ["SI-7"],
    },
  ],
  implementedRequirements: [
    {
      controlId: "sc-7",
      byComponents: [{ componentUuid: "comp-firewall-1" }, { componentUuid: "comp-plc-1" }],
    },
    {
      controlId: "ac-3",
      byComponents: [{ componentUuid: "comp-historian-1" }, { componentUuid: "comp-plc-1" }],
    },
  ],
  findings: [
    {
      uuid: "find-1",
      title: "Outdated firmware",
      targetControlId: "si-7",
      targetComponentUuid: "comp-plc-1",
      severity: "high",
      status: "open",
    },
  ],
};

test("OSCAL Diagram Builder — Interactive Graph & SVG Parity", async (t) => {
  await t.test("buildOscalDiagram creates zones, component nodes, ports, and conduits", () => {
    const graph = buildOscalDiagram(sampleSspDoc);

    assert.ok(graph, "Should return graph object");
    assert.strictEqual(graph.title, "SmartFactoryWorkcell_OT_SSP");
    assert.strictEqual(graph.metadata.componentCount, 4);

    // Verify boundary and Purdue zone containers
    const boundaryCell = graph.nodes.find((n) => n.id === "boundary_ato");
    assert.ok(boundaryCell, "Must contain boundary_ato node");
    assert.ok(
      graph.nodes.some((n) => n.id === "zone_Enterprise"),
      "Must contain Enterprise zone",
    );
    assert.ok(
      graph.nodes.some((n) => n.id === "zone_DMZ"),
      "Must contain DMZ zone",
    );
    assert.ok(
      graph.nodes.some((n) => n.id === "zone_Supervisory"),
      "Must contain Supervisory zone",
    );
    assert.ok(
      graph.nodes.some((n) => n.id === "zone_Field-OT"),
      "Must contain Field-OT zone",
    );

    // Verify component nodes
    const plcNode = graph.nodes.find((n) => n.id === "comp-plc-1");
    assert.ok(plcNode, "Must contain SafetyCellControllerPLC node");
    assert.strictEqual(plcNode.data?.["type"], "plc");
    assert.strictEqual(plcNode.data?.["severity"], "high"); // Open high finding

    const firewallNode = graph.nodes.find((n) => n.id === "comp-firewall-1");
    assert.ok(firewallNode, "Must contain IndustrialDmzFirewall node");

    // Verify ports exist on component nodes
    assert.ok(plcNode.ports, "Component must have ports");

    // Verify conduits (network interconnections)
    assert.ok(graph.edges.length > 0, "Must synthesize conduit edges across zones");
    const dmzToSupEdge = graph.edges.find(
      (e) =>
        typeof e.source === "object" &&
        e.source.cell === "comp-firewall-1" &&
        typeof e.target === "object" &&
        e.target.cell === "comp-historian-1",
    );
    assert.ok(dmzToSupEdge, "Conduit must connect IndustrialDmzFirewall to OpcUaTelemetryHistorian");

    const supToFieldEdge = graph.edges.find(
      (e) =>
        typeof e.source === "object" &&
        e.source.cell === "comp-historian-1" &&
        typeof e.target === "object" &&
        e.target.cell === "comp-plc-1",
    );
    assert.ok(supToFieldEdge, "Conduit must connect OpcUaTelemetryHistorian to SafetyCellControllerPLC");
  });

  await t.test("buildOscalDiagram supports multi-row wrapping without component clipping", () => {
    // 5 components in Field-OT zone
    const multiCompDoc: OscalDocumentLike = {
      kind: "system-security-plan",
      uuid: "test-multi",
      title: "Multi-Component Plant",
      components: [
        { uuid: "plc-1", title: "PLC_Cell1", type: "plc", zone: "Field-OT" },
        { uuid: "plc-2", title: "PLC_Cell2", type: "plc", zone: "Field-OT" },
        { uuid: "plc-3", title: "PLC_Cell3", type: "plc", zone: "Field-OT" },
        { uuid: "plc-4", title: "PLC_Cell4", type: "plc", zone: "Field-OT" },
        { uuid: "plc-5", title: "PLC_Cell5", type: "plc", zone: "Field-OT" },
      ],
    };

    const graph = buildOscalDiagram(multiCompDoc);
    const plcNodes = graph.nodes.filter((n) => n.id.startsWith("plc-"));
    assert.strictEqual(plcNodes.length, 5, "All 5 PLC nodes must be present in graph");

    // Check that plc-4 is on row 1 (y > row 0)
    const plc1 = plcNodes.find((n) => n.id === "plc-1")!;
    const plc4 = plcNodes.find((n) => n.id === "plc-4")!;
    assert.ok((plc4.y ?? 0) > (plc1.y ?? 0), "PLC 4 must be placed on second row");
  });

  await t.test("renderOscalBoundarySvg renders all components without clipping at 3", () => {
    const multiCompDoc: OscalDocumentLike = {
      kind: "system-security-plan",
      uuid: "test-multi-svg",
      title: "Multi-Component Plant SVG",
      components: [
        { uuid: "plc-1", title: "PLC_Cell1", type: "plc", zone: "Field-OT" },
        { uuid: "plc-2", title: "PLC_Cell2", type: "plc", zone: "Field-OT" },
        { uuid: "plc-3", title: "PLC_Cell3", type: "plc", zone: "Field-OT" },
        { uuid: "plc-4", title: "PLC_Cell4", type: "plc", zone: "Field-OT" },
        { uuid: "plc-5", title: "PLC_Cell5", type: "plc", zone: "Field-OT" },
      ],
    };

    const svg = renderOscalBoundarySvg(multiCompDoc);
    assert.ok(svg.includes("<svg"), "Must return SVG");
    assert.ok(svg.includes("PLC_Cell1"), "Must include PLC_Cell1");
    assert.ok(svg.includes("PLC_Cell2"), "Must include PLC_Cell2");
    assert.ok(svg.includes("PLC_Cell3"), "Must include PLC_Cell3");
    assert.ok(svg.includes("PLC_Cell4"), "Must include PLC_Cell4 (previously dropped)");
    assert.ok(svg.includes("PLC_Cell5"), "Must include PLC_Cell5 (previously dropped)");
  });

  await t.test("buildOscalDiagram renders Control Family cards for catalogs and profiles", () => {
    const catalogDoc: OscalDocumentLike = {
      kind: "catalog",
      uuid: "cat-1",
      title: "NIST SP 800-53 Rev 5 Catalog",
      controls: [
        { id: "ac-1", title: "Policy and Procedures" },
        { id: "ac-2", title: "Account Management" },
        { id: "ia-1", title: "Identification and Authentication Policy" },
      ],
    };

    const graph = buildOscalDiagram(catalogDoc);
    assert.strictEqual(graph.metadata.kind, "catalog");
    assert.ok(
      graph.nodes.some((n) => n.id === "fam_AC"),
      "Must contain AC family node",
    );
    assert.ok(
      graph.nodes.some((n) => n.id === "fam_IA"),
      "Must contain IA family node",
    );
    assert.ok(graph.edges.length > 0, "Must contain inter-family relationship edges");
  });

  await t.test("renderOscalControlMatrixSvg renders control family heatmap", () => {
    const matrixSvg = renderOscalControlMatrixSvg(sampleSspDoc);
    assert.ok(matrixSvg.includes("<svg"), "Must return SVG");
    assert.ok(matrixSvg.includes("NIST SP 800-53 Rev 5 Control Family Implementation"), "Must include title");
    assert.ok(matrixSvg.includes("Finding") || matrixSvg.includes("Compliant"), "Must include status badges");
  });
});
