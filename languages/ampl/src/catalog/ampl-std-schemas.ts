// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * AMPL cleanroom standard library archetype IDs matching `assets/ampl-std-lib/src/models.ts`.
 */
export const AmplArchetypeId = {
  // Elementary & Transcendental Math (1..20)
  MATH_ABS: 1,
  MATH_CEIL: 2,
  MATH_FLOOR: 3,
  MATH_ROUND: 4,
  MATH_TRUNC: 5,
  MATH_MOD: 6,
  MATH_DIV: 7,
  MATH_MIN: 8,
  MATH_MAX: 9,
  MATH_EXP: 10,
  MATH_LOG: 11,
  MATH_LOG10: 12,
  MATH_SQRT: 13,
  MATH_SIN: 14,
  MATH_COS: 15,
  MATH_TAN: 16,
  MATH_ATAN2: 17,
  MATH_SINH: 18,
  MATH_COSH: 19,
  MATH_TANH: 20,

  // Probability & Distributions (30..35)
  DIST_NORMAL: 30,
  DIST_UNIFORM: 31,
  DIST_EXPONENTIAL: 32,
  DIST_POISSON: 33,
  DIST_BETA: 34,
  DIST_GAMMA: 35,

  // Optimization, Piecewise-Linear & Set/Aggregation (40..46)
  OPT_PWL: 40,
  OPT_PRECISION: 41,
  OPT_LESS: 42,
  OPT_SUM: 43,
  OPT_PROD: 44,
  OPT_CARD: 45,
  OPT_ORD: 46,
} as const;

export type AmplArchetypeId = (typeof AmplArchetypeId)[keyof typeof AmplArchetypeId];

export interface AmplModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category:
    | "Elementary Math"
    | "Transcendental Math"
    | "Probability / Distribution"
    | "Optimization / PWL"
    | "Set / Aggregation";
  archetypeId: AmplArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<AmplModelSpec["category"], { fill: string; stroke: string; badge: string }> = {
  "Elementary Math": { fill: "#1e3a5f", stroke: "#60a5fa", badge: "MTH" },
  "Transcendental Math": { fill: "#2a2b4a", stroke: "#818cf8", badge: "TRN" },
  "Probability / Distribution": { fill: "#3b1f47", stroke: "#c084fc", badge: "PRB" },
  "Optimization / PWL": { fill: "#1e3f2f", stroke: "#34d399", badge: "OPT" },
  "Set / Aggregation": { fill: "#3f2e18", stroke: "#fbbf24", badge: "SET" },
};

/**
 * Generates a deterministic cleanroom SVG block icon for an AMPL standard library function.
 */
export function generateAmplBlockSvg(modelType: string, category: AmplModelSpec["category"]): string {
  const c = CATEGORY_COLORS[category];
  const shortName = modelType
    .replace(/^ampl_/, "")
    .toUpperCase()
    .slice(0, 8);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 48" width="80" height="48">` +
    `<rect x="2" y="2" width="76" height="44" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="24" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="18" y="15" text-anchor="middle" font-family="monospace" font-size="7.5" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="40" y="34" text-anchor="middle" font-family="monospace" font-size="10" font-weight="bold" fill="#f8fafc">${shortName}</text>` +
    `</svg>`
  );
}

function defaultPortsForCategory(category: AmplModelSpec["category"]): DiagramPortSpec[] {
  switch (category) {
    case "Elementary Math":
    case "Transcendental Math":
      return [
        { name: "x", kind: "signal", side: "left", dx: 0, dy: 24 },
        { name: "y", kind: "signal", side: "right", dx: 80, dy: 24 },
      ];
    case "Probability / Distribution":
      return [
        { name: "x", kind: "signal", side: "left", dx: 0, dy: 24 },
        { name: "pdf", kind: "signal", side: "right", dx: 80, dy: 14 },
        { name: "cdf", kind: "signal", side: "right", dx: 80, dy: 34 },
      ];
    case "Optimization / PWL":
      return [
        { name: "x", kind: "signal", side: "left", dx: 0, dy: 14 },
        { name: "ref", kind: "signal", side: "left", dx: 0, dy: 34 },
        { name: "y", kind: "signal", side: "right", dx: 80, dy: 24 },
      ];
    case "Set / Aggregation":
      return [
        { name: "items", kind: "signal", side: "left", dx: 0, dy: 24 },
        { name: "out", kind: "signal", side: "right", dx: 80, dy: 24 },
      ];
  }
}

/**
 * Cleanroom catalog of AMPL built-in mathematical, statistical, piecewise-linear,
 * and set/aggregation functions derived from published AMPL, IEEE 754, and
 * Abramowitz & Stegun specifications.
 */
export const AMPL_MODEL_SPECS: readonly AmplModelSpec[] = [
  // === Elementary Math ===
  {
    modelType: "ampl_abs",
    aliases: ["abs", "ABS"],
    label: "Absolute Value abs(x)",
    category: "Elementary Math",
    archetypeId: AmplArchetypeId.MATH_ABS,
    description: "Returns the non-negative magnitude |x| of a real scalar expression.",
    provenance:
      "Fourer, Gay & Kernighan, AMPL: A Modeling Language for Mathematical Programming (Table A-1) / IEEE 754",
    params: [],
  },
  {
    modelType: "ampl_ceil",
    aliases: ["ceil", "CEIL"],
    label: "Ceiling Function ceil(x)",
    category: "Elementary Math",
    archetypeId: AmplArchetypeId.MATH_CEIL,
    description: "Returns the smallest integer value greater than or equal to x.",
    provenance: "Fourer, Gay & Kernighan, AMPL Book (Table A-1) / IEEE 754",
    params: [],
  },
  {
    modelType: "ampl_floor",
    aliases: ["floor", "FLOOR"],
    label: "Floor Function floor(x)",
    category: "Elementary Math",
    archetypeId: AmplArchetypeId.MATH_FLOOR,
    description: "Returns the largest integer value less than or equal to x.",
    provenance: "Fourer, Gay & Kernighan, AMPL Book (Table A-1) / IEEE 754",
    params: [],
  },
  {
    modelType: "ampl_round",
    aliases: ["round", "ROUND"],
    label: "Decimal Rounding round(x, n)",
    category: "Elementary Math",
    archetypeId: AmplArchetypeId.MATH_ROUND,
    description: "Rounds x to n decimal places (negative n rounds to powers of 10).",
    provenance: "Fourer, Gay & Kernighan, AMPL Book (Section 7.4, Table A-1)",
    params: [["digits", 0, "", "Number of decimal places n (negative rounds left of decimal)"]],
  },
  {
    modelType: "ampl_trunc",
    aliases: ["trunc", "TRUNC"],
    label: "Decimal Truncation trunc(x, n)",
    category: "Elementary Math",
    archetypeId: AmplArchetypeId.MATH_TRUNC,
    description: "Truncates x toward zero to n decimal places.",
    provenance: "Fourer, Gay & Kernighan, AMPL Book (Section 7.4, Table A-1)",
    params: [["digits", 0, "", "Number of decimal places n to retain"]],
  },
  {
    modelType: "ampl_mod",
    aliases: ["mod", "MOD"],
    label: "Floored Modulo mod(a, b)",
    category: "Elementary Math",
    archetypeId: AmplArchetypeId.MATH_MOD,
    description: "Computes the AMPL remainder a - b * floor(a / b) for nonzero divisor b.",
    provenance: "Fourer, Gay & Kernighan, AMPL Book (Section 7.2, Arithmetic Operators)",
    params: [["divisor", 1.0, "", "Default divisor b when second input is omitted"]],
  },
  {
    modelType: "ampl_div",
    aliases: ["div", "DIV"],
    label: "Integer Quotient div(a, b)",
    category: "Elementary Math",
    archetypeId: AmplArchetypeId.MATH_DIV,
    description: "Computes the truncated integer quotient trunc(a / b) for nonzero divisor b.",
    provenance: "Fourer, Gay & Kernighan, AMPL Book (Section 7.2, Arithmetic Operators)",
    params: [["divisor", 1.0, "", "Default divisor b when second input is omitted"]],
  },
  {
    modelType: "ampl_min",
    aliases: ["min", "MIN"],
    label: "Minimum min(a, b)",
    category: "Elementary Math",
    archetypeId: AmplArchetypeId.MATH_MIN,
    description: "Returns the minimum of two or more real arguments.",
    provenance: "Fourer, Gay & Kernighan, AMPL Book (Table A-1) / IEEE 754",
    params: [["rhs", 0.0, "", "Default comparison value b"]],
  },
  {
    modelType: "ampl_max",
    aliases: ["max", "MAX"],
    label: "Maximum max(a, b)",
    category: "Elementary Math",
    archetypeId: AmplArchetypeId.MATH_MAX,
    description: "Returns the maximum of two or more real arguments.",
    provenance: "Fourer, Gay & Kernighan, AMPL Book (Table A-1) / IEEE 754",
    params: [["rhs", 0.0, "", "Default comparison value b"]],
  },

  // === Transcendental Math ===
  {
    modelType: "ampl_exp",
    aliases: ["exp", "EXP"],
    label: "Exponential exp(x)",
    category: "Transcendental Math",
    archetypeId: AmplArchetypeId.MATH_EXP,
    description: "Computes the natural exponential e^x with derivative e^x.",
    provenance: "Fourer, Gay & Kernighan, AMPL Book (Table A-1) / IEEE 754",
    params: [],
  },
  {
    modelType: "ampl_log",
    aliases: ["log", "ln", "LOG"],
    label: "Natural Logarithm log(x)",
    category: "Transcendental Math",
    archetypeId: AmplArchetypeId.MATH_LOG,
    description: "Computes the natural logarithm ln(x) for x > 0 with derivative 1/x.",
    provenance: "Fourer, Gay & Kernighan, AMPL Book (Table A-1) / IEEE 754",
    params: [],
  },
  {
    modelType: "ampl_log10",
    aliases: ["log10", "LOG10"],
    label: "Base-10 Logarithm log10(x)",
    category: "Transcendental Math",
    archetypeId: AmplArchetypeId.MATH_LOG10,
    description: "Computes the common logarithm log10(x) for x > 0.",
    provenance: "Fourer, Gay & Kernighan, AMPL Book (Table A-1) / IEEE 754",
    params: [],
  },
  {
    modelType: "ampl_sqrt",
    aliases: ["sqrt", "SQRT"],
    label: "Square Root sqrt(x)",
    category: "Transcendental Math",
    archetypeId: AmplArchetypeId.MATH_SQRT,
    description: "Computes the principal square root sqrt(x) for x >= 0.",
    provenance: "Fourer, Gay & Kernighan, AMPL Book (Table A-1) / IEEE 754",
    params: [],
  },
  {
    modelType: "ampl_sin",
    aliases: ["sin", "SIN"],
    label: "Sine sin(x)",
    category: "Transcendental Math",
    archetypeId: AmplArchetypeId.MATH_SIN,
    description: "Computes the trigonometric sine of angle x (radians).",
    provenance: "Fourer, Gay & Kernighan, AMPL Book (Table A-1) / IEEE 754",
    params: [],
  },
  {
    modelType: "ampl_cos",
    aliases: ["cos", "COS"],
    label: "Cosine cos(x)",
    category: "Transcendental Math",
    archetypeId: AmplArchetypeId.MATH_COS,
    description: "Computes the trigonometric cosine of angle x (radians).",
    provenance: "Fourer, Gay & Kernighan, AMPL Book (Table A-1) / IEEE 754",
    params: [],
  },
  {
    modelType: "ampl_tan",
    aliases: ["tan", "TAN"],
    label: "Tangent tan(x)",
    category: "Transcendental Math",
    archetypeId: AmplArchetypeId.MATH_TAN,
    description: "Computes the trigonometric tangent of angle x (radians).",
    provenance: "Fourer, Gay & Kernighan, AMPL Book (Table A-1) / IEEE 754",
    params: [],
  },
  {
    modelType: "ampl_atan2",
    aliases: ["atan2", "ATAN2"],
    label: "Two-Argument Arctangent atan2(y, x)",
    category: "Transcendental Math",
    archetypeId: AmplArchetypeId.MATH_ATAN2,
    description: "Computes the principal value of arctan(y / x) in (-pi, pi] using quadrant signs.",
    provenance: "Fourer, Gay & Kernighan, AMPL Book (Table A-1) / IEEE 754",
    params: [["x", 1.0, "", "Default denominator coordinate x"]],
  },
  {
    modelType: "ampl_sinh",
    aliases: ["sinh", "SINH"],
    label: "Hyperbolic Sine sinh(x)",
    category: "Transcendental Math",
    archetypeId: AmplArchetypeId.MATH_SINH,
    description: "Computes the hyperbolic sine (e^x - e^-x) / 2.",
    provenance: "Fourer, Gay & Kernighan, AMPL Book (Table A-1) / Abramowitz & Stegun 4.5",
    params: [],
  },
  {
    modelType: "ampl_cosh",
    aliases: ["cosh", "COSH"],
    label: "Hyperbolic Cosine cosh(x)",
    category: "Transcendental Math",
    archetypeId: AmplArchetypeId.MATH_COSH,
    description: "Computes the hyperbolic cosine (e^x + e^-x) / 2.",
    provenance: "Fourer, Gay & Kernighan, AMPL Book (Table A-1) / Abramowitz & Stegun 4.5",
    params: [],
  },
  {
    modelType: "ampl_tanh",
    aliases: ["tanh", "TANH"],
    label: "Hyperbolic Tangent tanh(x)",
    category: "Transcendental Math",
    archetypeId: AmplArchetypeId.MATH_TANH,
    description: "Computes the hyperbolic tangent sinh(x) / cosh(x).",
    provenance: "Fourer, Gay & Kernighan, AMPL Book (Table A-1) / Abramowitz & Stegun 4.5",
    params: [],
  },

  // === Probability & Distributions ===
  {
    modelType: "ampl_Normal",
    aliases: ["Normal", "Normal01", "normal"],
    label: "Normal Distribution Normal(mu, sigma)",
    category: "Probability / Distribution",
    archetypeId: AmplArchetypeId.DIST_NORMAL,
    description:
      "Evaluates Normal(mu, sigma) probability density (PDF) and cumulative distribution (CDF) via A&S 7.1.26 erf.",
    provenance: "Fourer, Gay & Kernighan, AMPL Book (Table A-3) / Abramowitz & Stegun 7.1.26 & 26.2",
    params: [
      ["mu", 0.0, "", "Distribution mean"],
      ["sigma", 1.0, "", "Standard deviation (> 0)"],
    ],
  },
  {
    modelType: "ampl_Uniform",
    aliases: ["Uniform", "Uniform01", "uniform"],
    label: "Uniform Distribution Uniform(a, b)",
    category: "Probability / Distribution",
    archetypeId: AmplArchetypeId.DIST_UNIFORM,
    description: "Evaluates continuous Uniform(a, b) density and CDF on [a, b].",
    provenance: "Fourer, Gay & Kernighan, AMPL Book (Table A-3) / Abramowitz & Stegun 26.1",
    params: [
      ["a", 0.0, "", "Lower bound"],
      ["b", 1.0, "", "Upper bound (> a)"],
    ],
  },
  {
    modelType: "ampl_Exponential",
    aliases: ["Exponential", "exponential"],
    label: "Exponential Distribution Exponential(lambda)",
    category: "Probability / Distribution",
    archetypeId: AmplArchetypeId.DIST_EXPONENTIAL,
    description: "Evaluates Exponential(lambda) PDF lambda*exp(-lambda*x) and CDF 1 - exp(-lambda*x) for x >= 0.",
    provenance: "Fourer, Gay & Kernighan, AMPL Book (Table A-3) / Abramowitz & Stegun 26.1",
    params: [["rate", 1.0, "", "Rate parameter lambda (> 0)"]],
  },
  {
    modelType: "ampl_Poisson",
    aliases: ["Poisson", "poisson"],
    label: "Poisson Distribution Poisson(lambda)",
    category: "Probability / Distribution",
    archetypeId: AmplArchetypeId.DIST_POISSON,
    description: "Evaluates discrete Poisson(lambda) PMF (lambda^k * e^-lambda) / k! using log-gamma.",
    provenance: "Fourer, Gay & Kernighan, AMPL Book (Table A-3) / Abramowitz & Stegun 26.1.22",
    params: [["lambda", 1.0, "", "Expected event rate lambda (> 0)"]],
  },
  {
    modelType: "ampl_Beta",
    aliases: ["Beta", "beta"],
    label: "Beta Distribution Beta(alpha, beta)",
    category: "Probability / Distribution",
    archetypeId: AmplArchetypeId.DIST_BETA,
    description: "Evaluates continuous Beta(alpha, beta) probability density on (0, 1) via Lanczos log-gamma.",
    provenance: "Fourer, Gay & Kernighan, AMPL Book (Table A-3) / Abramowitz & Stegun 6.2 & 26.1.33",
    params: [
      ["alpha", 2.0, "", "Shape parameter alpha (> 0)"],
      ["beta", 2.0, "", "Shape parameter beta (> 0)"],
    ],
  },
  {
    modelType: "ampl_Gamma",
    aliases: ["Gamma", "gamma"],
    label: "Gamma Function Gamma(x)",
    category: "Probability / Distribution",
    archetypeId: AmplArchetypeId.DIST_GAMMA,
    description:
      "Evaluates the Euler Gamma function Gamma(x) and ln|Gamma(x)| via 9-term Lanczos approximation with reflection.",
    provenance: "Fourer, Gay & Kernighan, AMPL Book (Table A-3) / Abramowitz & Stegun 6.1 / Lanczos (1964)",
    params: [],
  },

  // === Optimization & Piecewise-Linear ===
  {
    modelType: "ampl_pwl",
    aliases: ["pwl", "PWL", "piecewise"],
    label: "Continuous Piecewise-Linear <<bp1, bp2; s0, s1, s2>> x",
    category: "Optimization / PWL",
    archetypeId: AmplArchetypeId.OPT_PWL,
    description:
      "Evaluates AMPL continuous piecewise-linear expression <<bp1, bp2; s0, s1, s2>> x anchored at f(0) = 0 with active slope output.",
    provenance: "Fourer, Gay & Kernighan, AMPL Book (Chapter 17, Piecewise-Linear Programs)",
    params: [
      ["bp1", 10.0, "", "First breakpoint"],
      ["bp2", 20.0, "", "Second breakpoint (>= bp1)"],
      ["s0", 1.0, "", "Slope for x < bp1"],
      ["s1", 2.0, "", "Slope for bp1 <= x < bp2"],
      ["s2", 5.0, "", "Slope for x >= bp2"],
    ],
  },
  {
    modelType: "ampl_precision",
    aliases: ["precision", "PRECISION"],
    label: "Significant-Digit Rounding precision(x, n)",
    category: "Optimization / PWL",
    archetypeId: AmplArchetypeId.OPT_PRECISION,
    description: "Rounds x to n significant decimal digits for presolve and display normalization.",
    provenance: "Fourer, Gay & Kernighan, AMPL Book (Section 7.4, Table A-1)",
    params: [["sigfigs", 6, "", "Number of significant decimal digits n (>= 1)"]],
  },
  {
    modelType: "ampl_less",
    aliases: ["less", "LESS"],
    label: "Positive Excess less(a, b) = max(a - b, 0)",
    category: "Optimization / PWL",
    archetypeId: AmplArchetypeId.OPT_LESS,
    description: "Computes the AMPL piecewise-linear hinge function less(a, b) = max(a - b, 0).",
    provenance: "Fourer, Gay & Kernighan, AMPL Book (Table A-1, Section 7.4)",
    params: [["b", 0.0, "", "Default threshold b when second input is omitted"]],
  },

  // === Set & Aggregation ===
  {
    modelType: "ampl_sum",
    aliases: ["sum", "SUM"],
    label: "Indexed Summation sum{i in S} x[i]",
    category: "Set / Aggregation",
    archetypeId: AmplArchetypeId.OPT_SUM,
    description: "Aggregates the sum of indexed numeric expressions over an AMPL indexing set.",
    provenance: "Fourer, Gay & Kernighan, AMPL Book (Section 7.3, Iterated Operators)",
    params: [],
  },
  {
    modelType: "ampl_prod",
    aliases: ["prod", "PROD"],
    label: "Indexed Product prod{i in S} x[i]",
    category: "Set / Aggregation",
    archetypeId: AmplArchetypeId.OPT_PROD,
    description: "Aggregates the product of indexed numeric expressions over an AMPL indexing set.",
    provenance: "Fourer, Gay & Kernighan, AMPL Book (Section 7.3, Iterated Operators)",
    params: [],
  },
  {
    modelType: "ampl_card",
    aliases: ["card", "CARD"],
    label: "Set Cardinality card(S)",
    category: "Set / Aggregation",
    archetypeId: AmplArchetypeId.OPT_CARD,
    description: "Returns the non-negative integer cardinality |S| of a finite AMPL set.",
    provenance: "Fourer, Gay & Kernighan, AMPL Book (Section 5.6, Built-in Set Functions)",
    params: [],
  },
  {
    modelType: "ampl_ord",
    aliases: ["ord", "ORD", "ord0"],
    label: "Ordered Set Position ord(e, S)",
    category: "Set / Aggregation",
    archetypeId: AmplArchetypeId.OPT_ORD,
    description: "Returns the 1-based ordinal index of member e within an ordered AMPL set S.",
    provenance: "Fourer, Gay & Kernighan, AMPL Book (Section 5.6, Ordered Sets)",
    params: [["size", 1, "", "Ordered set cardinality upper bound"]],
  },
];

/**
 * Converts `AMPL_MODEL_SPECS` into shared `@modelscript/runtime` `CleanroomModelSchema[]`
 * with cleanroom parametric SVG icons and port layouts.
 */
export function buildAmplCleanroomSchemas(): CleanroomModelSchema[] {
  return AMPL_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `ampl:${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases,
      label: spec.label,
      category: spec.category,
      domain: "optimization",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "ampl_builtin_function",
      width: 80,
      height: 48,
      svg: generateAmplBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForCategory(spec.category),
      parameters,
      wasmKernel: spec.modelType,
      extra: {
        archetypeId: spec.archetypeId,
      },
    };
  });
}
