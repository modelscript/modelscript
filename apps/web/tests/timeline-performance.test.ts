// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { parseNotebookFromContent } from "../src/util/notebook";
import { estimatePostHeight } from "../src/util/post-layout";

describe("Timeline Performance, Artifact Lifecycle & Memory Efficiency", () => {
  describe("Dynamic Post Height Estimator", () => {
    it("provides reasonable estimate for short posts without artifacts", () => {
      const post = { id: 1, content: "Hello ModelScript!" };
      const height = estimatePostHeight(post);
      assert.ok(height >= 150 && height <= 220, `Expected short post height around ~180px, got ${height}px`);
    });

    it("increases estimate for long text content", () => {
      const shortPost = { id: 1, content: "Short message" };
      const longPost = {
        id: 2,
        content: "Detailed engineering discussion.\n".repeat(25),
      };
      const shortHeight = estimatePostHeight(shortPost);
      const longHeight = estimatePostHeight(longPost);
      assert.ok(
        longHeight > shortHeight + 80,
        `Expected long post to exceed short post by >80px (got ${longHeight} vs ${shortHeight})`,
      );
    });

    it("estimates 500px+ for 3D CAD, simulation, and WebGPU artifacts", () => {
      const cadPost = {
        id: 10,
        content: "Check out this rocket nozzle geometry.",
        artifact_view_id: 101,
        artifact_view: { view_type: "cad-step" },
      };
      const webgpuPost = {
        id: 11,
        content: "WebGPU simulation testbench.",
        artifact_view_id: 102,
        artifact_view: { view_type: "webgpu" },
      };
      const simPost = {
        id: 12,
        content: "FEA stress results.",
        artifact_view_id: 103,
        artifact_view: { view_type: "simulation-result" },
      };

      for (const p of [cadPost, webgpuPost, simPost]) {
        const height = estimatePostHeight(p);
        assert.ok(
          height >= 500,
          `Expected 3D/simulation post to estimate >= 500px, got ${height}px for ${p.artifact_view.view_type}`,
        );
      }
    });

    it("estimates 600px+ for interactive tutorials and notebook posts", () => {
      const notebookPost = {
        id: 20,
        content: "# Introduction to DAE Systems\n\n```modelica\nmodel Test\nend Test;\n```",
        metadata: {
          notebook: {
            isNotebook: true,
            cells: [
              { type: "markdown", content: "..." },
              { type: "artifact", artifactId: 99 },
            ],
          },
        },
      };
      const height = estimatePostHeight(notebookPost);
      assert.ok(height >= 600, `Expected notebook tutorial post to estimate >= 600px, got ${height}px`);
    });

    it("accounts for quoted posts in height prediction", () => {
      const normalPost = { id: 30, content: "My thoughts on this." };
      const quotePost = {
        id: 31,
        content: "My thoughts on this.",
        quote_post: { id: 999, username: "alice", content: "Original model" },
      };
      assert.ok(estimatePostHeight(quotePost) >= estimatePostHeight(normalPost) + 120);
    });
  });

  describe("Code-Splitting, Lazy Hydration & Bundle Invariants", () => {
    it("ensures ModelicaCodeViewer never statically imports Monaco editor", () => {
      const src = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/artifacts/ModelicaCodeViewer.tsx"),
        "utf-8",
      );
      assert.ok(
        !src.includes('import Editor from "@monaco-editor/react";'),
        "ModelicaCodeViewer must not statically import Monaco Editor",
      );
      assert.ok(
        src.includes('React.lazy(() => import("@monaco-editor/react"))'),
        "ModelicaCodeViewer must lazy-load Monaco Editor for fullscreen mode",
      );
      assert.ok(
        src.includes("highlightPolyglotLine"),
        "ModelicaCodeViewer must use lightweight static syntax highlighting for feed cards",
      );
    });

    it("ensures ModelicaDiagramViewer guards against auto-mounting Morsel without user interaction", () => {
      const src = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/artifacts/ModelicaDiagramViewer.tsx"),
        "utf-8",
      );
      assert.ok(
        src.includes("const [interactive, setInteractive] = useState(isFullScreen);"),
        "ModelicaDiagramViewer must initialize interactive to isFullScreen to prevent auto-mounting Morsel IDE in feed",
      );
      assert.ok(
        src.includes("buildClientCodeFallbackSvg"),
        "ModelicaDiagramViewer must provide client code fallback SVG when no server SVG exists",
      );
      assert.ok(
        src.includes("!entry.isIntersecting"),
        "ModelicaDiagramViewer must hibernate heavy runtime when scrolled out of view",
      );
    });

    it("ensures PdfViewer guards against unconditional iframe mounting in feed cards", () => {
      const src = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/artifacts/PdfViewer.tsx"),
        "utf-8",
      );
      assert.ok(
        src.includes("const [inlinePreview, setInlinePreview] = useState(Boolean(isFullScreen));"),
        "PdfViewer must not mount iframe by default in feed cards",
      );
      assert.ok(src.includes("Preview Inline"), "PdfViewer must provide a Preview Inline action button");
      assert.ok(
        src.includes("!entry.isIntersecting"),
        "PdfViewer must hibernate/unmount iframe when scrolled out of view",
      );
    });

    it("ensures ViewerDispatcher wraps missing 3D/physics viewers in LazyHeavyViewer", () => {
      const src = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/artifacts/card/ViewerDispatcher.tsx"),
        "utf-8",
      );
      assert.ok(
        src.includes('title="SIMPACK Multibody Dynamics"'),
        "ViewerDispatcher must wrap SimpackViewer in LazyHeavyViewer",
      );
      assert.ok(
        src.includes('title="GENSYS Rail Dynamics"'),
        "ViewerDispatcher must wrap GensysViewer in LazyHeavyViewer",
      );
      assert.ok(
        src.includes('title="FEA Mesh & Deck Viewer"'),
        "ViewerDispatcher must wrap FeaDeckViewer in LazyHeavyViewer",
      );
      assert.ok(
        src.includes('title="CFD Boundary & Mesh Viewer"'),
        "ViewerDispatcher must wrap CfdConfigViewer in LazyHeavyViewer",
      );
      assert.ok(src.includes('title="SSP Architecture"'), "ViewerDispatcher must wrap SspViewer in LazyHeavyViewer");
      assert.ok(
        src.includes('title="Digital Twin Telemetry Dashboard"'),
        "ViewerDispatcher must wrap DigitalTwinDashboardViewer in LazyHeavyViewer",
      );
    });

    it("ensures Post and ArtifactViewCard export memoized components to prevent re-render cascades", () => {
      const postSrc = fs.readFileSync(path.resolve(import.meta.dirname, "../src/components/Post.tsx"), "utf-8");
      assert.ok(
        postSrc.includes("React.memo(PostWithErrorBoundary"),
        "Post.tsx must export React.memo(PostWithErrorBoundary)",
      );

      const cardSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/artifacts/ArtifactViewCard.tsx"),
        "utf-8",
      );
      assert.ok(
        cardSrc.includes("React.memo(ArtifactViewCard)"),
        "ArtifactViewCard.tsx must export React.memo(ArtifactViewCard)",
      );
    });

    it("ensures VirtualPostList is universally adopted across all feed surfaces", () => {
      const feedFiles = [
        "../src/pages/HomeFeedPage.tsx",
        "../src/components/ProfilePosts.tsx",
        "../src/pages/BookmarksPage.tsx",
        "../src/pages/explore/ExploreLandingView.tsx",
        "../src/pages/explore/ExploreSearchResultsView.tsx",
        "../src/pages/explore/ExploreTopicView.tsx",
      ];
      for (const relPath of feedFiles) {
        const src = fs.readFileSync(path.resolve(import.meta.dirname, relPath), "utf-8");
        assert.ok(
          src.includes("VirtualPostList"),
          `Expected ${relPath} to adopt VirtualPostList for window virtualization`,
        );
      }
    });
  });

  describe("Notebook Parser Caching", () => {
    it("returns identical cached reference for identical content without re-parsing", () => {
      const content = "## Section 1\n\nSome introductory engineering notes.\n\n## Section 2\n\nFurther details.";
      const first = parseNotebookFromContent(content, null, null);
      const second = parseNotebookFromContent(content, null, null);
      assert.equal(first, second, "parseNotebookFromContent should return cached object for repeated calls");
    });
  });
});
