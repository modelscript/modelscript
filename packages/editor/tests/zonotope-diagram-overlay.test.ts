// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDiagramZonotopeOverlayGeometry,
  type DiagramDataLike,
  type DiagramZonotopeHypergraphInput,
} from "../src/workbench/util/zonotope-2d-geometry.js";
import {
  createInitialZonotopeWorkbenchState,
  type ZonotopeWorkbenchState,
} from "../src/workbench/util/zonotope-workbench-state.js";

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === "object") {
    Object.freeze(obj);
    for (const val of Object.values(obj as Record<string, unknown>)) {
      deepFreeze(val);
    }
  }
  return obj;
}

function makeSampleDiagram(): DiagramDataLike {
  return {
    nodes: [
      {
        id: "node_R1",
        x: 100,
        y: 80,
        width: 60,
        height: 40,
        angle: 0,
        properties: { name: "R1", className: "Modelica.Electrical.Analog.Basic.Resistor" },
        ports: {
          items: [
            { id: "p", args: { x: 0, y: 20, angle: 0 } },
            { id: "n", args: { x: 60, y: 20, angle: 0 } },
          ],
        },
      },
      {
        id: "node_C1",
        x: 260,
        y: 80,
        width: 50,
        height: 50,
        angle: 15,
        properties: { name: "C1", className: "Modelica.Electrical.Analog.Basic.Capacitor" },
        ports: {
          items: [
            { id: "p", args: { x: 0, y: 25, angle: 0 } },
            { id: "n", args: { x: 50, y: 25, angle: 0 } },
          ],
        },
      },
      {
        id: "__diagram_background__",
        shape: "diagram-background",
        x: 0,
        y: 0,
        width: 800,
        height: 600,
      },
    ],
    edges: [
      {
        id: "edge_R1_C1",
        source: { cell: "node_R1", port: "n" },
        target: { cell: "node_C1", port: "p" },
        vertices: [{ x: 210, y: 100 }],
      },
    ],
    coordinateSystem: { x: 0, y: 0, width: 400, height: 300 },
  };
}

function makeSampleHypergraph(): DiagramZonotopeHypergraphInput {
  return {
    spans: [
      { groupId: 1, relTypeId: 1, relSign: 1, symbolName: "R1", text: "R1" },
      { groupId: 2, relTypeId: 1, relSign: 1, symbolName: "C1", text: "C1" },
      { groupId: 3, relTypeId: 4, relSign: 1, symbolName: "R1.n", text: "R1.n" },
      { groupId: 3, relTypeId: 4, relSign: -1, symbolName: "C1.p", text: "C1.p" },
    ],
  };
}

describe("zonotope-2d-geometry", () => {
  it("computes accurate ±ε_2d * stressScale envelopes around diagram nodes and skips background nodes", () => {
    const diagram = makeSampleDiagram();
    const hypergraph = makeSampleHypergraph();
    const state: ZonotopeWorkbenchState = {
      ...createInitialZonotopeWorkbenchState(),
      stressScale: 1.5,
      budgets: {
        ...createInitialZonotopeWorkbenchState().budgets,
        diagramLayoutJitterPx: 10,
      },
    };

    const result = buildDiagramZonotopeOverlayGeometry(diagram, hypergraph, state);
    // Synthetic __diagram_background__ node should be excluded
    assert.equal(result.nodes.length, 2);

    const r1 = result.nodes[0]!;
    assert.equal(r1.id, "node_R1");
    assert.equal(r1.name, "R1");
    assert.equal(r1.groupId, 1);
    // jitter = 10 * 1.5 = 15
    assert.equal(r1.envelopeX, 100 - 15);
    assert.equal(r1.envelopeY, 80 - 15);
    assert.equal(r1.envelopeWidth, 60 + 30);
    assert.equal(r1.envelopeHeight, 40 + 30);

    const c1 = result.nodes[1]!;
    assert.equal(c1.id, "node_C1");
    assert.equal(c1.name, "C1");
    assert.equal(c1.groupId, 2);
    assert.equal(c1.envelopeX, 260 - 15);
    assert.equal(c1.envelopeY, 80 - 15);
    assert.equal(c1.envelopeWidth, 50 + 30);
    assert.equal(c1.envelopeHeight, 50 + 30);

    // Bounds must contain both envelopes
    assert.ok(result.bounds.minX <= r1.envelopeX);
    assert.ok(result.bounds.minY <= r1.envelopeY);
    assert.ok(result.bounds.maxX >= c1.envelopeX + c1.envelopeWidth);
    assert.ok(result.bounds.maxY >= c1.envelopeY + c1.envelopeHeight);

    // Zero stress collapses envelope to nominal bounds
    const zeroState: ZonotopeWorkbenchState = { ...state, stressScale: 0 };
    const zeroResult = buildDiagramZonotopeOverlayGeometry(diagram, hypergraph, zeroState);
    assert.equal(zeroResult.nodes[0]!.envelopeX, 100);
    assert.equal(zeroResult.nodes[0]!.envelopeWidth, 60);
    assert.equal(zeroResult.nodes[0]!.perturbedX, 100);
    assert.equal(zeroResult.nodes[0]!.perturbedY, 80);
  });

  it("perturbs ghost positions smoothly when xiByGroupId or stressScale changes without mutating diagramData", () => {
    const diagram = deepFreeze(makeSampleDiagram());
    const snapshotBefore = JSON.stringify(diagram);
    const hypergraph = makeSampleHypergraph();

    const baseState = createInitialZonotopeWorkbenchState();
    const sNeg: ZonotopeWorkbenchState = { ...baseState, stressScale: 1.0, xiByGroupId: { 1: -1.0 } };
    const sZero: ZonotopeWorkbenchState = { ...baseState, stressScale: 1.0, xiByGroupId: { 1: 0.0 } };
    const sHalf: ZonotopeWorkbenchState = { ...baseState, stressScale: 1.0, xiByGroupId: { 1: 0.5 } };
    const sPos: ZonotopeWorkbenchState = { ...baseState, stressScale: 1.0, xiByGroupId: { 1: 1.0 } };
    const sDoubleStress: ZonotopeWorkbenchState = {
      ...baseState,
      stressScale: 2.0,
      xiByGroupId: { 1: 0.5 },
    };

    const gNeg = buildDiagramZonotopeOverlayGeometry(diagram, hypergraph, sNeg).nodes[0]!;
    const gZero = buildDiagramZonotopeOverlayGeometry(diagram, hypergraph, sZero).nodes[0]!;
    const gHalf = buildDiagramZonotopeOverlayGeometry(diagram, hypergraph, sHalf).nodes[0]!;
    const gPos = buildDiagramZonotopeOverlayGeometry(diagram, hypergraph, sPos).nodes[0]!;
    const gDouble = buildDiagramZonotopeOverlayGeometry(diagram, hypergraph, sDoubleStress).nodes[0]!;

    // xi = 0 returns exact nominal coordinates
    assert.equal(gZero.perturbedX, gZero.x);
    assert.equal(gZero.perturbedY, gZero.y);

    // Smooth linearity in xi: gHalf is midpoint between gZero and gPos, and gNeg is opposite of gPos
    assert.ok(Math.abs(gHalf.perturbedX - (gZero.x + gPos.perturbedX) * 0.5) < 1e-9);
    assert.ok(Math.abs(gHalf.perturbedY - (gZero.y + gPos.perturbedY) * 0.5) < 1e-9);
    assert.ok(Math.abs(gNeg.perturbedX - gZero.x + (gPos.perturbedX - gZero.x)) < 1e-9);
    assert.ok(Math.abs(gNeg.perturbedY - gZero.y + (gPos.perturbedY - gZero.y)) < 1e-9);

    // Displacement at |xi| = 1 equals jitter (12px) and stays within envelope
    const dispAtOne = Math.hypot(gPos.perturbedX - gPos.x, gPos.perturbedY - gPos.y);
    assert.ok(Math.abs(dispAtOne - 12) < 1e-9);
    assert.ok(gPos.perturbedX >= gPos.envelopeX && gPos.perturbedX + gPos.width <= gPos.envelopeX + gPos.envelopeWidth);
    assert.ok(
      gPos.perturbedY >= gPos.envelopeY && gPos.perturbedY + gPos.height <= gPos.envelopeY + gPos.envelopeHeight,
    );

    // Scaling stressScale=2 with xi=0.5 matches stressScale=1 with xi=1.0
    assert.ok(Math.abs(gDouble.perturbedX - gPos.perturbedX) < 1e-9);
    assert.ok(Math.abs(gDouble.perturbedY - gPos.perturbedY) < 1e-9);

    // Verify input diagramData was completely unmutated
    assert.equal(JSON.stringify(diagram), snapshotBefore);
  });

  it("computes rotationHaloRadius > 0 when diagramAllowRotation is true and 0 when false", () => {
    const diagram = makeSampleDiagram();
    const hypergraph = makeSampleHypergraph();

    const noRotState = createInitialZonotopeWorkbenchState();
    assert.equal(noRotState.budgets.diagramAllowRotation, false);
    const noRot = buildDiagramZonotopeOverlayGeometry(diagram, hypergraph, noRotState);
    assert.equal(noRot.nodes[0]!.rotationHaloRadius, 0);
    assert.equal(noRot.nodes[0]!.perturbedRotationDeg, 0);
    assert.equal(noRot.nodes[1]!.rotationHaloRadius, 0);
    assert.equal(noRot.nodes[1]!.perturbedRotationDeg, 15);

    const rotState: ZonotopeWorkbenchState = {
      ...noRotState,
      xiByGroupId: { 1: 0.5 },
      budgets: { ...noRotState.budgets, diagramAllowRotation: true },
    };
    const withRot = buildDiagramZonotopeOverlayGeometry(diagram, hypergraph, rotState);
    assert.ok(withRot.nodes[0]!.rotationHaloRadius > Math.hypot(60, 40) * 0.5);
    assert.equal(withRot.nodes[0]!.perturbedRotationDeg, 45);
    assert.ok(withRot.nodes[1]!.rotationHaloRadius > Math.hypot(50, 50) * 0.5);
    assert.notEqual(withRot.nodes[1]!.perturbedRotationDeg, 15);
  });

  it("maps FLOW_CONSERVATION edges with opposite +1/-1 signs and honors sign-flip and lock-zero overrides", () => {
    const diagram = makeSampleDiagram();
    const hypergraph = makeSampleHypergraph();
    const baseState = createInitialZonotopeWorkbenchState();

    // Default FLOW_CONSERVATION mapping from hypergraphRecord
    const baseGeom = buildDiagramZonotopeOverlayGeometry(diagram, hypergraph, baseState);
    assert.equal(baseGeom.edges.length, 1);
    const edge = baseGeom.edges[0]!;
    assert.equal(edge.id, "edge_R1_C1");
    assert.equal(edge.source, "node_R1");
    assert.equal(edge.target, "node_C1");
    assert.equal(edge.groupId, 3);
    assert.equal(edge.relTypeId, 4);
    assert.equal(edge.sourceSign, 1);
    assert.equal(edge.targetSign, -1);
    assert.equal(edge.isLocked, false);
    // Start port (100+60, 80+20) = (160, 100), vertex (210, 100), end port (260+0, 80+25) = (260, 105)
    assert.equal(edge.points.length, 3);
    assert.deepEqual(edge.points[0], { x: 160, y: 100 });
    assert.deepEqual(edge.points[1], { x: 210, y: 100 });
    assert.deepEqual(edge.points[2], { x: 260, y: 105 });
    assert.ok(edge.midpoint.x > 205 && edge.midpoint.x < 215);

    // User sign-flip override (relSign: -1)
    const flippedState: ZonotopeWorkbenchState = {
      ...baseState,
      pendingOverrides: [
        {
          id: "ov-flip",
          symbolName: "edge_R1_C1",
          groupId: 3,
          relTypeId: 4,
          relSign: -1,
          modality: "2d",
        },
      ],
    };
    const flippedEdge = buildDiagramZonotopeOverlayGeometry(diagram, hypergraph, flippedState).edges[0]!;
    assert.equal(flippedEdge.sourceSign, -1);
    assert.equal(flippedEdge.targetSign, 1);
    assert.equal(flippedEdge.isLocked, false);

    // User lock-zero override (groupId: 0)
    const lockedState: ZonotopeWorkbenchState = {
      ...baseState,
      pendingOverrides: [
        {
          id: "ov-lock",
          symbolName: "edge_R1_C1",
          groupId: 0,
          relTypeId: 0,
          relSign: 0,
          modality: "2d",
        },
      ],
    };
    const lockedEdge = buildDiagramZonotopeOverlayGeometry(diagram, hypergraph, lockedState).edges[0]!;
    assert.equal(lockedEdge.groupId, 0);
    assert.equal(lockedEdge.isLocked, true);
  });

  it("flags nodes with active faultGenerators and ignores disabled faultGenerators", () => {
    const diagram = makeSampleDiagram();
    const hypergraph = makeSampleHypergraph();
    const state: ZonotopeWorkbenchState = {
      ...createInitialZonotopeWorkbenchState(),
      faultGenerators: [
        {
          id: "f1",
          componentName: "R1",
          faultMode: "open_circuit",
          severity: 1.0,
          enabled: true,
        },
        {
          id: "f2",
          componentName: "C1",
          faultMode: "short_circuit",
          severity: 0.8,
          enabled: false,
        },
      ],
    };

    const result = buildDiagramZonotopeOverlayGeometry(diagram, hypergraph, state);
    const r1 = result.nodes.find((n) => n.name === "R1")!;
    const c1 = result.nodes.find((n) => n.name === "C1")!;

    assert.equal(r1.hasFaultGenerator, true);
    assert.equal(r1.faultMode, "open_circuit");
    assert.equal(c1.hasFaultGenerator, false);
    assert.equal(c1.faultMode, undefined);
  });

  it("supports fallback components/connections schemas and handles null/empty diagramData gracefully", () => {
    const state = createInitialZonotopeWorkbenchState();

    const emptyRes = buildDiagramZonotopeOverlayGeometry(null, null, state);
    assert.deepEqual(emptyRes.nodes, []);
    assert.deepEqual(emptyRes.edges, []);
    assert.deepEqual(emptyRes.bounds, { minX: 0, minY: 0, maxX: 100, maxY: 100 });

    const fallbackDiagram: DiagramDataLike = {
      components: [
        { name: "pump", position: { x: 10, y: 20 }, size: { width: 80, height: 40 } },
        { name: "valve", position: { x: 200, y: 20 }, size: { width: 60, height: 40 } },
      ],
      connections: [
        {
          id: "pipe_1",
          from: "pump.out",
          to: "valve.in",
          points: [
            { x: 90, y: 40 },
            { x: 200, y: 40 },
          ],
        },
      ],
    };

    const res = buildDiagramZonotopeOverlayGeometry(fallbackDiagram, null, state);
    assert.equal(res.nodes.length, 2);
    assert.equal(res.nodes[0]!.name, "pump");
    assert.equal(res.nodes[1]!.name, "valve");
    assert.equal(res.edges.length, 1);
    assert.equal(res.edges[0]!.source, "pump");
    assert.equal(res.edges[0]!.target, "valve");
    assert.deepEqual(res.edges[0]!.midpoint, { x: 145, y: 40 });
    assert.equal(res.edges[0]!.isLocked, true);
  });
});
