// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("Logged-out Post Actions UX Suite (Likes, Reposts, Bookmarks)", () => {
  const postActionsBarSrc = fs.readFileSync(
    path.resolve(import.meta.dirname, "../src/components/post/PostActionsBar.tsx"),
    "utf-8",
  );
  const postSrc = fs.readFileSync(path.resolve(import.meta.dirname, "../src/components/Post.tsx"), "utf-8");
  const explorePageSrc = fs.readFileSync(path.resolve(import.meta.dirname, "../src/pages/ExplorePage.tsx"), "utf-8");
  const bookmarksPageSrc = fs.readFileSync(
    path.resolve(import.meta.dirname, "../src/pages/BookmarksPage.tsx"),
    "utf-8",
  );
  const homeFeedPageSrc = fs.readFileSync(path.resolve(import.meta.dirname, "../src/pages/HomeFeedPage.tsx"), "utf-8");
  const authContextSrc = fs.readFileSync(path.resolve(import.meta.dirname, "../src/AuthContext.tsx"), "utf-8");

  it("verifies PostActionsBar guards liked, reposted, and bookmarked with token", () => {
    assert.ok(
      postActionsBarSrc.includes("const isLiked = Boolean(token && liked);"),
      "PostActionsBar must derive isLiked guarded by token",
    );
    assert.ok(
      postActionsBarSrc.includes("const isReposted = Boolean(token && reposted);"),
      "PostActionsBar must derive isReposted guarded by token",
    );
    assert.ok(
      postActionsBarSrc.includes("const isBookmarked = Boolean(token && bookmarked);"),
      "PostActionsBar must derive isBookmarked guarded by token",
    );
  });

  it("verifies PostActionsBar applies inactive/grey state and outline icons when logged out", () => {
    // Like button
    assert.ok(
      postActionsBarSrc.includes("$active={isLiked}"),
      "Like button must use isLiked for $active so it stays grey when logged out",
    );
    assert.ok(
      postActionsBarSrc.includes('isLiked ? "Unlike" : "Like"'),
      "Like button tooltip must show 'Like' instead of 'Unlike' when logged out",
    );
    assert.ok(
      postActionsBarSrc.includes("isLiked ? <HeartFillIcon"),
      "Like icon must use outline HeartIcon when logged out",
    );

    // Repost button
    assert.ok(
      postActionsBarSrc.includes("$active={isReposted}"),
      "Repost button must use isReposted for $active so it stays grey when logged out",
    );
    assert.ok(
      postActionsBarSrc.includes('isReposted ? "Undo repost" : "Repost"'),
      "Repost button tooltip must show 'Repost' instead of 'Undo repost' when logged out",
    );
    assert.ok(
      postActionsBarSrc.includes('{isReposted ? "Undo Repost" : "Repost"}'),
      "Repost menu item must show 'Repost' instead of 'Undo Repost' when logged out",
    );

    // Bookmark button
    assert.ok(
      postActionsBarSrc.includes("$active={isBookmarked}"),
      "Bookmark button must use isBookmarked for $active so it stays grey when logged out",
    );
    assert.ok(
      postActionsBarSrc.includes('isBookmarked ? "Remove bookmark" : "Bookmark"'),
      "Bookmark button tooltip must show 'Bookmark' instead of 'Remove bookmark' when logged out",
    );
    assert.ok(
      postActionsBarSrc.includes("isBookmarked ? <BookmarkFillIcon"),
      "Bookmark icon must use outline BookmarkIcon when logged out",
    );
  });

  it("verifies clicking actions when logged out opens login prompt without modifying interactions", () => {
    // PostActionsBar intercepts clicks when !token
    assert.ok(
      postActionsBarSrc.includes(
        "if (!token) {\n            e.stopPropagation();\n            e.preventDefault();\n            onOpenLogin();",
      ),
      "PostActionsBar buttons must prompt login on click when logged out",
    );
  });

  it("verifies Post.tsx initializes state with token guard and re-evaluates on token change", () => {
    assert.ok(
      postSrc.includes("const [liked, setLiked] = useState(Boolean(token && displayPost.liked));"),
      "Post.tsx must initialize liked state guarded with token",
    );
    assert.ok(
      postSrc.includes("const [reposted, setReposted] = useState(Boolean(token && displayPost.reposted));"),
      "Post.tsx must initialize reposted state guarded with token",
    );
    assert.ok(
      postSrc.includes("const [bookmarked, setBookmarked] = useState(Boolean(token && displayPost.bookmarked));"),
      "Post.tsx must initialize bookmarked state guarded with token",
    );

    // useEffect dependency
    assert.ok(
      postSrc.includes("setLiked(Boolean(token && displayPost.liked));"),
      "Post.tsx useEffect must set liked guarded with token",
    );
    assert.ok(
      postSrc.includes("setReposted(Boolean(token && displayPost.reposted));"),
      "Post.tsx useEffect must set reposted guarded with token",
    );
    assert.ok(
      postSrc.includes("setBookmarked(Boolean(token && displayPost.bookmarked));"),
      "Post.tsx useEffect must set bookmarked guarded with token",
    );
  });

  it("verifies ExplorePage, BookmarksPage, and HomeFeedPage react to logout/token changes", () => {
    assert.ok(
      explorePageSrc.includes("}, [token]);"),
      "ExplorePage.tsx fetchExplore effect must depend on token to refresh feed upon login/logout",
    );
    assert.ok(
      explorePageSrc.includes("}, [topic, topicFilter, token]);"),
      "ExplorePage.tsx fetchTopicPosts effect must depend on token",
    );
    assert.ok(
      bookmarksPageSrc.includes("if (!token) {\n      setPosts([]);"),
      "BookmarksPage.tsx must clear posts array when logged out",
    );
    assert.ok(
      homeFeedPageSrc.includes("if (!token) {\n      setPosts([]);"),
      "HomeFeedPage.tsx must clear posts array when logged out",
    );
    assert.ok(
      authContextSrc.includes('delete api.defaults.headers.common["Authorization"];'),
      "AuthContext.tsx logout must strip Authorization header from api client",
    );
  });
});
