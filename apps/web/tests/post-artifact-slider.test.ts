// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { extractShortPostSlides } from "../src/components/post/PostArtifactSlider.js";
import { isLongFormArticle } from "../src/util/notebook.js";

describe("Short Post Artifact Slider & 4-Item Limit Suite", () => {
  const postBodySrc = fs.readFileSync(
    path.resolve(import.meta.dirname, "../src/components/post/PostBodyContent.tsx"),
    "utf-8",
  );
  const sliderSrc = fs.readFileSync(
    path.resolve(import.meta.dirname, "../src/components/post/PostArtifactSlider.tsx"),
    "utf-8",
  );
  const notebookStateSrc = fs.readFileSync(
    path.resolve(import.meta.dirname, "../src/components/compose/useComposeNotebookState.ts"),
    "utf-8",
  );
  const submitSrc = fs.readFileSync(
    path.resolve(import.meta.dirname, "../src/components/compose/useComposeSubmit.ts"),
    "utf-8",
  );

  describe("1. Differentiating Short Posts vs. Longer Articles", () => {
    it("classifies short posts with attached artifacts as short posts, not longer articles", () => {
      const shortPost = {
        id: 101,
        content:
          "Exploring Modelica@4.1 in Engineering Package Registry. Key model characteristics: Modelica Standard Library - Version 3.2.3. #ModelScript",
        artifact_view_id: 10,
        metadata: {
          artifactIds: [10, 11],
        },
      };

      assert.strictEqual(isLongFormArticle(shortPost), false);
    });

    it("classifies posts with explicit article titles or section headings as longer articles", () => {
      const articleWithTitle = {
        id: 102,
        content: "Here is an in-depth article",
        metadata: {
          notebook: {
            title: "Comprehensive Guide to DAE Solvers",
            cells: [{ type: "markdown", content: "Section 1" }],
          },
        },
      };
      assert.strictEqual(isLongFormArticle(articleWithTitle), true);

      const articleWithHeadings = {
        id: 103,
        content: "# Title\n\nIntroduction prose\n\n## First Section\n\nDeep dive into components",
      };
      assert.strictEqual(isLongFormArticle(articleWithHeadings), true);

      const articleWithTaxonomy = {
        id: 104,
        content: "Tutorial content",
        metadata: {
          notebook: {
            difficulty: "Intermediate",
            series: "Robotics 101",
          },
        },
      };
      assert.strictEqual(isLongFormArticle(articleWithTaxonomy), true);
    });
  });

  describe("2. extractShortPostSlides & Max 4 Enforcement", () => {
    it("extracts code block and attached package artifact into 2 horizontal slides (user screenshot scenario)", () => {
      const postFromScreenshot = {
        id: 201,
        content: `Exploring Modelica@4.1 in Engineering Package Registry. Key model characteristics: Modelica Standard Library - Version 3.2.3. #ModelScript #OpenSource #EngineeringLibrary

\`\`\`modelica
// File: Model1
model X

end X;
\`\`\``,
        artifact_view_id: 99,
        artifact_view: {
          id: 99,
          view_type: "package",
          title: "Modelica",
        },
      };

      const result = extractShortPostSlides(postFromScreenshot);
      assert.strictEqual(result.isShortPost, true);
      assert.strictEqual(result.slides.length, 2);

      // Slide 1: Code block
      assert.strictEqual(result.slides[0]!.type, "code");
      assert.strictEqual(result.slides[0]!.lang, "modelica");
      assert.ok(result.slides[0]!.code?.includes("model X"));

      // Slide 2: Package artifact
      assert.strictEqual(result.slides[1]!.type, "artifact");
      assert.strictEqual(result.slides[1]!.artifactId, 99);
      assert.strictEqual(result.slides[1]!.initialArtifactView?.title, "Modelica");

      // Prose text is clean without the code block
      assert.ok(result.proseText.includes("Exploring Modelica@4.1 in Engineering Package Registry."));
      assert.ok(!result.proseText.includes("```modelica"));
      assert.ok(!result.proseText.includes("model X"));
    });

    it("limits multiple artifacts to maximum 4 slides for short posts", () => {
      const postWith6Artifacts = {
        id: 202,
        content: "Multi-artifact showcase with 6 attached simulation models",
        metadata: {
          artifactIds: [101, 102, 103, 104, 105, 106],
        },
        artifact_views: {
          101: { id: 101, title: "Model 1" },
          102: { id: 102, title: "Model 2" },
          103: { id: 103, title: "Model 3" },
          104: { id: 104, title: "Model 4" },
          105: { id: 105, title: "Model 5" },
          106: { id: 106, title: "Model 6" },
        },
      };

      const result = extractShortPostSlides(postWith6Artifacts);
      assert.strictEqual(result.isShortPost, true);
      // Strictly capped at max 4 slides
      assert.strictEqual(result.slides.length, 4);
      assert.deepStrictEqual(
        result.slides.map((s) => s.artifactId),
        [101, 102, 103, 104],
      );
    });

    it("does not extract slides for longer articles, preserving inline vertical layout", () => {
      const longArticle = {
        id: 203,
        content: "# Long-Form Article Title\n\nDeep research\n\n## Section 1\n\nAnalysis",
        metadata: {
          notebook: {
            title: "Long-Form Article Title",
            cells: [
              { id: "c1", type: "markdown", content: "## Section 1" },
              { id: "c2", type: "artifact", artifactId: 101 },
              { id: "c3", type: "markdown", content: "## Section 2" },
              { id: "c4", type: "artifact", artifactId: 102 },
              { id: "c5", type: "artifact", artifactId: 103 },
              { id: "c6", type: "artifact", artifactId: 104 },
              { id: "c7", type: "artifact", artifactId: 105 },
            ],
            artifactIds: [101, 102, 103, 104, 105],
          },
        },
      };

      const result = extractShortPostSlides(longArticle);
      assert.strictEqual(result.isShortPost, false);
      assert.strictEqual(result.slides.length, 0);
    });

    it("returns zero slides and clean prose text for posts without artifacts (null, 0, or undefined artifact_view_id)", () => {
      const postWithNullArtifact = {
        id: 204,
        content: "test",
        artifact_view_id: null,
      };
      const resNull = extractShortPostSlides(postWithNullArtifact);
      assert.strictEqual(resNull.isShortPost, true);
      assert.strictEqual(resNull.proseText, "test");
      assert.strictEqual(resNull.slides.length, 0);

      const postWithZeroArtifact = {
        id: 205,
        content: "test",
        artifact_view_id: 0,
      };
      const resZero = extractShortPostSlides(postWithZeroArtifact);
      assert.strictEqual(resZero.isShortPost, true);
      assert.strictEqual(resZero.proseText, "test");
      assert.strictEqual(resZero.slides.length, 0);

      const postWithUndefinedArtifact = {
        id: 206,
        content: "test",
      };
      const resUndefined = extractShortPostSlides(postWithUndefinedArtifact);
      assert.strictEqual(resUndefined.isShortPost, true);
      assert.strictEqual(resUndefined.proseText, "test");
      assert.strictEqual(resUndefined.slides.length, 0);

      const postWithInvalidMeta = {
        id: 207,
        content: "test",
        metadata: {
          artifactIds: [null, 0, undefined, "not-a-number"],
        },
      };
      const resMeta = extractShortPostSlides(postWithInvalidMeta);
      assert.strictEqual(resMeta.slides.length, 0);
    });
  });

  describe("3. PostArtifactSlider & Skeleton Bubble Slider Component Invariants", () => {
    it("renders Track with scroll-snap and Skeleton Bubble Slider indicators", () => {
      assert.ok(
        sliderSrc.includes('data-testid="post-artifact-slider"'),
        'PostArtifactSlider must expose data-testid="post-artifact-slider"',
      );
      assert.ok(
        sliderSrc.includes("scroll-snap-type: x mandatory"),
        "Track must use CSS scroll-snap-type: x mandatory for snappy horizontal sliding",
      );
      assert.ok(
        sliderSrc.includes('data-testid="artifact-skeleton-bubble-slider"'),
        "PostArtifactSlider must render a dedicated skeleton bubble slider container",
      );
      assert.ok(
        sliderSrc.includes('role="tablist"') && sliderSrc.includes('role="tab"'),
        "Skeleton bubble slider must use accessible tablist and tab roles",
      );
      assert.ok(
        sliderSrc.includes("slides.slice(0, 4)"),
        "PostArtifactSlider must enforce effectiveSlides.slice(0, 4) limit",
      );
    });

    it("verifies skeleton bubble slider morphs active bubble width from 8px to 24px with brand accent", () => {
      assert.ok(
        sliderSrc.includes('width: ${(props) => (props.$active ? "24px" : "8px")} ;') ||
          sliderSrc.includes('props.$active ? "24px" : "8px"'),
        "Skeleton bubble slider must expand active pill to 24px and keep inactive at 8px",
      );
      assert.ok(sliderSrc.includes("var(--ms-brand"), "Active skeleton bubble must use var(--ms-brand) accent");
      assert.ok(
        sliderSrc.includes('data-testid="artifact-slider-counter"'),
        "Slider must render slide counter badge showing '1 / N'",
      );
    });

    it("places bubble skeleton at top-left and page counter above the artifact content, and splits left/right arrows on the artifact border", () => {
      const headerIdx = sliderSrc.indexOf('data-testid="artifact-slider-header"');
      const bubbleIdx = sliderSrc.indexOf('data-testid="artifact-skeleton-bubble-slider"');
      const counterIdx = sliderSrc.indexOf('data-testid="artifact-slider-counter"');
      const trackIdx = sliderSrc.indexOf('data-testid="artifact-slider-track"');

      assert.ok(headerIdx !== -1, "Slider must render SliderHeaderBar above content");
      assert.ok(
        bubbleIdx > headerIdx && bubbleIdx < trackIdx,
        "Skeleton bubble slider must be rendered above the artifact track content",
      );
      assert.ok(
        counterIdx > headerIdx && counterIdx < trackIdx,
        "Page counter badge must be rendered above the artifact track content",
      );
      assert.ok(
        sliderSrc.includes("justify-content: flex-start"),
        "BubbleSliderContainer must align bubbles to the top-left (flex-start)",
      );
      assert.ok(
        sliderSrc.includes("left: -16px;") && sliderSrc.includes("right: -16px;"),
        "Navigation arrows must be split on the center of the left/right border of the artifact (-16px offset for 32px button)",
      );
    });

    it("extends short artifact boxes and code blocks to take full height in multi-artifact posts to eliminate white space under artifacts", () => {
      // 1. Track aligns items with stretch
      assert.ok(
        sliderSrc.includes("align-items: stretch"),
        "Track must use align-items: stretch so all slides in the slider share the same uniform height",
      );

      // 2. SlideWrapper stretches and acts as a flex column container
      assert.ok(
        sliderSrc.includes("align-self: stretch") && sliderSrc.includes("height: 100%"),
        "SlideWrapper must stretch to 100% height of the track",
      );

      // 3. Child containers (div / markdown-body) flex to full height
      assert.ok(
        sliderSrc.includes("& > .markdown-body") && sliderSrc.includes("flex: 1 1 auto"),
        "SlideWrapper must extend markdown-body to flex: 1 1 auto and height: 100%",
      );

      // 4. Code block (pre.msx-code-pre) extends to full height with flex body
      assert.ok(
        sliderSrc.includes("pre.msx-code-pre") &&
          sliderSrc.includes(".msx-code-body") &&
          sliderSrc.includes(".msx-code-header"),
        "SlideWrapper must extend pre.msx-code-pre to full height with flex: 1 1 auto body and pinned header",
      );

      // 5. Artifact card viewers extend to full height
      assert.ok(
        sliderSrc.includes("& > div > :first-child"),
        "SlideWrapper must extend artifact card viewers to flex: 1 1 auto so cards take full height",
      );
    });
  });

  describe("4. Composer Max-4 Enforcement & Short Post Mode Preservation", () => {
    it("enforces max 4 artifacts in useComposeNotebookState for short posts", () => {
      assert.ok(
        notebookStateSrc.includes("existingArtifactIds.size >= 4"),
        "attachArtifactToComposer must check if existingArtifactIds.size >= 4 for short posts",
      );
      assert.ok(
        notebookStateSrc.includes("Short posts are limited to a maximum of 4 morsels") ||
          notebookStateSrc.includes("Short posts are limited to a maximum of 4 artifacts"),
        "attachArtifactToComposer must notify user when 4 morsel limit is reached",
      );
    });

    it("does not automatically force isNotebookMode to true when attaching multiple artifacts to short posts", () => {
      // In attachArtifactToComposer, it should no longer unconditionally set isNotebookMode(true)
      const attachFnIndex = notebookStateSrc.indexOf("const attachArtifactToComposer");
      const attachFnEnd = notebookStateSrc.indexOf("return {", attachFnIndex);
      const attachFnBody = notebookStateSrc.slice(attachFnIndex, attachFnEnd);

      assert.ok(
        !attachFnBody.includes("if (!isNotebookMode) {\n      setIsNotebookMode(true);"),
        "attachArtifactToComposer must not convert short posts into notebook mode upon adding second artifact",
      );
    });

    it("stores artifactIds in metadata up to 4 items in useComposeSubmit for short posts", () => {
      assert.ok(
        submitSrc.includes("effectiveArtIds.slice(0, 4)"),
        "useComposeSubmit must save effectiveArtIds.slice(0, 4) in metadata.artifactIds for short posts",
      );
      assert.ok(
        submitSrc.includes("isNotebookMode && effectiveCells"),
        "useComposeSubmit must only set notebookPayload when isNotebookMode is explicitly enabled",
      );
    });
  });

  describe("5. PostBodyContent Integration", () => {
    it("delegates multiple artifacts and code blocks to PostArtifactSlider instead of stacking vertically", () => {
      assert.ok(
        postBodySrc.includes("<PostArtifactSlider"),
        "PostBodyContent must render <PostArtifactSlider for short posts with multiple artifacts",
      );
      assert.ok(
        postBodySrc.includes("extractShortPostSlides(displayPost, notebookData)"),
        "PostBodyContent must call extractShortPostSlides to extract slides and proseText",
      );
      assert.ok(
        postBodySrc.includes("isArticle && notebookData && notebookData.cells.length > 0"),
        "PostBodyContent must only run the vertical article reader branch when isArticle is true",
      );
      assert.ok(
        postBodySrc.includes("displayPost.artifact_view_id") &&
          (postBodySrc.includes("Number(displayPost.artifact_view_id) > 0") ||
            postBodySrc.includes('String(displayPost.artifact_view_id) !== "0"')),
        "PostBodyContent must ensure artifact_view_id is a positive/non-zero identifier before rendering ArtifactViewCard",
      );
    });
  });
});
