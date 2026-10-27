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
//
// CLI facts come from data/cli.generated.json (scripts/gen-cli-data.ts), which
// is itself generated from the yargs command modules.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const docsRoot = path.resolve(here, "../docs");
const cliJson = path.join(docsRoot, ".vitepress/theme/data/cli.generated.json");
const lintJson = path.join(docsRoot, ".vitepress/theme/data/lint-rules.generated.json");
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

function checkWording(file: string, line: number, text: string): void {
  const m = bannedWords.exec(text);
  if (m) problems.push({ file, line, message: `avoid unsubstantiated wording '${m[1] ?? ""}'` });
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
    const codes = pageCommand ? ruleCodes.get(pageCommand) : undefined;
    if (codes && !inFence) {
      for (const m of text.matchAll(/`([A-Z]\d{4})`/g)) {
        if (!codes.has(m[1] ?? "")) {
          problems.push({
            file: rel,
            line,
            message: `rule code '${m[1] ?? ""}' is not in the ${pageCommand ?? ""} rule catalog`,
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

if (problems.length) {
  for (const p of problems) console.error(`${p.file}:${p.line}  ${p.message}`);
  console.error(`\n✖ ${problems.length} docs problem(s) found.`);
  process.exit(1);
}
console.log(`✓ docs check passed (${cli.size} CLI commands known).`);
