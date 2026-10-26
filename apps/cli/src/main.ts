#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yargs, { type ArgumentsCamelCase, type Argv, type CommandBuilder, type CommandModule } from "yargs";

/**
 * Wraps a `yargs` `CommandModule` with dynamic `import()` lazy loading so that CLI startup
 * and `--help` only load the specific command module being executed.
 */
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

// Fast-path: when `--daemon` is passed, forward the invocation over the local Unix socket
// to the persistent compiler daemon to bypass Node/WASM cold-start latency.
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

const binName = path.basename(process.argv[1] ?? "").replace(/\.[cm]?[jt]s$/, "");
const scriptName = binName === "msx" ? "msx" : "modelscript";

await yargs(rawArgs)
  .scriptName(scriptName)
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
  .command(
    lazy(
      "cloud <action> [target]",
      "Manage cloud HPC jobs, compute profiles, credit wallet, and live telemetry",
      () => import("./commands/cloud.js"),
      "Cloud",
    ),
  )
  // Modeling & Simulation
  .command(
    lazy(
      "simulate <name> [paths..]",
      "Simulate a Modelica model, SysML v2 system, or FMU archive and output results",
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
      "fmu <name> [paths..]",
      "Export, validate, inspect, build, or simulate an FMU archive",
      () => import("./commands/fmu.js"),
      "Fmu",
      ["export-fmu"],
    ),
  )
  .command(
    lazy(
      "import-fmu <fmu>",
      "Import an FMU archive and generate an acausal or causal Modelica wrapper",
      () => import("./commands/import-fmu.js"),
      "ImportFmu",
      ["fmu-import"],
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
      "surrogate <name> [paths..]",
      "Train or import an AI surrogate model (ROM) and generate C, ONNX, or Modelica code",
      () => import("./commands/surrogate.js"),
      "Surrogate",
    ),
  )
  .command(
    lazy(
      "verify [target] [paths..]",
      "Unified formal verification and simulation validation for SysML v2 and Modelica",
      () => import("./commands/verify.js"),
      "Verify",
    ),
  )
  .command(
    lazy(
      "falsify",
      "Run adversarial multi-domain requirement falsification across SysML, Modelica, and CAD",
      () => import("./commands/falsify.js"),
      "Falsify",
    ),
  )
  .command(
    lazy(
      "export-formal <paths..>",
      "Export SysML v2 models to standard formal verification formats (SMT-LIB2, nuXmv, OCRA)",
      () => import("./commands/export-formal.js"),
      "ExportFormal",
    ),
  )
  .command(
    lazy(
      "verify-decisions <paths..>",
      "Formally verify SysML v2 decision tables, decide nodes, and state guards for exhaustiveness and disjointness",
      () => import("./commands/verify-decisions.js"),
      "VerifyDecisions",
    ),
  )
  .command(
    lazy(
      "decompose <paths..>",
      "Perform symbolic state-space region decomposition over SysML v2 decision conditions",
      () => import("./commands/decompose.js"),
      "Decompose",
    ),
  )
  .command(
    lazy(
      "generate-tests <paths..>",
      "Synthesize formal boundary-condition and 100% MC/DC test suites from SysML v2 models",
      () => import("./commands/generate-tests.js"),
      "GenerateTests",
    ),
  )
  .command(
    lazy(
      "db <action>",
      "Database schema migration, health verification, and pre-flight snapshot management",
      () => import("./commands/db.js"),
      "Db",
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
      "pr-diff [file]",
      "Compute visual and semantic pull request diff across Git revisions (SysML v2, Modelica)",
      () => import("./commands/pr-diff.js"),
      "PrDiff",
    ),
  )
  .command(
    lazy(
      "merge [base] [ours] [theirs]",
      "Perform an AST/CST-aware 3-way semantic merge across base, ours, and theirs model files",
      () => import("./commands/merge.js"),
      "Merge",
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
      "polyglot <action>",
      "Multi-domain TGG projection, formal verification, and digital thread tracking",
      () => import("./commands/polyglot.js"),
      "Polyglot",
    ),
  )
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
      "sysml <action>",
      "OMG SysML v2 engineering toolkit: standard interchange (.sysmlx), validation, and container export",
      () => import("./commands/sysml.js"),
      "SysML",
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
  .command(
    lazy(
      "spice <action>",
      "SPICE netlist (.cir, .sp, .net) analog & mixed-signal simulation and translation",
      () => import("./commands/spice.js"),
      "Spice",
    ),
  )
  .command(
    lazy(
      "ddp <action>",
      "Digital Data Package (prostep ivip PSI 21 / OMG CASCaRA) packaging, inspection, and AASX bridging",
      () => import("./commands/ddp.js"),
      "Ddp",
    ),
  )
  .command(
    lazy(
      "dhf <action> [paths..]",
      "Design History File (FDA 21 CFR 820.30 / ISO 14971 / IEC 62304) regulatory compliance exporter",
      () => import("./commands/dhf.js"),
      "Dhf",
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
      "whoami",
      "Display information about the currently authenticated user",
      () => import("./commands/whoami.js"),
      "WhoAmI",
    ),
  )
  .command(
    lazy(
      "token <action>",
      "Manage granular personal access tokens (create, list, revoke)",
      () => import("./commands/token.js"),
      "Token",
    ),
  )
  .command(
    lazy(
      "install [package]",
      "Install a package from the ModelScript Registry into the local workspace",
      () => import("./commands/install.js"),
      "Install",
    ),
  )
  .command(
    lazy(
      "publish <path>",
      "Publish a library directory or single Modelica file to the ModelScript Registry",
      () => import("./commands/publish.js"),
      "Publish",
    ),
  )
  .command(
    lazy(
      "pack [path]",
      "Create an offline distribution zip archive from a package",
      () => import("./commands/pack.js"),
      "Pack",
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
  .command(
    lazy(
      "hub <command>",
      "Manage, configure, and inspect ModelScript hub nodes",
      () => import("./commands/hub.js"),
      "Hub",
    ),
  )
  .command(
    lazy(
      "archive [action] [users..]",
      "GDPR Art. 20 / CCPA data archive export with async worker queue and concurrency limits",
      () => import("./commands/archive.js"),
      "Archive",
    ),
  )
  .command(
    lazy(
      "aspen <action> [files..]",
      "Inspect, lint, solve, and lower Aspen Plus chemical process flowsheets (.in, .inp, .bkp)",
      () => import("./commands/aspen.js"),
      "AspenCommand",
    ),
  )
  .command(
    lazy(
      "swmm <action> [files..]",
      "Inspect, lint, route, and lower US EPA SWMM 5.x stormwater networks (.inp)",
      () => import("./commands/swmm.js"),
      "SwmmCommand",
    ),
  )
  .command(
    lazy(
      "touchstone <action> [files..]",
      "Inspect, lint, verify passivity, and lower Touchstone N-Port models (.s1p ... .sNp, .ts)",
      () => import("./commands/touchstone.js"),
      "TouchstoneCommand",
    ),
  )
  .command(
    lazy(
      "ibis <action> [files..]",
      "Inspect, lint, evaluate, and lower ANSI/EIA-656-B IBIS buffer models (.ibs)",
      () => import("./commands/ibis.js"),
      "IbisCommand",
    ),
  )
  .command(
    lazy(
      "opendss <action> [files..]",
      "Inspect, lint, solve power flow, and lower EPRI OpenDSS distribution circuits (.dss)",
      () => import("./commands/opendss.js"),
      "OpenDssCommand",
    ),
  )
  .command(
    lazy(
      "c <action> [files..]",
      "Inspect, lint, and bridge C99/ANSI C files and headers (.c, .h)",
      () => import("./commands/c.js"),
      "CCommand",
    ),
  )
  .command(
    lazy(
      "openscenario <action> [files..]",
      "Inspect, lint, simulate, and lower ASAM OpenSCENARIO scenario files (.xosc, .osc)",
      () => import("./commands/openscenario.js"),
      "OpenScenarioCommand",
    ),
  )
  .command(
    lazy(
      "pscad <action> [files..]",
      "Inspect, lint, diff, and simulate PSCAD projects (.pscx, .pslx)",
      () => import("./commands/pscad.js"),
      "PscadCommand",
    ),
  )
  .command(
    lazy(
      "psse <action> [files..]",
      "Inspect, lint, and visualize PSS/E RAW power flow cases (.raw)",
      () => import("./commands/psse.js"),
      "PsseCommand",
    ),
  )
  .command(
    lazy(
      "relap5 <action> [files..]",
      "Inspect, lint, solve kinetics, and lower US NRC RELAP5-3D decks (.i, .inp, .r5)",
      () => import("./commands/relap5.js"),
      "Relap5Command",
    ),
  )
  .command(
    lazy(
      "eclipse <action> [files..]",
      "Inspect, lint, solve reservoir depletion, and lower Schlumberger ECLIPSE decks (.data, .dat, .inc)",
      () => import("./commands/eclipse.js"),
      "EclipseCommand",
    ),
  )
  .command(
    lazy(
      "sbml <action> [files..]",
      "Inspect, lint, simulate biochemical networks, and lower SBML models (.sbml, .xml)",
      () => import("./commands/sbml.js"),
      "SbmlCommand",
    ),
  )
  .command(
    lazy(
      "jsbsim <action> [files..]",
      "Inspect, lint, simulate 6-DOF flight dynamics, and lower JSBSim models (.xml)",
      () => import("./commands/jsbsim.js"),
      "JsbsimCommand",
    ),
  )
  .command(
    lazy(
      "olga <action> [files..]",
      "Simulate, lint, verify, and visualize OLGA multiphase flow models (.opi, .key, .genkey)",
      () => import("./commands/olga.js"),
      "OlgaCommand",
    ),
  )
  .command(
    lazy(
      "easy5 <action> [files..]",
      "Inspect, lint, linearize, and project EASY5 continuous simulation models (.ez5, .ezm, .ezd, .eas)",
      () => import("./commands/easy5.js"),
      "Easy5Command",
    ),
  )
  .command(
    lazy(
      "rocets <action> [files..]",
      "Inspect, lint, balance, simulate, and project NASA ROCETS liquid propulsion models (.roc, .deck)",
      () => import("./commands/rocets.js"),
      "RocetsCommand",
    ),
  )
  .command(
    lazy(
      "gensys <action> [files..]",
      "Inspect, lint, and verify GENSYS railway vehicle models (.calc, .run, .sub)",
      () => import("./commands/gensys.js"),
      "GensysCommand",
    ),
  )
  .command(
    lazy(
      "adams <action> [files..]",
      "Inspect, analyze, solve, and project MSC Adams multibody models (.adm, .cmd, .acf)",
      () => import("./commands/adams.js"),
      "AdamsCommand",
    ),
  )
  .command(
    lazy(
      "simpack <action> [files..]",
      "Inspect, analyze, and lower SIMPACK multibody models (.spck, .sim, .mbs)",
      () => import("./commands/simpack.js"),
      "SimpackCommand",
    ),
  )
  .command(
    lazy(
      "spice <action> [files..]",
      "Inspect, lint, solve, and project SPICE analog circuit netlists (.cir, .sp, .net, .lib)",
      () => import("./commands/spice.js"),
      "Spice",
    ),
  )
  .command(
    lazy(
      "urdf <action> [files..]",
      "Inspect, validate, solve kinematics, and project ROS URDF & SDFormat robot models (.urdf, .sdf, .xacro)",
      () => import("./commands/urdf.js"),
      "UrdfCommand",
    ),
  )
  .command(
    lazy(
      "verilog-a <action> [files..]",
      "Inspect, validate, lower to DAE, and project Verilog-A / Verilog-AMS compact models (.va, .vams)",
      () => import("./commands/verilog-a.js"),
      "VerilogACommand",
    ),
  )
  .command(
    lazy(
      "plcopen <action> [files..]",
      "Inspect, validate, simulate, and project IEC 61131-3 PLCopen XML & Structured Text models (.xml, .plcopen, .st)",
      () => import("./commands/plcopen.js"),
      "PlcopenCommand",
    ),
  )
  .command(
    lazy(
      "opendrive <action> [files..]",
      "Inspect, validate, sample clothoids, lower to DAE, and project OpenDRIVE road networks (.xodr, .xml)",
      () => import("./commands/opendrive.js"),
      "OpenDriveCommand",
    ),
  )
  .command(
    lazy(
      "energyplus <action> [files..]",
      "Inspect, validate, lower to DAE, and project US DOE EnergyPlus building models (.idf, .epJSON)",
      () => import("./commands/energyplus.js"),
      "EnergyPlusCommand",
    ),
  )
  .command(
    lazy(
      "epanet <action> [files..]",
      "Inspect, validate, solve hydraulics, lower to DAE, and project US EPA EPANET water networks (.inp)",
      () => import("./commands/epanet.js"),
      "EpanetCommand",
    ),
  )
  .command(
    lazy(
      "ccsds <action> [files..]",
      "Inspect, validate, propagate, lower to DAE, and project CCSDS and XTCE spacecraft data (.oem, .opm, .omm, .xtce)",
      () => import("./commands/ccsds.js"),
      "CcsdsCommand",
    ),
  )
  .command(
    lazy(
      "simulink <action> [files..]",
      "Inspect, lint, lower to DAE, and project MATLAB Simulink control models (.slx, .mdl)",
      () => import("./commands/simulink.js"),
      "SimulinkCommand",
    ),
  )
  .command(
    lazy(
      "autosar <action> [files..]",
      "Inspect, lint, simulate Virtual RTE, lower to DAE, and project AUTOSAR Classic and Adaptive architectures (.arxml)",
      () => import("./commands/autosar.js"),
      "AutosarCommand",
    ),
  )
  .command(
    lazy(
      "lps <action> [files..]",
      "Inspect, lint, simulate, and verify PipelineStudio gas & liquid networks (.lps, .tgx, .tlx, .tgn, .tln)",
      () => import("./commands/lps.js"),
      "LpsCommand",
    ),
  )
  .command(
    lazy(
      "sima <action> [files..]",
      "Inspect, lint, verify, and project SINTEF Ocean SIMO / RIFLEX offshore models (.inp, .sima, .hyd)",
      () => import("./commands/sima.js"),
      "SimaCommand",
    ),
  )
  .command(
    lazy(
      "gtsuite <action> [files..]",
      "Inspect, lint, simulate, diagram, and project GT-SUITE / GT-POWER engine models (.gtm, .gtd, .gtx)",
      () => import("./commands/gtsuite.js"),
      "GtSuiteCommand",
    ),
  )
  .command(
    lazy(
      "cfd <action> [files..]",
      "Inspect, lint, solve, and project CFD aerodynamic models (.cfg, .foam, .su2)",
      () => import("./commands/cfd.js"),
      "CfdCommand",
    ),
  )
  .command(
    lazy(
      "fea <action> [files..]",
      "Inspect, lint, solve, and project FEA structural models (.inp, .bdf, .dat)",
      () => import("./commands/fea.js"),
      "FeaCommand",
    ),
  )
  .strictCommands()
  .demandCommand()
  .help()
  .version(pkgVersion)
  .parse();
