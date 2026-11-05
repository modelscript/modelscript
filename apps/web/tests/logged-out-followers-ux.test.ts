// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("Logged-out Followers & Following UX Suite", () => {
  const followBtnSrc = fs.readFileSync(
    path.resolve(import.meta.dirname, "../src/components/FollowButton.tsx"),
    "utf-8",
  );
  const followersPageSrc = fs.readFileSync(
    path.resolve(import.meta.dirname, "../src/pages/FollowersPage.tsx"),
    "utf-8",
  );
  const profileHoverCardSrc = fs.readFileSync(
    path.resolve(import.meta.dirname, "../src/components/ProfileHoverCard.tsx"),
    "utf-8",
  );
  const profilePageSrc = fs.readFileSync(path.resolve(import.meta.dirname, "../src/pages/ProfilePage.tsx"), "utf-8");
  const authContextSrc = fs.readFileSync(path.resolve(import.meta.dirname, "../src/AuthContext.tsx"), "utf-8");

  it("verifies FollowButton guards following state with user and token", () => {
    assert.ok(
      followBtnSrc.includes("const effectiveIsFollowing = Boolean(user && token && isFollowing);"),
      "FollowButton must derive effectiveIsFollowing strictly guarded by user and token",
    );
    assert.ok(
      followBtnSrc.includes("$isFollowing={effectiveIsFollowing}"),
      "FollowButton must pass effectiveIsFollowing to StyledFollowBtn",
    );
    assert.ok(
      followBtnSrc.includes(
        '{effectiveIsFollowing ? (isRssFeed ? "Subscribed" : "Following") : isRssFeed ? "Subscribe" : "Follow"}',
      ),
      "FollowButton must render 'Follow' (or 'Subscribe' for RSS) when effectiveIsFollowing is false",
    );
    assert.ok(
      followBtnSrc.includes('if (!token) {\n      navigate("/login");\n      return;\n    }'),
      "FollowButton must navigate to /login when clicked by an unauthenticated user",
    );
  });

  it("verifies FollowListPageLayout in FollowersPage guards initialIsFollowing with currentUser and token", () => {
    assert.ok(
      followersPageSrc.includes("const { user: currentUser, token } = useAuth();"),
      "FollowListPageLayout must retrieve currentUser and token from useAuth()",
    );
    assert.ok(
      followersPageSrc.includes("initialIsFollowing={Boolean(currentUser && token && u.is_following)}"),
      "FollowListPageLayout must guard initialIsFollowing with currentUser and token so logged-out users never see Following",
    );
  });

  it("verifies ProfileHoverCard and ProfilePage guard isFollowing with user and token", () => {
    assert.ok(
      profileHoverCardSrc.includes("setIsFollowing(Boolean(user && json.isFollowing));"),
      "ProfileHoverCard must guard isFollowing state with user",
    );
    assert.ok(
      profileHoverCardSrc.includes('{isBlocked ? "Blocked" : user && isFollowing ? "Following" : "Follow"}'),
      "ProfileHoverCard must show Follow when user is logged out",
    );
    assert.ok(
      profilePageSrc.includes("setIsFollowing(Boolean(user && token && data.isFollowing));"),
      "ProfilePage must guard isFollowing state with user and token",
    );
  });

  it("verifies AuthContext logout sends active token in Authorization header and purges USER_CACHE_KEY", () => {
    assert.ok(
      authContextSrc.includes("localStorage.removeItem(USER_CACHE_KEY);"),
      "AuthContext logout must explicitly clear USER_CACHE_KEY",
    );
    assert.ok(
      authContextSrc.includes("headers: { Authorization: `Bearer ${activeToken}` }"),
      "AuthContext logout must pass Authorization header to /auth/logout so the server invalidates token version",
    );
  });
});
