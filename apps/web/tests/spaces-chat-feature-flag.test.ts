// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULT_FRONTEND_FLAGS } from "../src/FeatureFlagContext.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Spaces and Chat Feature Flags Gating", () => {
  it("verifies spaces_hub, spaces, space_chat, and chat flags are disabled by default in DEFAULT_FRONTEND_FLAGS", () => {
    assert.strictEqual(DEFAULT_FRONTEND_FLAGS.spaces_hub, false, "spaces_hub must be false by default");
    assert.strictEqual(DEFAULT_FRONTEND_FLAGS.spaces, false, "spaces alias must be false by default");
    assert.strictEqual(DEFAULT_FRONTEND_FLAGS.space_chat, false, "space_chat must be false by default");
    assert.strictEqual(DEFAULT_FRONTEND_FLAGS.chat, false, "chat alias must be false by default");
  });

  it("verifies Sidebar.tsx conditionally renders Spaces and Chat links based on feature flags", () => {
    const sidebarPath = path.resolve(__dirname, "../src/components/Sidebar.tsx");
    const content = fs.readFileSync(sidebarPath, "utf-8");

    assert.ok(
      content.includes('useFeatureFlag(["spaces_hub", "spaces"])') || content.includes('useFeatureFlag("spaces_hub")'),
      "Sidebar.tsx must check hasSpaces using spaces_hub flag",
    );
    assert.ok(
      content.includes('useFeatureFlag(["space_chat", "chat"])') || content.includes('useFeatureFlag("space_chat")'),
      "Sidebar.tsx must check hasSpaceChat using space_chat flag",
    );
    assert.ok(
      content.includes("if (hasSpaces)") &&
        content.includes('communityLinks.push({ to: "/spaces", icon: OrganizationIcon, label: "Spaces" });'),
      "Sidebar.tsx must only push /spaces to communityLinks when hasSpaces is true",
    );
    assert.ok(
      content.includes("if (hasSpaceChat)") &&
        content.includes('communityLinks.push({ to: "/chat", icon: CommentDiscussionIcon, label: "Chat" });'),
      "Sidebar.tsx must only push /chat to communityLinks when hasSpaceChat is true",
    );
  });

  it("verifies ProfilePage.tsx conditionally renders the Spaces tab based on hasSpaces", () => {
    const profilePath = path.resolve(__dirname, "../src/pages/ProfilePage.tsx");
    const content = fs.readFileSync(profilePath, "utf-8");

    assert.ok(
      content.includes('useFeatureFlag(["spaces_hub", "spaces"])') || content.includes('useFeatureFlag("spaces_hub")'),
      "ProfilePage.tsx must evaluate hasSpaces flag",
    );
    assert.ok(
      content.includes('...(hasSpaces ? ["Spaces"] : [])'),
      "ProfilePage.tsx must gate Spaces tab behind hasSpaces",
    );
  });

  it("verifies App.tsx routes /spaces and /chat conditionally and falls back when disabled", () => {
    const appPath = path.resolve(__dirname, "../src/App.tsx");
    const content = fs.readFileSync(appPath, "utf-8");

    assert.ok(
      content.includes('useFeatureFlag(["spaces_hub", "spaces"])') || content.includes('useFeatureFlag("spaces_hub")'),
      "App.tsx must evaluate hasSpaces flag",
    );
    assert.ok(
      content.includes('useFeatureFlag(["space_chat", "chat"])') || content.includes('useFeatureFlag("space_chat")'),
      "App.tsx must evaluate hasSpaceChat flag",
    );
    assert.ok(
      content.includes('path="/spaces"') &&
        content.includes('hasSpaces ? <SpacesExplorePage /> : <Navigate to="/explore" replace />'),
      "App.tsx must redirect from /spaces when hasSpaces is false",
    );
    assert.ok(
      content.includes('path="/chat"') && content.includes("hasSpaceChat ? ("),
      "App.tsx must gate /chat route behind hasSpaceChat",
    );
  });
});
