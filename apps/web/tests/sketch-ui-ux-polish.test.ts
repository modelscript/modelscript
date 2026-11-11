// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("Sketch UI/UX Polish, Design Tokens & High-Precision Properties Inspector", () => {
  const navbarPath = path.resolve(import.meta.dirname, "../src/pages/playground/components/PlaygroundNavbar.tsx");
  const stylesPath = path.resolve(import.meta.dirname, "../src/pages/playground/styles.ts");
  const propertiesPath = path.resolve(import.meta.dirname, "../src/components/morsel/Properties.tsx");

  it("verifies Playground styles provide responsive icon-only collapse without abruptly hiding workbench view switcher", () => {
    const stylesContent = fs.readFileSync(stylesPath, "utf-8");

    // Must have responsive collapse between 600px and 1160px
    assert.ok(
      stylesContent.includes("@media (max-width: 1160px)") && stylesContent.includes("display: none !important"),
      "SegmentedControl must collapse button labels to icon-only mode between 600px and 1160px",
    );
    // Must NOT hide at 960px
    assert.ok(
      !stylesContent.includes("@media (max-width: 960px) {\n    display: none;\n  }"),
      "SegmentedControl must not abruptly vanish at 960px",
    );
    // Compact mode must hide only Primer's text node (not icons), and tabs must keep an accessible name
    assert.ok(
      stylesContent.includes(".segmentedControl-text"),
      "Icon-only collapse must target .segmentedControl-text so icons remain visible",
    );
    assert.ok(
      fs.readFileSync(navbarPath, "utf-8").includes("aria-label={tab.label}"),
      "View tabs must set aria-label because display:none labels leave the accessibility tree",
    );
    // Border and background fallbacks must use design tokens instead of white fallbacks
    assert.ok(
      stylesContent.includes("var(--ms-border") || stylesContent.includes("var(--ms-bg-soft"),
      "SegmentedControl must use design token fallbacks",
    );
  });

  it("verifies PlaygroundNavbar uses design tokens for primary run CTA, fork badges, and title editing", () => {
    const navbarContent = fs.readFileSync(navbarPath, "utf-8");

    // Run CTA uses design token gradient and spinner animation
    assert.ok(
      navbarContent.includes("var(--ms-accent-teal") && navbarContent.includes("var(--ms-brand"),
      "Run button must use ModelScript teal-to-brand gradient tokens",
    );
    assert.ok(
      navbarContent.includes('animation: "spin') || navbarContent.includes("Running…"),
      "Run button must show running indicator animation during simulation",
    );

    // Title editing and unsaved changes dot use brand and warning tokens
    assert.ok(navbarContent.includes("var(--ms-warning"), "Unsaved dirty state must use --ms-warning token");
    assert.ok(navbarContent.includes("var(--ms-brand"), "Title input must use --ms-brand token");

    // Fork badge uses WCAG AA compliant status-warn tokens
    assert.ok(
      navbarContent.includes("var(--ms-status-warn-bg") && navbarContent.includes("var(--ms-status-warn-fg"),
      "Fork badge must use WCAG-compliant status-warn tokens",
    );
  });

  it("verifies Properties inspector provides polished empty state with AnsatzSketchIcon and diagram guidance", () => {
    const propsContent = fs.readFileSync(propertiesPath, "utf-8");

    assert.ok(
      propsContent.includes("AnsatzSketchIcon"),
      "Properties panel must import and render AnsatzSketchIcon in empty state",
    );
    assert.ok(
      propsContent.includes("translations.noComponentSelected"),
      "Properties panel must retain translations.noComponentSelected for i18n",
    );
    assert.ok(
      propsContent.includes("Click any component or connection"),
      "Properties panel must display guidance in empty state",
    );
  });

  it("verifies Properties inspector supports keyboard arrow stepping and design tokens across all field types", () => {
    const propsContent = fs.readFileSync(propertiesPath, "utf-8");

    // Numeric scrubbing with ArrowUp / ArrowDown
    assert.ok(
      propsContent.includes('e.key === "ArrowUp"') && propsContent.includes("e.shiftKey ? 10"),
      "ParameterRow and SchemaFieldRow must support ArrowUp/ArrowDown number stepping",
    );

    // Close button uses accessible icon button
    assert.ok(
      propsContent.includes('aria-label="Close properties panel"') && propsContent.includes("<XIcon"),
      "Properties panel header must render accessible XIcon close button",
    );

    // Flat parameters filter support
    assert.ok(
      propsContent.includes("parameters.length > 4") && propsContent.includes("filterText"),
      "Flat parameters list must support filterText search when count > 4",
    );
  });

  it("verifies PlaygroundPage wraps MorselEditor in ErrorBoundary with local storage draft recovery fallback", () => {
    const pagePath = path.resolve(import.meta.dirname, "../src/pages/PlaygroundPage.tsx");
    const pageContent = fs.readFileSync(pagePath, "utf-8");

    assert.ok(
      pageContent.includes("<ErrorBoundary") &&
        (pageContent.includes('name="Ansatz Morsel Editor"') || pageContent.includes('name="Ansatz Sketch Editor"')),
      "PlaygroundPage must wrap MorselEditor in ErrorBoundary with name 'Ansatz Morsel Editor'",
    );
    assert.ok(
      (pageContent.includes("ansatz_morsel_draft") || pageContent.includes("ansatz_sketch_draft")) &&
        pageContent.includes("Recover Draft & Reload"),
      "ErrorBoundary fallback must offer Recover Draft & Reload from local storage draft",
    );
  });

  it("verifies MorselVisualizerPane handles Escape key globally to deselect components and close inspector", () => {
    const panePath = path.resolve(import.meta.dirname, "../src/components/morsel/panels/MorselVisualizerPane.tsx");
    const paneContent = fs.readFileSync(panePath, "utf-8");

    assert.ok(
      paneContent.includes("selectedComponent") &&
        paneContent.includes('e.key === "Escape"') &&
        paneContent.includes("handleSelectComponent(null)"),
      "MorselVisualizerPane must handle Escape key to deselect component and close inspector",
    );
  });

  it("verifies Properties inspector tracks isSaving state to give immediate visual feedback during debounce", () => {
    const propsContent = fs.readFileSync(propertiesPath, "utf-8");

    assert.ok(
      propsContent.includes("const [isSaving, setIsSaving] = useState(false);"),
      "ParameterRow and SchemaFieldRow must track isSaving state",
    );
    assert.ok(
      propsContent.includes("isSaving || isScrubbing") ||
        propsContent.includes('isSaving ? "var(--ms-brand, #0891b2)"'),
      "ParameterRow must update label color when isSaving is active",
    );
  });

  it("verifies Properties inspector supports numeric mouse-drag scrubbing on parameter labels", () => {
    const propsContent = fs.readFileSync(propertiesPath, "utf-8");

    assert.ok(
      propsContent.includes('isNumeric ? "ew-resize" : "default"') ||
        propsContent.includes('cursor: isNumeric ? "ew-resize" : "default"'),
      "Numeric parameter labels must show ew-resize cursor for scrubbing",
    );
    assert.ok(
      propsContent.includes('isNumberField && isEnabled ? "ew-resize" : "default"'),
      "Schema number fields must show ew-resize cursor for scrubbing",
    );
    assert.ok(
      propsContent.includes("Drag horizontally to scrub value"),
      "Properties inspector must provide tooltip guidance for horizontal scrubbing",
    );
    assert.ok(
      propsContent.includes('window.addEventListener("mousemove", onMouseMove)') &&
        propsContent.includes('window.addEventListener("mouseup", onMouseUp)'),
      "Properties inspector must register global mouse drag event listeners during scrubbing",
    );
  });

  it("verifies Properties inspector uses CollapsibleSection with animated SVG chevron rotation and aria-expanded", () => {
    const propsContent = fs.readFileSync(propertiesPath, "utf-8");

    assert.ok(
      propsContent.includes("function CollapsibleSection("),
      "Properties panel must provide reusable CollapsibleSection component",
    );
    assert.ok(
      propsContent.includes("aria-expanded={isOpen}"),
      "CollapsibleSection must maintain aria-expanded state for a11y",
    );
    assert.ok(
      propsContent.includes('transform: isOpen ? "rotate(90deg)" : "rotate(0deg)"'),
      "CollapsibleSection must smoothly rotate SVG chevron indicator",
    );
  });

  it("verifies MorselVisualizerPane uses design tokens for model tabs, dividers, palettes, and breadcrumbs", () => {
    const vizPath = path.resolve(import.meta.dirname, "../src/components/morsel/panels/MorselVisualizerPane.tsx");
    const vizContent = fs.readFileSync(vizPath, "utf-8");

    assert.ok(
      vizContent.includes("2px solid var(--ms-brand, #0891b2)"),
      "Nested model switcher tabs must use --ms-brand token",
    );
    assert.ok(
      vizContent.includes("var(--ms-border, var(--color-border-default))"),
      "Visualizer subheaders and dividers must use --ms-border token",
    );
    assert.ok(
      vizContent.includes('color: "var(--ms-text-2, var(--color-fg-muted))"'),
      "Palette labels and breadcrumbs must use --ms-text-2 token",
    );
  });

  it("verifies MorselFloatingDock and modals adopt design tokens for surfaces, borders, and dividers", () => {
    const dockPath = path.resolve(import.meta.dirname, "../src/components/morsel/panels/MorselFloatingDock.tsx");
    const galleryPath = path.resolve(
      import.meta.dirname,
      "../src/pages/playground/components/TemplateGalleryModal.tsx",
    );
    const dockContent = fs.readFileSync(dockPath, "utf-8");
    const galleryContent = fs.readFileSync(galleryPath, "utf-8");

    assert.ok(
      dockContent.includes("var(--ms-surface-glass") || dockContent.includes("var(--ms-border"),
      "MorselFloatingDock must use design token surfaces and borders",
    );
    assert.ok(dockContent.includes("var(--ms-divider"), "MorselFloatingDock dividers must use --ms-divider token");
    assert.ok(
      galleryContent.includes("var(--ms-brand") && galleryContent.includes("var(--ms-bg"),
      "TemplateGalleryModal must use design tokens for brand accents and canvas backgrounds",
    );
  });

  it("verifies PlaygroundPage wires desktop-grade global keyboard shortcuts (F5, Ctrl+B, Ctrl+O, Alt+1..6)", () => {
    const pagePath = path.resolve(import.meta.dirname, "../src/pages/PlaygroundPage.tsx");
    const pageContent = fs.readFileSync(pagePath, "utf-8");

    assert.ok(
      pageContent.includes('e.key === "F5" || (e.shiftKey && e.key === "Enter"'),
      "PlaygroundPage must bind F5 and Shift+Enter to handleRunSimulation",
    );
    assert.ok(
      pageContent.includes('(e.ctrlKey || e.metaKey) && (e.key === "b" || e.key === "B")'),
      "PlaygroundPage must bind Ctrl+B / Cmd+B to handleToggleSidebar",
    );
    assert.ok(
      pageContent.includes('(e.ctrlKey || e.metaKey) && (e.key === "o" || e.key === "O")'),
      "PlaygroundPage must bind Ctrl+O / Cmd+O to open template gallery",
    );
    assert.ok(
      pageContent.includes("e.altKey && !e.ctrlKey && !e.metaKey"),
      "PlaygroundPage must bind Alt+1..6 / Option+1..6 to workbench view switching",
    );
  });

  it("verifies SimulationResults and PolyglotDomainPanel adopt design tokens", () => {
    const simPath = path.resolve(import.meta.dirname, "../src/components/morsel/SimulationResults.tsx");
    const domainPath = path.resolve(import.meta.dirname, "../src/components/morsel/panels/PolyglotDomainPanel.tsx");
    const simContent = fs.readFileSync(simPath, "utf-8");
    const domainContent = fs.readFileSync(domainPath, "utf-8");

    assert.ok(
      simContent.includes('color: "var(--ms-text-2, var(--color-fg-muted))"'),
      "SimulationResults must use --ms-text-2 token for error subtexts",
    );
    assert.ok(
      domainContent.includes("var(--ms-text-1") && domainContent.includes("var(--ms-text-2"),
      "PolyglotDomainPanel must use --ms-text-1 and --ms-text-2 tokens",
    );
    assert.ok(
      domainContent.includes("var(--ms-brand-soft") && domainContent.includes("var(--ms-brand"),
      "PolyglotDomainPanel must use --ms-brand tokens for section badges",
    );
  });

  it("verifies Multi-Component Alignment HUD provides vector SVG icons, keyboard hints, and design token styling", () => {
    const alignPath = path.resolve(import.meta.dirname, "../../../packages/diagram/src/alignment.ts");
    const cssPath = path.resolve(import.meta.dirname, "../../../packages/diagram/src/drop-placeholder.ts");
    const alignContent = fs.readFileSync(alignPath, "utf-8");
    const cssContent = fs.readFileSync(cssPath, "utf-8");

    assert.ok(
      alignContent.includes('viewBox="0 0 16 16"') &&
        alignContent.includes("Align Left (Alt+L)") &&
        alignContent.includes("Distribute Horizontally (Alt+H)"),
      "Alignment toolbar buttons must render crisp vector SVG icons with tooltips",
    );
    assert.ok(
      alignContent.includes('b.setAttribute("aria-label", btn.title)') ||
        alignContent.includes('aria-label="${title}"') ||
        alignContent.includes("aria-label="),
      "Alignment toolbar buttons must include accessible aria-label attributes",
    );
    assert.ok(
      cssContent.includes(".modelscript-alignment-toolbar") &&
        cssContent.includes("var(--ms-bg-soft") &&
        (cssContent.includes("backdrop-filter: blur(12px)") ||
          cssContent.includes("backdrop-filter: blur(14px)") ||
          cssContent.includes("backdrop-filter: blur(")),
      "Alignment toolbar CSS must use design tokens and backdrop-filter blur",
    );
  });

  it("verifies Canvas Zoom Controls, preset levels, and DiagramEditor scale listeners", () => {
    const diagramPath = path.resolve(import.meta.dirname, "../src/components/morsel/Diagram.tsx");
    const panePath = path.resolve(import.meta.dirname, "../src/components/morsel/panels/MorselVisualizerPane.tsx");
    const diagramContent = fs.readFileSync(diagramPath, "utf-8");
    const paneContent = fs.readFileSync(panePath, "utf-8");

    assert.ok(
      diagramContent.includes("zoomIn:") &&
        diagramContent.includes("zoomOut:") &&
        diagramContent.includes("zoomTo:") &&
        diagramContent.includes("zoomToFit:"),
      "DiagramEditorHandle must expose zoomIn, zoomOut, zoomTo, and zoomToFit",
    );
    assert.ok(
      diagramContent.includes("onZoomChange?.(") && diagramContent.includes('g.on("scale", handleScale)'),
      "DiagramEditor must listen to X6 scale events and emit onZoomChange",
    );
    assert.ok(
      paneContent.includes("currentZoom") &&
        paneContent.includes("showZoomMenu") &&
        paneContent.includes('title="Zoom Out (Ctrl+-)"') &&
        paneContent.includes('title="Zoom In (Ctrl+=)"') &&
        paneContent.includes('title="Zoom to Fit (Shift+1)"'),
      "MorselVisualizerPane must provide zoom buttons with keyboard hints",
    );
    assert.ok(
      paneContent.includes("50%") && paneContent.includes("100%") && paneContent.includes("200%"),
      "MorselVisualizerPane zoom preset dropdown must include 50%, 100%, and 200% presets",
    );
    assert.ok(
      paneContent.includes('import DiagramEditor, { type DiagramEditorHandle } from "../Diagram"'),
      "MorselVisualizerPane must import DiagramEditor directly so React ref forwarding is preserved",
    );
    assert.ok(
      paneContent.includes("effectiveDiagramRef?.current?.zoomTo") &&
        paneContent.includes("effectiveDiagramRef?.current?.zoomIn") &&
        paneContent.includes("effectiveDiagramRef?.current?.zoomOut") &&
        paneContent.includes("effectiveDiagramRef?.current?.zoomToFit"),
      "MorselVisualizerPane zoom buttons and dropdown presets must invoke effectiveDiagramRef zoom methods",
    );
    assert.ok(
      paneContent.includes("morsel-menu-item") &&
        paneContent.includes("morsel-toolbar-btn") &&
        paneContent.includes("rgba(255, 255, 255, 0.08)") &&
        paneContent.includes("rgba(0, 0, 0, 0.06)"),
      "MorselVisualizerPane zoom controls and dropdown menu must include hover background styling",
    );
    const cssPath = path.resolve(import.meta.dirname, "../src/components/morsel/morsel.css");
    const cssContent = fs.readFileSync(cssPath, "utf-8");
    assert.ok(
      cssContent.includes(".morsel-menu-item:hover") && cssContent.includes(".morsel-toolbar-btn:hover"),
      "morsel.css must include hover background styles for menu items and toolbar buttons",
    );
  });

  it("verifies Undo / Redo visual history buttons and canvas keyboard shortcut wiring", () => {
    const panePath = path.resolve(import.meta.dirname, "../src/components/morsel/panels/MorselVisualizerPane.tsx");
    const indexDiagramPath = path.resolve(import.meta.dirname, "../../../packages/diagram/src/index.ts");
    const paneContent = fs.readFileSync(panePath, "utf-8");
    const indexContent = fs.readFileSync(indexDiagramPath, "utf-8");

    assert.ok(
      paneContent.includes('title="Undo (Ctrl+Z)"') && paneContent.includes('title="Redo (Ctrl+Y / Cmd+Shift+Z)"'),
      "MorselVisualizerPane must render dedicated Undo and Redo buttons with shortcut tooltips",
    );
    assert.ok(
      paneContent.includes("handleUndo") && paneContent.includes("handleRedo"),
      "MorselVisualizerPane must define handleUndo and handleRedo triggering Monaco and visualizer reload",
    );
    assert.ok(
      indexContent.includes('e.key.toLowerCase() === "z"') &&
        indexContent.includes('e.key.toLowerCase() === "y"') &&
        indexContent.includes('postMessageToHost({ type: "undo"'),
      "packages/diagram must handle Ctrl+Z and Ctrl+Y keydown events",
    );
    assert.ok(
      indexContent.includes('e.code === "Equal"') &&
        indexContent.includes('e.code === "Minus"') &&
        indexContent.includes('e.code === "Digit0"') &&
        indexContent.includes("zoomToFit"),
      "packages/diagram must handle zoom shortcuts (Ctrl+=, Ctrl+-, Ctrl+0, Shift+1)",
    );
    assert.ok(
      indexContent.includes('.closest?.(".monaco-editor")'),
      "packages/diagram must guard against active Monaco editor focus before intercepting shortcuts",
    );
  });

  it("verifies Component Rotation via 'R' key, alignment HUD, and subheader button", () => {
    const alignPath = path.resolve(import.meta.dirname, "../../../packages/diagram/src/alignment.ts");
    const indexDiagramPath = path.resolve(import.meta.dirname, "../../../packages/diagram/src/index.ts");
    const diagramPath = path.resolve(import.meta.dirname, "../src/components/morsel/Diagram.tsx");
    const panePath = path.resolve(import.meta.dirname, "../src/components/morsel/panels/MorselVisualizerPane.tsx");

    const alignContent = fs.readFileSync(alignPath, "utf-8");
    const indexContent = fs.readFileSync(indexDiagramPath, "utf-8");
    const diagramContent = fs.readFileSync(diagramPath, "utf-8");
    const paneContent = fs.readFileSync(panePath, "utf-8");

    assert.ok(
      alignContent.includes("rotate-cw") && alignContent.includes("Rotate 90° Clockwise (R)"),
      "Alignment toolbar must provide rotate-cw action button with shortcut hint",
    );
    assert.ok(
      indexContent.includes("rotateSelectedNodes") && indexContent.includes('e.key === "r" || e.key === "R"'),
      "packages/diagram must support rotating selected nodes via 'R' and Shift+R key",
    );
    assert.ok(diagramContent.includes("rotateSelected:"), "DiagramEditorHandle must expose rotateSelected method");
    assert.ok(
      paneContent.includes("rotateSelected(90)") && paneContent.includes('title="Rotate 90° Clockwise (R / Shift+R)"'),
      "MorselVisualizerPane must provide rotate 90° button in subheader",
    );
  });

  it("verifies Minimap HUD uses design tokens, toggle API, and subheader button", () => {
    const minimapPath = path.resolve(import.meta.dirname, "../../../packages/diagram/src/minimap.ts");
    const indexDiagramPath = path.resolve(import.meta.dirname, "../../../packages/diagram/src/index.ts");
    const panePath = path.resolve(import.meta.dirname, "../src/components/morsel/panels/MorselVisualizerPane.tsx");

    const minimapContent = fs.readFileSync(minimapPath, "utf-8");
    const indexContent = fs.readFileSync(indexDiagramPath, "utf-8");
    const paneContent = fs.readFileSync(panePath, "utf-8");

    assert.ok(
      minimapContent.includes("var(--ms-surface-glass") && minimapContent.includes('backdropFilter = "blur(12px)"'),
      "Minimap HUD must use design token glass surfaces and blur",
    );
    assert.ok(
      minimapContent.includes("isMinimapOpen") && minimapContent.includes("toggleMinimapHud"),
      "minimap.ts must export isMinimapOpen and toggleMinimapHud",
    );
    assert.ok(
      indexContent.includes("export function toggleMinimap") &&
        indexContent.includes("export function isMinimapVisible"),
      "packages/diagram must export toggleMinimap and isMinimapVisible helpers",
    );
    assert.ok(
      paneContent.includes("toggleMinimapView") && paneContent.includes('title="Toggle Minimap (M)"'),
      "MorselVisualizerPane must provide Minimap button in subheader",
    );
  });

  it("verifies Desktop CAD Right-Click Context Menu on nodes, edges, and blank canvas", () => {
    const menuPath = path.resolve(import.meta.dirname, "../../../packages/diagram/src/context-menu.ts");
    const indexDiagramPath = path.resolve(import.meta.dirname, "../../../packages/diagram/src/index.ts");

    const menuContent = fs.readFileSync(menuPath, "utf-8");
    const indexContent = fs.readFileSync(indexDiagramPath, "utf-8");

    assert.ok(
      menuContent.includes("showContextMenu") && menuContent.includes("hideContextMenu"),
      "context-menu.ts must export showContextMenu and hideContextMenu",
    );
    assert.ok(
      indexContent.includes('g.on("node:contextmenu"') &&
        indexContent.includes('g.on("edge:contextmenu"') &&
        indexContent.includes('g.on("blank:contextmenu"'),
      "packages/diagram must handle node:contextmenu, edge:contextmenu, and blank:contextmenu",
    );
    assert.ok(
      indexContent.includes("Rotate 90° Clockwise") &&
        indexContent.includes("Re-route Orthogonal") &&
        indexContent.includes("Auto-layout Diagram"),
      "Context menus must provide node, edge, and canvas CAD operations",
    );
  });

  it("verifies Connection Port Proximity Snap Rings and magnetic glow styles", () => {
    const cssPath = path.resolve(import.meta.dirname, "../../../packages/diagram/src/drop-placeholder.ts");
    const indexDiagramPath = path.resolve(import.meta.dirname, "../../../packages/diagram/src/index.ts");

    const cssContent = fs.readFileSync(cssPath, "utf-8");
    const indexContent = fs.readFileSync(indexDiagramPath, "utf-8");

    assert.ok(
      cssContent.includes(".x6-magnet-available") &&
        cssContent.includes(".x6-magnet-adsorbed") &&
        cssContent.includes("ms-magnet-pulse"),
      "drop-placeholder.ts must define proximity magnet snap rings and pulse animation",
    );
    assert.ok(
      indexContent.includes("magnetAvailable:") && indexContent.includes("magnetAdsorbed:"),
      "packages/diagram must configure magnetAvailable and magnetAdsorbed connecting highlights",
    );
  });

  it("verifies Canvas Grid Display Modes and Snap-to-Grid Customization", () => {
    const indexDiagramPath = path.resolve(import.meta.dirname, "../../../packages/diagram/src/index.ts");
    const diagramPath = path.resolve(import.meta.dirname, "../src/components/morsel/Diagram.tsx");
    const panePath = path.resolve(import.meta.dirname, "../src/components/morsel/panels/MorselVisualizerPane.tsx");

    const indexContent = fs.readFileSync(indexDiagramPath, "utf-8");
    const diagramContent = fs.readFileSync(diagramPath, "utf-8");
    const paneContent = fs.readFileSync(panePath, "utf-8");

    assert.ok(
      indexContent.includes("setDiagramGrid") &&
        indexContent.includes("setDiagramSnap") &&
        indexContent.includes("doubleMesh") &&
        indexContent.includes("dot") &&
        indexContent.includes("mesh"),
      "packages/diagram must support setDiagramGrid with doubleMesh, dot, and mesh modes",
    );
    assert.ok(
      diagramContent.includes("setGridMode:") && diagramContent.includes("setSnapToGrid:"),
      "DiagramEditorHandle must expose setGridMode and setSnapToGrid",
    );
    assert.ok(
      paneContent.includes("handleGridModeChange") &&
        paneContent.includes("handleSnapToggle") &&
        paneContent.includes("Canvas Grid Style") &&
        paneContent.includes("Snap to Grid"),
      "MorselVisualizerPane must provide canvas grid and snapping popover controls",
    );
    assert.ok(
      paneContent.includes('return "doubleMesh";'),
      "MorselVisualizerPane must default to doubleMesh (graph paper lines) on initial load",
    );
  });
});
