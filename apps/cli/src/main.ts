#!/usr/bin/env node

// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yargs, { type ArgumentsCamelCase, type Argv, type CommandBuilder, type CommandModule } from "yargs";

function lazy(
  command: string | readonly string[],
  describe: string,
  importFn: () => Promise<Record<string, unknown>>,
  exportName: string,
  aliases?: string | readonly string[],
): CommandModule<Record<string, unknown>, Record<string, unknown>> {
  return {
    command,
    ...(aliases ? { aliases } : {}),
    describe,
    builder: (async (y: Argv) => {
      const mod = await importFn();
      const cmd = mod[exportName] as CommandModule<Record<string, unknown>, Record<string, unknown>>;
      if (typeof cmd.builder === "function") {
        return cmd.builder(y);
      }
      return cmd.builder ?? y;
    }) as unknown as CommandBuilder<Record<string, unknown>, Record<string, unknown>>,
    handler: async (args: ArgumentsCamelCase<Record<string, unknown>>) => {
      const mod = await importFn();
      const cmd = mod[exportName] as CommandModule<Record<string, unknown>, Record<string, unknown>>;
      return cmd.handler(args);
    },
  };
}

const packageJsonPath = path.resolve(
  import.meta.dirname ?? path.dirname(fileURLToPath(import.meta.url)),
  "../package.json",
);
let pkgVersion = "0.0.18";
try {
  const pkgContent = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
  if (pkgContent.version) pkgVersion = pkgContent.version;
} catch {
  // fallback
}

const rawArgs = process.argv.slice(2);

if (rawArgs.includes("--daemon")) {
  const daemonArgs = rawArgs.filter((a) => a !== "--daemon");
  const { isSocketAlive, startDaemon, forwardToDaemon } = await import("./daemon/daemon-client.js");
  const status = await isSocketAlive(50);
  if (!status.alive) {
    await startDaemon();
  }
  const code = await forwardToDaemon(daemonArgs);
  if (typeof code === "number") {
    process.exit(code);
  }
}

await yargs(rawArgs)
  .scriptName("msc")
  .usage(`CLI for ModelScript ${pkgVersion}`)
  .option("daemon", {
    description: "Execute command using background compiler daemon for instant speed",
    type: "boolean",
  })
  .command(
    lazy(
      "daemon <action>",
      "Manage the background compiler daemon for instant compilation",
      () => import("./commands/daemon.js"),
      "Daemon",
    ),
  )
  // Modeling & Simulation
  .command(
    lazy(
      "simulate <name> <paths..>",
      "Simulate a Modelica model and output results",
      () => import("./commands/simulate.js"),
      "Simulate",
    ),
  )
  .command(
    lazy(
      ["compile <name> <paths...>", "flatten <name> <paths...>"],
      "Flatten a Modelica model to a flat DAE representation",
      () => import("./commands/compile.js"),
      "Compile",
    ),
  )
  .command(
    lazy(
      "instantiate <name> <paths...>",
      "Instantiate and query AST structure of a Modelica model",
      () => import("./commands/instantiate.js"),
      "Instantiate",
    ),
  )
  .command(
    lazy(
      "fmu <name> <paths..>",
      "Export a Modelica model as an FMU archive",
      () => import("./commands/fmu.js"),
      "Fmu",
      ["export-fmu"],
    ),
  )
  .command(
    lazy(
      "csg <name> <paths...>",
      "Compile and extract CSG topologies to 3D meshes",
      () => import("./commands/csg.js"),
      "BuildCSG",
    ),
  )
  .command(lazy("mc <name> <paths..>", "Run Monte Carlo simulation", () => import("./commands/mc.js"), "MC"))
  .command(
    lazy(
      "optimize <name> <paths..>",
      "Solve an optimal control problem for a Modelica model",
      () => import("./commands/optimize.js"),
      "Optimize",
    ),
  )
  .command(
    lazy(
      "grad <name> <paths..>",
      "Compute exact parameter sensitivities through simulation using continuous adjoints",
      () => import("./commands/grad.js"),
      "Grad",
    ),
  )
  .command(
    lazy(
      "surrogate <name> <paths..>",
      "Train an AI surrogate model (ROM) and generate WebAssembly C source",
      () => import("./commands/surrogate.js"),
      "Surrogate",
    ),
  )
  .command(
    lazy(
      "verify <name> <paths..>",
      "Run SysML2 verification against a simulation",
      () => import("./commands/verify.js"),
      "Verify",
    ),
  )
  .command(
    lazy(
      "cosim",
      "Co-simulation management (sessions, participants, FMUs, replay)",
      () => import("./commands/cosim.js"),
      "Cosim",
    ),
  )
  // Verification, Linting & Translation
  .command(
    lazy(
      "lint <path> [paths...]",
      "Lint polyglot libraries using QueryEngine and DSL parsers",
      () => import("./commands/lint.js"),
      "Lint",
    ),
  )
  .command(
    lazy(
      "format <files..>",
      "Format source files using their language DSL formatter or unparser",
      () => import("./commands/format.js"),
      "Format",
    ),
  )
  .command(
    lazy(
      "unparse <file>",
      "Unparse and re-synthesize clean source code from the language AST",
      () => import("./commands/unparse.js"),
      "Unparse",
    ),
  )
  .command(
    lazy(
      "diff <file1> <file2>",
      "Compute an AST-aware semantic diff between two model files (supports any registered DSL)",
      () => import("./commands/diff.js"),
      "Diff",
    ),
  )
  .command(
    lazy(
      "render <name> <paths...>",
      "Render Modelica class diagram or icon to SVG",
      () => import("./commands/render.js"),
      "Render",
    ),
  )
  .command(
    lazy(
      "i18n <paths..>",
      "Extract internationalization (.pot) translation templates from Modelica models",
      () => import("./commands/i18n.js"),
      "I18n",
    ),
  )
  // Digital Thread, Enterprise Coexistence & Brownfield Alignment
  .command(
    lazy(
      "align <source> <target>",
      "Fuzzy align and correlate brownfield engineering assets (STEP CAD, Modelica, SysML v2, ReqIF)",
      () => import("./commands/align.js"),
      "Align",
    ),
  )
  .command(
    lazy(
      "oslc <action>",
      "OSLC Core 3.0 enterprise coexistence gateway for Teamcenter, Windchill, and DOORS",
      () => import("./commands/oslc.js"),
      "Oslc",
    ),
  )
  .command(
    lazy(
      "reqif <action>",
      "Lossless OMG ReqIF 1.2 requirements interchange with DOORS, Polarion, and Teamcenter",
      () => import("./commands/reqif.js"),
      "ReqIf",
    ),
  )
  // Language Engineering & DSL Tooling
  .command(
    lazy(
      "build [entry]",
      "Compile the generated parser AssemblyScript into WASM and native platform binaries",
      () => import("./commands/build.js"),
      "Build",
    ),
  )
  .command(
    lazy(
      "generate [target] [entries..]",
      "Generate parser tables or a full VS Code extension from DSL language specs",
      () => import("./commands/generate.js"),
      "Generate",
    ),
  )
  .command(
    lazy(
      "parse <file>",
      "Parse a file using its language DSL parser (supports any registered language)",
      () => import("./commands/parse.js"),
      "Parse",
    ),
  )
  .command(
    lazy(
      ["language <action> [target]", "lang <action> [target]"],
      "Manage registered language DSLs (list, register, unregister)",
      () => import("./commands/language.js"),
      "Language",
      ["lang"],
    ),
  )
  .command(
    lazy(
      "lsp",
      "Start the ModelScript polyglot Language Server (over stdio for editor integration)",
      () => import("./commands/lsp.js"),
      "Lsp",
    ),
  )
  .command(
    lazy("playground", "Launch the dual-editor DSL workbench", () => import("./commands/playground.js"), "Playground"),
  )
  .command(
    lazy(
      "sandbox [entries..]",
      "Start a VS Code Web sandbox with on-the-fly compiled multi-language extension",
      () => import("./commands/sandbox.js"),
      "Sandbox",
    ),
  )
  // Package Management & Registry
  .command(
    lazy(
      "init [path]",
      "Initialize a ModelScript package.json for a Modelica/SysML project",
      () => import("./commands/init.js"),
      "Init",
    ),
  )
  .command(lazy("login", "Log in to the ModelScript Registry", () => import("./commands/login.js"), "Login"))
  .command(lazy("logout", "Log out from the ModelScript Registry", () => import("./commands/logout.js"), "Logout"))
  .command(
    lazy(
      "publish <path>",
      "Publish a library director or single Modelica file to the ModelScript Registry",
      () => import("./commands/publish.js"),
      "Publish",
    ),
  )
  .command(
    lazy(
      "unpublish [path]",
      "Remove a published library version from the ModelScript Registry",
      () => import("./commands/unpublish.js"),
      "Unpublish",
    ),
  )
  .strictCommands()
  .demandCommand()
  .help()
  .version(pkgVersion)
  .parse();
