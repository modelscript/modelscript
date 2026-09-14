import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("Diagram Diffing & Ephemeral Cell Exclusion", () => {
  it("should preserve fast path when solder dots, background, and stems exist", () => {
    const isEphemeral = (id: string) =>
      id === "__diagram_background__" ||
      id.startsWith("solder_dot_") ||
      id.startsWith("__seq_stem_") ||
      id === "placement-ghost";

    // Simulate existing cells in graph (including background and solder dots)
    const existingCells = [
      { id: "__diagram_background__", isNode: () => true, isEdge: () => false },
      { id: "node_resistor1", isNode: () => true, isEdge: () => false },
      { id: "node_resistor2", isNode: () => true, isEdge: () => false },
      { id: "edge_r1_r2", isNode: () => false, isEdge: () => true },
      { id: "solder_dot_edge1_edge2", isNode: () => true, isEdge: () => false },
      { id: "__seq_stem_node_resistor1", isNode: () => true, isEdge: () => false },
    ];

    // Incoming new nodes/edges from LSP update (spatial move or parameter edit)
    const newNodes = [
      { id: "node_resistor1", x: 100, y: 120, width: 50, height: 30 },
      { id: "node_resistor2", x: 200, y: 120, width: 50, height: 30 },
    ];
    const newEdges = [{ id: "edge_r1_r2", source: "node_resistor1", target: "node_resistor2" }];

    const existingNodeIds = new Set<string>();
    const existingEdgeIds = new Set<string>();
    for (const cell of existingCells) {
      if (isEphemeral(cell.id)) continue;
      if (cell.isNode()) existingNodeIds.add(cell.id);
      else if (cell.isEdge()) existingEdgeIds.add(cell.id);
    }

    const newNodeIds = new Set(newNodes.filter((n) => !isEphemeral(n.id)).map((n) => n.id));
    const newEdgeIds = new Set(newEdges.filter((e) => !isEphemeral(e.id)).map((e) => e.id));

    const topologyChanged =
      existingNodeIds.size !== newNodeIds.size ||
      existingEdgeIds.size !== newEdgeIds.size ||
      [...existingNodeIds].some((id) => !newNodeIds.has(id)) ||
      [...newNodeIds].some((id) => !existingNodeIds.has(id)) ||
      [...existingEdgeIds].some((id) => !newEdgeIds.has(id));

    // Ephemeral cells MUST NOT trigger topology changes!
    assert.strictEqual(topologyChanged, false, "Topology change was incorrectly triggered by ephemeral cells");
    assert.deepStrictEqual([...existingNodeIds].sort(), ["node_resistor1", "node_resistor2"]);
    assert.deepStrictEqual([...existingEdgeIds], ["edge_r1_r2"]);
  });

  it("should correctly detect actual topology changes when nodes or edges are added/removed", () => {
    const isEphemeral = (id: string) =>
      id === "__diagram_background__" ||
      id.startsWith("solder_dot_") ||
      id.startsWith("__seq_stem_") ||
      id === "placement-ghost";

    const existingCells = [
      { id: "node_r1", isNode: () => true, isEdge: () => false },
      { id: "solder_dot_1", isNode: () => true, isEdge: () => false },
    ];

    // Added a new node node_r2
    const newNodes = [
      { id: "node_r1", x: 100, y: 100, width: 50, height: 30 },
      { id: "node_r2", x: 200, y: 100, width: 50, height: 30 },
    ];
    const newEdges: any[] = [];

    const existingNodeIds = new Set<string>();
    const existingEdgeIds = new Set<string>();
    for (const cell of existingCells) {
      if (isEphemeral(cell.id)) continue;
      if (cell.isNode()) existingNodeIds.add(cell.id);
      else if (cell.isEdge()) existingEdgeIds.add(cell.id);
    }

    const newNodeIds = new Set(newNodes.filter((n) => !isEphemeral(n.id)).map((n) => n.id));
    const newEdgeIds = new Set(newEdges.filter((e) => !isEphemeral(e.id)).map((e) => e.id));

    const topologyChanged =
      existingNodeIds.size !== newNodeIds.size ||
      existingEdgeIds.size !== newEdgeIds.size ||
      [...existingNodeIds].some((id) => !newNodeIds.has(id)) ||
      [...newNodeIds].some((id) => !existingNodeIds.has(id)) ||
      [...existingEdgeIds].some((id) => !newEdgeIds.has(id));

    assert.strictEqual(topologyChanged, true, "Topology change should be detected when a node is added");
  });
});
