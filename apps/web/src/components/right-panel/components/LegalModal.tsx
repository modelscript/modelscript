// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, Dialog, Heading, Text } from "@primer/react";
import React from "react";
import { Link } from "react-router-dom";
import { useInstanceBranding } from "../../../InstanceBrandingContext";
import Box from "../../Box";

export interface LegalModalProps {
  legalModal: "terms" | "privacy" | "cookies" | null;
  onClose: () => void;
}

export const LegalModal: React.FC<LegalModalProps> = ({ legalModal, onClose }) => {
  const branding = useInstanceBranding();
  const brandName = branding.instanceName || "Ansatz";

  if (!legalModal) return null;

  const fullPath = legalModal === "terms" ? "/terms" : legalModal === "privacy" ? "/privacy" : "/cookies";

  return (
    <Dialog
      title={
        legalModal === "terms" ? "Terms of Service" : legalModal === "privacy" ? "Privacy Policy" : "Cookie Policy"
      }
      onClose={onClose}
    >
      <Box p={3}>
        {legalModal === "terms" && (
          <Box display="flex" flexDirection="column" gap={2}>
            <Heading as="h4" style={{ fontSize: "15px" }}>
              1. Acceptance of Terms &amp; Server Rules
            </Heading>
            <Text as="p" color="var(--color-fg-muted)" style={{ fontSize: "13px", lineHeight: 1.5 }}>
              By accessing {brandName} services, ModelScript simulation runtimes, and engineering repositories, you
              agree to comply with our numbered Server Rules, open scientific modeling standards, and EAR/ITAR export
              control regulations.
            </Text>
            <Heading as="h4" style={{ fontSize: "15px", marginTop: "8px" }}>
              2. Cloud &amp; HPC Computing Usage
            </Heading>
            <Text as="p" color="var(--color-fg-muted)" style={{ fontSize: "13px", lineHeight: 1.5 }}>
              Compute allocations, SUNDIALS solvers, and Slurm batch workers must be used exclusively for lawful
              computational engineering and simulation tasks.
            </Text>
          </Box>
        )}
        {legalModal === "privacy" && (
          <Box display="flex" flexDirection="column" gap={2}>
            <Heading as="h4" style={{ fontSize: "15px" }}>
              Privacy, Data Sovereignty &amp; Zero-Tracker Analytics
            </Heading>
            <Text as="p" color="var(--color-fg-muted)" style={{ fontSize: "13px", lineHeight: 1.5 }}>
              {brandName} loads zero third-party ad trackers. First-party pageview and post analytics resolve coarse
              country/region codes in memory and deduplicate daily visitors using a daily rotating RAM-only HMAC-SHA256
              salt without storing raw IP addresses.
            </Text>
          </Box>
        )}
        {legalModal === "cookies" && (
          <Box display="flex" flexDirection="column" gap={2}>
            <Heading as="h4" style={{ fontSize: "15px" }}>
              Cookie &amp; Local Storage Policy
            </Heading>
            <Text as="p" color="var(--color-fg-muted)" style={{ fontSize: "13px", lineHeight: 1.5 }}>
              We utilize strictly necessary session cookies (<code>modelscript_token</code>, <code>oauth_state</code>),
              optional Cloudflare edge protection cookies when Cloudflare ingress is active, and local browser storage
              for theme and workspace preferences.
            </Text>
          </Box>
        )}
        <Box display="flex" justifyContent="space-between" alignItems="center" mt={4}>
          <Link
            to={fullPath}
            onClick={onClose}
            style={{ color: "var(--color-accent-cyan, #06b6d4)", fontSize: "13px", fontWeight: 600 }}
          >
            View Full Policy Page &rarr;
          </Link>
          <Button onClick={onClose}>Close</Button>
        </Box>
      </Box>
    </Dialog>
  );
};
