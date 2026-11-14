// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CURRENT_DIR = import.meta.dirname ?? path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT_DIR = path.resolve(CURRENT_DIR, "../../..");

export interface CliEnterpriseModule {
  verifyEnterpriseCliCommand?(commandName: string): { allowed: boolean; reason?: string | undefined };
  buildRegulatoryDossier?(
    input: Record<string, unknown>,
    privateKeyPem?: string,
  ): {
    dossierId: string;
    organizationName: string;
    overallStatus: string;
    rsawMarkdown: string;
    oscalAssessmentResultsJson: string;
    ceiiWatermarkNotice: string;
    signedAttestation: { bundleToken: string };
  };
  createGatekeeperRouter?(): unknown;
  runGatekeeperScreeningPipeline?(pkg: Record<string, unknown>): {
    overallVerdict: string;
    compositeScorePercent: number;
    evaluatedAt: string;
    stages: Array<{
      stageNumber: number;
      stageName: string;
      verdict: string;
      scorePercent: number;
    }>;
    rejectionReasons: string[];
    summaryMarkdown: string;
  };
}

let cachedModule: CliEnterpriseModule | null | undefined;

/**
 * Dynamically loads `@modelscript/ee` from local workspace sources or built artifacts
 * without introducing a static package dependency from open-core CLI to `ee/`.
 */
export async function loadCliEnterpriseModule(): Promise<CliEnterpriseModule | null> {
  if (cachedModule !== undefined) {
    return cachedModule;
  }
  const editionEnv = (process.env["MSX_EDITION"] || "").toLowerCase().trim();
  if (editionEnv === "ce" || editionEnv === "community") {
    cachedModule = null;
    return null;
  }

  const isSourceRun = CURRENT_DIR.endsWith("src");
  const candidates = isSourceRun
    ? [path.join(REPO_ROOT_DIR, "ee", "src", "index.ts"), path.join(REPO_ROOT_DIR, "ee", "dist", "index.js")]
    : [path.join(REPO_ROOT_DIR, "ee", "dist", "index.js"), path.join(REPO_ROOT_DIR, "ee", "src", "index.ts")];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        const mod = (await import(pathToFileURL(candidate).href)) as CliEnterpriseModule;
        cachedModule = mod;
        return mod;
      } catch {
        // Continue to next candidate
      }
    }
  }

  cachedModule = null;
  return null;
}

/**
 * Loads `@modelscript/ee` or exits cleanly with an Enterprise Edition error message.
 */
export async function requireCliEnterpriseModule(commandName: string): Promise<CliEnterpriseModule> {
  const mod = await loadCliEnterpriseModule();
  if (!mod) {
    console.error(
      `[Enterprise Edition Required] '${commandName}' requires ModelScript Enterprise Edition (@modelscript/ee), which is disabled when MSX_EDITION=ce or absent in Community Edition builds.`,
    );
    process.exit(1);
  }
  return mod;
}
