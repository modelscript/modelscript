// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CheckCircleFillIcon,
  ClockIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  SyncIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import type { SpaceEcoBomPart, SpaceEcoProposalRecord } from "../../../api";
import type { EcoStatusBadgeMeta, SeverityBadgeMeta, SimulationGateBadgeMeta } from "./types";

export const QUICK_JUMP_SECTIONS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "section-rationale", label: "Rationale" },
  { id: "section-blast-radius", label: "Blast Radius" },
  { id: "section-simulation", label: "Simulation Checks" },
  { id: "section-files", label: "Files Changed" },
  { id: "section-bom", label: "BOM Redline" },
  { id: "section-discussion", label: "Discussion & Sign-Offs" },
  { id: "section-merge", label: "Merge Box" },
];

export const DEFAULT_DOWNSTREAM_DEPENDENCIES = [
  { model: "AetherDynamics.Avionics.BmsBusGateway", dependencyType: "instantiates" },
  { model: "AetherDynamics.Propulsion.BatteryPack", dependencyType: "connects" },
] as const;

export const DEFAULT_ALLOCATED_REQUIREMENTS = [
  { reqId: "REQ-ASIL-D-042", title: "CAN-FD Bus Redundancy Failover (<5ms)" },
  { reqId: "REQ-ISO-26262-11", title: "Single-Point Fault Metric SPFM > 99%" },
] as const;

export const DEFAULT_SOLVER_CHECKS = [
  {
    name: "DAE Index & Pantelides Reduction",
    status: "passed",
    value: "Index 1",
    limit: "Index <= 1",
    margin: "Strictly Causalized",
  },
  {
    name: "Peak Transient Overshoot",
    status: "passed",
    value: "8.2%",
    limit: "< 15.0%",
    margin: "+6.8% Safety Margin",
  },
  {
    name: "Settling Time (2% band)",
    status: "passed",
    value: "2.40s",
    limit: "< 3.50s",
    margin: "1.10s Ahead of Envelope",
  },
  {
    name: "Nelson-Oppen Multi-Theory Consistency",
    status: "passed",
    value: "13 Oracles",
    limit: "13 Required",
    margin: "Confluent",
  },
] as const;

export const DEFAULT_BOM_PARTS: ReadonlyArray<SpaceEcoBomPart> = [
  {
    partNumber: "ECU-CANFD-02",
    name: "Dual-Channel CAN-FD Controller",
    changeStatus: "added",
    category: "Electronics",
    baselineQuantity: 0,
    targetQuantity: 1,
    unitCostUsd: 14.5,
    massKg: 0.12,
  },
  {
    partNumber: "HARN-CAN-01",
    name: "Twisted-Pair Shielded Harness",
    changeStatus: "modified",
    category: "Electrical",
    baselineQuantity: 1,
    targetQuantity: 2,
    unitCostUsd: 6.2,
    massKg: 0.08,
  },
];

export const SIGNING_INTENT_OPTIONS: ReadonlyArray<string> = [
  "I verify that simulation results satisfy ISO 26262 ASIL-D safety margins.",
  "I confirm architectural compliance and requirement allocation.",
  "I approve release for physical prototyping & production baseline.",
  "I confirm compliance with 21 CFR Part 11 / AS9100 Rev D audit requirements.",
];

export const SIGNING_DECISION_OPTIONS = [
  { id: "approved", label: "Approve (Compliant)", color: "var(--color-success-fg, #1a7f37)" },
  {
    id: "changes_requested",
    label: "Request Changes",
    color: "var(--color-attention-fg, #9a6700)",
  },
  { id: "rejected", label: "Reject Proposal", color: "var(--color-danger-fg, #cf222e)" },
] as const;

export function getSeverityBadge(severity: SpaceEcoProposalRecord["severity"]): SeverityBadgeMeta {
  switch (severity) {
    case "safety_critical":
      return {
        label: "Safety-Critical",
        sublabel: "ISO 26262 ASIL-D",
        fg: "var(--color-danger-fg, #cf222e)",
        bg: "var(--color-danger-subtle, rgba(207, 34, 46, 0.1))",
        border: "var(--color-danger-muted, rgba(207, 34, 46, 0.25))",
        icon: "🛡️",
      };
    case "major":
      return {
        label: "Major Architecture",
        sublabel: "Interface Impact",
        fg: "var(--color-attention-fg, #9a6700)",
        bg: "var(--color-attention-subtle, rgba(154, 103, 0, 0.1))",
        border: "var(--color-attention-muted, rgba(154, 103, 0, 0.25))",
        icon: "⚡",
      };
    case "minor":
      return {
        label: "Minor",
        sublabel: "Non-breaking",
        fg: "var(--color-fg-muted)",
        bg: "var(--color-canvas-subtle)",
        border: "var(--color-border-default)",
        icon: "🔹",
      };
    case "standard":
    default:
      return {
        label: "Standard",
        sublabel: "Verification Gate",
        fg: "var(--ms-brand)",
        bg: "var(--color-accent-subtle, rgba(9, 105, 218, 0.1))",
        border: "var(--color-accent-muted, rgba(9, 105, 218, 0.25))",
        icon: "⚙️",
      };
  }
}

export function getSimulationGateBadge(
  gateStatus: SpaceEcoProposalRecord["simulation_gate_status"],
): SimulationGateBadgeMeta {
  switch (gateStatus) {
    case "passed":
      return {
        label: "Simulation Passed",
        fullLabel: "DAE Simulation Gate: PASSED",
        fg: "var(--color-success-fg, #1a7f37)",
        bg: "var(--color-success-subtle, rgba(26, 127, 55, 0.1))",
        border: "var(--color-success-muted, rgba(26, 127, 55, 0.25))",
        icon: <CheckCircleFillIcon size={14} fill="var(--color-success-fg, #1a7f37)" />,
      };
    case "failed":
      return {
        label: "Simulation Failed",
        fullLabel: "DAE Simulation Gate: FAILED",
        fg: "var(--color-danger-fg, #cf222e)",
        bg: "var(--color-danger-subtle, rgba(207, 34, 46, 0.1))",
        border: "var(--color-danger-muted, rgba(207, 34, 46, 0.25))",
        icon: <XCircleFillIcon size={14} fill="var(--color-danger-fg, #cf222e)" />,
      };
    case "running":
      return {
        label: "Simulating...",
        fullLabel: "DAE Simulation Gate: RUNNING",
        fg: "var(--ms-brand)",
        bg: "var(--color-accent-subtle, rgba(9, 105, 218, 0.1))",
        border: "var(--color-accent-muted, rgba(9, 105, 218, 0.25))",
        icon: <SyncIcon size={14} fill="var(--ms-brand)" />,
      };
    case "pending":
    default:
      return {
        label: "Simulation Pending",
        fullLabel: "DAE Simulation Gate: PENDING",
        fg: "var(--color-fg-muted)",
        bg: "var(--color-canvas-subtle)",
        border: "var(--color-border-default)",
        icon: <ClockIcon size={14} />,
      };
  }
}

export function getEcoStatusBadge(status: SpaceEcoProposalRecord["status"]): EcoStatusBadgeMeta {
  switch (status) {
    case "merged":
      return {
        label: "Merged",
        fg: "#ffffff",
        bg: "#8250df",
        border: "#8250df",
        icon: <GitMergeIcon size={14} fill="#ffffff" />,
      };
    case "approved":
      return {
        label: "Approved",
        fg: "#ffffff",
        bg: "#1f883d",
        border: "#1f883d",
        icon: <CheckCircleFillIcon size={14} fill="#ffffff" />,
      };
    case "in_review":
      return {
        label: "In Review",
        fg: "var(--color-attention-fg, #9a6700)",
        bg: "var(--color-attention-subtle, rgba(154, 103, 0, 0.1))",
        border: "var(--color-attention-muted, rgba(154, 103, 0, 0.25))",
        icon: <ClockIcon size={14} />,
      };
    case "rejected":
      return {
        label: "Closed",
        fg: "var(--color-danger-fg, #cf222e)",
        bg: "var(--color-danger-subtle, rgba(207, 34, 46, 0.1))",
        border: "var(--color-danger-muted, rgba(207, 34, 46, 0.25))",
        icon: <XCircleFillIcon size={14} fill="var(--color-danger-fg, #cf222e)" />,
      };
    case "open":
    default:
      return {
        label: "Open",
        fg: "#ffffff",
        bg: "#1f883d",
        border: "#1f883d",
        icon: <GitPullRequestIcon size={14} fill="#ffffff" />,
      };
  }
}

export function applyParameterConflictResolution(content: string, paramName: string, val: string | number): string {
  const escapedParam = paramName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regexWithParam = new RegExp(`(\\b(?:parameter\\s+\\w+\\s+)?${escapedParam}\\s*=\\s*)([^;\\s,\\n)]+)`, "g");
  if (regexWithParam.test(content)) {
    return content.replace(regexWithParam, `$1${val}`);
  }
  const fallbackRegex = new RegExp(`(\\b${escapedParam}\\s*=\\s*)([^;\\s,\\n)]+)`, "g");
  return content.replace(fallbackRegex, `$1${val}`);
}
