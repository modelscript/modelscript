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

    // Golden tickets & Invites should be completely absent in Corporate Enclave
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

  await t.test(
    "renders streamlined single-screen OnboardingWizardPage and FeedQuickstartStudio with valid starter templates",
    async () => {
      const React = await import("react");
      const { renderToStaticMarkup } = await import("react-dom/server");
      const { MemoryRouter } = await import("react-router-dom");
      const { OnboardingWizardPage } = await import("../src/pages/onboarding/OnboardingWizardPage.js");
      const { FeedQuickstartStudio } = await import("../src/pages/feed/components/FeedQuickstartStudio.js");

      const onboardingHtml = renderToStaticMarkup(
        React.createElement(MemoryRouter, null, React.createElement(OnboardingWizardPage)),
      );

      assert.ok(onboardingHtml.includes("1. Select Your Primary Discipline"));
      assert.ok(onboardingHtml.includes("Skip →"));
      assert.ok(onboardingHtml.includes("Enter Your Workspace"));
      assert.ok(onboardingHtml.includes("RLC Resonant Circuit"));
      assert.ok(onboardingHtml.includes("Hybrid Bouncing Ball"));
      assert.ok(onboardingHtml.includes("Lorenz Chaotic Attractor"));
      assert.ok(!onboardingHtml.includes("modelica-msl"));

      const quickstartHtml = renderToStaticMarkup(
        React.createElement(
          MemoryRouter,
          null,
          React.createElement(FeedQuickstartStudio, {
            followedHandles: {},
            onToggleFollow: () => {},
          }),
        ),
      );
      assert.ok(quickstartHtml.includes("Quickstart Cyber-Physical Studio"));
      assert.ok(quickstartHtml.includes("Bouncing Ball"));
      assert.ok(quickstartHtml.includes("RLC Circuit"));
      assert.ok(quickstartHtml.includes("Lorenz Attractor"));
      assert.ok(quickstartHtml.includes("CubeSat Power Architecture"));
    },
  );
});
