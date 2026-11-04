// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("Package Pages Diagram View Pan & Zooming Support", () => {
  const packageDir = path.resolve(import.meta.dirname, "../src/pages/package");
  const classDetailDir = path.resolve(import.meta.dirname, "../src/pages/class-detail");

  describe("1. PackageDiagramViewer Component Architecture", () => {
    const viewerPath = path.join(packageDir, "components/PackageDiagramViewer.tsx");
    const viewerSrc = fs.readFileSync(viewerPath, "utf8");

    it("exports PackageDiagramViewer as a named and default export", () => {
      assert.ok(
        viewerSrc.includes("export const PackageDiagramViewer"),
        "PackageDiagramViewer must be exported as named export",
      );
      assert.ok(
        viewerSrc.includes("export default PackageDiagramViewer"),
        "PackageDiagramViewer must be exported as default export",
      );
    });

    it("wires useWheelZoom and ZoomHintBadge for focal point zooming and feed/page scroll protection", () => {
      assert.ok(viewerSrc.includes("useWheelZoom"), "PackageDiagramViewer must use useWheelZoom hook");
      assert.ok(viewerSrc.includes("<ZoomHintBadge"), "PackageDiagramViewer must render ZoomHintBadge");
      assert.ok(
        viewerSrc.includes("containerRef: viewportRef"),
        "PackageDiagramViewer must attach viewportRef to useWheelZoom",
      );
    });

    it("provides mouse drag panning with global window listeners to prevent drag drops", () => {
      assert.ok(
        viewerSrc.includes("onMouseDown={handleMouseDown}"),
        "PackageDiagramViewer must listen to onMouseDown for drag initiation",
      );
      assert.ok(
        viewerSrc.includes('window.addEventListener("mousemove"'),
        "PackageDiagramViewer must attach window mousemove listener during drag",
      );
      assert.ok(
        viewerSrc.includes('window.addEventListener("mouseup"'),
        "PackageDiagramViewer must attach window mouseup listener during drag",
      );
      assert.ok(
        viewerSrc.includes('cursor: isLoaded ? (isDragging ? "grabbing" : "grab") : "default"'),
        "PackageDiagramViewer must toggle cursor between grab and grabbing during drag",
      );
    });

    it("provides zoom controls, percentage badge, reset pan & zoom, and fullscreen toggle", () => {
      assert.ok(viewerSrc.includes('title="Zoom Out (-)"'), "PackageDiagramViewer must have Zoom Out control");
      assert.ok(viewerSrc.includes('title="Zoom In (+)"'), "PackageDiagramViewer must have Zoom In control");
      assert.ok(
        viewerSrc.includes('title="Reset Zoom & Pan (0)"'),
        "PackageDiagramViewer must have Reset Zoom & Pan percentage badge button",
      );
      assert.ok(viewerSrc.includes('title="Reset View"'), "PackageDiagramViewer must provide Reset View sync button");
      assert.ok(
        viewerSrc.includes("ScreenFullIcon") && viewerSrc.includes("ScreenNormalIcon"),
        "PackageDiagramViewer must support fullscreen toggle with ScreenFullIcon/ScreenNormalIcon",
      );
    });

    it("ensures zoom percentage badge has fixed width and tabular numbers so zoom buttons never shift", () => {
      assert.ok(
        viewerSrc.includes('$minWidth="48px"') || viewerSrc.includes("minWidth: 48"),
        "Percentage button must define a fixed minWidth to prevent button shifting between 75% and 100%",
      );
      const stylesSrc = fs.readFileSync(path.join(classDetailDir, "styles.ts"), "utf8");
      assert.ok(
        stylesSrc.includes("font-variant-numeric: tabular-nums"),
        "DiagramToolbarButton must use tabular-nums to ensure equal character widths",
      );
      assert.ok(
        stylesSrc.includes("justify-content: center"),
        "DiagramToolbarButton must center-align content within fixed width",
      );
    });

    it("supports keyboard navigation shortcuts (+, -, 0, F, Escape)", () => {
      assert.ok(viewerSrc.includes("onKeyDown={handleKeyDown}"), "PackageDiagramViewer must handle keyboard shortcuts");
      assert.ok(
        viewerSrc.includes('e.key === "+"') && viewerSrc.includes('e.key === "-"'),
        "PackageDiagramViewer must support + and - keys for zoom",
      );
      assert.ok(viewerSrc.includes('e.key === "0"'), "PackageDiagramViewer must support 0 key for reset zoom & pan");
      assert.ok(
        viewerSrc.includes('e.key === "f" || e.key === "F"'),
        "PackageDiagramViewer must support F key for fullscreen",
      );
      assert.ok(
        viewerSrc.includes('e.key === "Escape"'),
        "PackageDiagramViewer must support Escape key to exit fullscreen",
      );
    });

    it("supports double-click to reset zoom and pan", () => {
      assert.ok(
        viewerSrc.includes("onDoubleClick={handleDoubleClick}"),
        "PackageDiagramViewer must support double-click to reset view",
      );
    });
  });

  describe("2. Package Readme Tab Integration", () => {
    const readmeTabPath = path.join(packageDir, "tabs/PackageReadmeTab.tsx");
    const readmeTabSrc = fs.readFileSync(readmeTabPath, "utf8");

    it("adopts PackageDiagramViewer in PackageReadmeTab for root architecture diagram", () => {
      assert.ok(
        readmeTabSrc.includes("import { PackageDiagramViewer }"),
        "PackageReadmeTab must import PackageDiagramViewer",
      );
      assert.ok(
        readmeTabSrc.includes("<PackageDiagramViewer"),
        "PackageReadmeTab must render PackageDiagramViewer when showDiagram is true",
      );
      assert.ok(
        !readmeTabSrc.includes(
          '<DiagramWrap style={{ margin: 0, border: "none", background: "transparent", padding: 0 }}>',
        ),
        "PackageReadmeTab must replace static DiagramWrap with interactive PackageDiagramViewer",
      );
    });
  });

  describe("3. Class Detail Overview Tab Integration", () => {
    const classOverviewPath = path.join(classDetailDir, "components/ClassOverviewTab.tsx");
    const classOverviewSrc = fs.readFileSync(classOverviewPath, "utf8");

    it("adopts PackageDiagramViewer in ClassOverviewTab with controlled loaded and error states", () => {
      assert.ok(
        classOverviewSrc.includes("import { PackageDiagramViewer }"),
        "ClassOverviewTab must import PackageDiagramViewer",
      );
      assert.ok(
        classOverviewSrc.includes("<PackageDiagramViewer"),
        "ClassOverviewTab must render PackageDiagramViewer in the Diagram section",
      );
      assert.ok(
        classOverviewSrc.includes("loaded={diagramLoaded}"),
        "ClassOverviewTab must pass diagramLoaded to PackageDiagramViewer",
      );
      assert.ok(
        classOverviewSrc.includes("setLoaded={setDiagramLoaded}"),
        "ClassOverviewTab must pass setDiagramLoaded to PackageDiagramViewer",
      );
      assert.ok(
        !classOverviewSrc.includes("const [diagramZoom, setDiagramZoom] = useState(1);"),
        "ClassOverviewTab must delegate zoom and pan state to PackageDiagramViewer",
      );
    });
  });

  describe("4. Styled Components DiagramViewport & DiagramWrap", () => {
    const stylesPath = path.join(classDetailDir, "styles.ts");
    const stylesSrc = fs.readFileSync(stylesPath, "utf8");

    it("supports $panX, $panY, and $isDragging in DiagramViewport", () => {
      assert.ok(
        stylesSrc.includes("$panX?: number") && stylesSrc.includes("$panY?: number"),
        "DiagramViewport must accept optional $panX and $panY props",
      );
      assert.ok(
        stylesSrc.includes("translate(${p.$panX || 0}px, ${p.$panY || 0}px) scale(${p.$zoom})"),
        "DiagramViewport transform must apply both translation pan and zoom scaling",
      );
      assert.ok(
        stylesSrc.includes('transition: ${(p) => (p.$isDragging ? "none" : "transform 0.15s ease")}'),
        "DiagramViewport must disable transitions during dragging for zero-latency pan responsiveness",
      );
      assert.ok(
        stylesSrc.includes("pointer-events: none;"),
        "DiagramViewport must set pointer-events: none on inner svg to prevent native drag conflicts",
      );
    });

    it("supports $isFullScreen in DiagramWrap", () => {
      assert.ok(stylesSrc.includes("$isFullScreen?: boolean"), "DiagramWrap must support $isFullScreen prop");
      assert.ok(
        stylesSrc.includes('position: ${(p) => (p.$isFullScreen ? "fixed" : "relative")}'),
        "DiagramWrap must switch to position fixed in fullscreen mode",
      );
    });
  });

  describe("5. Barrel Exports", () => {
    it("exports PackageDiagramViewer from package barrel index", () => {
      const packageIndex = fs.readFileSync(path.join(packageDir, "index.ts"), "utf8");
      assert.ok(
        packageIndex.includes('export * from "./components/PackageDiagramViewer"'),
        "package/index.ts must export PackageDiagramViewer",
      );
    });

    it("exports PackageDiagramViewer from class-detail barrel index", () => {
      const classDetailIndex = fs.readFileSync(path.join(classDetailDir, "index.ts"), "utf8");
      assert.ok(
        classDetailIndex.includes('export * from "../package/components/PackageDiagramViewer"'),
        "class-detail/index.ts must export PackageDiagramViewer",
      );
    });
  });
});
