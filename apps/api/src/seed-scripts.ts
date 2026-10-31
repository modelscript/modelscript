// SPDX-License-Identifier: AGPL-3.0-or-later

import { LibraryDatabase } from "./database.js";
import { BUILTIN_STUDY_DEFINITIONS, CURATED_COMPATIBLE_MODELS } from "./services/studies/study-catalog.js";
import { computeStudyResultsPayload } from "./services/studies/study-execution-service.js";

/**
 * Seeds the database with canonical Engineering Study Templates (Official + Package-Contributed)
 * and example Study Runs with full trajectories, Monte Carlo UQ bands, Sobol indices, and KPIs.
 */
export function seedScriptsAndTemplates(db: LibraryDatabase): void {
  // 1. Seed canonical built-in & package-contributed Study Definitions
  for (const studyDef of BUILTIN_STUDY_DEFINITIONS) {
    db.createScriptTemplate(
      studyDef.name,
      studyDef.slug,
      studyDef.description,
      studyDef.category,
      studyDef.icon,
      studyDef as unknown as Record<string, unknown>,
    );
  }

  console.log(`✅ Seeded ${BUILTIN_STUDY_DEFINITIONS.length} engineering study templates!`);

  // 2. Only seed example jobs if the jobs table is currently empty
  const existingJobs = db.getJobs(5, 0);
  if (existingJobs.length === 0) {
    const uqStudy = BUILTIN_STUDY_DEFINITIONS.find((s) => s.slug === "monte-carlo-sweep")!;
    const oscModel = CURATED_COMPATIBLE_MODELS[0]!;
    const uqResults = computeStudyResultsPayload(
      uqStudy,
      {
        templateIdOrSlug: uqStudy.slug,
        modelId: oscModel.id,
        executionTarget: "hpc-cluster",
        computeProfile: "high-cpu",
      },
      oscModel,
    );

    const job1 = db.createJob(`${uqStudy.name} — ${oscModel.name}`, "SUCCESS", "UNCERTAINTY", "hpc-cluster", null, {
      templateSlug: uqStudy.slug,
      studyKind: uqStudy.kind,
      modelId: oscModel.id,
      modelName: oscModel.qualifiedName,
      modelDomain: oscModel.domain,
      packageName: oscModel.packageName,
      packageVersion: oscModel.packageVersion,
      executionTarget: "hpc-cluster",
      computeProfile: "high-cpu",
      solver: "sobol-dassl",
      sampleCount: uqResults.sampleCount,
      kpis: uqResults.kpis,
      studyResults: uqResults,
    });
    for (const stepName of uqStudy.execution.pipelineSteps) {
      const sId = db.createJobStep(job1, stepName, "SUCCESS");
      db.updateJobStepStatus(sId, "SUCCESS");
    }
    db.updateJobAccounting(job1, {
      computeProfile: "high-cpu",
      cpuSeconds: 18.4,
      peakMemoryMb: 512,
      costCredits: 1.2,
    });
    db.updateJobStatus(job1, "SUCCESS");

    const ieeeStudy = BUILTIN_STUDY_DEFINITIONS.find((s) => s.slug === "ieee-2800-frt-compliance")!;
    const ibrModel = CURATED_COMPATIBLE_MODELS.find((m) => m.name === "GridFormingInverter_IEEE2800") || oscModel;
    const ieeeResults = computeStudyResultsPayload(
      ieeeStudy,
      {
        templateIdOrSlug: ieeeStudy.slug,
        modelId: ibrModel.id,
        executionTarget: "hpc-cluster",
        computeProfile: "standard",
      },
      ibrModel,
    );

    const job2 = db.createJob(`${ieeeStudy.name} — ${ibrModel.name}`, "SUCCESS", "POWER-EMT", "hpc-cluster", null, {
      templateSlug: ieeeStudy.slug,
      studyKind: ieeeStudy.kind,
      modelId: ibrModel.id,
      modelName: ibrModel.qualifiedName,
      modelDomain: ibrModel.domain,
      packageName: ibrModel.packageName,
      packageVersion: ibrModel.packageVersion,
      executionTarget: "hpc-cluster",
      computeProfile: "standard",
      solver: "modelica",
      sampleCount: ieeeResults.sampleCount,
      kpis: ieeeResults.kpis,
      studyResults: ieeeResults,
    });
    for (const stepName of ieeeStudy.execution.pipelineSteps) {
      const sId = db.createJobStep(job2, stepName, "SUCCESS");
      db.updateJobStepStatus(sId, "SUCCESS");
    }
    db.updateJobAccounting(job2, {
      computeProfile: "standard",
      cpuSeconds: 6.2,
      peakMemoryMb: 256,
      costCredits: 0.55,
    });
    db.updateJobStatus(job2, "SUCCESS");

    const sweepStudy = BUILTIN_STUDY_DEFINITIONS.find((s) => s.slug === "parametric-doe-sweep")!;
    const rlcModel = CURATED_COMPATIBLE_MODELS.find((m) => m.name === "RLC_ResonantConverter") || oscModel;
    const sweepResults = computeStudyResultsPayload(
      sweepStudy,
      {
        templateIdOrSlug: sweepStudy.slug,
        modelId: rlcModel.id,
        executionTarget: "local-wasm",
        computeProfile: "wasm-edge",
      },
      rlcModel,
    );

    const job3 = db.createJob(`${sweepStudy.name} — ${rlcModel.name}`, "SUCCESS", "SWEEP", "local-wasm", null, {
      templateSlug: sweepStudy.slug,
      studyKind: sweepStudy.kind,
      modelId: rlcModel.id,
      modelName: rlcModel.qualifiedName,
      modelDomain: rlcModel.domain,
      packageName: rlcModel.packageName,
      packageVersion: rlcModel.packageVersion,
      executionTarget: "local-wasm",
      computeProfile: "wasm-edge",
      solver: "dassl",
      sampleCount: sweepResults.sampleCount,
      kpis: sweepResults.kpis,
      studyResults: sweepResults,
    });
    for (const stepName of sweepStudy.execution.pipelineSteps) {
      const sId = db.createJobStep(job3, stepName, "SUCCESS");
      db.updateJobStepStatus(sId, "SUCCESS");
    }
    db.updateJobAccounting(job3, {
      computeProfile: "wasm-edge",
      cpuSeconds: 0.9,
      peakMemoryMb: 128,
      costCredits: 0,
    });
    db.updateJobStatus(job3, "SUCCESS");
  }

  // ── Seed Example Solutions ──────────────────────────────────────
  const seedUser = db.getUserByUsername("admin") || db.getUserByUsername("dev") || db.getUserByUsername("alice");
  if (seedUser) {
    const existing = db.getUserSolutions(seedUser.username);
    if (existing.length === 0) {
      const s1 = db.createOrUpdateSolution(seedUser.id, {
        slug: "simulink-linter",
        name: "Simulink Pre-Flight Linter",
        description:
          "Pre-flight static analyzer detecting algebraic loops, unconnected ports, and sample-time conflicts in Simulink models.",
        category: "Control Systems & Aeronautics",
        icon: "cpu",
        supported_formats: [".slx", ".mdl"],
      });
      db.createSolutionRelease(s1, {
        version: "1.0.0",
        changelog: "Initial production release with M7201-M7210 control linter rules.",
        bundle_url: "/static/solutions/simulink-linter/index.html",
        tauri_windows_url:
          "https://github.com/modelscript/simulink-linter/releases/download/v1.0.0/simulink-linter-x64.exe",
        tauri_linux_url:
          "https://github.com/modelscript/simulink-linter/releases/download/v1.0.0/simulink-linter.AppImage",
        tauri_darwin_url: "https://github.com/modelscript/simulink-linter/releases/download/v1.0.0/simulink-linter.dmg",
      });

      const s2 = db.createOrUpdateSolution(seedUser.id, {
        slug: "ieee-2800-auditor",
        name: "IEEE 2800-2022 IBR Auditor",
        description:
          "Automated compliance auditor for Inverter-Based Resources (IBR) validating voltage/frequency ride-through against IEEE 2800-2022 clauses.",
        category: "Power Systems & Interconnection",
        icon: "zap",
        supported_formats: [".raw", ".dyr", ".pscx"],
      });
      db.createSolutionRelease(s2, {
        version: "1.2.0",
        changelog: "Added automated dynamic impedance scan and PRC-024 curve overlay.",
        bundle_url: "/static/solutions/ieee-2800-auditor/index.html",
        tauri_windows_url:
          "https://github.com/modelscript/ieee-2800-auditor/releases/download/v1.2.0/ieee-2800-auditor-x64.exe",
      });
    }
  }

  console.log("✅ Seeded example study runs & engineering solutions!");
}
