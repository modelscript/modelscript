// SPDX-License-Identifier: AGPL-3.0-or-later

import { ShieldCheckIcon } from "@primer/octicons-react";
import { Link } from "react-router-dom";
import { useInstanceBranding } from "../InstanceBrandingContext";
import { usePageTitle } from "../util/title";
import {
  InlineCode,
  LegalLayout,
  LegalSection,
  LegalTable,
  PillBadge,
  TldrBox,
  type TocItem,
} from "./legal/LegalLayout";

const PRIVACY_TOC: TocItem[] = [
  { id: "data-collected", label: "1. Data Collection Matrix" },
  { id: "first-party-analytics", label: "2. First-Party HMAC Analytics" },
  { id: "cloudflare-ingress", label: "3. Ingress & Optional Cloudflare" },
  { id: "federation-privacy", label: "4. ActivityPub & Remote Retention" },
  { id: "model-sovereignty", label: "5. Model & AI Data Sovereignty" },
  { id: "retention-security", label: "6. 30-Day Audit Log Rotation" },
  { id: "gdpr-ccpa-rights", label: "7. GDPR / CCPA Archive & Erasure" },
];

export default function PrivacyPage() {
  usePageTitle("Privacy Policy & Data Sovereignty");
  const branding = useInstanceBranding();
  const brandName = branding.instanceName || "Ansatz";
  const contactEmail = branding.contactEmail || "admin@ansatz.social";
  const isCloudflare = branding.ingressMode === "cloudflare" || Boolean(branding.cloudflareTunnelConfigured);

  return (
    <LegalLayout
      activeDoc="privacy"
      title="Privacy & Data Sovereignty Policy"
      subtitle={`How ${brandName} protects your personal data, engineering models, and telemetry with zero third-party trackers, in-memory HMAC analytics, and full GDPR/CCPA portability.`}
      icon={<ShieldCheckIcon size={32} />}
      toc={PRIVACY_TOC}
      customMarkdown={branding.customPrivacyMarkdown}
    >
      {/* 1. Data Collection & Minimization Matrix */}
      <LegalSection id="data-collected">
        <h2>1. Information We Collect &amp; Legal Basis</h2>
        <TldrBox>
          <p style={{ margin: 0 }}>
            <strong>In Plain English:</strong> We collect only the minimum account, repository, and operational data
            required to authenticate you, run your simulations, and federate your public posts. We never sell personal
            data or load third-party ad trackers.
          </p>
        </TldrBox>
        <LegalTable>
          <thead>
            <tr>
              <th>Data Category</th>
              <th>Specific Fields &amp; Artifacts</th>
              <th>Purpose &amp; GDPR Legal Basis</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>Account &amp; Identity</strong>
              </td>
              <td>
                Username, email address (plus canonicalized anti-Sybil hash), bcrypt password hash, optional TOTP 2FA
                secret, RSA-2048 ActivityPub actor keypair, and optional profile fields (bio, institution, verified
                ORCID URI).
              </td>
              <td>
                Account authentication, Sybil/abuse prevention, and federated identity verification (Art. 6(1)(b)
                Contract &amp; Art. 6(1)(f) Legitimate Interest).
              </td>
            </tr>
            <tr>
              <td>
                <strong>Models, Repos &amp; Social Posts</strong>
              </td>
              <td>
                Authored posts, polls, media attachments, Git repositories, Modelica/SysML/CAD source files, published
                packages, and simulation job configurations.
              </td>
              <td>
                Hosting user-created engineering artifacts and delivering posts according to your chosen visibility tier
                (Art. 6(1)(b) Contract).
              </td>
            </tr>
            <tr>
              <td>
                <strong>Corporate SSO &amp; Identity</strong>
              </td>
              <td>
                Corporate OIDC / SAML 2.0 Subject IDs (<InlineCode>sub</InlineCode>), institutional email claims, given
                and family names, and Active Directory / IdP group-to-role mappings.
              </td>
              <td>
                Enterprise single sign-on authentication and organization role-based access control (Art. 6(1)(b)
                Contract &amp; Art. 6(1)(f) Legitimate Interest).
              </td>
            </tr>
            <tr>
              <td>
                <strong>Industrial &amp; Digital Twin Telemetry</strong>
              </td>
              <td>
                TimescaleDB operational sensor time-series streams, physical asset hardware birth certificates / serial
                numbers, and distributed MQTT co-simulation frames.
              </td>
              <td>
                Executing operational digital twin monitoring and co-simulation workloads; treated as confidential
                industrial data (Art. 6(1)(b) Contract).
              </td>
            </tr>
            <tr>
              <td>
                <strong>First-Party Page &amp; Post Telemetry</strong>
              </td>
              <td>
                Aggregate daily route view counts (<InlineCode>web</InlineCode> and <InlineCode>docs</InlineCode>{" "}
                surfaces), post dwell-time view counts, and coarse ISO-3166 country/region codes resolved in memory.
              </td>
              <td>
                Privacy-preserving platform reliability and creator post reach metrics without storing raw IP addresses
                (Art. 6(1)(f)).
              </td>
            </tr>
            <tr>
              <td>
                <strong>Security &amp; Audit Logs</strong>
              </td>
              <td>
                Authentication events, admin/moderation actions, export control enforcement blocks, and client IP
                addresses in the security audit trail, chained with SHA-256 integrity hashes.
              </td>
              <td>
                Intrusion detection, rate-limiting, and regulatory compliance; automatically purged after 30 days (Art.
                6(1)(c) &amp; Art. 6(1)(f)).
              </td>
            </tr>
            <tr>
              <td>
                <strong>Regulatory Compliance Attestations</strong>
              </td>
              <td>
                Ed25519-signed FDA 21 CFR Part 11 Design History File (DHF) verification dossiers, NERC CIP / FERC CEII
                / IEEE 2800 certificates, and audit ledger head hashes.
              </td>
              <td>
                Statutory regulatory compliance; retained for the statutory lifecycle of the medical device or critical
                infrastructure asset (Art. 6(1)(c) &amp; Art. 17(3)(b)).
              </td>
            </tr>
          </tbody>
        </LegalTable>
      </LegalSection>

      {/* 2. First-Party Analytics & Daily Rotating HMAC */}
      <LegalSection id="first-party-analytics">
        <h2>
          2. First-Party, Zero-Tracker Analytics &amp; Ephemeral Geo-Resolution{" "}
          <PillBadge $tone="green">Zero Raw IP Persistence</PillBadge>
        </h2>
        <TldrBox>
          <p style={{ margin: 0 }}>
            <strong>In Plain English:</strong> {brandName} does <strong>not</strong> use Google Analytics, Meta Pixel,
            Hotjar, or third-party telemetry SDKs. Pageviews and post analytics are computed 100% first-party using an
            in-memory MaxMind/DB-IP lookup and a daily rotating RAM-only HMAC salt—meaning your raw IP address is never
            written to any analytics table.
          </p>
        </TldrBox>
        <p>
          When you navigate across the web application or documentation portal (
          <InlineCode>/api/v1/analytics/pageview</InlineCode>) or view a post for at least the dwell-time threshold, our
          first-party telemetry service processes the request through four strict privacy safeguards:
        </p>
        <ul>
          <li>
            <strong>1. In-Memory ISO Country/Region Resolution:</strong> Client IP addresses are resolved in volatile
            memory to a 2-letter ISO-3166-1 alpha-2 country code and optional subdivision code (using a local offline
            MaxMind GeoLite2 / DB-IP <InlineCode>.mmdb</InlineCode> database or edge geo headers) and immediately
            discarded. Raw IP strings are never persisted in <InlineCode>analytics_daily_views</InlineCode>,{" "}
            <InlineCode>analytics_country_views</InlineCode>, or post view tables.
          </li>
          <li>
            <strong>2. Ephemeral Daily Rotating HMAC-SHA256 Deduplication:</strong> To count unique daily visitors
            without tracking cookies or persistent identifiers, the server computes{" "}
            <InlineCode>HMAC-SHA256(dailySalt, IP | Geo | User-Agent | Scope)</InlineCode> using a 32-byte
            cryptographically random salt (<InlineCode>crypto.randomBytes(32)</InlineCode>) held exclusively in RAM.
            Every UTC midnight (or on server restart), the salt is destroyed and regenerated, making historical
            correlation mathematically impossible.
          </li>
          <li>
            <strong>3. Automated Bot &amp; Crawler Filtering:</strong> Requests matching known search crawlers, headless
            browsers, and AI scrapers are filtered out prior to rollup aggregation.
          </li>
          <li>
            <strong>4. Configurable Rollup Pruning:</strong> Aggregate daily traffic buckets store only route paths and
            coarse country/region totals, and administrators can prune historical rollups older than 90, 30, or 7 days
            at any time.
          </li>
        </ul>
      </LegalSection>

      {/* 3. Network Ingress & Optional Cloudflare Edge / Tunnel Disclosure */}
      <LegalSection id="cloudflare-ingress">
        <h2>
          3. Network Ingress &amp; Optional Cloudflare Edge / Tunnel Disclosure{" "}
          <PillBadge $tone={isCloudflare ? "amber" : "green"} data-testid="privacy-ingress-mode-badge">
            {isCloudflare ? "Cloudflare Mode Active" : "Direct Ingress Active"}
          </PillBadge>
        </h2>
        <TldrBox>
          <p style={{ margin: 0 }}>
            <strong>In Plain English:</strong> Instance operators can deploy {brandName} either via{" "}
            <strong>Direct Ingress</strong> (no CDN intermediary) or behind <strong>Cloudflare Edge / Tunnel</strong>{" "}
            for DDoS and WAF protection. Currently, this instance is running in{" "}
            <strong>{isCloudflare ? "Cloudflare Edge / Tunnel" : "Direct Origin Ingress"}</strong> mode.
          </p>
        </TldrBox>
        <ul>
          <li>
            <strong>
              Direct Origin Ingress (<InlineCode>ingressMode = &quot;direct&quot;</InlineCode>):
            </strong>{" "}
            When deployed in direct mode (or air-gapped enterprise mode), TLS connections terminate directly at the
            operator&rsquo;s reverse proxy with no third-party CDN in the request path.
          </li>
          <li>
            <strong>
              Optional Cloudflare Edge Proxy &amp; Zero-Trust Tunnel (
              <InlineCode>ingressMode = &quot;cloudflare&quot;</InlineCode>):
            </strong>{" "}
            When an instance operator enables Cloudflare proxy or <InlineCode>cloudflared</InlineCode> tunnel ingress to
            protect ActivityPub inboxes and API endpoints from DDoS attacks:
            <ul>
              <li>
                Network traffic traverses Cloudflare&rsquo;s edge network, which processes your connection IP and TLS
                handshake in accordance with Cloudflare&rsquo;s security and DDoS mitigation policies.
              </li>
              <li>
                Cloudflare forwards standard edge headers (<InlineCode>CF-Connecting-IP</InlineCode>,{" "}
                <InlineCode>CF-IPCountry</InlineCode>, <InlineCode>CF-Region-Code</InlineCode>, and{" "}
                <InlineCode>CF-Ray</InlineCode>) to the {brandName} origin server.
              </li>
              <li>
                Our geolocation service prioritizes Cloudflare&rsquo;s <InlineCode>CF-IPCountry</InlineCode> and{" "}
                <InlineCode>CF-Region-Code</InlineCode> headers in memory so that local tunnel/proxy hop IPs are never
                misattributed and raw client IPs never need to be logged for analytics.
              </li>
              <li>
                If the operator enables Cloudflare Bot Fight Mode or WAF Turnstile challenges, Cloudflare may set
                strictly necessary security cookies (<InlineCode>__cf_bm</InlineCode> or{" "}
                <InlineCode>cf_clearance</InlineCode>) as documented in our <Link to="/cookies">Cookie Policy</Link>.
              </li>
            </ul>
          </li>
        </ul>
      </LegalSection>

      {/* 4. ActivityPub Federation & Remote Retention */}
      <LegalSection id="federation-privacy">
        <h2>4. ActivityPub Federation &amp; Remote Data Retention</h2>
        <TldrBox>
          <p style={{ margin: 0 }}>
            <strong>In Plain English:</strong> When federation is enabled, public and federated posts are delivered to
            remote servers where your followers live. Deleting a post or your account broadcasts cryptographic{" "}
            <InlineCode>Delete</InlineCode> tombstones to federated peers.
          </p>
        </TldrBox>
        <ul>
          <li>
            <strong>
              Current Federation Posture (<InlineCode>{branding.federationMode || "open"}</InlineCode>):
            </strong>{" "}
            {branding.federationMode === "disabled"
              ? "Federation is currently disabled (air-gapped posture). No posts, profile data, or activities leave this server."
              : `When you publish public or federated content or interact with remote actors, your activity is signed with your actor RSA-2048 key and delivered to the recipient servers' ActivityPub inboxes.`}
          </li>
          <li>
            <strong>
              Authorized Fetch (<InlineCode>authorizedFetchEnabled</InlineCode>):
            </strong>{" "}
            {branding.authorizedFetchEnabled
              ? "This instance enforces HTTP Signature verification on all inbound ActivityPub object fetches, preventing unsigned or suspended servers from scraping actor profiles or posts."
              : "Instance administrators may enable Authorized Fetch (Secure Mode) to require cryptographic HTTP Signatures on all remote object fetches."}
          </li>
          <li>
            <strong>Remote Content &amp; Media Cache Retention:</strong> To minimize database footprint and respect
            remote users&rsquo; privacy, cached remote posts are subject to a configurable retention window (currently{" "}
            <strong>{branding.remoteContentRetentionDays ?? 90} days</strong>) and proxied remote media attachments are
            cached for <strong>{branding.remoteMediaCacheRetentionDays ?? 30} days</strong> before automated pruning.
          </li>
          <li>
            <strong>Federated Deletion Tombstones:</strong> When you delete a post or permanently erase your account,{" "}
            <strong>{brandName}</strong> immediately removes local records and dispatches signed{" "}
            <InlineCode>Delete(Note)</InlineCode> or <InlineCode>Delete(Actor)</InlineCode> activities to known remote
            peer inboxes. While compliant ActivityPub servers honor these tombstones immediately, we cannot force
            non-compliant third-party servers outside our control to erase cached copies.
          </li>
        </ul>
      </LegalSection>

      {/* 5. Engineering Model Sovereignty, AI & Model Context Protocol (MCP) Policy */}
      <LegalSection id="model-sovereignty">
        <h2>5. Engineering Model Sovereignty, AI &amp; Model Context Protocol (MCP) Governance</h2>
        <TldrBox>
          <p style={{ margin: 0 }}>
            <strong>In Plain English:</strong> Your private repositories, Modelica/SysML models, and simulation results
            belong strictly to you. {brandName} never trains AI or surrogate models on private repositories.
          </p>
        </TldrBox>
        <ul>
          <li>
            <strong>Client-Side WebAssembly Execution:</strong> Interactive parsing (
            <InlineCode>parser.wasm</InlineCode>), DAE flattening, and in-browser numerical simulations execute locally
            within your browser&rsquo;s isolated WebAssembly linear memory arena without transmitting private scratchpad
            models to third parties.
          </li>
          <li>
            <strong>Private Repositories &amp; Workspaces:</strong> Private Git repositories, encrypted credentials, and
            private cloud solver trajectories are accessible strictly to you and explicitly authorized collaborators.
          </li>
          <li>
            <strong>No Unauthorized AI Training:</strong> <strong>{brandName}</strong> does not train foundation models
            or public neural surrogates on private user repositories, private simulation traces, or direct messages.
          </li>
          <li>
            <strong>
              Hosted Model Context Protocol (MCP) Gateways (<InlineCode>/api/v1/mcp</InlineCode>):
            </strong>{" "}
            When AI agents connect via Server-Sent Events (SSE) or client-side stdio MCP servers, operations execute
            strictly within your authorized workspaces. Prompt contents and simulation outputs processed over MCP are
            never retained to train upstream models.
          </li>
          <li>
            <strong>Automated AI PR Reviews &amp; Composer AI:</strong> Pull request code reviews (
            <InlineCode>/api/v1/repos/:id/reviews</InlineCode>) and workbench code synthesis operate under
            zero-data-retention (ZDR) agreements in cloud environments. In Enterprise Appliance mode, all external AI
            API calls are blocked; AI assistance runs strictly through private, self-hosted intranet models (such as
            Ollama or vLLM).
          </li>
          <li>
            <strong>
              Public AI Mirrors &amp; <InlineCode>llms.txt</InlineCode>:
            </strong>{" "}
            Public package manifests, models, and open documentation are indexed into token-dense Markdown mirrors and{" "}
            <InlineCode>llms.txt</InlineCode> catalogs for AI search crawlers. Private repositories and user accounts
            are strictly excluded from AI search manifests and crawler endpoints.
          </li>
        </ul>
      </LegalSection>

      {/* 6. Security Audit Logs & 30-Day Rotation */}
      <LegalSection id="retention-security">
        <h2>6. Security Audit Log Rotation (30-Day TTL) &amp; Regulatory Compliance Retention</h2>
        <TldrBox>
          <p style={{ margin: 0 }}>
            <strong>In Plain English:</strong> Standard operational security logs are protected by a tamper-evident
            SHA-256 hash chain and automatically purged after 30 days. Formal regulatory compliance dossiers (FDA 21 CFR
            Part 11, NERC CIP) are retained as required by statutory law.
          </p>
        </TldrBox>
        <ul>
          <li>
            <strong>30-Day Automated Log Rotation:</strong> Operational security events, login attempts, sudo step-up
            verifications, and moderation actions are retained for a maximum of <strong>30 days</strong>, after which
            background maintenance routines permanently purge expired entries.
          </li>
          <li>
            <strong>Tamper-Evident SHA-256 Audit Chain:</strong> Every administrative and security audit entry links
            cryptographically to the preceding entry&rsquo;s SHA-256 digest (<InlineCode>prev_hash</InlineCode> &rarr;{" "}
            <InlineCode>entry_hash</InlineCode>), allowing compliance auditors to verify log integrity without exposing
            personal user content.
          </li>
          <li>
            <strong>Statutory Regulatory Compliance Retention Carve-Out:</strong> Where users or organizations generate
            Ed25519-signed regulatory compliance attestations (e.g., FDA 21 CFR Part 11 Design History Files, NERC CIP,
            or IEEE 2800 grid compliance certificates), audit ledger head hashes and verification dossiers are retained
            for the statutory lifespan of the engineering device or infrastructure asset pursuant to GDPR Art. 17(3)(b)
            and Art. 6(1)(c).
          </li>
        </ul>
      </LegalSection>

      {/* 7. Your Rights Under GDPR & CCPA */}
      <LegalSection id="gdpr-ccpa-rights">
        <h2>7. Your Rights (GDPR / CCPA): Offline Data Archive, Git Vault &amp; Permanent Erasure</h2>
        <TldrBox>
          <p style={{ margin: 0 }}>
            <strong>In Plain English:</strong> You have self-service tools to download a complete, offline-browsable ZIP
            archive, clone your personal activity via Git, or permanently erase your account at any time—no support
            ticket required.
          </p>
        </TldrBox>
        <ul>
          <li>
            <strong>Right to Data Portability (GDPR Art. 20 / CCPA § 1798.100):</strong> Visit{" "}
            <Link to="/settings/dataArchive">Account Settings &rarr; Data Archive</Link> to exercise portability via two
            independent channels:
            <ul>
              <li>
                <strong>Offline Standalone ZIP Archive:</strong> Generate and download a self-contained{" "}
                <InlineCode>.zip</InlineCode> bundle containing your profile, ActivityPub social graph (CSV/JSON),
                authored posts, repositories, models, and compute ledger, bundled with a standalone offline HTML viewer
                with zero external CDN dependencies.
              </li>
              <li>
                <strong>Personal Activity Git Vault:</strong> Clone your entire personal activity, posts, simulation
                studies, and security audit logs in real time via standard Git Smart HTTP (
                <InlineCode>git clone</InlineCode>). Git vault caches have an ephemeral 24-hour TTL and can be instantly
                purged via the self-service cache cleaner.
              </li>
            </ul>
          </li>
          <li>
            <strong>Right to Erasure / &ldquo;Right to be Forgotten&rdquo; (GDPR Art. 17 / CCPA § 1798.105):</strong>{" "}
            Visit <Link to="/settings/privacy">Account Settings &rarr; Privacy &amp; Data Protection</Link> to
            permanently anonymize and erase your account, email, credentials, posts, models, and personal records from
            active databases. Cryptographic actor keys are erased and signed <InlineCode>Delete</InlineCode> tombstones
            are dispatched to federated ActivityPub peers.
          </li>
          <li>
            <strong>Data Protection Inquiries:</strong> For additional GDPR, CCPA, or institutional data processing
            inquiries, contact the instance operator at <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
          </li>
        </ul>
      </LegalSection>
    </LegalLayout>
  );
}
