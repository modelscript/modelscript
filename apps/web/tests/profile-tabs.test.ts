// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("Profile Page Tab Bar & Reposts Tab Suite", () => {
  const profilePagePath = path.resolve(import.meta.dirname, "../src/pages/ProfilePage.tsx");
  const profilePostsPath = path.resolve(import.meta.dirname, "../src/components/ProfilePosts.tsx");
  const socialApiPath = path.resolve(import.meta.dirname, "../src/api/social.ts");

  const profilePageSrc = fs.readFileSync(profilePagePath, "utf-8");
  const profilePostsSrc = fs.readFileSync(profilePostsPath, "utf-8");
  const socialApiSrc = fs.readFileSync(socialApiPath, "utf-8");

  it("verifies PROFILE_TABS orders tabs: Posts, Replies, Reposts, Packages, Articles, Repos", () => {
    assert.ok(
      profilePageSrc.includes('const PROFILE_TABS = ["Posts", "Replies", "Reposts", "Packages", "Articles", "Repos"];'),
      "PROFILE_TABS must be defined in order: Posts, Replies, Reposts, Packages, Articles, Repos",
    );
  });

  it("verifies ProfilePage TabBar renders tabs in order: Posts, Replies, Reposts, Packages, Articles, and Repos", () => {
    assert.ok(
      profilePageSrc.includes('["Replies", "Reposts", "Packages", "Articles", ...(hasRepos ? ["Repos"] : [])]'),
      "TabBar must render Replies right after Posts, Reposts right after Replies, then Packages, then Articles",
    );
  });

  it("verifies ProfilePage supports both ?tab=repost and ?tab=reposts query parameters", () => {
    assert.ok(
      profilePageSrc.includes('(t === "Reposts" && tabParam === "repost")'),
      "ProfilePage must resolve tabParam 'repost' to 'Reposts' tab",
    );
    assert.ok(
      profilePageSrc.includes("t.toLowerCase() === tabParam"),
      "ProfilePage must resolve tabParam 'reposts' to 'Reposts' tab",
    );
  });

  it("verifies ProfilePage renders ProfilePosts with type='reposts' for the Reposts tab", () => {
    assert.ok(
      profilePageSrc.includes(
        ': activeTab === "Reposts" ? (\n            <ProfilePosts username={profile.username} type="reposts" isOwnProfile={isOwnProfile} />\n          )',
      ) ||
        profilePageSrc.includes(
          'activeTab === "Reposts" ? (\n            <ProfilePosts username={profile.username} type="reposts" isOwnProfile={isOwnProfile} />',
        ),
      "ProfilePage must render ProfilePosts with type='reposts' when activeTab is Reposts",
    );
  });

  it("verifies ProfilePostsProps and getUserPosts include 'reposts' in their type unions", () => {
    assert.ok(
      profilePostsSrc.includes('type?: "posts" | "replies" | "reposts" | "artifacts" | undefined;'),
      "ProfilePostsProps must include 'reposts' in the type union",
    );
    assert.ok(
      socialApiSrc.includes('type?: "posts" | "replies" | "reposts" | "artifacts" | "articles"'),
      "getUserPosts must include 'reposts' in the type union",
    );
  });

  it("verifies ProfilePosts renders correct empty state when type='reposts'", () => {
    assert.ok(
      profilePostsSrc.includes('type === "reposts" ? "reposts" :'),
      "ProfilePosts empty state heading must display 'No reposts yet' for type='reposts'",
    );
    assert.ok(
      profilePostsSrc.includes(
        'When @{username} has {type === "replies" ? "replies" : type === "reposts" ? "reposts" :',
      ),
      "ProfilePosts empty state description must mention reposts for type='reposts'",
    );
  });

  it("verifies ProfilePage integrates formatProfileTitle to set window title for non-posts tabs", () => {
    assert.ok(
      profilePageSrc.includes("formatProfileTitle(activeTab, userIdentifier)"),
      "ProfilePage must call formatProfileTitle with activeTab and userIdentifier",
    );
    assert.ok(
      profilePageSrc.includes("usePageTitle(formatProfileTitle(activeTab, userIdentifier))"),
      "ProfilePage must pass the formatted title to usePageTitle",
    );
  });

  it("verifies formatProfileTitle formats browser window titles for all profile tabs", async () => {
    const { formatPageTitle, formatProfileTitle, setActiveBrandName } = await import("../src/util/title.js");
    setActiveBrandName("Ansatz");

    const userWithDisplayName = "Ada Lovelace (@ada)";
    const userHandleOnly = "@ada";

    // Posts tab: displays user directly without prefix
    assert.equal(formatProfileTitle("Posts", userWithDisplayName), "Ada Lovelace (@ada)");
    assert.equal(formatPageTitle(formatProfileTitle("Posts", userWithDisplayName)), "Ada Lovelace (@ada) | Ansatz");
    assert.equal(formatProfileTitle("Posts", userHandleOnly), "@ada");
    assert.equal(formatPageTitle(formatProfileTitle("Posts", userHandleOnly)), "@ada | Ansatz");
    assert.equal(formatProfileTitle("posts", userWithDisplayName), "Ada Lovelace (@ada)");

    // Non-posts tabs: format as "${tab} by ..."
    assert.equal(formatProfileTitle("Replies", userWithDisplayName), "Replies by Ada Lovelace (@ada)");
    assert.equal(
      formatPageTitle(formatProfileTitle("Replies", userWithDisplayName)),
      "Replies by Ada Lovelace (@ada) | Ansatz",
    );
    assert.equal(formatProfileTitle("reply", userWithDisplayName), "Replies by Ada Lovelace (@ada)");
    assert.equal(formatProfileTitle("Replies", userHandleOnly), "Replies by @ada");
    assert.equal(formatPageTitle(formatProfileTitle("Replies", userHandleOnly)), "Replies by @ada | Ansatz");

    assert.equal(formatProfileTitle("Reposts", userWithDisplayName), "Reposts by Ada Lovelace (@ada)");
    assert.equal(
      formatPageTitle(formatProfileTitle("Reposts", userWithDisplayName)),
      "Reposts by Ada Lovelace (@ada) | Ansatz",
    );
    assert.equal(formatProfileTitle("repost", userWithDisplayName), "Reposts by Ada Lovelace (@ada)");
    assert.equal(formatProfileTitle("Reposts", userHandleOnly), "Reposts by @ada");

    assert.equal(formatProfileTitle("Packages", userWithDisplayName), "Packages by Ada Lovelace (@ada)");
    assert.equal(
      formatPageTitle(formatProfileTitle("Packages", userWithDisplayName)),
      "Packages by Ada Lovelace (@ada) | Ansatz",
    );

    assert.equal(formatProfileTitle("Articles", userWithDisplayName), "Articles by Ada Lovelace (@ada)");
    assert.equal(
      formatPageTitle(formatProfileTitle("Articles", userWithDisplayName)),
      "Articles by Ada Lovelace (@ada) | Ansatz",
    );

    assert.equal(formatProfileTitle("Repos", userWithDisplayName), "Repos by Ada Lovelace (@ada)");
    assert.equal(
      formatPageTitle(formatProfileTitle("Repos", userWithDisplayName)),
      "Repos by Ada Lovelace (@ada) | Ansatz",
    );

    // Fallbacks when user identifier is empty
    assert.equal(formatProfileTitle("Posts", ""), "Profile");
    assert.equal(formatProfileTitle("Replies", ""), "Replies");
    assert.equal(formatProfileTitle("Reposts", ""), "Reposts");
    assert.equal(formatProfileTitle("Packages", ""), "Packages");
    assert.equal(formatProfileTitle("Articles", ""), "Articles");
    assert.equal(formatProfileTitle("Repos", ""), "Repos");
  });
});
