// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, Heading, Text } from "@primer/react";
import React from "react";
import Box from "../../../components/Box";
import { StyledBox } from "../../workspace/styles";
import { FieldDescription, FieldLabel, FormRow } from "./styles";
import type { MinApproversOption } from "./types";

export interface PlmGovernanceSettingsSectionProps {
  canAdmin: boolean;
  minApprovers: MinApproversOption;
  setMinApprovers: (value: MinApproversOption) => void;
  requireEd25519: boolean;
  setRequireEd25519: (value: boolean) => void;
  enforceSimulationTolerance: boolean;
  setEnforceSimulationTolerance: (value: boolean) => void;
  immutableGitNotesAudit: boolean;
  setImmutableGitNotesAudit: (value: boolean) => void;
  emergencyBypassAllowed: boolean;
  setEmergencyBypassAllowed: (value: boolean) => void;
  onSavePolicy: () => void;
}

export const PlmGovernanceSettingsSection: React.FC<PlmGovernanceSettingsSectionProps> = ({
  canAdmin,
  minApprovers,
  setMinApprovers,
  requireEd25519,
  setRequireEd25519,
  enforceSimulationTolerance,
  setEnforceSimulationTolerance,
  immutableGitNotesAudit,
  setImmutableGitNotesAudit,
  emergencyBypassAllowed,
  setEmergencyBypassAllowed,
  onSavePolicy,
}) => (
  <Box display="flex" flexDirection="column" gap={4}>
    <Box>
      <Heading
        as="h2"
        style={{
          fontSize: "24px",
          borderBottom: "1px solid var(--color-border-default)",
          paddingBottom: "8px",
          marginBottom: "8px",
        }}
      >
        PLM & Change Control Governance Policy
      </Heading>
      <Text color="var(--color-fg-muted)" style={{ fontSize: "13px", display: "block", marginBottom: "20px" }}>
        Define release governance, sign-off thresholds, and compliance verification standards for Engineering Change
        Orders.
      </Text>

      <StyledBox p={4} display="flex" flexDirection="column" gap={4}>
        <FormRow>
          <FieldLabel>Minimum Required Approvals for ECO Sign-Off</FieldLabel>
          <FieldDescription>
            Specifies how many designated PLM approvers must review and sign off before an Engineering Change Order can
            be merged.
          </FieldDescription>
          <select
            value={minApprovers}
            onChange={(e) => setMinApprovers(e.target.value as MinApproversOption)}
            disabled={!canAdmin}
            style={{
              padding: "8px 12px",
              borderRadius: "6px",
              border: "1px solid var(--color-border-default)",
              background: "var(--color-canvas-default)",
              color: "var(--color-fg-default)",
              fontSize: "14px",
              maxWidth: "320px",
            }}
          >
            <option value="1">1 Designated PLM Approver</option>
            <option value="2">2 Independent Approvers (Four-Eyes Principle)</option>
            <option value="consensus">Consensus (All Designated Approvers)</option>
          </select>
        </FormRow>

        <Box style={{ borderTop: "1px solid var(--color-border-default)", paddingTop: "16px" }}>
          <Text style={{ fontWeight: 700, fontSize: "14px", display: "block", marginBottom: "12px" }}>
            Sign-Off Cryptography & Audit Trail
          </Text>
          <Box display="flex" flexDirection="column" gap={3}>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={requireEd25519}
                onChange={(e) => setRequireEd25519(e.target.checked)}
                disabled={!canAdmin}
              />
              <Text style={{ fontSize: "13.5px" }}>
                Require Ed25519 cryptographic digital signatures on all formal ECO sign-off decisions
              </Text>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={enforceSimulationTolerance}
                onChange={(e) => setEnforceSimulationTolerance(e.target.checked)}
                disabled={!canAdmin}
              />
              <Text style={{ fontSize: "13.5px" }}>
                Enforce digital twin numerical simulation regression tolerance threshold (relative error &lt; 1e-4)
                before approval
              </Text>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={immutableGitNotesAudit}
                onChange={(e) => setImmutableGitNotesAudit(e.target.checked)}
                disabled={!canAdmin}
              />
              <Text style={{ fontSize: "13.5px" }}>
                Record all approval decisions as signed Git Notes in the backing vault for immutable auditability
              </Text>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={emergencyBypassAllowed}
                onChange={(e) => setEmergencyBypassAllowed(e.target.checked)}
                disabled={!canAdmin}
              />
              <Text style={{ fontSize: "13.5px" }}>
                Allow Lead Engineer emergency hotfix sign-off bypass (generates mandatory audit alert)
              </Text>
            </label>
          </Box>
        </Box>

        {canAdmin && (
          <Box alignSelf="flex-start" mt={2}>
            <Button variant="primary" onClick={onSavePolicy}>
              Save Governance Policy
            </Button>
          </Box>
        )}
      </StyledBox>
    </Box>
  </Box>
);
