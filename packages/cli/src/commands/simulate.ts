// SPDX-License-Identifier: AGPL-3.0-or-later

import { Context, ModelicaDAE, ModelicaFlattener, ModelicaLinter, ModelicaSimulator } from "@modelscript/core";
import Modelica from "@modelscript/tree-sitter-modelica";
import path from "node:path";
import Parser, { type Range } from "tree-sitter";
import type { CommandModule } from "yargs";
import { NodeFileSystem } from "../util/filesystem.js";

interface SimulateArgs {
  name: string;
  paths: string[];
  "start-time"?: number;
  startTime?: number;
  "stop-time"?: number;
  stopTime?: number;
  tolerance?: number;
  interval?: number;
  format: string;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const Simulate: CommandModule<{}, SimulateArgs> = {
  command: "simulate <name> <paths..>",
  describe: "Simulate a Modelica model and output results",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  builder: ((yargs: any) => {
    return yargs
      .positional("name", {
        demandOption: true,
        description: "name of class to simulate",
        type: "string",
      })
      .positional("paths", {
        array: true,
        demandOption: true,
        description: "paths of libraries and modules to load",
        type: "string",
      })
      .option("start-time", {
        description: "override experiment start time",
        type: "number",
      })
      .option("stop-time", {
        description: "override experiment stop time",
        type: "number",
      })
      .option("tolerance", {
        description: "override experiment tolerance",
        type: "number",
      })
      .option("interval", {
        description: "override experiment output interval",
        type: "number",
      })
      .option("format", {
        description: "output format",
        type: "string",
        choices: ["csv", "json"],
        default: "csv",
      });
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  }) as CommandModule<{}, SimulateArgs>["builder"],
  handler: (args) => {
    const parser = new Parser();
    parser.setLanguage(Modelica);
    Context.registerParser(".mo", parser);
    const context = new Context(new NodeFileSystem());

    // Build mapping from absolute resolved paths to user-provided paths
    const pathMap = new Map<string, string>();
    for (const p of args.paths) {
      pathMap.set(path.resolve(p), p);
    }

    for (const p of args.paths) context.addLibrary(p);
    const instance = context.query(args.name);
    if (!instance) {
      console.error(`'${args.name}' not found`);
      return;
    }

    // Flatten the model
    const dae = new ModelicaDAE(instance.name ?? "DAE", instance.description);
    instance.accept(new ModelicaFlattener(), ["", dae]);

    // Run the linter to collect diagnostics
    const diagnostics: { type: string; code: number; message: string; resource: string | null; range: Range | null }[] =
      [];
    const linter = new ModelicaLinter(
      (
        type: string,
        code: number,
        message: string,
        resource: string | null | undefined,
        range: Range | null | undefined,
      ) => {
        diagnostics.push({ type, code, message, resource: resource ?? null, range: range ?? null });
      },
    );
    for (const cls of context.classes) {
      linter.lint(cls);
    }
    linter.lint(instance);

    // Convert absolute resource path to user-provided relative path
    const toUserPath = (absPath: string | null) => {
      if (!absPath) return "";
      for (const [resolved, userProvided] of pathMap) {
        if (absPath === resolved) return userProvided;
        if (absPath.startsWith(resolved + path.sep)) {
          return userProvided + absPath.slice(resolved.length);
        }
      }
      return absPath;
    };

    const formatDiag = (d: (typeof diagnostics)[number]) => {
      const severity = d.type.charAt(0).toUpperCase() + d.type.slice(1);
      const codeStr = d.code > 0 ? `[M${d.code}] ` : "";
      if (d.range) {
        const startPos = `${d.range.startPosition.row + 1}:${d.range.startPosition.column + 1}`;
        const endPos = `${d.range.endPosition.row + 1}:${d.range.endPosition.column + 1}`;
        const filePath = toUserPath(d.resource);
        return `[${filePath}:${startPos}-${endPos}] ${severity}: ${codeStr}${d.message}`;
      }
      return `${severity}: ${codeStr}${d.message}`;
    };

    const errors = diagnostics.filter((d) => d.type === "error");
    const warnings = diagnostics.filter((d) => d.type !== "error");

    // If errors exist, print only diagnostics (no simulation)
    if (errors.length > 0) {
      for (const d of diagnostics) console.error(formatDiag(d));
      console.error(`\n${errors.length} error(s), ${warnings.length} warning(s) found.`);
      return;
    }

    // Print warnings before simulation
    for (const d of warnings) console.error(formatDiag(d));
    if (warnings.length > 0) {
      console.error(`\n${errors.length} error(s), ${warnings.length} warning(s) found.`);
    }

    // Prepare the simulator
    const simulator = new ModelicaSimulator(dae);
    simulator.prepare();

    // Resolve experiment parameters: CLI flags > annotation > defaults
    const exp = dae.experiment;
    const startTime = args.startTime ?? exp.startTime ?? 0;
    const stopTime = args.stopTime ?? exp.stopTime ?? 10;
    const step = args.interval ?? exp.interval ?? (stopTime - startTime) / 1000;

    // Run simulation
    const result = simulator.simulate(startTime, stopTime, step);
    const states = result.states;

    // Output results
    if (args.format === "json") {
      const rows = result.t.map((t: number, i: number) => {
        const row: Record<string, number> = { time: t };
        states.forEach((state: string, vIndex: number) => {
          row[state] = result.y[i]?.[vIndex] ?? 0;
        });
        return row;
      });
      process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
    } else {
      // CSV format
      const header = ["time", ...states].join(",");
      process.stdout.write(header + "\n");
      for (let i = 0; i < result.t.length; i++) {
        const values = [result.t[i], ...states.map((_: string, vIndex: number) => result.y[i]?.[vIndex] ?? 0)];
        process.stdout.write(values.join(",") + "\n");
      }
    }
  },
};
