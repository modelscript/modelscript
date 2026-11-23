// SPDX-License-Identifier: AGPL-3.0-or-later

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { REPO_ROOT } from "../lib/workspaces.js";

const __filename = fileURLToPath(import.meta.url);

export type MaturityTier = "beta" | "alpha" | "pre-alpha";

export interface PillarScorecard {
  // Domain category
  domainKind: "simulation" | "cad" | "semantic" | "container";

  // Pillar 1: Parser & Grammar Completeness
  hasParser: boolean;
  hasParserTests: boolean;

  // Pillar 2: Diagnostics & Negative Testing
  hasLinter: boolean;
  hasLinterTests: boolean;
  testedErrorCodesCount: number;

  // Pillar 3: Reference Parity & Benchmarks
  hasBenchmark: boolean;
  hasToleranceCheck: boolean;

  // Pillar 4: Domain Lowering & Solvability
  hasDomainLowering: boolean;
  hasDomainLoweringTests: boolean;

  // Pillar 5: Zero-Allocation Arena Architecture
  usesRuntimeArena: boolean;

  // Pillar 6: Tooling & LSP Services
  hasLsp: boolean;
  hasLspTests: boolean;

  // Test suite metrics
  testFileCount: number;
  testCaseCount: number;

  // Audited Tier and Gaps
  auditedTier: MaturityTier;
  currentDeclaredTier: MaturityTier;
  gaps: string[];
}

export interface LanguageAuditResult {
  slug: string;
  name: string;
  dir: string;
  scorecard: PillarScorecard;
}

const CORE_FOUNDATIONAL_LANGUAGES = new Set(["ssp", "csv", "modelscript", "modelica", "sysml2"]);
const CAD_LANGUAGES = new Set([
  "step",
  "scad",
  "three-mf",
  "qif",
  "gdsii",
  "cif",
  "gerber",
  "iges",
  "dxf",
  "gcode",
  "apt",
  "stl",
  "obj",
  "usgs-dem",
]);
const SEMANTIC_LANGUAGES = new Set(["owl2", "reqif", "oscal"]);
const CONTAINER_LANGUAGES = new Set(["ssp", "csv"]);

// Cache benchmark suite references across testsuite/benchmarks/*.test.ts
function getBenchmarkReferencedSlugs(): Set<string> {
  const benchmarksDir = path.join(REPO_ROOT, "testsuite", "benchmarks");
  const slugs = new Set<string>();
  if (!fs.existsSync(benchmarksDir)) return slugs;

  for (const f of fs.readdirSync(benchmarksDir)) {
    if (f.endsWith(".test.ts")) {
      const content = fs.readFileSync(path.join(benchmarksDir, f), "utf-8");
      const matches = content.matchAll(/(?:@modelscript\/|languages\/)([a-z0-9_-]+)/g);
      for (const m of matches) {
        if (m[1]) slugs.add(m[1]);
      }
    }
  }
  return slugs;
}

const BENCHMARK_REFERENCED_SLUGS = getBenchmarkReferencedSlugs();

function collectTsSources(dir: string, chunks: string[] = []): string[] {
  if (!fs.existsSync(dir)) return chunks;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTsSources(full, chunks);
    } else if (entry.name.endsWith(".ts")) {
      chunks.push(fs.readFileSync(full, "utf-8"));
    }
  }
  return chunks;
}

/**
 * Analyzes a single language package against the 6 pillars.
 */
export function auditLanguage(slug: string): LanguageAuditResult {
  const langDir = path.join(REPO_ROOT, "languages", slug);
  const pkgJsonPath = path.join(langDir, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8")) as {
    name?: string;
    modelscript?: { tier?: MaturityTier; category?: string };
    dependencies?: Record<string, string>;
  };

  const name = pkg.name || `@modelscript/${slug}`;
  const currentDeclaredTier: MaturityTier = pkg.modelscript?.tier || "pre-alpha";

  const testsDir = path.join(langDir, "tests");
  const srcDir = path.join(langDir, "src");
  const combinedSrc = collectTsSources(srcDir).join("\n");

  // Determine domain kind
  let domainKind: "simulation" | "cad" | "semantic" | "container" = "simulation";
  if (CAD_LANGUAGES.has(slug)) domainKind = "cad";
  else if (SEMANTIC_LANGUAGES.has(slug)) domainKind = "semantic";
  else if (CONTAINER_LANGUAGES.has(slug)) domainKind = "container";

  // Discover all test files
  const testFiles: string[] = [];
  if (fs.existsSync(testsDir)) {
    for (const f of fs.readdirSync(testsDir)) {
      if ((f.endsWith(".test.ts") || f.endsWith(".spec.ts")) && !f.startsWith("scratch")) {
        testFiles.push(f);
      }
    }
  }

  // Count test cases across all test files
  let testCaseCount = 0;
  const allTestContents: string[] = [];
  const testedErrorCodes = new Set<string>();

  for (const tf of testFiles) {
    const content = fs.readFileSync(path.join(testsDir, tf), "utf-8");
    allTestContents.push(content);

    // Rough count of test cases (it(, test(, describe()
    const itMatches = content.match(/\b(it|test)\s*\(/g);
    if (itMatches) {
      testCaseCount += itMatches.length;
    }

    // Extract error codes tested: M\d{4}, or language-specific like USD\d{4}, AML\d{4}, etc.
    const codeMatches = content.match(/\b([A-Z]{1,6}\d{3,5})\b/g);
    if (codeMatches) {
      for (const c of codeMatches) {
        if (
          !["UTF8", "IEEE", "ISO", "RFC", "HTTP", "JSON", "ASCII", "STEP", "HTML", "C3D8R", "NACA", "GRI30"].includes(c)
        ) {
          testedErrorCodes.add(c);
        }
      }
    }
  }

  const combinedTests = allTestContents.join("\n");

  // Pillar 1: Parser & Grammar
  const hasParser =
    fs.existsSync(path.join(srcDir, "parser")) ||
    fs.existsSync(path.join(srcDir, "parser.ts")) ||
    fs.existsSync(path.join(srcDir, "grammar.ts")) ||
    fs.existsSync(path.join(srcDir, "dialects")) ||
    fs.existsSync(path.join(langDir, "grammar.dsl")) ||
    fs.existsSync(path.join(langDir, "src-gen"));
  const hasParserTests =
    testFiles.some((f) => f.includes("parser") || f.includes("grammar")) || /parse|Parser|AST|CST/i.test(combinedTests);

  // Pillar 2: Diagnostics & Linter
  const hasLinter =
    fs.existsSync(path.join(srcDir, "lints")) ||
    fs.existsSync(path.join(srcDir, "lints.ts")) ||
    fs.existsSync(path.join(srcDir, "linter.ts")) ||
    fs.existsSync(path.join(srcDir, "linter")) ||
    fs.existsSync(path.join(srcDir, "diagnostics.ts")) ||
    CONTAINER_LANGUAGES.has(slug);
  const hasLinterTests =
    testFiles.some((f) => f.includes("lint") || f.includes("diagnostic")) ||
    /diagnostic|linter|lint|M\d{4}/i.test(combinedTests) ||
    CONTAINER_LANGUAGES.has(slug);
  const testedErrorCodesCount = testedErrorCodes.size;

  // Pillar 3: Reference Parity & Benchmarks
  const hasBenchmark =
    testFiles.some(
      (f) =>
        f.includes("benchmark") ||
        f.includes("parity") ||
        f.includes("analysis") ||
        f.includes("kinematics") ||
        f.includes("solver") ||
        f.includes("transient") ||
        f.includes("simulation") ||
        f.includes("cosim") ||
        f.includes("rte") ||
        f.includes("dosimetry") ||
        f.includes("curves") ||
        f.includes("compiler") ||
        f.includes("clothoid") ||
        f.includes("geometry"),
    ) ||
    /simulate|solve|benchmark|parity|simulate.*DesignDay|run.*Benchmark/i.test(combinedTests) ||
    fs.existsSync(path.join(testsDir, `${slug}-benchmark-runner.ts`)) ||
    BENCHMARK_REFERENCED_SLUGS.has(slug) ||
    CORE_FOUNDATIONAL_LANGUAGES.has(slug);

  const hasToleranceCheck =
    /rmse|nrmse|tolerance|relativeError|maxRelErr|absErr|relErr|residual|drift|converge|within|toBeCloseTo|Math\.abs\([\s\S]{1,120}?\)\s*<=?/i.test(
      combinedTests,
    ) ||
    CORE_FOUNDATIONAL_LANGUAGES.has(slug) ||
    CONTAINER_LANGUAGES.has(slug);

  // Pillar 4: Domain Lowering & Solvability
  let hasDomainLowering = false;
  let hasDomainLoweringTests = false;

  if (domainKind === "cad") {
    const hasCadModule =
      fs.existsSync(path.join(srcDir, "cad")) ||
      fs.existsSync(path.join(srcDir, "csg")) ||
      fs.existsSync(path.join(srcDir, "brep")) ||
      fs.existsSync(path.join(srcDir, "geometry.ts")) ||
      fs.existsSync(path.join(srcDir, "cae-mesher.ts")) ||
      fs.existsSync(path.join(srcDir, "topology")) ||
      fs.existsSync(path.join(srcDir, "step-bridge")) ||
      Boolean(pkg.dependencies?.["@modelscript/cad"]);
    const emitsCadOrLowering = /tessellate|mesher|addEquation|lower.*ToDae|toStep|geometry|brep/i.test(combinedSrc);
    hasDomainLowering = hasCadModule && emitsCadOrLowering;
    hasDomainLoweringTests =
      testFiles.some((f) => f.includes("cad") || f.includes("csg") || f.includes("geometry") || f.includes("dae")) ||
      /cad|csg|brep|geometry|lower.*ToDae/i.test(combinedTests);
  } else if (domainKind === "semantic") {
    hasDomainLowering =
      fs.existsSync(path.join(srcDir, "ontology")) ||
      fs.existsSync(path.join(srcDir, "projections")) ||
      fs.existsSync(path.join(srcDir, "triplestore.ts")) ||
      Boolean(pkg.dependencies?.["@modelscript/runtime"]);
    hasDomainLoweringTests =
      testFiles.some(
        (f) => f.includes("ontology") || f.includes("projection") || f.includes("sparql") || f.includes("dae"),
      ) || /ontology|triplestore|projection|sparql|query/i.test(combinedTests);
  } else if (domainKind === "container") {
    hasDomainLowering = true;
    hasDomainLoweringTests = true;
  } else {
    // Simulation / DAE: require actual solver/equation lowering implementation in src/, not empty directories
    const hasLoweringDirOrFile =
      fs.existsSync(path.join(srcDir, "dae")) ||
      fs.existsSync(path.join(srcDir, "flattener.ts")) ||
      fs.existsSync(path.join(srcDir, "flattener")) ||
      fs.existsSync(path.join(srcDir, "compiler.ts")) ||
      fs.existsSync(path.join(srcDir, "solvers")) ||
      fs.existsSync(path.join(srcDir, "solver")) ||
      fs.existsSync(path.join(srcDir, "solver.ts")) ||
      fs.existsSync(path.join(srcDir, "emt-solver.ts")) ||
      fs.existsSync(path.join(srcDir, "physics")) ||
      fs.existsSync(path.join(srcDir, "kinematics")) ||
      fs.existsSync(path.join(srcDir, "mesh")) ||
      fs.existsSync(path.join(srcDir, "projections"));
    const emitsEquationsOrSolves =
      /addEquation|EmtSolver|simulateDriftFlux|flattenArena|solve|simulate|compile|lower.*ToDae/i.test(combinedSrc);
    hasDomainLowering = hasLoweringDirOrFile && emitsEquationsOrSolves;
    hasDomainLoweringTests =
      testFiles.some((f) => f.includes("dae") || f.includes("solver") || f.includes("compiler")) ||
      /DAEBuilder|lower.*ToDae|flattenArena|simulate|solve/i.test(combinedTests);
  }

  // Pillar 5: Zero-Allocation Arena Architecture
  const deps = pkg.dependencies || {};
  const usesRuntimeArena =
    Boolean(deps["@modelscript/runtime"] || deps["@modelscript/dsl"] || deps["@modelscript/cad"]) ||
    CORE_FOUNDATIONAL_LANGUAGES.has(slug);

  // Pillar 6: Tooling & LSP Services
  const hasLsp =
    fs.existsSync(path.join(srcDir, "lsp.ts")) ||
    fs.existsSync(path.join(srcDir, "lsp")) ||
    fs.existsSync(path.join(srcDir, "language.ts")) ||
    CORE_FOUNDATIONAL_LANGUAGES.has(slug);
  const hasLspTests =
    testFiles.some((f) => f.includes("lsp") || f.includes("workspace") || f.includes("outline")) ||
    /LspService|documentSymbols|hover|completion|UnifiedWorkspace|getIndex/i.test(combinedTests) ||
    CORE_FOUNDATIONAL_LANGUAGES.has(slug);

  const testFileCount = testFiles.length;

  // Compute Gaps & Audited Tier
  const gaps: string[] = [];
  const isFoundational = CORE_FOUNDATIONAL_LANGUAGES.has(slug);

  if (!hasParser || !hasParserTests) gaps.push("Missing parser grammar or parser tests");
  if (!hasDomainLowering || !hasDomainLoweringTests) gaps.push(`Missing domain lowering or tests (${domainKind})`);
  if (!hasBenchmark) gaps.push("Missing reference benchmark suite");
  if (domainKind === "simulation" && !hasToleranceCheck && !isFoundational)
    gaps.push("Missing numerical tolerance / residual / convergence assertions");
  if (!hasLinter || !hasLinterTests) gaps.push("Missing negative linter / diagnostic tests");
  if (!hasLsp || !hasLspTests) gaps.push("Missing Language Server Protocol (LSP) or tests");
  if (testFileCount < 5 && !isFoundational)
    gaps.push(`Test file count (${testFileCount}) below Alpha threshold (min 5 required)`);
  if (testFileCount < 8 && !isFoundational)
    gaps.push(`Test file count (${testFileCount}) below hardened Beta threshold (>=8)`);

  let auditedTier: MaturityTier = "pre-alpha";

  if (isFoundational) {
    auditedTier = "beta";
  } else if (
    testFileCount >= 8 &&
    hasParser &&
    hasParserTests &&
    hasDomainLowering &&
    hasDomainLoweringTests &&
    hasBenchmark &&
    (domainKind !== "simulation" || hasToleranceCheck) &&
    hasLinter &&
    hasLinterTests &&
    hasLsp &&
    hasLspTests &&
    usesRuntimeArena
  ) {
    auditedTier = "beta";
  } else if (
    testFileCount >= 5 &&
    hasParser &&
    hasDomainLowering &&
    hasDomainLoweringTests &&
    hasBenchmark &&
    usesRuntimeArena
  ) {
    auditedTier = "alpha";
  } else {
    auditedTier = "pre-alpha";
  }

  return {
    slug,
    name,
    dir: langDir,
    scorecard: {
      domainKind,
      hasParser,
      hasParserTests,
      hasLinter,
      hasLinterTests,
      testedErrorCodesCount,
      hasBenchmark,
      hasToleranceCheck,
      hasDomainLowering,
      hasDomainLoweringTests,
      usesRuntimeArena,
      hasLsp,
      hasLspTests,
      testFileCount,
      testCaseCount,
      auditedTier,
      currentDeclaredTier,
      gaps,
    },
  };
}

/**
 * Runs the audit across all 93 languages in languages/.
 */
export function auditAllLanguages(): LanguageAuditResult[] {
  const languagesDir = path.join(REPO_ROOT, "languages");
  const slugs = fs
    .readdirSync(languagesDir)
    .filter((entry) => {
      const full = path.join(languagesDir, entry);
      return fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, "package.json"));
    })
    .sort();

  return slugs.map(auditLanguage);
}

/**
 * CLI Runner.
 */
function run(): void {
  const args = process.argv.slice(2);
  const isJson = args.includes("--json");
  const isApply = args.includes("--apply");
  const isStrict = args.includes("--strict");

  const results = auditAllLanguages();

  if (isJson) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  console.log("=========================================================================================");
  console.log("             ModelScript 6-Pillar Polyglot Language Maturity Audit                       ");
  console.log("=========================================================================================\n");

  const tierSummary = {
    beta: results.filter((r) => r.scorecard.auditedTier === "beta"),
    alpha: results.filter((r) => r.scorecard.auditedTier === "alpha"),
    preAlpha: results.filter((r) => r.scorecard.auditedTier === "pre-alpha"),
  };

  console.log(`Audited ${results.length} Polyglot Languages against 6-Pillar Robustness Criteria:\n`);
  console.log(
    `  - Tier 2 (Beta):      ${tierSummary.beta.length.toString().padStart(2)} languages (${((tierSummary.beta.length / results.length) * 100).toFixed(1)}%)`,
  );
  console.log(
    `  - Tier 1 (Alpha):     ${tierSummary.alpha.length.toString().padStart(2)} languages (${((tierSummary.alpha.length / results.length) * 100).toFixed(1)}%)`,
  );
  console.log(
    `  - Tier 0 (Pre-Alpha): ${tierSummary.preAlpha.length.toString().padStart(2)} languages (${((tierSummary.preAlpha.length / results.length) * 100).toFixed(1)}%)\n`,
  );

  console.log("--------------------------------------------------------------------------------------------------");
  console.log(
    "| Language       | Domain    | Files | Tests | Lower | Bench | Lint | LSP | Declared | Audited | Status   |",
  );
  console.log("--------------------------------------------------------------------------------------------------");

  for (const r of results) {
    const sc = r.scorecard;
    const slug = r.slug.padEnd(14);
    const domain = sc.domainKind.padEnd(9);
    const files = sc.testFileCount.toString().padStart(5);
    const tests = sc.testCaseCount.toString().padStart(5);
    const lower = sc.hasDomainLoweringTests ? "  ✓  " : "  ✗  ";
    const bench = sc.hasBenchmark ? "  ✓  " : "  ✗  ";
    const lint = sc.hasLinterTests ? "  ✓ " : "  ✗ ";
    const lsp = sc.hasLspTests ? " ✓ " : " ✗ ";
    const declared = sc.currentDeclaredTier.padEnd(8);
    const audited = sc.auditedTier.padEnd(7);

    let status = "MATCH";
    if (sc.auditedTier !== sc.currentDeclaredTier) {
      status = sc.auditedTier === "beta" ? "PROMOTE" : "DEMOTE";
    }
    const statusCol = status.padEnd(8);

    console.log(
      `| ${slug} | ${domain} | ${files} | ${tests} | ${lower} | ${bench} | ${lint} | ${lsp} | ${declared} | ${audited} | ${statusCol} |`,
    );
  }
  console.log("--------------------------------------------------------------------------------------------------\n");

  const demotions = results.filter(
    (r) =>
      (r.scorecard.currentDeclaredTier === "beta" && r.scorecard.auditedTier !== "beta") ||
      (r.scorecard.currentDeclaredTier === "alpha" && r.scorecard.auditedTier === "pre-alpha"),
  );

  if (demotions.length > 0) {
    console.log(`Identified ${demotions.length} languages requiring re-tiering adjustment:`);
    for (const d of demotions) {
      console.log(`  - ${d.slug}: ${d.scorecard.currentDeclaredTier} -> ${d.scorecard.auditedTier}`);
      for (const gap of d.scorecard.gaps) {
        console.log(`      * Gap: ${gap}`);
      }
    }
    console.log("");
  }

  if (isApply) {
    console.log("Applying audited maturity tiers to package manifests and linter script...\n");
    let updatedManifests = 0;
    const newBeta = new Set<string>();
    const newAlpha = new Set<string>();
    const newPreAlpha = new Set<string>();

    for (const r of results) {
      const targetTier = r.scorecard.auditedTier;
      if (targetTier === "beta") newBeta.add(r.slug);
      else if (targetTier === "alpha") newAlpha.add(r.slug);
      else newPreAlpha.add(r.slug);

      const pkgJsonPath = path.join(r.dir, "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8")) as Record<string, unknown>;
      const meta = pkg["modelscript"] as { tier?: string; category?: string } | undefined;

      if (!meta || meta.tier !== targetTier) {
        pkg["modelscript"] = {
          tier: targetTier,
          category: meta?.category || "language",
        };
        fs.writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
        updatedManifests++;
      }
    }

    // Update scripts/lint/lint-package-manifests.ts
    const linterPath = path.join(REPO_ROOT, "scripts", "lint-package-manifests.ts");
    let linterSrc = fs.readFileSync(linterPath, "utf-8");

    const betaEntries = Array.from(newBeta)
      .map((s) => `  "${s}",`)
      .join("\n");
    const alphaEntries = Array.from(newAlpha)
      .map((s) => `  "${s}",`)
      .join("\n");

    linterSrc = linterSrc.replace(
      /const BETA_LANGUAGES = new Set\(\[[\s\S]*?\]\);/,
      `const BETA_LANGUAGES = new Set([\n${betaEntries}\n]);`,
    );

    linterSrc = linterSrc.replace(
      /const ALPHA_LANGUAGES = new Set<string>\(\[[\s\S]*?\]\);|const ALPHA_LANGUAGES = new Set\(\[[\s\S]*?\]\);/,
      `const ALPHA_LANGUAGES = new Set([\n${alphaEntries}\n]);`,
    );

    fs.writeFileSync(linterPath, linterSrc, "utf-8");

    console.log(`✓ Updated ${updatedManifests} package manifest(s).`);
    console.log(
      `✓ Synchronized BETA_LANGUAGES (${newBeta.size}) and ALPHA_LANGUAGES (${newAlpha.size}) in scripts/lint-package-manifests.ts.`,
    );
  }

  if (isStrict && demotions.length > 0) {
    console.error(
      `ERROR: ${demotions.length} packages fail the strict 6-pillar maturity gates. Run with --apply to synchronize.`,
    );
    process.exit(1);
  }
}

// Direct invocation check
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  run();
}
