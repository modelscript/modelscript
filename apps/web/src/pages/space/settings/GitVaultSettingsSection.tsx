// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckIcon, CopyIcon } from "@primer/octicons-react";
import { Button, Heading, Text, TextInput } from "@primer/react";
import React from "react";
import type { SpaceDomainPreset, SpaceRecord } from "../../../api";
import Box from "../../../components/Box";
import { StyledBox } from "../../workspace/styles";
import { FieldDescription, FieldLabel, FormRow } from "./styles";
import type { SpacePatch } from "./types";

export interface GitVaultSettingsSectionProps {
  space: SpaceRecord;
  preset: SpaceDomainPreset;
  canAdmin: boolean;
  saving: boolean;
  defaultBranch: string;
  setDefaultBranch: (value: string) => void;
  requireEcoSignoff: boolean;
  setRequireEcoSignoff: (value: boolean) => void;
  requireSimCheck: boolean;
  setRequireSimCheck: (value: boolean) => void;
  requireSignedCommits: boolean;
  setRequireSignedCommits: (value: boolean) => void;
  cadDiffing: boolean;
  setCadDiffing: (value: boolean) => void;
  daeDiffing: boolean;
  setDaeDiffing: (value: boolean) => void;
  autoIndexOnPush: boolean;
  setAutoIndexOnPush: (value: boolean) => void;
  copiedCloneUrl: boolean;
  gitCloneUrl: string;
  onCopyCloneUrl: () => void;
  onSaveSpacePatch: (patch: SpacePatch, successMessage: string) => Promise<boolean>;
}

export const GitVaultSettingsSection: React.FC<GitVaultSettingsSectionProps> = ({
  space,
  preset,
  canAdmin,
  saving,
  defaultBranch,
  setDefaultBranch,
  requireEcoSignoff,
  setRequireEcoSignoff,
  requireSimCheck,
  setRequireSimCheck,
  requireSignedCommits,
  setRequireSignedCommits,
  cadDiffing,
  setCadDiffing,
  daeDiffing,
  setDaeDiffing,
  autoIndexOnPush,
  setAutoIndexOnPush,
  copiedCloneUrl,
  gitCloneUrl,
  onCopyCloneUrl,
  onSaveSpacePatch,
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
        Backing Git Vault & PDM Storage
      </Heading>
      <Text color="var(--color-fg-muted)" style={{ fontSize: "13px", display: "block", marginBottom: "20px" }}>
        Configure the backing multi-model Git repository, LFS storage, CAD diffing, and branch protection.
      </Text>

      {/* Git Clone Box */}
      <StyledBox p={3} mb={3}>
        <Text style={{ fontWeight: 700, fontSize: "14px", display: "block", marginBottom: "6px" }}>
          Git Remote Clone URL
        </Text>
        <Text color="var(--color-fg-muted)" style={{ fontSize: "12.5px", display: "block", marginBottom: "10px" }}>
          Clone this Space directly using standard Git CLI or VS Code to sync CAD STEP/STL files, Modelica/SysML2 code,
          and living docs.
        </Text>
        <Box
          p={2}
          borderRadius={2}
          style={{
            background: "var(--color-canvas-subtle)",
            border: "1px solid var(--color-border-default)",
            fontFamily: "var(--ms-font-mono, monospace)",
            fontSize: "13px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <code>git clone {gitCloneUrl}</code>
          <Button size="small" onClick={onCopyCloneUrl}>
            {copiedCloneUrl ? <CheckIcon /> : <CopyIcon />} {copiedCloneUrl ? "Copied" : "Copy"}
          </Button>
        </Box>
      </StyledBox>

      {/* Default Branch */}
      <StyledBox p={4} display="flex" flexDirection="column" gap={4}>
        <FormRow>
          <FieldLabel>Default Branch</FieldLabel>
          <FieldDescription>
            The base branch used for multi-model merging, simulation baselines, and Living Docs rendering.
          </FieldDescription>
          <Box display="flex" gap={2} flexWrap="wrap">
            <TextInput value={defaultBranch} onChange={(e) => setDefaultBranch(e.target.value)} disabled={!canAdmin} />
            {canAdmin && (
              <Button
                variant="primary"
                disabled={saving || defaultBranch === space.default_branch}
                onClick={() => void onSaveSpacePatch({ defaultBranch }, `Default branch set to '${defaultBranch}'.`)}
              >
                Update Default Branch
              </Button>
            )}
          </Box>
        </FormRow>

        {/* Branch Protection Rules */}
        <Box style={{ borderTop: "1px solid var(--color-border-default)", paddingTop: "16px" }}>
          <Text style={{ fontWeight: 700, fontSize: "14px", display: "block", marginBottom: "12px" }}>
            Branch Protection & Release Gates ({defaultBranch})
          </Text>
          <Box display="flex" flexDirection="column" gap={3}>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={requireEcoSignoff}
                onChange={(e) => setRequireEcoSignoff(e.target.checked)}
                disabled={!canAdmin}
              />
              <Text style={{ fontSize: "13.5px" }}>
                Require an approved <strong>Engineering Change Order (ECO)</strong> before merging into {defaultBranch}
              </Text>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={requireSimCheck}
                onChange={(e) => setRequireSimCheck(e.target.checked)}
                disabled={!canAdmin}
              />
              <Text style={{ fontSize: "13.5px" }}>
                Require ModelScript polyglot compiler & simulation regression checks to pass
              </Text>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={requireSignedCommits}
                onChange={(e) => setRequireSignedCommits(e.target.checked)}
                disabled={!canAdmin}
              />
              <Text style={{ fontSize: "13.5px" }}>Require signed cryptographic commits (GPG / SSH Ed25519)</Text>
            </label>
          </Box>
        </Box>

        {/* CAD & DAE Semantic Diffing */}
        <Box style={{ borderTop: "1px solid var(--color-border-default)", paddingTop: "16px" }}>
          <Text style={{ fontWeight: 700, fontSize: "14px", display: "block", marginBottom: "12px" }}>
            Cyber-Physical & CAD Semantic Diffing
          </Text>
          <Box display="flex" flexDirection="column" gap={3}>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={cadDiffing}
                onChange={(e) => setCadDiffing(e.target.checked)}
                disabled={!canAdmin}
              />
              <Text style={{ fontSize: "13.5px" }}>
                Enable 3D CAD STEP/STL geometric semantic diffing in merge requests and ECO reviews
              </Text>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={daeDiffing}
                onChange={(e) => setDaeDiffing(e.target.checked)}
                disabled={!canAdmin}
              />
              <Text style={{ fontSize: "13.5px" }}>
                Enable DAE linear equation AST algebraic diffing and BLT dependency analysis
              </Text>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={autoIndexOnPush}
                onChange={(e) => setAutoIndexOnPush(e.target.checked)}
                disabled={!canAdmin}
              />
              <Text style={{ fontSize: "13.5px" }}>
                Automatically index polyglot packages ({preset.languages.join(", ")}) into package registry on git push
              </Text>
            </label>
          </Box>
        </Box>
      </StyledBox>
    </Box>
  </Box>
);
