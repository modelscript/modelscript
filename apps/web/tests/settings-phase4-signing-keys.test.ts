// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_SRC_DIR = path.resolve(__dirname, "../src");
const SIGNING_KEYS_PATH = path.join(WEB_SRC_DIR, "pages/settings/components/SigningKeysSection.tsx");

describe("Phase 4 Workstream 2: Pasted OpenSSH Key Trust-Level Accuracy & Optional PoP Signature", () => {
  describe("buildPasteKeyRegistrationPayload", () => {
    it("sends trustLevel='unverified_paste' without challenge/signature when no PoP signature is provided", async () => {
      const { buildPasteKeyRegistrationPayload } =
        await import("../src/pages/settings/components/SigningKeysSection.js");

      const payload = buildPasteKeyRegistrationPayload({
        publicKeyOpenssh: "  ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKey user@host  ",
        label: "  Workstation  ",
      });

      assert.deepStrictEqual(payload, {
        publicKeyOpenssh: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKey user@host",
        label: "Workstation",
        trustLevel: "unverified_paste",
      });
      assert.strictEqual("challenge" in payload, false);
      assert.strictEqual("signature" in payload, false);
    });

    it("falls back to trustLevel='unverified_paste' if a challenge was generated but signature is blank", async () => {
      const { buildPasteKeyRegistrationPayload } =
        await import("../src/pages/settings/components/SigningKeysSection.js");

      const payload = buildPasteKeyRegistrationPayload({
        publicKeyOpenssh: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKey user@host",
        challenge: "register:42:1700000000000:abcdef123456",
        signature: "   ",
      });

      assert.deepStrictEqual(payload, {
        publicKeyOpenssh: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKey user@host",
        trustLevel: "unverified_paste",
      });
    });

    it("sends trustLevel='hardware_or_cli' with challenge and signature when PoP signature is provided", async () => {
      const { buildPasteKeyRegistrationPayload } =
        await import("../src/pages/settings/components/SigningKeysSection.js");

      const payload = buildPasteKeyRegistrationPayload({
        publicKeyOpenssh: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKey user@host",
        label: "YubiKey 5C",
        challenge: "  register:42:1700000000000:abcdef123456  ",
        signature: "  z3abcProofOfPossessionSig  ",
      });

      assert.deepStrictEqual(payload, {
        publicKeyOpenssh: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKey user@host",
        label: "YubiKey 5C",
        trustLevel: "hardware_or_cli",
        challenge: "register:42:1700000000000:abcdef123456",
        signature: "z3abcProofOfPossessionSig",
      });
    });
  });

  describe("getPasteKeyRegistrationToast", () => {
    it("returns verified Master Key toast when server returns hardware_or_cli", async () => {
      const { getPasteKeyRegistrationToast } = await import("../src/pages/settings/components/SigningKeysSection.js");

      const toast = getPasteKeyRegistrationToast("hardware_or_cli");
      assert.strictEqual(toast.message, "Hardware/CLI master key verified and registered.");
      assert.ok(!toast.message.includes("Your account is now verified."));
    });

    it("returns unverified paste toast when server returns unverified_paste", async () => {
      const { getPasteKeyRegistrationToast } = await import("../src/pages/settings/components/SigningKeysSection.js");

      const toast = getPasteKeyRegistrationToast("unverified_paste");
      assert.strictEqual(
        toast.message,
        "Public key added as unverified paste. Sign a challenge or commit with this key to upgrade it to a verified Master Key.",
      );
      assert.ok(!toast.message.includes("Your account is now verified."));
    });
  });

  describe("TrustLevelBadge rendering", () => {
    it("renders distinct badges for hardware_or_cli, unverified_paste, and web_browser", async () => {
      const { TrustLevelBadge } = await import("../src/pages/settings/components/SigningKeysSection.js");

      const masterHtml = renderToStaticMarkup(React.createElement(TrustLevelBadge, { trustLevel: "hardware_or_cli" }));
      const unverifiedHtml = renderToStaticMarkup(
        React.createElement(TrustLevelBadge, { trustLevel: "unverified_paste" }),
      );
      const browserHtml = renderToStaticMarkup(
        React.createElement(TrustLevelBadge, { trustLevel: "web_browser", prevKeyId: null }),
      );

      assert.ok(masterHtml.includes("Master Key"), "hardware_or_cli must render Master Key badge");
      assert.ok(!masterHtml.includes("Unverified Paste"), "hardware_or_cli must not render Unverified Paste");

      assert.ok(unverifiedHtml.includes("Unverified Paste"), "unverified_paste must render Unverified Paste badge");
      assert.ok(!unverifiedHtml.includes("Master Key"), "unverified_paste must not render Master Key");

      assert.ok(browserHtml.includes("Browser Key"), "web_browser must render Browser Key badge");
    });
  });

  describe("SigningKeysSection.tsx source verification", () => {
    const src = fs.readFileSync(SIGNING_KEYS_PATH, "utf-8");

    it("does not falsely toast 'Your account is now verified.'", () => {
      assert.ok(
        !src.includes("Your account is now verified."),
        "SigningKeysSection.tsx must not falsely claim 'Your account is now verified.'",
      );
    });

    it("does not fetch getSigningKeyChallenge inside handleRegisterPasteKey and bases toast on regResult.trust_level", () => {
      const startIdx = src.indexOf("const handleRegisterPasteKey = async");
      assert.ok(startIdx !== -1, "handleRegisterPasteKey must exist");
      const endIdx = src.indexOf("const handleGenerateBrowserKey = async", startIdx);
      assert.ok(endIdx !== -1, "handleGenerateBrowserKey must follow handleRegisterPasteKey");

      const handlerBody = src.slice(startIdx, endIdx);
      assert.ok(
        !handlerBody.includes("getSigningKeyChallenge"),
        "handleRegisterPasteKey must not make a wasted getSigningKeyChallenge request when submitting",
      );
      assert.ok(
        handlerBody.includes("regResult.trust_level"),
        "handleRegisterPasteKey must derive toast messaging from returned regResult.trust_level",
      );
    });

    it("exposes optional Proof-of-Possession challenge and ssh-keygen -Y sign instructions in Paste Key modal", () => {
      assert.ok(src.includes("handleFetchPopChallenge"), "Paste Key modal must provide on-demand challenge fetch");
      assert.ok(src.includes("ssh-keygen -Y sign"), "Paste Key modal must show ssh-keygen -Y sign command");
      assert.ok(src.includes("popSignature"), "Paste Key modal must support optional PoP signature input");
      assert.ok(src.includes("<TrustLevelBadge"), "Key list must render TrustLevelBadge");
    });
  });
});
