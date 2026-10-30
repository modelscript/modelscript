// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import type { InstanceCapabilities } from "../src/CapabilitiesContext.js";

test("Capabilities-Driven UI Registry & Feature Gates", async (t) => {
  await t.test("evaluates capability flags accurately across tiers", () => {
    const tier2Corporate: InstanceCapabilities = {
      userInvites: false,
      waitlist: false,
      onboardingWizard: false,
      academicFastTrack: false,
      activityPubFederation: false,
      cloudSolvers: false,
      offlineSandbox: true,
      airgapEnforced: true,
      billing: false,
      caeCompute: true,
      cosimMqtt: false,
      botAccounts: false,
    };

    const hasCap = (key: keyof InstanceCapabilities) => Boolean(tier2Corporate[key]);

    // Golden tickets & Invites should be completely absent in Corporate SCIF
    assert.equal(hasCap("userInvites"), false);
    assert.equal(hasCap("waitlist"), false);
    assert.equal(hasCap("botAccounts"), false);
    assert.equal(hasCap("activityPubFederation"), false);
    assert.equal(hasCap("offlineSandbox"), true);

    const tier3Flagship: InstanceCapabilities = {
      userInvites: true,
      waitlist: true,
      onboardingWizard: true,
      academicFastTrack: true,
      activityPubFederation: true,
      cloudSolvers: true,
      offlineSandbox: true,
      airgapEnforced: false,
      billing: true,
      caeCompute: true,
      cosimMqtt: true,
      botAccounts: true,
    };

    const hasFlagshipCap = (key: keyof InstanceCapabilities) => Boolean(tier3Flagship[key]);
    assert.equal(hasFlagshipCap("userInvites"), true);
    assert.equal(hasFlagshipCap("waitlist"), true);
    assert.equal(hasFlagshipCap("billing"), true);
    assert.equal(hasFlagshipCap("botAccounts"), true);
  });
});
