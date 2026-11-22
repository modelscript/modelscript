// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Content checks for the docs site. Run with `npm run check --workspace=@modelscript/docs`.
//
//  1. No `file://` links or absolute local paths in published markdown.
//  2. Every `msx …` example (markdown shell blocks and theme snippets) uses a
//     real command, a real action, real `--options` and allowed option values.
//  3. Hand-written action / option tables only list things the CLI accepts.
//  4. No unsubstantiated marketing words ("seamless", "sub-millisecond", …).
//  5. Rule codes cited on a language page (`M7101`) exist in that language's rule catalog.
//  6. Hard-coded language / tier counts ("90 formats", "25 Stable & 65 Beta") match the catalogue.
//
// CLI facts come from data/cli.generated.json (scripts/gen-cli-data.ts), which
// is itself generated from the yargs command modules.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { INDUSTRIES, INDUSTRY_BY_SLUG } from "../docs/.vitepress/theme/data/industries.js";
import { LANGUAGE_BY_SLUG, LANGUAGES } from "../docs/.vitepress/theme/data/languages.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const docsRoot = path.resolve(here, "../docs");
const repoRoot = path.resolve(here, "../../..");
const cliJson = path.join(docsRoot, ".vitepress/theme/data/cli.generated.json");
const lintJson = path.join(docsRoot, ".vitepress/theme/data/lint-rules.generated.json");
const examplesJson = path.join(docsRoot, ".vitepress/theme/data/language-examples.generated.json");
const mcpToolsJson = path.join(docsRoot, ".vitepress/theme/data/mcp-tools.generated.json");
const ruleCodes = new Map(
  (JSON.parse(fs.readFileSync(lintJson, "utf8")) as { slug: string; rules: { code: string }[] }[]).map((l) => [
    l.slug,
    new Set(l.rules.map((r) => r.code)),
  ]),
);

interface Problem {
  file: string;
  line: number;
  message: string;
}

const problems: Problem[] = [];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "public") continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.name.endsWith(".md")) out.push(p);
  }
  return out;
}

// ── CLI command catalogue ──────────────────────────────────────────────

interface OptMeta {
  name: string;
  aliases: string[];
  choices?: string[];
}
interface CmdMeta {
  name: string;
  specs: string[];
  aliases: string[];
  positionals: OptMeta[];
  options: OptMeta[];
  subcommands: CmdMeta[];
}

interface OptionSet {
  names: Set<string>;
  choices: Map<string, Set<string>>;
}

interface CliCommand {
  takesAction: boolean;
  actions: Set<string> | null;
  /** Options accepted by the command itself (plus any of its subcommands). */
  options: OptionSet | null;
  /** Options per nested subcommand, when the command is built from subcommand modules. */
  subOptions: Map<string, OptionSet>;
}

const GLOBAL_OPTIONS = ["daemon", "help", "version", "h"];

function optionSet(...lists: OptMeta[][]): OptionSet {
  const names = new Set<string>(GLOBAL_OPTIONS);
  const choices = new Map<string, Set<string>>();
  for (const o of lists.flat()) {
    for (const n of [o.name, ...o.aliases]) {
      names.add(n);
      // yargs accepts both kebab-case and camelCase spellings.
      names.add(n.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()));
      if (o.choices) choices.set(n, new Set([...(choices.get(n) ?? []), ...o.choices]));
    }
  }
  return { names, choices };
}

function loadCli(): Map<string, CliCommand> {
  const data = JSON.parse(fs.readFileSync(cliJson, "utf8")) as CmdMeta[];
  const commands = new Map<string, CliCommand>();
  for (const c of data) {
    const choices = c.positionals.find((p) => p.name === "action")?.choices;
    const subOptions = new Map(c.subcommands.map((s) => [s.name, optionSet(s.options, s.positionals)]));
    const entry: CliCommand = {
      takesAction: c.specs.some((s) => s.split(/\s+/)[1] === "<action>") || c.subcommands.length > 0,
      actions: choices ? new Set(choices) : c.subcommands.length ? new Set(c.subcommands.map((s) => s.name)) : null,
      options: optionSet(c.options, ...c.subcommands.map((s) => s.options)),
      subOptions,
    };
    const names = [...c.specs.map((s) => s.split(/\s+/)[0] ?? ""), ...c.aliases].filter(Boolean);
    for (const n of names) commands.set(n, entry);
  }
  return commands;
}

// ── Checks ─────────────────────────────────────────────────────────────

const cli = loadCli();
const shellFence = /^```(bash|sh|shell|console|zsh)\b/;
const msxLine = /^\s*(?:\$\s+)?(?:npx\s+(?:-y\s+)?)?(?:msx|modelscript)\s+([a-z][a-z0-9-]*)(?:\s+([a-z][a-z0-9-]*))?/;
// Claims that need a benchmark to back them up, or that say nothing.
const bannedWords =
  /\b(seamless(?:ly)?|sub-millisecond|blazing(?:ly)?(?:[- ]fast)?|instant(?:ly)?|world'?s first|revolutionary|game[- ]changing)\b/i;
// Known factual errors that must never regress across docs or theme catalogs.
const stalePatterns: { regex: RegExp; reason: string }[] = [
  { regex: /\bIEEE\s+1857\b/i, reason: "IEEE 1857 is video coding; Verilog-A/AMS is Accellera" },
  { regex: /\bCAPE-OPEN\b/i, reason: "CAPE-OPEN is not implemented in packages/exchange or Aspen/gPROMS" },
  {
    regex: /PowerFactory[^\n]*\.dgs|\.dgs[^\n]*PowerFactory/i,
    reason: "PowerFactory parser reads .dz/.pfd/.xml/.dsl, not .dgs",
  },
];

function checkWording(file: string, line: number, text: string): void {
  const m = bannedWords.exec(text);
  if (m) problems.push({ file, line, message: `avoid unsubstantiated wording '${m[1] ?? ""}'` });
  for (const pat of stalePatterns) {
    if (pat.regex.test(text)) {
      problems.push({ file, line, message: `stale/inaccurate claim: ${pat.reason}` });
    }
  }
}

function checkInvocation(file: string, line: number, name: string, action: string | undefined, rest = ""): void {
  const cmd = cli.get(name);
  if (!cmd) {
    problems.push({ file, line, message: `unknown CLI command 'msx ${name}'` });
    return;
  }
  if (cmd.takesAction && cmd.actions && action && !cmd.actions.has(action)) {
    problems.push({
      file,
      line,
      message: `'msx ${name} ${action}' is not a valid action (expected one of: ${[...cmd.actions].join(", ")})`,
    });
  }
  const opts = (action && cmd.subOptions.get(action)) || cmd.options;
  if (!opts) return;
  for (const m of rest.matchAll(/(?:^|\s)--(?:no-)?([a-zA-Z][a-zA-Z0-9-]*)(?:[=\s]+([^\s-][^\s]*))?/g)) {
    const flag = m[1] ?? "";
    if (!opts.names.has(flag)) {
      problems.push({
        file,
        line,
        message: `'msx ${name}${action && cmd.subOptions.has(action) ? ` ${action}` : ""}' has no option '--${flag}'`,
      });
      continue;
    }
    const allowed = opts.choices.get(flag);
    const value = (m[2] ?? "").replace(/^["']|["']$/g, "");
    if (allowed && value && !allowed.has(value)) {
      problems.push({
        file,
        line,
        message: `'msx ${name} --${flag} ${value}' is not allowed (expected one of: ${[...allowed].join(", ")})`,
      });
    }
  }
  for (const m of rest.matchAll(/(?:^|\s)-([a-zA-Z])(?=\s|=|$)/g)) {
    const shortFlag = m[1] ?? "";
    if (!opts.names.has(shortFlag)) {
      problems.push({
        file,
        line,
        message: `'msx ${name}${action && cmd.subOptions.has(action) ? ` ${action}` : ""}' has no short option '-${shortFlag}'`,
      });
    }
  }
}

for (const file of walk(docsRoot)) {
  const rel = path.relative(docsRoot, file);
  const lines = fs.readFileSync(file, "utf8").split("\n");
  let inShell = false;
  let inFence = false;
  // Language pages document the command named after the file (e.g. languages/urdf.md → `msx urdf`).
  const pageCommand = rel.startsWith(`languages${path.sep}`) ? path.basename(rel, ".md") : null;
  let section: string | null = pageCommand;
  let inActionTable = false;
  lines.forEach((text, i) => {
    const line = i + 1;
    if (!inFence) {
      const heading = /^#{2,4}\s+`([a-z][a-z0-9-]*)`/.exec(text);
      if (heading) section = heading[1] ?? null;
      else if (/^#{1,4}\s/.test(text)) section = pageCommand;
      if (/^\|\s*Action\s*\|/i.test(text)) inActionTable = true;
      else if (!text.startsWith("|")) inActionTable = false;
      // Option table rows: | `-m, --model <name>` | … → every --flag must exist on the command.
      const optCell = /^\|\s*`([^`]*--[^`]*)`\s*\|/.exec(text);
      const optCmd = section ? cli.get(section) : undefined;
      if (optCell && optCmd?.options) {
        for (const f of (optCell[1] ?? "").matchAll(/--(?:no-)?([a-zA-Z][a-zA-Z0-9-]*)/g)) {
          if (!optCmd.options.names.has(f[1] ?? "")) {
            problems.push({
              file: rel,
              line,
              message: `option table lists '--${f[1] ?? ""}' but 'msx ${section ?? ""}' has no such option`,
            });
          }
        }
      }
      const row = /^\|\s*\*{0,2}`([a-z][a-z0-9-]*)`\*{0,2}\s*\|/.exec(text);
      const cmd = section ? cli.get(section) : undefined;
      if (inActionTable && row && cmd?.takesAction && cmd.actions && !cmd.actions.has(row[1] ?? "")) {
        problems.push({
          file: rel,
          line,
          message: `action table lists '${row[1] ?? ""}' but 'msx ${section ?? ""}' accepts: ${[...cmd.actions].join(", ")}`,
        });
      }
    }
    if (/^```/.test(text)) {
      if (inFence) {
        inFence = false;
        inShell = false;
      } else {
        inFence = true;
        inShell = shellFence.test(text);
      }
      return;
    }
    if (/file:\/\/\//.test(text) || /(^|[\s("'`])\/home\/[a-z]/.test(text)) {
      problems.push({ file: rel, line, message: "local file:// link or absolute /home path" });
    }
    if (!inFence) checkWording(rel, line, text);
    const ruleCatalogSlug = pageCommand?.endsWith("-lints") ? pageCommand.replace(/-lints$/, "") : pageCommand;
    const codes = ruleCatalogSlug ? ruleCodes.get(ruleCatalogSlug) : undefined;
    if (codes && !inFence) {
      for (const m of text.matchAll(/`([A-Z]\d{4})`/g)) {
        if (!codes.has(m[1] ?? "")) {
          problems.push({
            file: rel,
            line,
            message: `rule code '${m[1] ?? ""}' is not in the ${ruleCatalogSlug ?? ""} rule catalog`,
          });
        }
      }
    }
    if (!inShell) return;
    const m = msxLine.exec(text);
    if (m) checkInvocation(rel, line, m[1] ?? "", m[2], text.replace(/\s#.*$/, ""));
  });
}

// Theme data and components carry CLI snippets for the landing and industry pages.
const themeRoot = path.join(docsRoot, ".vitepress/theme");
const themeFiles = ["data", "components"].flatMap((d) =>
  fs
    .readdirSync(path.join(themeRoot, d))
    .filter((f) => /\.(ts|vue)$/.test(f))
    .map((f) => path.join(themeRoot, d, f)),
);
const snippet = /(?:["'`>]|\$\s)msx\s+([a-z][a-z0-9-]*)(?:\s+([a-z][a-z0-9-]*))?/g;
for (const file of themeFiles) {
  const rel = path.relative(docsRoot, file);
  fs.readFileSync(file, "utf8")
    .split("\n")
    .forEach((text, i) => {
      checkWording(rel, i + 1, text);
      for (const m of text.matchAll(snippet)) {
        const tail = text.slice(m.index ?? 0).split(/["'`<]/)[1] ?? "";
        checkInvocation(rel, i + 1, m[1] ?? "", m[2], text.slice(m.index ?? 0, (m.index ?? 0) + 1 + tail.length));
      }
    });
}

// ── Language-count & tier parity claims ─────────────────────────────────
// Prose such as "92 engineering formats" or "(26 Stable & 66 Beta)" is
// matched against the generated language catalogue so it cannot go stale,
// and hand-authored `languages.ts` tiers must match `languages.generated.json`.

const languagesJson = path.join(themeRoot, "data/languages.generated.json");
const languageCatalog = JSON.parse(fs.readFileSync(languagesJson, "utf8")) as { slug: string; tier: string }[];
const languageTotal = languageCatalog.length;
const tierTotals = new Map<string, number>();
const generatedTierBySlug = new Map<string, string>();
for (const l of languageCatalog) {
  tierTotals.set(l.tier, (tierTotals.get(l.tier) ?? 0) + 1);
  generatedTierBySlug.set(l.slug, l.tier);
}

for (const lang of LANGUAGES) {
  const expectedTier = generatedTierBySlug.get(lang.slug);
  if (!expectedTier) {
    problems.push({
      file: ".vitepress/theme/data/languages.ts",
      line: 1,
      message: `language '${lang.slug}' missing from languages.generated.json`,
    });
  } else if (expectedTier !== lang.tier) {
    problems.push({
      file: ".vitepress/theme/data/languages.ts",
      line: 1,
      message: `tier mismatch for '${lang.slug}': languages.ts has '${lang.tier}' vs languages.generated.json '${expectedTier}'`,
    });
  }
}

// "<N> [engineering|polyglot|supported|registered|…] languages|formats"
const countClaim =
  /\b(\d{2,3})\+?[\s-]+(?:(?:engineering|polyglot|supported|registered|open|domain|ModelScript|scientific|language|format)\s+){0,3}(?:languages?|formats?|format parsers|language parsers)\b/gi;
// "26 Beta & 66 Alpha" / "26 beta, 66 alpha"
const tierClaim = /\b(\d{1,3})\s+(Beta|Alpha|Pre-Alpha)\b/gi;

function checkLanguageCounts(rel: string, line: number, text: string): void {
  for (const m of text.matchAll(countClaim)) {
    const n = Number(m[1]);
    // Only numbers close to the real total are language-count claims; other
    // figures ("12 file formats", "8 domain clusters") are unrelated.
    if (n !== languageTotal && n >= languageTotal - 15 && n <= languageTotal + 15) {
      problems.push({
        file: rel,
        line,
        message: `language count '${m[0]}' is stale; the catalogue has ${languageTotal} languages`,
      });
    }
  }
  for (const m of text.matchAll(tierClaim)) {
    const expected = tierTotals.get((m[2] ?? "").toLowerCase());
    if (expected !== undefined && Number(m[1]) !== expected && Number(m[1]) >= 10) {
      problems.push({
        file: rel,
        line,
        message: `tier count '${m[0]}' is stale; the catalogue has ${expected} ${m[2]?.toLowerCase() ?? ""}`,
      });
    }
  }
}

// The linter-rules page counts languages that ship a lint catalogue (a subset
// of all languages), so its figure is intentionally different.
const languageCountExempt = new Set(["reference/linter-rules.md"]);
for (const file of [...walk(docsRoot), ...themeFiles]) {
  const rel = path.relative(docsRoot, file);
  if (languageCountExempt.has(rel)) continue;
  fs.readFileSync(file, "utf8")
    .split("\n")
    .forEach((text, i) => checkLanguageCounts(rel, i + 1, text));
}

// ── Language benchmark coverage ─────────────────────────────────────────
const benchmarksJson = path.join(themeRoot, "data/benchmarks.generated.json");
const benchData = fs.existsSync(benchmarksJson)
  ? (JSON.parse(fs.readFileSync(benchmarksJson, "utf8")) as {
      catalogById: Record<string, unknown>;
      languages: { slug: string }[];
    })
  : null;
if (benchData) {
  const benchSlugs = new Set(benchData.languages.map((l) => l.slug));
  const langPagesDir = path.join(docsRoot, "languages");
  for (const file of fs.readdirSync(langPagesDir)) {
    if (!file.endsWith(".md") || file === "overview.md") continue;
    const slug = file.replace(/\.md$/, "");
    if (!LANGUAGE_BY_SLUG[slug]) continue;
    const content = fs.readFileSync(path.join(langPagesDir, file), "utf8");
    if (!content.includes(`<LanguageBenchmarks lang="${slug}"`)) {
      problems.push({
        file: `languages/${file}`,
        line: 1,
        message: `missing '<LanguageBenchmarks lang="${slug}" />' section`,
      });
    } else if (benchSlugs.size > 0 && !benchSlugs.has(slug)) {
      problems.push({
        file: `languages/${file}`,
        line: 1,
        message: `slug '${slug}' missing from benchmarks.generated.json (run 'npm run bench:languages:record')`,
      });
    }
  }
}

// ── MCP tool count parity ───────────────────────────────────────────────
const mcpTools = fs.existsSync(mcpToolsJson)
  ? (JSON.parse(fs.readFileSync(mcpToolsJson, "utf8")) as {
      toolCount: number;
      tools: { name: string }[];
    })
  : null;
const mcpToolNames = new Set(mcpTools?.tools.map((t) => t.name) ?? []);
if (mcpTools) {
  const mcpDocPath = path.join(docsRoot, "reference/mcp-and-ide.md");
  if (fs.existsSync(mcpDocPath)) {
    const mcpLines = fs.readFileSync(mcpDocPath, "utf8").split("\n");
    mcpLines.forEach((text, i) => {
      for (const m of text.matchAll(/\b(\d{2,3})\s+(?:Model Context Protocol|specialized)?\s*tools\b/gi)) {
        const claimed = Number(m[1]);
        if (claimed >= 80 && claimed <= 200 && claimed !== mcpTools.toolCount) {
          problems.push({
            file: "reference/mcp-and-ide.md",
            line: i + 1,
            message: `MCP tool count '${m[0]}' is stale; mcp-tools.generated.json has ${mcpTools.toolCount} tools`,
          });
        }
      }
    });
  }
}

// ── Industry catalog integrity & cross-references ───────────────────────
const exampleBySlug = new Map(
  (
    JSON.parse(fs.readFileSync(examplesJson, "utf8")) as {
      slug: string;
      svgDark?: string;
      svgLight?: string;
      permalinkToken?: string;
    }[]
  ).map((e) => [e.slug, e]),
);
const benchCatalogIds = new Set(Object.keys(benchData?.catalogById ?? {}));

function docsRouteExists(route: string): boolean {
  const clean = route.split("#")[0]?.replace(/^\//, "") ?? "";
  if (!clean) return fs.existsSync(path.join(docsRoot, "index.md"));
  return fs.existsSync(path.join(docsRoot, `${clean}.md`)) || fs.existsSync(path.join(docsRoot, clean, "index.md"));
}

const industriesRel = ".vitepress/theme/data/industries.ts";
for (const ind of INDUSTRIES) {
  const indLangs = new Set(ind.languages);
  for (const slug of ind.languages) {
    if (!LANGUAGE_BY_SLUG[slug]) {
      problems.push({ file: industriesRel, line: 1, message: `${ind.slug}: unknown language '${slug}'` });
    }
  }

  for (const cliCmd of ind.cli) {
    const m = /^(?:msx|modelscript)\s+([a-z][a-z0-9-]*)(?:\s+([a-z][a-z0-9-]*))?/.exec(cliCmd);
    if (!m) {
      problems.push({ file: industriesRel, line: 1, message: `${ind.slug}: invalid CLI snippet '${cliCmd}'` });
    } else {
      checkInvocation(industriesRel, 1, m[1] ?? "", m[2], cliCmd);
    }
  }

  if (ind.tracks) {
    const seenTrackIds = new Set<string>();
    for (const track of ind.tracks) {
      if (seenTrackIds.has(track.id)) {
        problems.push({ file: industriesRel, line: 1, message: `${ind.slug}: duplicate track id '${track.id}'` });
      }
      seenTrackIds.add(track.id);
      for (const slug of track.languages) {
        if (!indLangs.has(slug)) {
          problems.push({
            file: industriesRel,
            line: 1,
            message: `${ind.slug}: track '${track.id}' references '${slug}' not in industry.languages`,
          });
        }
      }
    }
  }

  if (!ind.featuredExamples.length) {
    problems.push({ file: industriesRel, line: 1, message: `${ind.slug}: featuredExamples must not be empty` });
  }
  for (const exSlug of ind.featuredExamples) {
    if (!indLangs.has(exSlug)) {
      problems.push({
        file: industriesRel,
        line: 1,
        message: `${ind.slug}: featuredExample '${exSlug}' is not in industry.languages`,
      });
    }
    const ex = exampleBySlug.get(exSlug);
    if (!ex || !ex.svgDark || !ex.svgLight || !ex.permalinkToken) {
      problems.push({
        file: industriesRel,
        line: 1,
        message: `${ind.slug}: featuredExample '${exSlug}' missing code/SVG/permalink in language-examples.generated.json`,
      });
    }
  }

  for (const suiteId of ind.benchmarkSuites) {
    if (benchCatalogIds.size > 0 && !benchCatalogIds.has(suiteId)) {
      problems.push({
        file: industriesRel,
        line: 1,
        message: `${ind.slug}: unknown benchmark suite '${suiteId}' (not in benchmarks.generated.json)`,
      });
    }
  }

  for (const ws of ind.workspaces ?? []) {
    const wsAbs = path.resolve(repoRoot, ws.path);
    if (!fs.existsSync(wsAbs)) {
      problems.push({
        file: industriesRel,
        line: 1,
        message: `${ind.slug}: workspace path '${ws.path}' does not exist on disk`,
      });
    }
    for (const slug of ws.languages) {
      if (!LANGUAGE_BY_SLUG[slug]) {
        problems.push({
          file: industriesRel,
          line: 1,
          message: `${ind.slug}: workspace '${ws.name}' references unknown language '${slug}'`,
        });
      }
    }
  }

  for (const tool of ind.mcpTools) {
    if (mcpToolNames.size > 0 && !mcpToolNames.has(tool)) {
      problems.push({
        file: industriesRel,
        line: 1,
        message: `${ind.slug}: unknown MCP tool '${tool}' (not in mcp-tools.generated.json)`,
      });
    }
  }

  for (const link of ind.compliance.docsLinks) {
    if (!docsRouteExists(link.to)) {
      problems.push({
        file: industriesRel,
        line: 1,
        message: `${ind.slug}: compliance docsLink '${link.to}' does not resolve to a docs page`,
      });
    }
  }

  for (const relRef of ind.relatedSlugs) {
    if (relRef.slug === ind.slug || !INDUSTRY_BY_SLUG[relRef.slug]) {
      problems.push({
        file: industriesRel,
        line: 1,
        message: `${ind.slug}: invalid relatedSlugs target '${relRef.slug}'`,
      });
    }
  }

  const stdText = ind.standards.join("\n");
  if (/\bReqIF\b/i.test(stdText) && !indLangs.has("reqif")) {
    problems.push({
      file: industriesRel,
      line: 1,
      message: `${ind.slug}: lists ReqIF in standards without 'reqif' language`,
    });
  }
  if (/\bSSP\s+1\.0\b/i.test(stdText) && !indLangs.has("ssp")) {
    problems.push({
      file: industriesRel,
      line: 1,
      message: `${ind.slug}: lists SSP 1.0 in standards without 'ssp' language`,
    });
  }
  if (/\bSysML\b/i.test(stdText) && !indLangs.has("sysml2")) {
    problems.push({
      file: industriesRel,
      line: 1,
      message: `${ind.slug}: lists SysML in standards without 'sysml2' language`,
    });
  }
  if (/\bAUTOSAR\b/i.test(stdText) && !indLangs.has("autosar")) {
    problems.push({
      file: industriesRel,
      line: 1,
      message: `${ind.slug}: lists AUTOSAR in standards without 'autosar' language`,
    });
  }
}

// ── Workspace languages/* parity check ─────────────────────────────────
const langsDir = path.join(repoRoot, "languages");
if (fs.existsSync(langsDir)) {
  for (const entry of fs.readdirSync(langsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    const pkgPath = path.join(langsDir, slug, "package.json");
    if (!fs.existsSync(pkgPath)) continue;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      modelscript?: { tier?: string };
    };
    const pkgTier = pkg.modelscript?.tier;
    if (slug === "modelscript" && !LANGUAGE_BY_SLUG[slug]) {
      // Intentionally hidden unless SHOW_MODELSCRIPT_LANG is enabled
      continue;
    }
    const docEntry = LANGUAGE_BY_SLUG[slug];
    if (!docEntry) {
      problems.push({
        file: ".vitepress/theme/data/languages.ts",
        line: 1,
        message: `workspace language 'languages/${slug}' is missing from languages.ts`,
      });
      continue;
    }
    if (pkgTier && docEntry.tier !== pkgTier) {
      problems.push({
        file: ".vitepress/theme/data/languages.ts",
        line: 1,
        message: `'${slug}' tier in languages.ts ('${docEntry.tier}') does not match languages/${slug}/package.json ('${pkgTier}')`,
      });
    }
    const langDocPath = path.join(docsRoot, "languages", `${slug}.md`);
    if (!fs.existsSync(langDocPath)) {
      problems.push({
        file: `languages/${slug}.md`,
        line: 1,
        message: `missing documentation page for workspace language '${slug}'`,
      });
    }
  }
}

if (problems.length) {
  for (const p of problems) console.error(`${p.file}:${p.line}  ${p.message}`);
  console.error(`\n✖ ${problems.length} docs problem(s) found.`);
  process.exit(1);
}
console.log(
  `✓ docs check passed (${cli.size} CLI commands, ${INDUSTRIES.length} industries, ${LANGUAGES.length} languages).`,
);
