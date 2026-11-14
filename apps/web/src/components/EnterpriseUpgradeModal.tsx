// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, Dialog, Label, Text } from "@primer/react";
import React from "react";
import { useInstanceBranding } from "../InstanceBrandingContext";
import Box from "./Box";

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
  const branding = useInstanceBranding();
  const brandName = branding.instanceName || "Ansatz";

  React.useEffect(() => {
    installEnterpriseFetchInterceptor();

    const handleUpgradeEvent = (e: Event) => {
      const customEvent = e as CustomEvent<EnterpriseUpgradeEventDetail>;
      setDetail(
        customEvent.detail ?? {
          code: "EE_LICENSE_REQUIRED",
          message: `This capability requires a valid ${brandName} Enterprise Edition license (powered by ModelScript).`,
        },
      );
    };

    window.addEventListener("modelscript:ee-upgrade-required", handleUpgradeEvent);
    return () => {
      window.removeEventListener("modelscript:ee-upgrade-required", handleUpgradeEvent);
    };
  }, [brandName]);

  if (!detail) return null;

  const isCeMode = detail.edition === "ce" || detail.code === "EE_EDITION_REQUIRED" || detail.status === 501;
  const pricingUrl = detail.pricingUrl || "https://modelscript.org/pricing";

  return (
    <Dialog title={`${brandName} Enterprise Edition Required`} width="medium" onClose={() => setDetail(null)}>
      <Box display="flex" flexDirection="column" gap={3}>
        <Box>
          <Label variant="accent">{isCeMode ? "Community Edition (AGPL-3.0)" : "Enterprise Edition Entitlement"}</Label>
        </Box>

        <Text style={{ fontSize: "14px", lineHeight: 1.55, color: "var(--ms-text-2, var(--color-fg-muted))" }}>
          {detail.message ||
            detail.error ||
            `This capability is part of ${brandName} Enterprise Edition (ee/, powered by ModelScript) and requires an active Enterprise license key.`}
        </Text>

        {detail.requiredFeature && (
          <Box
            p={2}
            style={{
              borderRadius: "8px",
              background: "var(--ms-bg-elv, var(--color-canvas-subtle))",
              border: "1px solid var(--ms-border, var(--color-border-default))",
              fontSize: "13px",
              fontFamily: "var(--ms-font-mono, monospace)",
            }}
          >
            Required entitlement: <strong>{detail.requiredFeature}</strong>
          </Box>
        )}

        <Box
          p={3}
          style={{
            borderRadius: "8px",
            background: "var(--ms-bg-elv, var(--color-canvas-subtle))",
            border: "1px solid var(--ms-border, var(--color-border-default))",
            fontSize: "13px",
            lineHeight: 1.5,
          }}
        >
          <Box style={{ fontWeight: 600, marginBottom: "4px" }}>How to activate on self-hosted instances:</Box>
          <code style={{ display: "block", fontSize: "12px", color: "var(--ms-brand)" }}>
            MSX_EDITION=ee MSX_LICENSE_KEY=msx_lic_...
          </code>
        </Box>

        <Box display="flex" justifyContent="flex-end" flexWrap="wrap" gap={2} pt={2}>
          <Button variant="invisible" onClick={() => setDetail(null)}>
            Dismiss
          </Button>
          <Button
            as="a"
            href="mailto:enterprise@ansatz.social?subject=Ansatz%20Enterprise%20License%20Inquiry"
            variant="default"
          >
            Contact Sales
          </Button>
          <Button as="a" href={pricingUrl} target="_blank" rel="noopener noreferrer" variant="primary">
            View Enterprise Pricing
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
}
