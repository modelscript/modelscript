// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Generates the lint-rule reference from the rule catalogs in `languages/*`.
//
//   npx tsx scripts/gen-lint-rules.ts           # write outputs
//   npx tsx scripts/gen-lint-rules.ts --check   # fail if outputs are stale
//
// Outputs:
//   docs/.vitepress/theme/data/lint-rules.generated.json   (used by <LintRules lang="…"/>)
//   docs/reference/linter-rules.md                        (searchable reference page)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";
import { LANGUAGES } from "../docs/.vitepress/theme/data/languages.js";
import { loadLintRules, repoRoot, type LanguageRules, type RuleMeta } from "./lint-meta.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const docsRoot = path.resolve(here, "../docs");
const jsonOut = path.join(docsRoot, ".vitepress/theme/data/lint-rules.generated.json");
const mdOut = path.join(docsRoot, "reference/linter-rules.md");
const cliJson = path.join(docsRoot, ".vitepress/theme/data/cli.generated.json");
const lintCommand = path.join(repoRoot, "apps/cli/src/commands/lint.ts");

/** Range titles taken from the numbering-scheme comments in each errors.ts. */
const RANGES: Record<string, Record<string, string>> = {
  modelica: {
    "1": "Syntax & parse",
    "2": "Name & scope resolution",
    "3": "Type system & operator / function signatures",
    "4": "Structural, inheritance, modification & connector semantics",
    "5": "Equations, algorithms & control-flow analysis",
    "6": "Synchronous clocks, state machines & purity",
  },
  sysml2: {
    "1": "Syntax, parsing & naming conventions",
    "2": "Scoping & name resolution",
    "3": "Type system & static checking",
    "4": "Structural & metamodel semantics",
    "5": "Behavior, state machines & formal verification",
  },
};

interface GeneratedLanguage {
  slug: string;
  name: string;
  packageName: string;
  sources: string[];
  /** How to run this linter from the CLI, if it is wired up. */
  cli: string | null;
  rules: RuleMeta[];
}

function msxLintLanguages(): Set<string> {
  const src = fs.readFileSync(lintCommand, "utf8");
  const ids = new Set(["modelica", "sysml2"]);
  for (const m of src.matchAll(/langId === "([a-z0-9-]+)"/g)) ids.add(m[1] ?? "");
  return ids;
}

function commandsWithLint(): Set<string> {
  const data = JSON.parse(fs.readFileSync(cliJson, "utf8")) as {
    name: string;
    positionals: { name: string; choices?: string[] }[];
    subcommands: { name: string }[];
  }[];
  const out = new Set<string>();
  for (const c of data) {
    const actions = c.positionals.find((p) => p.name === "action")?.choices ?? c.subcommands.map((s) => s.name);
    if (actions.includes("lint")) out.add(c.name);
  }
  return out;
}

function build(languages: LanguageRules[]): GeneratedLanguage[] {
  const viaLint = msxLintLanguages();
  const viaCommand = commandsWithLint();
  const order = new Map(LANGUAGES.map((l, i) => [l.slug, i]));
  return languages
    .map((l) => {
      const info = LANGUAGES.find((x) => x.slug === l.dir);
      const cli = viaLint.has(l.dir) ? "msx lint" : viaCommand.has(l.dir) ? `msx ${l.dir} lint` : null;
      return {
        slug: l.dir,
        name: info?.name ?? l.dir,
        packageName: l.packageName,
        sources: l.sources,
        cli,
        rules: l.rules,
      };
    })
    .sort((a, b) => (order.get(a.slug) ?? 999) - (order.get(b.slug) ?? 999) || a.name.localeCompare(b.name));
}

/** Languages that ship a linter but no exported rule catalog (codes are inline in the linter). */
function uncatalogued(cataloged: Set<string>): { slug: string; name: string }[] {
  const root = path.join(repoRoot, "languages");
  const hasLinter = (dir: string): boolean => {
    const src = path.join(root, dir, "src");
    if (!fs.existsSync(src)) return false;
    const stack = [src];
    while (stack.length) {
      const d = stack.pop()!;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) stack.push(path.join(d, e.name));
        else if (e.name.endsWith(".ts") && /lint/i.test(path.relative(src, path.join(d, e.name)))) return true;
      }
    }
    return false;
  };
  return fs
    .readdirSync(root)
    .filter((dir) => !cataloged.has(dir) && fs.existsSync(path.join(root, dir, "package.json")) && hasLinter(dir))
    .map((dir) => ({ slug: dir, name: LANGUAGES.find((l) => l.slug === dir)?.name ?? dir }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ── Markdown rendering ────────────────────────────────────────────────

/** Escapes text for a markdown table cell that VitePress compiles as a Vue template. */
function cell(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\|/g, "\\|")
    .replace(/[{}$*_`\\[\]]/g, (c) => `&#${c.charCodeAt(0)};`)
    .replace(/&lt;([A-Za-z_$][\w$]*)&gt;/g, "<code>&lt;$1&gt;</code>");
}

const BADGE: Record<string, string> = {
  error: "danger",
  warning: "warning",
  info: "info",
  hint: "tip",
  notification: "info",
};

export function anchor(slug: string, code: string): string {
  return `${slug}-${code}`.toLowerCase();
}

function table(lang: GeneratedLanguage, rules: RuleMeta[], anchored: Set<string>): string[] {
  const lines = ["| Code | Rule | Severity | Message |", "| :--- | :--- | :--- | :--- |"];
  for (const r of rules) {
    const id = anchor(lang.slug, r.code);
    const a = anchored.has(id) ? "" : `<span id="${id}"></span>`;
    anchored.add(id);
    lines.push(
      `| ${a}\`${r.code}\` | \`${r.rule}\` | <Badge type="${BADGE[r.severity] ?? "info"}" text="${r.severity}" /> | ${cell(r.message)} |`,
    );
  }
  return lines;
}

function renderMarkdown(langs: GeneratedLanguage[]): string {
  const total = langs.reduce((n, l) => n + l.rules.length, 0);
  const out: string[] = [
    "---",
    "title: Linter Rules Reference",
    `description: Every diagnostic rule ModelScript ships — ${total} rules across ${langs.length} languages, with codes, severities and message templates generated from the source.`,
    "outline: [2, 2]",
    "pageClass: lint-reference",
    "---",
    "",
    "<!-- Generated by apps/docs/scripts/gen-lint-rules.ts from the rule catalogs in languages/*. Do not edit; run `npm run gen:lint --workspace=@modelscript/docs`. -->",
    "",
    "# Linter Rules Reference",
    "",
    `ModelScript ships **${total} diagnostic rules** across **${langs.length} languages**. This page is generated from each language's rule catalog (for example \`languages/modelica/src/errors.ts\`), so codes, severities and message templates match what the tools report. Text in \`<angle brackets>\` is filled in from your model.`,
    "",
    "## Running the linters",
    "",
    "Diagnostics appear as you type in VS Code and the web IDE through the language server. From the command line:",
    "",
    "```bash",
    "# Languages handled by the unified linter (detected by file extension)",
    "msx lint ./models",
    "msx lint ./models --format json --strict",
    "",
    "# Domain formats with their own command",
    "msx spice lint SensorFrontEnd.net",
    "```",
    "",
    "The **CLI** column below shows which command reports each language's rules.",
    "",
    "## Rule index",
    "",
    "| Language | Package | Rules | CLI |",
    "| :--- | :--- | ---: | :--- |",
    ...langs.map(
      (l) =>
        `| [${l.name}](#${l.slug}) | \`${l.packageName}\` | ${l.rules.length} | ${l.cli ? `\`${l.cli}\`` : "Language server / API"} |`,
    ),
    "",
  ];
  const missing = uncatalogued(new Set(langs.map((l) => l.slug)));
  if (missing.length) {
    out.push(
      "::: info Not yet listed",
      `These languages have linters whose rules are not exported as a catalog yet, so they can't be listed here: ${missing
        .map((m) => (LANGUAGES.some((l) => l.slug === m.slug) ? `[${m.name}](../languages/${m.slug}.md)` : m.name))
        .join(", ")}. See each language guide for details.`,
      ":::",
      "",
    );
  }
  for (const l of langs) {
    const info = LANGUAGES.find((x) => x.slug === l.slug);
    const page = info ? ` · [Language guide](../languages/${l.slug}.md)` : "";
    out.push(`## ${l.name} {#${l.slug}}`, "");
    out.push(
      `${info?.role ? `${info.role}. ` : ""}**${l.rules.length} rules** · \`${l.packageName}\` · Source: ${l.sources.map((s) => `\`${s}\``).join(", ")}${page}`,
      "",
    );
    const anchored = new Set<string>();
    const ranges = RANGES[l.slug];
    if (ranges) {
      const groups = new Map<string, RuleMeta[]>();
      for (const r of l.rules) {
        const digit = /\d/.exec(r.code)?.[0] ?? "?";
        groups.set(digit, [...(groups.get(digit) ?? []), r]);
      }
      const prefix = /^[A-Za-z]*/.exec(l.rules[0]?.code ?? "")?.[0] ?? "";
      for (const [digit, rules] of groups) {
        out.push(`**\`${prefix}${digit}xxx\` — ${ranges[digit] ?? "Other"}**`, "", ...table(l, rules, anchored), "");
      }
    } else {
      out.push(...table(l, l.rules, anchored), "");
    }
  }
  return out.join("\n");
}

// ── Main ─────────────────────────────────────────────────────────────

const { languages, failures } = await loadLintRules();
if (failures.length) {
  for (const f of failures) console.error(`✖ ${f}`);
  process.exit(1);
}
const langs = build(languages);
const json = JSON.stringify(langs, null, 2) + "\n";
const md = await prettier.format(renderMarkdown(langs), {
  ...((await prettier.resolveConfig(mdOut)) ?? {}),
  filepath: mdOut,
});

if (process.argv.includes("--check")) {
  const stale = [
    [jsonOut, json],
    [mdOut, md],
  ].filter(([file, content]) => !fs.existsSync(file!) || fs.readFileSync(file!, "utf8") !== content);
  if (stale.length) {
    for (const [file] of stale) console.error(`✖ ${path.relative(process.cwd(), file!)} is stale.`);
    console.error("  Run `npm run gen:lint --workspace=@modelscript/docs`.");
    process.exit(1);
  }
  console.log("✓ lint rule reference is up to date.");
} else {
  fs.writeFileSync(jsonOut, json);
  fs.writeFileSync(mdOut, md);
  const total = langs.reduce((n, l) => n + l.rules.length, 0);
  console.log(`✓ wrote ${total} rules for ${langs.length} languages.`);
}
