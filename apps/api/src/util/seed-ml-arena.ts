// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Idempotent Development Demo Seeder for the ML & Arena Environment
 * (`RLHF Arena`, `Datasets & Recipes`, `Model Hub`, `Training Runs`, `Vector Memory`,
 * `Leaderboards`, `Living Recipe Triggers`, and `Provenance / Attribution Royalties`).
 *
 * Runs automatically in local development & `dev:flagship` (`ALLOW_DEV_SEEDING=true`)
 * and on `POST /api/v1/dev/reset`. Never runs in production deployments.
 */

import { compileRelationalHypergraph } from "@modelscript/runtime";
import crypto from "node:crypto";
import path from "node:path";
import type { LibraryDatabase } from "../database.js";
import { signPromotionAttestationEd25519 } from "../routes/models-and-runs.js";
import { evaluateFormalGatesForCandidate } from "../routes/rlhf-arena.js";
import { compileDatasetShards } from "../services/dataset-compiler.js";
import { getOrCreateDiskAnnService, type MemoryModalityKind } from "../services/diskann-memory.js";
import { recordAttributionWeights, recordProvenanceNode } from "../services/provenance-attribution.js";

export interface SeedMlArenaResult {
  skipped: boolean;
  campaigns: number;
  challenges: number;
  shards: number;
  models: number;
  runs: number;
  triggers: number;
  memoryChunks: number;
  peers: number;
}

const MODELICA_THERMAL_A = `model ThermalRCNetwork
  parameter Real R_th(unit="K/W") = 1.8;
  parameter Real C_th(unit="J/K") = 420.0;
  parameter Real T_amb(unit="K") = 298.15;
  parameter Real Q_in(unit="W") = 45.0;
  Real T_core(start=298.15, unit="K");
equation
  C_th * der(T_core) = Q_in - (T_core - T_amb) / R_th;
end ThermalRCNetwork;`;

const MODELICA_THERMAL_B = `model ThermalRCNetwork
  parameter Real R_th(unit="") = 1.8;
  parameter Real C_th = 420.0;
  Real T_core(start=298.15);
equation
  C_th * der(T_core) = 45.0 - T_core / R_th;
end ThermalRCNetwork;`;

const MODELICA_BATTERY_TOL = `model BatteryCoolingPlate
  parameter Real R_th(unit="K/W") = 0.42;
  parameter Real C_cell(unit="J/K") = 850.0;
  parameter Real h_conv(unit="W/(m2.K)") = 65.0;
  parameter Real T_max(unit="K") = 333.15;
  parameter Real T_coolant(unit="K") = 295.15;
  Real T_cell(start=300.0, unit="K");
  Real Q_loss(unit="W");
equation
  Q_loss = (T_cell - T_coolant) / R_th + 0.08 * h_conv * (T_cell - T_coolant);
  C_cell * der(T_cell) = 120.0 - Q_loss;
end BatteryCoolingPlate;`;

const MODELICA_BROKEN_PENDULUM = `model UnderConstrainedPendulum
  parameter Real L(unit="m") = 1.2;
  parameter Real g(unit="m/s2") = 9.81;
  Real theta(start=0.4, unit="rad");
  Real omega(start=0.0, unit="rad/s");
equation
  // Missing equations: add der(theta) = omega; and der(omega) = -(g/L)*sin(theta);
end UnderConstrainedPendulum;`;

const MODELICA_PID_LOOP = `model ThermalPidLoop
  parameter Real Kp = 2.4;
  parameter Real Ti = 18.0;
  parameter Real T_ref(unit="K") = 320.0;
  parameter Real tau(unit="s") = 45.0;
  Real T(start=295.0, unit="K");
  Real e(unit="K");
  Real I_state(start=0.0);
  Real u;
equation
  e = T_ref - T;
  der(I_state) = e / Ti;
  u = Kp * (e + I_state);
  tau * der(T) + (T - 293.15) = 0.8 * u;
end ThermalPidLoop;`;

const MODELICA_HYDRAULIC_VALVE = `model HydraulicAccumulator
  parameter Real K_v = 0.015;
  parameter Real C_h = 2.2e-6;
  parameter Real P_supply(unit="Pa") = 6.0e6;
  Real P_load(start=1.0e6, unit="Pa");
  Real Q_flow(unit="m3/s");
equation
  Q_flow = K_v * (P_supply - P_load) * 1e-6;
  C_h * der(P_load) = Q_flow;
end HydraulicAccumulator;`;

const SCAD_BRACKET_VALID = `// Parametric Motor Mount Bracket with GD&T wall thickness
wall_thickness = 4.5;
bore_radius = 12.0;
plate_width = 64.0;
plate_depth = 48.0;

module motor_mount() {
  difference() {
    union() {
      cube([plate_width, plate_depth, wall_thickness], center=true);
      translate([0, 0, 12]) cylinder(h=24, r=bore_radius + wall_thickness, center=true, $fn=48);
    }
    translate([0, 0, 12]) cylinder(h=30, r=bore_radius, center=true, $fn=48);
  }
}
motor_mount();`;

const SCAD_BRACKET_INVALID = `// Faulty bracket: negative wall thickness violates Gate 3 SMT/CAD
wall_thickness = -2.0;
bore_radius = 12.0;
module faulty_mount() {
  cube([64, 48, 4], center=true);
}
faulty_mount();`;

const SCAD_ACTUATOR_ARM = `// Actuator Linkage Arm with Fillet Clearance
arm_length = 85.0;
arm_width = 16.0;
arm_thickness = 6.0;
pivot_radius = 5.0;

difference() {
  hull() {
    cylinder(h=arm_thickness, r=arm_width / 2, center=true, $fn=36);
    translate([arm_length, 0, 0]) cylinder(h=arm_thickness, r=arm_width / 2, center=true, $fn=36);
  }
  cylinder(h=arm_thickness + 2, r=pivot_radius, center=true, $fn=36);
  translate([arm_length, 0, 0]) cylinder(h=arm_thickness + 2, r=pivot_radius, center=true, $fn=36);
}`;

const SCAD_HEATSINK = `// Extruded Pin-Fin Heat Sink
base_w = 50.0;
base_d = 50.0;
base_h = 5.0;
fin_h = 18.0;
fin_r = 2.0;

union() {
  cube([base_w, base_d, base_h], center=true);
  for (x = [-16, 0, 16]) {
    for (y = [-16, 0, 16]) {
      translate([x, y, base_h / 2 + fin_h / 2]) cylinder(h=fin_h, r=fin_r, center=true, $fn=20);
    }
  }
}`;

const SPICE_BUCK_A = `* Synchronous Buck Converter with RC Snubber
Vin in 0 DC 24.0
Rsw in sw 0.08
L1 sw out 47u
C1 out 0 220u
Rsnub sw snub 12.0
Csnub snub 0 2.2n
Rload out 0 4.8
.tran 1u 2m
.end`;

const SPICE_BUCK_B = `* Buck Converter without Damping Snubber
Vin in 0 DC 24.0
Rsw in sw 0.12
L1 sw out 47u
C1 out 0 100u
Rload out 0 4.8
.tran 1u 2m
.end`;

const SYSML_BMS_SPEC = `package BatterySafetySystem {
  requirement ThermalEnvelope {
    doc /* Cell temperature shall remain below 333.15 K under +/-5% R_th perturbation. */
  }
  part def ThermalController {
    attribute maxTempK : Real = 333.15;
    attribute nominalGain : Real = 2.4;
  }
}`;

function getDemoUsers(database: LibraryDatabase): Array<{ id: number; username: string }> {
  const rows = database.db.prepare("SELECT id, username FROM users ORDER BY id ASC LIMIT 8").all() as Array<{
    id: number;
    username: string;
  }>;
  return rows;
}

export async function seedMlArenaDemoData(
  database: LibraryDatabase,
  storageDir: string,
  options?: { force?: boolean },
): Promise<SeedMlArenaResult> {
  const mlStorageDir = path.join(storageDir, "ml-memory");
  const force = Boolean(options?.force);

  const existingCampaigns = (database.db.prepare("SELECT COUNT(*) AS cnt FROM rlhf_campaigns").get() as { cnt: number })
    .cnt;
  const existingModels = (
    database.db.prepare("SELECT COUNT(*) AS cnt FROM model_registry_entries").get() as { cnt: number }
  ).cnt;
  const existingRuns = (database.db.prepare("SELECT COUNT(*) AS cnt FROM training_runs").get() as { cnt: number }).cnt;

  if (!force && existingCampaigns > 0 && existingModels > 0 && existingRuns > 0) {
    return {
      skipped: true,
      campaigns: 0,
      challenges: 0,
      shards: 0,
      models: 0,
      runs: 0,
      triggers: 0,
      memoryChunks: 0,
      peers: 0,
    };
  }

  const users = getDemoUsers(database);
  const adminUser = users.find((u) => u.username === "admin") ?? users[0];
  const primaryUserId = adminUser?.id ?? null;
  const annotatorIds = users.map((u) => u.id);

  // Ensure admin & top personas have domain steward RBAC roles for adjudication / release testing
  if (primaryUserId !== null) {
    const grantStmt = database.db.prepare(`
      INSERT OR IGNORE INTO domain_steward_roles (user_id, domain, role, granted_by)
      VALUES (?, ?, ?, ?)
    `);
    grantStmt.run(primaryUserId, "*", "steward", primaryUserId);
    grantStmt.run(primaryUserId, "*", "release_manager", primaryUserId);
    grantStmt.run(primaryUserId, "modelica", "reviewer", primaryUserId);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 1. RLHF Arena Campaigns, Challenges, Candidates, Votes & Reputation
  // ───────────────────────────────────────────────────────────────────────────
  let seededCampaigns = 0;
  let seededChallenges = 0;

  const insertCampaign = database.db.prepare(`
    INSERT OR IGNORE INTO rlhf_campaigns
      (slug, title, description, dialect, challenge_type, target_annotations, completed_annotations,
       consensus_min_votes, consensus_agreement_threshold, bounty_points, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const campaignDefs = [
    {
      slug: "thermal-dae-rlvr-sprint",
      title: "Modelica Thermal & PID Control RLVR Sprint",
      description:
        "Verify SI-unit consistency, DAE structural balance, and parameter coupling across thermal-fluid and PID feedback models.",
      dialect: "modelica",
      challengeType: "mixed",
      target: 40,
      completed: 18,
      minVotes: 3,
      threshold: 0.75,
      bounty: 25,
      status: "active",
    },
    {
      slug: "cad-gdt-tolerance-sprint",
      title: "OpenSCAD & STEP GD&T Tolerance Labeling",
      description:
        "Audit parametric wall-thickness clearance, lock invariant safety dimensions (group_id=0), and resolve CAD manifold conflicts.",
      dialect: "scad",
      challengeType: "tolerance_labeling",
      target: 30,
      completed: 14,
      minVotes: 3,
      threshold: 0.75,
      bounty: 20,
      status: "active",
    },
    {
      slug: "power-electronics-fixit",
      title: "SPICE & Power Converter Verification Sprint",
      description:
        "Compare switching snubber topologies and repair non-convergent transient decks for certified power-electronics SLMs.",
      dialect: "spice",
      challengeType: "pairwise_arena",
      target: 25,
      completed: 9,
      minVotes: 2,
      threshold: 0.7,
      bounty: 30,
      status: "active",
    },
  ];

  const campaignIdBySlug = new Map<string, number>();
  for (const c of campaignDefs) {
    const info = insertCampaign.run(
      c.slug,
      c.title,
      c.description,
      c.dialect,
      c.challengeType,
      c.target,
      c.completed,
      c.minVotes,
      c.threshold,
      c.bounty,
      c.status,
      primaryUserId,
    );
    if (info.changes > 0) seededCampaigns++;
    const row = database.db.prepare("SELECT id FROM rlhf_campaigns WHERE slug = ?").get(c.slug) as
      { id: number } | undefined;
    if (row) campaignIdBySlug.set(c.slug, row.id);
  }

  // Only insert demo challenges if table is currently empty (prevents duplicating challenges on restart)
  const existingChallengeCount = (
    database.db.prepare("SELECT COUNT(*) AS cnt FROM rlhf_challenges").get() as { cnt: number }
  ).cnt;

  if (existingChallengeCount === 0) {
    const insertChallenge = database.db.prepare(`
      INSERT INTO rlhf_challenges
        (created_by, challenge_type, dialect, title, prompt, source_code, delta_t_trigger,
         status, campaign_id, priority_score, consensus_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertCandidate = database.db.prepare(`
      INSERT INTO rlhf_candidates
        (challenge_id, label, code, dialect, formal_cert_json, m_init, token_count, hypergraph_groups_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertAnnotation = database.db.prepare(`
      INSERT OR IGNORE INTO rlhf_annotations
        (challenge_id, user_id, preferred_candidate_id, preference_outcome, rationale_tags_json, notes, weight)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const addCandidate = (challengeId: number, label: string, code: string, dialect: string): number => {
      const cert = evaluateFormalGatesForCandidate(code, dialect);
      const hg = compileRelationalHypergraph({
        source: code,
        uri: `rlhf://demo/${challengeId}/${label}.${dialect}`,
        dialect,
      });
      const res = insertCandidate.run(
        challengeId,
        label,
        code,
        dialect,
        JSON.stringify(cert),
        hg.mInit,
        hg.tokenIds.length,
        JSON.stringify(hg.groups),
      );
      return Number(res.lastInsertRowid);
    };

    // Challenge 1: Open Pairwise Arena (Modelica) — ready in queue
    const ch1 = Number(
      insertChallenge.run(
        primaryUserId,
        "pairwise_arena",
        "modelica",
        "RC Thermal Network with SI Units & Ambient Sink",
        "Compare the two generated Modelica RC thermal models. Prefer the candidate with complete QUDV SI units and valid ambient heat dissipation.",
        null,
        0.58,
        "open",
        campaignIdBySlug.get("thermal-dae-rlvr-sprint") ?? null,
        92.5,
        "pending",
      ).lastInsertRowid,
    );
    addCandidate(ch1, "A", MODELICA_THERMAL_A, "modelica");
    addCandidate(ch1, "B", MODELICA_THERMAL_B, "modelica");
    seededChallenges++;

    // Challenge 2: Needs Adjudication — Formal Set-Dominance Conflict (OpenSCAD)
    const ch2 = Number(
      insertChallenge.run(
        primaryUserId,
        "pairwise_arena",
        "scad",
        "Parametric Motor Mount Bracket Clearance",
        "Crowd votes favored Candidate B's brevity, but Candidate B violates Gate 3 (negative wall_thickness = -2.0). Adjudicate using formal set dominance.",
        null,
        0.64,
        "open",
        campaignIdBySlug.get("cad-gdt-tolerance-sprint") ?? null,
        96.0,
        "needs_adjudication",
      ).lastInsertRowid,
    );
    const ch2CandA = addCandidate(ch2, "A", SCAD_BRACKET_VALID, "scad");
    const ch2CandB = addCandidate(ch2, "B", SCAD_BRACKET_INVALID, "scad");
    if (annotatorIds[0]) {
      insertAnnotation.run(
        ch2,
        annotatorIds[0],
        ch2CandB,
        "candidate",
        JSON.stringify(["idiomatic-structure"]),
        "Compact sketch",
        1.1,
      );
    }
    if (annotatorIds[1]) {
      insertAnnotation.run(
        ch2,
        annotatorIds[1],
        ch2CandB,
        "candidate",
        JSON.stringify(["idiomatic-structure"]),
        "Short geometry",
        1.0,
      );
    }
    if (annotatorIds[2]) {
      insertAnnotation.run(
        ch2,
        annotatorIds[2],
        ch2CandA,
        "candidate",
        JSON.stringify(["better-manufacturability", "safer-bounds"]),
        "Valid positive wall thickness",
        1.2,
      );
    }
    seededChallenges++;

    // Challenge 3: Needs Adjudication — Split Vote (SPICE)
    const ch3 = Number(
      insertChallenge.run(
        primaryUserId,
        "pairwise_arena",
        "spice",
        "24V Synchronous Buck Converter Snubber Topology",
        "Compare switching node damping with vs without an RC snubber under 2ms transient startup.",
        null,
        0.49,
        "open",
        campaignIdBySlug.get("power-electronics-fixit") ?? null,
        84.0,
        "needs_adjudication",
      ).lastInsertRowid,
    );
    const ch3CandA = addCandidate(ch3, "A", SPICE_BUCK_A, "spice");
    const ch3CandB = addCandidate(ch3, "B", SPICE_BUCK_B, "spice");
    if (annotatorIds[0]) {
      insertAnnotation.run(
        ch3,
        annotatorIds[0],
        ch3CandA,
        "candidate",
        JSON.stringify(["safer-bounds"]),
        "RC snubber prevents ringing",
        1.2,
      );
    }
    if (annotatorIds[1]) {
      insertAnnotation.run(
        ch3,
        annotatorIds[1],
        ch3CandB,
        "candidate",
        JSON.stringify(["cleaner-dae"]),
        "Fewer components",
        1.15,
      );
    }
    seededChallenges++;

    // Challenge 4: Fix-It Bounty (Open in Queue)
    insertChallenge.run(
      primaryUserId,
      "fix_it_bounty",
      "modelica",
      "Repair Under-Constrained Pendulum DAE (Gate 4 Balance)",
      "The pendulum model declares states theta and omega without differential equations. Add the governing equations so all 4 formal gates pass.",
      MODELICA_BROKEN_PENDULUM,
      0.71,
      "open",
      campaignIdBySlug.get("thermal-dae-rlvr-sprint") ?? null,
      89.0,
      "pending",
    );
    seededChallenges++;

    // Challenge 5: Tolerance Labeling (Open in Queue)
    insertChallenge.run(
      primaryUserId,
      "tolerance_labeling",
      "modelica",
      "Battery Cooling Plate Parameter Coupling & Safety Lock",
      "Lock T_max (safety ceiling) to group_id = 0 and verify coupled perturbation generators for R_th, C_cell, and h_conv.",
      MODELICA_BATTERY_TOL,
      0.52,
      "open",
      campaignIdBySlug.get("thermal-dae-rlvr-sprint") ?? null,
      86.5,
      "pending",
    );
    seededChallenges++;

    // Challenge 6: Consensus Reached — Ready for Signed Post-Train Snapshot!
    const ch6 = Number(
      insertChallenge.run(
        primaryUserId,
        "pairwise_arena",
        "scad",
        "Actuator Linkage Arm Fillet & Pivot Clearance",
        "Certified preference pair ready for inclusion in the next Ed25519-signed dataset-posttrain snapshot.",
        SCAD_ACTUATOR_ARM,
        0.44,
        "resolved",
        campaignIdBySlug.get("cad-gdt-tolerance-sprint") ?? null,
        75.0,
        "consensus_reached",
      ).lastInsertRowid,
    );
    const ch6CandA = addCandidate(ch6, "A", SCAD_ACTUATOR_ARM, "scad");
    addCandidate(ch6, "B", SCAD_BRACKET_INVALID, "scad");
    database.db.prepare("UPDATE rlhf_challenges SET winning_candidate_id = ? WHERE id = ?").run(ch6CandA, ch6);
    if (annotatorIds[0]) {
      insertAnnotation.run(
        ch6,
        annotatorIds[0],
        ch6CandA,
        "candidate",
        JSON.stringify(["better-manufacturability", "tighter-tolerance"]),
        "Clean hull geometry",
        1.35,
      );
    }
    if (annotatorIds[1]) {
      insertAnnotation.run(
        ch6,
        annotatorIds[1],
        ch6CandA,
        "candidate",
        JSON.stringify(["safer-bounds"]),
        "All 4 gates pass",
        1.22,
      );
    }
    seededChallenges++;
  }

  // Seed annotator reputation / leaderboard scores across seeded users
  const upsertRep = database.db.prepare(`
    INSERT OR IGNORE INTO rlhf_annotator_reputation
      (user_id, domain, trust_score, total_annotations, honeypot_hits, honeypot_misses, verified_fixes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const repSpecs = [
    { domain: "modelica", trust: 1.44, total: 42, hits: 9, misses: 0, fixes: 14 },
    { domain: "scad", trust: 1.31, total: 31, hits: 7, misses: 1, fixes: 9 },
    { domain: "spice", trust: 1.22, total: 24, hits: 5, misses: 1, fixes: 7 },
    { domain: "sysml2", trust: 1.14, total: 19, hits: 4, misses: 0, fixes: 5 },
    { domain: "general", trust: 1.08, total: 15, hits: 3, misses: 1, fixes: 3 },
  ];
  for (let i = 0; i < Math.min(users.length, repSpecs.length); i++) {
    const u = users[i]!;
    const spec = repSpecs[i]!;
    upsertRep.run(u.id, spec.domain, spec.trust, spec.total, spec.hits, spec.misses, spec.fixes);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Compiled Dataset Shards & Leaderboard Training Recipes (Real JSONL on disk!)
  // ───────────────────────────────────────────────────────────────────────────
  let seededShards = 0;
  const existingShardCount = (
    database.db.prepare("SELECT COUNT(*) AS cnt FROM compiled_dataset_shards").get() as { cnt: number }
  ).cnt;

  const seededShardIds: string[] = [];
  if (existingShardCount === 0) {
    const compileJobs: Array<{
      recipeName: string;
      recipeVersion: string;
      datasetKind: "dataset-pretrain" | "dataset-posttrain" | "training-recipe";
      files: Array<{ uri: string; dialect: string; source: string }>;
      extraProvenance?: Record<string, unknown>;
    }> = [
      {
        recipeName: "@ansatz/modelica-thermal-pretrain",
        recipeVersion: "1.2.0",
        datasetKind: "dataset-pretrain",
        files: [
          { uri: "models/ThermalRCNetwork.mo", dialect: "modelica", source: MODELICA_THERMAL_A },
          { uri: "models/BatteryCoolingPlate.mo", dialect: "modelica", source: MODELICA_BATTERY_TOL },
          { uri: "models/ThermalPidLoop.mo", dialect: "modelica", source: MODELICA_PID_LOOP },
          { uri: "models/HydraulicAccumulator.mo", dialect: "modelica", source: MODELICA_HYDRAULIC_VALVE },
        ],
      },
      {
        recipeName: "@ansatz/cad-gdt-parametric-pretrain",
        recipeVersion: "1.0.0",
        datasetKind: "dataset-pretrain",
        files: [
          { uri: "cad/motor_mount.scad", dialect: "scad", source: SCAD_BRACKET_VALID },
          { uri: "cad/actuator_arm.scad", dialect: "scad", source: SCAD_ACTUATOR_ARM },
          { uri: "cad/pin_fin_heatsink.scad", dialect: "scad", source: SCAD_HEATSINK },
        ],
      },
      {
        recipeName: "@ansatz/rlhf-verified-posttrain",
        recipeVersion: "0.9.0",
        datasetKind: "dataset-posttrain",
        files: [
          { uri: "rlhf/verified_thermal.mo", dialect: "modelica", source: MODELICA_THERMAL_A },
          { uri: "rlhf/verified_buck.cir", dialect: "spice", source: SPICE_BUCK_A },
          { uri: "rlhf/verified_bms.sysml", dialect: "sysml2", source: SYSML_BMS_SPEC },
        ],
      },
      {
        recipeName: "@ansatz/thermal-dae-dynamic-m-recipe",
        recipeVersion: "1.2.0",
        datasetKind: "training-recipe",
        files: [
          { uri: "recipe/ThermalRCNetwork.mo", dialect: "modelica", source: MODELICA_THERMAL_A },
          { uri: "recipe/ThermalPidLoop.mo", dialect: "modelica", source: MODELICA_PID_LOOP },
        ],
        extraProvenance: {
          domain: "modelica",
          parameterScale: "1.5B",
          dialects: ["modelica"],
          benchmarkMetrics: { passAt1: 0.942, gate1To4PassRate: 0.978 },
          independentReproductions: 4,
        },
      },
      {
        recipeName: "@ansatz/cad-gdt-zonotope-recipe",
        recipeVersion: "0.8.0",
        datasetKind: "training-recipe",
        files: [
          { uri: "recipe/motor_mount.scad", dialect: "scad", source: SCAD_BRACKET_VALID },
          { uri: "recipe/actuator_arm.scad", dialect: "scad", source: SCAD_ACTUATOR_ARM },
        ],
        extraProvenance: {
          domain: "openscad/step",
          parameterScale: "0.6B",
          dialects: ["scad", "step"],
          benchmarkMetrics: { passAt1: 0.895, gate1To4PassRate: 0.944 },
          independentReproductions: 3,
        },
      },
      {
        recipeName: "@ansatz/power-converter-rlvr-recipe",
        recipeVersion: "0.6.0",
        datasetKind: "training-recipe",
        files: [{ uri: "recipe/synchronous_buck.cir", dialect: "spice", source: SPICE_BUCK_A }],
        extraProvenance: {
          domain: "spice",
          parameterScale: "1.5B",
          dialects: ["spice"],
          benchmarkMetrics: { passAt1: 0.918, gate1To4PassRate: 0.961 },
          independentReproductions: 2,
        },
      },
    ];

    for (const job of compileJobs) {
      try {
        const res = compileDatasetShards(database, mlStorageDir, {
          recipeName: job.recipeName,
          recipeVersion: job.recipeVersion,
          datasetKind: job.datasetKind,
          files: job.files,
          requireFormalPass: true,
          applyOverlayPatches: false,
        });
        for (const s of res.shards) {
          seededShards++;
          seededShardIds.push(s.shardId);
          if (job.extraProvenance) {
            const mergedProv = { ...s.provenance, ...job.extraProvenance };
            database.db
              .prepare("UPDATE compiled_dataset_shards SET provenance_json = ? WHERE shard_id = ?")
              .run(JSON.stringify(mergedProv), s.shardId);
          }
        }
      } catch (err) {
        console.warn(`[SeedMlArena] Skipping shard compile for ${job.recipeName}:`, err);
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Certified Model Registry Entries (with Real Ed25519 Promotion Proofs)
  // ───────────────────────────────────────────────────────────────────────────
  let seededModels = 0;
  const insertModel = database.db.prepare(`
    INSERT OR IGNORE INTO model_registry_entries
      (name, version, kind, base_model_ref, recipe_name, recipe_version, promotion_stage,
       parameter_scale, lora_rank, projection_layer_index, retriever_embedding_dim,
       memory_contract_json, eval_report_json, zonotope_cert_json, ed25519_proof_json,
       weight_sha256, weight_bytes, artifact_exports_json, shadow_traffic_pct, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const modelDefs = [
    {
      name: "@ansatz/qwen3-1.5b-modelica-core",
      version: "1.2.0",
      kind: "model-core",
      baseModelRef: "Qwen/Qwen3-1.5B",
      recipeName: "@ansatz/thermal-dae-dynamic-m-recipe",
      recipeVersion: "1.2.0",
      stage: "production",
      scale: "1.5B",
      loraRank: null,
      projLayer: 18,
      embedDim: 256,
      evalReport: {
        promoted: true,
        totalCases: 120,
        formalGatePassRate: 0.942,
        nonTrivialPassRate: 0.916,
        rewardHackingRate: 0.008,
        diskAnnRecallAtK: 0.954,
        calibration: {
          ece: 0.031,
          meanSpreadOnErrors: 0.64,
          meanSpreadOnValid: 0.19,
          separationGap: 0.45,
          sampleCount: 120,
        },
      },
      zonotopeCert: { mStart: 1, mMax: 24, mCap: 32, retrievalTau: 0.35, domain: "Modelica" },
      exports: { "mlc-webgpu": "q4f16_1", gguf: "Q4_K_M", onnx: "projection-fp16" },
      weightBytes: 942_180_352,
      shadowPct: 0,
    },
    {
      name: "@ansatz/thermal-dae-dynamic-m-lora",
      version: "0.8.0",
      kind: "lora-adapter",
      baseModelRef: "@ansatz/qwen3-1.5b-modelica-core@1.2.0",
      recipeName: "@ansatz/thermal-dae-dynamic-m-recipe",
      recipeVersion: "1.2.0",
      stage: "production",
      scale: "1.5B",
      loraRank: 16,
      projLayer: 18,
      embedDim: 256,
      evalReport: {
        promoted: true,
        totalCases: 96,
        formalGatePassRate: 0.964,
        nonTrivialPassRate: 0.948,
        rewardHackingRate: 0.004,
        diskAnnRecallAtK: 0.968,
        calibration: {
          ece: 0.024,
          meanSpreadOnErrors: 0.69,
          meanSpreadOnValid: 0.16,
          separationGap: 0.53,
          sampleCount: 96,
        },
      },
      zonotopeCert: { mStart: 1, mMax: 24, mCap: 32, retrievalTau: 0.32, domain: "Modelica" },
      exports: { "mlc-webgpu": "lora-q4f16", gguf: "lora-v3", peft: "adapter_model.safetensors" },
      weightBytes: 18_432_000,
      shadowPct: 0,
    },
    {
      name: "@ansatz/cad-gdt-zonotope-lora",
      version: "0.4.0",
      kind: "lora-adapter",
      baseModelRef: "Qwen/Qwen3-0.6B",
      recipeName: "@ansatz/cad-gdt-zonotope-recipe",
      recipeVersion: "0.8.0",
      stage: "staging",
      scale: "0.6B",
      loraRank: 8,
      projLayer: 12,
      embedDim: 256,
      evalReport: {
        promoted: true,
        totalCases: 64,
        formalGatePassRate: 0.895,
        nonTrivialPassRate: 0.875,
        rewardHackingRate: 0.015,
        diskAnnRecallAtK: 0.922,
        calibration: {
          ece: 0.042,
          meanSpreadOnErrors: 0.58,
          meanSpreadOnValid: 0.22,
          separationGap: 0.36,
          sampleCount: 64,
        },
      },
      zonotopeCert: { mStart: 1, mMax: 16, mCap: 24, retrievalTau: 0.38, domain: "OpenSCAD/STEP" },
      exports: { "mlc-webgpu": "lora-q4f16", peft: "adapter_model.safetensors" },
      weightBytes: 9_216_000,
      shadowPct: 15,
    },
    {
      name: "@ansatz/diskann-latent-proj-v2",
      version: "2.0.0",
      kind: "projection-head",
      baseModelRef: "@ansatz/qwen3-1.5b-modelica-core@1.2.0",
      recipeName: "@ansatz/power-converter-rlvr-recipe",
      recipeVersion: "0.6.0",
      stage: "production",
      scale: "1.5B",
      loraRank: null,
      projLayer: 18,
      embedDim: 256,
      evalReport: {
        promoted: true,
        totalCases: 80,
        formalGatePassRate: 0.95,
        nonTrivialPassRate: 0.925,
        rewardHackingRate: 0.0,
        diskAnnRecallAtK: 0.972,
        calibration: {
          ece: 0.028,
          meanSpreadOnErrors: 0.62,
          meanSpreadOnValid: 0.18,
          separationGap: 0.44,
          sampleCount: 80,
        },
      },
      zonotopeCert: { mStart: 1, mMax: 16, mCap: 32, retrievalTau: 0.3, domain: "SPICE" },
      exports: { onnx: "query_projection_head.onnx" },
      weightBytes: 2_621_440,
      shadowPct: 0,
    },
  ];

  for (const m of modelDefs) {
    const sha = crypto.createHash("sha256").update(`${m.name}@${m.version}`).digest("hex");
    const memoryContract = {
      embedderId: "deterministic-fnv1a-256",
      vectorDim: m.embedDim,
      projectionLayerIndex: m.projLayer,
      distanceMetric: "cosine",
    };
    const proof =
      m.stage === "production"
        ? signPromotionAttestationEd25519({
            modelName: m.name,
            version: m.version,
            stage: m.stage,
            weightSha256: sha,
            formalGatePassRate: m.evalReport.formalGatePassRate,
          })
        : null;

    const info = insertModel.run(
      m.name,
      m.version,
      m.kind,
      m.baseModelRef,
      m.recipeName,
      m.recipeVersion,
      m.stage,
      m.scale,
      m.loraRank,
      m.projLayer,
      m.embedDim,
      JSON.stringify(memoryContract),
      JSON.stringify(m.evalReport),
      JSON.stringify(m.zonotopeCert),
      proof ? JSON.stringify(proof) : null,
      sha,
      m.weightBytes,
      JSON.stringify(m.exports),
      m.shadowPct,
      primaryUserId,
    );
    if (info.changes > 0) seededModels++;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Training Runs, Step-Level Telemetry Curves & Living Recipe Triggers
  // ───────────────────────────────────────────────────────────────────────────
  let seededRuns = 0;
  let seededTriggers = 0;

  const insertRun = database.db.prepare(`
    INSERT OR IGNORE INTO training_runs
      (run_uid, recipe_name, recipe_version, model_name, backend, status,
       hyperparams_json, shard_ids_json, slurm_job_id, eval_report_json,
       started_at, finished_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMetric = database.db.prepare(`
    INSERT INTO training_run_metrics
      (run_id, step, epoch, center_loss, worst_case_loss, m_active, max_spread_delta_t,
       pruned_count, merged_count, expanded_count, girard_cap_count,
       gate1_to_4_pass_rate, ece, wq_recall_at_k, extra_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const runDefs = [
    {
      runUid: "run-demo-thermal-slurm-01",
      recipeName: "@ansatz/thermal-dae-dynamic-m-recipe",
      recipeVersion: "1.2.0",
      modelName: "@ansatz/thermal-dae-dynamic-m-lora",
      backend: "slurm",
      status: "completed",
      slurmJobId: "slurm-482910",
      steps: 16,
      mMax: 24,
      hyperparams: { mStart: 1, mMax: 24, mCap: 32, lr: 2e-4, loraRank: 16, gpus: 4 },
    },
    {
      runUid: "run-demo-cad-pytorch-02",
      recipeName: "@ansatz/cad-gdt-zonotope-recipe",
      recipeVersion: "0.8.0",
      modelName: "@ansatz/cad-gdt-zonotope-lora",
      backend: "pytorch",
      status: "running",
      slurmJobId: null,
      steps: 10,
      mMax: 16,
      hyperparams: { mStart: 1, mMax: 16, mCap: 24, lr: 3e-4, loraRank: 8, gpus: 1 },
    },
    {
      runUid: "run-demo-edge-webgpu-03",
      recipeName: "@ansatz/power-converter-rlvr-recipe",
      recipeVersion: "0.6.0",
      modelName: "@ansatz/diskann-latent-proj-v2",
      backend: "webgpu",
      status: "completed",
      slurmJobId: null,
      steps: 12,
      mMax: 12,
      hyperparams: { mStart: 1, mMax: 12, mCap: 16, lr: 5e-4, device: "webgpu" },
    },
  ];

  const nowIso = new Date().toISOString();
  const startedIso = new Date(Date.now() - 42 * 60 * 1000).toISOString();

  for (const r of runDefs) {
    const info = insertRun.run(
      r.runUid,
      r.recipeName,
      r.recipeVersion,
      r.modelName,
      r.backend,
      r.status,
      JSON.stringify(r.hyperparams),
      JSON.stringify(seededShardIds.slice(0, 3)),
      r.slurmJobId,
      r.status === "completed"
        ? JSON.stringify({ promoted: true, formalGatePassRate: 0.96, nonTrivialPassRate: 0.94, ece: 0.026 })
        : null,
      startedIso,
      r.status === "completed" ? nowIso : null,
      primaryUserId,
    );
    if (info.changes > 0) {
      seededRuns++;
      const runId = Number(info.lastInsertRowid);
      for (let s = 1; s <= r.steps; s++) {
        const p = s / r.steps;
        const centerLoss = Number((1.65 * Math.exp(-1.85 * p) + 0.11).toFixed(4));
        const worstCaseLoss = Number((centerLoss + 0.42 * Math.exp(-1.1 * p) + 0.05).toFixed(4));
        const mActive = Math.max(1, Math.round(1 + (r.mMax - 1) * p));
        const deltaT = Number(Math.max(0.14, 0.72 * (1 - 0.68 * p)).toFixed(3));
        const gateRate = Number(Math.min(0.985, 0.56 + 0.41 * p).toFixed(3));
        const ece = Number(Math.max(0.022, 0.11 * (1 - 0.74 * p)).toFixed(4));
        const recall = Number(Math.min(0.975, 0.74 + 0.23 * p).toFixed(3));
        insertMetric.run(
          runId,
          s * 25,
          Number((p * 2).toFixed(2)),
          centerLoss,
          worstCaseLoss,
          mActive,
          deltaT,
          Math.max(0, Math.round(3 * p)),
          s % 3 === 0 ? 2 : 1,
          s <= 4 ? 2 : 1,
          s === r.steps ? 1 : 0,
          gateRate,
          ece,
          recall,
          JSON.stringify({ backend: r.backend }),
        );
      }
    }
  }

  const insertTrigger = database.db.prepare(`
    INSERT OR IGNORE INTO living_recipe_triggers
      (recipe_name, dialect, trigger_kind, threshold_count, target_base_model, target_backend, auto_promote_staging, enabled, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?)
  `);
  const triggerDefs = [
    ["@ansatz/thermal-dae-dynamic-m-recipe", "modelica", "verified_pair_threshold", 15, "Qwen/Qwen3-1.5B", "slurm"],
    ["@ansatz/cad-gdt-zonotope-recipe", "scad", "campaign_complete", 1, "Qwen/Qwen3-0.6B", "pytorch"],
    ["@ansatz/power-converter-rlvr-recipe", "spice", "verified_pair_threshold", 10, "Qwen/Qwen3-1.5B", "webgpu"],
  ] as const;
  for (const t of triggerDefs) {
    const info = insertTrigger.run(t[0], t[1], t[2], t[3], t[4], t[5], primaryUserId);
    if (info.changes > 0) seededTriggers++;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 5. DiskANN Vector Memory Chunks & Federated Peers
  // ───────────────────────────────────────────────────────────────────────────
  let seededMemoryChunks = 0;
  let seededPeers = 0;

  const hasDemoChunk = Boolean(
    database.db
      .prepare("SELECT 1 FROM memory_chunks WHERE source_uri = ? LIMIT 1")
      .get("ansatz://verified/ThermalRCNetwork.mo"),
  );

  if (!hasDemoChunk) {
    const diskann = getOrCreateDiskAnnService(database, mlStorageDir);
    const demoChunks: Array<{
      chunkId: string;
      sourceKind: "package-doc" | "package-symbol" | "owl2-axiom" | "social-post" | "rlhf-verified-fix";
      sourceUri: string;
      packageName?: string;
      packageVersion?: string;
      dialect: string;
      formalVerified: boolean;
      symbolTags: string[];
      content: string;
      modalityKind?: MemoryModalityKind;
      quarantine?: boolean;
    }> = [
      {
        chunkId: "demo-chunk-thermal-rc",
        sourceKind: "rlhf-verified-fix",
        sourceUri: "ansatz://verified/ThermalRCNetwork.mo",
        packageName: "@ansatz/thermal-pack",
        packageVersion: "1.2.0",
        dialect: "modelica",
        formalVerified: true,
        symbolTags: ["ThermalRCNetwork", "R_th", "C_th", "SI-units", "Modelica"],
        content: MODELICA_THERMAL_A,
        modalityKind: "code",
      },
      {
        chunkId: "demo-chunk-pid-loop",
        sourceKind: "package-symbol",
        sourceUri: "pkg://@ansatz/control-lib@1.0.0/ThermalPidLoop.mo",
        packageName: "@ansatz/control-lib",
        packageVersion: "1.0.0",
        dialect: "modelica",
        formalVerified: true,
        symbolTags: ["ThermalPidLoop", "Kp", "Ti", "PID", "control"],
        content: MODELICA_PID_LOOP,
        modalityKind: "code",
      },
      {
        chunkId: "demo-chunk-battery-cooling",
        sourceKind: "rlhf-verified-fix",
        sourceUri: "ansatz://verified/BatteryCoolingPlate.mo",
        dialect: "modelica",
        formalVerified: true,
        symbolTags: ["BatteryCoolingPlate", "T_max", "R_th", "C_cell", "thermal"],
        content: MODELICA_BATTERY_TOL,
        modalityKind: "code",
      },
      {
        chunkId: "demo-chunk-motor-mount-scad",
        sourceKind: "package-symbol",
        sourceUri: "pkg://@ansatz/cad-gdt@1.0.0/motor_mount.scad",
        packageName: "@ansatz/cad-gdt",
        packageVersion: "1.0.0",
        dialect: "scad",
        formalVerified: true,
        symbolTags: ["motor_mount", "wall_thickness", "bore_radius", "GD&T", "OpenSCAD"],
        content: SCAD_BRACKET_VALID,
        modalityKind: "cad",
      },
      {
        chunkId: "demo-chunk-actuator-arm-scad",
        sourceKind: "social-post",
        sourceUri: "ansatz://posts/actuator-arm-linkage.scad",
        dialect: "scad",
        formalVerified: true,
        symbolTags: ["actuator_arm", "hull", "pivot_radius", "clearance"],
        content: SCAD_ACTUATOR_ARM,
        modalityKind: "cad",
      },
      {
        chunkId: "demo-chunk-buck-snubber",
        sourceKind: "rlhf-verified-fix",
        sourceUri: "ansatz://verified/synchronous_buck.cir",
        dialect: "spice",
        formalVerified: true,
        symbolTags: ["BuckConverter", "Rsnub", "Csnub", "SPICE", "transient"],
        content: SPICE_BUCK_A,
        modalityKind: "code",
      },
      {
        chunkId: "demo-chunk-sysml-bms",
        sourceKind: "owl2-axiom",
        sourceUri: "ansatz://specs/BatterySafetySystem.sysml",
        dialect: "sysml2",
        formalVerified: true,
        symbolTags: ["ThermalEnvelope", "ThermalController", "SysML2", "safety"],
        content: SYSML_BMS_SPEC,
        modalityKind: "ontology",
      },
      {
        chunkId: "demo-chunk-faulty-bracket",
        sourceKind: "social-post",
        sourceUri: "ansatz://posts/quarantined-negative-wall.scad",
        dialect: "scad",
        formalVerified: false,
        symbolTags: ["faulty_mount", "negative-wall", "quarantined"],
        content: SCAD_BRACKET_INVALID,
        modalityKind: "cad",
        quarantine: true,
      },
    ];

    for (const ch of demoChunks) {
      const upserted = await diskann.upsertChunkAsync({
        sourceKind: ch.sourceKind,
        sourceUri: ch.sourceUri,
        packageName: ch.packageName,
        packageVersion: ch.packageVersion,
        dialect: ch.dialect,
        tenantScope: "public",
        formalVerified: ch.formalVerified,
        symbolTags: ch.symbolTags,
        content: ch.content,
        authorUserId: primaryUserId ?? undefined,
        modalityKind: ch.modalityKind,
      });
      if (ch.quarantine) {
        diskann.setChunkQuarantined(upserted, true);
      }
      seededMemoryChunks++;
    }
  }

  const insertPeer = database.db.prepare(`
    INSERT OR IGNORE INTO federated_memory_peers (peer_url, label, enabled, last_seen_at, last_latency_ms)
    VALUES (?, ?, 1, datetime('now'), ?)
  `);
  const p1 = insertPeer.run("https://federation.ansatz.social", "Ansatz Flagship Federation Node", 24.5);
  const p2 = insertPeer.run("https://msl-mirror.modelscript.org", "Modelica Standard Library Mirror", 41.2);
  if (p1.changes > 0) seededPeers++;
  if (p2.changes > 0) seededPeers++;

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Provenance DAG & Creator Attribution Royalties
  // ───────────────────────────────────────────────────────────────────────────
  const existingProv = (database.db.prepare("SELECT COUNT(*) AS cnt FROM provenance_nodes").get() as { cnt: number })
    .cnt;

  if (existingProv === 0 && primaryUserId !== null) {
    try {
      const fixNode = recordProvenanceNode(database, {
        nodeKind: "verified-fix",
        refId: "demo-chunk-thermal-rc",
        authorUserId: primaryUserId,
      });
      const shardNode = recordProvenanceNode(database, {
        nodeKind: "dataset-shard",
        refId: seededShardIds[0] ?? "demo-shard-thermal",
        parentCids: [fixNode.cid],
        authorUserId: primaryUserId,
      });
      const modelNode = recordProvenanceNode(database, {
        nodeKind: "model-weights",
        refId: "@ansatz/thermal-dae-dynamic-m-lora@0.8.0",
        parentCids: [shardNode.cid],
        authorUserId: primaryUserId,
      });
      recordAttributionWeights(database, modelNode.cid, [
        { contributorUserId: primaryUserId, sourceCid: fixNode.cid, method: "lora_datainf", rawWeight: 0.65 },
        ...(annotatorIds[1] && annotatorIds[1] !== primaryUserId
          ? [
              {
                contributorUserId: annotatorIds[1],
                sourceCid: shardNode.cid,
                method: "lora_datainf" as const,
                rawWeight: 0.35,
              },
            ]
          : []),
      ]);

      const insertRoyalty = database.db.prepare(`
        INSERT INTO attribution_royalty_ledger (recipient_user_id, artifact_cid, reason, amount_credits, metadata_json)
        VALUES (?, ?, ?, ?, ?)
      `);
      insertRoyalty.run(
        primaryUserId,
        fixNode.cid,
        "retrieval_receipt",
        1.45,
        JSON.stringify({ sourceUri: "ansatz://verified/ThermalRCNetwork.mo", receipts: 29 }),
      );
      insertRoyalty.run(
        primaryUserId,
        modelNode.cid,
        "model_royalty",
        4.8,
        JSON.stringify({ model: "@ansatz/thermal-dae-dynamic-m-lora@0.8.0" }),
      );
      insertRoyalty.run(
        primaryUserId,
        shardNode.cid,
        "campaign_bounty",
        2.5,
        JSON.stringify({ campaign: "thermal-dae-rlvr-sprint" }),
      );
    } catch (err) {
      console.warn("[SeedMlArena] Provenance/royalty seed skipped:", err);
    }
  }

  console.log(
    `[SeedMlArena] Populated demo data: ${seededCampaigns} campaigns, ${seededChallenges} challenges, ${seededShards} shards, ${seededModels} models, ${seededRuns} runs, ${seededTriggers} triggers, ${seededMemoryChunks} memory chunks, ${seededPeers} peers.`,
  );

  return {
    skipped: false,
    campaigns: seededCampaigns,
    challenges: seededChallenges,
    shards: seededShards,
    models: seededModels,
    runs: seededRuns,
    triggers: seededTriggers,
    memoryChunks: seededMemoryChunks,
    peers: seededPeers,
  };
}
