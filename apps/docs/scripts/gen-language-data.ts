// SPDX-License-Identifier: AGPL-3.0-or-later
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const languagesDir = path.resolve(repoRoot, "languages");

const cliDataPath = path.resolve(__dirname, "../docs/.vitepress/theme/data/cli.generated.json");
const cliList = JSON.parse(fs.readFileSync(cliDataPath, "utf8"));
const cliByCmd: Record<string, any> = {};
for (const cmd of cliList) {
  cliByCmd[cmd.name] = cmd;
}

const lintRulesPath = path.resolve(__dirname, "../docs/.vitepress/theme/data/lint-rules.generated.json");
const lintRulesData: { slug: string; rules: any[] }[] = JSON.parse(fs.readFileSync(lintRulesPath, "utf8"));
const rulesBySlug: Record<string, number> = {};
for (const entry of lintRulesData) {
  rulesBySlug[entry.slug] = entry.rules.length;
}

const languagesTsPath = path.resolve(__dirname, "../docs/.vitepress/theme/data/languages.ts");
const languagesTsContent = fs.readFileSync(languagesTsPath, "utf8");

// Parse LANGUAGES array from languages.ts
const langRegex =
  /slug:\s*"([^"]+)",\s*name:\s*"([^"]+)",\s*sidebar:\s*"([^"]+)",\s*ext:\s*"([^"]+)",\s*role:\s*"([^"]+)",\s*group:\s*"([^"]+)"/g;
let match: RegExpExecArray | null;
const declaredLanguages: {
  slug: string;
  name: string;
  sidebar: string;
  ext: string;
  role: string;
  group: string;
}[] = [];

while ((match = langRegex.exec(languagesTsContent)) !== null) {
  declaredLanguages.push({
    slug: match[1] ?? "",
    name: match[2] ?? "",
    sidebar: match[3] ?? "",
    ext: match[4] ?? "",
    role: match[5] ?? "",
    group: match[6] ?? "",
  });
}

export interface GeneratedLanguageData {
  slug: string;
  name: string;
  sidebar: string;
  ext: string;
  role: string;
  group: string;
  pkgName: string;
  version: string;
  tier: "stable" | "beta" | "preview";
  cliCommand: string | null;
  actions: string[];
  capabilities: {
    parse: boolean;
    lint: boolean;
    dae: boolean;
    simulate: boolean;
    projections: string[];
  };
  ruleCount: number;
}

export function generateLanguagesManifest(): GeneratedLanguageData[] {
  return declaredLanguages.map((lang) => {
    const dir = path.join(languagesDir, lang.slug);
    const pkgJsonPath = path.join(dir, "package.json");
    const pkg = fs.existsSync(pkgJsonPath) ? JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) : null;

    const pkgName = pkg?.name || `@modelscript/${lang.slug}`;
    const version = pkg?.version || "0.0.0";
    const tier: "stable" | "beta" | "preview" = pkg?.modelscript?.tier || "preview";
    const allDeps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };

    // Determine primary CLI command
    let cliCmd = lang.slug;
    if (!cliByCmd[cliCmd]) {
      if (lang.slug === "sysml2") cliCmd = "sysml";
      else if (lang.slug === "scad") cliCmd = "csg";
      else if (lang.slug === "modelica") cliCmd = "simulate";
      else if (lang.slug === "modelscript") cliCmd = "compile";
      else if (lang.slug === "step") cliCmd = "csg";
      else if (lang.slug === "ssp") cliCmd = "fmu";
      else cliCmd = "";
    }

    const cmdData = cliCmd ? cliByCmd[cliCmd] : null;
    const actionChoices: string[] = cmdData?.positionals?.find((p: any) => p.name === "action")?.choices || [];
    const subChoices: string[] = (cmdData?.subcommands || []).map((s: any) => s.name);
    const actions: string[] = Array.from(new Set([...actionChoices, ...subChoices]));

    // Capabilities
    const hasDaeDir = fs.existsSync(path.join(dir, "src/dae"));
    const hasDaeLowering =
      hasDaeDir ||
      actions.some((a) => a.includes("dae")) ||
      ["modelica", "modelscript", "c", "simpack", "gensys", "adams", "urdf", "spice"].includes(lang.slug);

    const hasSimulate =
      actions.some((a) =>
        [
          "simulate",
          "solve",
          "sim",
          "powerflow",
          "run-scan",
          "simulate-rte",
          "propagate",
          "kinetics",
          "solve-flash",
          "route-flow",
        ].includes(a),
      ) ||
      [
        "modelica",
        "spice",
        "jsbsim",
        "relap5",
        "eclipse",
        "swmm",
        "epanet",
        "opendss",
        "pscad",
        "psse",
        "olga",
        "lps",
        "sbml",
        "gensys",
        "simpack",
        "adams",
      ].includes(lang.slug) ||
      "@modelscript/simulate" in allDeps;

    // Projections
    const projections: string[] = [];
    for (const a of actions) {
      if (a.startsWith("to-") || a.startsWith("export-")) {
        const target = a.replace(/^(to-|export-)/, "");
        if (target === "modelica") projections.push("Modelica");
        else if (target === "sysml" || target === "sysml2") projections.push("SysML v2");
        else if (target === "simpack") projections.push("SIMPACK");
        else if (target === "adams") projections.push("MSC Adams");
        else if (target === "gensys") projections.push("GENSYS");
        else if (target === "ssp") projections.push("SSP");
        else if (target === "fmu") projections.push("FMU");
        else if (target === "spice") projections.push("SPICE");
        else if (target === "ecad") projections.push("ECAD");
      }
    }
    if (lang.slug === "modelica") projections.push("DAE", "C", "FMU");
    if (lang.slug === "sysml2") projections.push("Modelica", "ReqIF");
    if (lang.slug === "step") projections.push("Modelica", "CSG");
    if (lang.slug === "scad") projections.push("CSG", "STEP");
    if (lang.slug === "ssp") projections.push("FMU", "Modelica");
    if (lang.slug === "owl2") projections.push("SPARQL", "SysML v2");
    if (lang.slug === "csv") projections.push("Modelica", "DAE");
    if (lang.slug === "simulink") projections.push("Modelica", "DAE");

    const ruleCount = rulesBySlug[lang.slug] || 0;
    const hasLint =
      ruleCount > 0 ||
      actions.includes("lint") ||
      actions.includes("check") ||
      ["csv", "ccsds", "simulink"].includes(lang.slug);

    return {
      slug: lang.slug,
      name: lang.name,
      sidebar: lang.sidebar,
      ext: lang.ext,
      role: lang.role,
      group: lang.group,
      pkgName,
      version,
      tier,
      cliCommand: cliCmd ? `msx ${cliCmd}` : null,
      actions,
      capabilities: {
        parse: true,
        lint: hasLint,
        dae: hasDaeLowering,
        simulate: hasSimulate,
        projections: Array.from(new Set(projections)),
      },
      ruleCount,
    };
  });
}

const outputPath = path.resolve(__dirname, "../docs/.vitepress/theme/data/languages.generated.json");

if (process.argv.includes("--check")) {
  const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : "";
  const next = JSON.stringify(generateLanguagesManifest(), null, 2) + "\n";
  if (current !== next) {
    console.error("languages.generated.json is out of date. Run `npm run gen:lang` to update.");
    process.exit(1);
  }
  console.log("✓ languages.generated.json is up to date.");
  process.exit(0);
}

const data = generateLanguagesManifest();
fs.writeFileSync(outputPath, JSON.stringify(data, null, 2) + "\n", "utf8");
console.log(`✓ Wrote ${data.length} language manifests to ${outputPath}`);
