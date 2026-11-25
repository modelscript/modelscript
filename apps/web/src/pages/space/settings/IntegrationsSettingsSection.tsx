// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, Heading, Label, Text, TextInput } from "@primer/react";
import React from "react";
import Box from "../../../components/Box";
import { StyledBox } from "../../workspace/styles";
import { FieldDescription, FieldLabel, FormRow } from "./styles";

export interface IntegrationsSettingsSectionProps {
  canAdmin: boolean;
  savedJira: Record<string, unknown>;
  jiraBaseUrl: string;
  setJiraBaseUrl: (value: string) => void;
  jiraEmail: string;
  setJiraEmail: (value: string) => void;
  jiraApiToken: string;
  setJiraApiToken: (value: string) => void;
  jiraJql: string;
  setJiraJql: (value: string) => void;
  jiraModelField: string;
  setJiraModelField: (value: string) => void;
  jiraAutoComment: boolean;
  setJiraAutoComment: (value: boolean) => void;
  testingJira: boolean;
  savingJira: boolean;
  onSaveJiraIntegration: (testConnection?: boolean) => Promise<void>;
}

export const IntegrationsSettingsSection: React.FC<IntegrationsSettingsSectionProps> = ({
  canAdmin,
  savedJira,
  jiraBaseUrl,
  setJiraBaseUrl,
  jiraEmail,
  setJiraEmail,
  jiraApiToken,
  setJiraApiToken,
  jiraJql,
  setJiraJql,
  jiraModelField,
  setJiraModelField,
  jiraAutoComment,
  setJiraAutoComment,
  testingJira,
  savingJira,
  onSaveJiraIntegration,
}) => (
  <Box display="flex" flexDirection="column" gap={4}>
    <Box>
      <Heading
        as="h2"
        style={{
          fontSize: "24px",
          fontWeight: 600,
          color: "var(--color-fg-default)",
          marginBottom: "4px",
        }}
      >
        Integrations & External Tracking
      </Heading>
      <Text style={{ fontSize: "14px", color: "var(--color-fg-muted)" }}>
        Connect this Space to external engineering trackers (Atlassian Jira, GitHub, Siemens Polarion) for model-aware
        issue synchronization and automated simulation verification writebacks.
      </Text>
    </Box>

    <StyledBox p={4} display="flex" flexDirection="column" gap={4}>
      <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={2}>
        <Box display="flex" alignItems="center" gap={2}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="#0052cc">
            <path d="M11.53 2c0 2.4 1.97 4.35 4.39 4.35h1.78v1.74c0 2.4 1.97 4.35 4.39 4.35V2h-10.56zm-4.39 4.35c0 2.4 1.97 4.35 4.39 4.35h1.78v1.74c0 2.4 1.97 4.35 4.39 4.35V6.35H7.14zm-4.39 4.35c0 2.4 1.97 4.35 4.39 4.35h1.78v1.74c0 2.4 1.97 4.35 4.39 4.35V10.7H2.75z" />
          </svg>
          <Text style={{ fontWeight: 600, fontSize: "16px", color: "var(--color-fg-default)" }}>
            Atlassian Jira Cloud & Data Center
          </Text>
        </Box>
        {savedJira["baseUrl"] && savedJira["apiToken"] ? (
          <Label variant="success" style={{ fontSize: "12px" }}>
            Configured & Active
          </Label>
        ) : (
          <Label variant="secondary" style={{ fontSize: "12px" }}>
            Not Configured
          </Label>
        )}
      </Box>

      <FormRow>
        <FieldLabel>Jira Instance Base URL</FieldLabel>
        <FieldDescription>
          Full URL to your Jira instance (e.g., https://your-organization.atlassian.net).
        </FieldDescription>
        <TextInput
          value={jiraBaseUrl}
          placeholder="https://company.atlassian.net"
          onChange={(e) => setJiraBaseUrl(e.target.value)}
          style={{ width: "100%" }}
          disabled={!canAdmin}
        />
      </FormRow>

      <FormRow>
        <FieldLabel>Service Account Email / Username</FieldLabel>
        <FieldDescription>
          Atlassian account email for basic auth (required for Jira Cloud; leave empty if using Data Center PAT).
        </FieldDescription>
        <TextInput
          value={jiraEmail}
          placeholder="engineer@company.com"
          onChange={(e) => setJiraEmail(e.target.value)}
          style={{ width: "100%" }}
          disabled={!canAdmin}
        />
      </FormRow>

      <FormRow>
        <FieldLabel>API Token / Personal Access Token</FieldLabel>
        <FieldDescription>Atlassian API token (Cloud) or Bearer Personal Access Token (Server/DC).</FieldDescription>
        <TextInput
          type="password"
          value={jiraApiToken}
          placeholder={
            savedJira["apiToken"] ? "•••••••••••••••• (Leave blank to keep existing token)" : "Enter API token"
          }
          onChange={(e) => setJiraApiToken(e.target.value)}
          style={{ width: "100%" }}
          disabled={!canAdmin}
        />
      </FormRow>

      <FormRow>
        <FieldLabel>Default JQL Query</FieldLabel>
        <FieldDescription>
          JQL query used for automated ticket synchronization and default pull filter.
        </FieldDescription>
        <TextInput
          value={jiraJql}
          placeholder="project = 'PROP' AND statusCategory != Done ORDER BY updated DESC"
          onChange={(e) => setJiraJql(e.target.value)}
          style={{ width: "100%" }}
          disabled={!canAdmin}
        />
      </FormRow>

      <FormRow>
        <FieldLabel>Custom Field ID for Model Tagging (Optional)</FieldLabel>
        <FieldDescription>
          Jira custom field containing Modelica/SysML model FQN (e.g., customfield_10042).
        </FieldDescription>
        <TextInput
          value={jiraModelField}
          placeholder="customfield_10042"
          onChange={(e) => setJiraModelField(e.target.value)}
          style={{ width: "100%" }}
          disabled={!canAdmin}
        />
      </FormRow>

      <Box
        style={{
          padding: "12px 14px",
          borderRadius: "6px",
          background: "var(--color-canvas-subtle)",
          border: "1px solid var(--color-border-default)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
        }}
      >
        <Box>
          <Text style={{ fontWeight: 600, fontSize: "13.5px", color: "var(--color-fg-default)", display: "block" }}>
            Automated Simulation Gate Writeback
          </Text>
          <Text style={{ fontSize: "12px", color: "var(--color-fg-muted)", display: "block" }}>
            Automatically post physics verification evidence and gate pass/fail telemetry back to linked Jira tickets
            when an ECO simulation completes.
          </Text>
        </Box>
        <input
          type="checkbox"
          checked={jiraAutoComment}
          onChange={(e) => setJiraAutoComment(e.target.checked)}
          disabled={!canAdmin}
          style={{ width: "18px", height: "18px", cursor: canAdmin ? "pointer" : "default" }}
        />
      </Box>

      {canAdmin && (
        <Box display="flex" gap={3} mt={2}>
          <Button
            variant="primary"
            disabled={savingJira || testingJira}
            onClick={() => void onSaveJiraIntegration(false)}
          >
            {savingJira ? "Saving Settings..." : "Save Jira Configuration"}
          </Button>
          <Button
            variant="default"
            disabled={savingJira || testingJira || !jiraBaseUrl.trim()}
            onClick={() => void onSaveJiraIntegration(true)}
          >
            {testingJira ? "Testing Connection..." : "Test Connection & Save"}
          </Button>
        </Box>
      )}
    </StyledBox>
  </Box>
);
