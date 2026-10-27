// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Generates docs/.vitepress/theme/data/cli.generated.json from the real yargs
// command modules. Run with `npm run gen:cli`; `--check` fails if the file is stale.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type CommandMeta, loadCliMeta, type OptionMeta } from "./cli-meta.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const outFile = path.resolve(here, "../docs/.vitepress/theme/data/cli.generated.json");

function cleanOption(o: OptionMeta): OptionMeta {
  const out: OptionMeta = { name: o.name, aliases: o.aliases };
  if (o.type) out.type = o.type;
  if (o.description) out.description = o.description;
  if (o.choices) out.choices = o.choices;
  if (o.array) out.array = true;
  if (o.default !== undefined) {
    const json = JSON.stringify(o.default);
    if (json !== undefined && json.length < 80) out.default = o.default;
  }
  return out;
}

function clean(c: CommandMeta): CommandMeta {
  return {
    name: c.name,
    specs: c.specs,
    aliases: c.aliases,
    describe: c.describe,
    positionals: c.positionals.map(cleanOption),
    // Deduplicate options re-declared by shared builder helpers (last declaration wins, like yargs).
    options: [...new Map(c.options.map((o) => [o.name, cleanOption(o)])).values()],
    subcommands: c.subcommands.map(clean),
  };
}

const meta = await loadCliMeta();
const broken = meta.filter((m) => m.error);
if (broken.length) {
  for (const b of broken) console.error(`✖ ${b.name}: ${b.error}`);
  process.exit(1);
}
const json = `${JSON.stringify(
  meta.map(clean).sort((a, b) => a.name.localeCompare(b.name)),
  null,
  2,
)}\n`;

if (process.argv.includes("--check")) {
  const current = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : "";
  if (current !== json) {
    console.error("✖ cli.generated.json is out of date. Run `npm run gen:cli --workspace=@modelscript/docs`.");
    process.exit(1);
  }
  console.log("✓ cli.generated.json is up to date.");
} else {
  fs.writeFileSync(outFile, json);
  console.log(`✓ wrote ${path.relative(process.cwd(), outFile)} (${meta.length} commands).`);
}
process.exit(0);
