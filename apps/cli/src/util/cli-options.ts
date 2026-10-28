// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Argv } from "yargs";

/**
 * Attaches standardized `--output` / `--out` / `-o` options to a Yargs builder.
 */
export function withOutputOption<T>(yargs: Argv<T>, description = "Output file or directory path"): Argv<T> {
  return yargs.option("output", {
    alias: ["o", "out"],
    type: "string",
    description,
  }) as unknown as Argv<T>;
}

/**
 * Attaches standardized `--format` / `-f` and `--json` options to a Yargs builder.
 */
export function withFormatOption<T>(
  yargs: Argv<T>,
  choices: readonly string[] = ["terminal", "json"],
  defaultFormat = "terminal",
): Argv<T> {
  return yargs
    .option("format", {
      alias: "f",
      type: "string",
      choices,
      default: defaultFormat,
      description: `Output format (${choices.join(", ")})`,
    })
    .option("json", {
      type: "boolean",
      default: false,
      description: "Emit output as machine-readable JSON (shorthand for --format=json)",
    }) as unknown as Argv<T>;
}

/**
 * Attaches standardized `--language` / `--lang` / `-l` options to a Yargs builder.
 */
export function withLanguageOption<T>(yargs: Argv<T>, description = "Explicitly override language ID"): Argv<T> {
  return yargs.option("language", {
    alias: ["l", "lang"],
    type: "string",
    description,
  }) as unknown as Argv<T>;
}

/**
 * Resolves the effective output path from any of `--output`, `--out`, `-o`, `--out-file`, or `--report`.
 */
export function resolveOutputPath(args: Record<string, unknown>): string | undefined {
  const candidate = args["output"] ?? args["out"] ?? args["o"] ?? args["outFile"] ?? args["out-file"];
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : undefined;
}

/**
 * Resolves the effective output format, honoring `--json` shorthand and normalizing terminal aliases
 * (`pretty`, `table`, `text` -> `terminal`).
 */
export function resolveOutputFormat(args: Record<string, unknown>, defaultFormat = "terminal"): string {
  if (args["json"] === true) {
    return "json";
  }
  const raw = typeof args["format"] === "string" ? args["format"].toLowerCase().trim() : defaultFormat;
  if (raw === "pretty" || raw === "table" || raw === "text") {
    return "terminal";
  }
  return raw || defaultFormat;
}

/**
 * Resolves the effective language override from `--language`, `--lang`, or `-l`.
 */
export function resolveLanguageOption(args: Record<string, unknown>): string | undefined {
  const candidate = args["language"] ?? args["lang"] ?? args["l"];
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate.trim() : undefined;
}

/**
 * Resolves simulation stop time / duration across all historical CLI flag variants.
 */
export function resolveStopTime(args: Record<string, unknown>, defaultStopTime?: number): number | undefined {
  for (const key of ["stop-time", "stopTime", "tstop", "t-end", "tEnd", "duration", "horizon"]) {
    const val = args[key];
    if (typeof val === "number" && Number.isFinite(val)) {
      return val;
    }
  }
  return defaultStopTime;
}

/**
 * Resolves simulation step size / output interval across all historical CLI flag variants.
 */
export function resolveStepSize(args: Record<string, unknown>, defaultStep?: number): number | undefined {
  for (const key of ["step", "step-size", "stepSize", "interval", "output-interval", "outputInterval", "tstep", "dt"]) {
    const val = args[key];
    if (typeof val === "number" && Number.isFinite(val)) {
      return val;
    }
  }
  return defaultStep;
}

/**
 * Normalizes a domain action verb against the set of supported actions for a specific domain command,
 * allowing uniform verbs (`inspect`, `summary`, `info`, `lint`, `check`, `validate`, `to-dae`, `dae`,
 * `to-modelica`, `export-modelica`, `to-sysml2`, `to-sysml`, `sysml`, `to-ssp`, `export-ssp`,
 * `simulate`, `sim`, `solve`, `diagram`, `render`) to work consistently across all domain commands.
 */
export function normalizeDomainAction(action: string, supportedActions?: readonly string[]): string {
  const norm = action.toLowerCase().trim();
  if (supportedActions && supportedActions.includes(norm)) {
    return norm;
  }

  const synonymGroups: readonly (readonly string[])[] = [
    ["inspect", "summary", "info", "import", "psout"],
    ["lint", "check", "validate"],
    ["to-dae", "dae", "lower", "compile", "flatten"],
    ["to-modelica", "export-modelica", "modelica"],
    ["to-sysml2", "to-sysml", "sysml", "sysml2", "export-sysml"],
    ["to-ssp", "export-ssp", "ssp"],
    ["to-fmu", "fmu", "export-fmu"],
    [
      "simulate",
      "sim",
      "solve",
      "simulate-rte",
      "run-scan",
      "powerflow",
      "route-flow",
      "kinetics",
      "solve-flash",
      "propagate",
      "eval",
      "rnea",
      "step",
    ],
    ["diagram", "render"],
  ];

  for (const group of synonymGroups) {
    if (group.includes(norm)) {
      if (!supportedActions) {
        return group[0]!;
      }
      for (const candidate of group) {
        if (supportedActions.includes(candidate)) {
          return candidate;
        }
      }
    }
  }

  return norm;
}

/**
 * Infers the primary Modelica or SysML v2 class/system name from a source file when
 * a user invokes `msx compile <file>` or `msx simulate <file>` without an explicit class name.
 */
export function inferPrimaryModelName(filePath: string, sourceText: string): string {
  const withinMatch = sourceText.match(/^\s*within\s+([A-Za-z_][\w.]*)\s*;/m);
  const withinPrefix = withinMatch?.[1] ? `${withinMatch[1]}.` : "";

  const modelMatches = [...sourceText.matchAll(/^\s*(?:partial\s+)?(?:model|class|block)\s+([A-Za-z_]\w*)\b/gm)];
  if (modelMatches.length > 0) {
    const lastModel = modelMatches[modelMatches.length - 1]![1]!;
    return `${withinPrefix}${lastModel}`;
  }

  const base = filePath.replace(/^.*[/\\]/, "").replace(/\.[^.]+$/, "");
  return `${withinPrefix}${base}`;
}
