// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("Ansatz Editor UX & Stability Regressions", () => {
  const webRoot = path.resolve(import.meta.dirname, "../src");
  const repoRoot = path.resolve(import.meta.dirname, "../../..");

  it("AnsatzEditorPage handleKeyDown guards e.target before accessing classList", () => {
    const src = fs.readFileSync(path.join(webRoot, "pages/AnsatzEditorPage.tsx"), "utf-8");
    assert.ok(
      src.includes("const target = e.target instanceof HTMLElement ? e.target : null;"),
      "AnsatzEditorPage handleKeyDown must guard e.target instanceof HTMLElement before classList access",
    );
  });

  it("Tree.tsx calls clearPlacement on onDragEnd instead of dispatching window Escape", () => {
    const treeSrc = fs.readFileSync(path.join(repoRoot, "packages/editor/src/workbench/Tree.tsx"), "utf-8");
    const diagramSrc = fs.readFileSync(path.join(repoRoot, "packages/editor/src/workbench/Diagram.tsx"), "utf-8");

    assert.ok(treeSrc.includes("clearPlacement()"), "Tree.tsx onDragEnd must call clearPlacement()");
    assert.ok(
      !treeSrc.includes("startPlacement("),
      "Tree.tsx must not start a duplicate canvas placement ghost alongside setDragPreview in Ansatz Editor",
    );
    assert.ok(
      !treeSrc.includes('new KeyboardEvent("keydown", { key: "Escape" })'),
      "Tree.tsx must not dispatch synthetic window Escape KeyboardEvent on drag end",
    );
    assert.ok(
      diagramSrc.includes("clearPlacement();"),
      "Diagram.tsx onDrop must call clearPlacement() before creating drop placeholder",
    );
  });

  it("Libraries panel, ComponentList, Properties, and AddLibraryModal handle Primer night colorMode & explicit colorMode", () => {
    const treeSrc = fs.readFileSync(path.join(repoRoot, "packages/editor/src/workbench/Tree.tsx"), "utf-8");
    const compListSrc = fs.readFileSync(
      path.join(repoRoot, "packages/editor/src/workbench/ComponentList.tsx"),
      "utf-8",
    );
    const propsSrc = fs.readFileSync(path.join(repoRoot, "packages/editor/src/workbench/Properties.tsx"), "utf-8");
    const addLibSrc = fs.readFileSync(
      path.join(repoRoot, "packages/editor/src/workbench/AddLibraryModal.tsx"),
      "utf-8",
    );

    for (const [name, src] of [
      ["Tree.tsx", treeSrc],
      ["ComponentList.tsx", compListSrc],
      ["Properties.tsx", propsSrc],
      ["AddLibraryModal.tsx", addLibSrc],
    ] as const) {
      assert.ok(
        src.includes('=== "night"'),
        `${name} must recognize Primer colorMode/resolvedColorMode === "night" for dark mode icons`,
      );
    }
    assert.ok(
      treeSrc.includes("setDragPreview(e, iconSvg, cleanCompositeName, isDark)"),
      "Tree.tsx must pass isDark to setDragPreview",
    );
  });

  it("AnsatzLeftSidebar vertically stacks Libraries above Components on desktop and passes colorMode", () => {
    const sidebarSrc = fs.readFileSync(
      path.join(repoRoot, "packages/editor/src/workbench/panels/AnsatzLeftSidebar.tsx"),
      "utf-8",
    );

    assert.ok(
      !sidebarSrc.includes("desktopTab"),
      "AnsatzLeftSidebar must not gate desktop Libraries/Components behind tabs",
    );
    assert.ok(
      sidebarSrc.includes('const showLibrariesSection = isNarrow ? mobileSection === "libraries" : !showResultsView;'),
      "Libraries section must always be shown on desktop when not showing simulation results",
    );
    assert.ok(
      sidebarSrc.includes(
        'const showComponentsSection = isNarrow ? mobileSection === "components" : !showResultsView;',
      ),
      "Components section must always be shown on desktop when not showing simulation results",
    );
    assert.ok(
      sidebarSrc.includes("<TreeWidget") && sidebarSrc.includes("colorMode={_colorMode}"),
      "AnsatzLeftSidebar must pass colorMode={_colorMode} to TreeWidget",
    );
    assert.ok(
      sidebarSrc.includes("<ComponentList") && sidebarSrc.includes("colorMode={_colorMode}"),
      "AnsatzLeftSidebar must pass colorMode={_colorMode} to ComponentList",
    );
  });

  it("Diagram backend avoids eager full-workspace indexing on diagram edits", () => {
    const diagramServiceSrc = fs.readFileSync(
      path.join(repoRoot, "packages/lsp/src/services/diagram-service.ts"),
      "utf-8",
    );
    const diagramApiSrc = fs.readFileSync(path.join(repoRoot, "packages/lsp/src/diagramApi.ts"), "utf-8");

    assert.ok(
      !diagramServiceSrc.includes("getIndex?.({ eager: true })"),
      "diagram-service.ts must not pass { eager: true } in diagram backend getUnifiedIndex",
    );
    assert.ok(
      diagramApiSrc.includes('params.actions.some((a) => a.type === "addComponent")'),
      "diagramApi.ts must only fetch getUnifiedIndex when addComponent actions are present",
    );
  });

  it("tessellateStepSource attributes shell faces per MANIFOLD_SOLID_BREP and skips inner hole polygon fill", () => {
    const engineSrc = fs.readFileSync(
      path.join(repoRoot, "packages/editor/src/workbench/hooks/useAnsatzEngine.ts"),
      "utf-8",
    );
    assert.ok(engineSrc.includes("CLOSED_SHELL") && engineSrc.includes("solidMeshes"));
    assert.ok(engineSrc.includes("hasExplicitOuter && entry && !entry.isOuter"));
  });

  it("tessellateStepSource tessellates curved STEP surfaces (CYLINDRICAL_SURFACE, SPHERICAL_SURFACE) and holed plates", async () => {
    const { box, cylinder, sphere, compileToStep, subtract, translate } = await import("@modelscript/cad");
    const { tessellateStepSource } = await import("../../../packages/editor/src/workbench/hooks/useAnsatzEngine.ts");

    const holed = subtract(
      box({ width: 20, height: 15, depth: 8, name: "Plate" }),
      translate(cylinder({ radius: 3, height: 10, name: "Hole" }), [2, 0, 0]),
    );
    const holedStep = compileToStep(holed, "HoledPlate");
    const holedRes = tessellateStepSource(holedStep);
    assert.ok(holedRes.components.length >= 1, "Expected tessellated component for holed STEP plate");
    const holedVtk = new TextDecoder().decode(holedRes.vtkBuffer);
    assert.ok(holedVtk.includes("NumberOfPolys="), "Expected VTK output with tessellated triangles");
    const cellMatch = /NumberOfPolys="(\d+)"/.exec(holedVtk);
    assert.ok(
      Number(cellMatch?.[1] ?? 0) >= 40,
      `Expected >=40 triangles with curved bore sleeve, got ${cellMatch?.[1]}`,
    );

    const sphStep = compileToStep(sphere({ radius: 10, name: "Ball" }), "SpherePart");
    const sphRes = tessellateStepSource(sphStep);
    assert.ok(sphRes.components.length === 1, "Expected 1 component for STEP sphere");
    const sphVtk = new TextDecoder().decode(sphRes.vtkBuffer);
    const sphCells = Number(/NumberOfPolys="(\d+)"/.exec(sphVtk)?.[1] ?? 0);
    assert.ok(sphCells >= 100, `Expected smooth sphere tessellation >=100 triangles, got ${sphCells}`);
  });

  it("tessellateScadSource evaluates nested difference/intersection/rotate CSG trees via ManifoldWorker", async () => {
    const { tessellateScadSource } = await import("../../../packages/editor/src/workbench/hooks/useAnsatzEngine.ts");

    const solidCube = tessellateScadSource("cube([20, 20, 10], center=true);");
    const holedCube = tessellateScadSource(`
      difference() {
        cube([20, 20, 10], center=true);
        rotate([0, 0, 15]) cylinder(h=14, r=4, center=true, $fn=20);
      }
    `);

    assert.strictEqual(solidCube.components.length, 1);
    assert.strictEqual(holedCube.components.length, 1);
    assert.ok(holedCube.components[0]?.cad?.uri?.startsWith("data:model/gltf-binary;base64,"));

    const solidCells = Number(/NumberOfPolys="(\d+)"/.exec(new TextDecoder().decode(solidCube.vtkBuffer))?.[1] ?? 0);
    const holedCells = Number(/NumberOfPolys="(\d+)"/.exec(new TextDecoder().decode(holedCube.vtkBuffer))?.[1] ?? 0);
    assert.strictEqual(solidCells, 12, "Single cube should have 12 triangles");
    assert.ok(
      holedCells > solidCells + 20,
      `Subtracted cylinder bore should produce CSG borehole mesh (>32 tris), got ${holedCells}`,
    );
  });

  it("Ansatz unifies .layout sidecar undo/redo with diagram Undo/Redo and clears spatial cooldown", () => {
    const ansatzSrc = fs.readFileSync(path.join(repoRoot, "packages/editor/src/workbench/AnsatzEditor.tsx"), "utf-8");
    const paneSrc = fs.readFileSync(
      path.join(repoRoot, "packages/editor/src/workbench/panels/AnsatzVisualizerPane.tsx"),
      "utf-8",
    );
    assert.ok(ansatzSrc.includes("sidecarHistoryRef"), "Ansatz.tsx must track sidecarHistoryRef stack");
    assert.ok(
      ansatzSrc.includes("persistSidecarToProjectFiles"),
      "Ansatz.tsx must mirror sidecar changes into projectFiles",
    );
    assert.ok(
      ansatzSrc.includes('.endsWith(".layout")'),
      "Ansatz.tsx must skip compiling .layout sidecars as model sources",
    );
    assert.ok(ansatzSrc.includes("onDiagramUndo"), "Ansatz.tsx must wire onDiagramUndo");
    assert.ok(ansatzSrc.includes("onDiagramRedo"), "Ansatz.tsx must wire onDiagramRedo");
    assert.ok(
      paneSrc.includes("onDiagramUndo"),
      "AnsatzVisualizerPane must consult onDiagramUndo before Monaco trigger",
    );
    assert.ok(
      paneSrc.includes("onDiagramRedo"),
      "AnsatzVisualizerPane must consult onDiagramRedo before Monaco trigger",
    );
  });
});
