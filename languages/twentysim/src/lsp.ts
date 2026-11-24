// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for `@modelscript/twentysim`:
 * diagnostics, documentSymbols, hover, and completions.
 */

import { lintTwentySim } from "./lints/index.js";
import { parseTwentySim } from "./parser/emx-parser.js";
import type { TwentySimSubmodel } from "./types.js";

export interface TwentySimLspPosition {
  line: number;
  character: number;
}

export interface TwentySimLspRange {
  start: TwentySimLspPosition;
  end: TwentySimLspPosition;
}

export interface TwentySimLspDiagnostic {
  range: TwentySimLspRange;
  severity: 1 | 2 | 3 | 4;
  code: string;
  source: string;
  message: string;
}

export interface TwentySimLspDocumentSymbol {
  name: string;
  detail?: string | undefined;
  kind: number;
  range: TwentySimLspRange;
  selectionRange: TwentySimLspRange;
  children?: TwentySimLspDocumentSymbol[] | undefined;
}

export interface TwentySimLspHover {
  contents: {
    kind: "markdown" | "plaintext";
    value: string;
  };
}

export interface TwentySimLspCompletionItem {
  label: string;
  kind: number;
  detail?: string | undefined;
  documentation?: string | undefined;
}

const SIDOPS_COMPLETIONS: TwentySimLspCompletionItem[] = [
  { label: "parameters", kind: 14, detail: "SIDOPS section", documentation: "Declare model parameters." },
  { label: "constants", kind: 14, detail: "SIDOPS section", documentation: "Declare model constants." },
  { label: "variables", kind: 14, detail: "SIDOPS section", documentation: "Declare local/global variables." },
  { label: "ports", kind: 14, detail: "SIDOPS section", documentation: "Declare power or signal ports." },
  {
    label: "submodels",
    kind: 14,
    detail: "SIDOPS section",
    documentation: "Instantiate Bond Graph or child submodels.",
  },
  {
    label: "connections",
    kind: 14,
    detail: "SIDOPS section",
    documentation: "Connect power bonds (=>) or signals (->).",
  },
  { label: "initialequations", kind: 14, detail: "SIDOPS section", documentation: "Initial condition equations." },
  {
    label: "equations",
    kind: 14,
    detail: "SIDOPS section",
    documentation: "Acausal differential-algebraic equations.",
  },
  { label: "ddt", kind: 3, detail: "ddt(x)", documentation: "Time derivative operator dx/dt." },
  { label: "int", kind: 3, detail: "int(x, x0)", documentation: "Time integral operator with initial value x0." },
];

const BOND_GRAPH_DOCS: Record<string, string> = {
  "0": "**0-Junction (Common Effort):** Equal efforts ($e_1 = e_2 = \\dots$), zero-sum flows ($\\sum s_i f_i = 0$).",
  "1": "**1-Junction (Common Flow):** Equal flows ($f_1 = f_2 = \\dots$), zero-sum efforts ($\\sum s_i e_i = 0$).",
  R: "**R-Element (Resistor / Damper):** Dissipative constitutive relation $e = R \\cdot f$.",
  C: "**C-Element (Capacitor / Spring):** Generalized displacement storage $\\dot{q} = f,\\; e = q / C$.",
  I: "**I-Element (Inductor / Inertia):** Generalized momentum storage $\\dot{p} = e,\\; f = p / I$.",
  Se: "**Se (Effort Source):** Imposes effort $e = e_0$ (fixed effort-out causality).",
  Sf: "**Sf (Flow Source):** Imposes flow $f = f_0$ (fixed flow-out causality).",
  TF: "**TF (Transformer):** Power-conserving scaling $e_1 = m e_2,\\; f_2 = m f_1$.",
  GY: "**GY (Gyrator):** Power-conserving cross-coupling $e_1 = r f_2,\\; e_2 = r f_1$.",
  ddt: "**ddt(x):** Time derivative $\\frac{dx}{dt}$ in SIDOPS equations.",
  int: "**int(x, x0):** Time integrator with initial state `x0`.",
};

function makeLineRange(line1Based = 1): TwentySimLspRange {
  const line = Math.max(0, line1Based - 1);
  return {
    start: { line, character: 0 },
    end: { line, character: 80 },
  };
}

function submodelToSymbol(sub: TwentySimSubmodel): TwentySimLspDocumentSymbol {
  const range = makeLineRange(sub.line ?? 1);
  const children: TwentySimLspDocumentSymbol[] = [
    ...sub.parameters.map((p) => ({
      name: p.name,
      detail: `${p.type}${p.value !== undefined ? ` = ${p.value}` : ""}`,
      kind: 14, // Constant
      range: makeLineRange(p.line ?? sub.line ?? 1),
      selectionRange: makeLineRange(p.line ?? sub.line ?? 1),
    })),
    ...sub.variables.map((v) => ({
      name: v.name,
      detail: v.type,
      kind: 13, // Variable
      range: makeLineRange(v.line ?? sub.line ?? 1),
      selectionRange: makeLineRange(v.line ?? sub.line ?? 1),
    })),
    ...sub.ports.map((port) => ({
      name: port.name,
      detail: `${port.kind} (${port.direction})`,
      kind: 8, // Field
      range: makeLineRange(port.line ?? sub.line ?? 1),
      selectionRange: makeLineRange(port.line ?? sub.line ?? 1),
    })),
    ...sub.submodels.map(submodelToSymbol),
  ];

  return {
    name: sub.name,
    detail: sub.elementKind,
    kind: 5, // Class
    range,
    selectionRange: range,
    children,
  };
}

export function validateTwentySim(source: string): TwentySimLspDiagnostic[] {
  const diagnostics = lintTwentySim(source);
  return diagnostics.map((d) => ({
    range: makeLineRange(d.line ?? 1),
    severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
    code: d.id,
    source: "twentysim",
    message: d.message,
  }));
}

export function getTwentySimDocumentSymbols(source: string): TwentySimLspDocumentSymbol[] {
  const model = parseTwentySim(source);
  return [submodelToSymbol(model.root)];
}

export function getTwentySimHover(source: string, offset: number): TwentySimLspHover | null {
  const clamped = Math.max(0, Math.min(offset, source.length));
  let start = clamped;
  while (start > 0 && /[A-Za-z0-9_]/.test(source[start - 1]!)) start--;
  let end = clamped;
  while (end < source.length && /[A-Za-z0-9_]/.test(source[end]!)) end++;
  const word = source.slice(start, end);
  if (!word) return null;

  const doc = BOND_GRAPH_DOCS[word];
  if (doc) {
    return { contents: { kind: "markdown", value: doc } };
  }

  const model = parseTwentySim(source);
  const sub = model.root.submodels.find((s) => s.name === word);
  if (sub) {
    return {
      contents: {
        kind: "markdown",
        value: `**Submodel \`${sub.name}\`** (\`${sub.elementKind}\`) — ${sub.ports.length} port(s), ${sub.parameters.length} parameter(s)`,
      },
    };
  }

  return null;
}

export function getTwentySimCompletions(): TwentySimLspCompletionItem[] {
  return SIDOPS_COMPLETIONS;
}
