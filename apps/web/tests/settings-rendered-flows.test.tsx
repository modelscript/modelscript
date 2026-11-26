// SPDX-License-Identifier: AGPL-3.0-or-later

import { JSDOM } from "jsdom";
import assert from "node:assert/strict";
import { register } from "node:module";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import "../src/AuthContext.js";
import type { User } from "../src/AuthContext.js";
import { FeatureFlagContext, type FeatureFlagContextType } from "../src/FeatureFlagContext.js";
import { ToastContext, type ToastContextValue } from "../src/components/ToastContext.js";
import {
  GENERIC_SETTINGS_ERROR_MESSAGE,
  SettingsTabErrorBoundary,
  resolveSettingsBannerMessage,
} from "../src/pages/SettingsPage.js";
import { TrustLevelBadge } from "../src/pages/settings/components/SigningKeysSection.js";
import { AccountTab } from "../src/pages/settings/tabs/AccountTab.js";
import { validateOAuthRedirectUrl } from "../src/pages/settings/tabs/ConnectedAccountsTab.js";
import { InvitesTab } from "../src/pages/settings/tabs/InvitesTab.js";
import { MAX_DEFAULT_STOP_TIME, parseDefaultStopTimeDraft } from "../src/pages/settings/tabs/ModelingPreferencesTab.js";
import { urlBase64ToUint8Array } from "../src/pages/settings/tabs/NotificationFiltersTab.js";
import { PrivacyTab } from "../src/pages/settings/tabs/PrivacyTab.js";

// In Node/tsx test runs, Vite's `import.meta.env` is undefined (and SettingsPage statically imports BillingTab
// before module body executes). Register a scoped ESM hook keyed on `?vite_env_shim=1` so BillingTab can be
// loaded with a controllable `import.meta.env` shim during tests.
const billingEnvLoaderCode = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier.includes("?vite_env_shim=1")) {
    const clean = specifier.replace("?vite_env_shim=1", "");
    const resolved = await nextResolve(clean, context);
    return {
      ...resolved,
      shortCircuit: true,
      url: resolved.url + "?vite_env_shim=1",
    };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.includes("?vite_env_shim=1")) {
    const cleanUrl = url.replace("?vite_env_shim=1", "");
    const result = await nextLoad(cleanUrl, context);
    if (result && result.source) {
      const src = typeof result.source === "string" ? result.source : Buffer.from(result.source).toString("utf8");
      if (src.includes("import.meta.env")) {
        return {
          ...result,
          shortCircuit: true,
          source: src.replaceAll("import.meta.env", "(globalThis.__TEST_VITE_ENV__ ?? { DEV: false })"),
        };
      }
    }
    return result;
  }
  return nextLoad(url, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(billingEnvLoaderCode)}`);

// Access the singleton AuthContext created by AuthContext.tsx so rendered components
// receive controlled auth state via real React Context without touching localStorage.
const AuthContext = (
  globalThis as unknown as {
    __MODEL_SCRIPT_AUTH_CONTEXT__?: React.Context<Record<string, unknown> | null>;
  }
).__MODEL_SCRIPT_AUTH_CONTEXT__!;

function createMockUser(overrides: Partial<User> = {}): User {
  return {
    id: 42,
    username: "ada_lovelace",
    email: "ada@example.edu",
    display_name: "Ada Lovelace",
    account_type: "user",
    role: "user",
    isAdmin: false,
    has_password: true,
    totp_enabled: false,
    email_verified: true,
    credit_balance: 25,
    ...overrides,
  };
}

function createMockAuthValue(overrides: { user?: User | null; isAdmin?: boolean } = {}): Record<string, unknown> {
  const user = overrides.user === undefined ? createMockUser() : overrides.user;
  const isAdmin =
    overrides.isAdmin !== undefined
      ? overrides.isAdmin
      : Boolean(user && (user.account_type === "admin" || user.role === "admin" || user.isAdmin === true));
  return {
    user,
    token: user ? "test-jwt-token" : null,
    isAuthenticated: Boolean(user),
    isAdmin,
    isLoading: false,
    justLoggedOut: false,
    lastLoggedOutUser: null,
    clearJustLoggedOut: () => {},
    login: async () => ({}),
    complete2FALogin: async () => {},
    register: async () => ({}),
    updateToken: () => {},
    setSession: () => {},
    logout: () => {},
    unreadCount: 0,
    setUnreadCount: () => {},
    refreshUnreadCount: () => {},
    adminPendingCount: 0,
    refreshAdminCount: () => {},
    creditBalance: user?.credit_balance ?? 0,
    refreshWallet: async () => {},
    refreshUser: async () => {},
  };
}

function createMockToastValue(): ToastContextValue {
  return {
    toast: () => "toast-1",
    show: () => "toast-1",
    showToast: () => "toast-1",
    success: () => "toast-1",
    error: () => "toast-1",
    info: () => "toast-1",
    warning: () => "toast-1",
    dismiss: () => {},
  };
}

function createMockFeatureFlagValue(flags: Record<string, boolean> = {}): FeatureFlagContextType {
  return {
    flags,
    overrides: {},
    isLoading: false,
    refreshFlags: async () => {},
    isEnabled: (key: string) => Boolean(flags[key]),
    setFlagOverride: () => {},
    resetAllOverrides: () => {},
  };
}

function renderWithProviders(
  element: React.ReactElement,
  options: {
    user?: User | null;
    isAdmin?: boolean;
    flags?: Record<string, boolean>;
    initialEntries?: string[];
  } = {},
): string {
  const authValue = createMockAuthValue({
    ...(options.user !== undefined ? { user: options.user } : {}),
    ...(options.isAdmin !== undefined ? { isAdmin: options.isAdmin } : {}),
  });
  const toastValue = createMockToastValue();
  const featureFlagValue = createMockFeatureFlagValue(options.flags ?? { billing_stripe_live: true });

  return renderToStaticMarkup(
    <MemoryRouter initialEntries={options.initialEntries ?? ["/settings"]}>
      <AuthContext.Provider value={authValue}>
        <FeatureFlagContext.Provider value={featureFlagValue}>
          <ToastContext.Provider value={toastValue}>{element}</ToastContext.Provider>
        </FeatureFlagContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

async function withMountedDom(
  run: (ctx: {
    dom: JSDOM;
    container: HTMLElement;
    render: (el: React.ReactElement) => Promise<void>;
  }) => Promise<void>,
): Promise<void> {
  const dom = new JSDOM("<!DOCTYPE html><html><body><div id='root'></div></body></html>", {
    url: "http://localhost:3001/settings",
  });
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  const prevHTMLElement = globalThis.HTMLElement;
  const prevNode = globalThis.Node;
  const prevActEnv = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;

  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(globalThis, "window", { value: dom.window, configurable: true });
  Object.defineProperty(globalThis, "document", { value: dom.window.document, configurable: true });
  Object.defineProperty(globalThis, "HTMLElement", { value: dom.window.HTMLElement, configurable: true });
  Object.defineProperty(globalThis, "Node", { value: dom.window.Node, configurable: true });

  const { createRoot } = await import("react-dom/client");
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);

  try {
    await run({
      dom,
      container,
      render: async (el: React.ReactElement) => {
        await React.act(async () => {
          root.render(el);
        });
      },
    });
  } finally {
    await React.act(async () => {
      root.unmount();
    });
    Object.defineProperty(globalThis, "window", { value: prevWindow, configurable: true });
    Object.defineProperty(globalThis, "document", { value: prevDocument, configurable: true });
    Object.defineProperty(globalThis, "HTMLElement", { value: prevHTMLElement, configurable: true });
    Object.defineProperty(globalThis, "Node", { value: prevNode, configurable: true });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = prevActEnv;
    dom.window.close();
  }
}

describe("Phase 5 Workstream 3: Rendered React Component & Behavioral Tests for Critical Settings Flows", () => {
  describe("SettingsTabErrorBoundary", () => {
    it("renders children normally when no error is thrown", () => {
      const html = renderToStaticMarkup(
        <SettingsTabErrorBoundary>
          <section data-testid="healthy-tab">Healthy Settings Tab Content</section>
        </SettingsTabErrorBoundary>,
      );

      assert.ok(html.includes("Healthy Settings Tab Content"), "must render healthy child content");
      assert.ok(!html.includes('role="alert"'), "must not render error alert fallback when healthy");
      assert.ok(!html.includes("Try Again"), "must not render Try Again button when healthy");
    });

    it("catches a thrown child error, renders role='alert' fallback with 'Try Again', and recovers on reset", async () => {
      let shouldThrow = true;

      function FlakyTab(): React.ReactElement {
        if (shouldThrow) {
          throw new Error("Simulated tab render explosion");
        }
        return <div data-testid="recovered-tab">Recovered Settings Tab</div>;
      }

      const origConsoleError = console.error;
      console.error = () => {};

      try {
        await withMountedDom(async ({ container, render }) => {
          await render(
            <SettingsTabErrorBoundary>
              <FlakyTab />
            </SettingsTabErrorBoundary>,
          );

          const alertEl = container.querySelector('[role="alert"]');
          assert.ok(alertEl, "must render fallback container with role='alert'");
          assert.ok(
            alertEl.textContent?.includes("Something went wrong loading this settings section."),
            "must render error boundary heading copy",
          );
          assert.ok(
            alertEl.textContent?.includes("Simulated tab render explosion"),
            "must display the caught error message",
          );

          const tryAgainBtn = Array.from(alertEl.querySelectorAll("button")).find(
            (btn) => btn.textContent?.trim() === "Try Again",
          );
          assert.ok(tryAgainBtn, "must render a 'Try Again' recovery button");

          // Flip child back to healthy state and click Try Again
          shouldThrow = false;
          await React.act(async () => {
            tryAgainBtn.click();
          });

          assert.strictEqual(container.querySelector('[role="alert"]'), null, "alert must clear after recovery");
          assert.ok(
            container.querySelector('[data-testid="recovered-tab"]')?.textContent?.includes("Recovered Settings Tab"),
            "must render recovered child content after clicking Try Again",
          );
        });
      } finally {
        console.error = origConsoleError;
      }
    });
  });

  describe("AccountTab", () => {
    it("renders Account Information, Change Password, and Delete Account navigation items with role='button' and tabIndex='0'", async () => {
      const navigatedTabs: string[] = [];

      await withMountedDom(async ({ dom, container, render }) => {
        const authValue = createMockAuthValue({ user: createMockUser({ email_verified: true }) });
        const toastValue = createMockToastValue();

        await render(
          <MemoryRouter initialEntries={["/settings/account"]}>
            <AuthContext.Provider value={authValue}>
              <ToastContext.Provider value={toastValue}>
                <AccountTab subView="account" onNavigate={(tab) => navigatedTabs.push(tab)} />
              </ToastContext.Provider>
            </AuthContext.Provider>
          </MemoryRouter>,
        );

        const roleButtons = Array.from(container.querySelectorAll('[role="button"]'));
        const findNavItem = (label: string) =>
          roleButtons.find((el) => el.textContent?.toLowerCase().includes(label.toLowerCase()));

        const accountInfoItem = findNavItem("Account information");
        const changePasswordItem = findNavItem("Change your password");
        const deleteAccountItem = findNavItem("Deactivate or delete your account");

        assert.ok(accountInfoItem, "must render Account information item with role='button'");
        assert.ok(changePasswordItem, "must render Change your password item with role='button'");
        assert.ok(deleteAccountItem, "must render Deactivate or delete your account item with role='button'");

        assert.strictEqual(accountInfoItem.getAttribute("tabindex"), "0", "Account information must have tabIndex=0");
        assert.strictEqual(changePasswordItem.getAttribute("tabindex"), "0", "Change password must have tabIndex=0");
        assert.strictEqual(deleteAccountItem.getAttribute("tabindex"), "0", "Delete account must have tabIndex=0");

        // Verify keyboard accessibility (Enter key triggers navigation)
        await React.act(async () => {
          accountInfoItem.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
          changePasswordItem.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: " ", bubbles: true }));
          deleteAccountItem.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        });

        assert.deepStrictEqual(navigatedTabs, ["accountInfo", "changePassword", "deleteAccount"]);
      });
    });

    it("renders 'Email Verified' only when email_verified is true or 1, and 'Unverified' when false or undefined", () => {
      const htmlTrue = renderWithProviders(<AccountTab subView="account" onNavigate={() => {}} />, {
        user: createMockUser({ email_verified: true }),
      });
      assert.ok(htmlTrue.includes("Email Verified"), "email_verified=true must show Email Verified");
      assert.ok(!htmlTrue.includes("Email Unverified"), "email_verified=true must not show Email Unverified");
      assert.ok(!htmlTrue.includes("Resend Verification Email"), "email_verified=true must not show resend banner");

      const htmlNumericOne = renderWithProviders(<AccountTab subView="account" onNavigate={() => {}} />, {
        user: createMockUser({ email_verified: 1 }),
      });
      assert.ok(htmlNumericOne.includes("Email Verified"), "email_verified=1 must show Email Verified");
      assert.ok(!htmlNumericOne.includes("Email Unverified"), "email_verified=1 must not show Email Unverified");

      const htmlFalse = renderWithProviders(<AccountTab subView="account" onNavigate={() => {}} />, {
        user: createMockUser({ email_verified: false }),
      });
      assert.ok(htmlFalse.includes("Unverified"), "email_verified=false must show Unverified");
      assert.ok(!htmlFalse.includes("Email Verified"), "email_verified=false must not show Email Verified");
      assert.ok(htmlFalse.includes("Resend Verification Email"), "email_verified=false must show resend banner");

      const htmlUndefined = renderWithProviders(<AccountTab subView="account" onNavigate={() => {}} />, {
        user: createMockUser({ email_verified: undefined }),
      });
      assert.ok(htmlUndefined.includes("Unverified"), "email_verified=undefined must show Unverified");
      assert.ok(!htmlUndefined.includes("Email Verified"), "email_verified=undefined must not show Email Verified");
    });
  });

  describe("PrivacyTab (subView='deleteAccount')", () => {
    it("renders Delete Account heading, GDPR anonymization notice, Current password input for password users, and 2FA code input when totp_enabled is true", () => {
      const htmlWithPasswordAnd2FA = renderWithProviders(<PrivacyTab subView="deleteAccount" />, {
        user: createMockUser({ has_password: true, totp_enabled: true }),
      });

      assert.ok(htmlWithPasswordAnd2FA.includes("Delete Account"), "must render Delete Account heading");
      assert.ok(
        htmlWithPasswordAnd2FA.includes(
          "Public posts, comments, and models remain published with anonymized authorship",
        ),
        "must render updated GDPR anonymization notice for public posts, comments, and models",
      );
      assert.ok(
        htmlWithPasswordAnd2FA.includes("Current password:"),
        "must render Current password label for password users",
      );
      assert.ok(htmlWithPasswordAnd2FA.includes('type="password"'), "must render password input for password users");
      assert.ok(
        htmlWithPasswordAnd2FA.includes("Two-factor authentication (2FA) code:"),
        "must render 2FA Authenticator Code label when totp_enabled=true",
      );
      assert.ok(
        htmlWithPasswordAnd2FA.includes("Enter 6-digit authenticator code"),
        "must render 6-digit authenticator code placeholder when totp_enabled=true",
      );
    });

    it("omits Current password input for passwordless OAuth users and omits 2FA code input when totp_enabled is false", () => {
      const htmlOAuthNo2FA = renderWithProviders(<PrivacyTab subView="deleteAccount" />, {
        user: createMockUser({ has_password: false, totp_enabled: false }),
      });

      assert.ok(htmlOAuthNo2FA.includes("Delete Account"), "must render Delete Account heading");
      assert.ok(
        !htmlOAuthNo2FA.includes("Current password:"),
        "must not render Current password input when has_password=false",
      );
      assert.ok(
        !htmlOAuthNo2FA.includes("Two-factor authentication (2FA) code:"),
        "must not render 2FA code input when totp_enabled=false",
      );
    });
  });

  describe("BillingTab", () => {
    async function loadBillingTab(): Promise<typeof import("../src/pages/settings/tabs/BillingTab.js").BillingTab> {
      const specifier = "../src/pages/settings/tabs/BillingTab.js?vite_env_shim=1";
      const mod = (await import(specifier)) as typeof import("../src/pages/settings/tabs/BillingTab.js");
      return mod.BillingTab;
    }

    it("does NOT render 'Simulate Sandbox Mode' toggle for a non-admin user when isAdmin is false (non-DEV)", async () => {
      const BillingTab = await loadBillingTab();
      const prevEnv = (globalThis as { __TEST_VITE_ENV__?: { DEV: boolean } }).__TEST_VITE_ENV__;
      (globalThis as { __TEST_VITE_ENV__?: { DEV: boolean } }).__TEST_VITE_ENV__ = { DEV: false };

      try {
        const html = renderWithProviders(<BillingTab onBack={() => {}} />, {
          user: createMockUser({ isAdmin: false, role: "user", account_type: "user" }),
          isAdmin: false,
          flags: { billing_stripe_live: true },
        });

        assert.ok(html.includes("Billing &amp; Compute Quotas"), "must render BillingTab header");
        assert.ok(
          !html.includes("Simulate Sandbox Mode"),
          "must NOT render 'Simulate Sandbox Mode' toggle for non-admin user",
        );
        assert.ok(
          !html.includes("Sandbox Mode Active"),
          "must NOT render 'Sandbox Mode Active' toggle for non-admin user",
        );
      } finally {
        (globalThis as { __TEST_VITE_ENV__?: { DEV: boolean } }).__TEST_VITE_ENV__ = prevEnv;
      }
    });

    it("renders 'Simulate Sandbox Mode' toggle for an admin user when Stripe live mode is enabled", async () => {
      const BillingTab = await loadBillingTab();
      const prevEnv = (globalThis as { __TEST_VITE_ENV__?: { DEV: boolean } }).__TEST_VITE_ENV__;
      (globalThis as { __TEST_VITE_ENV__?: { DEV: boolean } }).__TEST_VITE_ENV__ = { DEV: false };

      try {
        const html = renderWithProviders(<BillingTab onBack={() => {}} />, {
          user: createMockUser({ isAdmin: true, role: "admin", account_type: "admin" }),
          isAdmin: true,
          flags: { billing_stripe_live: true },
        });

        assert.ok(html.includes("Billing &amp; Compute Quotas"), "must render BillingTab header");
        assert.ok(html.includes("Simulate Sandbox Mode"), "must render 'Simulate Sandbox Mode' toggle for admin user");
      } finally {
        (globalThis as { __TEST_VITE_ENV__?: { DEV: boolean } }).__TEST_VITE_ENV__ = prevEnv;
      }
    });
  });

  describe("InvitesTab", () => {
    it("renders without crashing inside providers and displays the Invites & Golden Tickets header", () => {
      const html = renderWithProviders(<InvitesTab onBack={() => {}} />, {
        user: createMockUser(),
      });

      assert.ok(html.includes("Invite Friends &amp; Golden Tickets"), "must render InvitesTab header without crashing");
    });
  });

  describe("Exported Settings Helpers & Badges Smoke Checks", () => {
    it("TrustLevelBadge renders distinct trust-level labels cleanly", () => {
      const masterHtml = renderToStaticMarkup(<TrustLevelBadge trustLevel="hardware_or_cli" />);
      const pasteHtml = renderToStaticMarkup(<TrustLevelBadge trustLevel="unverified_paste" />);
      const browserHtml = renderToStaticMarkup(<TrustLevelBadge trustLevel="web_browser" prevKeyId={null} />);

      assert.ok(masterHtml.includes("Master Key"));
      assert.ok(pasteHtml.includes("Unverified Paste"));
      assert.ok(browserHtml.includes("Browser Key"));
    });

    it("resolveSettingsBannerMessage maps allowlisted status keys and falls back to generic error message", () => {
      assert.strictEqual(
        resolveSettingsBannerMessage("success", "linkedGithub"),
        "Successfully linked your GitHub account.",
      );
      assert.strictEqual(resolveSettingsBannerMessage("success", "untrusted_injection"), null);
      assert.strictEqual(
        resolveSettingsBannerMessage("error", "invalidState"),
        "The sign-in or linking request could not be verified. Please try again.",
      );
      assert.strictEqual(resolveSettingsBannerMessage("error", "raw-stack-trace-leak"), GENERIC_SETTINGS_ERROR_MESSAGE);
    });

    it("validateOAuthRedirectUrl allows http/https redirects and rejects javascript: / data: schemes", () => {
      assert.strictEqual(
        validateOAuthRedirectUrl("https://github.com/login/oauth/authorize?client_id=1", "https://ansatz.social"),
        "https://github.com/login/oauth/authorize?client_id=1",
      );
      assert.strictEqual(
        validateOAuthRedirectUrl("/api/auth/github", "https://ansatz.social"),
        "https://ansatz.social/api/auth/github",
      );
      assert.strictEqual(validateOAuthRedirectUrl("javascript:alert(1)", "https://ansatz.social"), null);
      assert.strictEqual(validateOAuthRedirectUrl("data:text/html,<h1>xss</h1>", "https://ansatz.social"), null);
    });

    it("parseDefaultStopTimeDraft parses positive finite drafts, caps at MAX_DEFAULT_STOP_TIME, and rejects invalid input", () => {
      assert.strictEqual(parseDefaultStopTimeDraft("12.5"), 12.5);
      assert.strictEqual(parseDefaultStopTimeDraft("999999999999"), MAX_DEFAULT_STOP_TIME);
      assert.strictEqual(parseDefaultStopTimeDraft(""), null);
      assert.strictEqual(parseDefaultStopTimeDraft("0"), null);
      assert.strictEqual(parseDefaultStopTimeDraft("-5"), null);
      assert.strictEqual(parseDefaultStopTimeDraft("NaN"), null);
    });

    it("urlBase64ToUint8Array decodes URL-safe base64 VAPID keys into a Uint8Array", () => {
      // "Hello" in base64url is "SGVsbG8"
      const bytes = urlBase64ToUint8Array("SGVsbG8");
      assert.ok(bytes instanceof Uint8Array);
      assert.deepStrictEqual(Array.from(bytes), [72, 101, 108, 108, 111]);
    });
  });
});
