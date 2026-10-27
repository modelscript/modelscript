// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, Dialog, Heading, Text } from "@primer/react";
import React from "react";
import Box from "../../Box";

export interface LegalModalProps {
  legalModal: "terms" | "privacy" | "cookies" | null;
  onClose: () => void;
}

export const LegalModal: React.FC<LegalModalProps> = ({ legalModal, onClose }) => {
  if (!legalModal) return null;

  return (
    <Dialog
      title={
        legalModal === "terms" ? "Terms of Service" : legalModal === "privacy" ? "Privacy Policy" : "Cookie Policy"
      }
      onClose={onClose}
    >
      <Box p={3} style={{ maxHeight: "400px", overflowY: "auto" }}>
        {legalModal === "terms" && (
          <Box display="flex" flexDirection="column" gap={2}>
            <Heading as="h4" style={{ fontSize: "15px" }}>
              1. Acceptance of Terms
            </Heading>
            <Text as="p" color="var(--color-fg-muted)" style={{ fontSize: "13px", lineHeight: 1.5 }}>
              By accessing ModelScript OS services, simulation runtimes, and engineering repositories, you agree to
              comply with open scientific modeling standards and all applicable regulations.
            </Text>
            <Heading as="h4" style={{ fontSize: "15px", marginTop: "8px" }}>
              2. Cloud & HPC Computing Usage
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
              Privacy & Data Sovereignty
            </Heading>
            <Text as="p" color="var(--color-fg-muted)" style={{ fontSize: "13px", lineHeight: 1.5 }}>
              ModelScript values data integrity. Public models are federated across the scientific network according to
              your specified repository permissions. Private code and simulation traces remain encrypted.
            </Text>
          </Box>
        )}
        {legalModal === "cookies" && (
          <Box display="flex" flexDirection="column" gap={2}>
            <Heading as="h4" style={{ fontSize: "15px" }}>
              Cookie & Local Storage Policy
            </Heading>
            <Text as="p" color="var(--color-fg-muted)" style={{ fontSize: "13px", lineHeight: 1.5 }}>
              We utilize essential authentication session tokens and local preferences (e.g., color scheme themes) to
              deliver a seamless workspace environment.
            </Text>
          </Box>
        )}
        <Box display="flex" justifyContent="flex-end" mt={4}>
          <Button onClick={onClose}>Close</Button>
        </Box>
      </Box>
    </Dialog>
  );
};
