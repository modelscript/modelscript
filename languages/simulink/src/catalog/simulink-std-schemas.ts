// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * Simulink cleanroom block archetype IDs matching `assets/simulink-std-lib/src/models.ts`.
 */
export const SimulinkArchetypeId = {
  INTEGRATOR: 1, // Integrator, IntegratorLimited
  DERIVATIVE: 2, // Derivative
  TRANSFER_FCN: 3, // TransferFcn, ZeroPole
  STATE_SPACE: 4, // StateSpace
  PID: 5, // PID
  UNIT_DELAY: 10, // UnitDelay, Memory, ZeroOrderHold
  DISCRETE_INTEGRATOR: 11, // DiscreteIntegrator
  DISCRETE_FILTER: 12, // DiscreteFilter, DiscreteTransferFcn
  GAIN: 20, // Gain, Bias
  SUM: 21, // Sum
  PRODUCT: 22, // Product, Divide
  MATH_UNARY: 23, // Abs, Sqrt, Signum, Math, Trigonometry
  MIN_MAX: 24, // MinMax
  SATURATE: 30, // Saturate
  DEAD_ZONE: 31, // DeadZone
  RATE_LIMITER: 32, // RateLimiter
  RELAY: 33, // Relay
  QUANTIZER: 34, // Quantizer
  RELATIONAL_OP: 40, // RelationalOperator, CompareToConstant
  LOGICAL_OP: 41, // LogicalOperator
  SWITCH: 50, // Switch, MultiportSwitch
  PASSTHROUGH: 51, // Mux, Demux, BusCreator, BusSelector, Merge, Goto, From, SubSystem, Inport, Outport, Scope, Terminator, Display
  LOOKUP_1D: 60, // Lookup_nD, Prelookup, Interpolation_nD
  SRC_CONSTANT: 70, // Constant, Ground
  SRC_STEP: 71, // Step
  SRC_SINE: 72, // Sin, Sine
  SRC_RAMP: 73, // Ramp
  SRC_CLOCK: 74, // Clock
  SRC_PULSE: 75, // PulseGenerator
} as const;

export type SimulinkArchetypeId = (typeof SimulinkArchetypeId)[keyof typeof SimulinkArchetypeId];

export interface SimulinkBlockSpec {
  blockType: string;
  aliases?: string[];
  label: string;
  category:
    | "Continuous"
    | "Discrete"
    | "Math Operations"
    | "Discontinuities"
    | "Logic & Bit Operations"
    | "Signal Routing"
    | "Lookup Tables"
    | "Sources"
    | "Sinks & Ports"
    | "Subsystems & Stateflow";
  archetypeId: SimulinkArchetypeId;
  description: string;
  provenance: string;
  inPorts: number;
  outPorts: number;
  params: Array<[key: string, defaultValue: number | string, unit?: string, description?: string]>;
}

const CATEGORY_STYLE: Record<SimulinkBlockSpec["category"], { fill: string; stroke: string; badge: string }> = {
  Continuous: { fill: "#1e3a5f", stroke: "#60a5fa", badge: "CONT" },
  Discrete: { fill: "#2e1f47", stroke: "#a78bfa", badge: "DISC" },
  "Math Operations": { fill: "#1e3f2f", stroke: "#34d399", badge: "MATH" },
  Discontinuities: { fill: "#422006", stroke: "#fb923c", badge: "NL" },
  "Logic & Bit Operations": { fill: "#3b2323", stroke: "#f87171", badge: "LOG" },
  "Signal Routing": { fill: "#163b3b", stroke: "#2dd4bf", badge: "RTE" },
  "Lookup Tables": { fill: "#3f2e18", stroke: "#fbbf24", badge: "LUT" },
  Sources: { fill: "#1e293b", stroke: "#38bdf8", badge: "SRC" },
  "Sinks & Ports": { fill: "#27272a", stroke: "#94a3b8", badge: "IO" },
  "Subsystems & Stateflow": { fill: "#312e81", stroke: "#818cf8", badge: "SUB" },
};

/**
 * Generates a deterministic cleanroom SVG icon for a Simulink standard block.
 */
export function generateSimulinkBlockSvg(blockType: string, category: SimulinkBlockSpec["category"]): string {
  const s = CATEGORY_STYLE[category];
  const shortText =
    blockType === "Integrator"
      ? "1/s"
      : blockType === "Derivative"
        ? "du/dt"
        : blockType === "UnitDelay"
          ? "1/z"
          : blockType === "Gain"
            ? "K"
            : blockType === "Sum"
              ? "+/-"
              : blockType === "Product"
                ? "×"
                : blockType.slice(0, 9);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 48" width="80" height="48">` +
    `<rect x="2" y="2" width="76" height="44" rx="5" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="26" height="12" rx="3" fill="${s.stroke}" fill-opacity="0.22"/>` +
    `<text x="19" y="15" text-anchor="middle" font-family="monospace" font-size="7" fill="${s.stroke}">${s.badge}</text>` +
    `<text x="40" y="34" text-anchor="middle" font-family="monospace" font-size="10.5" font-weight="bold" fill="#f8fafc">${shortText}</text>` +
    `</svg>`
  );
}

function buildPorts(inPorts: number, outPorts: number): DiagramPortSpec[] {
  const ports: DiagramPortSpec[] = [];
  for (let i = 0; i < inPorts; i++) {
    const dy = Math.round(((i + 1) * 48) / (inPorts + 1));
    ports.push({ name: `in${i + 1}`, kind: "signal", side: "left", dx: 0, dy });
  }
  for (let i = 0; i < outPorts; i++) {
    const dy = Math.round(((i + 1) * 48) / (outPorts + 1));
    ports.push({ name: `out${i + 1}`, kind: "signal", side: "right", dx: 80, dy });
  }
  return ports;
}

/**
 * Cleanroom catalog of core Simulink standard blocks derived from classical control theory,
 * discrete-time signal processing, and standard mathematical block semantics.
 */
export const SIMULINK_BLOCK_SPECS: readonly SimulinkBlockSpec[] = [
  // === Continuous ===
  {
    blockType: "Integrator",
    aliases: ["simulink/Continuous/Integrator"],
    label: "Continuous-Time Integrator (1/s)",
    category: "Continuous",
    archetypeId: SimulinkArchetypeId.INTEGRATOR,
    description: "Continuous-time integration dx/dt = u with optional saturation limits.",
    provenance: "Classical Control Theory (Laplace 1/s)",
    inPorts: 1,
    outPorts: 1,
    params: [
      ["InitialCondition", 0.0, "", "Initial state x(0)"],
      ["UpperSaturationLimit", 1e30, "", "Upper state saturation limit"],
      ["LowerSaturationLimit", -1e30, "", "Lower state saturation limit"],
    ],
  },
  {
    blockType: "IntegratorLimited",
    aliases: ["simulink/Continuous/Integrator Limited"],
    label: "Limited Continuous Integrator",
    category: "Continuous",
    archetypeId: SimulinkArchetypeId.INTEGRATOR,
    description: "Continuous-time integrator with clamping anti-windup bounds.",
    provenance: "Classical Control Theory (Clamped Integrator)",
    inPorts: 1,
    outPorts: 1,
    params: [
      ["InitialCondition", 0.0, "", "Initial state"],
      ["UpperSaturationLimit", 1.0, "", "Upper limit"],
      ["LowerSaturationLimit", -1.0, "", "Lower limit"],
    ],
  },
  {
    blockType: "Derivative",
    aliases: ["simulink/Continuous/Derivative"],
    label: "Filtered Continuous Derivative",
    category: "Continuous",
    archetypeId: SimulinkArchetypeId.DERIVATIVE,
    description: "Numerical time derivative du/dt with optional high-frequency filter.",
    provenance: "Numerical Analysis (Backward Difference / Filtered Derivative)",
    inPorts: 1,
    outPorts: 1,
    params: [["LinearizationTimeConstant", 0.01, "s", "Filter time constant"]],
  },
  {
    blockType: "TransferFcn",
    aliases: ["simulink/Continuous/Transfer Fcn"],
    label: "Linear Transfer Function H(s)",
    category: "Continuous",
    archetypeId: SimulinkArchetypeId.TRANSFER_FCN,
    description: "Rational Laplace transfer function (b0*s + b1) / (a0*s + a1).",
    provenance: "Linear Systems & Control Theory (Rational Transfer Function)",
    inPorts: 1,
    outPorts: 1,
    params: [
      ["Num0", 0.0, "", "Numerator s^1 coefficient"],
      ["Num1", 1.0, "", "Numerator s^0 coefficient"],
      ["Den0", 1.0, "", "Denominator s^1 coefficient"],
      ["Den1", 1.0, "", "Denominator s^0 coefficient"],
    ],
  },
  {
    blockType: "ZeroPole",
    aliases: ["simulink/Continuous/Zero-Pole"],
    label: "Zero-Pole-Gain Transfer Function",
    category: "Continuous",
    archetypeId: SimulinkArchetypeId.TRANSFER_FCN,
    description: "Factorized zero-pole-gain linear transfer function.",
    provenance: "Linear Systems & Control Theory (Zero-Pole-Gain Form)",
    inPorts: 1,
    outPorts: 1,
    params: [
      ["Num0", 0.0, "", "Equivalent numerator s^1"],
      ["Num1", 1.0, "", "Equivalent numerator s^0"],
      ["Den0", 1.0, "", "Equivalent denominator s^1"],
      ["Den1", 1.0, "", "Equivalent denominator s^0"],
    ],
  },
  {
    blockType: "StateSpace",
    aliases: ["simulink/Continuous/State-Space"],
    label: "Linear State-Space (A, B, C, D)",
    category: "Continuous",
    archetypeId: SimulinkArchetypeId.STATE_SPACE,
    description: "Continuous-time linear state-space system dx/dt = A*x + B*u, y = C*x + D*u.",
    provenance: "Modern Control Theory (State-Space Representation)",
    inPorts: 1,
    outPorts: 1,
    params: [
      ["A", -1.0, "", "State matrix A (scalar/1x1 default)"],
      ["B", 1.0, "", "Input matrix B"],
      ["C", 1.0, "", "Output matrix C"],
      ["D", 0.0, "", "Feedthrough matrix D"],
      ["X0", 0.0, "", "Initial state"],
    ],
  },
  {
    blockType: "PID",
    aliases: ["simulink/Continuous/PID Controller", "PIDController"],
    label: "PID Controller (with Filtered Derivative & Anti-Windup)",
    category: "Continuous",
    archetypeId: SimulinkArchetypeId.PID,
    description: "Parallel PID controller P + I/s + D*N/(1 + N/s) with output clamping.",
    provenance: "Astrom & Hagglund PID Control Theory",
    inPorts: 1,
    outPorts: 1,
    params: [
      ["P", 1.0, "", "Proportional gain"],
      ["I", 1.0, "1/s", "Integral gain"],
      ["D", 0.0, "s", "Derivative gain"],
      ["N", 100.0, "rad/s", "Derivative filter coefficient"],
      ["UpperSaturationLimit", 1e30, "", "Output upper limit"],
      ["LowerSaturationLimit", -1e30, "", "Output lower limit"],
    ],
  },

  // === Discrete ===
  {
    blockType: "UnitDelay",
    aliases: ["simulink/Discrete/Unit Delay"],
    label: "Unit Delay (1/z)",
    category: "Discrete",
    archetypeId: SimulinkArchetypeId.UNIT_DELAY,
    description: "Holds and delays input signal by one sample period.",
    provenance: "Discrete-Time Signal Processing (Z-Transform 1/z)",
    inPorts: 1,
    outPorts: 1,
    params: [
      ["InitialCondition", 0.0, "", "Initial output value"],
      ["SampleTime", -1.0, "s", "Sample period (-1 = inherited)"],
    ],
  },
  {
    blockType: "Memory",
    aliases: ["simulink/Discrete/Memory"],
    label: "One-Step Memory",
    category: "Discrete",
    archetypeId: SimulinkArchetypeId.UNIT_DELAY,
    description: "Outputs the input value from the previous integration step.",
    provenance: "Discrete-Time Signal Processing",
    inPorts: 1,
    outPorts: 1,
    params: [["InitialCondition", 0.0, "", "Initial output"]],
  },
  {
    blockType: "ZeroOrderHold",
    aliases: ["simulink/Discrete/Zero-Order Hold"],
    label: "Zero-Order Hold (ZOH)",
    category: "Discrete",
    archetypeId: SimulinkArchetypeId.UNIT_DELAY,
    description: "Samples and holds continuous input over discrete sample period Ts.",
    provenance: "Digital Control Systems (Zero-Order Hold)",
    inPorts: 1,
    outPorts: 1,
    params: [
      ["InitialCondition", 0.0, "", "Initial held value"],
      ["SampleTime", 0.01, "s", "Sample period Ts"],
    ],
  },
  {
    blockType: "DiscreteIntegrator",
    aliases: ["simulink/Discrete/Discrete-Time Integrator"],
    label: "Discrete-Time Integrator",
    category: "Discrete",
    archetypeId: SimulinkArchetypeId.DISCRETE_INTEGRATOR,
    description: "Forward-Euler discrete accumulator y[k] = y[k-1] + K * Ts * u[k-1].",
    provenance: "Digital Control Systems (Discrete Accumulator)",
    inPorts: 1,
    outPorts: 1,
    params: [
      ["gainval", 1.0, "", "Integrator gain"],
      ["InitialCondition", 0.0, "", "Initial state"],
      ["UpperSaturationLimit", 1e30, "", "Upper limit"],
      ["LowerSaturationLimit", -1e30, "", "Lower limit"],
    ],
  },
  {
    blockType: "DiscreteFilter",
    aliases: ["simulink/Discrete/Discrete Filter", "DiscreteTransferFcn"],
    label: "Discrete IIR Filter H(z)",
    category: "Discrete",
    archetypeId: SimulinkArchetypeId.DISCRETE_FILTER,
    description: "First-order discrete IIR filter (b0 + b1*z^-1) / (1 + a1*z^-1).",
    provenance: "Discrete-Time Signal Processing (IIR Difference Equation)",
    inPorts: 1,
    outPorts: 1,
    params: [
      ["b0", 0.5, "", "Numerator b0"],
      ["b1", 0.0, "", "Numerator b1"],
      ["a1", -0.5, "", "Denominator a1"],
    ],
  },

  // === Math Operations ===
  {
    blockType: "Gain",
    aliases: ["simulink/Math Operations/Gain"],
    label: "Scalar / Elementwise Gain (K)",
    category: "Math Operations",
    archetypeId: SimulinkArchetypeId.GAIN,
    description: "Multiplies input signal by constant gain K.",
    provenance: "Elementary Algebra",
    inPorts: 1,
    outPorts: 1,
    params: [
      ["Gain", 1.0, "", "Multiplicative gain K"],
      ["Bias", 0.0, "", "Additive bias"],
    ],
  },
  {
    blockType: "Bias",
    aliases: ["simulink/Math Operations/Bias"],
    label: "Additive Bias",
    category: "Math Operations",
    archetypeId: SimulinkArchetypeId.GAIN,
    description: "Adds constant bias offset to input signal.",
    provenance: "Elementary Algebra",
    inPorts: 1,
    outPorts: 1,
    params: [
      ["Gain", 1.0, "", "Unity gain"],
      ["Bias", 0.0, "", "Constant offset"],
    ],
  },
  {
    blockType: "Sum",
    aliases: ["simulink/Math Operations/Sum", "Add", "Subtract"],
    label: "Sum / Add / Subtract",
    category: "Math Operations",
    archetypeId: SimulinkArchetypeId.SUM,
    description: "Adds or subtracts input signals according to sign weights.",
    provenance: "Elementary Algebra",
    inPorts: 2,
    outPorts: 1,
    params: [
      ["Sign1", 1.0, "", "Sign of input 1 (+1 or -1)"],
      ["Sign2", 1.0, "", "Sign of input 2 (+1 or -1)"],
    ],
  },
  {
    blockType: "Product",
    aliases: ["simulink/Math Operations/Product", "Divide"],
    label: "Product / Divide",
    category: "Math Operations",
    archetypeId: SimulinkArchetypeId.PRODUCT,
    description: "Multiplies or divides input signals.",
    provenance: "Elementary Algebra",
    inPorts: 2,
    outPorts: 1,
    params: [["Mode", 0.0, "", "0 = multiply (u1*u2), 1 = divide (u1/u2)"]],
  },
  {
    blockType: "Abs",
    aliases: ["simulink/Math Operations/Abs"],
    label: "Absolute Value |u|",
    category: "Math Operations",
    archetypeId: SimulinkArchetypeId.MATH_UNARY,
    description: "Outputs absolute value |u|.",
    provenance: "IEEE 754 Elementary Math",
    inPorts: 1,
    outPorts: 1,
    params: [["Op", 0.0, "", "0=abs, 1=sqrt, 2=sign, 3=sin, 4=cos, 5=exp, 6=log"]],
  },
  {
    blockType: "Sqrt",
    aliases: ["simulink/Math Operations/Sqrt"],
    label: "Square Root sqrt(u)",
    category: "Math Operations",
    archetypeId: SimulinkArchetypeId.MATH_UNARY,
    description: "Outputs square root of non-negative input.",
    provenance: "IEEE 754 Elementary Math",
    inPorts: 1,
    outPorts: 1,
    params: [["Op", 1.0, "", "sqrt"]],
  },
  {
    blockType: "Signum",
    aliases: ["simulink/Math Operations/Sign"],
    label: "Signum sgn(u)",
    category: "Math Operations",
    archetypeId: SimulinkArchetypeId.MATH_UNARY,
    description: "Outputs -1, 0, or +1 according to sign of input.",
    provenance: "Elementary Math",
    inPorts: 1,
    outPorts: 1,
    params: [["Op", 2.0, "", "sign"]],
  },
  {
    blockType: "Math",
    aliases: ["simulink/Math Operations/Math Function"],
    label: "Math Function (exp/log/pow/square)",
    category: "Math Operations",
    archetypeId: SimulinkArchetypeId.MATH_UNARY,
    description: "Evaluates elementary mathematical functions.",
    provenance: "IEEE 754 Elementary Math",
    inPorts: 1,
    outPorts: 1,
    params: [["Op", 5.0, "", "5=exp, 6=log, 7=square"]],
  },
  {
    blockType: "Trigonometry",
    aliases: ["simulink/Math Operations/Trigonometric Function"],
    label: "Trigonometric Function (sin/cos/tan)",
    category: "Math Operations",
    archetypeId: SimulinkArchetypeId.MATH_UNARY,
    description: "Evaluates trigonometric functions.",
    provenance: "IEEE 754 Elementary Math",
    inPorts: 1,
    outPorts: 1,
    params: [["Op", 3.0, "", "3=sin, 4=cos"]],
  },
  {
    blockType: "MinMax",
    aliases: ["simulink/Math Operations/MinMax"],
    label: "Min / Max",
    category: "Math Operations",
    archetypeId: SimulinkArchetypeId.MIN_MAX,
    description: "Outputs minimum or maximum of input signals.",
    provenance: "Elementary Math",
    inPorts: 2,
    outPorts: 1,
    params: [["Mode", 0.0, "", "0=min, 1=max"]],
  },

  // === Discontinuities ===
  {
    blockType: "Saturate",
    aliases: ["simulink/Discontinuities/Saturation", "Saturation"],
    label: "Saturation Clamp",
    category: "Discontinuities",
    archetypeId: SimulinkArchetypeId.SATURATE,
    description: "Limits input signal between LowerLimit and UpperLimit.",
    provenance: "Nonlinear Control Theory (Saturation Element)",
    inPorts: 1,
    outPorts: 1,
    params: [
      ["UpperLimit", 0.5, "", "Upper saturation bound"],
      ["LowerLimit", -0.5, "", "Lower saturation bound"],
    ],
  },
  {
    blockType: "DeadZone",
    aliases: ["simulink/Discontinuities/Dead Zone"],
    label: "Dead Zone",
    category: "Discontinuities",
    archetypeId: SimulinkArchetypeId.DEAD_ZONE,
    description: "Outputs zero within [LowerValue, UpperValue] deadband.",
    provenance: "Nonlinear Control Theory (Dead-Zone Element)",
    inPorts: 1,
    outPorts: 1,
    params: [
      ["LowerValue", -0.5, "", "Start of dead zone"],
      ["UpperValue", 0.5, "", "End of dead zone"],
    ],
  },
  {
    blockType: "RateLimiter",
    aliases: ["simulink/Discontinuities/Rate Limiter"],
    label: "Slew-Rate Limiter",
    category: "Discontinuities",
    archetypeId: SimulinkArchetypeId.RATE_LIMITER,
    description: "Limits rising and falling rate of change dy/dt.",
    provenance: "Nonlinear Control Theory (Rate Limiter)",
    inPorts: 1,
    outPorts: 1,
    params: [
      ["RisingSlewLimit", 1.0, "1/s", "Maximum rising slew rate"],
      ["FallingSlewLimit", -1.0, "1/s", "Maximum falling slew rate"],
    ],
  },
  {
    blockType: "Relay",
    aliases: ["simulink/Discontinuities/Relay"],
    label: "Hysteresis Relay",
    category: "Discontinuities",
    archetypeId: SimulinkArchetypeId.RELAY,
    description: "Switches output between OffOutputValue and OnOutputValue with hysteresis.",
    provenance: "Nonlinear Control Theory (Hysteresis Relay)",
    inPorts: 1,
    outPorts: 1,
    params: [
      ["OnSwitchValue", 0.5, "", "Switch-on threshold"],
      ["OffSwitchValue", -0.5, "", "Switch-off threshold"],
      ["OnOutputValue", 1.0, "", "Output when ON"],
      ["OffOutputValue", 0.0, "", "Output when OFF"],
    ],
  },
  {
    blockType: "Quantizer",
    aliases: ["simulink/Discontinuities/Quantizer"],
    label: "Uniform Quantizer",
    category: "Discontinuities",
    archetypeId: SimulinkArchetypeId.QUANTIZER,
    description: "Discretizes input to multiples of QuantizationInterval.",
    provenance: "Digital Signal Processing (Uniform Quantization)",
    inPorts: 1,
    outPorts: 1,
    params: [["QuantizationInterval", 0.5, "", "Quantization step size q"]],
  },

  // === Logic & Relational ===
  {
    blockType: "RelationalOperator",
    aliases: ["simulink/Logic and Bit Operations/Relational Operator", "CompareToConstant"],
    label: "Relational Operator (==, ~=, <, <=, >=, >)",
    category: "Logic & Bit Operations",
    archetypeId: SimulinkArchetypeId.RELATIONAL_OP,
    description: "Compares two signals and outputs 1.0 (true) or 0.0 (false).",
    provenance: "Boolean Algebra",
    inPorts: 2,
    outPorts: 1,
    params: [["Op", 4.0, "", "0:==, 1:~=, 2:<, 3:<=, 4:>=, 5:>"]],
  },
  {
    blockType: "LogicalOperator",
    aliases: ["simulink/Logic and Bit Operations/Logical Operator"],
    label: "Logical Operator (AND/OR/XOR/NOT)",
    category: "Logic & Bit Operations",
    archetypeId: SimulinkArchetypeId.LOGICAL_OP,
    description: "Performs boolean logic on signal inputs.",
    provenance: "Boolean Algebra",
    inPorts: 2,
    outPorts: 1,
    params: [["Op", 0.0, "", "0:AND, 1:OR, 2:XOR, 3:NOT"]],
  },

  // === Signal Routing & Lookup ===
  {
    blockType: "Switch",
    aliases: ["simulink/Signal Routing/Switch", "MultiportSwitch"],
    label: "Conditional Signal Switch",
    category: "Signal Routing",
    archetypeId: SimulinkArchetypeId.SWITCH,
    description: "Passes input 1 when control input u2 >= Threshold, else passes input 3.",
    provenance: "Signal Flow Routing",
    inPorts: 3,
    outPorts: 1,
    params: [["Threshold", 0.0, "", "Switching threshold on control port"]],
  },
  {
    blockType: "Mux",
    aliases: ["simulink/Signal Routing/Mux", "BusCreator"],
    label: "Signal Multiplexer / Bus Creator",
    category: "Signal Routing",
    archetypeId: SimulinkArchetypeId.PASSTHROUGH,
    description: "Combines multiple scalar signals into a vector or bus.",
    provenance: "Signal Flow Routing",
    inPorts: 2,
    outPorts: 1,
    params: [["Inputs", 2, "", "Number of input ports"]],
  },
  {
    blockType: "Demux",
    aliases: ["simulink/Signal Routing/Demux", "BusSelector"],
    label: "Signal Demultiplexer / Bus Selector",
    category: "Signal Routing",
    archetypeId: SimulinkArchetypeId.PASSTHROUGH,
    description: "Extracts scalar elements from a vector or bus signal.",
    provenance: "Signal Flow Routing",
    inPorts: 1,
    outPorts: 2,
    params: [["Outputs", 2, "", "Number of output ports"]],
  },
  {
    blockType: "Lookup_nD",
    aliases: ["simulink/Lookup Tables/1-D Lookup Table", "Prelookup", "Interpolation_nD"],
    label: "1-D / n-D Linear Lookup Table",
    category: "Lookup Tables",
    archetypeId: SimulinkArchetypeId.LOOKUP_1D,
    description: "Piecewise-linear table interpolation over breakpoints.",
    provenance: "Numerical Analysis (Piecewise Linear Interpolation)",
    inPorts: 1,
    outPorts: 1,
    params: [
      ["x0", 0.0, "", "Breakpoint 0"],
      ["x1", 1.0, "", "Breakpoint 1"],
      ["x2", 2.0, "", "Breakpoint 2"],
      ["y0", 0.0, "", "Table value 0"],
      ["y1", 1.0, "", "Table value 1"],
      ["y2", 4.0, "", "Table value 2"],
    ],
  },

  // === Sources ===
  {
    blockType: "Constant",
    aliases: ["simulink/Sources/Constant", "Ground"],
    label: "Constant Signal",
    category: "Sources",
    archetypeId: SimulinkArchetypeId.SRC_CONSTANT,
    description: "Outputs a constant scalar value.",
    provenance: "Signal Generation",
    inPorts: 0,
    outPorts: 1,
    params: [["Value", 1.0, "", "Constant output value"]],
  },
  {
    blockType: "Step",
    aliases: ["simulink/Sources/Step"],
    label: "Step Source",
    category: "Sources",
    archetypeId: SimulinkArchetypeId.SRC_STEP,
    description: "Steps from Before to After at t >= Time.",
    provenance: "Heaviside Step Function",
    inPorts: 0,
    outPorts: 1,
    params: [
      ["Time", 1.0, "s", "Step time"],
      ["Before", 0.0, "", "Initial value"],
      ["After", 1.0, "", "Final value"],
    ],
  },
  {
    blockType: "Sin",
    aliases: ["Sine", "simulink/Sources/Sine Wave"],
    label: "Sine Wave Source",
    category: "Sources",
    archetypeId: SimulinkArchetypeId.SRC_SINE,
    description: "Outputs Amplitude * sin(Frequency * t + Phase) + Bias.",
    provenance: "Elementary Trigonometry",
    inPorts: 0,
    outPorts: 1,
    params: [
      ["Amplitude", 1.0, "", "Peak amplitude"],
      ["Bias", 0.0, "", "DC bias"],
      ["Frequency", 1.0, "rad/s", "Angular frequency"],
      ["Phase", 0.0, "rad", "Phase offset"],
    ],
  },
  {
    blockType: "Ramp",
    aliases: ["simulink/Sources/Ramp"],
    label: "Ramp Source",
    category: "Sources",
    archetypeId: SimulinkArchetypeId.SRC_RAMP,
    description: "Outputs linear ramp Slope * max(0, t - start) + X0.",
    provenance: "Elementary Signal Generation",
    inPorts: 0,
    outPorts: 1,
    params: [
      ["slope", 1.0, "1/s", "Ramp slope"],
      ["start", 0.0, "s", "Ramp start time"],
      ["X0", 0.0, "", "Initial output"],
    ],
  },
  {
    blockType: "Clock",
    aliases: ["simulink/Sources/Clock"],
    label: "Simulation Clock (t)",
    category: "Sources",
    archetypeId: SimulinkArchetypeId.SRC_CLOCK,
    description: "Outputs current simulation time t.",
    provenance: "Time-Domain Simulation",
    inPorts: 0,
    outPorts: 1,
    params: [],
  },
  {
    blockType: "PulseGenerator",
    aliases: ["simulink/Sources/Pulse Generator"],
    label: "Square Pulse Generator",
    category: "Sources",
    archetypeId: SimulinkArchetypeId.SRC_PULSE,
    description: "Generates periodic square pulses with configurable period and duty cycle.",
    provenance: "Signal Generation",
    inPorts: 0,
    outPorts: 1,
    params: [
      ["Amplitude", 1.0, "", "Pulse amplitude"],
      ["Period", 1.0, "s", "Pulse period"],
      ["PulseWidth", 50.0, "%", "Duty cycle percentage"],
      ["PhaseDelay", 0.0, "s", "Phase delay"],
    ],
  },

  // === Sinks, Ports & Subsystems ===
  {
    blockType: "Inport",
    aliases: ["simulink/Sources/In1"],
    label: "Subsystem Input Port",
    category: "Sinks & Ports",
    archetypeId: SimulinkArchetypeId.PASSTHROUGH,
    description: "External input interface port for a model or subsystem.",
    provenance: "Hierarchical Block Diagrams",
    inPorts: 0,
    outPorts: 1,
    params: [["Port", 1, "", "Port index"]],
  },
  {
    blockType: "Outport",
    aliases: ["simulink/Sinks/Out1"],
    label: "Subsystem Output Port",
    category: "Sinks & Ports",
    archetypeId: SimulinkArchetypeId.PASSTHROUGH,
    description: "External output interface port for a model or subsystem.",
    provenance: "Hierarchical Block Diagrams",
    inPorts: 1,
    outPorts: 0,
    params: [["Port", 1, "", "Port index"]],
  },
  {
    blockType: "Scope",
    aliases: ["simulink/Sinks/Scope", "Display", "ToWorkspace"],
    label: "Signal Scope / Recorder",
    category: "Sinks & Ports",
    archetypeId: SimulinkArchetypeId.PASSTHROUGH,
    description: "Records time-series signals for visualization and export.",
    provenance: "Simulation Instrumentation",
    inPorts: 1,
    outPorts: 0,
    params: [],
  },
  {
    blockType: "Terminator",
    aliases: ["simulink/Sinks/Terminator"],
    label: "Signal Terminator",
    category: "Sinks & Ports",
    archetypeId: SimulinkArchetypeId.PASSTHROUGH,
    description: "Terminates an unconnected output signal.",
    provenance: "Signal Flow Routing",
    inPorts: 1,
    outPorts: 0,
    params: [],
  },
  {
    blockType: "SubSystem",
    aliases: ["simulink/Ports & Subsystems/Subsystem", "EnabledSubsystem", "TriggeredSubsystem"],
    label: "Hierarchical Subsystem",
    category: "Subsystems & Stateflow",
    archetypeId: SimulinkArchetypeId.PASSTHROUGH,
    description: "Encapsulates a nested block diagram with Inport/Outport interfaces.",
    provenance: "Hierarchical Block Diagrams",
    inPorts: 1,
    outPorts: 1,
    params: [],
  },
  {
    blockType: "S-Function",
    aliases: ["simulink/User-Defined Functions/S-Function", "Chart"],
    label: "User-Defined S-Function / Stateflow Chart",
    category: "Subsystems & Stateflow",
    archetypeId: SimulinkArchetypeId.PASSTHROUGH,
    description: "Extension point for custom AssemblyScript WASM or FMU co-simulation blocks.",
    provenance: "FMI 2.0/3.0 & WebAssembly Co-Simulation",
    inPorts: 1,
    outPorts: 1,
    params: [],
  },
];

/**
 * Converts `SIMULINK_BLOCK_SPECS` into shared `@modelscript/runtime` `CleanroomModelSchema[]`.
 */
export function buildSimulinkCleanroomSchemas(): CleanroomModelSchema[] {
  return SIMULINK_BLOCK_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: typeof defaultValue === "number" ? "real" : "string",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `simulink:${spec.blockType}`,
      name: spec.blockType,
      aliases: spec.aliases,
      label: spec.label,
      category: spec.category,
      domain: "control",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "simulink_block",
      width: 80,
      height: 48,
      svg: generateSimulinkBlockSvg(spec.blockType, spec.category),
      ports: buildPorts(spec.inPorts, spec.outPorts),
      parameters,
      wasmKernel: spec.blockType,
      extra: {
        archetypeId: spec.archetypeId,
      },
    };
  });
}
