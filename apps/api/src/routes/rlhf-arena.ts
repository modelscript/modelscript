// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Crowd-Sourced Engineering RLHF Arena & Relational Hypergraph Annotation API.
 *
 * Powers special `rlhf_arena` social posts that launch the Split-View Embedded Ansatz Annotator:
 *   - `pairwise_arena`: Side-by-side preference collection over live CAD/DAE/code candidates with 4-gate badges
 *   - `fix_it_bounty`: Verified patch submissions checked by the formal verification gates
 *   - `tolerance_labeling`: Crowd-sourced `group_id` / `rel_sign` / GD&T tolerance overrides
 *   - Reputation-weighted consensus, hidden honeypot calibration, and `dataset-posttrain` JSON/JSONL export
 */

import {
  applyHypergraphOverrides,
  compileRelationalHypergraph,
  SandboxedRolloutExecutor,
  type AiGovernancePolicy,
  type CircuitBreakerState,
  type FormalCertificateSummary,
  type HypergraphTokenOverride,
  type RlhfChallengeType,
  type RolloutExecutionReport,
  type RolloutExecutionStatus,
  type SandboxContext,
} from "@modelscript/runtime";
import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import crypto from "node:crypto";
import type { LibraryDatabase } from "../database.js";
import { optionalAuth, requireAuth } from "../middleware/auth-middleware.js";
import { settleCampaignBounty } from "../services/provenance-attribution.js";
import { publicErrorMessage } from "../utils/http-error.js";

const VALID_CHALLENGE_TYPES = new Set<RlhfChallengeType>(["pairwise_arena", "fix_it_bounty", "tolerance_labeling"]);

const VALID_CAMPAIGN_CHALLENGE_TYPES = new Set<string>([
  "pairwise_arena",
  "fix_it_bounty",
  "tolerance_labeling",
  "mixed",
]);

const VALID_CAMPAIGN_STATUSES = new Set<string>(["draft", "active", "paused", "completed", "archived"]);

export type ConsensusStatus = "pending" | "consensus_reached" | "needs_adjudication" | "adjudicated";

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw || typeof raw !== "string") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Fast, deterministic 4-gate (+ CAD manifold) formal verifier for RLHF candidates and Fix-It patches.
 * Runs synchronously with zero external subprocesses so adversarial crowd/LLM payloads cannot DoS the API.
 */
export function evaluateFormalGatesForCandidate(code: string, dialect: string): FormalCertificateSummary {
  const diagnostics: string[] = [];
  const trimmed = (code ?? "").trim();
  const d = (dialect || "modelica").trim().toLowerCase();

  // Gate 1: Syntax & balanced delimiters
  let gate1 = trimmed.length > 0;
  if (!gate1) {
    diagnostics.push("Gate 1 [Syntax]: Candidate source is empty.");
  } else {
    const stack: string[] = [];
    const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
    let inString: string | null = null;
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i]!;
      if (inString) {
        if (ch === "\\" && i + 1 < trimmed.length) {
          i++;
          continue;
        }
        if (ch === inString) inString = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inString = ch;
      } else if (ch === "(" || ch === "[" || ch === "{") {
        stack.push(ch);
      } else if (ch === ")" || ch === "]" || ch === "}") {
        if (stack.pop() !== pairs[ch]) {
          gate1 = false;
          diagnostics.push(`Gate 1 [Syntax]: Unmatched closing delimiter '${ch}'.`);
          break;
        }
      }
    }
    if (gate1 && inString) {
      gate1 = false;
      diagnostics.push("Gate 1 [Syntax]: Unterminated string literal.");
    }
    if (gate1 && stack.length > 0) {
      gate1 = false;
      diagnostics.push(`Gate 1 [Syntax]: Unclosed delimiter '${stack[stack.length - 1]}'.`);
    }

    // Dialect-specific structural checks
    if (gate1 && d === "modelica") {
      const openMatch = trimmed.match(/\b(?:model|block|class|connector|package|record|function)\s+([A-Za-z_]\w*)/);
      const endMatch = trimmed.match(/\bend\s+([A-Za-z_]\w*)\s*;/);
      if (!openMatch || !endMatch) {
        gate1 = false;
        diagnostics.push("Gate 1 [Modelica]: Missing matching 'model <Name> ... end <Name>;' declaration.");
      } else if (openMatch[1] !== endMatch[1]) {
        gate1 = false;
        diagnostics.push(`Gate 1 [Modelica]: Identifier mismatch ('${openMatch[1]}' vs 'end ${endMatch[1]}').`);
      }
    }
  }

  // Gate 2: QUDV SI-7 unit consistency check (catch obvious unit mismatches or NaN/invalid units)
  let gate2 = gate1;
  if (gate1 && /unit\s*=\s*["']\s*["']/i.test(trimmed)) {
    gate2 = false;
    diagnostics.push("Gate 2 [QUDV Units]: Empty unit string declared.");
  }

  // Gate 3: SMT / constraint feasibility (reject direct contradictions like `assert(false)` or negative thickness)
  let gate3 = gate1;
  if (gate1) {
    if (/\bassert\s*\(\s*false\b/i.test(trimmed)) {
      gate3 = false;
      diagnostics.push("Gate 3 [SMT]: Contradictory assert(false) detected.");
    }
    if (
      (d === "scad" || d === "openscad") &&
      /\b(?:wall_thickness|thickness|radius|diameter)\s*=\s*-\d/i.test(trimmed)
    ) {
      gate3 = false;
      diagnostics.push("Gate 3 [SMT/CAD]: Negative physical geometric dimension declared.");
    }
  }

  // Gate 4: Structural balance (DAE N_eq vs N_var heuristic for Modelica; solid primitive check for CAD)
  let gate4 = gate1;
  let cadClearance: boolean | undefined;
  if (gate1 && d === "modelica") {
    const varDecls = trimmed.match(/^\s*(?:Real|Integer|Boolean)\s+[A-Za-z_]\w*/gm) ?? [];
    const hasEqSection = /\bequation\b/.test(trimmed);
    if (varDecls.length > 0 && hasEqSection) {
      const eqBody = trimmed.slice(trimmed.indexOf("equation"));
      const eqLines = eqBody
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.includes("=") && !s.startsWith("end ") && !s.startsWith("//"));
      const connectLines = eqBody.match(/\bconnect\s*\(/g) ?? [];
      if (eqLines.length + connectLines.length === 0) {
        gate4 = false;
        diagnostics.push(
          `Gate 4 [DAE Balance]: Declared ${varDecls.length} state/algebraic variable(s) but 0 equations.`,
        );
      }
    }
  } else if (d === "scad" || d === "openscad" || d === "step" || d === "urdf") {
    const hasGeometry =
      /\b(?:cube|sphere|cylinder|linear_extrude|rotate_extrude|polyhedron|hull|union|difference|intersection|ADVANCED_FACE|MANIFOLD_SOLID_BREP|<geometry|<link)\b/i.test(
        trimmed,
      );
    cadClearance = gate1 && gate3 && hasGeometry;
    gate4 = cadClearance;
    if (!hasGeometry) {
      diagnostics.push("Gate 4 [CAD Manifold]: No solid geometry primitive or B-Rep entity found.");
    }
  }

  return {
    gate1GlrSyntax: gate1,
    gate2QudvUnits: gate2,
    gate3SmtFeasibility: gate3,
    gate4DaeBalance: gate4,
    ...(cadClearance !== undefined ? { cadClearance } : {}),
    diagnostics,
    verifiedAtIso: new Date().toISOString(),
  };
}

export interface RlhfSandboxTelemetry {
  rolloutId: string;
  status: RolloutExecutionStatus;
  fuelUsed: number;
  fuelBudget: number;
  peakMemoryBytes: number;
  memoryLimitBytes: number;
  elapsedMs: number;
  timeoutMs: number;
  circuitState: CircuitBreakerState;
  circuitOpen: boolean;
  deepFormalCheck: boolean;
  retryAfterMs?: number | undefined;
}

/**
 * Shared fuel/memory/timeout-bounded RLVR sandbox executor with per-user anti-DoS circuit breaker.
 */
export const rlhfSandboxExecutor = new SandboxedRolloutExecutor({
  defaultFuelBudget: 200_000,
  defaultMemoryLimitBytes: 16 * 1024 * 1024,
  defaultTimeoutMs: 2_500,
  maxInputBytes: 512 * 1024,
  circuitBreaker: {
    failureThreshold: 5,
    cooldownMs: 30_000,
    slidingWindowMs: 60_000,
    halfOpenSuccessThreshold: 1,
  },
});

function toSandboxTelemetry<T>(report: RolloutExecutionReport<T>, deepFormalCheck: boolean): RlhfSandboxTelemetry {
  return {
    rolloutId: report.rolloutId,
    status: report.status,
    fuelUsed: report.fuelUsed,
    fuelBudget: report.fuelBudget,
    peakMemoryBytes: report.peakMemoryBytes,
    memoryLimitBytes: report.memoryLimitBytes,
    elapsedMs: report.elapsedMs,
    timeoutMs: report.timeoutMs,
    circuitState: report.circuitState,
    circuitOpen: report.circuitOpen,
    deepFormalCheck,
    ...(report.retryAfterMs !== undefined ? { retryAfterMs: report.retryAfterMs } : {}),
  };
}

async function runSandboxedFormalCheck(
  executor: SandboxedRolloutExecutor,
  params: {
    code: string;
    dialect: string;
    tenantId: string;
    rolloutId: string;
    deepFormalCheck: boolean;
    uri: string;
  },
): Promise<RolloutExecutionReport<FormalCertificateSummary>> {
  const { code, dialect, tenantId, rolloutId, deepFormalCheck, uri } = params;
  return executor.execute<FormalCertificateSummary>(
    {
      tenantId,
      rolloutId,
      inputPayload: code,
    },
    (ctx: SandboxContext) => {
      ctx.checkDeadline("formal-gate-start");
      const sourceBytes = Buffer.byteLength(code, "utf8");
      const baseFuel = Math.max(10, Math.ceil(code.length / 4));
      ctx.consumeFuel(baseFuel, "formal-gate-scan");

      const workspaceBytes = Math.max(1024, sourceBytes * 2);
      ctx.allocateBytes(workspaceBytes, "formal-gate-workspace");
      try {
        const cert = evaluateFormalGatesForCandidate(code, dialect);
        if (deepFormalCheck && cert.gate1GlrSyntax) {
          ctx.checkDeadline("deep-formal-check");
          const deepFuel = Math.max(25, Math.ceil(code.length / 2));
          ctx.consumeFuel(deepFuel, "deep-formal-check");

          const diagnostics = [...cert.diagnostics];
          let gate2 = cert.gate2QudvUnits;
          let gate3 = cert.gate3SmtFeasibility;
          let gate4 = cert.gate4DaeBalance;

          if (/\b(?:NaN|Infinity|-Infinity)\b/.test(code)) {
            gate3 = false;
            diagnostics.push("Gate 3 [Deep SMT]: Non-finite numeric literal (NaN/Infinity) detected.");
          }

          const hg = compileRelationalHypergraph({
            source: code,
            uri,
            dialect,
            formalCert: cert,
          });
          ctx.consumeFuel(Math.max(10, hg.tokenIds.length), "deep-hypergraph-check");
          if (
            hg.tokenIds.length !== hg.groupIds.length ||
            hg.tokenIds.length !== hg.relTypeIds.length ||
            hg.tokenIds.length !== hg.relSigns.length
          ) {
            gate4 = false;
            diagnostics.push("Gate 4 [Deep Hypergraph]: Relational hypergraph column alignment mismatch.");
          }

          if (dialect.trim().toLowerCase() === "modelica" && /\bequation\b/.test(code) && !/\bextends\b/.test(code)) {
            const varDecls = code.match(/^\s*(?:Real|Integer|Boolean)\s+[A-Za-z_]\w*/gm) ?? [];
            const eqBody = code.slice(code.indexOf("equation"));
            const eqLines = eqBody
              .split(";")
              .map((s) => s.trim())
              .filter((s) => s.includes("=") && !s.startsWith("end ") && !s.startsWith("//"));
            const connectLines = eqBody.match(/\bconnect\s*\(/g) ?? [];
            if (varDecls.length > 0 && eqLines.length + connectLines.length < varDecls.length) {
              gate4 = false;
              diagnostics.push(
                `Gate 4 [Deep DAE Balance]: Under-constrained system (${eqLines.length + connectLines.length} equations for ${varDecls.length} variables).`,
              );
            }
          }

          return {
            ...cert,
            gate2QudvUnits: gate2,
            gate3SmtFeasibility: gate3,
            gate4DaeBalance: gate4,
            diagnostics,
          };
        }
        return cert;
      } finally {
        ctx.releaseBytes(workspaceBytes, "formal-gate-workspace");
      }
    },
  );
}

export interface ChallengeDbRow {
  id: number;
  post_id: number | null;
  created_by: number | null;
  challenge_type: RlhfChallengeType;
  dialect: string;
  title: string;
  prompt: string;
  source_code: string | null;
  delta_t_trigger: number | null;
  is_honeypot: number;
  gold_answer_json: string | null;
  ai_governance_json: string;
  status: string;
  campaign_id: number | null;
  priority_score: number;
  consensus_status: ConsensusStatus;
  winning_candidate_id: number | null;
  adjudicated_by: number | null;
  adjudication_notes: string | null;
  skip_count: number;
  flag_count: number;
  created_at: string;
  updated_at: string;
}

export interface CampaignDbRow {
  id: number;
  slug: string;
  title: string;
  description: string;
  dialect: string;
  challenge_type: string;
  target_annotations: number;
  completed_annotations: number;
  consensus_min_votes: number;
  consensus_agreement_threshold: number;
  bounty_points: number;
  status: string;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

interface CandidateDbRow {
  id: number;
  challenge_id: number;
  label: string;
  code: string;
  dialect: string;
  artifact_id: string | null;
  formal_cert_json: string;
  m_init: number;
  token_count: number;
  hypergraph_groups_json: string;
  created_at: string;
}

interface AnnotationDbRow {
  id: number;
  challenge_id: number;
  user_id: number;
  preferred_candidate_id: number | null;
  preference_outcome: "candidate" | "tie" | "both_bad";
  rationale_tags_json: string;
  notes: string;
  fixed_code: string | null;
  fixed_formal_cert_json: string | null;
  hypergraph_overrides_json: string | null;
  weight: number;
  honeypot_passed: number | null;
  created_at: string;
}

interface ReputationDbRow {
  user_id: number;
  domain: string;
  trust_score: number;
  total_annotations: number;
  honeypot_hits: number;
  honeypot_misses: number;
  verified_fixes: number;
  updated_at: string;
}

export interface SetDominanceSummary {
  hasFormalDominance: boolean;
  dominantCandidateId: number | null;
  alignedWithVotes: boolean;
  formalConflict: boolean;
}

export interface ConsensusEvaluationResult {
  status: ConsensusStatus;
  winningCandidateId: number | null;
  annotationCount: number;
  consensusMinVotes: number;
  agreementThreshold: number;
  agreementRatio: number;
  setDominance: SetDominanceSummary;
}

/**
 * Idempotently ensures Migration 0012 tables & columns exist on `database.db`,
 * matching `0012_annotation_campaigns_and_consensus.ts` so routes work seamlessly
 * both before and after migration registration.
 */
export function ensureAnnotationCampaignSchema(database: LibraryDatabase): void {
  database.db.exec(`
    CREATE TABLE IF NOT EXISTS rlhf_campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      dialect TEXT NOT NULL DEFAULT 'polyglot',
      challenge_type TEXT NOT NULL DEFAULT 'pairwise_arena'
        CHECK (challenge_type IN ('pairwise_arena', 'fix_it_bounty', 'tolerance_labeling', 'mixed')),
      target_annotations INTEGER NOT NULL DEFAULT 50,
      completed_annotations INTEGER NOT NULL DEFAULT 0,
      consensus_min_votes INTEGER NOT NULL DEFAULT 3,
      consensus_agreement_threshold REAL NOT NULL DEFAULT 0.75,
      bounty_points INTEGER NOT NULL DEFAULT 10,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('draft', 'active', 'paused', 'completed', 'archived')),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_rlhf_campaigns_status ON rlhf_campaigns(status, dialect);
    CREATE INDEX IF NOT EXISTS idx_rlhf_campaigns_slug ON rlhf_campaigns(slug);

    CREATE TABLE IF NOT EXISTS rlhf_challenge_skips (
      challenge_id INTEGER NOT NULL REFERENCES rlhf_challenges(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason TEXT NOT NULL DEFAULT '',
      is_flag INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (challenge_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_rlhf_challenge_skips_user ON rlhf_challenge_skips(user_id);
    CREATE INDEX IF NOT EXISTS idx_rlhf_challenge_skips_flag ON rlhf_challenge_skips(challenge_id, is_flag);
  `);

  const existingCols = new Set(
    (database.db.prepare("PRAGMA table_info(rlhf_challenges)").all() as { name: string }[]).map((r) => r.name),
  );
  const columnsToAdd: [string, string][] = [
    ["campaign_id", "INTEGER REFERENCES rlhf_campaigns(id) ON DELETE SET NULL"],
    ["priority_score", "REAL NOT NULL DEFAULT 0.0"],
    ["consensus_status", "TEXT NOT NULL DEFAULT 'pending'"],
    ["winning_candidate_id", "INTEGER REFERENCES rlhf_candidates(id) ON DELETE SET NULL"],
    ["adjudicated_by", "INTEGER REFERENCES users(id) ON DELETE SET NULL"],
    ["adjudication_notes", "TEXT DEFAULT NULL"],
    ["skip_count", "INTEGER NOT NULL DEFAULT 0"],
    ["flag_count", "INTEGER NOT NULL DEFAULT 0"],
  ];
  for (const [col, def] of columnsToAdd) {
    if (!existingCols.has(col)) {
      database.db.exec(`ALTER TABLE rlhf_challenges ADD COLUMN ${col} ${def};`);
    }
  }
  database.db.exec(`
    CREATE INDEX IF NOT EXISTS idx_rlhf_challenges_priority
      ON rlhf_challenges(status, consensus_status, priority_score DESC);
    CREATE INDEX IF NOT EXISTS idx_rlhf_challenges_campaign
      ON rlhf_challenges(campaign_id, status);
  `);
}

export function passesAllFormalGates(cert: FormalCertificateSummary | null | undefined): boolean {
  if (!cert) return false;
  return Boolean(cert.gate1GlrSyntax && cert.gate2QudvUnits && cert.gate3SmtFeasibility && cert.gate4DaeBalance);
}

function countFailedFormalGates(cert: FormalCertificateSummary | null | undefined): number {
  if (!cert) return 4;
  let failed = 0;
  if (!cert.gate1GlrSyntax) failed++;
  if (!cert.gate2QudvUnits) failed++;
  if (!cert.gate3SmtFeasibility) failed++;
  if (!cert.gate4DaeBalance) failed++;
  return failed;
}

/**
 * Computes queue priority score for an RLHF challenge.
 * Strictly increases for wider Zonotope `deltaTTrigger` uncertainty and formal gate failures/ambiguity.
 */
export function computeChallengePriorityScore(params: {
  deltaTTrigger?: number | null | undefined;
  challengeType: RlhfChallengeType;
  candidates?: { formalCert: FormalCertificateSummary }[] | undefined;
  sourceCode?: string | null | undefined;
  dialect?: string | undefined;
}): number {
  let score = 1.0;

  if (typeof params.deltaTTrigger === "number" && Number.isFinite(params.deltaTTrigger) && params.deltaTTrigger > 0) {
    score += Math.min(20.0, params.deltaTTrigger * 5.0);
  }

  const cands = params.candidates ?? [];
  if (cands.length > 0) {
    let totalFailedGates = 0;
    let passingCount = 0;
    for (const c of cands) {
      const failed = countFailedFormalGates(c.formalCert);
      totalFailedGates += failed;
      if (failed === 0) passingCount++;
    }
    score += Math.min(8.0, totalFailedGates * 0.75);

    if (cands.length >= 2) {
      if (passingCount === 0) {
        // All candidates failed formal checks -> highest triage priority
        score += 2.5;
      } else if (passingCount === cands.length) {
        // Formal gates cannot distinguish candidates -> high epistemic uncertainty
        score += 1.5;
      }
    }
  } else if (params.sourceCode && params.sourceCode.trim()) {
    const srcCert = evaluateFormalGatesForCandidate(params.sourceCode, params.dialect ?? "modelica");
    const failed = countFailedFormalGates(srcCert);
    if (failed > 0) {
      score += 1.5 + failed * 0.5;
    }
  }

  return Number(score.toFixed(4));
}

/**
 * Deterministic per-(user, challenge) Fisher-Yates shuffle producing blind A/B presentation indices.
 */
export function computeBlindPresentationOrder(userId: number, challengeId: number, candidateCount: number): number[] {
  const order = Array.from({ length: Math.max(0, candidateCount) }, (_, idx) => idx);
  if (order.length <= 1) return order;

  for (let i = order.length - 1; i > 0; i--) {
    const digest = crypto.createHash("sha256").update(`blind-ab:v1:${userId}:${challengeId}:${i}`).digest();
    const rand = digest.readUInt32BE(0);
    const j = rand % (i + 1);
    const tmp = order[i]!;
    order[i] = order[j]!;
    order[j] = tmp;
  }
  return order;
}

/**
 * Set-Aware Consensus Engine:
 * Evaluates weighted annotator agreement alongside formal 4-gate Set Dominance.
 */
export function evaluateSetAwareConsensus(params: {
  challenge: ChallengeDbRow;
  candidates: CandidateDbRow[];
  annotations: AnnotationDbRow[];
  consensusMinVotes: number;
  agreementThreshold: number;
}): ConsensusEvaluationResult {
  const { challenge, candidates, annotations, consensusMinVotes, agreementThreshold } = params;
  const annotationCount = annotations.length;

  // Determine Formal Set Dominance across candidates
  const passingCandidates = candidates.filter((c) =>
    passesAllFormalGates(safeJsonParse<FormalCertificateSummary | null>(c.formal_cert_json, null)),
  );
  const failingCandidates = candidates.filter(
    (c) => !passesAllFormalGates(safeJsonParse<FormalCertificateSummary | null>(c.formal_cert_json, null)),
  );
  const hasFormalDominance = passingCandidates.length === 1 && failingCandidates.length >= 1;
  const dominantCandidateId = hasFormalDominance ? passingCandidates[0]!.id : null;

  if (challenge.challenge_type === "pairwise_arena" && candidates.length >= 2) {
    const candidateWeights = new Map<number, number>();
    let tieWeight = 0;
    let bothBadWeight = 0;
    let totalWeight = 0;

    for (const a of annotations) {
      const w = typeof a.weight === "number" && Number.isFinite(a.weight) && a.weight > 0 ? a.weight : 1.0;
      totalWeight += w;
      if (a.preference_outcome === "tie") {
        tieWeight += w;
      } else if (a.preference_outcome === "both_bad") {
        bothBadWeight += w;
      } else if (a.preferred_candidate_id != null) {
        candidateWeights.set(a.preferred_candidate_id, (candidateWeights.get(a.preferred_candidate_id) ?? 0) + w);
      }
    }

    const ranked = [...candidates].sort((a, b) => {
      const diff = (candidateWeights.get(b.id) ?? 0) - (candidateWeights.get(a.id) ?? 0);
      return diff !== 0 ? diff : a.id - b.id;
    });
    const topCand = ranked[0]!;
    const secondCand = ranked[1];
    const topWeight = candidateWeights.get(topCand.id) ?? 0;
    const secondWeight = secondCand ? (candidateWeights.get(secondCand.id) ?? 0) : 0;

    const hasClearLeader =
      topWeight > 0 && topWeight > secondWeight && topWeight > tieWeight && topWeight > bothBadWeight;
    const agreementRatio = hasClearLeader && totalWeight > 0 ? topWeight / totalWeight : 0;

    const alignedWithVotes = Boolean(hasFormalDominance && hasClearLeader && topCand.id === dominantCandidateId);
    const formalConflict = Boolean(hasFormalDominance && hasClearLeader && topCand.id !== dominantCandidateId);

    if (annotationCount < consensusMinVotes) {
      return {
        status: "pending",
        winningCandidateId: null,
        annotationCount,
        consensusMinVotes,
        agreementThreshold,
        agreementRatio: Number(agreementRatio.toFixed(4)),
        setDominance: {
          hasFormalDominance,
          dominantCandidateId,
          alignedWithVotes,
          formalConflict,
        },
      };
    }

    if (hasClearLeader && agreementRatio >= agreementThreshold && !formalConflict) {
      return {
        status: "consensus_reached",
        winningCandidateId: topCand.id,
        annotationCount,
        consensusMinVotes,
        agreementThreshold,
        agreementRatio: Number(agreementRatio.toFixed(4)),
        setDominance: {
          hasFormalDominance,
          dominantCandidateId,
          alignedWithVotes,
          formalConflict,
        },
      };
    }

    return {
      status: "needs_adjudication",
      winningCandidateId: null,
      annotationCount,
      consensusMinVotes,
      agreementThreshold,
      agreementRatio: Number(agreementRatio.toFixed(4)),
      setDominance: {
        hasFormalDominance,
        dominantCandidateId,
        alignedWithVotes,
        formalConflict,
      },
    };
  }

  // Non-pairwise challenges (`fix_it_bounty`, `tolerance_labeling`)
  let validWeight = 0;
  let totalWeight = 0;
  for (const a of annotations) {
    const w = typeof a.weight === "number" && Number.isFinite(a.weight) && a.weight > 0 ? a.weight : 1.0;
    totalWeight += w;
    if (challenge.challenge_type === "fix_it_bounty") {
      const cert = safeJsonParse<FormalCertificateSummary | null>(a.fixed_formal_cert_json, null);
      if (a.fixed_code && passesAllFormalGates(cert)) validWeight += w;
    } else {
      const overrides = safeJsonParse<HypergraphTokenOverride[]>(a.hypergraph_overrides_json, []);
      if (overrides.length > 0) validWeight += w;
    }
  }
  const agreementRatio = totalWeight > 0 ? validWeight / totalWeight : 0;

  if (annotationCount < consensusMinVotes) {
    return {
      status: "pending",
      winningCandidateId: null,
      annotationCount,
      consensusMinVotes,
      agreementThreshold,
      agreementRatio: Number(agreementRatio.toFixed(4)),
      setDominance: {
        hasFormalDominance: false,
        dominantCandidateId: null,
        alignedWithVotes: false,
        formalConflict: false,
      },
    };
  }

  return {
    status: agreementRatio >= agreementThreshold ? "consensus_reached" : "needs_adjudication",
    winningCandidateId: null,
    annotationCount,
    consensusMinVotes,
    agreementThreshold,
    agreementRatio: Number(agreementRatio.toFixed(4)),
    setDominance: {
      hasFormalDominance: false,
      dominantCandidateId: null,
      alignedWithVotes: false,
      formalConflict: false,
    },
  };
}

export function slugifyCampaignTitle(input: string): string {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return cleaned || `campaign-${Date.now()}`;
}

export function rlhfArenaRouter(
  database: LibraryDatabase,
  options?: { sandboxExecutor?: SandboxedRolloutExecutor | undefined },
): Router {
  const router = createRouter();
  const sandboxExecutor = options?.sandboxExecutor ?? rlhfSandboxExecutor;

  // Ensure Migration 0012 tables & columns exist idempotently
  ensureAnnotationCampaignSchema(database);

  /**
   * GET /api/v1/rlhf/queue/next
   * Returns the next highest-priority open, unannotated, unskipped challenge for the current user,
   * with deterministic per-(user, challenge) blind randomized `presentationOrder` hiding raw labels.
   */
  router.get("/queue/next", requireAuth, (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const dialect = typeof req.query["dialect"] === "string" ? req.query["dialect"].trim().toLowerCase() : undefined;
      const challengeType =
        typeof req.query["challengeType"] === "string" ? req.query["challengeType"].trim() : undefined;
      const rawCampaignId = req.query["campaignId"];
      const campaignId =
        typeof rawCampaignId === "string" && /^\d+$/.test(rawCampaignId.trim())
          ? Number(rawCampaignId.trim())
          : undefined;

      const where: string[] = [
        "c.status = 'open'",
        "(c.consensus_status IS NULL OR c.consensus_status = 'pending')",
        "NOT EXISTS (SELECT 1 FROM rlhf_annotations a WHERE a.challenge_id = c.id AND a.user_id = ?)",
        "NOT EXISTS (SELECT 1 FROM rlhf_challenge_skips s WHERE s.challenge_id = c.id AND s.user_id = ?)",
      ];
      const params: unknown[] = [userId, userId];

      if (dialect) {
        where.push("c.dialect = ?");
        params.push(dialect);
      }
      if (campaignId !== undefined) {
        where.push("c.campaign_id = ?");
        params.push(campaignId);
      }
      if (challengeType && VALID_CHALLENGE_TYPES.has(challengeType as RlhfChallengeType)) {
        where.push("c.challenge_type = ?");
        params.push(challengeType);
      }

      const whereSql = where.join(" AND ");
      const countRow = database.db
        .prepare(`SELECT COUNT(*) AS cnt FROM rlhf_challenges c WHERE ${whereSql}`)
        .get(...params) as { cnt: number };
      const remainingCount = Number(countRow?.cnt ?? 0);

      if (remainingCount === 0) {
        return res.json({
          challenge: null,
          presentationOrder: [],
          remainingCount: 0,
        });
      }

      const row = database.db
        .prepare(
          `SELECT c.*
           FROM rlhf_challenges c
           WHERE ${whereSql}
           ORDER BY c.priority_score DESC, COALESCE(c.delta_t_trigger, 0) DESC, c.created_at ASC, c.id ASC
           LIMIT 1`,
        )
        .get(...params) as ChallengeDbRow;

      const candRows = database.db
        .prepare(`SELECT * FROM rlhf_candidates WHERE challenge_id = ? ORDER BY id ASC`)
        .all(row.id) as CandidateDbRow[];

      const presentationOrder = computeBlindPresentationOrder(userId, row.id, candRows.length);

      const blindCandidates = presentationOrder.map((origIdx, slotIdx) => {
        const cand = candRows[origIdx]!;
        const blindLabel = `Option ${slotIdx + 1}`;
        const hypergraph = compileRelationalHypergraph({
          source: cand.code,
          uri: `rlhf://challenge/${row.id}/blind/${slotIdx + 1}.${cand.dialect}`,
          dialect: cand.dialect,
        });
        return {
          id: cand.id,
          slotIndex: slotIdx,
          blindLabel,
          label: blindLabel,
          code: cand.code,
          dialect: cand.dialect,
          artifactId: cand.artifact_id,
          mInit: cand.m_init,
          tokenCount: cand.token_count,
          formalCert: safeJsonParse<FormalCertificateSummary | null>(cand.formal_cert_json, null),
          hypergraph,
        };
      });

      const sourceHypergraph = row.source_code
        ? compileRelationalHypergraph({
            source: row.source_code,
            uri: `rlhf://challenge/${row.id}/source.${row.dialect}`,
            dialect: row.dialect,
          })
        : null;

      return res.json({
        challenge: {
          id: row.id,
          postId: row.post_id,
          campaignId: row.campaign_id,
          createdBy: row.created_by,
          challengeType: row.challenge_type,
          dialect: row.dialect,
          title: row.title,
          prompt: row.prompt,
          sourceCode: row.source_code,
          sourceHypergraph,
          deltaTTrigger: row.delta_t_trigger,
          priorityScore: row.priority_score,
          consensusStatus: row.consensus_status,
          status: row.status,
          skipCount: row.skip_count,
          flagCount: row.flag_count,
          blindMode: true,
          presentationOrder,
          candidates: blindCandidates,
          createdAt: row.created_at,
        },
        presentationOrder,
        remainingCount,
      });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to fetch next RLHF queue challenge") });
    }
  });

  /**
   * GET /api/v1/rlhf/challenges
   * List open/resolved RLHF annotation challenges with candidate formal badges & vote counts.
   */
  router.get("/challenges", optionalAuth, (req: Request, res: Response) => {
    try {
      const dialect = typeof req.query["dialect"] === "string" ? req.query["dialect"].trim().toLowerCase() : undefined;
      const challengeType =
        typeof req.query["challengeType"] === "string" ? req.query["challengeType"].trim() : undefined;
      const status = typeof req.query["status"] === "string" ? req.query["status"].trim() : "open";
      const consensusStatus =
        typeof req.query["consensusStatus"] === "string" ? req.query["consensusStatus"].trim() : undefined;
      const rawCampaignId = req.query["campaignId"];
      const campaignId =
        typeof rawCampaignId === "string" && /^\d+$/.test(rawCampaignId.trim())
          ? Number(rawCampaignId.trim())
          : undefined;
      const limit = Math.min(100, Math.max(1, Number(req.query["limit"] ?? 25) || 25));

      const where: string[] = [];
      const params: unknown[] = [];
      if (status && status !== "all") {
        where.push("c.status = ?");
        params.push(status);
      }
      if (dialect) {
        where.push("c.dialect = ?");
        params.push(dialect);
      }
      if (challengeType && VALID_CHALLENGE_TYPES.has(challengeType as RlhfChallengeType)) {
        where.push("c.challenge_type = ?");
        params.push(challengeType);
      }
      if (campaignId !== undefined) {
        where.push("c.campaign_id = ?");
        params.push(campaignId);
      }
      if (consensusStatus) {
        where.push("c.consensus_status = ?");
        params.push(consensusStatus);
      }

      const sql = `
        SELECT c.*,
          (SELECT COUNT(*) FROM rlhf_annotations a WHERE a.challenge_id = c.id) AS annotation_count
        FROM rlhf_challenges c
        ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY c.priority_score DESC, c.created_at DESC, c.id DESC
        LIMIT ?
      `;
      const rows = database.db.prepare(sql).all(...params, limit) as (ChallengeDbRow & {
        annotation_count: number;
      })[];

      const candStmt = database.db.prepare(`SELECT * FROM rlhf_candidates WHERE challenge_id = ? ORDER BY id ASC`);
      const items = rows.map((row) => {
        const candidates = (candStmt.all(row.id) as CandidateDbRow[]).map((cand) => ({
          id: cand.id,
          label: cand.label,
          dialect: cand.dialect,
          artifactId: cand.artifact_id,
          mInit: cand.m_init,
          tokenCount: cand.token_count,
          formalCert: safeJsonParse<FormalCertificateSummary | null>(cand.formal_cert_json, null),
        }));
        return {
          id: row.id,
          postId: row.post_id,
          campaignId: row.campaign_id,
          createdBy: row.created_by,
          challengeType: row.challenge_type,
          dialect: row.dialect,
          title: row.title,
          prompt: row.prompt,
          deltaTTrigger: row.delta_t_trigger,
          priorityScore: row.priority_score,
          consensusStatus: row.consensus_status,
          winningCandidateId: row.winning_candidate_id,
          skipCount: row.skip_count,
          flagCount: row.flag_count,
          status: row.status,
          annotationCount: row.annotation_count,
          aiGovernance: safeJsonParse<AiGovernancePolicy>(row.ai_governance_json, {
            allowRag: true,
            allowPretrain: false,
            allowPosttrain: true,
            tenantScope: "public",
          }),
          candidates,
          createdAt: row.created_at,
        };
      });

      return res.json({ challenges: items, total: items.length });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to process RLHF arena request") });
    }
  });

  /**
   * GET /api/v1/rlhf/challenges/:id
   * Fetch full challenge details for the Split-View Embedded Ansatz Annotator.
   */
  router.get("/challenges/:id", optionalAuth, (req: Request, res: Response) => {
    try {
      const challengeId = Number(req.params["id"]);
      if (!Number.isInteger(challengeId) || challengeId <= 0) {
        return res.status(400).json({ error: "Invalid challenge ID." });
      }

      const row = database.db.prepare(`SELECT * FROM rlhf_challenges WHERE id = ?`).get(challengeId) as
        ChallengeDbRow | undefined;
      if (!row) {
        return res.status(404).json({ error: "RLHF challenge not found." });
      }

      const candRows = database.db
        .prepare(`SELECT * FROM rlhf_candidates WHERE challenge_id = ? ORDER BY id ASC`)
        .all(challengeId) as CandidateDbRow[];

      const annRows = database.db
        .prepare(`SELECT * FROM rlhf_annotations WHERE challenge_id = ?`)
        .all(challengeId) as AnnotationDbRow[];

      // Aggregate reputation-weighted votes per candidate
      const weightedVotes: Record<number, number> = {};
      let tieWeight = 0;
      let bothBadWeight = 0;
      for (const a of annRows) {
        if (a.preference_outcome === "tie") {
          tieWeight += a.weight;
        } else if (a.preference_outcome === "both_bad") {
          bothBadWeight += a.weight;
        } else if (a.preferred_candidate_id != null) {
          weightedVotes[a.preferred_candidate_id] = (weightedVotes[a.preferred_candidate_id] ?? 0) + a.weight;
        }
      }

      const candidates = candRows.map((cand) => {
        const hypergraph = compileRelationalHypergraph({
          source: cand.code,
          uri: `rlhf://challenge/${challengeId}/candidate/${cand.label}.${cand.dialect}`,
          dialect: cand.dialect,
        });
        return {
          id: cand.id,
          label: cand.label,
          code: cand.code,
          dialect: cand.dialect,
          artifactId: cand.artifact_id,
          mInit: cand.m_init,
          tokenCount: cand.token_count,
          formalCert: safeJsonParse<FormalCertificateSummary | null>(cand.formal_cert_json, null),
          weightedVotes: Number((weightedVotes[cand.id] ?? 0).toFixed(3)),
          hypergraph,
        };
      });

      const myAnnotation = req.user?.id ? annRows.find((a) => a.user_id === req.user!.id) : undefined;

      const sourceHypergraph = row.source_code
        ? compileRelationalHypergraph({
            source: row.source_code,
            uri: `rlhf://challenge/${challengeId}/source.${row.dialect}`,
            dialect: row.dialect,
          })
        : null;

      return res.json({
        challenge: {
          id: row.id,
          postId: row.post_id,
          campaignId: row.campaign_id,
          createdBy: row.created_by,
          challengeType: row.challenge_type,
          dialect: row.dialect,
          title: row.title,
          prompt: row.prompt,
          sourceCode: row.source_code,
          sourceHypergraph,
          deltaTTrigger: row.delta_t_trigger,
          priorityScore: row.priority_score,
          consensusStatus: row.consensus_status,
          winningCandidateId: row.winning_candidate_id,
          adjudicatedBy: row.adjudicated_by,
          adjudicationNotes: row.adjudication_notes,
          skipCount: row.skip_count,
          flagCount: row.flag_count,
          status: row.status,
          aiGovernance: safeJsonParse<AiGovernancePolicy>(row.ai_governance_json, {
            allowRag: true,
            allowPretrain: false,
            allowPosttrain: true,
            tenantScope: "public",
          }),
          candidates,
          stats: {
            totalAnnotations: annRows.length,
            tieWeight: Number(tieWeight.toFixed(3)),
            bothBadWeight: Number(bothBadWeight.toFixed(3)),
          },
          myAnnotation: myAnnotation
            ? {
                preferredCandidateId: myAnnotation.preferred_candidate_id,
                preferenceOutcome: myAnnotation.preference_outcome,
                rationaleTags: safeJsonParse<string[]>(myAnnotation.rationale_tags_json, []),
                notes: myAnnotation.notes,
                fixedCode: myAnnotation.fixed_code,
                hypergraphOverrides: safeJsonParse<HypergraphTokenOverride[] | null>(
                  myAnnotation.hypergraph_overrides_json,
                  null,
                ),
              }
            : null,
          createdAt: row.created_at,
        },
      });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to process RLHF arena request") });
    }
  });

  /**
   * POST /api/v1/rlhf/challenges
   * Create an RLHF annotation challenge (pairwise arena, fix-it bounty, or tolerance labeling),
   * automatically computing 4-column hypergraph `m_init`, Zonotope/gate-aware `priority_score`,
   * and running 4-gate formal verification inside the fuel/memory/timeout-bounded RLVR sandbox.
   */
  router.post("/challenges", requireAuth, async (req: Request, res: Response) => {
    try {
      const body = req.body as {
        postId?: number | null | undefined;
        campaignId?: number | null | undefined;
        challengeType?: string | undefined;
        dialect?: string | undefined;
        title?: string | undefined;
        prompt?: string | undefined;
        sourceCode?: string | undefined;
        deltaTTrigger?: number | undefined;
        isHoneypot?: boolean | undefined;
        goldAnswer?: { preferredLabel?: string | undefined } | undefined;
        aiGovernance?: AiGovernancePolicy | undefined;
        deepFormalCheck?: boolean | undefined;
        candidates?: { label?: string; code?: string; dialect?: string; artifactId?: string | number }[] | undefined;
      };

      const challengeType = (body.challengeType ?? "pairwise_arena") as RlhfChallengeType;
      if (!VALID_CHALLENGE_TYPES.has(challengeType)) {
        return res.status(400).json({ error: `Invalid challengeType '${String(body.challengeType)}'.` });
      }
      const title = typeof body.title === "string" ? body.title.trim() : "";
      const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
      const dialect =
        typeof body.dialect === "string" && body.dialect.trim() ? body.dialect.trim().toLowerCase() : "modelica";
      if (!title || !prompt) {
        return res.status(400).json({ error: "Both 'title' and 'prompt' are required." });
      }

      let campaignId: number | null = null;
      if (body.campaignId !== undefined && body.campaignId !== null) {
        const parsedCampaignId = Number(body.campaignId);
        if (!Number.isInteger(parsedCampaignId) || parsedCampaignId <= 0) {
          return res.status(400).json({ error: "Invalid campaignId." });
        }
        const campExists = database.db.prepare(`SELECT id FROM rlhf_campaigns WHERE id = ?`).get(parsedCampaignId) as
          { id: number } | undefined;
        if (!campExists) {
          return res.status(404).json({ error: `Campaign #${parsedCampaignId} not found.` });
        }
        campaignId = parsedCampaignId;
      }

      const rawCandidates = Array.isArray(body.candidates) ? body.candidates : [];
      if (challengeType === "pairwise_arena" && rawCandidates.length < 2) {
        return res.status(400).json({ error: "pairwise_arena challenges require at least 2 candidates." });
      }

      const governance: AiGovernancePolicy = {
        allowRag: body.aiGovernance?.allowRag ?? true,
        allowPretrain: body.aiGovernance?.allowPretrain ?? false,
        allowPosttrain: body.aiGovernance?.allowPosttrain ?? true,
        tenantScope: body.aiGovernance?.tenantScope ?? "public",
        ...(body.aiGovernance?.license ? { license: body.aiGovernance.license } : {}),
      };

      const tenantId = `user:${req.user!.id}`;
      const deepFormalCheck = Boolean(body.deepFormalCheck);

      // Run sandboxed formal gate verification for every untrusted candidate before opening DB transaction
      const verifiedCandidates: {
        label: string;
        candCode: string;
        candDialect: string;
        artifactId: string | null;
        cert: FormalCertificateSummary;
        sandboxTelemetry: RlhfSandboxTelemetry;
      }[] = [];

      for (let idx = 0; idx < rawCandidates.length; idx++) {
        const cand = rawCandidates[idx]!;
        const label = (cand.label && cand.label.trim()) || String.fromCharCode(65 + idx);
        const candCode = typeof cand.code === "string" ? cand.code : "";
        const candDialect = (cand.dialect && cand.dialect.trim().toLowerCase()) || dialect;
        const report = await runSandboxedFormalCheck(sandboxExecutor, {
          code: candCode,
          dialect: candDialect,
          tenantId,
          rolloutId: `rlhf-cand-${req.user!.id}-${Date.now()}-${idx}`,
          deepFormalCheck,
          uri: `rlhf://challenge/pending/candidate/${label}.${candDialect}`,
        });
        const sandboxTelemetry = toSandboxTelemetry(report, deepFormalCheck);
        if (!report.ok || !report.value) {
          if (report.status === "circuit-open" || report.circuitOpen) {
            if (report.retryAfterMs !== undefined) {
              res.setHeader("Retry-After", String(Math.max(1, Math.ceil(report.retryAfterMs / 1000))));
            }
            return res.status(429).json({
              error: report.error ?? "Sandbox anti-DoS circuit breaker is open for this tenant.",
              retryAfterMs: report.retryAfterMs,
              sandboxTelemetry,
            });
          }
          return res.status(422).json({
            error: report.error ?? `Candidate '${label}' exceeded sandbox verification limits.`,
            sandboxTelemetry,
          });
        }
        verifiedCandidates.push({
          label,
          candCode,
          candDialect,
          artifactId: cand.artifactId != null ? String(cand.artifactId) : null,
          cert: report.value,
          sandboxTelemetry,
        });
      }

      const deltaTTrigger =
        typeof body.deltaTTrigger === "number" && Number.isFinite(body.deltaTTrigger) ? body.deltaTTrigger : null;
      const priorityScore = computeChallengePriorityScore({
        deltaTTrigger,
        challengeType,
        candidates: verifiedCandidates.map((vc) => ({ formalCert: vc.cert })),
        sourceCode: body.sourceCode ?? null,
        dialect,
      });

      const insertChallenge = database.db.prepare(`
        INSERT INTO rlhf_challenges (
          post_id, campaign_id, created_by, challenge_type, dialect, title, prompt,
          source_code, delta_t_trigger, priority_score, consensus_status,
          is_honeypot, gold_answer_json, ai_governance_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
      `);

      const insertCandidate = database.db.prepare(`
        INSERT INTO rlhf_candidates (
          challenge_id, label, code, dialect, artifact_id,
          formal_cert_json, m_init, token_count, hypergraph_groups_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      let createdChallengeId = 0;
      const createdCandidates: {
        id: number;
        label: string;
        mInit: number;
        tokenCount: number;
        formalCert: FormalCertificateSummary;
        sandboxTelemetry: RlhfSandboxTelemetry;
      }[] = [];

      database.db.transaction(() => {
        const info = insertChallenge.run(
          body.postId ?? null,
          campaignId,
          req.user!.id,
          challengeType,
          dialect,
          title,
          prompt,
          body.sourceCode ?? null,
          deltaTTrigger,
          priorityScore,
          body.isHoneypot ? 1 : 0,
          body.goldAnswer ? JSON.stringify(body.goldAnswer) : null,
          JSON.stringify(governance),
        );
        createdChallengeId = Number(info.lastInsertRowid);

        for (const vc of verifiedCandidates) {
          const hg = compileRelationalHypergraph({
            source: vc.candCode,
            uri: `rlhf://challenge/${createdChallengeId}/candidate/${vc.label}.${vc.candDialect}`,
            dialect: vc.candDialect,
            formalCert: vc.cert,
          });
          const candInfo = insertCandidate.run(
            createdChallengeId,
            vc.label,
            vc.candCode,
            vc.candDialect,
            vc.artifactId,
            JSON.stringify(vc.cert),
            hg.mInit,
            hg.tokenIds.length,
            JSON.stringify(hg.groups),
          );
          createdCandidates.push({
            id: Number(candInfo.lastInsertRowid),
            label: vc.label,
            mInit: hg.mInit,
            tokenCount: hg.tokenIds.length,
            formalCert: vc.cert,
            sandboxTelemetry: vc.sandboxTelemetry,
          });
        }
      })();

      return res.status(201).json({
        id: createdChallengeId,
        campaignId,
        challengeType,
        dialect,
        title,
        priorityScore,
        consensusStatus: "pending",
        candidates: createdCandidates,
      });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to process RLHF arena request") });
    }
  });

  /**
   * POST /api/v1/rlhf/challenges/:id/skip-or-flag
   * Records a user skip or flag on a challenge and atomically updates `skip_count` / `flag_count`.
   */
  router.post("/challenges/:id/skip-or-flag", requireAuth, (req: Request, res: Response) => {
    try {
      const challengeId = Number(req.params["id"]);
      if (!Number.isInteger(challengeId) || challengeId <= 0) {
        return res.status(400).json({ error: "Invalid challenge ID." });
      }

      const challenge = database.db.prepare(`SELECT id FROM rlhf_challenges WHERE id = ?`).get(challengeId) as
        { id: number } | undefined;
      if (!challenge) {
        return res.status(404).json({ error: "RLHF challenge not found." });
      }

      const body = (req.body ?? {}) as {
        reason?: unknown;
        isFlag?: unknown;
        flag?: unknown;
      };
      const isFlag = Boolean(body.isFlag ?? body.flag);
      const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";

      let skipCount = 0;
      let flagCount = 0;
      database.db.transaction(() => {
        database.db
          .prepare(
            `
            INSERT INTO rlhf_challenge_skips (challenge_id, user_id, reason, is_flag)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(challenge_id, user_id) DO UPDATE SET
              reason = excluded.reason,
              is_flag = excluded.is_flag,
              created_at = datetime('now')
            `,
          )
          .run(challengeId, req.user!.id, reason, isFlag ? 1 : 0);

        const counts = database.db
          .prepare(
            `
            SELECT
              SUM(CASE WHEN is_flag = 0 THEN 1 ELSE 0 END) AS skip_cnt,
              SUM(CASE WHEN is_flag = 1 THEN 1 ELSE 0 END) AS flag_cnt
            FROM rlhf_challenge_skips
            WHERE challenge_id = ?
            `,
          )
          .get(challengeId) as { skip_cnt: number | null; flag_cnt: number | null };

        skipCount = Number(counts?.skip_cnt ?? 0);
        flagCount = Number(counts?.flag_cnt ?? 0);

        database.db
          .prepare(
            `UPDATE rlhf_challenges
             SET skip_count = ?, flag_count = ?, updated_at = datetime('now')
             WHERE id = ?`,
          )
          .run(skipCount, flagCount, challengeId);
      })();

      return res.json({
        success: true,
        challengeId,
        isFlag,
        reason,
        skipCount,
        flagCount,
      });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to record skip/flag on RLHF challenge") });
    }
  });

  /**
   * POST /api/v1/rlhf/challenges/:id/annotate
   * Submit a pairwise preference, verified Fix-It patch, or relational `group_id`/tolerance override.
   * Automatically verifies Fix-It patches inside the RLVR sandbox, grades honeypots, and updates domain annotator reputation.
   */
  router.post("/challenges/:id/annotate", requireAuth, async (req: Request, res: Response) => {
    try {
      const challengeId = Number(req.params["id"]);
      if (!Number.isInteger(challengeId) || challengeId <= 0) {
        return res.status(400).json({ error: "Invalid challenge ID." });
      }

      const challenge = database.db.prepare(`SELECT * FROM rlhf_challenges WHERE id = ?`).get(challengeId) as
        ChallengeDbRow | undefined;
      if (!challenge) {
        return res.status(404).json({ error: "RLHF challenge not found." });
      }

      const body = req.body as {
        preferredCandidateId?: number | null | undefined;
        preferenceOutcome?: "candidate" | "tie" | "both_bad" | undefined;
        rationaleTags?: string[] | undefined;
        notes?: string | undefined;
        fixedCode?: string | undefined;
        deepFormalCheck?: boolean | undefined;
        hypergraphOverrides?: HypergraphTokenOverride[] | undefined;
      };

      const outcome = body.preferenceOutcome ?? "candidate";
      if (outcome !== "candidate" && outcome !== "tie" && outcome !== "both_bad") {
        return res.status(400).json({ error: "Invalid preferenceOutcome." });
      }

      // Verify candidate belongs to challenge when pairwise voting
      let preferredCandidate: CandidateDbRow | undefined;
      if (challenge.challenge_type === "pairwise_arena" && outcome === "candidate") {
        if (!body.preferredCandidateId) {
          return res.status(400).json({ error: "preferredCandidateId is required for pairwise preference." });
        }
        preferredCandidate = database.db
          .prepare(`SELECT * FROM rlhf_candidates WHERE id = ? AND challenge_id = ?`)
          .get(body.preferredCandidateId, challengeId) as CandidateDbRow | undefined;
        if (!preferredCandidate) {
          return res.status(400).json({ error: "Selected candidate does not belong to this challenge." });
        }
      }

      // Sandboxed formal gate verification for Fix-It Bounty patches
      let fixedCert: FormalCertificateSummary | null = null;
      let fixItSandboxTelemetry: RlhfSandboxTelemetry | undefined;
      let computeCreditsAwarded: number | undefined;
      let updatedCreditBalance: number | undefined;
      if (challenge.challenge_type === "fix_it_bounty") {
        if (typeof body.fixedCode !== "string" || !body.fixedCode.trim()) {
          return res.status(400).json({ error: "fixedCode is required for fix_it_bounty submissions." });
        }
        const deepFormalCheck = Boolean(body.deepFormalCheck);
        const tenantId = `user:${req.user!.id}`;
        const report = await runSandboxedFormalCheck(sandboxExecutor, {
          code: body.fixedCode,
          dialect: challenge.dialect,
          tenantId,
          rolloutId: `rlhf-fixit-${challengeId}-${req.user!.id}-${Date.now()}`,
          deepFormalCheck,
          uri: `rlhf://challenge/${challengeId}/fixit/${req.user!.id}.${challenge.dialect}`,
        });
        fixItSandboxTelemetry = toSandboxTelemetry(report, deepFormalCheck);
        if (!report.ok || !report.value) {
          if (report.status === "circuit-open" || report.circuitOpen) {
            if (report.retryAfterMs !== undefined) {
              res.setHeader("Retry-After", String(Math.max(1, Math.ceil(report.retryAfterMs / 1000))));
            }
            return res.status(429).json({
              error: report.error ?? "Sandbox anti-DoS circuit breaker is open for this tenant.",
              retryAfterMs: report.retryAfterMs,
              sandboxTelemetry: fixItSandboxTelemetry,
            });
          }
          return res.status(422).json({
            error: report.error ?? "Submitted Fix-It patch exceeded sandbox verification limits.",
            sandboxTelemetry: fixItSandboxTelemetry,
          });
        }
        fixedCert = report.value;
        const passedAllGates =
          fixedCert.gate1GlrSyntax &&
          fixedCert.gate2QudvUnits &&
          fixedCert.gate3SmtFeasibility &&
          fixedCert.gate4DaeBalance;
        if (!passedAllGates) {
          return res.status(422).json({
            error: "Submitted Fix-It patch failed formal verification gates.",
            formalCert: fixedCert,
            sandboxTelemetry: fixItSandboxTelemetry,
          });
        }

        // Prevent double-granting credits if the same user already submitted a verified fix for this bounty
        const priorVerified = database.db
          .prepare(`SELECT fixed_formal_cert_json FROM rlhf_annotations WHERE challenge_id = ? AND user_id = ?`)
          .get(challengeId, req.user!.id) as { fixed_formal_cert_json: string | null } | undefined;
        const alreadyRewarded = Boolean(priorVerified?.fixed_formal_cert_json);
        computeCreditsAwarded = alreadyRewarded ? 0 : deepFormalCheck ? 50 : 25;
      }

      // Validate tolerance / group_id overrides on tolerance_labeling challenges
      let previewMInit: number | undefined;
      if (Array.isArray(body.hypergraphOverrides) && body.hypergraphOverrides.length > 0) {
        const baseSource = challenge.source_code ?? preferredCandidate?.code ?? "";
        if (baseSource) {
          const baseHg = compileRelationalHypergraph({
            source: baseSource,
            uri: `rlhf://challenge/${challengeId}/source.${challenge.dialect}`,
            dialect: challenge.dialect,
          });
          const updatedHg = applyHypergraphOverrides(baseHg, body.hypergraphOverrides);
          previewMInit = updatedHg.mInit;
        }
      }

      // Fetch current annotator trust score for weighting
      const repRow = database.db
        .prepare(`SELECT * FROM rlhf_annotator_reputation WHERE user_id = ? AND domain = ?`)
        .get(req.user!.id, challenge.dialect) as ReputationDbRow | undefined;
      let trustScore = repRow?.trust_score ?? 1.0;

      // Evaluate hidden honeypot accuracy if applicable
      let honeypotPassed: number | null = null;
      if (challenge.is_honeypot === 1 && challenge.gold_answer_json) {
        const gold = safeJsonParse<{ preferredLabel?: string }>(challenge.gold_answer_json, {});
        if (gold.preferredLabel && preferredCandidate) {
          const hit = preferredCandidate.label === gold.preferredLabel;
          honeypotPassed = hit ? 1 : 0;
          trustScore = hit
            ? Math.min(3.0, Number((trustScore + 0.15).toFixed(3)))
            : Math.max(0.2, Number((trustScore - 0.35).toFixed(3)));
        }
      }

      const rationaleTags = Array.isArray(body.rationaleTags)
        ? body.rationaleTags.filter((t): t is string => typeof t === "string").slice(0, 12)
        : [];

      let consensusResult: ConsensusEvaluationResult | undefined;

      database.db.transaction(() => {
        database.db
          .prepare(
            `
            INSERT INTO rlhf_annotations (
              challenge_id, user_id, preferred_candidate_id, preference_outcome,
              rationale_tags_json, notes, fixed_code, fixed_formal_cert_json,
              hypergraph_overrides_json, weight, honeypot_passed
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(challenge_id, user_id) DO UPDATE SET
              preferred_candidate_id = excluded.preferred_candidate_id,
              preference_outcome = excluded.preference_outcome,
              rationale_tags_json = excluded.rationale_tags_json,
              notes = excluded.notes,
              fixed_code = excluded.fixed_code,
              fixed_formal_cert_json = excluded.fixed_formal_cert_json,
              hypergraph_overrides_json = excluded.hypergraph_overrides_json,
              weight = excluded.weight,
              honeypot_passed = excluded.honeypot_passed
          `,
          )
          .run(
            challengeId,
            req.user!.id,
            preferredCandidate?.id ?? null,
            outcome,
            JSON.stringify(rationaleTags),
            typeof body.notes === "string" ? body.notes.slice(0, 2000) : "",
            body.fixedCode ?? null,
            fixedCert ? JSON.stringify(fixedCert) : null,
            body.hypergraphOverrides ? JSON.stringify(body.hypergraphOverrides) : null,
            trustScore,
            honeypotPassed,
          );

        database.db
          .prepare(
            `
            INSERT INTO rlhf_annotator_reputation (
              user_id, domain, trust_score, total_annotations,
              honeypot_hits, honeypot_misses, verified_fixes
            ) VALUES (?, ?, ?, 1, ?, ?, ?)
            ON CONFLICT(user_id, domain) DO UPDATE SET
              trust_score = excluded.trust_score,
              total_annotations = rlhf_annotator_reputation.total_annotations + 1,
              honeypot_hits = rlhf_annotator_reputation.honeypot_hits + excluded.honeypot_hits,
              honeypot_misses = rlhf_annotator_reputation.honeypot_misses + excluded.honeypot_misses,
              verified_fixes = rlhf_annotator_reputation.verified_fixes + excluded.verified_fixes,
              updated_at = datetime('now')
          `,
          )
          .run(
            req.user!.id,
            challenge.dialect,
            trustScore,
            honeypotPassed === 1 ? 1 : 0,
            honeypotPassed === 0 ? 1 : 0,
            fixedCert ? 1 : 0,
          );

        // Update campaign annotation progress when linked to a campaign
        let consensusMinVotes = 3;
        let agreementThreshold = 0.75;
        if (challenge.campaign_id != null) {
          const camp = database.db
            .prepare(`SELECT consensus_min_votes, consensus_agreement_threshold FROM rlhf_campaigns WHERE id = ?`)
            .get(challenge.campaign_id) as
            { consensus_min_votes: number; consensus_agreement_threshold: number } | undefined;
          if (camp) {
            consensusMinVotes = Math.max(1, Number(camp.consensus_min_votes) || 3);
            agreementThreshold =
              Number(camp.consensus_agreement_threshold) > 0 && Number(camp.consensus_agreement_threshold) <= 1
                ? Number(camp.consensus_agreement_threshold)
                : 0.75;
          }
          database.db
            .prepare(
              `UPDATE rlhf_campaigns
               SET completed_annotations = (
                 SELECT COUNT(*) FROM rlhf_annotations a
                 INNER JOIN rlhf_challenges c ON c.id = a.challenge_id
                 WHERE c.campaign_id = ?
               ),
               updated_at = datetime('now')
               WHERE id = ?`,
            )
            .run(challenge.campaign_id, challenge.campaign_id);
        }

        // Automatic Set-Aware Consensus Engine (skip honeypots & already adjudicated challenges)
        if (challenge.is_honeypot !== 1 && challenge.consensus_status !== "adjudicated") {
          const allAnns = database.db
            .prepare(`SELECT * FROM rlhf_annotations WHERE challenge_id = ?`)
            .all(challengeId) as AnnotationDbRow[];
          const allCands = database.db
            .prepare(`SELECT * FROM rlhf_candidates WHERE challenge_id = ? ORDER BY id ASC`)
            .all(challengeId) as CandidateDbRow[];

          consensusResult = evaluateSetAwareConsensus({
            challenge,
            candidates: allCands,
            annotations: allAnns,
            consensusMinVotes,
            agreementThreshold,
          });

          if (consensusResult.status === "consensus_reached") {
            database.db
              .prepare(
                `UPDATE rlhf_challenges
                 SET consensus_status = 'consensus_reached',
                     winning_candidate_id = ?,
                     status = 'resolved',
                     updated_at = datetime('now')
                 WHERE id = ?`,
              )
              .run(consensusResult.winningCandidateId, challengeId);
          } else if (consensusResult.status === "needs_adjudication") {
            database.db
              .prepare(
                `UPDATE rlhf_challenges
                 SET consensus_status = 'needs_adjudication',
                     winning_candidate_id = NULL,
                     updated_at = datetime('now')
                 WHERE id = ?`,
              )
              .run(challengeId);
          }
        }
      })();

      let campaignBountySettlement: { settled: boolean; totalPointsAwarded: number; recipients: number } | undefined;
      if (consensusResult?.status === "consensus_reached") {
        try {
          campaignBountySettlement = settleCampaignBounty(database, challengeId, consensusResult.winningCandidateId);
        } catch {
          // Non-fatal bounty settlement
        }
      }

      if (computeCreditsAwarded && computeCreditsAwarded > 0 && typeof database.grantUserCredits === "function") {
        try {
          updatedCreditBalance = database.grantUserCredits(
            req.user!.id,
            computeCreditsAwarded,
            "rlhf_fix_it_bounty",
            `Verified Fix-It Bounty reward for challenge #${challengeId} (${challenge.dialect})`,
            {
              challengeId,
              dialect: challenge.dialect,
              deepFormalCheck: Boolean(body.deepFormalCheck),
              verifiedAtIso: fixedCert?.verifiedAtIso,
            },
          );
        } catch {
          // Keep verified Fix-It annotation response intact if wallet ledger is unavailable
        }
      }

      return res.json({
        success: true,
        challengeId,
        appliedWeight: trustScore,
        ...(consensusResult ? { consensus: consensusResult } : {}),
        ...(campaignBountySettlement?.settled ? { campaignBountySettlement } : {}),
        ...(fixedCert ? { formalCert: fixedCert } : {}),
        ...(fixItSandboxTelemetry ? { sandboxTelemetry: fixItSandboxTelemetry } : {}),
        ...(computeCreditsAwarded !== undefined ? { computeCreditsAwarded } : {}),
        ...(updatedCreditBalance !== undefined ? { creditBalance: updatedCreditBalance } : {}),
        ...(previewMInit !== undefined ? { updatedMInit: previewMInit } : {}),
      });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to process RLHF arena request") });
    }
  });

  /**
   * GET /api/v1/rlhf/adjudication
   * Lists tied/split or formal-conflict challenges awaiting reviewer adjudication.
   */
  router.get("/adjudication", optionalAuth, (req: Request, res: Response) => {
    try {
      const dialect = typeof req.query["dialect"] === "string" ? req.query["dialect"].trim().toLowerCase() : undefined;
      const rawCampaignId = req.query["campaignId"];
      const campaignId =
        typeof rawCampaignId === "string" && /^\d+$/.test(rawCampaignId.trim())
          ? Number(rawCampaignId.trim())
          : undefined;
      const limit = Math.min(100, Math.max(1, Number(req.query["limit"] ?? 50) || 50));

      const where: string[] = ["c.consensus_status = 'needs_adjudication'"];
      const params: unknown[] = [];
      if (dialect) {
        where.push("c.dialect = ?");
        params.push(dialect);
      }
      if (campaignId !== undefined) {
        where.push("c.campaign_id = ?");
        params.push(campaignId);
      }

      const rows = database.db
        .prepare(
          `SELECT c.*
           FROM rlhf_challenges c
           WHERE ${where.join(" AND ")}
           ORDER BY c.priority_score DESC, c.flag_count DESC, c.updated_at DESC, c.id DESC
           LIMIT ?`,
        )
        .all(...params, limit) as ChallengeDbRow[];

      const candStmt = database.db.prepare(`SELECT * FROM rlhf_candidates WHERE challenge_id = ? ORDER BY id ASC`);
      const annStmt = database.db.prepare(`SELECT * FROM rlhf_annotations WHERE challenge_id = ?`);

      const items = rows.map((row) => {
        const candRows = candStmt.all(row.id) as CandidateDbRow[];
        const annRows = annStmt.all(row.id) as AnnotationDbRow[];

        const weightedVotes = new Map<number, number>();
        const voteCounts = new Map<number, number>();
        let tieWeight = 0;
        let bothBadWeight = 0;
        for (const a of annRows) {
          if (a.preference_outcome === "tie") {
            tieWeight += a.weight;
          } else if (a.preference_outcome === "both_bad") {
            bothBadWeight += a.weight;
          } else if (a.preferred_candidate_id != null) {
            weightedVotes.set(a.preferred_candidate_id, (weightedVotes.get(a.preferred_candidate_id) ?? 0) + a.weight);
            voteCounts.set(a.preferred_candidate_id, (voteCounts.get(a.preferred_candidate_id) ?? 0) + 1);
          }
        }

        const consensusSummary = evaluateSetAwareConsensus({
          challenge: row,
          candidates: candRows,
          annotations: annRows,
          consensusMinVotes: Math.max(1, annRows.length),
          agreementThreshold: 0.75,
        });

        const candidates = candRows.map((cand) => ({
          id: cand.id,
          label: cand.label,
          code: cand.code,
          dialect: cand.dialect,
          artifactId: cand.artifact_id,
          mInit: cand.m_init,
          tokenCount: cand.token_count,
          formalCert: safeJsonParse<FormalCertificateSummary | null>(cand.formal_cert_json, null),
          weightedVotes: Number((weightedVotes.get(cand.id) ?? 0).toFixed(3)),
          voteCount: voteCounts.get(cand.id) ?? 0,
        }));

        return {
          id: row.id,
          campaignId: row.campaign_id,
          challengeType: row.challenge_type,
          dialect: row.dialect,
          title: row.title,
          prompt: row.prompt,
          deltaTTrigger: row.delta_t_trigger,
          priorityScore: row.priority_score,
          status: row.status,
          consensusStatus: row.consensus_status,
          skipCount: row.skip_count,
          flagCount: row.flag_count,
          candidates,
          voteSummary: {
            totalAnnotations: annRows.length,
            tieWeight: Number(tieWeight.toFixed(3)),
            bothBadWeight: Number(bothBadWeight.toFixed(3)),
            agreementRatio: consensusSummary.agreementRatio,
            setDominance: consensusSummary.setDominance,
          },
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
      });

      return res.json({ challenges: items, total: items.length });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to list adjudication queue") });
    }
  });

  /**
   * POST /api/v1/rlhf/challenges/:id/adjudicate
   * Records a reviewer's binding adjudication decision (`winningCandidateId` + `adjudicationNotes`),
   * transitioning `consensus_status = 'adjudicated'`.
   */
  router.post("/challenges/:id/adjudicate", requireAuth, (req: Request, res: Response) => {
    try {
      const challengeId = Number(req.params["id"]);
      if (!Number.isInteger(challengeId) || challengeId <= 0) {
        return res.status(400).json({ error: "Invalid challenge ID." });
      }

      const challenge = database.db.prepare(`SELECT * FROM rlhf_challenges WHERE id = ?`).get(challengeId) as
        ChallengeDbRow | undefined;
      if (!challenge) {
        return res.status(404).json({ error: "RLHF challenge not found." });
      }

      // Enforce domain_steward_roles RBAC when stewards are configured or in production
      if (!(req.user?.role === "admin" || req.user?.accountType === "admin" || req.user?.account_type === "admin")) {
        try {
          const totalStewardsRow = database.db
            .prepare(
              `SELECT COUNT(*) AS cnt FROM domain_steward_roles
               WHERE domain IN ('*', ?) AND role IN ('reviewer', 'steward')`,
            )
            .get(challenge.dialect) as { cnt: number };
          const hasConfiguredStewards = Number(totalStewardsRow?.cnt ?? 0) > 0;
          if (hasConfiguredStewards || process.env["NODE_ENV"] === "production") {
            const callerRole = database.db
              .prepare(
                `SELECT role FROM domain_steward_roles
                 WHERE user_id = ? AND domain IN ('*', ?) AND role IN ('reviewer', 'steward')
                 LIMIT 1`,
              )
              .get(req.user!.id, challenge.dialect) as { role: string } | undefined;
            if (!callerRole && challenge.created_by !== req.user!.id) {
              return res.status(403).json({
                error: `Domain reviewer or steward role is required to adjudicate '${challenge.dialect}' challenges.`,
              });
            }
          }
        } catch {
          // Table may not exist in isolated unit test DBs
        }
      }

      const body = (req.body ?? {}) as {
        winningCandidateId?: number | null | undefined;
        adjudicationNotes?: string | undefined;
        notes?: string | undefined;
        resolution?: "winner" | "archive" | "both_bad" | undefined;
      };

      const resolution = body.resolution ?? "winner";
      const adjudicationNotes =
        typeof body.adjudicationNotes === "string"
          ? body.adjudicationNotes.trim().slice(0, 2000)
          : typeof body.notes === "string"
            ? body.notes.trim().slice(0, 2000)
            : "";

      let winningCandidateId: number | null = null;
      if (resolution === "winner" && challenge.challenge_type === "pairwise_arena") {
        const parsedWinner = Number(body.winningCandidateId);
        if (!Number.isInteger(parsedWinner) || parsedWinner <= 0) {
          return res.status(400).json({ error: "winningCandidateId is required to adjudicate a pairwise challenge." });
        }
        const cand = database.db
          .prepare(`SELECT id FROM rlhf_candidates WHERE id = ? AND challenge_id = ?`)
          .get(parsedWinner, challengeId) as { id: number } | undefined;
        if (!cand) {
          return res.status(400).json({ error: "winningCandidateId does not belong to this challenge." });
        }
        winningCandidateId = cand.id;
      } else if (body.winningCandidateId != null) {
        const parsedWinner = Number(body.winningCandidateId);
        if (Number.isInteger(parsedWinner) && parsedWinner > 0) {
          const cand = database.db
            .prepare(`SELECT id FROM rlhf_candidates WHERE id = ? AND challenge_id = ?`)
            .get(parsedWinner, challengeId) as { id: number } | undefined;
          if (!cand) {
            return res.status(400).json({ error: "winningCandidateId does not belong to this challenge." });
          }
          winningCandidateId = cand.id;
        }
      }

      const nextStatus = resolution === "archive" || resolution === "both_bad" ? "archived" : "resolved";
      database.db
        .prepare(
          `UPDATE rlhf_challenges
           SET consensus_status = 'adjudicated',
               winning_candidate_id = ?,
               adjudicated_by = ?,
               adjudication_notes = ?,
               status = ?,
               updated_at = datetime('now')
           WHERE id = ?`,
        )
        .run(winningCandidateId, req.user!.id, adjudicationNotes, nextStatus, challengeId);

      let campaignBountySettlement: { settled: boolean; totalPointsAwarded: number; recipients: number } | undefined;
      if (nextStatus === "resolved") {
        try {
          campaignBountySettlement = settleCampaignBounty(database, challengeId, winningCandidateId);
        } catch {
          // Non-fatal bounty settlement
        }
      }

      return res.json({
        success: true,
        challengeId,
        consensusStatus: "adjudicated",
        status: nextStatus,
        winningCandidateId,
        adjudicatedBy: req.user!.id,
        adjudicationNotes,
        ...(campaignBountySettlement?.settled ? { campaignBountySettlement } : {}),
      });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to adjudicate RLHF challenge") });
    }
  });

  /**
   * GET /api/v1/rlhf/stewards
   * Lists domain steward/reviewer/release_manager RBAC assignments.
   */
  router.get("/stewards", optionalAuth, (req: Request, res: Response) => {
    try {
      const domain = typeof req.query["domain"] === "string" ? req.query["domain"].trim().toLowerCase() : undefined;
      const rows = domain
        ? database.db
            .prepare(`SELECT * FROM domain_steward_roles WHERE domain IN ('*', ?) ORDER BY created_at DESC`)
            .all(domain)
        : database.db.prepare(`SELECT * FROM domain_steward_roles ORDER BY created_at DESC`).all();
      return res.json({ stewards: rows, total: rows.length });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to list domain steward roles") });
    }
  });

  /**
   * POST /api/v1/rlhf/stewards
   * Grants a domain steward/reviewer/release_manager role (admin-only).
   */
  router.post("/stewards", requireAuth, (req: Request, res: Response) => {
    try {
      if (!(req.user?.role === "admin" || req.user?.accountType === "admin" || req.user?.account_type === "admin")) {
        return res.status(403).json({ error: "Administrator privileges required to grant domain steward roles." });
      }
      const body = (req.body ?? {}) as { userId?: number; domain?: string; role?: string };
      const targetUserId = Number(body.userId);
      const domain = typeof body.domain === "string" && body.domain.trim() ? body.domain.trim().toLowerCase() : "*";
      const role = typeof body.role === "string" ? body.role.trim() : "reviewer";
      if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
        return res.status(400).json({ error: "Valid userId is required." });
      }
      if (!["reviewer", "steward", "release_manager"].includes(role)) {
        return res.status(400).json({ error: "role must be reviewer, steward, or release_manager." });
      }
      database.db
        .prepare(
          `INSERT OR IGNORE INTO domain_steward_roles (user_id, domain, role, granted_by)
           VALUES (?, ?, ?, ?)`,
        )
        .run(targetUserId, domain, role, req.user.id);
      return res.status(201).json({ success: true, userId: targetUserId, domain, role });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to grant domain steward role") });
    }
  });

  /**
   * GET /api/v1/rlhf/campaigns
   * Lists annotation campaigns with live progress metrics.
   */
  router.get("/campaigns", optionalAuth, (req: Request, res: Response) => {
    try {
      const status = typeof req.query["status"] === "string" ? req.query["status"].trim() : undefined;
      const dialect = typeof req.query["dialect"] === "string" ? req.query["dialect"].trim().toLowerCase() : undefined;
      const limit = Math.min(100, Math.max(1, Number(req.query["limit"] ?? 50) || 50));

      const where: string[] = [];
      const params: unknown[] = [];
      if (status && status !== "all") {
        where.push("camp.status = ?");
        params.push(status);
      }
      if (dialect) {
        where.push("camp.dialect = ?");
        params.push(dialect);
      }

      const rows = database.db
        .prepare(
          `SELECT camp.*,
             (SELECT COUNT(*) FROM rlhf_challenges c WHERE c.campaign_id = camp.id) AS challenge_count,
             (SELECT COUNT(*) FROM rlhf_challenges c WHERE c.campaign_id = camp.id AND c.consensus_status IN ('consensus_reached', 'adjudicated')) AS resolved_challenge_count,
             (SELECT COUNT(*) FROM rlhf_challenges c WHERE c.campaign_id = camp.id AND c.consensus_status = 'needs_adjudication') AS needs_adjudication_count
           FROM rlhf_campaigns camp
           ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
           ORDER BY camp.created_at DESC, camp.id DESC
           LIMIT ?`,
        )
        .all(...params, limit) as (CampaignDbRow & {
        challenge_count: number;
        resolved_challenge_count: number;
        needs_adjudication_count: number;
      })[];

      const campaigns = rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        title: r.title,
        description: r.description,
        dialect: r.dialect,
        challengeType: r.challenge_type,
        targetAnnotations: r.target_annotations,
        completedAnnotations: r.completed_annotations,
        consensusMinVotes: r.consensus_min_votes,
        consensusAgreementThreshold: r.consensus_agreement_threshold,
        bountyPoints: r.bounty_points,
        status: r.status,
        createdBy: r.created_by,
        challengeCount: r.challenge_count,
        resolvedChallengeCount: r.resolved_challenge_count,
        needsAdjudicationCount: r.needs_adjudication_count,
        progressPct:
          r.target_annotations > 0
            ? Math.min(100, Number(((r.completed_annotations / r.target_annotations) * 100).toFixed(1)))
            : 0,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));

      return res.json({ campaigns, total: campaigns.length });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to list RLHF campaigns") });
    }
  });

  /**
   * POST /api/v1/rlhf/campaigns
   * Creates a structured RLHF annotation campaign sprint.
   */
  router.post("/campaigns", requireAuth, (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as {
        slug?: unknown;
        title?: unknown;
        description?: unknown;
        dialect?: unknown;
        challengeType?: unknown;
        targetAnnotations?: unknown;
        consensusMinVotes?: unknown;
        consensusAgreementThreshold?: unknown;
        bountyPoints?: unknown;
        status?: unknown;
      };

      const title = typeof body.title === "string" ? body.title.trim() : "";
      if (!title) {
        return res.status(400).json({ error: "Campaign title is required." });
      }

      const rawSlug = typeof body.slug === "string" && body.slug.trim() ? body.slug.trim() : title;
      const slug = slugifyCampaignTitle(rawSlug);
      const description = typeof body.description === "string" ? body.description.trim().slice(0, 2000) : "";
      const dialect =
        typeof body.dialect === "string" && body.dialect.trim() ? body.dialect.trim().toLowerCase() : "polyglot";
      const challengeType =
        typeof body.challengeType === "string" && VALID_CAMPAIGN_CHALLENGE_TYPES.has(body.challengeType.trim())
          ? body.challengeType.trim()
          : "pairwise_arena";
      const status =
        typeof body.status === "string" && VALID_CAMPAIGN_STATUSES.has(body.status.trim())
          ? body.status.trim()
          : "active";

      const targetAnnotations =
        typeof body.targetAnnotations === "number" &&
        Number.isFinite(body.targetAnnotations) &&
        body.targetAnnotations >= 1
          ? Math.floor(body.targetAnnotations)
          : 50;
      const consensusMinVotes =
        typeof body.consensusMinVotes === "number" &&
        Number.isFinite(body.consensusMinVotes) &&
        body.consensusMinVotes >= 1
          ? Math.floor(body.consensusMinVotes)
          : 3;
      const consensusAgreementThreshold =
        typeof body.consensusAgreementThreshold === "number" &&
        Number.isFinite(body.consensusAgreementThreshold) &&
        body.consensusAgreementThreshold > 0 &&
        body.consensusAgreementThreshold <= 1
          ? body.consensusAgreementThreshold
          : 0.75;
      const bountyPoints =
        typeof body.bountyPoints === "number" && Number.isFinite(body.bountyPoints) && body.bountyPoints >= 0
          ? Math.floor(body.bountyPoints)
          : 10;

      const existing = database.db.prepare(`SELECT id FROM rlhf_campaigns WHERE slug = ?`).get(slug) as
        { id: number } | undefined;
      if (existing) {
        return res.status(409).json({ error: `Campaign with slug '${slug}' already exists.` });
      }

      const info = database.db
        .prepare(
          `INSERT INTO rlhf_campaigns (
             slug, title, description, dialect, challenge_type,
             target_annotations, consensus_min_votes, consensus_agreement_threshold,
             bounty_points, status, created_by
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          slug,
          title,
          description,
          dialect,
          challengeType,
          targetAnnotations,
          consensusMinVotes,
          consensusAgreementThreshold,
          bountyPoints,
          status,
          req.user!.id,
        );

      const created = database.db
        .prepare(`SELECT * FROM rlhf_campaigns WHERE id = ?`)
        .get(info.lastInsertRowid) as CampaignDbRow;

      const campaign = {
        id: created.id,
        slug: created.slug,
        title: created.title,
        description: created.description,
        dialect: created.dialect,
        challengeType: created.challenge_type,
        targetAnnotations: created.target_annotations,
        completedAnnotations: created.completed_annotations,
        consensusMinVotes: created.consensus_min_votes,
        consensusAgreementThreshold: created.consensus_agreement_threshold,
        bountyPoints: created.bounty_points,
        status: created.status,
        createdBy: created.created_by,
        createdAt: created.created_at,
        updatedAt: created.updated_at,
      };

      return res.status(201).json({ id: created.id, campaign });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to create RLHF campaign") });
    }
  });

  /**
   * GET /api/v1/rlhf/leaderboard
   * Annotator leaderboard ranked by domain `trust_score`, `verified_fixes`, `total_annotations`, and honeypot accuracy.
   */
  router.get("/leaderboard", optionalAuth, (req: Request, res: Response) => {
    try {
      const rawDomain =
        typeof req.query["domain"] === "string"
          ? req.query["domain"].trim().toLowerCase()
          : typeof req.query["dialect"] === "string"
            ? req.query["dialect"].trim().toLowerCase()
            : undefined;
      const domain = rawDomain && rawDomain !== "all" ? rawDomain : undefined;
      const limit = Math.min(100, Math.max(1, Number(req.query["limit"] ?? 50) || 50));

      interface LeaderboardRawRow {
        user_id: number;
        username: string;
        display_name: string | null;
        domain: string;
        trust_score: number;
        total_annotations: number;
        honeypot_hits: number;
        honeypot_misses: number;
        verified_fixes: number;
      }

      const rawRows = (
        domain
          ? database.db
              .prepare(
                `SELECT r.user_id, u.username, u.display_name, r.domain,
                        r.trust_score, r.total_annotations, r.honeypot_hits, r.honeypot_misses, r.verified_fixes
                 FROM rlhf_annotator_reputation r
                 INNER JOIN users u ON u.id = r.user_id
                 WHERE r.domain = ?`,
              )
              .all(domain)
          : database.db
              .prepare(
                `SELECT r.user_id, u.username, u.display_name,
                        'all' AS domain,
                        CASE WHEN SUM(r.total_annotations) > 0
                          THEN SUM(r.trust_score * r.total_annotations) / SUM(r.total_annotations)
                          ELSE AVG(r.trust_score)
                        END AS trust_score,
                        SUM(r.total_annotations) AS total_annotations,
                        SUM(r.honeypot_hits) AS honeypot_hits,
                        SUM(r.honeypot_misses) AS honeypot_misses,
                        SUM(r.verified_fixes) AS verified_fixes
                 FROM rlhf_annotator_reputation r
                 INNER JOIN users u ON u.id = r.user_id
                 GROUP BY r.user_id, u.username, u.display_name`,
              )
              .all()
      ) as LeaderboardRawRow[];

      const ranked = rawRows
        .map((r) => {
          const honeypotTotal = r.honeypot_hits + r.honeypot_misses;
          const honeypotAccuracy = honeypotTotal > 0 ? Number((r.honeypot_hits / honeypotTotal).toFixed(4)) : null;
          const trustScore = Number(Number(r.trust_score).toFixed(4));
          const compositeScore = Number(
            (trustScore * 100 + r.verified_fixes * 25 + r.total_annotations * 2 + (honeypotAccuracy ?? 0) * 50).toFixed(
              2,
            ),
          );
          return {
            userId: r.user_id,
            username: r.username,
            displayName: r.display_name ?? r.username,
            domain: r.domain,
            trustScore,
            verifiedFixes: r.verified_fixes,
            totalAnnotations: r.total_annotations,
            honeypotHits: r.honeypot_hits,
            honeypotMisses: r.honeypot_misses,
            honeypotAccuracy,
            score: compositeScore,
          };
        })
        .sort((a, b) => {
          if (b.trustScore !== a.trustScore) return b.trustScore - a.trustScore;
          if (b.verifiedFixes !== a.verifiedFixes) return b.verifiedFixes - a.verifiedFixes;
          const accA = a.honeypotAccuracy ?? -1;
          const accB = b.honeypotAccuracy ?? -1;
          if (accB !== accA) return accB - accA;
          if (b.totalAnnotations !== a.totalAnnotations) return b.totalAnnotations - a.totalAnnotations;
          return a.userId - b.userId;
        })
        .slice(0, limit)
        .map((entry, idx) => ({
          rank: idx + 1,
          ...entry,
        }));

      return res.json({
        domain: domain ?? "all",
        leaderboard: ranked,
        total: ranked.length,
      });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to compute annotator leaderboard") });
    }
  });

  /**
   * GET /api/v1/rlhf/reputation/me
   */
  router.get("/reputation/me", requireAuth, (req: Request, res: Response) => {
    try {
      const rows = database.db
        .prepare(`SELECT * FROM rlhf_annotator_reputation WHERE user_id = ? ORDER BY total_annotations DESC`)
        .all(req.user!.id) as ReputationDbRow[];
      return res.json({ reputation: rows });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to process RLHF arena request") });
    }
  });

  /**
   * GET /api/v1/rlhf/export/dataset-posttrain
   * Exports consensus-verified DPO preferences, SFT Fix-It patches, and 4-column hypergraph
   * overrides as a reproducible `dataset-posttrain` package snapshot (respecting aiGovernance).
   */
  router.get("/export/dataset-posttrain", optionalAuth, (req: Request, res: Response) => {
    try {
      const dialect = typeof req.query["dialect"] === "string" ? req.query["dialect"].trim().toLowerCase() : undefined;
      const format = req.query["format"] === "jsonl" ? "jsonl" : "json";

      const challenges = database.db
        .prepare(`SELECT * FROM rlhf_challenges ${dialect ? "WHERE dialect = ?" : ""} ORDER BY id ASC`)
        .all(...(dialect ? [dialect] : [])) as ChallengeDbRow[];

      const candStmt = database.db.prepare(`SELECT * FROM rlhf_candidates WHERE challenge_id = ? ORDER BY id ASC`);
      const annStmt = database.db.prepare(`SELECT * FROM rlhf_annotations WHERE challenge_id = ?`);

      const records: Record<string, unknown>[] = [];
      for (const ch of challenges) {
        if (ch.is_honeypot === 1) continue;
        const gov = safeJsonParse<AiGovernancePolicy>(ch.ai_governance_json, {
          allowRag: true,
          allowPretrain: false,
          allowPosttrain: true,
          tenantScope: "public",
        });
        if (!gov.allowPosttrain || gov.tenantScope !== "public") continue;

        const cands = candStmt.all(ch.id) as CandidateDbRow[];
        const anns = annStmt.all(ch.id) as AnnotationDbRow[];
        if (anns.length === 0 && ch.winning_candidate_id == null) continue;

        if (ch.challenge_type === "pairwise_arena" && cands.length >= 2) {
          const scores = new Map<number, number>();
          for (const a of anns) {
            if (a.preference_outcome === "candidate" && a.preferred_candidate_id != null) {
              scores.set(a.preferred_candidate_id, (scores.get(a.preferred_candidate_id) ?? 0) + a.weight);
            }
          }
          const ranked = [...cands].sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0));
          const explicitWinner =
            ch.winning_candidate_id != null ? cands.find((c) => c.id === ch.winning_candidate_id) : undefined;
          const chosen = explicitWinner ?? ranked[0]!;
          const rejected =
            ranked.find((c) => c.id !== chosen.id && c.id === ranked[ranked.length - 1]!.id) ??
            ranked.find((c) => c.id !== chosen.id)!;
          if (explicitWinner || (scores.get(chosen.id) ?? 0) > (scores.get(rejected.id) ?? 0)) {
            const chosenHg = compileRelationalHypergraph({
              source: chosen.code,
              uri: `dataset://rlhf/${ch.id}/chosen.${chosen.dialect}`,
              dialect: chosen.dialect,
            });
            records.push({
              kind: "dpo_preference",
              challengeId: ch.id,
              dialect: ch.dialect,
              prompt: ch.prompt,
              chosen: {
                code: chosen.code,
                formalCert: safeJsonParse(chosen.formal_cert_json, null),
                mInit: chosenHg.mInit,
                tokenIds: chosenHg.tokenIds,
                groupIds: chosenHg.groupIds,
                relTypeIds: chosenHg.relTypeIds,
                relSigns: chosenHg.relSigns,
              },
              rejected: {
                code: rejected.code,
                formalCert: safeJsonParse(rejected.formal_cert_json, null),
              },
              consensusWeight: Number((scores.get(chosen.id) ?? 0).toFixed(3)),
              consensusStatus: ch.consensus_status,
              annotationCount: anns.length,
            });
          }
        } else if (ch.challenge_type === "fix_it_bounty") {
          for (const a of anns) {
            if (!a.fixed_code) continue;
            const fixedHg = compileRelationalHypergraph({
              source: a.fixed_code,
              uri: `dataset://rlhf/${ch.id}/fix/${a.id}.${ch.dialect}`,
              dialect: ch.dialect,
            });
            records.push({
              kind: "sft_verified_fix",
              challengeId: ch.id,
              dialect: ch.dialect,
              prompt: ch.prompt,
              brokenSource: ch.source_code,
              verifiedFix: a.fixed_code,
              formalCert: safeJsonParse(a.fixed_formal_cert_json, null),
              mInit: fixedHg.mInit,
              tokenIds: fixedHg.tokenIds,
              groupIds: fixedHg.groupIds,
              relTypeIds: fixedHg.relTypeIds,
              relSigns: fixedHg.relSigns,
              annotatorWeight: a.weight,
            });
          }
        } else if (ch.challenge_type === "tolerance_labeling" && ch.source_code) {
          for (const a of anns) {
            const overrides = safeJsonParse<HypergraphTokenOverride[]>(a.hypergraph_overrides_json, []);
            if (overrides.length === 0) continue;
            const labeledHg = compileRelationalHypergraph({
              source: ch.source_code,
              uri: `dataset://rlhf/${ch.id}/tol/${a.id}.${ch.dialect}`,
              dialect: ch.dialect,
              overrides,
            });
            records.push({
              kind: "relational_hypergraph_annotation",
              challengeId: ch.id,
              dialect: ch.dialect,
              prompt: ch.prompt,
              source: ch.source_code,
              overrides,
              mInit: labeledHg.mInit,
              tokenIds: labeledHg.tokenIds,
              groupIds: labeledHg.groupIds,
              relTypeIds: labeledHg.relTypeIds,
              relSigns: labeledHg.relSigns,
              annotatorWeight: a.weight,
            });
          }
        }
      }

      if (format === "jsonl") {
        res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
        return res.send(records.map((r) => JSON.stringify(r)).join("\n"));
      }

      return res.json({
        manifest: {
          category: "dataset-posttrain",
          dialect: dialect ?? "polyglot",
          memoryBackend: "diskann",
          targetModelScale: "0.5B-1.5B",
          recordCount: records.length,
          exportedAtIso: new Date().toISOString(),
        },
        records,
      });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to process RLHF arena request") });
    }
  });

  return router;
}
