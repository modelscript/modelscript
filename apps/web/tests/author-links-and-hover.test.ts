// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("Author Links & Hover Underline Suite", () => {
  const hoverCardSrc = fs.readFileSync(
    path.resolve(import.meta.dirname, "../src/components/ProfileHoverCard.tsx"),
    "utf-8",
  );
  const authorHeaderSrc = fs.readFileSync(
    path.resolve(import.meta.dirname, "../src/components/post/PostAuthorHeader.tsx"),
    "utf-8",
  );
  const postStylesSrc = fs.readFileSync(path.resolve(import.meta.dirname, "../src/components/post/styles.ts"), "utf-8");
  const postSrc = fs.readFileSync(path.resolve(import.meta.dirname, "../src/components/Post.tsx"), "utf-8");

  const indexCssSrc = fs.readFileSync(path.resolve(import.meta.dirname, "../src/index.css"), "utf-8");

  it("verifies ProfileHoverCard renders the profile image as a link going to the user's profile", () => {
    assert.match(
      hoverCardSrc,
      /<HoverCardAvatarLink[\s\S]*?to=\{`\/@\$\{data\.username\}`\}[\s\S]*?<Avatar/,
      "Avatar in ProfileHoverCard must be wrapped in HoverCardAvatarLink going to user profile",
    );
  });

  it("verifies ProfileHoverCard renders the user's name as a link going to the user's profile with hover underline", () => {
    assert.match(
      hoverCardSrc,
      /<HoverCardNameLink[\s\S]*?to=\{`\/@\$\{data\.username\}`\}[\s\S]*?\{data\.display_name \|\| data\.username\}/,
      "Name in ProfileHoverCard must be wrapped in HoverCardNameLink going to user profile",
    );
    assert.match(
      hoverCardSrc,
      /const HoverCardNameLink = styled\(Link\)`[\s\S]*?&:hover\s*\{[\s\S]*?text-decoration:\s*underline;/,
      "HoverCardNameLink must have text-decoration: underline on hover",
    );
  });

  it("verifies ProfileHoverCard renders the user handle as a link to user profile without hover underline", () => {
    assert.match(
      hoverCardSrc,
      /<Link[\s\S]*?to=\{`\/@\$\{data\.username\}`\}[\s\S]*?className="handle-text"[\s\S]*?@\{parsed\.localUsername\}[\s\S]*?<\/Link>/,
      "Handle in ProfileHoverCard must be a Link going to user profile",
    );
    assert.doesNotMatch(
      hoverCardSrc,
      /<Link[\s\S]*?className="handle-text"[\s\S]*?onMouseEnter=/,
      "Handle in ProfileHoverCard must not change to underline on hover",
    );
  });

  it("verifies posts render the profile image as a link to user profile", () => {
    assert.match(
      postSrc,
      /<ProfileNameLink to=\{`\/@\$\{displayPost\.username\}`\}[\s\S]*?<HoverAvatar/,
      "Post feed avatar must be wrapped in ProfileNameLink to user profile",
    );
    assert.match(
      authorHeaderSrc,
      /<ProfileNameLink to=\{`\/@\$\{displayPost\.username\}`\}[\s\S]*?<HoverAvatar/,
      "Post detail avatar must be wrapped in ProfileNameLink to user profile",
    );
  });

  it("verifies posts render the user's name as a link to user profile with hover underline", () => {
    assert.match(
      authorHeaderSrc,
      /<ProfileNameLink[\s\S]*?to=\{`\/@\$\{displayPost\.username\}`\}[\s\S]*?className="profile-name-text"[\s\S]*?\{displayPost\.display_name \|\| displayPost\.username\}/,
      "PostAuthorHeader must render name in ProfileNameLink to user profile with profile-name-text class",
    );
    assert.match(
      postStylesSrc,
      /export const ProfileNameLink = styled\(Link\)`[\s\S]*?&:hover\s*\{[\s\S]*?text-decoration:\s*underline;[\s\S]*?&:hover \.profile-name-text/,
      "ProfileNameLink must specify text-decoration: underline on hover including .profile-name-text",
    );
  });

  it("verifies posts render the user handle as a link to user profile in both feed and detail views without hover underline", () => {
    // Detail view handle link
    assert.match(
      authorHeaderSrc,
      /<Link[\s\S]*?to=\{`\/@\$\{displayPost\.username\}`\}[\s\S]*?className="handle-text"[\s\S]*?@\{parsedAuthor\.localUsername\}[\s\S]*?<\/Link>/,
      "PostAuthorHeader detail view must render handle as a link",
    );
    assert.doesNotMatch(
      authorHeaderSrc,
      /<Link[\s\S]*?className="handle-text"[\s\S]*?onMouseEnter=/,
      "PostAuthorHeader handle must not change to underline on hover",
    );
  });

  it("verifies handle-text CSS class enforces text-decoration: none including on hover", () => {
    assert.match(
      indexCssSrc,
      /\.handle-text\s*\{[\s\S]*?text-decoration:\s*none\s*!important;/,
      ".handle-text must enforce text-decoration: none !important",
    );
    assert.match(
      indexCssSrc,
      /(?:a\.handle-text:hover|\.handle-text:hover)[\s\S]*?text-decoration:\s*none\s*!important;/,
      ".handle-text:hover must enforce text-decoration: none !important",
    );
  });

  it("verifies reposts render the reposter as a link to user profile with hover underline and ProfileHoverCard", () => {
    assert.match(
      postSrc,
      /<ProfileHoverCard username=\{reposterUsername\}>[\s\S]*?<ProfileNameLink[\s\S]*?to=\{`\/@\$\{reposterUsername\}`\}[\s\S]*?\{post\.display_name \|\| post\.username\} reposted[\s\S]*?<\/ProfileNameLink>[\s\S]*?<\/ProfileHoverCard>/,
      "Post repost header must wrap reposter in ProfileHoverCard and ProfileNameLink pointing to user profile",
    );
    assert.doesNotMatch(
      postSrc,
      /<ProfileNameLink[\s\S]*?style=\{[^}]*textDecoration:\s*["']none["'][^}]*\}[\s\S]*?reposted/,
      "Repost link must not override textDecoration with inline none so it underlines on hover",
    );
  });
});
