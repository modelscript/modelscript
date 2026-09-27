// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Context } from "@modelscript/modelica/context";
import type { OntologyBuilder, UnifiedWorkspace } from "@modelscript/runtime";

export interface TopologyNode {
  usageId: number;
  path: string;
  targetClassId: number | null;
  typeName: string;
  children: TopologyNode[];
  parentId: number | null;
}

export interface TopologyEdge {
  sourceId: number;
  sourcePort?: string;
  targetId: number;
  targetPort?: string;
  connectionId: number;
}

export interface TopologyGraph {
  rootIds: number[];
  nodes: Map<number, TopologyNode>;
  edges: TopologyEdge[];
  variableMap?: Map<string, string>;
}

export type ComputeQuotaChecker = (params: { toolName: string; profile?: string | undefined }) => Promise<{
  allowed: boolean;
  reason?: string | undefined;
  balance?: number | undefined;
  required?: number | undefined;
  profileId?: string | undefined;
}>;

export type ComputeCreditDeductor = (params: {
  toolName: string;
  costCredits: number;
  details?: Record<string, unknown> | undefined;
}) => Promise<void>;

/**
 * Shared server context — holds the current compiler Context,
 * lazily populated by the modelica_load tool, and optional
 * quota and accounting hooks for hosted execution.
 */
export interface ServerContext {
  current: Context | null;
  workspace?: UnifiedWorkspace | null;
  paths?: string[];
  ontologyBuilder?: OntologyBuilder | null;
  polyglotHost?: unknown | null;
  userId?: number | null;
  checkQuota?: ComputeQuotaChecker | null;
  deductCredits?: ComputeCreditDeductor | null;
}
