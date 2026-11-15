// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ERCOT PMView (PSCAD Model reView) Batch Test-Suite Summary Parser & Validator.
 *
 * Parses PMView CSV/JSON disturbance test summaries (LVRT, HVRT, FRT, SCR, Phase Angle Jump)
 * into structured attestation records compatible with `nrtl-attestation.ts`.
 */

export interface PmviewTestCaseResult {
  testId: string;
  category: "LVRT" | "HVRT" | "FRT" | "SCR" | "VSTEP" | "PHASE_JUMP" | "OTHER";
  passed: boolean;
  measuredValue?: number | undefined;
  thresholdValue?: number | undefined;
  notes?: string | undefined;
}

export interface PmviewBatchSummary {
  profileName: string;
  pmviewVersion?: string | undefined;
  allPassed: boolean;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  cases: PmviewTestCaseResult[];
}

function classifyCategory(raw: string): PmviewTestCaseResult["category"] {
  const upper = raw.toUpperCase();
  if (upper.includes("LVRT")) return "LVRT";
  if (upper.includes("HVRT")) return "HVRT";
  if (upper.includes("FRT")) return "FRT";
  if (upper.includes("SCR")) return "SCR";
  if (upper.includes("VSTEP") || upper.includes("VOLT")) return "VSTEP";
  if (upper.includes("PHASE") || upper.includes("JUMP")) return "PHASE_JUMP";
  return "OTHER";
}

/**
 * Parses an ERCOT PMView batch summary CSV (columns: `testId,category,status[,measured,threshold,notes]`)
 * or JSON object into a `PmviewBatchSummary`.
 */
export function parsePmviewBatchSummary(text: string, profileName = "ERCOT_PMVIEW_SUITE"): PmviewBatchSummary {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    const raw = JSON.parse(trimmed) as Partial<PmviewBatchSummary>;
    const cases = Array.isArray(raw.cases) ? raw.cases : [];
    const passedTests = cases.filter((c) => c.passed).length;
    return {
      profileName: raw.profileName ?? profileName,
      pmviewVersion: raw.pmviewVersion,
      allPassed: cases.length > 0 && passedTests === cases.length,
      totalTests: cases.length,
      passedTests,
      failedTests: cases.length - passedTests,
      cases,
    };
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  const cases: PmviewTestCaseResult[] = [];
  for (let i = 0; i < lines.length; i++) {
    const cols = lines[i]!.split(",").map((c) => c.trim());
    if (i === 0 && cols[0]?.toLowerCase() === "testid") continue;
    if (cols.length < 3) continue;
    const status = cols[2]!.toUpperCase();
    const passed = status === "PASS" || status === "PASSED" || status === "TRUE" || status === "1";
    const measured = cols[3] !== undefined && cols[3] !== "" ? Number.parseFloat(cols[3]) : undefined;
    const threshold = cols[4] !== undefined && cols[4] !== "" ? Number.parseFloat(cols[4]) : undefined;
    cases.push({
      testId: cols[0]!,
      category: classifyCategory(cols[1]!),
      passed,
      measuredValue: Number.isFinite(measured) ? measured : undefined,
      thresholdValue: Number.isFinite(threshold) ? threshold : undefined,
      notes: cols[5],
    });
  }

  const passedTests = cases.filter((c) => c.passed).length;
  return {
    profileName,
    allPassed: cases.length > 0 && passedTests === cases.length,
    totalTests: cases.length,
    passedTests,
    failedTests: cases.length - passedTests,
    cases,
  };
}
