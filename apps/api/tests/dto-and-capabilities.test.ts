// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { buildInstanceCapabilities, toActivityPubActor, toUserPublicDTO, toUserSelfDTO } from "../src/dto/index.js";

test("Wire-Format DTOs & Capabilities Anti-Corruption Layer", async (t) => {
  await t.test("toUserPublicDTO preserves public profile and excludes sensitive credentials", () => {
    const rawUser = {
      id: 42,
      username: "curator_alice",
      display_name: "Alice Engineering",
      email: "alice@ansatz.social",
      password_hash: "argon2id$v=19$m=65536,t=3,p=4$secret",
      totp_secret: "JBSWY3DPEHPK3PXP",
      token_version: 3,
      avatar_url: "/avatars/alice.png",
      bio: "CFD & Multiphysics researcher",
      follower_count: 128,
      following_count: 64,
      post_count: 32,
      engineering_persona: "aerospace",
    };

    const publicDto = toUserPublicDTO(rawUser);
    assert.equal(publicDto.id, 42);
    assert.equal(publicDto.username, "curator_alice");
    assert.equal(publicDto.displayName, "Alice Engineering");
    assert.equal(publicDto.avatarUrl, "/avatars/alice.png");
    assert.equal(publicDto.bio, "CFD & Multiphysics researcher");
    assert.equal(publicDto.engineeringPersona, "aerospace");
    assert.equal(publicDto.followerCount, 128);

    // Assert sensitive fields are completely absent from public DTO
    assert.equal((publicDto as Record<string, unknown>)["password_hash"], undefined);
    assert.equal((publicDto as Record<string, unknown>)["totp_secret"], undefined);
    assert.equal((publicDto as Record<string, unknown>)["token_version"], undefined);
    assert.equal((publicDto as Record<string, unknown>)["email"], undefined);
  });

  await t.test("toUserSelfDTO exposes private self status with safe fallback defaults", () => {
    const rawUser = {
      id: 99,
      username: "new_researcher",
      email: "researcher@tum.de",
      email_verified: 1,
      credit_balance: 150.0,
      onboarding_completed: 1,
      // invites_remaining omitted to test backward-compatibility fallback
    };

    const selfDto = toUserSelfDTO(rawUser);
    assert.equal(selfDto.id, 99);
    assert.equal(selfDto.email, "researcher@tum.de");
    assert.equal(selfDto.emailVerified, true);
    assert.equal(selfDto.creditBalance, 150.0);
    assert.equal(selfDto.onboardingCompleted, true);
    assert.equal(selfDto.invitesRemaining, 0, "Should default invitesRemaining to 0 when omitted");
  });

  await t.test("toActivityPubActor produces standard W3C AS2 Person payload", () => {
    const user = {
      id: 7,
      username: "dr_euler",
      display_name: "Leonhard Euler",
      bio: "Fluid mechanics & mathematical physics",
      rsa_public_key: "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...\n-----END PUBLIC KEY-----",
      avatar_url: "https://ansatz.social/avatars/euler.png",
    };

    const actor = toActivityPubActor(user, "https://ansatz.social");
    assert.equal(actor.type, "Person");
    assert.equal(actor.preferredUsername, "dr_euler");
    assert.equal(actor.id, "https://ansatz.social/users/dr_euler");
    assert.equal(actor.inbox, "https://ansatz.social/users/dr_euler/inbox");
    assert.equal(actor.outbox, "https://ansatz.social/users/dr_euler/outbox");
    assert.equal(actor.publicKey?.publicKeyPem, user.rsa_public_key);
    assert.equal(actor.icon?.url, "https://ansatz.social/avatars/euler.png");
    assert.ok(actor["@context"].includes("https://www.w3.org/ns/activitystreams"));
  });

  await t.test("buildInstanceCapabilities adapts to Tier 1, Tier 2, and Tier 3 presets", () => {
    // Corporate SCIF node (Tier 2): offline, air-gapped, no invites or public federation
    const corporateCaps = buildInstanceCapabilities(
      {
        instanceTier: "tier2_corporate",
        registrationMode: "domain_allowlist",
        federationMode: "disabled",
        userInvitesEnabled: false,
        waitlistEnabled: false,
        onboardingWizardEnabled: false,
      },
      "tier2_corporate",
    );
    assert.equal(corporateCaps.tier, "tier2_corporate");
    assert.equal(corporateCaps.capabilities.userInvites, false);
    assert.equal(corporateCaps.capabilities.activityPubFederation, false);
    assert.equal(corporateCaps.capabilities.waitlist, false);

    // Flagship node (Tier 3): open registration, waitlist, golden tickets, federation
    const flagshipCaps = buildInstanceCapabilities(
      {
        instanceTier: "tier3_flagship",
        registrationMode: "open",
        federationMode: "open",
        userInvitesEnabled: true,
        waitlistEnabled: true,
        onboardingWizardEnabled: true,
      },
      "tier3_flagship",
    );
    assert.equal(flagshipCaps.tier, "tier3_flagship");
    assert.equal(flagshipCaps.capabilities.userInvites, true);
    assert.equal(flagshipCaps.capabilities.waitlist, true);
    assert.equal(flagshipCaps.capabilities.activityPubFederation, true);
  });
});
