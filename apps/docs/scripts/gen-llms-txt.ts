// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Generates public/llms.txt and public/llms-full.txt following the llmstxt.org specification.
// Run with `npm run gen:llms`; `--check` fails if outputs are stale.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { INDUSTRIES } from "../docs/.vitepress/theme/data/industries.js";
import { LANGUAGES } from "../docs/.vitepress/theme/data/languages.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const docsRoot = path.resolve(here, "../docs");
const publicRoot = path.resolve(docsRoot, "public");
const llmsTxtPath = path.resolve(publicRoot, "llms.txt");
const llmsFullTxtPath = path.resolve(publicRoot, "llms-full.txt");

const cliJsonPath = path.join(docsRoot, ".vitepress/theme/data/cli.generated.json");
const lintJsonPath = path.join(docsRoot, ".vitepress/theme/data/lint-rules.generated.json");
const langJsonPath = path.join(docsRoot, ".vitepress/theme/data/languages.generated.json");

interface CliOpt {
  name: string;
  aliases?: string[];
  type?: string;
  description?: string;
  default?: unknown;
  choices?: string[];
}

interface CliCmd {
  name: string;
  specs?: string[];
  aliases?: string[];
  describe?: string;
  positionals?: CliOpt[];
  options?: CliOpt[];
  subcommands?: CliCmd[];
}

interface LintRule {
  code: string;
  rule: string;
  severity: string;
  message?: string;
  description?: string;
}

interface LangRules {
  slug: string;
  name: string;
  rules: LintRule[];
}

interface LangData {
  slug: string;
  name: string;
  ext: string;
  role: string;
  group: string;
  cli: string;
  capabilities: {
    parse: boolean;
    lint: boolean;
    dae?: boolean;
    arena?: boolean;
    simulate: boolean;
    projections: string[] | boolean;
  };
}

const cliCommands: CliCmd[] = JSON.parse(fs.readFileSync(cliJsonPath, "utf8"));
const lintCatalogs: LangRules[] = JSON.parse(fs.readFileSync(lintJsonPath, "utf8"));
const langManifest: LangData[] = JSON.parse(fs.readFileSync(langJsonPath, "utf8"));

const cliMap = new Map<string, CliCmd>(cliCommands.map((c) => [c.name, c]));
const lintMap = new Map<string, LangRules>(lintCatalogs.map((c) => [c.slug, c]));

function formatCliBlock(cmdName: string, subName?: string): string {
  const root = cliMap.get(cmdName);
  if (!root) return `\`msx ${cmdName}${subName ? ` ${subName}` : ""}\``;

  let target: CliCmd = root;
  if (subName && root.subcommands) {
    const sub = root.subcommands.find((s) => s.name === subName || s.aliases?.includes(subName));
    if (sub) target = sub;
  }

  const lines: string[] = [];
  const usage = target.specs && target.specs.length > 0 ? target.specs[0] : `msx ${target.name}`;
  lines.push(`### CLI Command: \`${usage}\``);
  if (target.describe) lines.push(target.describe);
  lines.push("");

  if (target.options && target.options.length > 0) {
    lines.push("Options:");
    for (const opt of target.options) {
      const flags = [`--${opt.name}`, ...(opt.aliases ?? []).map((a) => (a.length === 1 ? `-${a}` : `--${a}`))].join(
        ", ",
      );
      const def = opt.default !== undefined ? ` (default: ${JSON.stringify(opt.default)})` : "";
      const type = opt.type ? ` <${opt.type}>` : "";
      lines.push(`  - \`${flags}${type}\`: ${opt.description || ""}${def}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function formatLintBlock(slug: string): string {
  const cat = lintMap.get(slug);
  if (!cat || cat.rules.length === 0) {
    return `*No static linter rules catalogued for \`${slug}\`.*`;
  }

  const lines: string[] = [];
  lines.push(`### Diagnostics for ${cat.name} (${cat.rules.length} rules)`);
  lines.push("| Code | Severity | Identifier | Summary |");
  lines.push("| :--- | :--- | :--- | :--- |");
  for (const r of cat.rules) {
    const msg = (r.description || r.message || "").replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");
    lines.push(`| \`${r.code}\` | ${r.severity} | \`${r.rule}\` | ${msg} |`);
  }
  lines.push("");
  return lines.join("\n");
}

function cleanMarkdown(raw: string): string {
  // 1. Strip YAML frontmatter
  let text = raw.replace(/^---[\r\n]+[\s\S]*?[\r\n]+---[\r\n]+/, "");

  // 2. Expand <CliCommand command="..." ... /> or <CliCommand name="..." ... />
  text = text.replace(/<CliCommand\s+(?:command|name)="([^"]+)"(?:\s+sub="([^"]+)")?[^>]*\/>/g, (_, cmd, sub) =>
    formatCliBlock(cmd, sub),
  );

  // 3. Expand <LintRules lang="..." ... /> or <LintRules language="..." ... />
  text = text.replace(/<LintRules\s+(?:lang|language)="([^"]+)"[^>]*\/>/g, (_, lang) => formatLintBlock(lang));

  // 4. Expand <CapabilityMatrix />
  text = text.replace(/<CapabilityMatrix[^>]*\/>/g, () => {
    const lines = [
      "### Polyglot Language Capability Matrix",
      "ModelScript supports 44 modeling, simulation, and engineering formats across 5 pipeline capabilities:",
      "| Language | Extension | Role | Parse | Lint | DAE Arena | Simulate | Projections |",
      "| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: |",
    ];
    for (const l of langManifest) {
      const c = l.capabilities;
      const hasDae = Boolean(c.dae ?? c.arena);
      const hasProjections = Array.isArray(c.projections) ? c.projections.length > 0 : Boolean(c.projections);
      lines.push(
        `| ${l.name} | \`${l.ext}\` | ${l.role} | ${c.parse ? "✓" : "—"} | ${c.lint ? "✓" : "—"} | ${
          hasDae ? "✓" : "—"
        } | ${c.simulate ? "✓" : "—"} | ${hasProjections ? "✓" : "—"} |`,
      );
    }
    return lines.join("\n");
  });

  // 5. Expand <Badge ... text="..." /> and <Badge>...</Badge>
  text = text.replace(/<Badge\s+[^>]*text="([^"]+)"[^>]*\/>/g, "[$1]");
  text = text.replace(/<Badge[^>]*>([^<]+)<\/Badge>/g, "[$1]");

  // 6. Decode <MermaidBlock code="..." />
  text = text.replace(/<MermaidBlock\s+code="([^"]+)"\s*\/>/g, (_, encoded) => {
    try {
      const code = decodeURIComponent(encoded);
      return `\`\`\`mermaid\n${code}\n\`\`\``;
    } catch {
      return "";
    }
  });

  // 7. Strip custom Vue components that don't produce LLM-readable text
  text = text.replace(
    /<\/?(?:ClientOnly|LanguageExplorer|IndustriesMegaMenu|IndustryPage|IndustryHero|IndustryGrid|HomeHero|HomeStats|HomeVsCode|NotFound)[^>]*>/g,
    "",
  );

  // 8. Strip HTML comments
  let prevText: string;
  do {
    prevText = text;
    text = text.replace(/<!--[\s\S]*?--!?>/g, "");
  } while (text !== prevText);

  // 9. Normalize multiple blank lines
  text = text.replace(/\n{3,}/g, "\n\n").trim();

  return text;
}

function buildLlmsTxt(): string {
  const lines: string[] = [
    "# ModelScript",
    "",
    "> Free, open-source computable digital thread for polyglot engineering and simulation. Imports 44 simulation and CAE formats, links them to requirements, solves DAEs/ODEs via a WebAssembly linear-memory arena, coordinates cross-domain co-simulation, and exports FMI 2.0/3.0 FMUs.",
    "",
    "## Quick Links",
    "- [Official Website](https://modelscript.org/)",
    "- [GitHub Repository](https://github.com/modelscript/modelscript)",
    "- [Full Documentation (Single File)](https://modelscript.org/llms-full.txt)",
    "",
    "## Guides & Learning",
    "- [Introduction](https://modelscript.org/guide/introduction): Architectural vision, computable digital thread, and key differentiators.",
    "- [Installation](https://modelscript.org/guide/installation): CLI installation, VS Code extension, and local setup.",
    "- [Getting Started](https://modelscript.org/guide/getting-started): First steps, project scaffolding, and simulation execution.",
    "- [AI Agents & MCP Workflows](https://modelscript.org/guide/ai-agents): Closed-loop AI engineering workflows and Model Context Protocol setup.",
    "- [CI/CD & GitHub Actions](https://modelscript.org/guide/ci-cd): Automated linting, formal verification, and SARIF code scanning.",
    "- [Embedding ModelScript](https://modelscript.org/guide/embedding): Headless programmatic usage in Node.js, browsers, and WebAssembly.",
    "- [Administration](https://modelscript.org/guide/administration): Enterprise deployment, licensing, and security disclosures.",
    "",
    "## Ansatz Platform (`ansatz.social`)",
    "- [Ansatz Platform Overview](https://modelscript.org/ansatz/overview): Federated social network, CAS package registry, and cloud HPC hub.",
    "- [ActivityPub Federation](https://modelscript.org/ansatz/federation): W3C ActivityPub S2S federation, WebFinger, and peer verification.",
    "- [Package Registry](https://modelscript.org/ansatz/package-registry): Content-addressable package registry with Ed25519 signatures and multi-lens manifests.",
    "- [Cloud HPC Simulation](https://modelscript.org/ansatz/cloud-hpc): Slurm HPC offload, WebGPU batched sweeps, and compute credit billing.",
    "- [Self-Hosting Guide](https://modelscript.org/ansatz/self-hosting): Docker Compose deployment profiles, Cloudflare Zero Trust tunnels, and hot SQLite backups.",
    "",
    "## Compiler Architecture & WebAssembly Runtime",
    "- [Architecture Overview](https://modelscript.org/architecture/overview): Salsa memoization, WASM linear memory DAE arena, and lowering pipeline.",
    "- [Monorepo & Taxonomy](https://modelscript.org/architecture/monorepo): Workspace organization, package boundaries, and dependency taxonomy.",
    "- [DAE Arena](https://modelscript.org/architecture/dae-arena): Struct-of-arrays linear memory DAE container for zero-overhead symbolic transformations.",
    "- [GLR Parser](https://modelscript.org/architecture/glr-parser): High-performance native WebAssembly generalized LR parser generator.",
    "- [Salsa Query Engine](https://modelscript.org/architecture/salsa-queries): Incremental memoization, dependency tracking, and Salsa cache backdating.",
    "- [Simulation Solvers](https://modelscript.org/architecture/simulation-solvers): SUNDIALS CVODE/IDA, BDF, Runge-Kutta, and WebGPU batched solver.",
    "- [Triple Graph Grammars](https://modelscript.org/architecture/tgg): Bidirectional schema synchronization and multi-language transformation.",
    "- [Theory Coordinator](https://modelscript.org/architecture/theory-coordinator): Cross-domain physical theory unification and ontology coordination.",
    "- [HIL & WASM Runtime](https://modelscript.org/architecture/hil-wasm-runtime): Hardware-in-the-loop and headless WebAssembly execution.",
  ];

  lines.push(
    "",
    "## Algorithms & Solvers Catalog",
    "- [Algorithms Catalog Overview](https://modelscript.org/algorithms/overview): Catalog of 16 symbolic and numerical algorithms.",
    "- [BLT Partitioning](https://modelscript.org/algorithms/blt): Block Lower Triangular decomposition, bipartite matching, and Tarjan SCC.",
    "- [Pantelides Index Reduction](https://modelscript.org/algorithms/pantelides): Structural index reduction for high-index DAEs to index-1 form.",
    "- [Algebraic Loop Tearing](https://modelscript.org/algorithms/tearing): Cellier tearing and minimal residual selection for nonlinear systems.",
    "- [Numerical Solvers (ODE/DAE)](https://modelscript.org/algorithms/solvers-ode-dae): Adaptive step-size numerical integrators and stiff solvers.",
    "- [Automatic Differentiation](https://modelscript.org/algorithms/autodiff): Forward and reverse mode algorithmic differentiation on arena expressions.",
    "- [Optimization & Optimal Control](https://modelscript.org/algorithms/optimization): Collocation, parameter estimation, and nonlinear programming.",
    "- [Surrogates & Linear Algebra](https://modelscript.org/algorithms/surrogates-linear-algebra): Dynamic mode decomposition, POD, and neural surrogates.",
    "- [Connector Balancing](https://modelscript.org/algorithms/connector-balancing): Kirchhoff current law and flow variable balance equations.",
    "- [Physical Theory Coordination](https://modelscript.org/algorithms/theory-coordinator): Multi-physics conservation laws and constitutive relations.",
    "- [Graph Rewriting & E-Graphs](https://modelscript.org/algorithms/graph-rewriting): E-graph rewriting and term normalization.",
    "- [Formal Verification & CHC](https://modelscript.org/algorithms/verification-chc): Constrained Horn Clauses and formal contract verification.",
    "- [Abstract Interpretation](https://modelscript.org/algorithms/abstract-interpretation): Interval arithmetic and sign domain safety analysis.",
    "- [SDP & BVP for CAD](https://modelscript.org/algorithms/sdp-bvp-cad): Boundary value problem solving on CSG and boundary representation geometry.",
    "- [Diagram Layout](https://modelscript.org/algorithms/diagram-layout): Orthogonal routing and hierarchical port placement.",
    "- [Linear Memory Structures](https://modelscript.org/algorithms/linear-memory-structures): Zero-allocation arena buffers and offset-based pointers.",
    "",
    "## Command-Line Interface (`msx`)",
    "- [CLI Overview](https://modelscript.org/cli/overview): Overview of the `msx` binary, global flags, and architecture.",
    "- [Commands Reference](https://modelscript.org/cli/commands): Comprehensive reference for all 91 CLI commands and subcommands.",
    "",
    "## Polyglot Languages (44 Formats)",
    "- [Polyglot Overview & Capability Matrix](https://modelscript.org/languages/overview): Cross-language capability matrix across all 44 formats.",
  );

  for (const l of LANGUAGES) {
    lines.push(`- [${l.name} (${l.ext})](https://modelscript.org/languages/${l.slug}): ${l.role}.`);
  }

  lines.push("", "## Engineering Industries (12 Sectors)");
  lines.push(
    "- [Industries Overview](https://modelscript.org/industries): Multi-domain solutions across 12 engineering sectors.",
  );
  for (const ind of INDUSTRIES) {
    const stds = ind.standards.slice(0, 3).join(", ");
    lines.push(`- [${ind.name}](https://modelscript.org/industries/${ind.slug}): ${ind.tagline} (${stds}).`);
  }

  lines.push(
    "",
    "## Reference & Tooling",
    "- [Linter Rules Catalog](https://modelscript.org/reference/linter-rules): Directory of 770+ diagnostics across 41 engineering languages.",
    "- [Export Formats](https://modelscript.org/reference/export-formats): Exporting to FMI 2.0/3.0 FMUs, SSP, STEP, CSV, and C code.",
    "- [MCP & IDE Integration](https://modelscript.org/reference/mcp-and-ide): Model Context Protocol server for AI coding agents and VS Code integration.",
    "",
  );

  return lines.join("\n");
}

function buildLlmsFullTxt(): string {
  const sections: { title: string; route: string; file?: string; body?: string }[] = [];

  // 1. Guides & Ansatz Platform
  const guides = [
    { title: "Introduction", route: "guide/introduction", file: "guide/introduction.md" },
    { title: "Installation", route: "guide/installation", file: "guide/installation.md" },
    { title: "Getting Started", route: "guide/getting-started", file: "guide/getting-started.md" },
    { title: "AI Agents & MCP Workflows", route: "guide/ai-agents", file: "guide/ai-agents.md" },
    { title: "CI/CD & GitHub Actions", route: "guide/ci-cd", file: "guide/ci-cd.md" },
    { title: "Embedding ModelScript", route: "guide/embedding", file: "guide/embedding.md" },
    { title: "Administration", route: "guide/administration", file: "guide/administration.md" },
    { title: "Ansatz Platform Overview", route: "ansatz/overview", file: "ansatz/overview.md" },
    { title: "ActivityPub Federation", route: "ansatz/federation", file: "ansatz/federation.md" },
    { title: "Package Registry", route: "ansatz/package-registry", file: "ansatz/package-registry.md" },
    { title: "Cloud HPC Simulation", route: "ansatz/cloud-hpc", file: "ansatz/cloud-hpc.md" },
    { title: "Self-Hosting Guide", route: "ansatz/self-hosting", file: "ansatz/self-hosting.md" },
  ];
  for (const g of guides) sections.push(g);

  // 2. Architecture
  const archs = [
    { title: "Compiler Architecture Overview", route: "architecture/overview", file: "architecture/overview.md" },
    { title: "Monorepo & Taxonomy", route: "architecture/monorepo", file: "architecture/monorepo.md" },
    { title: "DAE Arena in Linear Memory", route: "architecture/dae-arena", file: "architecture/dae-arena.md" },
    { title: "WASM GLR Parser", route: "architecture/glr-parser", file: "architecture/glr-parser.md" },
    { title: "Salsa Query Engine", route: "architecture/salsa-queries", file: "architecture/salsa-queries.md" },
    {
      title: "Simulation Solvers",
      route: "architecture/simulation-solvers",
      file: "architecture/simulation-solvers.md",
    },
    { title: "Triple Graph Grammars", route: "architecture/tgg", file: "architecture/tgg.md" },
    {
      title: "Theory Coordinator",
      route: "architecture/theory-coordinator",
      file: "architecture/theory-coordinator.md",
    },
    { title: "HIL & WASM Runtime", route: "architecture/hil-wasm-runtime", file: "architecture/hil-wasm-runtime.md" },
  ];
  for (const a of archs) sections.push(a);

  // 3. Algorithms
  const algs = [
    { title: "Algorithms Catalog Overview", route: "algorithms/overview", file: "algorithms/overview.md" },
    { title: "BLT Partitioning & Matching", route: "algorithms/blt", file: "algorithms/blt.md" },
    { title: "Pantelides Index Reduction", route: "algorithms/pantelides", file: "algorithms/pantelides.md" },
    { title: "Algebraic Loop Tearing", route: "algorithms/tearing", file: "algorithms/tearing.md" },
    { title: "ODE & DAE Solvers", route: "algorithms/solvers-ode-dae", file: "algorithms/solvers-ode-dae.md" },
    { title: "Automatic Differentiation", route: "algorithms/autodiff", file: "algorithms/autodiff.md" },
    { title: "Optimization & Optimal Control", route: "algorithms/optimization", file: "algorithms/optimization.md" },
    {
      title: "Surrogates & Linear Algebra",
      route: "algorithms/surrogates-linear-algebra",
      file: "algorithms/surrogates-linear-algebra.md",
    },
    {
      title: "Connector Balancing",
      route: "algorithms/connector-balancing",
      file: "algorithms/connector-balancing.md",
    },
    {
      title: "Physical Theory Coordination",
      route: "algorithms/theory-coordinator",
      file: "algorithms/theory-coordinator.md",
    },
    { title: "Graph Rewriting & E-Graphs", route: "algorithms/graph-rewriting", file: "algorithms/graph-rewriting.md" },
    {
      title: "Formal Verification & CHC",
      route: "algorithms/verification-chc",
      file: "algorithms/verification-chc.md",
    },
    {
      title: "Abstract Interpretation",
      route: "algorithms/abstract-interpretation",
      file: "algorithms/abstract-interpretation.md",
    },
    { title: "SDP & BVP for CAD", route: "algorithms/sdp-bvp-cad", file: "algorithms/sdp-bvp-cad.md" },
    { title: "Diagram Layout & Routing", route: "algorithms/diagram-layout", file: "algorithms/diagram-layout.md" },
    {
      title: "Linear Memory Structures",
      route: "algorithms/linear-memory-structures",
      file: "algorithms/linear-memory-structures.md",
    },
  ];
  for (const al of algs) sections.push(al);

  // 4. CLI Reference
  sections.push({ title: "CLI Overview", route: "cli/overview", file: "cli/overview.md" });
  sections.push({ title: "CLI Commands Reference", route: "cli/commands", file: "cli/commands.md" });

  // 5. Polyglot Languages
  sections.push({ title: "Polyglot Language Ecosystem", route: "languages/overview", file: "languages/overview.md" });
  for (const l of LANGUAGES) {
    sections.push({
      title: `${l.name} (${l.ext}) Language Reference`,
      route: `languages/${l.slug}`,
      file: `languages/${l.slug}.md`,
    });
  }

  // 6. Industries
  sections.push({ title: "Industries Solutions", route: "industries", file: "industries/index.md" });
  for (const ind of INDUSTRIES) {
    const indBody = [
      `# ${ind.name}`,
      "",
      `**Tagline:** ${ind.tagline}`,
      `**Summary:** ${ind.summary}`,
      `**Headline:** ${ind.headline}`,
      "",
      `**Target Languages:** ${ind.languages.map((l) => `\`${l}\``).join(", ")}`,
      `**Supported Standards:** ${ind.standards.join(", ")}`,
      "",
      "### Industry Challenges & Solutions",
      ...ind.pains.map((p) => `- **${p.title}:** ${p.body}`),
      "",
      "### Key Capabilities",
      ...ind.capabilities.map((c) => `- **${c.title}:** ${c.body}`),
      "",
      "### End-to-End Workflow",
      ...ind.workflow.map((w, idx) => `${idx + 1}. **${w.label}:** ${w.detail}`),
      "",
      "### Representative CLI Workflow",
      "```bash",
      ...ind.cli,
      "```",
    ].join("\n");

    sections.push({
      title: `${ind.name} Engineering Industry`,
      route: `industries/${ind.slug}`,
      body: indBody,
    });
  }

  // 7. Reference
  sections.push({ title: "Linter Rules Catalog", route: "reference/linter-rules", file: "reference/linter-rules.md" });
  sections.push({ title: "Export Formats", route: "reference/export-formats", file: "reference/export-formats.md" });
  sections.push({ title: "MCP & IDE Integration", route: "reference/mcp-and-ide", file: "reference/mcp-and-ide.md" });

  const out: string[] = [
    "# ModelScript Complete Documentation",
    "",
    "ModelScript: Free, open-source computable digital thread for polyglot engineering and simulation.",
    "Generated from source for LLM context ingestion.",
    "Website: https://modelscript.org/",
    "Repository: https://github.com/modelscript/modelscript",
    "",
    "================================================================================",
  ];

  for (const s of sections) {
    let body = "";
    if (s.file) {
      const fullPath = path.join(docsRoot, s.file);
      if (fs.existsSync(fullPath)) {
        const raw = fs.readFileSync(fullPath, "utf8");
        body = cleanMarkdown(raw);
      }
    } else if (s.body) {
      body = s.body;
    }

    out.push(
      "",
      "================================================================================",
      `DOCUMENT: ${s.title}`,
      `CANONICAL URL: https://modelscript.org/${s.route}`,
      "================================================================================",
      "",
      body,
    );
  }

  return `${out.join("\n")}\n`;
}

const llmsTxt = `${buildLlmsTxt()}\n`;
const llmsFullTxt = buildLlmsFullTxt();

if (process.argv.includes("--check")) {
  const currentTxt = fs.existsSync(llmsTxtPath) ? fs.readFileSync(llmsTxtPath, "utf8") : "";
  const currentFull = fs.existsSync(llmsFullTxtPath) ? fs.readFileSync(llmsFullTxtPath, "utf8") : "";

  let failed = false;
  if (currentTxt !== llmsTxt) {
    console.error("✖ llms.txt is out of date. Run `npm run gen:llms --workspace=@modelscript/docs`.");
    failed = true;
  }
  if (currentFull !== llmsFullTxt) {
    console.error("✖ llms-full.txt is out of date. Run `npm run gen:llms --workspace=@modelscript/docs`.");
    failed = true;
  }

  if (failed) process.exit(1);
  console.log("✓ llms.txt and llms-full.txt are up to date.");
} else {
  fs.writeFileSync(llmsTxtPath, llmsTxt, "utf8");
  fs.writeFileSync(llmsFullTxtPath, llmsFullTxt, "utf8");
  console.log(`✓ wrote ${path.relative(process.cwd(), llmsTxtPath)} (${(llmsTxt.length / 1024).toFixed(1)} KB)`);
  console.log(
    `✓ wrote ${path.relative(process.cwd(), llmsFullTxtPath)} (${(llmsFullTxt.length / 1024).toFixed(1)} KB)`,
  );
}
