#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import yargs, { type ArgumentsCamelCase, type Argv, type CommandBuilder, type CommandModule } from "yargs";

const CURRENT_CLI_DIR = import.meta.dirname ?? path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT_DIR = path.resolve(CURRENT_CLI_DIR, "../../..");

const ENTERPRISE_CLI_COMMANDS = new Set([
  "autosar",
  "plcopen",
  "oslc",
  "reqif",
  "ddp",
  "simulink",
  "gtsuite",
  "adams",
  "easy5",
  "rocets",
  "aspen",
  "olga",
  "relap5",
  "eclipse",
  "psse",
  "dhf",
]);

async function enforceEnterpriseCliEntitlement(commandSpec: string | readonly string[]): Promise<void> {
  const rawCmd = Array.isArray(commandSpec) ? String(commandSpec[0] ?? "") : String(commandSpec);
  const subcommand = rawCmd.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (!ENTERPRISE_CLI_COMMANDS.has(subcommand)) {
    return;
  }

  const editionEnv = (process.env["MSX_EDITION"] || "").toLowerCase().trim();
  if (editionEnv === "ce" || editionEnv === "community") {
    console.error(
      `[Enterprise Edition Required] 'msx ${subcommand}' is an Enterprise Edition feature and is disabled when MSX_EDITION=ce.`,
    );
    process.exit(1);
  }

  const candidates = [
    path.join(REPO_ROOT_DIR, "ee", "dist", "index.js"),
    path.join(REPO_ROOT_DIR, "ee", "src", "index.ts"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        const eeMod = (await import(pathToFileURL(candidate).href)) as {
          verifyEnterpriseCliCommand?: (cmd: string) => { allowed: boolean; reason?: string };
        };
        if (typeof eeMod.verifyEnterpriseCliCommand === "function") {
          const check = eeMod.verifyEnterpriseCliCommand(subcommand);
          if (!check.allowed) {
            console.error(`[Enterprise License Required] ${check.reason ?? "License check failed."}`);
            process.exit(1);
          }
        }
        return;
      } catch {
        // Continue to next candidate
      }
    }
  }

  console.error(
    `[Enterprise Edition Required] 'msx ${subcommand}' requires ModelScript Enterprise Edition (@modelscript/ee), which is not included in the Community Edition distribution.`,
  );
  process.exit(1);
}

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
      await enforceEnterpriseCliEntitlement(command);
      if (typeof args["lang"] === "string") {
        await enforceEnterpriseCliEntitlement(args["lang"]);
      }
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
let pkgVersion = "0.1.0";
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
      ["inspect <files..>", "info <files..>", "summary <files..>"],
      "Inspect and summarize engineering models across any of the 68 supported languages",
      () => import("./commands/inspect.js"),
      "Inspect",
      ["info", "summary"],
    ),
  )
  .command(
    lazy(
      ["simulate <name> [paths..]", "sim <name> [paths..]"],
      "Simulate a Modelica model, SysML v2 system, FMU archive, or domain engineering deck",
      () => import("./commands/simulate.js"),
      "Simulate",
      ["sim"],
    ),
  )
  .command(
    lazy(
      ["compile <name> [paths..]", "flatten <name> [paths..]", "convert <name> [paths..]"],
      "Flatten or lower a Modelica, SysML v2, or domain engineering model to DAE, Modelica, SysML v2, SSP, or FMU",
      () => import("./commands/compile.js"),
      "Compile",
      ["flatten", "convert"],
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
      ["lint <path> [paths...]", "check <path> [paths...]", "validate <path> [paths...]"],
      "Lint polyglot libraries using QueryEngine and DSL parsers",
      () => import("./commands/lint.js"),
      "Lint",
      ["check", "validate"],
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
      "render <name> [paths..]",
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
      "OSLC Core 3.0 enterprise coexistence gateway for Teamcenter-, Windchill-, and DOORS-compatible repositories",
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
      "Lossless OMG ReqIF 1.2 requirements interchange with DOORS-, Polarion-, and Teamcenter-compatible files",
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
  .command(
    lazy("login", "Log in to the Ansatz Package Registry & Platform", () => import("./commands/login.js"), "Login"),
  )
  .command(
    lazy(
      "logout",
      "Log out from the Ansatz Package Registry & Platform",
      () => import("./commands/logout.js"),
      "Logout",
    ),
  )
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
      "keys <action>",
      "Manage cryptographic signing keys and signed account identity",
      () => import("./commands/keys.js"),
      "KeysCommand",
      ["key"],
    ),
  )
  .command(
    lazy(
      "sign <file>",
      "Cryptographically sign a post or verify a W3C Data Integrity proof",
      () => import("./commands/sign.js"),
      "SignCommand",
    ),
  )
  .command(
    lazy(
      "install [package]",
      "Install a package from the Ansatz Package Registry into the local workspace",
      () => import("./commands/install.js"),
      "Install",
      ["i", "add"],
    ),
  )
  .command(
    lazy(
      "publish <path>",
      "Publish a library directory or single Modelica file to the Ansatz Package Registry",
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
      "stdlib [action] [pack]",
      "Manage, list, and synchronize polyglot standard libraries across 68 languages",
      () => import("./commands/stdlib.js"),
      "Stdlib",
    ),
  )
  .command(
    lazy(
      "unpublish [path]",
      "Remove a published library version from the Ansatz Package Registry",
      () => import("./commands/unpublish.js"),
      "Unpublish",
    ),
  )
  .command(
    lazy(
      "hub <command>",
      "Manage, configure, and inspect Ansatz & ModelScript hub nodes",
      () => import("./commands/hub.js"),
      "Hub",
      ["ansatz", "node"],
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
      ["domain <lang> <action> [files..]", "tool <lang> <action> [files..]"],
      "Invoke domain-specific engineering actions and solvers for any registered language",
      () => import("./commands/domain.js"),
      "Domain",
      ["tool"],
    ),
  )
  .command(
    lazy(
      "aspen <action> [files..]",
      "Inspect, lint, solve, and lower Aspen-compatible chemical process flowsheets (.in, .inp, .bkp)",
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
      "Inspect, lint, diff, and simulate PSCAD-compatible projects (.pscx, .pslx)",
      () => import("./commands/pscad.js"),
      "PscadCommand",
    ),
  )
  .command(
    lazy(
      "psse <action> [files..]",
      "Inspect, lint, and visualize PSS/E-compatible RAW power flow cases (.raw)",
      () => import("./commands/psse.js"),
      "PsseCommand",
    ),
  )
  .command(
    lazy(
      "cgmes <action> [files..]",
      "Inspect, lint, convert and solve ENTSO-E CIM / CGMES European grid models",
      () => import("./commands/cgmes.js"),
      "CgmesCommand",
    ),
  )
  .command(
    lazy(
      "relap5 <action> [files..]",
      "Inspect, lint, solve kinetics, and lower RELAP5-3D thermal-hydraulic reactor decks (.i, .inp, .r5)",
      () => import("./commands/relap5.js"),
      "Relap5Command",
    ),
  )
  .command(
    lazy(
      "eclipse <action> [files..]",
      "Inspect, lint, solve reservoir depletion, and lower ECLIPSE-format reservoir decks (.data, .dat, .inc)",
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
      "Simulate, lint, verify, and visualize OLGA-compatible multiphase flow models (.opi, .key, .genkey)",
      () => import("./commands/olga.js"),
      "OlgaCommand",
    ),
  )
  .command(
    lazy(
      "frac <action> [files..]",
      "Real-time hydraulic completions, slurry hydraulics, perforation erosion, fracture compliance, and screen-out analytics",
      () => import("./commands/frac.js"),
      "FracCommand",
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
      "Inspect, lint, and verify GENSYS-compatible railway vehicle models (.calc, .run, .sub)",
      () => import("./commands/gensys.js"),
      "GensysCommand",
    ),
  )
  .command(
    lazy(
      "adams <action> [files..]",
      "Inspect, analyze, solve, and project Adams-compatible multibody models (.adm, .cmd, .acf)",
      () => import("./commands/adams.js"),
      "AdamsCommand",
    ),
  )
  .command(
    lazy(
      "simpack <action> [files..]",
      "Inspect, analyze, and lower SIMPACK-compatible multibody models (.spck, .sim, .mbs)",
      () => import("./commands/simpack.js"),
      "SimpackCommand",
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
      "Inspect, lint, lower to DAE, and project Simulink-compatible control models (.slx, .mdl)",
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
      "Inspect, lint, simulate, and verify PipelineStudio-compatible gas & liquid networks (.lps, .tgx, .tlx, .tgn, .tln)",
      () => import("./commands/lps.js"),
      "LpsCommand",
    ),
  )
  .command(
    lazy(
      "sima <action> [files..]",
      "Inspect, lint, verify, and project SIMO/RIFLEX-compatible offshore marine models (.inp, .sima, .hyd)",
      () => import("./commands/sima.js"),
      "SimaCommand",
    ),
  )
  .command(
    lazy(
      "gtsuite <action> [files..]",
      "Inspect, lint, simulate, diagram, and project GT-SUITE / GT-POWER-compatible engine models (.gtm, .gtd, .gtx)",
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
  .command(
    lazy(
      "qif <action> [files..]",
      "Inspect, validate ASME Y14.5 GD&T & NIST QIF rules, compute SPC capability, and project ISO 23952 QIF models (.qif)",
      () => import("./commands/qif.js"),
      "QifCommand",
    ),
  )
  .command(
    lazy(
      "oscal <action> [files..]",
      "Inspect, resolve profiles, verify NIST SP 800-53 / SP 800-82 CPS compliance, and project NIST OSCAL models (.oscal.json, .oscal.yaml, .oscal.xml)",
      () => import("./commands/oscal.js"),
      "OscalCommand",
    ),
  )
  .command(
    lazy(
      "aml <action> [files..]",
      "Inspect, validate, virtually commission, lower to DAE, and project IEC 62714 AutomationML / CAEX models (.aml, .caex, .amlx)",
      () => import("./commands/automationml.js"),
      "AutomationMLCommand",
      ["automationml", "caex"],
    ),
  )
  .command(
    lazy(
      "opensim <action> [files..]",
      "Inspect, validate musculoskeletal kinematics & Hill-type muscles (M9101–M9110), simulate muscle activation, and project OpenSim models (.osim)",
      () => import("./commands/medical.js"),
      "OpenSimCommand",
    ),
  )
  .command(
    lazy(
      "dicom-rt <action> [files..]",
      "Inspect, verify QUANTEC OAR dose constraints & MLC leaf kinematics (M9201–M9210), compute DVH/BED/EQD2, and project DICOM-RT plans (.rtplan, .rtstruct, .rtdose)",
      () => import("./commands/medical.js"),
      "DicomRtCommand",
    ),
  )
  .command(
    lazy(
      "cellml <action> [files..]",
      "Inspect, validate SI dimensional units & component connections (M9301–M9310), integrate electrophysiology ODEs, and project CellML models (.cellml)",
      () => import("./commands/medical.js"),
      "CellmlCommand",
    ),
  )
  .command(
    lazy(
      "febio <action> [files..]",
      "Inspect, validate hyperelastic/biphasic tissue mechanics & SOFA surgical scenes (M9401–M9410), solve strain energy, and project FEBio/SOFA models (.feb, .scn)",
      () => import("./commands/medical.js"),
      "FebioCommand",
      ["sofa"],
    ),
  )
  .command(
    lazy(
      "nifti <action> [files..]",
      "Inspect, validate qform/sform RAS affine transforms (M9501–M9510), extract iso-surface meshes, and project NIfTI/NRRD volumes (.nii, .nrrd, .nhdr)",
      () => import("./commands/medical.js"),
      "NiftiCommand",
      ["nrrd"],
    ),
  )
  .command(
    lazy(
      "topas <action> [files..]",
      "Inspect, validate TOPAS/GATE hadrontherapy beamlines (M9601–M9610), compute analytical Bragg peak depth-dose curves, and project to OpenSCAD/Modelica (.topas, .mac)",
      () => import("./commands/medical.js"),
      "TopasCommand",
      ["gate"],
    ),
  )
  .command(
    lazy(
      "three-mf <action> [files..]",
      "Inspect, verify 2-manifold topology, wall thickness & osteotomy guides (M9701–M9710), and project 3MF Medical surgical guides & implants (.3mf)",
      () => import("./commands/medical.js"),
      "ThreeMfCommand",
      ["3mf"],
    ),
  )
  .command(
    lazy(
      "igtl <action> [files..]",
      "Inspect, validate SE(3) transforms & surgical navigation chains (M9801–M9810), solve stylus pivot calibration & TRE, and project OpenIGTLink/PLUS configs (.igtl, .plus.xml)",
      () => import("./commands/medical.js"),
      "IgtlCommand",
      ["openigtlink"],
    ),
  )
  .strictCommands()
  .demandCommand()
  .help()
  .version(pkgVersion)
  .epilogue(
    "Notice: ModelScript (msx) is an independent engineering platform. Third-party software titles, formats, and registered trademarks are the property of their respective owners and are referenced solely for file format identification, parsing, and interoperability under nominative fair use.",
  )
  .parse();
