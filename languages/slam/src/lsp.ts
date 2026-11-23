// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for `@modelscript/slam`:
 * diagnostics, documentSymbols, hover, and completions.
 */

import { SLAM_BLOCK_SPECS, lookupSlamModelSchema } from "./catalog/index.js";
import { lintSlam } from "./lints/index.js";
import { parseSlamDeck } from "./parser/slam-parser.js";

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export enum LspSymbolKind {
  File = 1,
  Module = 2,
  Namespace = 3,
  Package = 4,
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  Event = 24,
}

export interface LspDocumentSymbol {
  name: string;
  detail?: string | undefined;
  kind: LspSymbolKind;
  range: LspRange;
  selectionRange: LspRange;
  children?: LspDocumentSymbol[] | undefined;
}

export interface LspDiagnostic {
  range: LspRange;
  severity: 1 | 2 | 3 | 4;
  code: string;
  source: string;
  message: string;
}

export interface LspHover {
  contents: {
    kind: "markdown" | "plaintext";
    value: string;
  };
  range?: LspRange | undefined;
}

export interface LspCompletionItem {
  label: string;
  kind: number; // 14 = Keyword, 7 = Class/Block, 6 = Variable, 3 = Function
  detail: string;
  documentation: string;
  insertText?: string | undefined;
}

const DEFAULT_RANGE: LspRange = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 1 },
};

/**
 * Validates a SLAM II simulation deck and returns LSP diagnostics.
 */
export function validateSlam(content: string, _uri: string = "model.slam"): LspDiagnostic[] {
  try {
    const model = parseSlamDeck(content);
    const diags = lintSlam(model);

    return diags.map((d) => {
      const startLine = Math.max(0, d.line - 1);
      const startChar = Math.max(0, d.column - 1);
      const endLine = d.endLine ? Math.max(startLine, d.endLine - 1) : startLine;
      const endChar = d.endColumn ? Math.max(startChar + 1, d.endColumn - 1) : startChar + 1;

      return {
        range: {
          start: { line: startLine, character: startChar },
          end: { line: endLine, character: endChar },
        },
        severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
        code: d.id,
        source: "modelscript-slam",
        message: d.message,
      };
    });
  } catch (err: unknown) {
    return [
      {
        range: DEFAULT_RANGE,
        severity: 1,
        code: "SLAM1001",
        source: "modelscript-slam",
        message: `Failed to parse SLAM II deck: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }
}

/**
 * Extracts hierarchical LSP document symbols for a SLAM II deck.
 */
export function getSlamDocumentSymbols(content: string, _uri: string = "model.slam"): LspDocumentSymbol[] {
  try {
    const model = parseSlamDeck(content);
    const children: LspDocumentSymbol[] = [];

    for (const eq of model.stateEquations) {
      const range: LspRange = {
        start: { line: Math.max(0, eq.span.line - 1), character: Math.max(0, eq.span.column - 1) },
        end: { line: Math.max(0, eq.span.endLine - 1), character: Math.max(0, eq.span.endColumn - 1) },
      };
      children.push({
        name: `${eq.lhsKind}(${eq.index})`,
        detail: `${eq.lhsKind === "DD" ? "Differential" : "Algebraic"} state = ${eq.rhsText}`,
        kind: LspSymbolKind.Variable,
        range,
        selectionRange: range,
      });
    }

    for (const node of model.nodes) {
      const range: LspRange = {
        start: { line: Math.max(0, node.span.line - 1), character: Math.max(0, node.span.column - 1) },
        end: { line: Math.max(0, node.span.endLine - 1), character: Math.max(0, node.span.endColumn - 1) },
      };
      let kind = LspSymbolKind.Property;
      let detail: string = node.type;
      if (node.type === "RESOURCE") {
        kind = LspSymbolKind.Class;
        detail = `Resource | Capacity: ${node.resourceUnits ?? 1}`;
      } else if (node.type === "GATE") {
        kind = LspSymbolKind.Interface;
        detail = `Gate | Initial: ${node.gateInitialOpen ? "OPEN" : "CLOSED"}`;
      } else if (node.type === "DETECT") {
        kind = LspSymbolKind.Event;
        detail = `Detect ${node.detectVar} ${node.detectDirection} ${node.detectThreshold}`;
      } else if (node.type === "QUEUE") {
        kind = LspSymbolKind.Field;
        detail = `Queue File(${node.fileNumber ?? 1})`;
      } else if (node.type === "CREATE") {
        kind = LspSymbolKind.Constructor;
        detail = `Create TBC=${node.interarrivalExpr ?? "1.0"}`;
      } else if (node.type === "ACTIVITY") {
        kind = LspSymbolKind.Method;
        detail = `Activity DUR=${node.durationExpr ?? "0"}${node.targetLabel ? ` -> ${node.targetLabel}` : ""}`;
      }

      const displayName = node.label
        ? `${node.label} [${node.type}]`
        : node.resourceName && node.type === "RESOURCE"
          ? `${node.resourceName} [RESOURCE]`
          : node.gateName && node.type === "GATE"
            ? `${node.gateName} [GATE]`
            : `${node.id} [${node.type}]`;

      children.push({
        name: displayName,
        detail,
        kind,
        range,
        selectionRange: range,
      });
    }

    return [
      {
        name: model.name || "SLAM_MODEL",
        detail: `Nodes: ${model.nodes.length} | Equations: ${model.stateEquations.length} | Resources: ${model.resources.size}`,
        kind: LspSymbolKind.Package,
        range: DEFAULT_RANGE,
        selectionRange: DEFAULT_RANGE,
        children: children.length > 0 ? children : undefined,
      },
    ];
  } catch {
    return [];
  }
}

const CONTROL_DOCS: Record<string, string> = {
  GEN: "### `GEN, ANALYST, PROJECT, DATE, NNRNS`\nGeneral simulation project metadata and number of simulation runs.",
  LIMITS:
    "### `LIMITS, MFIL, MATR, MNENTRIES`\nDeclares maximum file count (`MFIL`), entity attributes (`MATR`), and concurrent file entries (`MNENTRIES`).",
  CONTINUOUS:
    "### `CONTINUOUS, NNEQD, NNEQS, DTMIN, DTMAX, DTSAV`\nDeclares continuous differential equations (`NNEQD`), algebraic state equations (`NNEQS`), and RK4 step bounds.",
  INTLC:
    "### `INTLC, VAR=VALUE, ...`\nInitializes continuous state variables `SS(i)`, derivatives `DD(i)`, and global discrete variables `XX(i)`.",
  INITIALIZE: "### `INITIALIZE, TTBEG, TTFIN`\nSets simulation start time `TTBEG` and end time `TTFIN`.",
  NETWORK: "### `NETWORK`\nBegins the SLAM II network modeling section (must be closed with `ENDNETWORK`).",
  ENDNETWORK: "### `ENDNETWORK`\nTerminates the SLAM II network modeling section.",
  FIN: "### `FIN`\nTerminates the SLAM II input deck.",
};

function wordAtPosition(line: string, character: number): string {
  const idx = Math.max(0, Math.min(character, line.length));
  let start = idx;
  while (start > 0 && /[A-Za-z0-9_]/.test(line[start - 1]!)) start--;
  let end = idx;
  while (end < line.length && /[A-Za-z0-9_]/.test(line[end]!)) end++;
  return line.slice(start, end);
}

/**
 * Provides contextual Markdown hover documentation for SLAM II statements, nodes, and resources.
 */
export function getSlamHover(
  content: string,
  position: LspPosition,
  _uri: string = "model.slam",
): LspHover | undefined {
  try {
    const lines = content.split(/\r?\n/);
    const line = lines[position.line] ?? "";
    const word = wordAtPosition(line, position.character).toUpperCase();
    if (!word) return undefined;

    if (CONTROL_DOCS[word]) {
      return { contents: { kind: "markdown", value: CONTROL_DOCS[word]! } };
    }

    const schema = lookupSlamModelSchema(word);
    if (schema) {
      const paramLines = schema.parameters
        .map((p) => `- \`${p.key}\` (default: \`${p.defaultValue}\`): ${p.description ?? ""}`)
        .join("\n");
      return {
        contents: {
          kind: "markdown",
          value: `### SLAM II \`${schema.name}\`\n${schema.description}\n\n${paramLines}\n\n*Reference: ${schema.provenance}*`,
        },
      };
    }

    const model = parseSlamDeck(content);
    const res = model.resources.get(word);
    if (res) {
      return {
        contents: {
          kind: "markdown",
          value: `### SLAM II Resource \`${word}\`\n- **Capacity**: \`${res.resourceUnits ?? 1}\`\n- **Primary File**: \`${res.fileNumber ?? 1}\``,
        },
      };
    }
    const gate = model.gates.get(word);
    if (gate) {
      return {
        contents: {
          kind: "markdown",
          value: `### SLAM II Gate \`${word}\`\n- **Initial State**: \`${gate.gateInitialOpen ? "OPEN" : "CLOSED"}\``,
        },
      };
    }

    if (word === "SS" || word === "DD" || word === "XX" || word === "TNOW") {
      const desc: Record<string, string> = {
        SS: "Continuous state variable array `SS(i)`.",
        DD: "Time derivative array `DD(i) = d(SS(i))/dt`.",
        XX: "Global discrete-continuous shared variable array `XX(i)`.",
        TNOW: "Current simulation clock time `TNOW`.",
      };
      return { contents: { kind: "markdown", value: `### SLAM II \`${word}\`\n${desc[word]}` } };
    }

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Returns context-aware LSP completion items for SLAM II control statements, network nodes,
 * distributions, and declared resources/labels in the document.
 */
export function getSlamCompletions(
  content: string,
  _position: LspPosition = { line: 0, character: 0 },
): LspCompletionItem[] {
  const items: LspCompletionItem[] = [];

  for (const [kw, doc] of Object.entries(CONTROL_DOCS)) {
    items.push({
      label: kw,
      kind: 14,
      detail: "SLAM II Control Statement",
      documentation: doc,
    });
  }

  for (const spec of SLAM_BLOCK_SPECS) {
    items.push({
      label: spec.modelType,
      kind: 7,
      detail: spec.label,
      documentation: spec.description,
    });
  }

  const builtins: Array<[string, string]> = [
    ["EXPON(mean)", "Exponential distribution with given mean"],
    ["UNFRM(a, b)", "Uniform distribution on [a, b]"],
    ["RNORM(mu, sigma)", "Normal distribution N(mu, sigma^2)"],
    ["TRIAG(a, m, b)", "Triangular distribution with min a, mode m, max b"],
    ["SS(i)", "Continuous state variable i"],
    ["DD(i)", "Continuous state derivative d(SS(i))/dt"],
    ["XX(i)", "Global discrete-continuous variable i"],
    ["TNOW", "Current simulation time"],
  ];
  for (const [label, doc] of builtins) {
    items.push({ label, kind: 3, detail: "SLAM II Built-in", documentation: doc });
  }

  try {
    const model = parseSlamDeck(content);
    for (const [name, res] of model.resources) {
      items.push({
        label: name,
        kind: 6,
        detail: `RESOURCE (cap=${res.resourceUnits ?? 1})`,
        documentation: `Declared SLAM II resource '${name}'`,
      });
    }
    for (const [label, node] of model.labels) {
      items.push({
        label,
        kind: 6,
        detail: `Node Label (${node.type})`,
        documentation: `Network node label '${label}'`,
      });
    }
  } catch {
    // Ignore parse errors during completion
  }

  return items;
}
