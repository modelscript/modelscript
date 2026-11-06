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

  const profileHeaderSrc = fs.readFileSync(
    path.resolve(import.meta.dirname, "../src/pages/profile/components/ProfileHeader.tsx"),
    "utf-8",
  );

  it("verifies Joined Date in ProfileHeader is an interactive link navigating to about page", () => {
    assert.match(
      profileHeaderSrc,
      /<JoinedDateLink[\s\S]*?to=\{`\/@\$\{profile\.username\}\/about`\}/,
      "ProfileHeader must render JoinedDateLink targeting /@${profile.username}/about",
    );
    assert.match(
      profileHeaderSrc,
      /<span>Joined \{formatMonthYear\(profile\.created_at\)\}<\/span>/,
      "ProfileHeader must format joined date as Month & Year (e.g. Joined May 2013)",
    );
    assert.match(
      profileHeaderSrc,
      /<ChevronRightIcon size=\{14\} className="chevron" \/>/,
      "ProfileHeader must render ChevronRightIcon inside JoinedDateLink",
    );
  });

  it("verifies Joined Date has hover card showing About this account information", () => {
    assert.ok(
      profileHeaderSrc.includes("AboutHoverCard"),
      "ProfileHeader must define and render AboutHoverCard on hover",
    );
    assert.ok(profileHeaderSrc.includes("About this account"), "AboutHoverCard must have title 'About this account'");
    assert.ok(
      profileHeaderSrc.includes("Account based in"),
      "AboutHoverCard must display 'Account based in' location information",
    );
    assert.ok(profileHeaderSrc.includes("former username"), "AboutHoverCard must display former usernames count");
  });

  it("verifies ProfileHeader conditionally hides unestablished location and zero former usernames in hover card", () => {
    assert.match(
      profileHeaderSrc,
      /aboutData\?\.basedIn\?\.countryName && aboutData\.basedIn\.countryName !== "Not yet established"/,
      "ProfileHeader hover card must not show 'Account based in' if unestablished or null",
    );
    assert.match(
      profileHeaderSrc,
      /\(aboutData\?\.usernameChanges\?\.count \?\? 0\) > 0/,
      "ProfileHeader hover card must not show 'former usernames' if count is zero",
    );
  });

  const aboutPageSrc = fs.readFileSync(path.resolve(import.meta.dirname, "../src/pages/AboutAccountPage.tsx"), "utf-8");

  it("verifies AboutAccountPage conditionally hides unestablished location and zero former usernames", () => {
    assert.match(
      aboutPageSrc,
      /data\.basedIn\?\.countryName && data\.basedIn\.countryName !== "Not yet established"/,
      "AboutAccountPage must not show 'Account based in' card if unestablished or null",
    );
    assert.match(
      aboutPageSrc,
      /\(data\.usernameChanges\?\.count \?\? 0\) > 0/,
      "AboutAccountPage must not show 'Former usernames' card if count is zero",
    );
  });

  it("verifies AboutAccountPage has no horizontal rules and no transparency section", () => {
    assert.doesNotMatch(
      aboutPageSrc,
      /<PageHeader[\s\S]*?divider/,
      "AboutAccountPage PageHeader must not have divider",
    );
    assert.doesNotMatch(
      aboutPageSrc,
      /borderBottom:\s*"1px solid var\(--color-border-default\)"/,
      "AboutAccountPage header card must not have borderBottom horizontal rule",
    );
    assert.ok(
      !aboutPageSrc.includes("About Account Transparency"),
      "AboutAccountPage must not include 'About Account Transparency' section",
    );
  });

  it("verifies following and followers links in ProfileHoverCard are underlined on hover and labels are muted", () => {
    assert.match(
      hoverCardSrc,
      /const StatLink = styled\(Link\)`[\s\S]*?&:hover\s*\{[\s\S]*?text-decoration:\s*underline;/,
      "StatLink in ProfileHoverCard must underline on hover",
    );
    assert.match(
      hoverCardSrc,
      /const StatLabel = styled\.span`[\s\S]*?color:\s*var\(--color-fg-muted\);/,
      "StatLabel in ProfileHoverCard must use muted font color",
    );
    assert.match(
      hoverCardSrc,
      /<StatLink to=\{`\/@\$\{data\.username\}\/following`\}>[\s\S]*?<StatLabel>Following<\/StatLabel>/,
      "ProfileHoverCard must render Following StatLink with StatLabel",
    );
    assert.match(
      hoverCardSrc,
      /<StatLink to=\{`\/@\$\{data\.username\}\/followers`\}>[\s\S]*?<StatLabel>Followers<\/StatLabel>/,
      "ProfileHoverCard must render Followers StatLink with StatLabel",
    );
  });

  it("verifies following and followers links in ProfileHeader are underlined on hover and labels are muted", () => {
    assert.match(
      profileHeaderSrc,
      /const StatLink = styled\(Link\)`[\s\S]*?&:hover\s*\{[\s\S]*?text-decoration:\s*underline;/,
      "StatLink in ProfileHeader must underline on hover",
    );
    assert.match(
      profileHeaderSrc,
      /const StatLabel = styled\.span`[\s\S]*?color:\s*var\(--color-fg-muted\);/,
      "StatLabel in ProfileHeader must use muted font color",
    );
    assert.match(
      profileHeaderSrc,
      /<StatLink to=\{`\/@\$\{profile\.username\}\/following`\}>[\s\S]*?<StatLabel>Following<\/StatLabel>/,
      "ProfileHeader must render Following StatLink with StatLabel",
    );
    assert.match(
      profileHeaderSrc,
      /<StatLink to=\{`\/@\$\{profile\.username\}\/followers`\}>[\s\S]*?<StatLabel>Followers<\/StatLabel>/,
      "ProfileHeader must render Followers StatLink with StatLabel",
    );
  });

  it("verifies clicking on the profile banner image opens a fullscreen modal exactly like profile avatar", () => {
    // Banner must have interactive button attributes
    assert.match(
      profileHeaderSrc,
      /role="button"[\s\S]*?tabIndex=\{0\}[\s\S]*?aria-label=\{`View \$\{profile\.display_name \|\| profile\.username\}'s header photo`\}[\s\S]*?onClick=\{\(\) => setShowBannerModal\(true\)\}/,
      "ProfileHeader must render banner Box with role='button', tabIndex={0}, and onClick opening showBannerModal",
    );
    // Banner must support keyboard interaction
    assert.match(
      profileHeaderSrc,
      /onKeyDown=\{\(e\) => \{\s*if \(e\.key === "Enter" \|\| e\.key === " "\) \{\s*e\.preventDefault\(\);\s*setShowBannerModal\(true\);/,
      "ProfileHeader must allow triggering banner modal via Enter and Space keys",
    );
    // Banner must have pointer cursor
    assert.match(profileHeaderSrc, /cursor:\s*"pointer"/, "ProfileHeader banner must have cursor: 'pointer'");
    // Banner modal dialog must render with role='dialog' and close button
    assert.match(
      profileHeaderSrc,
      /\{showBannerModal && \(\s*<div[\s\S]*?role="dialog"[\s\S]*?aria-modal="true"[\s\S]*?aria-label=\{`\$\{profile\.display_name \|\| profile\.username\}'s header photo`\}[\s\S]*?onClick=\{\(\) => setShowBannerModal\(false\)\}/,
      "ProfileHeader must render fullscreen banner modal dialog with aria-modal='true' and backdrop click-to-close",
    );
    // Banner modal must contain Close button
    assert.match(
      profileHeaderSrc,
      /setShowBannerModal\(false\)[\s\S]*?<CloseIcon size=\{20\} \/>/,
      "Banner modal must contain Close button to dismiss modal",
    );
    // Escape key listener must dismiss both avatar and banner modals
    assert.match(
      profileHeaderSrc,
      /if \(e\.key === "Escape"\) \{\s*setShowAvatarModal\(false\);\s*setShowBannerModal\(false\);/,
      "Escape key handler must close banner modal",
    );
    // Stacking contexts: avatar must remain layered above banner even when hover filter is active
    assert.match(
      profileHeaderSrc,
      /style=\{\{[\s\S]*?position:\s*"relative"[\s\S]*?zIndex:\s*0[\s\S]*?height:\s*"clamp\(124px,\s*32vw,\s*200px\)"/,
      "Banner must declare position: 'relative' and zIndex: 0",
    );
    assert.match(
      profileHeaderSrc,
      /<Box px=\{4\} style=\{\{\s*marginTop:\s*"clamp\(-65px,\s*-11vw,\s*-44px\)",\s*position:\s*"relative",\s*zIndex:\s*1\s*\}\}>/,
      "Profile content container must declare position: 'relative' and zIndex: 1 to layer above banner",
    );
    assert.match(
      profileHeaderSrc,
      /style=\{\{[\s\S]*?position:\s*"relative"[\s\S]*?zIndex:\s*2[\s\S]*?width:\s*"clamp\(88px,\s*24vw,\s*134px\)"/,
      "Avatar must declare position: 'relative' and zIndex: 2 to prevent banner hover filter from hiding avatar",
    );
  });

  it("verifies AboutHoverCard is portaled to document.body to avoid being trapped below sticky TabBar", () => {
    assert.ok(
      profileHeaderSrc.includes("createPortal(cardElement, document.body)"),
      "AboutHoverCard must be portaled to document.body so sticky tabs (Packages, Articles) do not seep through it",
    );
    assert.ok(
      profileHeaderSrc.includes("updateHoverCardCoords"),
      "ProfileHeader must dynamically calculate hover card viewport coordinates",
    );
  });

  it("verifies VerifiedAccountBadge is portaled to document.body to prevent sticky TabBar and feed posts from seeping through", () => {
    const verifiedBadgeSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/components/VerifiedAccountBadge.tsx"),
      "utf-8",
    );

    assert.ok(
      verifiedBadgeSrc.includes("createPortal(modalNode, document.body)"),
      "VerifiedAccountBadge modal must be portaled to document.body so background tabs and feed do not seep through",
    );

    assert.match(
      verifiedBadgeSrc,
      /z-index:\s*(?:100000|99999);/,
      "VerifiedAccountBadge ModalOverlay must have high z-index (at least 99999) to render above all UI layers",
    );

    assert.ok(
      verifiedBadgeSrc.includes('document.body.style.overflow = "hidden"'),
      "VerifiedAccountBadge must lock document.body scroll while modal is open",
    );

    assert.ok(verifiedBadgeSrc.includes('e.key === "Escape"'), "VerifiedAccountBadge must dismiss on Escape key");
  });
});
