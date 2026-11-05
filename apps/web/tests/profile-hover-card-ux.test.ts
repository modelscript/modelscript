// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("Profile Hover Card UX & Layout Suite", () => {
  const hoverCardSrc = fs.readFileSync(
    path.resolve(import.meta.dirname, "../src/components/ProfileHoverCard.tsx"),
    "utf-8",
  );

  it("verifies FollowButton in ProfileHoverCard has top spacing below the banner header", () => {
    // FollowButton styled component must define top margin
    assert.match(
      hoverCardSrc,
      /const FollowButton = styled\.button<FollowButtonProps>`[\s\S]*?margin-top:\s*38px;/,
      "FollowButton in ProfileHoverCard must have margin-top (38px offset for 28px banner overlap + 10px breathing room)",
    );
  });

  it("verifies avatar and follow button flex row uses alignItems flex-start", () => {
    // The container wrapping Avatar and FollowButton must use flex-start so avatar remains anchored to the top of the content box
    assert.ok(
      hoverCardSrc.includes('justifyContent="space-between" alignItems="flex-start"'),
      "ProfileHoverCard must use alignItems='flex-start' for the header row to preserve avatar overlap and respect button margin-top",
    );
  });
});
