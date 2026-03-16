// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Built-in Modelica functions defined with proper parameter types.
 * Exported as a lightweight Map of function name → parameter info,
 * avoiding the model class infrastructure to prevent instantiation recursion.
 *
 * Reference: Modelica Specification §3.7 (Built-in Intrinsic Operators/Functions)
 */

/** Parameter info for a single function input parameter. */
export interface BuiltinParam {
  readonly name: string;
  readonly type: "Real" | "Integer" | "Boolean" | "String";
  readonly defaultValue?: number | boolean;
}

/** Info for a built-in function definition. */
export interface BuiltinFunctionDef {
  readonly inputs: readonly BuiltinParam[];
  readonly outputType: "Real" | "Integer" | "Boolean" | "String" | null;
}

/**
 * Map of built-in function name → definition with typed parameters.
 * Per-parameter types enable correct type coercion (e.g., String()'s
 * Integer args are NOT coerced to Real even when the first arg is Real).
 */
export const BUILTIN_FUNCTIONS: ReadonlyMap<string, BuiltinFunctionDef> = new Map<string, BuiltinFunctionDef>([
  // §3.7.1 Numeric Functions and Conversion Functions
  ["abs", { inputs: [{ name: "v", type: "Real" }], outputType: "Real" }],
  ["sign", { inputs: [{ name: "v", type: "Real" }], outputType: "Integer" }],
  ["sqrt", { inputs: [{ name: "v", type: "Real" }], outputType: "Real" }],
  ["integer", { inputs: [{ name: "x", type: "Real" }], outputType: "Integer" }],

  // §3.7.1.2 String Conversion (Real variant)
  [
    "String",
    {
      inputs: [
        { name: "x", type: "Real" },
        { name: "significantDigits", type: "Integer", defaultValue: 6 },
        { name: "minimumLength", type: "Integer", defaultValue: 0 },
        { name: "leftJustified", type: "Boolean", defaultValue: true },
      ],
      outputType: "String",
    },
  ],

  // §3.7.2 Derivative and Special Purpose Operators
  ["der", { inputs: [{ name: "x", type: "Real" }], outputType: "Real" }],
  [
    "delay",
    {
      inputs: [
        { name: "expr", type: "Real" },
        { name: "delayTime", type: "Real" },
        { name: "delayMax", type: "Real" },
      ],
      outputType: "Real",
    },
  ],
  [
    "homotopy",
    {
      inputs: [
        { name: "actual", type: "Real" },
        { name: "simplified", type: "Real" },
      ],
      outputType: "Real",
    },
  ],
  [
    "semiLinear",
    {
      inputs: [
        { name: "x", type: "Real" },
        { name: "positiveSlope", type: "Real" },
        { name: "negativeSlope", type: "Real" },
      ],
      outputType: "Real",
    },
  ],
  [
    "spatialDistribution",
    {
      inputs: [
        { name: "in0", type: "Real" },
        { name: "in1", type: "Real" },
        { name: "x", type: "Real" },
        { name: "positiveVelocity", type: "Boolean" },
      ],
      outputType: "Real",
    },
  ],

  // §3.7.3 Event-Related Operators
  ["noEvent", { inputs: [{ name: "expr", type: "Real" }], outputType: "Real" }],
  [
    "smooth",
    {
      inputs: [
        { name: "p", type: "Integer" },
        { name: "expr", type: "Real" },
      ],
      outputType: "Real",
    },
  ],
  [
    "sample",
    {
      inputs: [
        { name: "start", type: "Real" },
        { name: "interval", type: "Real" },
      ],
      outputType: "Boolean",
    },
  ],
  ["pre", { inputs: [{ name: "x", type: "Real" }], outputType: "Real" }],
  ["edge", { inputs: [{ name: "b", type: "Boolean" }], outputType: "Boolean" }],
  ["change", { inputs: [{ name: "x", type: "Real" }], outputType: "Boolean" }],
  ["initial", { inputs: [], outputType: "Boolean" }],
  ["terminal", { inputs: [], outputType: "Boolean" }],
  [
    "reinit",
    {
      inputs: [
        { name: "x", type: "Real" },
        { name: "expr", type: "Real" },
      ],
      outputType: null,
    },
  ],

  // §3.7.4 Mathematical Functions
  ["sin", { inputs: [{ name: "u", type: "Real" }], outputType: "Real" }],
  ["cos", { inputs: [{ name: "u", type: "Real" }], outputType: "Real" }],
  ["tan", { inputs: [{ name: "u", type: "Real" }], outputType: "Real" }],
  ["asin", { inputs: [{ name: "u", type: "Real" }], outputType: "Real" }],
  ["acos", { inputs: [{ name: "u", type: "Real" }], outputType: "Real" }],
  ["atan", { inputs: [{ name: "u", type: "Real" }], outputType: "Real" }],
  [
    "atan2",
    {
      inputs: [
        { name: "u1", type: "Real" },
        { name: "u2", type: "Real" },
      ],
      outputType: "Real",
    },
  ],
  ["sinh", { inputs: [{ name: "u", type: "Real" }], outputType: "Real" }],
  ["cosh", { inputs: [{ name: "u", type: "Real" }], outputType: "Real" }],
  ["tanh", { inputs: [{ name: "u", type: "Real" }], outputType: "Real" }],
  ["exp", { inputs: [{ name: "u", type: "Real" }], outputType: "Real" }],
  ["log", { inputs: [{ name: "u", type: "Real" }], outputType: "Real" }],
  ["log10", { inputs: [{ name: "u", type: "Real" }], outputType: "Real" }],

  // §3.7.5 Array Functions
  ["ndims", { inputs: [{ name: "A", type: "Real" }], outputType: "Integer" }],
  [
    "size",
    {
      inputs: [
        { name: "A", type: "Real" },
        { name: "i", type: "Integer" },
      ],
      outputType: "Integer",
    },
  ],
  ["scalar", { inputs: [{ name: "A", type: "Real" }], outputType: "Real" }],
  ["vector", { inputs: [{ name: "A", type: "Real" }], outputType: "Real" }],
  ["matrix", { inputs: [{ name: "A", type: "Real" }], outputType: "Real" }],
  ["identity", { inputs: [{ name: "n", type: "Integer" }], outputType: "Integer" }],
  ["diagonal", { inputs: [{ name: "v", type: "Real" }], outputType: "Real" }],
  ["zeros", { inputs: [{ name: "n", type: "Integer" }], outputType: "Integer" }],
  ["ones", { inputs: [{ name: "n", type: "Integer" }], outputType: "Integer" }],
  [
    "fill",
    {
      inputs: [
        { name: "s", type: "Real" },
        { name: "n", type: "Integer" },
      ],
      outputType: "Real",
    },
  ],
  [
    "linspace",
    {
      inputs: [
        { name: "x1", type: "Real" },
        { name: "x2", type: "Real" },
        { name: "n", type: "Integer" },
      ],
      outputType: "Real",
    },
  ],
  [
    "min",
    {
      inputs: [
        { name: "x", type: "Real" },
        { name: "y", type: "Real" },
      ],
      outputType: "Real",
    },
  ],
  [
    "max",
    {
      inputs: [
        { name: "x", type: "Real" },
        { name: "y", type: "Real" },
      ],
      outputType: "Real",
    },
  ],
  ["sum", { inputs: [{ name: "A", type: "Real" }], outputType: "Real" }],
  ["product", { inputs: [{ name: "A", type: "Real" }], outputType: "Real" }],
  ["transpose", { inputs: [{ name: "A", type: "Real" }], outputType: "Real" }],
  ["symmetric", { inputs: [{ name: "A", type: "Real" }], outputType: "Real" }],
  [
    "cross",
    {
      inputs: [
        { name: "x", type: "Real" },
        { name: "y", type: "Real" },
      ],
      outputType: "Real",
    },
  ],
  ["skew", { inputs: [{ name: "x", type: "Real" }], outputType: "Real" }],
  [
    "cat",
    {
      inputs: [
        { name: "k", type: "Integer" },
        { name: "A", type: "Real" },
        { name: "B", type: "Real" },
      ],
      outputType: "Real",
    },
  ],
  [
    "promote",
    {
      inputs: [
        { name: "A", type: "Real" },
        { name: "n", type: "Integer" },
      ],
      outputType: "Real",
    },
  ],

  // §3.7.6 Reduction Expressions
  ["ceil", { inputs: [{ name: "x", type: "Real" }], outputType: "Real" }],
  ["floor", { inputs: [{ name: "x", type: "Real" }], outputType: "Real" }],
  [
    "div",
    {
      inputs: [
        { name: "x", type: "Real" },
        { name: "y", type: "Real" },
      ],
      outputType: "Integer",
    },
  ],
  [
    "mod",
    {
      inputs: [
        { name: "x", type: "Real" },
        { name: "y", type: "Real" },
      ],
      outputType: "Real",
    },
  ],
  [
    "rem",
    {
      inputs: [
        { name: "x", type: "Real" },
        { name: "y", type: "Real" },
      ],
      outputType: "Real",
    },
  ],

  // §3.7.7 Special purpose operators
  [
    "assert",
    {
      inputs: [
        { name: "condition", type: "Boolean" },
        { name: "message", type: "String" },
        { name: "level", type: "Integer", defaultValue: 1 },
      ],
      outputType: null,
    },
  ],
  ["terminate", { inputs: [{ name: "message", type: "String" }], outputType: null }],
  ["print", { inputs: [{ name: "str", type: "String" }], outputType: null }],

  // §16 Synchronous Language Elements
  ["Clock", { inputs: [{ name: "interval", type: "Real" }], outputType: "Real" }],
  ["hold", { inputs: [{ name: "u", type: "Real" }], outputType: "Real" }],
  ["previous", { inputs: [{ name: "u", type: "Real" }], outputType: "Real" }],
  [
    "backSample",
    {
      inputs: [
        { name: "u", type: "Real" },
        { name: "backCounter", type: "Integer" },
        { name: "resolution", type: "Integer", defaultValue: 1 },
      ],
      outputType: "Real",
    },
  ],
  [
    "shiftSample",
    {
      inputs: [
        { name: "u", type: "Real" },
        { name: "shiftCounter", type: "Integer" },
        { name: "resolution", type: "Integer", defaultValue: 1 },
      ],
      outputType: "Real",
    },
  ],
  [
    "subSample",
    {
      inputs: [
        { name: "u", type: "Real" },
        { name: "factor", type: "Integer" },
      ],
      outputType: "Real",
    },
  ],
  [
    "superSample",
    {
      inputs: [
        { name: "u", type: "Real" },
        { name: "factor", type: "Integer" },
      ],
      outputType: "Real",
    },
  ],
  ["noClock", { inputs: [{ name: "u", type: "Real" }], outputType: "Real" }],
  ["interval", { inputs: [{ name: "u", type: "Real" }], outputType: "Real" }],
  ["initialState", { inputs: [{ name: "state", type: "Real" }], outputType: "Real" }],

  // §16.6 Stream Operators
  ["inStream", { inputs: [{ name: "v", type: "Real" }], outputType: "Real" }],
  ["actualStream", { inputs: [{ name: "v", type: "Real" }], outputType: "Real" }],
  ["cardinality", { inputs: [{ name: "v", type: "Real" }], outputType: "Integer" }],

  // §4.4.3
  ["rooted", { inputs: [{ name: "x", type: "Real" }], outputType: "Boolean" }],

  // Type conversion (no parameter info needed — treated as primitive type constructors)
  ["Real", { inputs: [{ name: "x", type: "Real" }], outputType: "Real" }],
  ["Integer", { inputs: [{ name: "x", type: "Integer" }], outputType: "Integer" }],
  ["Boolean", { inputs: [{ name: "x", type: "Boolean" }], outputType: "Boolean" }],
  ["end", { inputs: [], outputType: "Integer" }],
]);
