// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, Heading, Text } from "@primer/react";
import React from "react";
import Box from "../../../components/Box";
import { StyledBox } from "../../workspace/styles";
import { FieldDescription, FieldLabel, FormRow } from "./styles";

export interface ModulesSettingsSectionProps {
  canAdmin: boolean;
  saving: boolean;
  enableChat: boolean;
  setEnableChat: (value: boolean) => void;
  enableDocs: boolean;
  setEnableDocs: (value: boolean) => void;
  enablePlm: boolean;
  setEnablePlm: (value: boolean) => void;
  enableRepos: boolean;
  setEnableRepos: (value: boolean) => void;
  landingTab: string;
  setLandingTab: (value: string) => void;
  onSaveModules: () => Promise<void>;
}

export const ModulesSettingsSection: React.FC<ModulesSettingsSectionProps> = ({
  canAdmin,
  saving,
  enableChat,
  setEnableChat,
  enableDocs,
  setEnableDocs,
  enablePlm,
  setEnablePlm,
  enableRepos,
  setEnableRepos,
  landingTab,
  setLandingTab,
  onSaveModules,
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
        Space Modules & Navigation Tabs
      </Heading>
      <Text color="var(--color-fg-muted)" style={{ fontSize: "13px", display: "block", marginBottom: "20px" }}>
        Enable or disable collaborative cyber-physical engineering modules for this Space.
      </Text>

      <StyledBox p={4} display="flex" flexDirection="column" gap={4}>
        <Box display="flex" flexDirection="column" gap={3}>
          <Box
            display="flex"
            justifyContent="space-between"
            alignItems="center"
            p={3}
            borderRadius={2}
            style={{
              border: "1px solid var(--color-border-default)",
              background: "var(--color-canvas-subtle)",
            }}
          >
            <Box>
              <Text style={{ fontWeight: 700, fontSize: "14px", display: "block" }}>💬 Channels & Real-Time Chat</Text>
              <Text color="var(--color-fg-muted)" style={{ fontSize: "12.5px" }}>
                Persistent Slack-speed topic channels, bot telemetry feeds, and mathematical entity previews.
              </Text>
            </Box>
            <label style={{ cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={enableChat}
                onChange={(e) => setEnableChat(e.target.checked)}
                disabled={!canAdmin}
                style={{ width: 18, height: 18 }}
              />
            </label>
          </Box>

          <Box
            display="flex"
            justifyContent="space-between"
            alignItems="center"
            p={3}
            borderRadius={2}
            style={{
              border: "1px solid var(--color-border-default)",
              background: "var(--color-canvas-subtle)",
            }}
          >
            <Box>
              <Text style={{ fontWeight: 700, fontSize: "14px", display: "block" }}>📄 Living Architecture Docs</Text>
              <Text color="var(--color-fg-muted)" style={{ fontSize: "12.5px" }}>
                System requirements, architecture specs, and live Modelica/SysML2 code snippets.
              </Text>
            </Box>
            <label style={{ cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={enableDocs}
                onChange={(e) => setEnableDocs(e.target.checked)}
                disabled={!canAdmin}
                style={{ width: 18, height: 18 }}
              />
            </label>
          </Box>

          <Box
            display="flex"
            justifyContent="space-between"
            alignItems="center"
            p={3}
            borderRadius={2}
            style={{
              border: "1px solid var(--color-border-default)",
              background: "var(--color-canvas-subtle)",
            }}
          >
            <Box>
              <Text style={{ fontWeight: 700, fontSize: "14px", display: "block" }}>🔗 PLM & Change Orders (ECO)</Text>
              <Text color="var(--color-fg-muted)" style={{ fontSize: "12.5px" }}>
                Formal Engineering Change Orders, multi-signature release gating, and compliance verification.
              </Text>
            </Box>
            <label style={{ cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={enablePlm}
                onChange={(e) => setEnablePlm(e.target.checked)}
                disabled={!canAdmin}
                style={{ width: 18, height: 18 }}
              />
            </label>
          </Box>

          <Box
            display="flex"
            justifyContent="space-between"
            alignItems="center"
            p={3}
            borderRadius={2}
            style={{
              border: "1px solid var(--color-border-default)",
              background: "var(--color-canvas-subtle)",
            }}
          >
            <Box>
              <Text style={{ fontWeight: 700, fontSize: "14px", display: "block" }}>
                📦 Packages & Multi-Model PDM Registry
              </Text>
              <Text color="var(--color-fg-muted)" style={{ fontSize: "12.5px" }}>
                Backing Git Vault, polyglot package distribution, and FMI 2.0/3.0 FMU simulation binaries.
              </Text>
            </Box>
            <label style={{ cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={enableRepos}
                onChange={(e) => setEnableRepos(e.target.checked)}
                disabled={!canAdmin}
                style={{ width: 18, height: 18 }}
              />
            </label>
          </Box>
        </Box>

        <Box style={{ borderTop: "1px solid var(--color-border-default)", paddingTop: "16px" }}>
          <FormRow>
            <FieldLabel>Default Landing Tab</FieldLabel>
            <FieldDescription>The default module displayed when users navigate to this Space.</FieldDescription>
            <select
              value={landingTab}
              onChange={(e) => setLandingTab(e.target.value)}
              disabled={!canAdmin}
              style={{
                padding: "8px 12px",
                borderRadius: "6px",
                border: "1px solid var(--color-border-default)",
                background: "var(--color-canvas-default)",
                color: "var(--color-fg-default)",
                fontSize: "14px",
                maxWidth: "260px",
              }}
            >
              <option value="overview">🧭 Overview & Cockpit</option>
              <option value="chat">💬 Channels & Chat</option>
              <option value="docs">📄 Living Architecture Docs</option>
              <option value="changes">⚡ Change Control (ECOs)</option>
              <option value="repos">📦 Packages & PDM</option>
            </select>
          </FormRow>
        </Box>

        {canAdmin && (
          <Box alignSelf="flex-start" mt={1}>
            <Button variant="primary" disabled={saving} onClick={() => void onSaveModules()}>
              Save Module Settings
            </Button>
          </Box>
        )}
      </StyledBox>
    </Box>
  </Box>
);
