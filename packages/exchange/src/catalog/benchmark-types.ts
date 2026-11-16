// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  BenchmarkCaseResult,
  BenchmarkMetricKind,
  BenchmarkScale,
  LanguageBenchmarkAdapter,
  LanguageBenchmarkAdapterContext,
} from "@modelscript/runtime/benchmark";
import type { StdlibDomain } from "./types.js";

export type {
  BenchmarkCaseResult,
  BenchmarkMetricKind,
  BenchmarkScale,
  LanguageBenchmarkAdapter,
  LanguageBenchmarkAdapterContext,
};

export type BenchmarkTier = "preview-to-beta" | "beta-to-stable" | "stable-hardening";

export type BenchmarkCategory =
  | "conformance"
  | "numerical-trajectory"
  | "syntax-corpus"
  | "stress-scale"
  | "component-library";

export interface BenchmarkUpstream {
  url: string;
  fallbackUrl?: string | undefined;
  mirrorUrls?: string[] | undefined;
  sha256?: string | undefined;
  archiveType?: "zip" | "tar.gz" | "directory" | "single-file" | undefined;
  extractSubpath?: string | undefined;
  sizeBytes?: number | undefined;
}

export interface BenchmarkParityMetric {
  targetMetric: "rmse" | "max-relative-error" | "ast-pass-rate" | "dae-parity";
  threshold: number;
  description: string;
}

export interface BenchmarkEntry {
  id: string;
  language: string;
  name: string;
  version: string;
  description: string;
  license: string;
  tier: BenchmarkTier;
  domain: StdlibDomain;
  category: BenchmarkCategory;
  filename: string;
  referenceTool: string;
  parityMetric: BenchmarkParityMetric;
  localSourcePath?: string | undefined;
  upstream?: BenchmarkUpstream | undefined;
  minExpectedCases?: number | undefined;
}

export interface BenchmarkCatalog {
  version: string;
  benchmarks: BenchmarkEntry[];
}

export interface BenchmarkProvenance {
  gitSha: string;
  recordedAt: string;
  os: string;
  arch: string;
  cpuModel: string;
  cpuCores: number;
  nodeVersion: string;
  flattenerBackend: string;
}

export interface StageTiming {
  status: "supported" | "n/a";
  medianMs: number;
  p95Ms: number;
  throughputMbPerSec?: number | undefined;
  iterations: number;
}

export interface ParseStageVerification {
  status: "supported" | "n/a";
  positiveFixtures: number;
  passedFixtures: number;
  errorRecoveryVerified: boolean;
  cstNodeCount: number;
  parserKind: "wasm-glr" | "native-ts" | "container";
}

export interface LintStageVerification {
  status: "supported" | "n/a";
  declaredRuleCount: number;
  testedRuleCount: number;
  negativeCasesPassed: number;
  negativeCasesTotal: number;
}

export interface LowerStageVerification {
  status: "supported" | "n/a";
  targetIr: "dae-arena" | "cad-brep" | "rdf-triplestore" | "container" | "domain-solver" | "ast-only";
  varCount?: number | undefined;
  eqCount?: number | undefined;
  zeroAllocArena: boolean;
}

export interface SolveStageVerification {
  status: "supported" | "n/a";
  casesRun: number;
  casesPassed: number;
  referenceTool: string;
  referenceVersion?: string | undefined;
  metricKind: BenchmarkMetricKind;
  tolerance: number;
  measuredWorstError: number | null;
}

export interface ProjectionStageVerification {
  status: "supported" | "n/a";
  targets: string[];
  roundtripVerified: boolean;
}

export interface StageVerification {
  parse: ParseStageVerification;
  lint: LintStageVerification;
  lower: LowerStageVerification;
  solve: SolveStageVerification;
  projection: ProjectionStageVerification;
}

export interface LanguagePillarSummary {
  domainKind: "simulation" | "cad" | "semantic" | "container";
  hasParser: boolean;
  hasParserTests: boolean;
  hasLinter: boolean;
  hasLinterTests: boolean;
  testedErrorCodesCount: number;
  hasBenchmark: boolean;
  hasToleranceCheck: boolean;
  hasDomainLowering: boolean;
  hasDomainLoweringTests: boolean;
  usesRuntimeArena: boolean;
  hasLsp: boolean;
  hasLspTests: boolean;
  testFileCount: number;
  testCaseCount: number;
  auditedTier: "beta" | "alpha" | "pre-alpha";
  currentDeclaredTier: "beta" | "alpha" | "pre-alpha";
  gaps: string[];
}

export interface LanguageBenchmarkReport {
  slug: string;
  name: string;
  pkgName: string;
  tier: "beta" | "alpha" | "pre-alpha";
  reproduceCommand: string;
  catalogIds: string[];
  scorecard: LanguagePillarSummary;
  stages: StageVerification;
  timings: {
    parse: StageTiming;
    lint: StageTiming;
    lower: StageTiming;
    solve: StageTiming;
  };
  cases: BenchmarkCaseResult[];
  summary: {
    totalCases: number;
    passedCases: number;
    passRate: number;
  };
}

export interface PolyglotBenchmarkBaseline {
  schemaVersion: "1.0.0";
  provenance: BenchmarkProvenance;
  aggregate: {
    totalLanguages: number;
    betaCount: number;
    alphaCount: number;
    preAlphaCount: number;
    languagesWithAdapters: number;
    totalCases: number;
    passedCases: number;
    overallPassRate: number;
  };
  languages: LanguageBenchmarkReport[];
}
