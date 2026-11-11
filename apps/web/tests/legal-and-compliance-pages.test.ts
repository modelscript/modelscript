// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { InstanceBrandingProvider } from "../src/InstanceBrandingContext";
import { AdminSettingsTab } from "../src/pages/admin/tabs/AdminSettingsTab";
import CookiesPage from "../src/pages/CookiesPage";
import { interpolateLegalMarkdown } from "../src/pages/legal/LegalLayout";
import PrivacyPage from "../src/pages/PrivacyPage";
import TermsPage from "../src/pages/TermsPage";

describe("Mastodon-Grade Legal, Privacy & Cookies Pages + Admin Studio Suite", () => {
  it("renders TermsPage with custom numbered Server Rules, live posture strip, and Addendum markdown", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/terms"] },
        React.createElement(
          InstanceBrandingProvider,
          {
            initialBranding: {
              instanceName: "ETH AeroHub",
              contactEmail: "compliance@aero.ethz.ch",
              registrationMode: "invite_only",
              federationMode: "allowlist",
              authorizedFetchEnabled: true,
              legalJurisdiction: "Zurich, Switzerland",
              legalEffectiveDate: "November 2026",
              legalPolicyMode: "append",
              customTermsMarkdown:
                "## Institutional Addendum\nAll simulation jobs on **{{instanceName}}** are governed by {{jurisdiction}} and managed by {{contactEmail}}.",
              rules: [
                {
                  id: 1,
                  text: "Include mesh convergence metrics on all CFD posts.",
                  hint: "Required for peer verification.",
                  priority: 1,
                  created_at: "2026-11-01T00:00:00Z",
                  updated_at: "2026-11-01T00:00:00Z",
                },
                {
                  id: 2,
                  text: "No ITAR-restricted turbomachinery geometries.",
                  hint: "Export compliance rule.",
                  priority: 2,
                  created_at: "2026-11-01T00:00:00Z",
                  updated_at: "2026-11-01T00:00:00Z",
                },
              ],
            },
          },
          React.createElement(TermsPage),
        ),
      ),
    );

    // Custom numbered server rules rendered
    assert.ok(html.includes("Include mesh convergence metrics on all CFD posts."));
    assert.ok(html.includes("Required for peer verification."));
    assert.ok(html.includes("No ITAR-restricted turbomachinery geometries."));
    assert.ok(html.includes("Instance Configured"));

    // Live posture & interpolated addendum rendered alongside baseline sections
    assert.ok(html.includes("Invite-Only"));
    assert.ok(html.includes("Trusted Peer Allowlist"));
    assert.ok(html.includes("HTTP Signature Authorized Fetch enforced"));
    assert.ok(html.includes("Institutional Addendum"));
    assert.ok(html.includes("Zurich, Switzerland"));
    assert.ok(html.includes("compliance@aero.ethz.ch"));
    assert.ok(html.includes("Disclaimer of Engineering Warranties"));
  });

  it("supports Full Override Mode on TermsPage when legalPolicyMode is 'override'", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/terms"] },
        React.createElement(
          InstanceBrandingProvider,
          {
            initialBranding: {
              instanceName: "CorpSim",
              contactEmail: "legal@corpsim.internal",
              legalPolicyMode: "override",
              customTermsMarkdown:
                "# Exclusive Corporate Intranet Terms for {{instanceName}}\nContact {{contactEmail}}.",
            },
          },
          React.createElement(TermsPage),
        ),
      ),
    );

    assert.ok(html.includes("Exclusive Corporate Intranet Terms for CorpSim"));
    assert.ok(html.includes("legal@corpsim.internal"));
    assert.ok(html.includes("Custom Instance Policy"));
    // Baseline section 7 is replaced in override mode
    assert.ok(!html.includes("7. Disclaimer of Engineering Warranties"));
  });

  it("renders PrivacyPage with first-party HMAC analytics, zero raw IP persistence, and dynamic Cloudflare vs Direct ingress disclosure", () => {
    const directHtml = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/privacy"] },
        React.createElement(
          InstanceBrandingProvider,
          {
            initialBranding: {
              instanceName: "Ansatz",
              ingressMode: "direct",
              cloudflareTunnelConfigured: false,
              remoteContentRetentionDays: 60,
              remoteMediaCacheRetentionDays: 14,
            },
          },
          React.createElement(PrivacyPage),
        ),
      ),
    );

    assert.ok(directHtml.includes("Direct Ingress Active"));
    assert.ok(directHtml.includes("Zero Raw IP Persistence"));
    assert.ok(directHtml.includes("HMAC-SHA256"));
    assert.ok(directHtml.includes("60 days"));
    assert.ok(directHtml.includes("14 days"));

    const cfHtml = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/privacy"] },
        React.createElement(
          InstanceBrandingProvider,
          {
            initialBranding: {
              instanceName: "Ansatz",
              ingressMode: "cloudflare",
              cloudflareTunnelConfigured: true,
            },
          },
          React.createElement(PrivacyPage),
        ),
      ),
    );

    assert.ok(cfHtml.includes("Cloudflare Mode Active"));
    assert.ok(cfHtml.includes("CF-IPCountry"));
    assert.ok(cfHtml.includes("CF-Connecting-IP"));
  });

  it("renders CookiesPage with complete HTTP cookie inventory, localStorage/sessionStorage keys, conditional Cloudflare status, and Live Storage Inspector", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/cookies"] },
        React.createElement(
          InstanceBrandingProvider,
          {
            initialBranding: {
              instanceName: "Ansatz",
              ingressMode: "cloudflare",
              cloudflareTunnelConfigured: true,
            },
          },
          React.createElement(CookiesPage),
        ),
      ),
    );

    assert.ok(html.includes("modelscript_token"));
    assert.ok(html.includes("oauth_state"));
    assert.ok(html.includes("oidc_state"));
    assert.ok(html.includes("__cf_bm"));
    assert.ok(html.includes("cf_clearance"));
    assert.ok(html.includes("Active on this Instance"));
    assert.ok(html.includes("modelscript.modeling_preferences"));
    assert.ok(html.includes("modelscript.viewed_posts"));
    assert.ok(html.includes("live-storage-inspector"));
    assert.ok(html.includes("Clear Non-Essential Local Caches"));
  });

  it("interpolates all template variables in interpolateLegalMarkdown", () => {
    const res = interpolateLegalMarkdown(
      "Welcome to {{instanceName}} ({{registrationMode}}, {{federationMode}}, {{ingressMode}}). Retention: {{remoteRetentionDays}}d / {{remoteMediaRetentionDays}}d. Contact: {{contactEmail}} in {{jurisdiction}} as of {{effectiveDate}}.",
      {
        instanceName: "SimHub",
        contactEmail: "dpo@simhub.org",
        legalJurisdiction: "Germany",
        legalEffectiveDate: "2026-11-02",
        registrationMode: "domain_allowlist",
        federationMode: "open",
        ingressMode: "cloudflare",
        cloudflareTunnelConfigured: true,
        remoteContentRetentionDays: 45,
        remoteMediaCacheRetentionDays: 15,
      },
    );

    assert.ok(res.includes("Welcome to SimHub (domain_allowlist, open, Cloudflare Edge Proxy / Zero-Trust Tunnel)."));
    assert.ok(res.includes("Retention: 45d / 15d."));
    assert.ok(res.includes("Contact: dpo@simhub.org in Germany as of 2026-11-02."));
  });

  it("renders AdminSettingsTab with Numbered Instance Server Rules Manager and 3-Document Legal Studio", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(AdminSettingsTab, {
          settings: {
            instanceName: "Ansatz",
            instanceDescription: "Engineering network",
            contactEmail: "admin@ansatz.social",
            registrationMode: "open",
            allowedEmailDomains: [],
            federationMode: "open",
            maintenanceMode: false,
            announcementBanner: "",
            announcementLevel: "info",
            autoQuarantineReportThreshold: 5,
            backupRetentionCount: 14,
            customTermsMarkdown: "# Custom Terms",
            customPrivacyMarkdown: "# Custom Privacy",
            customCookiesMarkdown: "# Custom Cookies",
            legalPolicyMode: "append",
            legalJurisdiction: "Delaware, USA",
            legalEffectiveDate: "November 2026",
            lockedByEnv: [],
          },
          invites: [],
          onSaveSettings: async () => {},
          onCreateInvite: async () => {},
          onRevokeInvite: async () => {},
          loading: false,
        }),
      ),
    );

    assert.ok(html.includes("Numbered Instance Server Rules (Mastodon Governance Parity)"));
    assert.ok(html.includes("Seed Default Engineering &amp; Community Rules"));
    assert.ok(html.includes("Custom Instance Legal &amp; Compliance Policies (Terms, Privacy &amp; Cookies Studio)"));
    assert.ok(html.includes("Custom Cookie &amp; Local Storage Policy (Markdown)"));
    assert.ok(html.includes("Delaware, USA"));
    assert.ok(html.includes("November 2026"));
  });

  it("wires RightPanel footer links directly to /terms, /privacy, and /cookies and displays the Ansatz version", () => {
    const rightPanelPath = path.resolve(import.meta.dirname, "../src/components/RightPanel.tsx");
    const src = fs.readFileSync(rightPanelPath, "utf8");
    assert.ok(src.includes('to="/terms"'), "RightPanel must link directly to /terms");
    assert.ok(src.includes('to="/privacy"'), "RightPanel must link directly to /privacy");
    assert.ok(src.includes('to="/cookies"'), "RightPanel must link directly to /cookies");
    assert.ok(
      src.includes('href="https://github.com/modelscript/modelscript"'),
      "RightPanel version link must point to https://github.com/modelscript/modelscript",
    );
    assert.ok(
      src.includes("ModelScript v{version}") || src.includes('{branding.instanceName || "Ansatz"} v{version}'),
      "RightPanel footer must display the ModelScript version",
    );
  });
});
