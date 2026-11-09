// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckCircleIcon, ShieldLockIcon, SyncIcon, TrashIcon } from "@primer/octicons-react";
import { useCallback, useEffect, useState } from "react";
import styledImport from "styled-components";
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

const styled: typeof styledImport = (styledImport as any).default ?? styledImport;

const InspectorBox = styled.div`
  background: var(--color-canvas-subtle);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 18px 20px;
  margin-top: 16px;
`;

const InspectorHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 14px;
`;

const ActionBtn = styled.button<{ $danger?: boolean | undefined }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 13px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid ${(p) => (p.$danger ? "rgba(239, 68, 68, 0.45)" : "var(--color-border)")};
  background: ${(p) => (p.$danger ? "rgba(239, 68, 68, 0.1)" : "var(--color-bg-card)")};
  color: ${(p) => (p.$danger ? "#ef4444" : "var(--color-text-heading)")};
  transition: all 0.15s ease;

  &:hover {
    opacity: 0.9;
  }
`;

interface StorageEntrySnapshot {
  area: "localStorage" | "sessionStorage";
  key: string;
  bytes: number;
  essential: boolean;
  purpose: string;
}

const COOKIES_TOC: TocItem[] = [
  { id: "http-cookies", label: "1. Strictly Necessary Cookies" },
  { id: "local-storage", label: "2. Browser localStorage Keys" },
  { id: "session-storage", label: "3. Tab sessionStorage Keys" },
  { id: "indexeddb-wasm", label: "4. IndexedDB & WASM Arena" },
  { id: "storage-inspector", label: "5. Live Storage Inspector" },
];

function classifyStorageKey(key: string): { essential: boolean; purpose: string } {
  if (key === "modelscript-auth-token" || key === "token" || key === "user" || key === "modelscript.token") {
    return { essential: true, purpose: "Authenticated session JWT & user profile cache" };
  }
  if (key === "ms-theme" || key === "vitepress-theme-appearance") {
    return { essential: false, purpose: "UI dark/light appearance theme preference" };
  }
  if (key === "modelscript.modeling_preferences") {
    return { essential: false, purpose: "Solver tolerances, unit system & workbench layout preferences" };
  }
  if (key === "modelscript.ai_engine") {
    return { essential: false, purpose: "Composer AI assistant engine preference" };
  }
  if (key === "modelscript.dismissed_trends") {
    return { essential: false, purpose: "Dismissed trending topics in the right sidebar" };
  }
  if (key === "modelscript.viewed_posts") {
    return { essential: false, purpose: "Tab-scoped post dwell-time view deduplication" };
  }
  if (key.startsWith("modelscript.sim_baseline")) {
    return { essential: false, purpose: "Morsel simulation trajectory comparison baseline" };
  }
  if (key === "modelscript.artifact_scratch" || key.startsWith("modelscript.pkg.")) {
    return { essential: false, purpose: "Local unsaved model/package scratchpad draft" };
  }
  if (key === "modelscript.followed_repos" || key.startsWith("modelscript.repo.")) {
    return { essential: false, purpose: "Workspace repository star/watch/fork UI cache" };
  }
  if (key.startsWith("ff_")) {
    return { essential: false, purpose: "Local feature-flag override" };
  }
  return { essential: false, purpose: "Workspace UI state cache" };
}

export default function CookiesPage() {
  usePageTitle("Cookie & Browser Storage Policy");
  const branding = useInstanceBranding();
  const brandName = branding.instanceName || "Ansatz";
  const isCloudflare = branding.ingressMode === "cloudflare" || Boolean(branding.cloudflareTunnelConfigured);

  const [snapshots, setSnapshots] = useState<StorageEntrySnapshot[]>([]);
  const [clearedMessage, setClearedMessage] = useState<string | null>(null);

  const scanBrowserStorage = useCallback(() => {
    if (typeof window === "undefined") return;
    const entries: StorageEntrySnapshot[] = [];

    try {
      if (window.localStorage) {
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i);
          if (!k) continue;
          const val = window.localStorage.getItem(k) || "";
          const meta = classifyStorageKey(k);
          entries.push({
            area: "localStorage",
            key: k,
            bytes: k.length + val.length,
            essential: meta.essential,
            purpose: meta.purpose,
          });
        }
      }
    } catch {
      // Ignore storage access errors
    }

    try {
      if (window.sessionStorage) {
        for (let i = 0; i < window.sessionStorage.length; i++) {
          const k = window.sessionStorage.key(i);
          if (!k) continue;
          const val = window.sessionStorage.getItem(k) || "";
          const meta = classifyStorageKey(k);
          entries.push({
            area: "sessionStorage",
            key: k,
            bytes: k.length + val.length,
            essential: meta.essential,
            purpose: meta.purpose,
          });
        }
      }
    } catch {
      // Ignore storage access errors
    }

    setSnapshots(entries);
  }, []);

  useEffect(() => {
    scanBrowserStorage();
  }, [scanBrowserStorage]);

  const handleClearNonEssentialCaches = () => {
    if (typeof window === "undefined") return;
    let removedCount = 0;

    try {
      if (window.localStorage) {
        const toRemove: string[] = [];
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i);
          if (k && !classifyStorageKey(k).essential && k !== "ms-theme") {
            toRemove.push(k);
          }
        }
        toRemove.forEach((k) => {
          window.localStorage.removeItem(k);
          removedCount++;
        });
      }
    } catch {
      // Ignore
    }

    try {
      if (window.sessionStorage) {
        const toRemove: string[] = [];
        for (let i = 0; i < window.sessionStorage.length; i++) {
          const k = window.sessionStorage.key(i);
          if (k && !classifyStorageKey(k).essential) {
            toRemove.push(k);
          }
        }
        toRemove.forEach((k) => {
          window.sessionStorage.removeItem(k);
          removedCount++;
        });
      }
    } catch {
      // Ignore
    }

    scanBrowserStorage();
    setClearedMessage(
      `Cleared ${removedCount} non-essential local/session cache key(s). Your active login session and theme were preserved.`,
    );
  };

  return (
    <LegalLayout
      activeDoc="cookies"
      title="Cookie & Browser Storage Policy"
      subtitle={`Complete technical inventory of first-party HTTP cookies, localStorage preferences, sessionStorage deduplication keys, IndexedDB keystores, and optional Cloudflare edge cookies used by ${brandName}.`}
      icon={<ShieldLockIcon size={32} />}
      toc={COOKIES_TOC}
      customMarkdown={branding.customCookiesMarkdown}
    >
      {/* 1. Strictly Necessary HTTP Cookies */}
      <LegalSection id="http-cookies">
        <h2>
          1. Strictly Necessary HTTP Cookies <PillBadge $tone="green">Zero Ad / Tracking Cookies</PillBadge>
        </h2>
        <TldrBox>
          <p style={{ margin: 0 }}>
            <strong>In Plain English:</strong> {brandName} sets <strong>zero</strong> third-party advertising,
            cross-site tracking, or behavioral profiling cookies. Because we use only strictly necessary authentication
            and security cookies (exempt under ePrivacy Directive Art. 5(3) and GDPR Recital 30), we never clutter your
            screen with deceptive cookie-consent popups.
          </p>
        </TldrBox>
        <LegalTable data-testid="cookies-inventory-table">
          <thead>
            <tr>
              <th>Cookie Name</th>
              <th>Provider / Scope</th>
              <th>Attributes &amp; TTL</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <InlineCode>modelscript_token</InlineCode>
              </td>
              <td>First-Party ({brandName})</td>
              <td>
                <InlineCode>HttpOnly</InlineCode>, <InlineCode>SameSite=Lax</InlineCode>, 7 Days
              </td>
              <td>
                Authenticates API requests and embedded IDE workbench sessions. Automatically cleared upon sign-out.
              </td>
            </tr>
            <tr>
              <td>
                <InlineCode>oauth_state</InlineCode>
              </td>
              <td>First-Party ({brandName})</td>
              <td>
                <InlineCode>HttpOnly</InlineCode>, <InlineCode>SameSite=Lax</InlineCode>, 10 Minutes
              </td>
              <td>
                Short-lived cryptographic state nonce preventing Cross-Site Request Forgery (CSRF) during OAuth2 login
                handshakes (GitHub, Google, ORCID).
              </td>
            </tr>
            <tr>
              <td>
                <InlineCode>oidc_state</InlineCode>
              </td>
              <td>First-Party ({brandName})</td>
              <td>
                <InlineCode>HttpOnly</InlineCode>, <InlineCode>SameSite=Lax</InlineCode>, 10 Minutes
              </td>
              <td>Short-lived CSRF verification cookie used during Enterprise Single Sign-On (OIDC / SAML) flows.</td>
            </tr>
            <tr>
              <td>
                <InlineCode>__cf_bm</InlineCode> / <InlineCode>cf_clearance</InlineCode>
              </td>
              <td>
                Cloudflare Edge{" "}
                <PillBadge $tone={isCloudflare ? "amber" : "neutral"} data-testid="cookies-cloudflare-status-badge">
                  {isCloudflare ? "Active on this Instance" : "Inactive (Direct Mode)"}
                </PillBadge>
              </td>
              <td>
                <InlineCode>HttpOnly</InlineCode>, <InlineCode>Secure</InlineCode>, 30 Min – 24 Hours
              </td>
              <td>
                <strong>Conditional (Operator Ingress Dependent):</strong> Present <em>only</em> when the instance
                operator enables Cloudflare Proxy / Tunnel (
                <InlineCode>ingressMode = &quot;cloudflare&quot;</InlineCode>) and WAF Bot Management to distinguish
                legitimate human traffic from automated DDoS bots.
              </td>
            </tr>
          </tbody>
        </LegalTable>
      </LegalSection>

      {/* 2. Functional Browser localStorage Keys */}
      <LegalSection id="local-storage">
        <h2>2. Functional Browser localStorage Keys</h2>
        <TldrBox>
          <p style={{ margin: 0 }}>
            <strong>In Plain English:</strong> We use your browser&rsquo;s <InlineCode>window.localStorage</InlineCode>{" "}
            to remember your dark/light theme, solver settings, and unsaved model drafts on your own device.
          </p>
        </TldrBox>
        <LegalTable>
          <thead>
            <tr>
              <th>Storage Key</th>
              <th>Category</th>
              <th>Persistence</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <InlineCode>modelscript-auth-token</InlineCode>, <InlineCode>token</InlineCode>,{" "}
                <InlineCode>user</InlineCode>
              </td>
              <td>Strictly Necessary</td>
              <td>Until Logout</td>
              <td>Stores active Bearer JWT and cached account profile for SPA API requests.</td>
            </tr>
            <tr>
              <td>
                <InlineCode>ms-theme</InlineCode>, <InlineCode>vitepress-theme-appearance</InlineCode>
              </td>
              <td>Functional Preference</td>
              <td>Persistent</td>
              <td>
                Remembers your chosen UI appearance (<InlineCode>dark</InlineCode> or <InlineCode>light</InlineCode>).
              </td>
            </tr>
            <tr>
              <td>
                <InlineCode>modelscript.modeling_preferences</InlineCode>
              </td>
              <td>Functional Preference</td>
              <td>Persistent</td>
              <td>
                Stores preferred numerical solver tolerances, SI/Imperial unit defaults, and diagram layout options.
              </td>
            </tr>
            <tr>
              <td>
                <InlineCode>modelscript.ai_engine</InlineCode>
              </td>
              <td>Functional Preference</td>
              <td>Persistent</td>
              <td>Remembers your selected AI modeling assistant mode in the composer.</td>
            </tr>
            <tr>
              <td>
                <InlineCode>modelscript.dismissed_trends</InlineCode>
              </td>
              <td>UI Cache</td>
              <td>Persistent</td>
              <td>Tracks trending topics you have muted or dismissed from the right-hand sidebar.</td>
            </tr>
            <tr>
              <td>
                <InlineCode>modelscript.followed_repos</InlineCode>, <InlineCode>modelscript.repo.*</InlineCode>
              </td>
              <td>UI Cache</td>
              <td>Persistent</td>
              <td>Caches repository star, watch, and fork status for instant workspace responsiveness.</td>
            </tr>
            <tr>
              <td>
                <InlineCode>modelscript.artifact_scratch</InlineCode>, <InlineCode>modelscript.pkg.*</InlineCode>
              </td>
              <td>Local Drafts</td>
              <td>User Controlled</td>
              <td>Preserves unsaved Modelica/SysML/ModelScript code drafts in Morsel and Studio.</td>
            </tr>
            <tr>
              <td>
                <InlineCode>ff_*</InlineCode>
              </td>
              <td>Developer Override</td>
              <td>User Controlled</td>
              <td>Optional local feature-flag overrides toggled by developers or administrators.</td>
            </tr>
          </tbody>
        </LegalTable>
      </LegalSection>

      {/* 3. Ephemeral sessionStorage Keys */}
      <LegalSection id="session-storage">
        <h2>3. Ephemeral Tab-Scoped sessionStorage Keys</h2>
        <TldrBox>
          <p style={{ margin: 0 }}>
            <strong>In Plain English:</strong> <InlineCode>window.sessionStorage</InlineCode> exists only inside a
            single browser tab and is automatically destroyed the moment you close the tab.
          </p>
        </TldrBox>
        <LegalTable>
          <thead>
            <tr>
              <th>Session Key</th>
              <th>Scope</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <InlineCode>modelscript.viewed_posts</InlineCode>
              </td>
              <td>Current Tab Only</td>
              <td>
                Records post IDs already viewed during the current tab session so scrolling past the same post does not
                inflate dwell-time view counts.
              </td>
            </tr>
            <tr>
              <td>
                <InlineCode>modelscript.sim_baseline.*</InlineCode>
              </td>
              <td>Current Tab Only</td>
              <td>
                Holds reference simulation trajectories when overlaying and comparing parameter sweeps in the Morsel
                plotter.
              </td>
            </tr>
            <tr>
              <td>
                <InlineCode>modelscript.initialAnchor</InlineCode>
              </td>
              <td>Current Tab Only</td>
              <td>Passes deep-linked symbol or line numbers when opening a model in the Studio workbench.</td>
            </tr>
            <tr>
              <td>
                <InlineCode>ms_chunk_reload</InlineCode>
              </td>
              <td>Current Tab Only</td>
              <td>Prevents infinite reload loops when seamless background SPA version deployments occur.</td>
            </tr>
          </tbody>
        </LegalTable>
      </LegalSection>

      {/* 4. IndexedDB & WebAssembly Linear Memory */}
      <LegalSection id="indexeddb-wasm">
        <h2>4. WebCrypto IndexedDB Keystore &amp; WebAssembly Linear Memory</h2>
        <ul>
          <li>
            <strong>
              Non-Exportable WebCrypto Keystore (<InlineCode>IndexedDB</InlineCode>):
            </strong>{" "}
            Client-side cryptographic keys are stored as non-exportable <InlineCode>CryptoKey</InlineCode> objects
            inside IndexedDB (<InlineCode>keystore.ts</InlineCode>) rather than plaintext strings in{" "}
            <InlineCode>localStorage</InlineCode>, protecting them against script exfiltration.
          </li>
          <li>
            <strong>Ephemeral WebAssembly Arenas:</strong> Our native GLR parser (<InlineCode>parser.wasm</InlineCode>),
            Salsa query cache, and <InlineCode>DAEBuilder</InlineCode> numerical arenas execute in isolated WebAssembly
            linear memory that is reclaimed immediately by your browser when the tab closes.
          </li>
        </ul>
      </LegalSection>

      {/* 5. Live Interactive Browser Storage Inspector */}
      <LegalSection id="storage-inspector">
        <h2>5. Live Browser Storage Inspector &amp; Cache Cleaner</h2>
        <p>
          Inspect the exact <InlineCode>localStorage</InlineCode> and <InlineCode>sessionStorage</InlineCode> keys
          currently stored in your browser for this origin in real time, or clear non-essential caches with one click:
        </p>

        <InspectorBox data-testid="live-storage-inspector">
          <InspectorHeader>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 700, fontSize: "14px" }}>
              <CheckCircleIcon size={16} />
              <span>Active Browser Storage Entries ({snapshots.length})</span>
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <ActionBtn type="button" onClick={scanBrowserStorage}>
                <SyncIcon size={13} /> Refresh Scan
              </ActionBtn>
              <ActionBtn
                type="button"
                $danger
                onClick={handleClearNonEssentialCaches}
                data-testid="clear-non-essential-storage-btn"
              >
                <TrashIcon size={13} /> Clear Non-Essential Local Caches
              </ActionBtn>
            </div>
          </InspectorHeader>

          {clearedMessage && (
            <div
              style={{
                padding: "10px 12px",
                marginBottom: "12px",
                borderRadius: "8px",
                background: "rgba(16, 185, 129, 0.12)",
                border: "1px solid rgba(16, 185, 129, 0.35)",
                fontSize: "13px",
                color: "var(--color-text-heading)",
              }}
              data-testid="storage-cleared-feedback"
            >
              {clearedMessage}
            </div>
          )}

          {snapshots.length === 0 ? (
            <div style={{ fontSize: "13px", color: "var(--color-text-muted)", padding: "8px 0" }}>
              No localStorage or sessionStorage keys are currently set in your browser for this origin.
            </div>
          ) : (
            <LegalTable style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th>Storage Area</th>
                  <th>Key</th>
                  <th>Classification</th>
                  <th>Size</th>
                  <th>Purpose</th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map((item) => (
                  <tr key={`${item.area}:${item.key}`}>
                    <td>
                      <InlineCode>{item.area}</InlineCode>
                    </td>
                    <td>
                      <InlineCode>{item.key}</InlineCode>
                    </td>
                    <td>
                      <PillBadge $tone={item.essential ? "cyan" : "neutral"}>
                        {item.essential ? "Essential Auth" : "Preference / Cache"}
                      </PillBadge>
                    </td>
                    <td>{item.bytes} B</td>
                    <td>{item.purpose}</td>
                  </tr>
                ))}
              </tbody>
            </LegalTable>
          )}
        </InspectorBox>
      </LegalSection>
    </LegalLayout>
  );
}
