// SPDX-License-Identifier: AGPL-3.0-or-later

import { Connection, TextDocuments } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { DiagramService } from "./services/diagram-service.js";
import { DocumentManager } from "./services/document-manager.js";
import { ParserService } from "./services/parser-service.js";
import { ValidationService } from "./services/validation-service.js";
import { WorkspaceManager } from "./services/workspace-manager.js";

/**
 * Shared server-wide dependency injection context passed to LSP request handlers and providers.
 *
 * Aggregates core LSP connection handles, document/workspace managers, language services,
 * and mutable per-document state caches.
 */
export interface LspContext {
  /** Active JSON-RPC connection to the LSP client (Node stdio/IPC or Browser worker). */
  connection: Connection;
  /** Synchronized text document manager tracking open editor buffers. */
  documents: TextDocuments<TextDocument>;
  /** Polyglot workspace index and digital thread hypergraph coordinator. */
  workspaceManager: WorkspaceManager;
  /** CST parse tree and line index cache manager for open and lazy-loaded documents. */
  documentManager: DocumentManager;
  /** Multi-tier syntax, CST lint, Salsa query, and formal verification diagnostic service. */
  validationService: ValidationService;
  /** WebAssembly GLR parser registry and lifecycle service. */
  parserService: ParserService;
  /** Polyglot schematic, SysML v2, OWL2, and PSCAD diagram generation service. */
  diagramService: DiagramService;

  /** Mutable server state shared across loosely coupled handlers and notifications. */
  state: {
    /** In-flight asynchronous validation promises keyed by document URI. */
    activeValidationPromises: Map<string, Promise<void>>;
    /** Shared Modelica compiler context instance when initialized. */
    sharedContext: any | null;
    /** Cache of resolved class/symbol definitions keyed by fully qualified name (FQN). */
    fqnCache: Map<string, unknown>;
    /** Secondary index mapping FQN prefixes or segments to cached symbol entries. */
    fqnCacheIndex: Map<string, unknown>;
    /** Monotonically increasing edit revision counters per document URI for staleness checks. */
    documentRevisions: Map<string, number>;
    /** Per-document {@link LSPBridge} instances mapping symbol indices to LSP locations. */
    documentLSPBridges: Map<string, unknown>;
    /** Most recent semantic diagnostics per document URI, preserved across fast Tier-1 keystroke parses. */
    lastSemanticDiagnostics: Map<string, unknown[]>;
    /** Whether all declared external package/library dependencies have finished loading. */
    dependenciesReady: boolean;
  };

  /** Live user configuration synchronized from VS Code settings (`modelscript.*`). */
  settings?: ModelScriptLspSettings | undefined;
}

export type FeatureChannel = "stable" | "preview" | "experimental" | "dev";

export interface ModelScriptFeatureFlags {
  /** '▶ Simulate' / '▶ Run Study' CodeLens above model and study declarations (Tier: stable). */
  codeLensSimulate: boolean;
  /** Formal verification, contract checking, DAE structural proofs, and reachability (Tier: preview). */
  formalVerification: boolean;
  /** CAD -> FEA/CFD mesh discretization and study generation (Tier: preview). */
  caeWorkbench: boolean;
  /** FMI 2.0/3.0 co-simulation orchestrator and live MQTT participants (Tier: preview). */
  coSimulation: boolean;
  /** Cross-domain Digital Thread twin alignment, hover cards, and sync (Tier: experimental). */
  digitalThread: boolean;
  /** Cross-domain model projection & 3D polyglot visualizer (Tier: experimental). */
  polyglotProjection: boolean;
  /** Multi-domain file scaffolding (.scad + .mo + .inp) from SysML v2 parts (Tier: experimental). */
  scaffolding: boolean;
  /** AI Copilot sidebar view and closed-loop synthesis (Tier: experimental). */
  aiCopilot: boolean;
  /** Domain-specific vertical demos, trade study Tier 1-3 CodeLenses, and showcase workflows (Tier: dev). */
  demos: boolean;
}

export const FEATURE_MIN_CHANNEL: Record<keyof ModelScriptFeatureFlags, FeatureChannel> = {
  codeLensSimulate: "stable",
  formalVerification: "preview",
  caeWorkbench: "preview",
  coSimulation: "preview",
  digitalThread: "experimental",
  polyglotProjection: "experimental",
  scaffolding: "experimental",
  aiCopilot: "experimental",
  demos: "dev",
};

const CHANNEL_RANK: Record<FeatureChannel, number> = {
  stable: 1,
  preview: 2,
  experimental: 3,
  dev: 4,
};

/**
 * Resolves the effective feature flags from user settings (`modelscript.features.*`),
 * defaulting to the `"stable"` channel when unspecified.
 */
export function resolveFeatureFlags(settings?: ModelScriptLspSettings): ModelScriptFeatureFlags {
  const rawChannel = settings?.features?.channel;
  const channel: FeatureChannel =
    rawChannel === "stable" || rawChannel === "preview" || rawChannel === "experimental" || rawChannel === "dev"
      ? rawChannel
      : "stable";
  const currentRank = CHANNEL_RANK[channel];

  const isEnabled = (key: keyof ModelScriptFeatureFlags): boolean => {
    const explicit = settings?.features?.[key];
    if (typeof explicit === "boolean") {
      return explicit;
    }
    return currentRank >= CHANNEL_RANK[FEATURE_MIN_CHANNEL[key]];
  };

  return {
    codeLensSimulate: isEnabled("codeLensSimulate"),
    formalVerification: isEnabled("formalVerification"),
    caeWorkbench: isEnabled("caeWorkbench"),
    coSimulation: isEnabled("coSimulation"),
    digitalThread: isEnabled("digitalThread"),
    polyglotProjection: isEnabled("polyglotProjection"),
    scaffolding: isEnabled("scaffolding"),
    aiCopilot: isEnabled("aiCopilot"),
    demos: isEnabled("demos"),
  };
}

export interface ModelScriptLspSettings {
  features?:
    | ({
        channel?: FeatureChannel | undefined;
      } & Partial<ModelScriptFeatureFlags>)
    | undefined;
  languages?:
    | {
        maturityTier?: "all" | "betaAndStable" | "stableOnly" | "stable" | "beta" | "experimental" | undefined;
        enabledOverrides?: Record<string, boolean> | undefined;
      }
    | undefined;
  codeLens?:
    | {
        enabled?: boolean | undefined;
        simulate?: boolean | undefined;
        diagram?: boolean | undefined;
        verification?: boolean | "all" | "problemsOnly" | "off" | undefined;
        polyglotLinks?: boolean | undefined;
        cadMetrics?: boolean | undefined;
        fileConversions?: boolean | undefined;
      }
    | undefined;
  inlayHints?:
    | {
        enabled?: boolean | undefined;
        unitsAndBounds?: boolean | undefined;
        formalProofBadges?: boolean | undefined;
        variabilityPrefixes?: boolean | undefined;
      }
    | undefined;
  diagnostics?:
    | {
        enabled?: boolean | undefined;
        maxProblems?: number | undefined;
        maxNumberOfProblems?: number | undefined;
        disabledRules?: string[] | undefined;
        crossDomainDrift?: "error" | "warning" | "information" | "off" | undefined;
        formalVerificationOnSave?: boolean | undefined;
        daeSingularityCheck?: boolean | undefined;
      }
    | undefined;
}
