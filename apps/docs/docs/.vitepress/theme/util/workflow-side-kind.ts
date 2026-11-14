// SPDX-License-Identifier: AGPL-3.0-or-later

export type WorkflowSideKind = "xml" | "sysml" | "modelica" | "ieee2800" | "scad";

const PAIR_SIDE_KINDS: Record<string, { source: WorkflowSideKind; target: WorkflowSideKind }> = {
  "reqif-sysml": { source: "xml", target: "sysml" },
  "simulink-modelica": { source: "xml", target: "modelica" },
  "autosar-sysml": { source: "xml", target: "sysml" },
  "urdf-modelica": { source: "xml", target: "modelica" },
  "pscad-ieee": { source: "xml", target: "ieee2800" },
  "sysml-ssp": { source: "modelica", target: "xml" },
};

export function getWorkflowPairSideKind(pairId: string, side: "source" | "target"): WorkflowSideKind | undefined {
  const entry = PAIR_SIDE_KINDS[pairId];
  if (!entry) return undefined;
  return side === "source" ? entry.source : entry.target;
}
