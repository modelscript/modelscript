// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";

export interface EnterpriseUpgradeEventDetail {
  edition?: "ce" | "ee" | string | undefined;
  code?: string | undefined;
  requiredFeature?: string | undefined;
  error?: string | undefined;
  message?: string | undefined;
  pricingUrl?: string | undefined;
  status?: number | undefined;
}

const EE_ERROR_CODES = new Set([
  "EE_LICENSE_REQUIRED",
  "EE_LICENSE_EXPIRED",
  "EE_LICENSE_INVALID",
  "EE_FEATURE_NOT_ENTITLED",
  "EE_EDITION_REQUIRED",
]);

let fetchInterceptorInstalled = false;

/**
 * Installs a non-destructive `window.fetch` response observer that detects HTTP 402/403/501
 * Enterprise Edition license or Community Edition isolation responses and dispatches
 * `modelscript:ee-upgrade-required` to open the Enterprise Upgrade Modal.
 */
function installEnterpriseFetchInterceptor(): void {
  if (typeof window === "undefined" || fetchInterceptorInstalled) return;
  fetchInterceptorInstalled = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
    const response = await originalFetch(...args);
    if (response.status === 402 || response.status === 403 || response.status === 501) {
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        try {
          const cloned = response.clone();
          const body = (await cloned.json()) as EnterpriseUpgradeEventDetail | null;
          if (
            body &&
            typeof body === "object" &&
            ((typeof body.code === "string" && EE_ERROR_CODES.has(body.code)) ||
              (response.status === 501 && body.edition === "ce"))
          ) {
            window.dispatchEvent(
              new CustomEvent<EnterpriseUpgradeEventDetail>("modelscript:ee-upgrade-required", {
                detail: { ...body, status: response.status },
              }),
            );
          }
        } catch {
          // Ignore non-JSON or aborted streams
        }
      }
    }
    return response;
  };
}

export default function EnterpriseUpgradeModal(): React.ReactElement | null {
  const [detail, setDetail] = React.useState<EnterpriseUpgradeEventDetail | null>(null);

  React.useEffect(() => {
    installEnterpriseFetchInterceptor();

    const handleUpgradeEvent = (e: Event) => {
      const customEvent = e as CustomEvent<EnterpriseUpgradeEventDetail>;
      setDetail(
        customEvent.detail ?? {
          code: "EE_LICENSE_REQUIRED",
          message: "This capability requires a valid ModelScript Enterprise Edition license.",
        },
      );
    };

    window.addEventListener("modelscript:ee-upgrade-required", handleUpgradeEvent);
    return () => {
      window.removeEventListener("modelscript:ee-upgrade-required", handleUpgradeEvent);
    };
  }, []);

  if (!detail) return null;

  const isCeMode = detail.edition === "ce" || detail.code === "EE_EDITION_REQUIRED" || detail.status === 501;
  const pricingUrl = detail.pricingUrl || "https://modelscript.org/pricing";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ee-upgrade-modal-title"
      onClick={() => setDetail(null)}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(9, 13, 22, 0.72)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: "16px",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--ms-surface-1)",
          color: "var(--ms-text-1)",
          border: "1px solid var(--ms-border)",
          borderRadius: "12px",
          maxWidth: "540px",
          width: "100%",
          padding: "24px",
          boxShadow: "0 20px 48px rgba(0, 0, 0, 0.45)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
          <span
            style={{
              fontSize: "12px",
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              padding: "3px 8px",
              borderRadius: "999px",
              background: "var(--ms-accent-subtle)",
              color: "var(--ms-accent)",
              border: "1px solid var(--ms-border)",
            }}
          >
            {isCeMode ? "Community Edition (AGPL-3.0)" : "Enterprise Edition Entitlement"}
          </span>
          <button
            type="button"
            aria-label="Close modal"
            onClick={() => setDetail(null)}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--ms-text-3)",
              cursor: "pointer",
              fontSize: "18px",
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        <h2 id="ee-upgrade-modal-title" style={{ margin: "0 0 8px", fontSize: "20px", fontWeight: 600 }}>
          ModelScript Enterprise Edition Required
        </h2>

        <p style={{ margin: "0 0 16px", fontSize: "14px", lineHeight: 1.55, color: "var(--ms-text-2)" }}>
          {detail.message ||
            detail.error ||
            "This capability is part of ModelScript Enterprise Edition (ee/) and requires an active Enterprise license key."}
        </p>

        {detail.requiredFeature && (
          <div
            style={{
              marginBottom: "16px",
              padding: "10px 12px",
              borderRadius: "8px",
              background: "var(--ms-surface-2)",
              border: "1px solid var(--ms-border)",
              fontSize: "13px",
              fontFamily: "monospace",
            }}
          >
            Required entitlement: <strong>{detail.requiredFeature}</strong>
          </div>
        )}

        <div
          style={{
            marginBottom: "20px",
            padding: "12px",
            borderRadius: "8px",
            background: "var(--ms-surface-2)",
            fontSize: "13px",
            lineHeight: 1.5,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: "4px" }}>How to activate on self-hosted instances:</div>
          <code style={{ display: "block", fontSize: "12px", color: "var(--ms-accent)" }}>
            MSX_EDITION=ee MSX_LICENSE_KEY=msx_lic_...
          </code>
        </div>

        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => setDetail(null)}
            style={{
              padding: "8px 14px",
              borderRadius: "6px",
              border: "1px solid var(--ms-border)",
              background: "transparent",
              color: "var(--ms-text-1)",
              fontSize: "13px",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Dismiss
          </button>
          <a
            href="mailto:enterprise@modelscript.org?subject=ModelScript%20Enterprise%20License%20Inquiry"
            style={{
              padding: "8px 14px",
              borderRadius: "6px",
              border: "1px solid var(--ms-border)",
              background: "var(--ms-surface-2)",
              color: "var(--ms-text-1)",
              fontSize: "13px",
              fontWeight: 500,
              textDecoration: "none",
            }}
          >
            Contact Sales
          </a>
          <a
            href={pricingUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: "8px 16px",
              borderRadius: "6px",
              border: "none",
              background: "var(--ms-accent)",
              color: "var(--ms-surface-1)",
              fontSize: "13px",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            View Enterprise Pricing
          </a>
        </div>
      </div>
    </div>
  );
}
