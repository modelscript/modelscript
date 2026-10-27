// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Extracts real CLI metadata (positionals, options, choices, subcommands) by
// loading each yargs command module registered in apps/cli/src/main.ts and
// running its `builder` against a recording stub instead of yargs.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const cliRoot = path.resolve(here, "../../cli/src");

export interface OptionMeta {
  name: string;
  aliases: string[];
  type?: string;
  description?: string;
  choices?: string[];
  default?: unknown;
  array?: boolean;
}

export interface CommandMeta {
  /** Primary command name, e.g. `spice`. */
  name: string;
  /** Usage specs as registered, e.g. `spice <action> [files..]`. */
  specs: string[];
  aliases: string[];
  describe: string;
  positionals: OptionMeta[];
  options: OptionMeta[];
  subcommands: CommandMeta[];
  /** Set when the module could not be loaded; metadata is then partial. */
  error?: string;
}

interface Registration {
  specs: string[];
  describe: string;
  importPath: string;
  exportName: string;
  aliases: string[];
}

const STR = /"((?:[^"\\]|\\.)*)"/g;

export function readRegistrations(): Registration[] {
  const main = fs.readFileSync(path.join(cliRoot, "main.ts"), "utf8");
  const out: Registration[] = [];
  for (const chunk of main.split(/\blazy\(/).slice(1)) {
    const m =
      /^\s*(\[(?:\s*"[^"]*"\s*,?)+\s*\]|"[^"]*")\s*,\s*((?:"(?:[^"\\]|\\.)*"\s*\+?\s*)+),\s*\(\)\s*=>\s*import\("(\.\/commands\/[^"]+)\.js"\)\s*,\s*"([A-Za-z0-9_]+)"\s*(?:,\s*(\[(?:\s*"[^"]*"\s*,?)+\s*\]|"[^"]*"))?/.exec(
        chunk,
      );
    if (!m) continue;
    const strings = (s: string | undefined) =>
      [...(s ?? "").matchAll(STR)].map((x) => (x[1] ?? "").replace(/\\"/g, '"'));
    out.push({
      specs: strings(m[1]),
      describe: strings(m[2]).join(""),
      importPath: m[3] ?? "",
      exportName: m[4] ?? "",
      aliases: strings(m[5]),
    });
  }
  return out;
}

function toOption(name: string, opts: Record<string, unknown> | undefined): OptionMeta {
  const o = opts ?? {};
  const alias = o["alias"];
  const meta: OptionMeta = {
    name,
    aliases: Array.isArray(alias) ? alias.map(String) : alias ? [String(alias)] : [],
  };
  if (typeof o["type"] === "string") meta.type = o["type"];
  const description = o["description"] ?? o["describe"] ?? o["desc"];
  if (typeof description === "string") meta.description = description;
  if (Array.isArray(o["choices"])) meta.choices = o["choices"].map(String);
  if (o["default"] !== undefined && typeof o["default"] !== "function") meta.default = o["default"];
  if (o["array"] === true) meta.array = true;
  return meta;
}

interface ModuleLike {
  command?: string | readonly string[];
  describe?: string | false;
  description?: string;
  aliases?: string | readonly string[];
  builder?: unknown;
}

function record(builder: unknown, target: CommandMeta): void {
  if (typeof builder === "object" && builder !== null) {
    for (const [name, opts] of Object.entries(builder))
      target.options.push(toOption(name, opts as Record<string, unknown>));
    return;
  }
  if (typeof builder !== "function") return;
  // A permissive stand-in for the yargs builder API: records what we need,
  // returns itself for everything else so chained calls keep working.
  const stub: Record<string, unknown> = new Proxy(
    {},
    {
      get(_t, prop: string) {
        switch (prop) {
          case "positional":
            return (name: string, opts?: Record<string, unknown>) => {
              target.positionals.push(toOption(name, opts));
              return stub;
            };
          case "option":
          case "options":
            return (name: string | Record<string, unknown>, opts?: Record<string, unknown>) => {
              if (typeof name === "string") target.options.push(toOption(name, opts));
              else
                for (const [k, v] of Object.entries(name))
                  target.options.push(toOption(k, v as Record<string, unknown>));
              return stub;
            };
          case "command":
            return (mod: unknown, describe?: unknown, subBuilder?: unknown) => {
              const sub = moduleMeta(
                typeof mod === "object" && mod !== null
                  ? (mod as ModuleLike)
                  : { command: mod as string, describe: describe as string, builder: subBuilder },
              );
              target.subcommands.push(sub);
              return stub;
            };
          case "argv":
            return {};
          case "then":
            return undefined;
          default:
            return () => stub;
        }
      },
    },
  );
  try {
    (builder as (y: unknown) => unknown)(stub);
  } catch (e) {
    target.error = `builder threw: ${(e as Error).message}`;
  }
}

function moduleMeta(mod: ModuleLike): CommandMeta {
  const specs = Array.isArray(mod.command) ? [...mod.command] : mod.command ? [mod.command as string] : [];
  const aliases = Array.isArray(mod.aliases) ? [...mod.aliases] : mod.aliases ? [mod.aliases as string] : [];
  const meta: CommandMeta = {
    name: (specs[0] ?? "").split(/\s+/)[0] ?? "",
    specs,
    aliases,
    describe: typeof mod.describe === "string" ? mod.describe : (mod.description ?? ""),
    positionals: [],
    options: [],
    subcommands: [],
  };
  record(mod.builder, meta);
  return meta;
}

let cache: Promise<CommandMeta[]> | undefined;

/** Load metadata for every registered command (deduplicated by primary name, first wins). */
export function loadCliMeta(): Promise<CommandMeta[]> {
  cache ??= (async () => {
    const seen = new Map<string, CommandMeta>();
    for (const reg of readRegistrations()) {
      const name = (reg.specs[0] ?? "").split(/\s+/)[0] ?? "";
      if (!name || seen.has(name)) continue;
      const base: CommandMeta = {
        name,
        specs: reg.specs,
        aliases: reg.aliases,
        describe: reg.describe,
        positionals: [],
        options: [],
        subcommands: [],
      };
      try {
        const file = pathToFileURL(path.join(cliRoot, `${reg.importPath}.ts`)).href;
        const mod = (await import(file)) as Record<string, ModuleLike | undefined>;
        const exported = mod[reg.exportName] ?? mod["default"];
        if (exported) {
          const meta = moduleMeta(exported);
          base.positionals = meta.positionals;
          base.options = meta.options;
          base.subcommands = meta.subcommands;
          if (meta.error) base.error = meta.error;
        } else {
          base.error = `export '${reg.exportName}' not found`;
        }
      } catch (e) {
        base.error = `import failed: ${(e as Error).message.split("\n")[0] ?? ""}`;
      }
      seen.set(name, base);
    }
    return [...seen.values()];
  })();
  return cache;
}
