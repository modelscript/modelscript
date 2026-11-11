// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Lightweight, dependency-free scan of the classes declared in a Modelica source file.
 *
 * It is a token scanner (not a parser): comments, strings and parenthesised expressions are skipped,
 * class headers are recognised by their restricted-class keyword, and nesting is tracked with
 * `end Name;`. That is enough to offer the user a choice of which class to showcase; the server and the
 * interactive editor still do the authoritative parsing.
 */

export type ModelicaClassKind = "model" | "block" | "class" | "connector" | "record" | "package" | "function" | "type";

export interface ModelicaClassInfo {
  name: string;
  /** Dotted path from the file's top level, e.g. `Pkg.Examples.Demo`. */
  qualifiedName: string;
  kind: ModelicaClassKind;
  partial: boolean;
  /** Nesting depth; 0 for top-level classes. */
  depth: number;
  /** True when the class (not a nested one) carries `annotation(experiment(...))`. */
  hasExperiment: boolean;
}

const KINDS = new Set<string>(["model", "block", "class", "connector", "record", "package", "function", "type"]);
const RESERVED_AFTER_KIND = new Set<string>(["extends", "end", "import", "input", "output", "parameter", "constant"]);

function stripNonCode(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/"(?:[^"\\]|\\.)*"/g, '" "');
}

export function scanModelicaClasses(source: string): ModelicaClassInfo[] {
  const cleanSource = stripNonCode(source);
  const tokens = cleanSource.match(/'[^']*'|[A-Za-z_][A-Za-z0-9_]*|[;=()]/g) ?? [];
  const classes: ModelicaClassInfo[] = [];
  const stack: ModelicaClassInfo[] = [];
  let parenDepth = 0;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    const next = tokens[i + 1];

    if (tok === "experiment" && next === "(") {
      const top = stack[stack.length - 1];
      if (top) top.hasExperiment = true;
    }

    if (tok === "(") {
      parenDepth++;
      continue;
    }
    if (tok === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (parenDepth > 0) continue;

    if (tok === "end" && next && tokens[i + 2] === ";" && stack[stack.length - 1]?.name === next) {
      stack.pop();
      i += 2;
      continue;
    }

    if (!KINDS.has(tok) || !next || RESERVED_AFTER_KIND.has(next) || !/^[A-Za-z_']/.test(next)) continue;
    // Short class definitions (`type Foo = Real;`, `model M = Base;`) have no body or `end`.
    if (tokens[i + 2] === "=") continue;

    const prefix = tokens.slice(Math.max(0, i - 4), i);
    const parent = stack[stack.length - 1];
    const name = next.replace(/^'|'$/g, "");
    const kind = tok as ModelicaClassKind;
    const partial = prefix.includes("partial");

    // Inspect class body in cleanSource for diagram annotations or connect equations
    let hasDiagram = false;
    let hasSimulation = false;
    if (kind === "model" || kind === "block" || kind === "class") {
      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const classPattern = new RegExp(
        `\\b(?:model|block|class)\\s+${escapedName}\\b([\\s\\S]*?)\\bend\\s+${escapedName}\\s*;`,
        "i",
      );
      const match = cleanSource.match(classPattern);
      const classBody = match ? match[1] || "" : "";
      if (classBody) {
        hasDiagram =
          /\bPlacement\s*\(/i.test(classBody) ||
          /\bconnect\s*\(/i.test(classBody) ||
          /\bLine\s*\(/i.test(classBody) ||
          /\bPolygon\s*\(/i.test(classBody);
        hasSimulation =
          !partial &&
          (/\bequation\b/i.test(classBody) ||
            /\balgorithm\b/i.test(classBody) ||
            /\bder\s*\(/i.test(classBody) ||
            /\bextends\b/i.test(classBody) ||
            /\bconnect\s*\(/i.test(classBody));
      } else {
        hasSimulation = !partial;
      }
    }

    const info: ModelicaClassInfo = {
      name,
      qualifiedName: parent ? `${parent.qualifiedName}.${name}` : name,
      kind,
      partial,
      depth: stack.length,
      hasExperiment: false,
      hasDiagram,
      hasSimulation,
    };
    classes.push(info);
    stack.push(info);
    i += 1;
  }

  return classes;
}

/** Classes worth offering as "the model to show": everything except type aliases, and packages when real models exist. */
export function selectableModelicaClasses(classes: ModelicaClassInfo[]): ModelicaClassInfo[] {
  const withoutTypes = classes.filter((c) => c.kind !== "type");
  const nonPackages = withoutTypes.filter((c) => c.kind !== "package");
  return nonPackages.length > 0 ? nonPackages : [];
}

/** Best default: a runnable (non-partial) model with an experiment, then any non-partial model, then the first class. */
export function defaultModelicaClass(candidates: ModelicaClassInfo[]): ModelicaClassInfo | undefined {
  return (
    candidates.find((c) => c.kind === "model" && !c.partial && c.hasExperiment) ??
    candidates.find((c) => (c.kind === "model" || c.kind === "block" || c.kind === "class") && !c.partial) ??
    candidates[0]
  );
}
