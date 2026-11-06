// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("Signed Account & Post Signatures Architecture Suite", () => {
  const verifiedAccountBadgeSrc = fs.readFileSync(
    path.resolve(import.meta.dirname, "../src/components/VerifiedAccountBadge.tsx"),
    "utf-8",
  );

  const postAuthorHeaderSrc = fs.readFileSync(
    path.resolve(import.meta.dirname, "../src/components/post/PostAuthorHeader.tsx"),
    "utf-8",
  );

  const postNotebookHeaderSrc = fs.readFileSync(
    path.resolve(import.meta.dirname, "../src/components/post/PostNotebookHeader.tsx"),
    "utf-8",
  );

  const postQuotedPostSrc = fs.readFileSync(
    path.resolve(import.meta.dirname, "../src/components/post/PostQuotedPost.tsx"),
    "utf-8",
  );

  const postSignatureModalSrc = fs.readFileSync(
    path.resolve(import.meta.dirname, "../src/components/post/PostSignatureModal.tsx"),
    "utf-8",
  );

  const postSrc = fs.readFileSync(path.resolve(import.meta.dirname, "../src/components/Post.tsx"), "utf-8");

  const aboutAccountPageSrc = fs.readFileSync(
    path.resolve(import.meta.dirname, "../src/pages/AboutAccountPage.tsx"),
    "utf-8",
  );

  const settingsPageSrc = fs.readFileSync(path.resolve(import.meta.dirname, "../src/pages/SettingsPage.tsx"), "utf-8");

  const usersRouteSrc = fs.readFileSync(path.resolve(import.meta.dirname, "../../api/src/routes/users.ts"), "utf-8");

  describe("1. VerifiedAccountBadge Iconography & Copy Accuracy", () => {
    it("uses KeyIcon instead of generic social media checkmark VerifiedIcon", () => {
      assert.ok(
        verifiedAccountBadgeSrc.includes("<KeyIcon size={size} />"),
        "VerifiedAccountBadge must render KeyIcon to communicate cryptographic key ownership",
      );
      assert.ok(
        !verifiedAccountBadgeSrc.includes("<VerifiedIcon"),
        "VerifiedAccountBadge must not use VerifiedIcon checkmark badge",
      );
    });

    it("communicates Signed Account rather than verified identity", () => {
      assert.ok(
        verifiedAccountBadgeSrc.includes("Signed Account — Cryptographic Identity"),
        "Modal header must state 'Signed Account — Cryptographic Identity'",
      );
      assert.ok(
        verifiedAccountBadgeSrc.includes("Signed Account — Posts and Git commits"),
        "Default title must describe Signed Account status",
      );
    });

    it("explicitly clarifies that signing guarantees cryptographic authorship, not real-world identity", () => {
      assert.ok(
        verifiedAccountBadgeSrc.includes(
          "Note: This guarantees cryptographic authorship and tamper resistance, not legal or real-world identity verification.",
        ),
        "Modal must include explicit educational disclaimer distinguishing cryptographic signing from identity verification",
      );
    });

    it("preserves modal portal and accessibility guarantees", () => {
      assert.ok(
        verifiedAccountBadgeSrc.includes("createPortal(modalNode, document.body)"),
        "VerifiedAccountBadge modal must portal to document.body",
      );
      assert.ok(
        verifiedAccountBadgeSrc.includes('document.body.style.overflow = "hidden"'),
        "Must lock body scroll while modal is open",
      );
      assert.ok(verifiedAccountBadgeSrc.includes('e.key === "Escape"'), "Must dismiss on Escape key");
    });
  });

  describe("2. Post-Level Signature Indication & Modal Triggers", () => {
    it("PostAuthorHeader renders SignatureBadge with ShieldCheckIcon for signed posts in detail view", () => {
      assert.ok(
        postAuthorHeaderSrc.includes("{hasSignature && ("),
        "PostAuthorHeader must gate SignatureBadge with hasSignature",
      );
      assert.match(
        postAuthorHeaderSrc,
        /<SignatureBadge[\s\S]*?onClick=\{\(e\) => \{[\s\S]*?onOpenSignatureModal\(\);[\s\S]*?aria-label="View cryptographic post signature"/,
        "SignatureBadge must be clickable, trigger onOpenSignatureModal, and have accessible aria-label",
      );
      assert.ok(
        postAuthorHeaderSrc.includes("<ShieldCheckIcon size={12} />"),
        "SignatureBadge must render ShieldCheckIcon",
      );
      assert.ok(postAuthorHeaderSrc.includes("<span>Signed</span>"), "SignatureBadge must render 'Signed' text");
    });

    it("PostNotebookHeader renders SignatureBadge with onOpenSignatureModal trigger", () => {
      assert.ok(
        postNotebookHeaderSrc.includes("{authorHeaderProps.hasSignature && ("),
        "PostNotebookHeader must gate SignatureBadge on hasSignature",
      );
      assert.match(
        postNotebookHeaderSrc,
        /authorHeaderProps\.onOpenSignatureModal\(\);/,
        "PostNotebookHeader must trigger onOpenSignatureModal",
      );
    });

    it("PostQuotedPost detects signatures on quoted posts and opens PostSignatureModal", () => {
      assert.ok(
        postQuotedPostSrc.includes("const quoteHasSignature = Boolean(quoteSigDigest);"),
        "PostQuotedPost must compute signature existence on quoted posts",
      );
      assert.ok(
        postQuotedPostSrc.includes("<SignatureBadge"),
        "PostQuotedPost must render SignatureBadge on signed quoted posts",
      );
      assert.ok(
        postQuotedPostSrc.includes("<PostSignatureModal"),
        "PostQuotedPost must render PostSignatureModal for quoted posts",
      );
    });

    it("Post.tsx parses signatures from postMeta and passes to PostSignatureModal", () => {
      assert.ok(
        postSrc.includes("postMeta?.client_signature"),
        "Post.tsx must check parsed postMeta for client_signature",
      );
      assert.ok(postSrc.includes("<PostSignatureModal"), "Post.tsx must conditionally mount PostSignatureModal");
      assert.ok(
        postSrc.includes("onOpenSignatureModal: () => setShowSignatureModal(true)"),
        "Post.tsx must expose onOpenSignatureModal handler",
      );
    });
  });

  describe("3. PostSignatureModal Verification & OpenSSH Key Support", () => {
    it("supports OpenSSH public key wire format in verifySignatureWithWebCrypto", () => {
      assert.ok(
        postSignatureModalSrc.includes('keyStr.startsWith("ssh-ed25519 ") || keyStr.includes("AAAAC3NzaC1lZDI1NTE5")'),
        "verifySignatureWithWebCrypto must detect OpenSSH ed25519 public key wire format",
      );
      assert.ok(
        postSignatureModalSrc.includes("wireBytes.slice(19, 19 + 32)"),
        "Must unpack raw 32-byte Ed25519 public key at offset 19 from OpenSSH wire encoding",
      );
    });

    it("provides clear status banners and cryptographic proof inspection", () => {
      assert.ok(
        postSignatureModalSrc.includes("Cryptographically Verified (WebCrypto)"),
        "Modal must display WebCrypto verification status",
      );
      assert.ok(
        postSignatureModalSrc.includes("Cryptographic Proof Value (Base64)"),
        "Modal must render raw proof value for verification",
      );
      assert.ok(
        postSignatureModalSrc.includes("Independent CLI Verification"),
        "Modal must render CLI verification instructions",
      );
    });
  });

  describe("4. AboutAccountPage & Settings Alignment", () => {
    it("AboutAccountPage renders VerifiedAccountBadge for signing_verified users", () => {
      assert.ok(
        aboutAccountPageSrc.includes("{data.signing_verified && ("),
        "AboutAccountPage must check data.signing_verified",
      );
      assert.ok(
        aboutAccountPageSrc.includes("<VerifiedAccountBadge username={data.username} size={18} />"),
        "AboutAccountPage must render VerifiedAccountBadge for signed accounts",
      );
    });

    it("api users /about route returns signing_verified status", () => {
      assert.ok(
        usersRouteSrc.includes("signing_verified: Boolean(profile.signing_verified)"),
        "users.ts /about route must return signing_verified flag",
      );
    });

    it("SettingsPage labels the section as Signed Account & User-Held Signing Keys", () => {
      assert.ok(
        settingsPageSrc.includes('title: "Signed Account & User-Held Signing Keys"'),
        "SettingsPage must label section as 'Signed Account & User-Held Signing Keys'",
      );
    });
  });
});
