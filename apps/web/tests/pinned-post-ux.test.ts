// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("Pinned Post UX & Alignment Suite", () => {
  const postSrc = fs.readFileSync(path.resolve(import.meta.dirname, "../src/components/Post.tsx"), "utf-8");
  const profilePostsSrc = fs.readFileSync(
    path.resolve(import.meta.dirname, "../src/components/ProfilePosts.tsx"),
    "utf-8",
  );
  const postStylesSrc = fs.readFileSync(path.resolve(import.meta.dirname, "../src/components/post/styles.ts"), "utf-8");
  const postActionMenuSrc = fs.readFileSync(
    path.resolve(import.meta.dirname, "../src/components/post/PostActionMenu.tsx"),
    "utf-8",
  );

  it("verifies PostProps supports isPinned and PostWrapper handles hover over the entire block", () => {
    assert.ok(postStylesSrc.includes("isPinned?: boolean"), "PostProps must accept an optional isPinned boolean");
    assert.ok(
      postStylesSrc.includes("var(--surface-row-hover)"),
      "PostWrapper must transition background to var(--surface-row-hover) on hover",
    );
  });

  it("verifies Post.tsx renders pinned row inside PostWrapper saying 'Pinned' with PinIcon left-aligned", () => {
    // PinIcon import
    assert.ok(
      postSrc.includes("PinIcon") && postSrc.includes("@primer/octicons-react"),
      "Post.tsx must import PinIcon from @primer/octicons-react",
    );

    // Left-aligned pinned row inside PostWrapper
    assert.ok(postSrc.includes("<span>Pinned</span>"), "Post.tsx must render 'Pinned' text instead of just 'Pin'");
    assert.ok(postSrc.includes('aria-label="Pinned Post"'), "Post.tsx must tag pinned row with accessible aria-label");

    // Ensure it's inside PostWrapper
    const postWrapperIndex = postSrc.indexOf("<PostWrapper");
    const pinnedRowIndex = postSrc.indexOf('aria-label="Pinned Post"');
    assert.ok(
      postWrapperIndex !== -1 && pinnedRowIndex !== -1 && pinnedRowIndex > postWrapperIndex,
      "The pinned row must be inside PostWrapper so hover changes background of whole block",
    );

    // Ensure the 40px icon track aligns with avatar column
    assert.ok(
      postSrc.includes('width: "40px"'),
      "PinIcon must be positioned in the 40px column matching avatar for left alignment",
    );
  });

  it("verifies ProfilePosts.tsx delegates pinned rendering to Post with isPinned and removes old right-aligned button", () => {
    // Passes isPinned to Post
    assert.ok(
      profilePostsSrc.includes("<Post post={post} isPinned={pinned} />"),
      "ProfilePosts.tsx must pass isPinned to Post component",
    );

    // Old right-aligned "Pin" button and separate header banner must not exist in ProfilePosts
    assert.ok(
      !profilePostsSrc.includes("<span>Pin</span>"),
      "ProfilePosts.tsx must not render the old standalone 'Pin' button",
    );
    assert.ok(
      !profilePostsSrc.includes("Pinned Post</span>"),
      "ProfilePosts.tsx must not render redundant separate top banner",
    );
  });

  it("verifies PostActionMenu supports pinning and unpinning owned posts", () => {
    assert.ok(
      postActionMenuSrc.includes('isPostPinned ? "Unpin from profile" : "Pin to your profile"'),
      "PostActionMenu must provide Pin / Unpin options for owned posts",
    );
    assert.ok(
      postActionMenuSrc.includes("modelscript:toggle-pin-post"),
      "PostActionMenu must dispatch modelscript:toggle-pin-post event",
    );
  });
});
