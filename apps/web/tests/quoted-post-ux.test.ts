// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { getPostUrl } from "../src/util/url.js";

describe("Quoted Post UX, Hover & Navigation Suite", () => {
  const postStylesSrc = fs.readFileSync(path.resolve(import.meta.dirname, "../src/components/post/styles.ts"), "utf-8");
  const postQuotedPostSrc = fs.readFileSync(
    path.resolve(import.meta.dirname, "../src/components/post/PostQuotedPost.tsx"),
    "utf-8",
  );
  const postSrc = fs.readFileSync(path.resolve(import.meta.dirname, "../src/components/Post.tsx"), "utf-8");

  it("verifies QuoteWrapper styled component has cursor: pointer and transitions to var(--surface-row-hover)", () => {
    assert.ok(
      postStylesSrc.includes("cursor: pointer"),
      "QuoteWrapper must have cursor: pointer for interactive hover",
    );
    assert.ok(
      postStylesSrc.includes("var(--surface-row-hover)"),
      "QuoteWrapper must change background-color to var(--surface-row-hover) on hover",
    );
    assert.ok(
      postStylesSrc.includes("&:focus-visible"),
      "QuoteWrapper must have focus-visible styling for keyboard accessibility",
    );
  });

  it("verifies PostQuotedPost uses canonical getPostUrl, handles click, and prevents bubbling into outer post", () => {
    assert.ok(
      postQuotedPostSrc.includes("getPostUrl"),
      "PostQuotedPost must import and use getPostUrl for canonical status navigation",
    );
    assert.ok(postQuotedPostSrc.includes('role="link"'), "PostQuotedPost must declare role='link' for assistive tech");
    assert.ok(
      postQuotedPostSrc.includes('data-quoted-post="true"'),
      "PostQuotedPost must tag wrapper with data-quoted-post='true'",
    );
    assert.ok(
      postQuotedPostSrc.includes("window.getSelection"),
      "PostQuotedPost must check text selection so users can copy text without navigating",
    );
    assert.ok(
      postQuotedPostSrc.includes("onKeyDown"),
      "PostQuotedPost must support keyboard navigation on Enter or Space",
    );
  });

  it("verifies Post.tsx click handler ignores clicks originating inside quoted post cards", () => {
    assert.ok(
      postSrc.includes("data-quoted-post='true'") || postSrc.includes('data-quoted-post="true"'),
      "Post.tsx outer post click handler must ignore clicks originating inside [data-quoted-post='true']",
    );
  });

  it("verifies getPostUrl generates expected URLs for different post formats", () => {
    // Standard post
    assert.equal(getPostUrl({ id: "42", username: "omar" }), "/@omar/status/42");

    // Leading @ handle
    assert.equal(getPostUrl({ id: "42", username: "@omar" }), "/@omar/status/42");

    // Nested author object
    assert.equal(getPostUrl({ id: 101, author: { username: "alice" } }), "/@alice/status/101");

    // Fallback when username is missing
    assert.equal(getPostUrl({ id: "99" }), "/posts/99");
  });

  it("verifies second level quote post renders with thick grey left vertical line indentation in PostQuotedPost and ComposeQuoteAndPin", () => {
    const composeQuoteSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/components/compose/ComposeQuoteAndPin.tsx"),
      "utf-8",
    );
    const composeStylesSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/components/compose/styles.ts"),
      "utf-8",
    );

    // Verify PostQuotedPost renders nested quote with thick left border
    assert.ok(postStylesSrc.includes("NestedQuoteWrapper"), "post/styles.ts must export NestedQuoteWrapper");
    assert.ok(
      postStylesSrc.includes("border-left: 3.5px solid"),
      "post/styles.ts NestedQuoteWrapper must feature a thick grey vertical left line",
    );
    assert.ok(
      postQuotedPostSrc.includes("<NestedQuoteWrapper"),
      "PostQuotedPost must render NestedQuoteWrapper when a second-level quote post is present",
    );

    // Verify ComposeQuoteAndPin renders nested quote with thick left border
    assert.ok(composeStylesSrc.includes("NestedQuoteWrapper"), "compose/styles.ts must export NestedQuoteWrapper");
    assert.ok(
      composeStylesSrc.includes("border-left: 3.5px solid"),
      "compose/styles.ts NestedQuoteWrapper must feature a thick grey vertical left line",
    );
    assert.ok(
      composeQuoteSrc.includes("<NestedQuoteWrapper"),
      "ComposeQuoteAndPin must render NestedQuoteWrapper when the quoted post contains another quoted post",
    );
  });

  it("verifies quote post modal has compact vertical spacing without dead space voids", () => {
    const composeModalSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/components/compose-modal/ComposeModal.tsx"),
      "utf-8",
    );
    const composeBoxSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/components/ComposeBox.tsx"),
      "utf-8",
    );
    const composeStylesSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/components/compose/styles.ts"),
      "utf-8",
    );

    // ComposeModal uses minRows=1 for quoted posts to prevent tall initial void
    assert.ok(
      composeModalSrc.includes("minRows={currentQuotePost ? 1 : 3}"),
      "ComposeModal must configure minRows=1 when quoting a post",
    );

    // ComposeBox computes effectiveMinRows from quotePost and tightens input margins
    assert.ok(
      composeBoxSrc.includes("effectiveMinRows = quotePost ? 1 : minRows"),
      "ComposeBox must use effectiveMinRows of 1 when quotePost is present",
    );
    assert.ok(
      composeBoxSrc.includes('effectiveReplyToPost || quotePost ? "2px" : "8px"'),
      "ComposeInput must use compact bottom margin when quoting a post",
    );

    // QuoteWrapper in compose styles has compact margin-top and padding
    assert.ok(
      composeStylesSrc.includes("margin-top: 6px") && composeStylesSrc.includes("padding: 10px 12px"),
      "QuoteWrapper in compose styles must have compact margin-top (6px) and padding (10px 12px)",
    );
  });

  it("verifies ProfileHoverCard is integrated on quoted post author avatars, names, and handles", () => {
    const postQuotedPostCurrent = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/components/post/PostQuotedPost.tsx"),
      "utf-8",
    );
    const composeQuoteCurrent = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/components/compose/ComposeQuoteAndPin.tsx"),
      "utf-8",
    );

    assert.ok(
      postQuotedPostCurrent.includes("ProfileHoverCard"),
      "PostQuotedPost must import and render ProfileHoverCard for authors",
    );
    assert.ok(
      composeQuoteCurrent.includes("ProfileHoverCard"),
      "ComposeQuoteAndPin must import and render ProfileHoverCard for authors",
    );
  });

  it("verifies nested quoted posts do not navigate directly to the nested post, but go one step down", () => {
    const postQuotedPostCurrent = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/components/post/PostQuotedPost.tsx"),
      "utf-8",
    );

    // NestedQuoteWrapper should NOT have an onClick handler navigating to nestedUrl
    assert.ok(
      !postQuotedPostCurrent.includes('<NestedQuoteWrapper\n          role="link"') &&
        !postQuotedPostCurrent.includes("<NestedQuoteWrapper\n          onClick="),
      "NestedQuoteWrapper must not have a separate onClick link to the nested post — clicks must bubble to QuoteWrapper to go one step down",
    );
  });

  it("verifies hovering over the timestamp in quote and nested quoted posts shows the full time tooltip", () => {
    const postQuotedPostCurrent = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/components/post/PostQuotedPost.tsx"),
      "utf-8",
    );
    const composeQuoteCurrent = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/components/compose/ComposeQuoteAndPin.tsx"),
      "utf-8",
    );

    // Primary quote in PostQuotedPost must wrap timestamp in Tooltip with formatFullTimestamp
    assert.ok(
      postQuotedPostCurrent.includes('<Tooltip text={formatFullTimestamp(quotePost.created_at)} direction="s">'),
      "PostQuotedPost must wrap primary quote timestamp in Tooltip with formatFullTimestamp",
    );

    // Second level nested quote in PostQuotedPost must wrap timestamp in Tooltip with formatFullTimestamp
    assert.ok(
      postQuotedPostCurrent.includes('<Tooltip text={formatFullTimestamp(nestedQuote.created_at)} direction="s">'),
      "PostQuotedPost must wrap nested quote timestamp in Tooltip with formatFullTimestamp",
    );

    // ComposeQuoteAndPin must also show full time on hover for primary and nested quotes
    assert.ok(
      composeQuoteCurrent.includes('<Tooltip text={formatFullTimestamp(quotePost.created_at)} direction="s">'),
      "ComposeQuoteAndPin must wrap primary quote timestamp in Tooltip with formatFullTimestamp",
    );
    assert.ok(
      composeQuoteCurrent.includes('<Tooltip text={formatFullTimestamp(nestedQuote.created_at)} direction="s">'),
      "ComposeQuoteAndPin must wrap nested quote timestamp in Tooltip with formatFullTimestamp",
    );

    // Both files must import Tooltip from @primer/react
    assert.ok(
      postQuotedPostCurrent.includes('import { Text, Tooltip } from "@primer/react"') ||
        postQuotedPostCurrent.includes('Tooltip } from "@primer/react"'),
      "PostQuotedPost must import Tooltip from @primer/react",
    );
    assert.ok(
      composeQuoteCurrent.includes('import { Tooltip } from "@primer/react"'),
      "ComposeQuoteAndPin must import Tooltip from @primer/react",
    );
  });

  it("verifies formatFullTimestamp formats valid ISO dates with localized time and date", () => {
    const sampleIso = "2026-11-04T12:30:00.000Z";
    const d = new Date(sampleIso);
    const expectedTime = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const expectedDate = d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
    const expected = `${expectedTime} · ${expectedDate}`;

    assert.ok(postStylesSrc.includes("function formatFullTimestamp"), "post styles must export formatFullTimestamp");
    assert.ok(
      postStylesSrc.includes("toLocaleTimeString") && postStylesSrc.includes("toLocaleDateString"),
      "formatFullTimestamp must format using toLocaleTimeString and toLocaleDateString",
    );
  });

  it("verifies TimestampButton in post and compose styles renders interactive button with hover underline", () => {
    assert.ok(
      postStylesSrc.includes("export const TimestampButton"),
      "post/styles.ts must export TimestampButton styled component",
    );
    assert.ok(
      postStylesSrc.includes("text-decoration: underline"),
      "post/styles.ts TimestampButton must underline on hover",
    );

    const composeStylesCurrent = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/components/compose/styles.ts"),
      "utf-8",
    );
    assert.ok(
      composeStylesCurrent.includes("export const TimestampButton"),
      "compose/styles.ts must export TimestampButton styled component",
    );
  });
});
