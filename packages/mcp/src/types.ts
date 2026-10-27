// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Context } from "@modelscript/modelica/context";
import type { OntologyBuilder, UnifiedWorkspace } from "@modelscript/runtime";

/**
 * Represents a single instantiated component or subsystem node in a system topology tree.
 */
export interface TopologyNode {
  /** Unique symbol ID of the component usage declaration. */
  usageId: number;
  /** Hierarchical dot-separated instance path (e.g., `"plant.motor.resistor"`). */
  path: string;
  /** Resolved symbol ID of the component's target class definition, or `null` if unresolved. */
  targetClassId: number | null;
  /** Declared type name of the component usage. */
  typeName: string;
  /** Nested child component nodes instantiated within this node. */
  children: TopologyNode[];
  /** Symbol ID of the enclosing parent node, or `null` for top-level root nodes. */
  parentId: number | null;
}

/**
 * Represents a physical or signal connection edge between two nodes in a system topology graph.
 */
export interface TopologyEdge {
  /** Symbol ID of the source component node. */
  sourceId: number;
  /** Optional connector port name on the source component. */
  sourcePort?: string | undefined;
  /** Symbol ID of the target component node. */
  targetId: number;
  /** Optional connector port name on the target component. */
  targetPort?: string | undefined;
  /** Symbol ID of the originating `connect(...)` equation or connection usage. */
  connectionId: number;
}

/**
 * Complete hierarchical and connection topology graph extracted from a system model.
 */
export interface TopologyGraph {
  /** Symbol IDs of the top-level root nodes in the topology. */
  rootIds: number[];
  /** Map from node usage symbol ID to its corresponding {@link TopologyNode}. */
  nodes: Map<number, TopologyNode>;
  /** List of all physical/signal connection edges across the system. */
  edges: TopologyEdge[];
  /** Optional mapping from canonical variable paths to domain-specific variable identifiers. */
  variableMap?: Map<string, string> | undefined;
}

/**
 * Asynchronous hook invoked before executing compute-intensive MCP tools to verify
 * that the caller has sufficient compute quota or credits for the requested profile.
 */
export type ComputeQuotaChecker = (params: { toolName: string; profile?: string | undefined }) => Promise<{
  /** Whether execution of the tool is permitted. */
  allowed: boolean;
  /** Human-readable explanation when execution is denied. */
  reason?: string | undefined;
  /** Caller's current remaining credit balance. */
  balance?: number | undefined;
  /** Minimum credits required to run the requested tool. */
  required?: number | undefined;
  /** Resolved compute profile identifier. */
  profileId?: string | undefined;
}>;

/**
 * Asynchronous hook invoked after a compute-intensive MCP tool completes to deduct
 * consumed compute credits from the caller's account.
 */
export type ComputeCreditDeductor = (params: {
  /** Name of the MCP tool that incurred the compute cost. */
  toolName: string;
  /** Number of compute credits to deduct. */
  costCredits: number;
  /** Optional execution metadata (e.g., solver steps, wall time, sample count). */
  details?: Record<string, unknown> | undefined;
}) => Promise<void>;

/**
 * Shared server context — holds the current compiler Context,
 * lazily populated by the modelica_load tool, and optional
 * quota and accounting hooks for hosted execution.
 */
export interface ServerContext {
  /** Active Modelica compiler context, or `null` if no model/library has been loaded yet. */
  current: Context | null;
  /** Optional polyglot unified workspace indexing symbols across multiple languages. */
  workspace?: UnifiedWorkspace | null | undefined;
  /** Optional list of filesystem root paths searched when loading libraries and models. */
  paths?: string[] | undefined;
  /** Optional OWL2/RDF ontology builder populated from loaded engineering models. */
  ontologyBuilder?: OntologyBuilder | null | undefined;
  /** Optional reference to the active `PolyglotMcpHost` instance managing digital threads. */
  polyglotHost?: unknown | null;
  /** Optional authenticated user ID for multi-tenant hosted sessions. */
  userId?: number | null | undefined;
  /** Optional pre-execution quota verification callback. */
  checkQuota?: ComputeQuotaChecker | null | undefined;
  /** Optional post-execution compute credit deduction callback. */
  deductCredits?: ComputeCreditDeductor | null | undefined;
  /** Optional social bridge for reading discussions and posting replies. */
  socialBridge?:
    | {
        getPost: (postId: number) => Promise<any>;
        getReplies: (postId: number) => Promise<any[]>;
        createPost: (params: {
          authorId: number;
          content: string;
          replyToId?: number | undefined;
          artifactViewId?: number | undefined;
        }) => Promise<{ id: number }>;
      }
    | undefined;
  /** Optional sandbox execution resource constraints (timeouts, memory limits) for AI agent tools. */
  sandboxLimits?: import("./sandbox.js").McpExecutionLimits | undefined;
}

/**
 * Single KPI metric badge emitted by an MCP engineering tool for structured trace display.
 */
export interface McpTraceMetric {
  /** Short metric label (e.g., `"Overshoot"`, `"BLT blocks"`, `"STL robustness ρ"`). */
  label: string;
  /** Formatted metric value with units or thresholds (e.g., `"2.8% (< 4.0%)"`, `"+0.062 PASS"`). */
  value: string;
  /** Visual status indicator for UI badge coloring. */
  status?: "pass" | "info" | "fail" | undefined;
}

/**
 * Standardized structured trace envelope included in MCP tool JSON responses
 * and consumed by the IDE AI Chat panel (`chat-webview.ts`) and docs console (`HomeAiAgent.vue`).
 */
export interface McpStructuredTrace {
  /** Concise single-line summary of the tool execution outcome. */
  resultTitle: string;
  /** Key quantitative engineering metrics produced by the tool step. */
  metrics: McpTraceMetric[];
  /** Optional final compiler/solver certification verdict banner text. */
  verdict?: string | undefined;
}
