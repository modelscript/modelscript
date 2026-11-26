// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_SRC_DIR = path.resolve(__dirname, "../src");

describe("Phase 2 Workstream 3: Real Web Push PushManager & DataArchiveTab Reliability", () => {
  describe("urlBase64ToUint8Array", () => {
    it("accurately decodes base64url VAPID public keys containing '-', '_', and missing '=' padding", async () => {
      const { urlBase64ToUint8Array } = await import("../src/pages/settings/tabs/NotificationFiltersTab.js");

      // 65-byte uncompressed P-256 EC public key starting with 0x04, containing bytes that produce '-' and '_' in base64url
      const rawKey = new Uint8Array(65);
      rawKey[0] = 0x04;
      for (let i = 1; i < 65; i += 1) {
        rawKey[i] = (i * 37 + 0xf0) & 0xff;
      }
      // Guarantee '-' (0xfb -> +) and '_' (0xff -> /) appear in base64url encoding
      rawKey[1] = 0xfb;
      rawKey[2] = 0xff;
      rawKey[3] = 0xfe;

      const base64url = Buffer.from(rawKey).toString("base64url");
      assert.ok(base64url.includes("-") && base64url.includes("_"), "test key should contain '-' and '_'");
      assert.ok(!base64url.includes("="), "base64url encoding should omit '=' padding");
      assert.strictEqual(base64url.length % 4, 3, "65-byte key in base64url has length % 4 === 3 (needs 1 '=' pad)");

      const decoded = urlBase64ToUint8Array(base64url);
      assert.ok(decoded instanceof Uint8Array, "decoded value must be a Uint8Array");
      assert.strictEqual(decoded.length, 65);
      assert.deepStrictEqual(Array.from(decoded), Array.from(rawKey));
    });

    it("handles base64url strings requiring 0, 1, and 2 '=' padding characters and whitespace", async () => {
      const { urlBase64ToUint8Array } = await import("../src/pages/settings/tabs/NotificationFiltersTab.js");

      const samples = [
        new Uint8Array([0xfb, 0xff, 0xbf]), // 3 bytes -> 4 base64 chars (0 padding)
        new Uint8Array([0xfb, 0xff, 0xbf, 0xee]), // 4 bytes -> 6 base64 chars (2 padding)
        new Uint8Array([0xfb, 0xff, 0xbf, 0xee, 0xdd]), // 5 bytes -> 7 base64 chars (1 padding)
      ];

      for (const sample of samples) {
        const b64u = `  ${Buffer.from(sample).toString("base64url")}\n`;
        const decoded = urlBase64ToUint8Array(b64u);
        assert.deepStrictEqual(Array.from(decoded), Array.from(sample));
      }
    });
  });

  describe("NotificationFiltersTab real Web Push integration", () => {
    const src = fs.readFileSync(path.join(WEB_SRC_DIR, "pages/settings/tabs/NotificationFiltersTab.tsx"), "utf-8");

    it("contains zero hardcoded dummy Web Push keys or fake browser endpoints", () => {
      assert.ok(
        !src.includes("BOr6_webpush_p256dh_client_key_modelscript"),
        "NotificationFiltersTab must not contain hardcoded dummy p256dh key",
      );
      assert.ok(
        !src.includes("webpush_auth_secret"),
        "NotificationFiltersTab must not contain hardcoded dummy auth secret",
      );
      assert.ok(
        !src.includes("/webpush/browser/"),
        "NotificationFiltersTab must not fabricate fake /webpush/browser/ endpoints",
      );
    });

    it("uses real PushManager, ServiceWorker, and /push/vapid-key endpoint", () => {
      assert.ok(src.includes('"Notification" in window'), "must check Notification support");
      assert.ok(src.includes('"serviceWorker" in navigator'), "must check serviceWorker support");
      assert.ok(src.includes('"PushManager" in window'), "must check PushManager support");
      assert.ok(src.includes('"/push/vapid-key"'), "must fetch VAPID public key from /push/vapid-key");
      assert.ok(src.includes("navigator.serviceWorker.ready"), "must await navigator.serviceWorker.ready");
      assert.ok(src.includes("registration.pushManager.getSubscription()"), "must check existing PushSubscription");
      assert.ok(src.includes("registration.pushManager.subscribe("), "must subscribe via PushManager");
      assert.ok(
        src.includes("applicationServerKey: urlBase64ToUint8Array(publicKey)"),
        "must convert VAPID publicKey via urlBase64ToUint8Array",
      );
      assert.ok(src.includes("subscription.toJSON()"), "must extract real endpoint & keys via subscription.toJSON()");
    });

    it("rejects non-granted permissions and rolls back browserPush toggle on registration failure", () => {
      assert.ok(
        src.includes('permission !== "granted"'),
        "must reject both denied and default/dismissed permission states",
      );
      assert.ok(
        src.includes("const registered = await handleRegisterBrowserPush()") &&
          src.includes("if (!registered)") &&
          src.includes("rollbackBrowserPush()"),
        "handleToggleBrowserPush must roll back browserPush to false when registration fails",
      );
    });

    it("guards async preference loads against unmount and merges onto DEFAULT_NOTIFICATION_PREFERENCES", () => {
      assert.ok(src.includes("mountedRef"), "must track component mount state with mountedRef");
      assert.ok(
        src.includes("const defaults = DEFAULT_NOTIFICATION_PREFERENCES"),
        "must merge fetched preferences onto DEFAULT_NOTIFICATION_PREFERENCES instead of stale prev",
      );
    });
  });

  describe("DataArchiveTab reliability & production safety", () => {
    const src = fs.readFileSync(path.join(WEB_SRC_DIR, "pages/settings/tabs/DataArchiveTab.tsx"), "utf-8");

    it("gates synchronous Direct Download (.ZIP) button behind import.meta.env.DEV", () => {
      assert.ok(
        src.includes("import.meta.env.DEV") && src.includes("Direct Download (.ZIP)"),
        "Direct Download (.ZIP) button must be gated behind import.meta.env.DEV",
      );
      const devIdx = src.indexOf("import.meta.env.DEV");
      const btnIdx = src.indexOf("Direct Download (.ZIP)");
      assert.ok(
        devIdx !== -1 && btnIdx > devIdx && btnIdx - devIdx < 500,
        "import.meta.env.DEV must wrap Direct Download button",
      );
    });

    it("polls on [archiveJob?.id, archiveJob?.status] with in-flight, unmount, and consecutive failure guards", () => {
      assert.ok(
        src.includes("[archiveJob?.id, archiveJob?.status]"),
        "polling useEffect must depend on [archiveJob?.id, archiveJob?.status]",
      );
      assert.ok(!src.includes("}, [archiveJob]);"), "polling useEffect must not depend on whole archiveJob object");
      assert.ok(
        src.includes("let inFlight = false"),
        "polling effect must guard against overlapping in-flight requests",
      );
      assert.ok(src.includes("let cancelled = false"), "polling effect must guard against unmount");
      assert.ok(
        src.includes("consecutiveFailures >= 3"),
        "polling effect must surface an error banner after 3 consecutive failures",
      );
    });

    it("renders an explicit Failed Archive Job UI card with retry action", () => {
      assert.ok(
        src.includes('archiveJob.status === "failed"') && src.includes("Archive Job Failed"),
        "DataArchiveTab must render an explicit failed-job card",
      );
      assert.ok(src.includes("Retry Archive"), "Failed Archive Job card must include a Retry button");
    });

    it("surfaces errors on initial mount and manual refresh, separates button queueing labels, and defers revokeObjectURL", () => {
      assert.ok(!src.includes(".catch(() => {})"), "initial mount fetch must not silently swallow errors");
      assert.ok(!src.includes("catch {}"), "polling and refresh handlers must not silently swallow errors");
      assert.ok(src.includes("isRefreshing"), "manual Refresh Job Status button must have isRefreshing disabled state");
      assert.ok(
        src.includes('submittingFormat === "zip"') && src.includes('submittingFormat === "json"'),
        "ZIP and JSON buttons must track queueing state independently",
      );
      assert.ok(
        src.includes("setTimeout(() => window.URL.revokeObjectURL(url), 1000)"),
        "URL.revokeObjectURL must be deferred by 1000ms for Safari/WebKit compatibility",
      );
    });
  });
});
