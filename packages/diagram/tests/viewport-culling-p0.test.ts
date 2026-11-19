// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { beginGraphRenderState, getGraphState, isGraphReadOnly } from "../src/graph-state.js";
import { performViewportCulling, type ViewportCullingGraph } from "../src/viewport-culling.js";
import { getDiagramWasmExports, hydrateDiagramWasm, setDiagramWasmExports } from "../src/wasm-hydration.js";

describe("Viewport Culling P0 Visibility Restoration", () => {
  it("restores style.visibility on nodes when node count drops to <= 250 after culling", () => {
    const prevDoc = (globalThis as any).document;
    (globalThis as any).document = {};
    try {
      const views = new Map<string, { container: { style: { visibility: string } } }>();
      const makeNodes = (count: number) =>
        Array.from({ length: count }, (_, idx) => {
          const id = `node_${idx}`;
          if (!views.has(id)) {
            views.set(id, { container: { style: { visibility: "" } } });
          }
          return {
            id,
            getPosition: () => ({ x: idx === 0 ? 10 : 50000, y: idx === 0 ? 10 : 50000 }),
            getSize: () => ({ width: 50, height: 50 }),
          };
        });

      let currentNodes = makeNodes(260);
      const graph: ViewportCullingGraph = {
        disposed: false,
        container: { clientWidth: 800, clientHeight: 600 },
        getNodes: () => currentNodes,
        scale: () => ({ sx: 1, sy: 1 }),
        translate: () => ({ tx: 0, ty: 0 }),
        findViewByCell: (cell) => views.get(cell.id) ?? null,
      };

      performViewportCulling(graph);
      assert.strictEqual(views.get("node_0")?.container.style.visibility, "");
      assert.strictEqual(views.get("node_200")?.container.style.visibility, "hidden");

      // Shrink below 250 nodes: previously culled node_200 must become visible again
      currentNodes = currentNodes.slice(0, 210);
      performViewportCulling(graph);
      assert.strictEqual(views.get("node_200")?.container.style.visibility, "");
    } finally {
      (globalThis as any).document = prevDoc;
    }
  });

  it("isolates readOnly and propertyCache across independently mounted Graph instances", () => {
    const editableGraph = { id: "editable" };
    const previewGraph = { id: "preview" };

    beginGraphRenderState(editableGraph, {
      readOnly: false,
      currentModule: "EditableCircuit",
      isLoading: false,
    });
    getGraphState(editableGraph)!.propertyCache.set("r1", { parameters: [{ name: "R", value: "10" }] });

    const previewTransition = beginGraphRenderState(previewGraph, {
      readOnly: true,
      currentModule: "ReadOnlyPreview",
      isLoading: false,
    });

    assert.strictEqual(previewTransition.moduleChanged, false);
    assert.strictEqual(isGraphReadOnly(editableGraph, true), false, "Editable graph must stay editable");
    assert.strictEqual(isGraphReadOnly(previewGraph, false), true, "Preview graph must remain read-only");
    assert.ok(
      getGraphState(editableGraph)!.propertyCache.has("r1"),
      "Editable graph propertyCache must not be cleared by rendering another graph",
    );
    assert.strictEqual(getGraphState(previewGraph)!.propertyCache.has("r1"), false);

    // Module switch on previewGraph clears only previewGraph's state
    const switchTransition = beginGraphRenderState(previewGraph, {
      readOnly: false,
      currentModule: "AnotherCircuit",
      isLoading: false,
    });
    assert.strictEqual(switchTransition.moduleChanged, true);
    assert.ok(getGraphState(editableGraph)!.propertyCache.has("r1"));
  });

  it("hydrates UI-thread WASM exports for A* routing and TSM compaction from release.wasm", async () => {
    const wasmPath = path.resolve(import.meta.dirname, "../../runtime/build/release.wasm");
    if (!fs.existsSync(wasmPath)) return;

    const prevExports = getDiagramWasmExports();
    const prevFetch = (globalThis as any).fetch;
    try {
      (globalThis as any).__modelscript_wasm_exports__ = undefined;
      const bytes = fs.readFileSync(wasmPath);
      (globalThis as any).fetch = async () =>
        new Response(bytes, { status: 200, headers: { "content-type": "application/wasm" } });

      const ok = await hydrateDiagramWasm("/lsp/server/dist/release.wasm");
      assert.strictEqual(ok, true);
      const hydrated = getDiagramWasmExports() as Record<string, unknown> | undefined;
      assert.ok(hydrated);
      assert.strictEqual(typeof hydrated.diagram_route_orthogonal_astar, "function");
      assert.strictEqual(typeof hydrated.diagram_tsm_compact_1d, "function");
    } finally {
      (globalThis as any).fetch = prevFetch;
      if (prevExports) setDiagramWasmExports(prevExports);
      else (globalThis as any).__modelscript_wasm_exports__ = prevExports;
    }
  });
});
