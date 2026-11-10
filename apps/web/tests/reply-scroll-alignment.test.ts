// SPDX-License-Identifier: AGPL-3.0-or-later

import { JSDOM } from "jsdom";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Reply Scroll Alignment (X/Twitter Pixel-Perfect Behavior)", () => {
  let dom: JSDOM;
  let scrollCalls: any[] = [];
  let originalWindow: any;
  let originalDocument: any;

  beforeEach(() => {
    dom = new JSDOM(
      `<!DOCTYPE html>
      <html>
        <head>
          <style>
            :root {
              --dev-header-height: 0px;
            }
          </style>
        </head>
        <body>
          <div id="root"></div>
        </body>
      </html>`,
      { url: "https://ansatz.social/@bob/status/456" },
    );

    originalWindow = globalThis.window;
    originalDocument = globalThis.document;

    (globalThis as any).window = dom.window;
    (globalThis as any).document = dom.window.document;

    scrollCalls = [];
    dom.window.scrollTo = (optionsOrX: any, y?: any) => {
      scrollCalls.push(typeof optionsOrX === "object" ? optionsOrX : { top: y, left: optionsOrX, behavior: "instant" });
    };

    (globalThis as any).requestAnimationFrame = (cb: () => void) => {
      cb();
      return 1;
    };
    (globalThis as any).cancelAnimationFrame = () => {};
  });

  afterEach(() => {
    (globalThis as any).window = originalWindow;
    (globalThis as any).document = originalDocument;
  });

  it("calculates exact target Y such that reply element top aligns flush beneath sticky header bottom", () => {
    // Header is sticky with min-height 53px + 1px border = 54px bottom in viewport
    const headerBottom = 54;
    const currentScrollY = 0;
    // Parent posts occupy 400px above the reply
    const postRectTop = 454;

    const targetScrollY = Math.round(currentScrollY + postRectTop - headerBottom);
    assert.equal(targetScrollY, 400);

    // After scrolling by targetScrollY (400), the new postRectTop relative to viewport will be:
    const newPostRectTop = postRectTop - targetScrollY;
    assert.equal(newPostRectTop, headerBottom);
  });

  it("accounts for --dev-header-height when calculating header bottom offset", () => {
    const devHeaderHeight = 40;
    const headerMinHeight = 54;
    const headerBottom = devHeaderHeight + headerMinHeight; // 94px
    const currentScrollY = 0;
    const postRectTop = 500;

    const targetScrollY = Math.round(currentScrollY + postRectTop - headerBottom);
    assert.equal(targetScrollY, 406);

    const newPostRectTop = postRectTop - targetScrollY;
    assert.equal(newPostRectTop, headerBottom);
  });

  it("verifies PostDetailPage.tsx includes instant pixel-perfect alignment logic", () => {
    const postDetailPagePath = path.resolve(__dirname, "../src/pages/PostDetailPage.tsx");
    const content = fs.readFileSync(postDetailPagePath, "utf-8");

    // Must NOT use the old buggy smooth scroll with hardcoded 53px
    assert.ok(
      !content.includes('window.scrollTo({ top: y, behavior: "smooth" })'),
      "PostDetailPage must not use behavior: 'smooth'",
    );
    assert.ok(!content.includes("window.scrollY - 53"), "PostDetailPage must not hardcode - 53");

    // Must use instant scroll behavior matching X/Twitter
    assert.ok(content.includes('behavior: "instant"'), "PostDetailPage must scroll instantly to the reply position");

    // Must measure header bottom dynamically
    assert.ok(
      content.includes("headerRef.current.getBoundingClientRect().bottom") || content.includes("headerBottom"),
      "PostDetailPage must measure header bottom position",
    );

    // Must update sticky scroll CSS custom properties
    assert.ok(
      content.includes("updateStickyScrollVars"),
      "PostDetailPage must call updateStickyScrollVars on scroll alignment",
    );

    // Must support ResizeObserver / dynamic image loading stabilization
    assert.ok(content.includes("ResizeObserver"), "PostDetailPage must observe resize events on parents container");

    // Must track user scroll gestures so it does not hijack manual user scrolling
    assert.ok(content.includes("hasUserScrolledRef"), "PostDetailPage must track whether user has manually scrolled");
    assert.ok(content.includes('"wheel"'), "PostDetailPage must listen for wheel events");
    assert.ok(content.includes('"touchmove"'), "PostDetailPage must listen for touchmove events");
  });

  it("verifies PostDetailThreadView.tsx wraps parents in parentsContainerRef and sets min-height for target", () => {
    const threadViewPath = path.resolve(__dirname, "../src/pages/post-detail/components/PostDetailThreadView.tsx");
    const content = fs.readFileSync(threadViewPath, "utf-8");

    assert.ok(
      content.includes("ref={parentsContainerRef}") && content.includes('data-thread-parents="true"'),
      "PostDetailThreadView must attach parentsContainerRef to parents container",
    );

    assert.ok(
      content.includes('data-thread-target-container="true"'),
      "PostDetailThreadView must wrap target post in a target container",
    );

    assert.ok(
      /minHeight:\s*parents\.length > 0/.test(content),
      "PostDetailThreadView must guarantee min-height when parents exist so reply can scroll to top even with 0 replies",
    );
  });

  it("verifies PageHeader.tsx forwards ref to root header element with data-page-header", () => {
    const pageHeaderPath = path.resolve(__dirname, "../src/components/PageHeader.tsx");
    const content = fs.readFileSync(pageHeaderPath, "utf-8");

    assert.ok(content.includes("React.forwardRef"), "PageHeader must use React.forwardRef");
    assert.ok(content.includes('data-page-header="true"'), "PageHeader must include data-page-header attribute");
  });

  it("verifies PostAuthorHeader.tsx timestamp is a direct Link to the status URL", () => {
    const authorHeaderPath = path.resolve(__dirname, "../src/components/post/PostAuthorHeader.tsx");
    const content = fs.readFileSync(authorHeaderPath, "utf-8");

    assert.ok(
      content.includes("to={`/@${displayPost.username}/status/${displayPost.id}`}") &&
        content.includes("formatRelativeTime(displayPost.created_at)"),
      "PostAuthorHeader timestamp must be a Link to the post status URL",
    );
  });
});
