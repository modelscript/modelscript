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

/** A single signature (set of inputs + output type). */
export interface BuiltinSignature {
  readonly inputs: readonly BuiltinParam[];
  readonly outputType: "Real" | "Integer" | "Boolean" | "String" | null;
}

/**
 * Info for a built-in function definition.
 * For polymorphic functions (e.g. min/max which accept both Integer and Real),
 * provide `overloads` with multiple signatures. The first matching overload is used.
 * When `overloads` is absent, `inputs`/`outputType` define the single signature.
 */
export interface BuiltinFunctionDef {
  readonly inputs: readonly BuiltinParam[];
  readonly outputType: "Real" | "Integer" | "Boolean" | "String" | null;
  readonly overloads?: readonly BuiltinSignature[];
  /** Whether this function can be used as a reduction operator (e.g., `max(i for i in range)`). */
  readonly reduction?: true;
  /** Fold an array of numeric constants for reduction (e.g., Math.max for max, Math.min for min). */
  readonly foldConstants?: (values: number[]) => number;
  /** Identity value returned when the reduction function is called with zero arguments. */
  readonly identityValue?: number;
  /** Evaluate a single-argument call at compile time with a numeric literal input. */
  readonly fold1?: (x: number) => number;
  /** Evaluate a two-argument call at compile time with numeric literal inputs. */
  readonly fold2?: (a: number, b: number) => number;
  /** Domain validation for a single numeric argument. Throws if invalid. */
  readonly domainCheck?: (x: number) => void;
  /** If true, abs/sign-style: output type matches input type (Integer→Integer, Real→Real). */
  readonly preserveIntegerType?: true;
}

/**
 * Map of built-in function name → definition with typed parameters.
 * Per-parameter types enable correct type coercion (e.g., String()'s
 * Integer args are NOT coerced to Real even when the first arg is Real).
 */
export const BUILTIN_FUNCTIONS: ReadonlyMap<string, BuiltinFunctionDef> = new Map<string, BuiltinFunctionDef>([
  // §3.7.1 Numeric Functions and Conversion Functions
  ["abs", { inputs: [{ name: "v", type: "Real" }], outputType: "Real", fold1: Math.abs, preserveIntegerType: true }],
  [
    "sign",
    { inputs: [{ name: "v", type: "Real" }], outputType: "Integer", fold1: Math.sign, preserveIntegerType: true },
  ],
  [
    "sqrt",
    {
      inputs: [{ name: "v", type: "Real" }],
      outputType: "Real",
      fold1: Math.sqrt,
      domainCheck: (x) => {
        if (x < 0) throw new Error(`Argument ${x} of sqrt is out of range (x >= 0)`);
      },
    },
  ],
  ["integer", { inputs: [{ name: "x", type: "Real" }], outputType: "Integer", fold1: Math.floor }],

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
  ["der", { inputs: [{ name: "x", type: "Real" }], outputType: "Real", fold1: () => 0.0 }],
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
  ["sin", { inputs: [{ name: "u", type: "Real" }], outputType: "Real", fold1: Math.sin }],
  ["cos", { inputs: [{ name: "u", type: "Real" }], outputType: "Real", fold1: Math.cos }],
  ["tan", { inputs: [{ name: "u", type: "Real" }], outputType: "Real", fold1: Math.tan }],
  ["asin", { inputs: [{ name: "u", type: "Real" }], outputType: "Real", fold1: Math.asin }],
  ["acos", { inputs: [{ name: "u", type: "Real" }], outputType: "Real", fold1: Math.acos }],
  ["atan", { inputs: [{ name: "u", type: "Real" }], outputType: "Real", fold1: Math.atan }],
  [
    "atan2",
    {
      inputs: [
        { name: "u1", type: "Real" },
        { name: "u2", type: "Real" },
      ],
      outputType: "Real",
      fold2: Math.atan2,
    },
  ],
  ["sinh", { inputs: [{ name: "u", type: "Real" }], outputType: "Real", fold1: Math.sinh }],
  ["cosh", { inputs: [{ name: "u", type: "Real" }], outputType: "Real", fold1: Math.cosh }],
  ["tanh", { inputs: [{ name: "u", type: "Real" }], outputType: "Real", fold1: Math.tanh }],
  ["exp", { inputs: [{ name: "u", type: "Real" }], outputType: "Real", fold1: Math.exp }],
  [
    "log",
    {
      inputs: [{ name: "u", type: "Real" }],
      outputType: "Real",
      fold1: Math.log,
      domainCheck: (x) => {
        if (x <= 0) throw new Error(`Argument ${x} of log is out of range (x > 0)`);
      },
    },
  ],
  [
    "log10",
    {
      inputs: [{ name: "u", type: "Real" }],
      outputType: "Real",
      fold1: Math.log10,
      domainCheck: (x) => {
        if (x <= 0) throw new Error(`Argument ${x} of log10 is out of range (x > 0)`);
      },
    },
  ],

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
      reduction: true,
      foldConstants: (v) => Math.min(...v),
      identityValue: 8.777798510069901e304,
      fold2: Math.min,
      overloads: [
        {
          inputs: [
            { name: "x", type: "Integer" },
            { name: "y", type: "Integer" },
          ],
          outputType: "Integer",
        },
        {
          inputs: [
            { name: "x", type: "Real" },
            { name: "y", type: "Real" },
          ],
          outputType: "Real",
        },
      ],
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
      reduction: true,
      foldConstants: (v) => Math.max(...v),
      identityValue: -8.777798510069901e304,
      fold2: Math.max,
      overloads: [
        {
          inputs: [
            { name: "x", type: "Integer" },
            { name: "y", type: "Integer" },
          ],
          outputType: "Integer",
        },
        {
          inputs: [
            { name: "x", type: "Real" },
            { name: "y", type: "Real" },
          ],
          outputType: "Real",
        },
      ],
    },
  ],
  [
    "sum",
    {
      inputs: [{ name: "A", type: "Real" }],
      outputType: "Real",
      reduction: true,
      foldConstants: (v) => v.reduce((a, b) => a + b, 0),
      identityValue: 0,
    },
  ],
  [
    "product",
    {
      inputs: [{ name: "A", type: "Real" }],
      outputType: "Real",
      reduction: true,
      foldConstants: (v) => v.reduce((a, b) => a * b, 1),
      identityValue: 1,
    },
  ],
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
  ["ceil", { inputs: [{ name: "x", type: "Real" }], outputType: "Real", fold1: Math.ceil }],
  ["floor", { inputs: [{ name: "x", type: "Real" }], outputType: "Real", fold1: Math.floor }],
  [
    "div",
    {
      inputs: [
        { name: "x", type: "Real" },
        { name: "y", type: "Real" },
      ],
      outputType: "Integer",
      fold2: (a, b) => (b !== 0 ? Math.trunc(a / b) : NaN),
      overloads: [
        {
          inputs: [
            { name: "x", type: "Integer" },
            { name: "y", type: "Integer" },
          ],
          outputType: "Integer",
        },
        {
          inputs: [
            { name: "x", type: "Real" },
            { name: "y", type: "Real" },
          ],
          outputType: "Integer",
        },
      ],
    },
  ],
  [
    "mod",
    {
      inputs: [
        { name: "x", type: "Real" },
        { name: "y", type: "Real" },
      ],
      outputType: "Real", // Used as a fallback; will be inferred from overloads when possible
      fold2: (a, b) => (b !== 0 ? a - Math.floor(a / b) * b : NaN),
      overloads: [
        {
          inputs: [
            { name: "x", type: "Integer" },
            { name: "y", type: "Integer" },
          ],
          outputType: "Integer",
        },
        {
          inputs: [
            { name: "x", type: "Real" },
            { name: "y", type: "Real" },
          ],
          outputType: "Real",
        },
      ],
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
      fold2: (a, b) => (b !== 0 ? a - Math.trunc(a / b) * b : NaN),
      overloads: [
        {
          inputs: [
            { name: "x", type: "Integer" },
            { name: "y", type: "Integer" },
          ],
          outputType: "Integer",
        },
        {
          inputs: [
            { name: "x", type: "Real" },
            { name: "y", type: "Real" },
          ],
          outputType: "Real",
        },
      ],
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
  ["activeState", { inputs: [{ name: "state", type: "Real" }], outputType: "Boolean" }],
  ["ticksInState", { inputs: [], outputType: "Integer" }],
  ["timeInState", { inputs: [], outputType: "Real" }],
  [
    "transition",
    {
      inputs: [
        { name: "from", type: "Real" },
        { name: "to", type: "Real" },
        { name: "condition", type: "Boolean" },
        { name: "immediate", type: "Boolean", defaultValue: true },
        { name: "reset", type: "Boolean", defaultValue: true },
        { name: "synchronize", type: "Boolean", defaultValue: false },
        { name: "priority", type: "Integer", defaultValue: 1 },
      ],
      outputType: null,
    },
  ],

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

/**
 * Map of built-in Modelica variable names → their types.
 * These are predefined variables available in all model scopes.
 *
 * Reference: Modelica Specification §3.7.2
 */
export const BUILTIN_VARIABLES: ReadonlyMap<string, "Real" | "Integer" | "Boolean" | "String"> = new Map([
  ["time", "Real"],
]);
