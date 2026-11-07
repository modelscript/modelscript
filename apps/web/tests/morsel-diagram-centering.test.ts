// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("Morsel Diagram Coordinate Grid Centering on Load Completion", () => {
  const diagramEditorPath = path.resolve(import.meta.dirname, "../src/components/morsel/Diagram.tsx");
  const visualizerPanePath = path.resolve(
    import.meta.dirname,
    "../src/components/morsel/panels/MorselVisualizerPane.tsx",
  );
  const morselPath = path.resolve(import.meta.dirname, "../src/components/morsel/Morsel.tsx");
  const diagramPkgPath = path.resolve(import.meta.dirname, "../../../packages/diagram/src/index.ts");

  it("verifies Diagram.tsx measures parent element and resizes X6 graph before centering", () => {
    const src = fs.readFileSync(diagramEditorPath, "utf-8");

    // fitContent must check parent element dimensions and resize graph
    assert.ok(
      src.includes("const parent = container.parentElement") || src.includes("container.parentElement"),
      "Diagram.tsx fitContent must check container.parentElement",
    );
    assert.ok(
      src.includes("parentW > 0 ? parentW :") || src.includes("parent?.clientWidth"),
      "Diagram.tsx fitContent must prioritize parent element clientWidth",
    );
    assert.ok(
      src.includes("(g as any).resize(cw, ch)") || src.includes("g.resize(cw, ch)"),
      "Diagram.tsx fitContent must resize graph to actual viewport before zoomToRect",
    );

    // zoomToFit must check parent element and resize graph
    assert.ok(
      src.includes("const parent = container?.parentElement") || src.includes("container?.parentElement"),
      "Diagram.tsx zoomToFit must check container.parentElement",
    );
    assert.ok(
      src.includes("g.resize(cw, ch)"),
      "Diagram.tsx zoomToFit must resize graph to actual viewport dimensions",
    );

    // Container style must allow flex filling without being trapped by inline styles
    assert.ok(
      src.includes('maxWidth: "100%"') && src.includes('maxHeight: "100%"'),
      "Diagram.tsx containerRef div must set maxWidth: 100% and maxHeight: 100%",
    );
  });

  it("verifies Diagram.tsx ResizeObserver observes the parent element to avoid being trapped by fixed pixel dimensions", () => {
    const src = fs.readFileSync(diagramEditorPath, "utf-8");

    assert.ok(
      src.includes("const target = container.parentElement ?? container;"),
      "Diagram.tsx must observe container.parentElement ?? container",
    );
    assert.ok(
      src.includes("ro?.observe(target)"),
      "Diagram.tsx must pass target to ro.observe",
    );
  });

  it("verifies MorselVisualizerPane.tsx triggers zoomToFit when loadingProgress finishes", () => {
    const src = fs.readFileSync(visualizerPanePath, "utf-8");

    assert.ok(
      src.includes("loadingProgress >= 100"),
      "MorselVisualizerPane.tsx must check for loadingProgress >= 100",
    );
    assert.ok(
      src.includes("effectiveDiagramRef?.current?.zoomToFit()") ||
        src.includes("effectiveDiagramRef.current?.zoomToFit()"),
      "MorselVisualizerPane.tsx must call effectiveDiagramRef.current.zoomToFit() when loading finishes",
    );
    assert.ok(
      src.includes("hasCenteredOnLoadRef"),
      "MorselVisualizerPane.tsx must track initial load centering via ref",
    );
  });

  it("verifies Morsel.tsx hideLoading schedules diagram zoomToFit when modal unmounts", () => {
    const src = fs.readFileSync(morselPath, "utf-8");

    assert.ok(
      src.includes("diagramEditorRef.current?.zoomToFit()"),
      "Morsel.tsx must trigger diagramEditorRef.current.zoomToFit()",
    );
    assert.ok(
      src.includes("hideLoading") && src.includes("diagramEditorRef.current?.zoomToFit()"),
      "Morsel.tsx hideLoading must trigger zoomToFit",
    );
  });

  it("verifies packages/diagram/src/index.ts checks parent element and schedules follow-up recentering", () => {
    const src = fs.readFileSync(diagramPkgPath, "utf-8");

    // initGraph checks parentElement
    assert.ok(
      src.includes("const parent = container.parentElement;"),
      "packages/diagram initGraph must check container.parentElement",
    );
    // renderDiagramInternal checks parentElement
    assert.ok(
      src.includes("const parent = g.container?.parentElement;"),
      "packages/diagram renderDiagramInternal must check g.container.parentElement",
    );
    // Follow-up recentering checks at 60ms and 300ms
    assert.ok(
      src.includes("setTimeout(checkAndRecenter, 60)") && src.includes("setTimeout(checkAndRecenter, 300)"),
      "packages/diagram renderDiagramInternal must schedule recenter at 60ms and 300ms",
    );
  });
});
