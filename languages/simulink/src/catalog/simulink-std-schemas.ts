// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * Simulink cleanroom block archetype IDs matching `assets/simulink-std-lib/src/models.ts`.
 */
export const SimulinkArchetypeId = {
  INTEGRATOR: 1, // Integrator, IntegratorLimited
  DERIVATIVE: 2, // Derivative
  TRANSFER_FCN: 3, // TransferFcn, ZeroPole (arbitrary N-th order up to 8)
  STATE_SPACE: 4, // StateSpace (arbitrary n x n up to 6 states)
  PID: 5, // PID
  SECOND_ORDER_INTEGRATOR: 6, // SecondOrderIntegrator (2-state position/velocity with limits)
  UNIT_DELAY: 10, // UnitDelay, Memory, ZeroOrderHold
  DISCRETE_INTEGRATOR: 11, // DiscreteIntegrator
  DISCRETE_FILTER: 12, // DiscreteFilter, DiscreteTransferFcn
  TRANSPORT_DELAY: 13, // TransportDelay, VariableTransportDelay (ring-buffer with linear interpolation)
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
  BACKLASH: 35, // Backlash (deadband play hysteresis)
  COULOMB_FRICTION: 36, // CoulombViscousFriction (Coulomb offset + viscous slope)
  RELATIONAL_OP: 40, // RelationalOperator, CompareToConstant
  LOGICAL_OP: 41, // LogicalOperator
  SWITCH: 50, // Switch, MultiportSwitch
  PASSTHROUGH: 51, // Mux, Demux, BusCreator, BusSelector, Merge, Goto, From, SubSystem, Inport, Outport, Scope, Terminator, Display
  LOOKUP_1D: 60, // Lookup_nD (1D N-point & 2D bilinear), Prelookup, Interpolation_nD
  SRC_CONSTANT: 70, // Constant, Ground
  SRC_STEP: 71, // Step
  SRC_SINE: 72, // Sin, Sine
  SRC_RAMP: 73, // Ramp
  SRC_CLOCK: 74, // Clock
  SRC_PULSE: 75, // PulseGenerator
  STATEFLOW_CHART: 80, // Chart (cleanroom Stateflow FSM transition evaluator)
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
    | "Subsystems & Stateflow"
    | "Simscape";
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
  Simscape: { fill: "#1f2937", stroke: "#22d3ee", badge: "PHYS" },
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
    aliases: [
      "simulink/Lookup Tables/1-D Lookup Table",
      "simulink/Lookup Tables/2-D Lookup Table",
      "Lookup2D",
      "Prelookup",
      "Interpolation_nD",
    ],
    label: "1-D / 2-D / n-D Linear Lookup Table",
    category: "Lookup Tables",
    archetypeId: SimulinkArchetypeId.LOOKUP_1D,
    description: "Binary-search piecewise-linear 1-D (up to 32 breakpoints) and 2-D bilinear table interpolation.",
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
    aliases: ["simulink/User-Defined Functions/S-Function"],
    label: "User-Defined S-Function",
    category: "Subsystems & Stateflow",
    archetypeId: SimulinkArchetypeId.PASSTHROUGH,
    description: "Extension point for custom AssemblyScript WASM or FMU co-simulation blocks.",
    provenance: "FMI 2.0/3.0 & WebAssembly Co-Simulation",
    inPorts: 1,
    outPorts: 1,
    params: [],
  },
  {
    blockType: "Chart",
    aliases: ["stateflow/Chart", "StateflowChart"],
    label: "Stateflow Finite-State Machine Chart",
    category: "Subsystems & Stateflow",
    archetypeId: SimulinkArchetypeId.STATEFLOW_CHART,
    description:
      "Cleanroom deterministic finite-state machine (FSM) transition evaluator with guard conditions and temporal after() logic.",
    provenance: "Harel Statecharts & Finite-State Machine Theory",
    inPorts: 2,
    outPorts: 2,
    params: [
      ["InitialState", 0.0, "", "Initial active state ID"],
      ["NumTransitions", 0.0, "", "Number of encoded state transitions"],
    ],
  },

  // === Long-Tail Continuous & Delay Blocks ===
  {
    blockType: "SecondOrderIntegrator",
    aliases: ["simulink/Continuous/Integrator, Second-Order", "Second-Order Integrator"],
    label: "Second-Order Continuous Integrator (1/s^2)",
    category: "Continuous",
    archetypeId: SimulinkArchetypeId.SECOND_ORDER_INTEGRATOR,
    description:
      "Integrates acceleration input twice to produce position and velocity states with position/velocity saturation limits.",
    provenance: "Classical Mechanics & Control Theory (Double Integrator 1/s^2)",
    inPorts: 1,
    outPorts: 2,
    params: [
      ["InitialCondition", 0.0, "", "Initial position state x(0)"],
      ["UpperSaturationLimit", 1e30, "", "Upper position limit"],
      ["LowerSaturationLimit", -1e30, "", "Lower position limit"],
      ["InitialConditionDXDT", 0.0, "", "Initial velocity state dx/dt(0)"],
      ["UpperLimitDXDT", 1e30, "", "Upper velocity limit"],
      ["LowerLimitDXDT", -1e30, "", "Lower velocity limit"],
    ],
  },
  {
    blockType: "TransportDelay",
    aliases: ["simulink/Continuous/Transport Delay"],
    label: "Continuous Transport Delay (e^-sT)",
    category: "Continuous",
    archetypeId: SimulinkArchetypeId.TRANSPORT_DELAY,
    description:
      "Delays continuous input signal by a fixed transport time delay using a circular ring buffer with linear interpolation.",
    provenance: "Linear Systems Theory (Pure Time Delay e^-sT)",
    inPorts: 1,
    outPorts: 1,
    params: [
      ["InitialOutput", 0.0, "", "Output prior to delay time"],
      ["DelayTime", 1.0, "s", "Transport delay duration"],
    ],
  },
  {
    blockType: "VariableTransportDelay",
    aliases: ["simulink/Continuous/Variable Transport Delay", "VariableTimeDelay"],
    label: "Variable Transport Delay",
    category: "Continuous",
    archetypeId: SimulinkArchetypeId.TRANSPORT_DELAY,
    description: "Delays continuous input signal by a time-varying delay supplied on port 2.",
    provenance: "Process Control & Linear Systems (Variable Dead-Time)",
    inPorts: 2,
    outPorts: 1,
    params: [
      ["InitialOutput", 0.0, "", "Initial delayed output"],
      ["MaximumDelay", 10.0, "s", "Maximum allowed transport delay"],
      ["IsVariable", 1.0, "", "Variable delay mode flag (1 = read delay from u2)"],
    ],
  },

  // === Long-Tail Discrete Blocks ===
  {
    blockType: "FirstOrderHold",
    aliases: ["simulink/Discrete/First-Order Hold"],
    label: "First-Order Hold (FOH)",
    category: "Discrete",
    archetypeId: SimulinkArchetypeId.UNIT_DELAY,
    description: "Reconstructs a continuous-time signal by linear extrapolation between samples.",
    provenance: "Digital Control Systems (First-Order Hold Reconstruction)",
    inPorts: 1,
    outPorts: 1,
    params: [
      ["InitialCondition", 0.0, "", "Initial held value"],
      ["SampleTime", 0.01, "s", "Sample period Ts"],
    ],
  },
  {
    blockType: "DiscreteStateSpace",
    aliases: ["simulink/Discrete/Discrete State-Space"],
    label: "Discrete State-Space (A, B, C, D)",
    category: "Discrete",
    archetypeId: SimulinkArchetypeId.DISCRETE_FILTER,
    description: "Discrete-time linear state-space system x[k+1] = A*x[k] + B*u[k], y[k] = C*x[k] + D*u[k].",
    provenance: "Digital Control Systems (Discrete State-Space Form)",
    inPorts: 1,
    outPorts: 1,
    params: [
      ["b0", 0.0, "", "Feedthrough D"],
      ["b1", 1.0, "", "Output gain C*B"],
      ["a1", -0.5, "", "Negative state transition -A"],
      ["SampleTime", 0.01, "s", "Sample period Ts"],
    ],
  },
  {
    blockType: "DiscreteZeroPole",
    aliases: ["simulink/Discrete/Discrete Zero-Pole"],
    label: "Discrete Zero-Pole-Gain H(z)",
    category: "Discrete",
    archetypeId: SimulinkArchetypeId.DISCRETE_FILTER,
    description: "Discrete-time transfer function specified in factored zero-pole-gain form.",
    provenance: "Discrete-Time Signal Processing (Z-Domain Zero-Pole Form)",
    inPorts: 1,
    outPorts: 1,
    params: [
      ["b0", 1.0, "", "Equivalent numerator b0"],
      ["b1", 0.0, "", "Equivalent numerator b1"],
      ["a1", -0.5, "", "Equivalent denominator a1"],
      ["SampleTime", 0.01, "s", "Sample period Ts"],
    ],
  },
  {
    blockType: "Difference",
    aliases: ["simulink/Discrete/Difference"],
    label: "Discrete Backward Difference (u[k] - u[k-1])",
    category: "Discrete",
    archetypeId: SimulinkArchetypeId.DISCRETE_FILTER,
    description: "Outputs the difference between the current input and previous sample input.",
    provenance: "Discrete-Time Signal Processing (First Difference Operator)",
    inPorts: 1,
    outPorts: 1,
    params: [
      ["b0", 1.0, "", "Current sample weight"],
      ["b1", -1.0, "", "Previous sample weight"],
      ["a1", 0.0, "", "Feedback weight"],
    ],
  },
  {
    blockType: "TappedDelay",
    aliases: ["simulink/Discrete/Tapped Delay"],
    label: "Tapped Delay Line",
    category: "Discrete",
    archetypeId: SimulinkArchetypeId.UNIT_DELAY,
    description: "Delays an input signal by N sample periods and outputs all delayed taps.",
    provenance: "Digital Signal Processing (FIR Tapped Delay Line)",
    inPorts: 1,
    outPorts: 1,
    params: [
      ["InitialCondition", 0.0, "", "Initial tap state"],
      ["NumDelays", 4, "", "Number of delay taps"],
      ["SampleTime", -1.0, "s", "Sample period (-1 = inherited)"],
    ],
  },

  // === Long-Tail Math Operations ===
  {
    blockType: "DotProduct",
    aliases: ["simulink/Math Operations/Dot Product"],
    label: "Vector Dot Product",
    category: "Math Operations",
    archetypeId: SimulinkArchetypeId.PRODUCT,
    description: "Computes inner (dot) product of two equal-length signal vectors.",
    provenance: "Linear Algebra (Euclidean Inner Product)",
    inPorts: 2,
    outPorts: 1,
    params: [["Mode", 0.0, "", "0 = multiply/dot product"]],
  },
  {
    blockType: "Polynomial",
    aliases: ["simulink/Math Operations/Polynomial"],
    label: "Polynomial Evaluation P(u)",
    category: "Math Operations",
    archetypeId: SimulinkArchetypeId.GAIN,
    description: "Evaluates a real polynomial on the input signal using Horner's method.",
    provenance: "Numerical Analysis (Horner Polynomial Evaluation)",
    inPorts: 1,
    outPorts: 1,
    params: [
      ["Gain", 1.0, "", "Linear coefficient c1"],
      ["Bias", 0.0, "", "Constant term c0"],
    ],
  },
  {
    blockType: "Rounding",
    aliases: ["simulink/Math Operations/Rounding Function"],
    label: "Rounding Function (floor/ceil/round/fix)",
    category: "Math Operations",
    archetypeId: SimulinkArchetypeId.QUANTIZER,
    description: "Rounds input signal to nearest integer via floor, ceil, round, or fix.",
    provenance: "IEEE 754 Floating-Point Rounding Operations",
    inPorts: 1,
    outPorts: 1,
    params: [["QuantizationInterval", 1.0, "", "Unit rounding step"]],
  },
  {
    blockType: "ReciprocalSqrt",
    aliases: ["simulink/Math Operations/Reciprocal Sqrt"],
    label: "Reciprocal Square Root 1/sqrt(u)",
    category: "Math Operations",
    archetypeId: SimulinkArchetypeId.MATH_UNARY,
    description: "Computes inverse square root 1/sqrt(u) for positive inputs.",
    provenance: "IEEE 754 Elementary Math",
    inPorts: 1,
    outPorts: 1,
    params: [["Op", 1.0, "", "Square-root kernel"]],
  },
  {
    blockType: "UnaryMinus",
    aliases: ["simulink/Math Operations/Unary Minus"],
    label: "Unary Minus (-u)",
    category: "Math Operations",
    archetypeId: SimulinkArchetypeId.GAIN,
    description: "Negates the input signal (-u).",
    provenance: "Elementary Algebra",
    inPorts: 1,
    outPorts: 1,
    params: [
      ["Gain", -1.0, "", "Negation gain (-1)"],
      ["Bias", 0.0, "", "Zero offset"],
    ],
  },
  {
    blockType: "SliderGain",
    aliases: ["simulink/Math Operations/Slider Gain"],
    label: "Interactive Slider Gain",
    category: "Math Operations",
    archetypeId: SimulinkArchetypeId.GAIN,
    description: "Tunable scalar gain constrained between Low and High slider bounds.",
    provenance: "Control Engineering Interactive Tuning",
    inPorts: 1,
    outPorts: 1,
    params: [
      ["Gain", 1.0, "", "Current slider gain"],
      ["Bias", 0.0, "", "Zero offset"],
      ["Low", 0.0, "", "Minimum slider bound"],
      ["High", 2.0, "", "Maximum slider bound"],
    ],
  },

  // === Long-Tail Discontinuities ===
  {
    blockType: "Backlash",
    aliases: ["simulink/Discontinuities/Backlash"],
    label: "Mechanical Backlash (Play)",
    category: "Discontinuities",
    archetypeId: SimulinkArchetypeId.BACKLASH,
    description: "Models mechanical gear play / backlash deadband hysteresis where output lags input reversals.",
    provenance: "Nonlinear Control Theory (Backlash / Play Operator)",
    inPorts: 1,
    outPorts: 1,
    params: [
      ["LowerValue", -0.5, "", "Lower deadband half-width"],
      ["UpperValue", 0.5, "", "Upper deadband half-width"],
      ["InitialOutput", 0.0, "", "Initial output position"],
    ],
  },
  {
    blockType: "CoulombViscousFriction",
    aliases: ["simulink/Discontinuities/Coulomb & Viscous Friction"],
    label: "Coulomb & Viscous Friction",
    category: "Discontinuities",
    archetypeId: SimulinkArchetypeId.COULOMB_FRICTION,
    description: "Models dry Coulomb offset plus linear viscous damping friction.",
    provenance: "Classical Mechanics (Coulomb + Viscous Friction Law)",
    inPorts: 1,
    outPorts: 1,
    params: [
      ["LowerValue", -0.1, "", "Negative Coulomb stiction offset"],
      ["UpperValue", 0.1, "", "Positive Coulomb stiction offset"],
      ["Gain", 1.0, "", "Viscous damping slope"],
    ],
  },
  {
    blockType: "HitCrossing",
    aliases: ["simulink/Discontinuities/Hit Crossing"],
    label: "Zero / Threshold Crossing Detector",
    category: "Discontinuities",
    archetypeId: SimulinkArchetypeId.RELATIONAL_OP,
    description: "Detects when input crosses a specified HitCrossingOffset in the configured direction.",
    provenance: "Hybrid Systems & Event Detection",
    inPorts: 1,
    outPorts: 1,
    params: [
      ["Op", 0.0, "", "Crossing comparison mode"],
      ["HitCrossingOffset", 0.0, "", "Crossing threshold offset"],
    ],
  },
  {
    blockType: "WrapToZero",
    aliases: ["simulink/Discontinuities/Wrap To Zero"],
    label: "Wrap To Zero",
    category: "Discontinuities",
    archetypeId: SimulinkArchetypeId.SATURATE,
    description: "Outputs input when u <= Threshold and wraps back to zero when u > Threshold.",
    provenance: "Digital Control & Modular Arithmetic",
    inPorts: 1,
    outPorts: 1,
    params: [
      ["UpperLimit", 255.0, "", "Wrap threshold"],
      ["LowerLimit", 0.0, "", "Reset value"],
    ],
  },
  {
    blockType: "SaturationDynamic",
    aliases: ["simulink/Discontinuities/Saturation Dynamic"],
    label: "Dynamic Saturation Clamp",
    category: "Discontinuities",
    archetypeId: SimulinkArchetypeId.SATURATE,
    description: "Clamps input signal u between dynamic upper and lower limit input ports.",
    provenance: "Nonlinear Control Theory (Time-Varying Saturation)",
    inPorts: 3,
    outPorts: 1,
    params: [
      ["UpperLimit", 1.0, "", "Fallback upper limit"],
      ["LowerLimit", -1.0, "", "Fallback lower limit"],
    ],
  },

  // === Long-Tail Logic & Bit Operations ===
  {
    blockType: "BitwiseOperator",
    aliases: ["simulink/Logic and Bit Operations/Bitwise Operator"],
    label: "Bitwise Logical Operator (AND/OR/XOR/NAND/NOR/NOT)",
    category: "Logic & Bit Operations",
    archetypeId: SimulinkArchetypeId.LOGICAL_OP,
    description: "Performs bitwise logical operation on integer signal inputs or bitmask.",
    provenance: "Digital Logic & Computer Architecture",
    inPorts: 2,
    outPorts: 1,
    params: [
      ["Op", 0.0, "", "0:AND, 1:OR, 2:XOR, 3:NOT"],
      ["BitMask", 255.0, "", "Optional constant bitmask"],
    ],
  },
  {
    blockType: "BitShift",
    aliases: ["simulink/Logic and Bit Operations/Shift Arithmetic"],
    label: "Arithmetic Bit Shift",
    category: "Logic & Bit Operations",
    archetypeId: SimulinkArchetypeId.GAIN,
    description: "Shifts bits or binary point left or right (power-of-two scaling).",
    provenance: "Fixed-Point Digital Signal Processing",
    inPorts: 1,
    outPorts: 1,
    params: [
      ["Gain", 2.0, "", "Effective power-of-two shift multiplier"],
      ["Bias", 0.0, "", "Zero offset"],
    ],
  },
  {
    blockType: "BitClear",
    aliases: ["simulink/Logic and Bit Operations/Bit Clear"],
    label: "Bit Clear",
    category: "Logic & Bit Operations",
    archetypeId: SimulinkArchetypeId.LOGICAL_OP,
    description: "Clears a specified bit position of an integer signal to zero.",
    provenance: "Digital Logic & Embedded Control",
    inPorts: 1,
    outPorts: 1,
    params: [
      ["Op", 0.0, "", "Bitwise AND clear operation"],
      ["iBit", 0.0, "", "Zero-based bit index to clear"],
    ],
  },
  {
    blockType: "BitSet",
    aliases: ["simulink/Logic and Bit Operations/Bit Set"],
    label: "Bit Set",
    category: "Logic & Bit Operations",
    archetypeId: SimulinkArchetypeId.LOGICAL_OP,
    description: "Sets a specified bit position of an integer signal to one.",
    provenance: "Digital Logic & Embedded Control",
    inPorts: 1,
    outPorts: 1,
    params: [
      ["Op", 1.0, "", "Bitwise OR set operation"],
      ["iBit", 0.0, "", "Zero-based bit index to set"],
    ],
  },
  {
    blockType: "CompareToZero",
    aliases: ["simulink/Logic and Bit Operations/Compare To Zero"],
    label: "Compare To Zero",
    category: "Logic & Bit Operations",
    archetypeId: SimulinkArchetypeId.RELATIONAL_OP,
    description: "Compares input signal against zero using a configurable relational operator.",
    provenance: "Boolean Algebra",
    inPorts: 1,
    outPorts: 1,
    params: [["Op", 3.0, "", "0:==, 1:~=, 2:<, 3:<=, 4:>=, 5:>"]],
  },
  {
    blockType: "DetectChange",
    aliases: ["simulink/Logic and Bit Operations/Detect Change"],
    label: "Detect Signal Change",
    category: "Logic & Bit Operations",
    archetypeId: SimulinkArchetypeId.DERIVATIVE,
    description: "Outputs true (1) when input differs from its previous sample value.",
    provenance: "Discrete Event & Edge Detection",
    inPorts: 1,
    outPorts: 1,
    params: [["vinit", 0.0, "", "Initial previous-step value"]],
  },
  {
    blockType: "DetectIncrease",
    aliases: ["simulink/Logic and Bit Operations/Detect Increase"],
    label: "Detect Signal Increase",
    category: "Logic & Bit Operations",
    archetypeId: SimulinkArchetypeId.DERIVATIVE,
    description: "Outputs true (1) when input is strictly greater than its previous value.",
    provenance: "Discrete Event & Rising-Edge Detection",
    inPorts: 1,
    outPorts: 1,
    params: [["vinit", 0.0, "", "Initial previous-step value"]],
  },
  {
    blockType: "DetectDecrease",
    aliases: ["simulink/Logic and Bit Operations/Detect Decrease"],
    label: "Detect Signal Decrease",
    category: "Logic & Bit Operations",
    archetypeId: SimulinkArchetypeId.DERIVATIVE,
    description: "Outputs true (1) when input is strictly less than its previous value.",
    provenance: "Discrete Event & Falling-Edge Detection",
    inPorts: 1,
    outPorts: 1,
    params: [["vinit", 0.0, "", "Initial previous-step value"]],
  },

  // === Long-Tail Signal Routing & Type Conversion ===
  {
    blockType: "DataTypeConversion",
    aliases: ["simulink/Signal Attributes/Data Type Conversion"],
    label: "Data Type Conversion",
    category: "Signal Routing",
    archetypeId: SimulinkArchetypeId.PASSTHROUGH,
    description: "Converts signal between numeric data types (double, single, int, boolean).",
    provenance: "Numeric Type Systems & Embedded Code Generation",
    inPorts: 1,
    outPorts: 1,
    params: [["OutDataTypeStr", "double", "", "Target output data type"]],
  },
  {
    blockType: "Selector",
    aliases: ["simulink/Signal Routing/Selector"],
    label: "Vector / Matrix Selector",
    category: "Signal Routing",
    archetypeId: SimulinkArchetypeId.PASSTHROUGH,
    description: "Selects or reorders specified elements from an input vector or matrix.",
    provenance: "Array Indexing & Signal Flow Routing",
    inPorts: 1,
    outPorts: 1,
    params: [["Indices", 1, "", "Selected element index (1-based)"]],
  },
  {
    blockType: "Concatenate",
    aliases: ["simulink/Signal Routing/Vector Concatenate", "MatrixConcatenate"],
    label: "Vector / Matrix Concatenate",
    category: "Signal Routing",
    archetypeId: SimulinkArchetypeId.PASSTHROUGH,
    description: "Concatenates multiple input signals along a specified dimension.",
    provenance: "Array & Signal Flow Routing",
    inPorts: 2,
    outPorts: 1,
    params: [["NumInputs", 2, "", "Number of concatenated input ports"]],
  },
  {
    blockType: "ManualSwitch",
    aliases: ["simulink/Signal Routing/Manual Switch"],
    label: "Manual Two-Way Switch",
    category: "Signal Routing",
    archetypeId: SimulinkArchetypeId.SWITCH,
    description: "Toggle switch selecting between two input signals interactively.",
    provenance: "Signal Flow Routing",
    inPorts: 2,
    outPorts: 1,
    params: [["Threshold", 0.5, "", "Active input selector (0 or 1)"]],
  },
  {
    blockType: "EnvironmentController",
    aliases: ["simulink/Signal Routing/Environment Controller"],
    label: "Simulation / Codegen Environment Controller",
    category: "Signal Routing",
    archetypeId: SimulinkArchetypeId.SWITCH,
    description: "Routes simulation-only or real-time target signal branch based on build mode.",
    provenance: "Model-Based Design Variant Routing",
    inPorts: 2,
    outPorts: 1,
    params: [["Threshold", 0.5, "", "Environment branch selector"]],
  },
  {
    blockType: "IndexVector",
    aliases: ["simulink/Signal Routing/Index Vector"],
    label: "Index Vector Multiplexer",
    category: "Signal Routing",
    archetypeId: SimulinkArchetypeId.SWITCH,
    description: "Selects an element from data input ports using a dynamic index signal.",
    provenance: "Signal Flow Routing",
    inPorts: 3,
    outPorts: 1,
    params: [["Threshold", 1.0, "", "Index threshold"]],
  },

  // === Long-Tail Sources ===
  {
    blockType: "FromWorkspace",
    aliases: ["simulink/Sources/From Workspace"],
    label: "From Workspace Signal Replay",
    category: "Sources",
    archetypeId: SimulinkArchetypeId.SRC_CONSTANT,
    description: "Reads time-series stimulus data from workspace table or dataset.",
    provenance: "Time-Domain Simulation Stimulus",
    inPorts: 0,
    outPorts: 1,
    params: [["Value", 0.0, "", "Default fallback signal value"]],
  },
  {
    blockType: "SignalBuilder",
    aliases: ["simulink/Sources/Signal Builder", "SignalEditor"],
    label: "Piecewise-Linear Signal Builder",
    category: "Sources",
    archetypeId: SimulinkArchetypeId.LOOKUP_1D,
    description: "Generates piecewise-linear test waveforms over time breakpoints.",
    provenance: "Test Harness Waveform Generation",
    inPorts: 0,
    outPorts: 1,
    params: [
      ["x0", 0.0, "s", "Time breakpoint 0"],
      ["x1", 1.0, "s", "Time breakpoint 1"],
      ["x2", 2.0, "s", "Time breakpoint 2"],
      ["y0", 0.0, "", "Signal value 0"],
      ["y1", 1.0, "", "Signal value 1"],
      ["y2", 0.0, "", "Signal value 2"],
    ],
  },
  {
    blockType: "Chirp",
    aliases: ["simulink/Sources/Chirp Signal"],
    label: "Swept-Frequency Chirp Signal",
    category: "Sources",
    archetypeId: SimulinkArchetypeId.SRC_SINE,
    description: "Generates a swept-frequency sinusoidal chirp for frequency-response testing.",
    provenance: "System Identification & Frequency-Response Analysis",
    inPorts: 0,
    outPorts: 1,
    params: [
      ["Amplitude", 1.0, "", "Chirp peak amplitude"],
      ["Bias", 0.0, "", "DC offset"],
      ["Frequency", 1.0, "rad/s", "Initial angular frequency"],
      ["Phase", 0.0, "rad", "Initial phase"],
      ["TargetFreq", 10.0, "rad/s", "Target sweep frequency"],
    ],
  },
  {
    blockType: "UniformRandomNumber",
    aliases: ["simulink/Sources/Uniform Random Number", "RandomNumber"],
    label: "Uniform Random Number Source",
    category: "Sources",
    archetypeId: SimulinkArchetypeId.SRC_CONSTANT,
    description: "Generates uniformly distributed pseudo-random numbers within [Minimum, Maximum].",
    provenance: "Stochastic Simulation & Monte Carlo Methods",
    inPorts: 0,
    outPorts: 1,
    params: [
      ["Value", 0.0, "", "Mean / nominal output"],
      ["Minimum", -1.0, "", "Lower uniform bound"],
      ["Maximum", 1.0, "", "Upper uniform bound"],
      ["Seed", 0.0, "", "PRNG seed"],
    ],
  },
  {
    blockType: "RepeatingSequence",
    aliases: ["simulink/Sources/Repeating Sequence"],
    label: "Repeating Periodic Sequence",
    category: "Sources",
    archetypeId: SimulinkArchetypeId.SRC_PULSE,
    description: "Outputs a repeating periodic waveform defined by time and value vectors.",
    provenance: "Periodic Signal Generation",
    inPorts: 0,
    outPorts: 1,
    params: [
      ["Amplitude", 1.0, "", "Peak sequence amplitude"],
      ["Period", 2.0, "s", "Repetition period"],
      ["PulseWidth", 50.0, "%", "Duty cycle"],
      ["PhaseDelay", 0.0, "s", "Phase delay"],
    ],
  },
  {
    blockType: "CounterFreeRunning",
    aliases: ["simulink/Sources/Counter Free-Running", "CounterLimited"],
    label: "Free-Running Digital Counter",
    category: "Sources",
    archetypeId: SimulinkArchetypeId.DISCRETE_INTEGRATOR,
    description: "Increments an integer counter each sample step and wraps at 2^NumBits - 1.",
    provenance: "Digital Logic & Discrete-Time Counters",
    inPorts: 0,
    outPorts: 1,
    params: [
      ["gainval", 1.0, "", "Increment per step"],
      ["InitialCondition", 0.0, "", "Initial count"],
      ["UpperSaturationLimit", 65535.0, "", "Counter wrap limit"],
      ["LowerSaturationLimit", 0.0, "", "Counter lower bound"],
    ],
  },

  // === Simscape Physical Foundation Elements ===
  {
    blockType: "SimscapeResistor",
    aliases: ["fl_lib/Electrical/Electrical Elements/Resistor", "ee_lib/Passive/Resistor"],
    label: "Simscape Electrical Resistor (V = R * I)",
    category: "Simscape",
    archetypeId: SimulinkArchetypeId.GAIN,
    description: "Linear electrical resistor obeying Ohm's law v = R * i.",
    provenance: "Classical Circuit Theory (Ohm's Law)",
    inPorts: 1,
    outPorts: 1,
    params: [
      ["R", 100.0, "Ohm", "Electrical resistance"],
      ["Bias", 0.0, "V", "Offset voltage"],
    ],
  },
  {
    blockType: "SimscapeCapacitor",
    aliases: ["fl_lib/Electrical/Electrical Elements/Capacitor", "ee_lib/Passive/Capacitor"],
    label: "Simscape Electrical Capacitor (C * dv/dt = i)",
    category: "Simscape",
    archetypeId: SimulinkArchetypeId.INTEGRATOR,
    description: "Linear electrical capacitor storing charge q = C * v.",
    provenance: "Classical Circuit Theory (Capacitor Constitutive Law)",
    inPorts: 1,
    outPorts: 1,
    params: [
      ["InitialCondition", 0.0, "V", "Initial capacitor voltage v(0)"],
      ["UpperSaturationLimit", 1e30, "V", "Upper voltage bound"],
      ["LowerSaturationLimit", -1e30, "V", "Lower voltage bound"],
      ["C", 1e-6, "F", "Capacitance"],
    ],
  },
  {
    blockType: "SimscapeInductor",
    aliases: ["fl_lib/Electrical/Electrical Elements/Inductor", "ee_lib/Passive/Inductor"],
    label: "Simscape Electrical Inductor (L * di/dt = v)",
    category: "Simscape",
    archetypeId: SimulinkArchetypeId.INTEGRATOR,
    description: "Linear electrical inductor storing magnetic flux phi = L * i.",
    provenance: "Classical Circuit Theory (Faraday-Lenz Inductance Law)",
    inPorts: 1,
    outPorts: 1,
    params: [
      ["InitialCondition", 0.0, "A", "Initial inductor current i(0)"],
      ["UpperSaturationLimit", 1e30, "A", "Upper current bound"],
      ["LowerSaturationLimit", -1e30, "A", "Lower current bound"],
      ["L", 1e-3, "H", "Inductance"],
    ],
  },
  {
    blockType: "SimscapeDamper",
    aliases: ["fl_lib/Mechanical/Translational Elements/Translational Damper"],
    label: "Simscape Translational Damper (F = D * v)",
    category: "Simscape",
    archetypeId: SimulinkArchetypeId.GAIN,
    description: "Ideal mechanical viscous damper generating resistive force F = D * v.",
    provenance: "Classical Mechanics (Linear Viscous Damper)",
    inPorts: 1,
    outPorts: 1,
    params: [
      ["D", 10.0, "N*s/m", "Damping coefficient"],
      ["Bias", 0.0, "N", "Zero force offset"],
    ],
  },
  {
    blockType: "SimscapeSpring",
    aliases: ["fl_lib/Mechanical/Translational Elements/Translational Spring"],
    label: "Simscape Translational Spring (dF/dt = k * v)",
    category: "Simscape",
    archetypeId: SimulinkArchetypeId.INTEGRATOR,
    description: "Ideal Hookean mechanical translational spring with stiffness k.",
    provenance: "Classical Mechanics (Hooke's Law)",
    inPorts: 1,
    outPorts: 1,
    params: [
      ["InitialCondition", 0.0, "m", "Initial spring deformation x(0)"],
      ["UpperSaturationLimit", 1e30, "m", "Upper travel limit"],
      ["LowerSaturationLimit", -1e30, "m", "Lower travel limit"],
      ["spr_rate", 1000.0, "N/m", "Spring stiffness k"],
    ],
  },
  {
    blockType: "SimscapeMass",
    aliases: ["fl_lib/Mechanical/Translational Elements/Mass"],
    label: "Simscape Translational Mass (m * dv/dt = F)",
    category: "Simscape",
    archetypeId: SimulinkArchetypeId.INTEGRATOR,
    description: "Ideal translational inertial mass obeying Newton's second law F = m * dv/dt.",
    provenance: "Classical Mechanics (Newton's Second Law)",
    inPorts: 1,
    outPorts: 1,
    params: [
      ["InitialCondition", 0.0, "m/s", "Initial velocity v(0)"],
      ["UpperSaturationLimit", 1e30, "m/s", "Upper velocity bound"],
      ["LowerSaturationLimit", -1e30, "m/s", "Lower velocity bound"],
      ["mass", 1.0, "kg", "Translational mass"],
    ],
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
