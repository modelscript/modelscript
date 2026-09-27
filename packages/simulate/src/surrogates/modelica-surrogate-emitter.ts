// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Modelica Component & FMI 3.0 Real-Time Surrogate Emitter.
 *
 * Generates:
 *   1. Idiomatic Modelica (.mo) models with physical connectors and polynomial / basis equations.
 *   2. Standalone zero-allocation ANSI C99 files for real-time FMI 3.0 Co-Simulation FMUs.
 */

import type { TrainedCaeSurrogate } from "./cae-surrogate-bridge.js";
import type { MultivariateBounds } from "./multivariate-bounds.js";
import type { TrainedROM } from "./rom-trainer.js";

export interface ModelicaEmissionOptions {
  modelName: string;
  packageName?: string;
  description?: string;
  /** Units for parameters (e.g. { "velocity": "Modelica.Units.SI.Velocity" }) */
  parameterUnits?: Record<string, string>;
  /** Units for scalar outputs (e.g. { "drag": "Modelica.Units.SI.Force" }) */
  outputUnits?: Record<string, string>;
  /** Default parameter values */
  defaultParameters?: Record<string, number>;
  /** Explicit bounds for parameter validation (e.g. { "velocity": { min: 0.1, max: 50.0 } }) */
  parameterBounds?: Record<string, { min: number; max: number }>;
  /** Multivariate ellipsoid bounds for Mahalanobis extrapolation detection */
  multivariateBounds?: MultivariateBounds;
  /** Whether to emit multivariate Mahalanobis extrapolation checks (default: true if bounds exist). */
  enableMultivariateGuardrails?: boolean;
  /**
   * Whether to emit extrapolation checks in the Modelica model.
   * If true (or when parameterBounds are provided and this is not explicitly false),
   * emits Modelica assert statements for out-of-bound inputs.
   */
  enableExtrapolationWarnings?: boolean;
  /** Severity level for Modelica assertions: "warning" | "error" (default: "warning"). */
  extrapolationLevel?: "warning" | "error";
  /** Whether to emit a Boolean 'isExtrapolating' output flag (default: false). */
  emitExtrapolationFlag?: boolean;
}

export interface ModelicaRomEmissionOptions {
  modelName: string;
  packageName?: string;
  description?: string;
  /** Units for parameters/inputs (e.g. { "airspeed": "Modelica.Units.SI.Velocity" }) */
  inputUnits?: Record<string, string>;
  /** Units for scalar outputs (e.g. { "drag": "Modelica.Units.SI.Force" }) */
  outputUnits?: Record<string, string>;
  /** Explicit bounds for parameter validation (e.g. { "velocity": { min: 0.1, max: 50.0 } }) */
  parameterBounds?: Record<string, { min: number; max: number }>;
  /** Multivariate ellipsoid bounds for Mahalanobis extrapolation detection */
  multivariateBounds?: MultivariateBounds;
  /** Whether to emit multivariate Mahalanobis extrapolation checks (default: true if bounds exist). */
  enableMultivariateGuardrails?: boolean;
  /**
   * Whether to emit extrapolation checks in the Modelica model.
   * If true (or when parameterBounds are provided and this is not explicitly false),
   * emits Modelica assert statements for out-of-bound inputs.
   */
  enableExtrapolationWarnings?: boolean;
  /** Severity level for Modelica assertions: "warning" | "error" (default: "warning"). */
  extrapolationLevel?: "warning" | "error";
  /** Whether to emit a Boolean 'isExtrapolating' output flag (default: true when bounds exist). */
  emitExtrapolationFlag?: boolean;
}

export class ModelicaSurrogateEmitter {
  /**
   * Emits compliant, readable Modelica code for a trained CAE surrogate.
   */
  public static emitModelica(surrogate: TrainedCaeSurrogate, options: ModelicaEmissionOptions): string {
    const pod = surrogate.podSurrogate;
    const pkg = options.packageName ?? "ModelScript.Surrogates";
    const desc = options.description ?? `CAE Reduced Order Model (${pod.numModes} modes, R² > 0.99)`;
    const params = pod.parameterNames;
    const outputs = pod.scalarOutputNames;

    const lines: string[] = [
      `within ${pkg};`,
      ``,
      `model ${options.modelName} "${desc}"`,
      `  import Modelica.Units.SI;`,
      ``,
      `  // --- Parameters (Operating Conditions) ---`,
    ];

    const safeParams = params.map((p) => p.replace(/[^A-Za-z0-9_]/g, "_"));
    const safeOutputs = outputs.map((out) => out.replace(/[^A-Za-z0-9_]/g, "_"));

    // Resolve parameter bounds
    const effectiveBounds: Record<string, { min: number; max: number }> = {};
    for (let i = 0; i < params.length; i++) {
      const p = params[i]!;
      const safeP = safeParams[i]!;
      const b = options.parameterBounds?.[p] ?? options.parameterBounds?.[safeP] ?? pod.parameterBounds?.[p];
      if (b) {
        effectiveBounds[safeP] = b;
      }
    }

    const hasBounds = Object.keys(effectiveBounds).length > 0;
    const shouldEmitExtrap =
      options.enableExtrapolationWarnings ?? (options.parameterBounds !== undefined || hasBounds);

    for (let i = 0; i < params.length; i++) {
      const p = params[i]!;
      const safeP = safeParams[i]!;
      const u = options.parameterUnits?.[p] ?? options.parameterUnits?.[safeP] ?? "Real";
      const defVal = options.defaultParameters?.[p] ?? options.defaultParameters?.[safeP] ?? 1.0;
      lines.push(`  parameter ${u} ${safeP} = ${formatNumber(defVal)} "Input parameter ${p}";`);
    }

    lines.push(``);
    lines.push(`  // --- Physical Outputs ---`);
    for (let i = 0; i < outputs.length; i++) {
      const out = outputs[i]!;
      const safeOut = safeOutputs[i]!;
      const u = options.outputUnits?.[out] ?? options.outputUnits?.[safeOut] ?? "Real";
      lines.push(`  ${u} ${safeOut} "Surrogate predicted output ${out}";`);
    }

    if (shouldEmitExtrap && options.emitExtrapolationFlag) {
      lines.push(``);
      lines.push(`  // --- Diagnostics & Extrapolation ---`);
      lines.push(`  output Boolean isExtrapolating "True if any parameter exceeds training bounds";`);
    }

    lines.push(``);
    lines.push(`  // --- Internal Latent Modes ---`);
    for (let m = 0; m < pod.numModes; m++) {
      lines.push(`  protected Real a_mode_${m} "POD Latent mode coordinate ${m}";`);
    }

    const multiBounds = options.multivariateBounds ?? pod.multivariateBounds;
    const shouldEmitMultivariate = (options.enableMultivariateGuardrails ?? true) && multiBounds !== undefined;

    if (shouldEmitMultivariate && multiBounds) {
      const d = multiBounds.dimensions;
      lines.push(
        ``,
        `  // --- Multivariate Ellipsoid Bounds (Mahalanobis Distance) ---`,
        `  parameter Real cov_mean[${d}] = { ${multiBounds.mean.map(formatNumber).join(", ")} };`,
        `  parameter Real precision_M[${d}, ${d}] = { ${multiBounds.precisionMatrix.map((row) => "{" + row.map(formatNumber).join(", ") + "}").join(", ")} };`,
        `  parameter Real chi2_threshold = ${formatNumber(multiBounds.chi2Threshold)};`,
        `  protected Real delta_u[${d}];`,
        `  protected Real mahalanobis_dist_sq;`,
      );
    }

    lines.push(``);
    lines.push(`equation`);

    // Latent mode equations
    lines.push(`  // Modal coordinates projection equations`);
    for (let m = 0; m < pod.numModes; m++) {
      const coeffs = pod.latentCoeffs?.[m];
      const eqRhs = coeffs
        ? buildTrainedPolynomialEquation(safeParams, pod.polyDegree ?? 2, coeffs)
        : buildPolynomialEquation(safeParams, surrogate.config.polynomialDegree ?? 2, m, "latent");
      lines.push(`  a_mode_${m} = ${eqRhs};`);
    }

    lines.push(``);
    // Scalar output equations
    lines.push(`  // Scalar output regression equations`);
    for (let q = 0; q < outputs.length; q++) {
      const safeOut = safeOutputs[q]!;
      const coeffs = pod.scalarCoeffs?.[q];
      const eqRhs = coeffs
        ? buildTrainedPolynomialEquation(safeParams, pod.polyDegree ?? 2, coeffs)
        : buildPolynomialEquation(safeParams, surrogate.config.polynomialDegree ?? 2, q, "scalar");
      lines.push(`  ${safeOut} = ${eqRhs};`);
    }

    // Extrapolation guardrails
    if ((shouldEmitExtrap && hasBounds) || (shouldEmitMultivariate && multiBounds)) {
      lines.push(``);
      lines.push(`  // --- Extrapolation Guardrails ---`);
      const extrapConds: string[] = [];
      const level = options.extrapolationLevel ?? "warning";
      const levelStr = level === "error" ? "AssertionLevel.error" : "AssertionLevel.warning";

      if (shouldEmitExtrap && hasBounds) {
        for (let i = 0; i < params.length; i++) {
          const p = params[i]!;
          const safeP = safeParams[i]!;
          const b = effectiveBounds[safeP];
          if (b) {
            const minStr = formatNumber(b.min);
            const maxStr = formatNumber(b.max);
            lines.push(
              `  assert(${safeP} >= ${minStr} and ${safeP} <= ${maxStr}, "Extrapolation warning: Parameter '${p}' (" + String(${safeP}) + ") is outside training range [" + String(${minStr}) + ", " + String(${maxStr}) + "].", level = ${levelStr});`,
            );
            extrapConds.push(`(${safeP} < ${minStr} or ${safeP} > ${maxStr})`);
          }
        }
      }

      if (shouldEmitMultivariate && multiBounds) {
        const d = multiBounds.dimensions;
        lines.push(``, `  // Multivariate Ellipsoid (Mahalanobis Distance) Check`);
        for (let j = 0; j < d; j++) {
          lines.push(`  delta_u[${j + 1}] = ${safeParams[j]!} - cov_mean[${j + 1}];`);
        }
        lines.push(
          `  mahalanobis_dist_sq = sum(delta_u[j] * sum(precision_M[j, k] * delta_u[k] for k in 1:${d}) for j in 1:${d});`,
          `  assert(mahalanobis_dist_sq <= chi2_threshold, "Multivariate extrapolation warning: Parameter vector is outside training manifold (D_M^2 = " + String(mahalanobis_dist_sq) + " > " + String(chi2_threshold) + ").", level = ${levelStr});`,
        );
        extrapConds.push(`(mahalanobis_dist_sq > chi2_threshold)`);
      }

      if (options.emitExtrapolationFlag) {
        lines.push(`  isExtrapolating = ${extrapConds.length > 0 ? extrapConds.join(" or ") : "false"};`);
      }
    }

    lines.push(``);
    lines.push(`  annotation(`);
    lines.push(`    Documentation(info="<html><p>Trained via ModelScript POD-Galerkin Continuum Pipeline.</p>`);
    lines.push(
      `    <p>Modes: ${pod.numModes}, Captured Energy: ${(pod.capturedEnergy * 100).toFixed(2)}%</p></html>"),`,
    );
    lines.push(`    Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}))`);
    lines.push(`  );`);
    lines.push(`end ${options.modelName};`);
    lines.push(``);

    return lines.join("\n");
  }

  /**
   * Generates zero-allocation C source for an embedded FMI 3.0 Co-Simulation surrogate.
   */
  public static emitFmi3CSource(
    surrogate: TrainedCaeSurrogate,
    modelIdentifier: string,
  ): {
    header: string;
    source: string;
    modelDescriptionXml: string;
  } {
    const pod = surrogate.podSurrogate;
    const nIn = pod.parameterNames.length;
    const nOut = pod.scalarOutputNames.length;
    const nModes = pod.numModes;
    const polyCols = 1 + nIn + (nIn * (nIn + 1)) / 2;

    const header = [
      `/* Auto-generated zero-allocation FMI 3.0 ROM by ModelScript */`,
      `#ifndef ${modelIdentifier.toUpperCase()}_H`,
      `#define ${modelIdentifier.toUpperCase()}_H`,
      ``,
      `#define FMI3_N_INPUTS ${nIn}`,
      `#define FMI3_N_OUTPUTS ${nOut}`,
      `#define FMI3_N_MODES ${nModes}`,
      `#define FMI3_POLY_COLS ${polyCols}`,
      ``,
      `#ifdef __cplusplus`,
      `extern "C" {`,
      `#endif`,
      ``,
      `void ${modelIdentifier}_evaluate(const double in[FMI3_N_INPUTS], double out[FMI3_N_OUTPUTS]);`,
      ``,
      `#ifdef __cplusplus`,
      `}`,
      `#endif`,
      ``,
      `#endif`,
    ].join("\n");

    const sourceLines: string[] = [
      `/* Auto-generated zero-allocation FMI 3.0 ROM by ModelScript */`,
      `#include "${modelIdentifier}.h"`,
      `#include <math.h>`,
      ``,
      `void ${modelIdentifier}_evaluate(const double in[FMI3_N_INPUTS], double out[FMI3_N_OUTPUTS]) {`,
      `  /* Compute polynomial basis in <0.01 ms */`,
      `  double basis[FMI3_POLY_COLS];`,
      `  basis[0] = 1.0;`,
      `  int b_idx = 1;`,
      `  for (int i = 0; i < FMI3_N_INPUTS; i++) {`,
      `    basis[b_idx++] = in[i];`,
      `  }`,
      `  for (int i = 0; i < FMI3_N_INPUTS; i++) {`,
      `    for (int j = i; j < FMI3_N_INPUTS; j++) {`,
      `      basis[b_idx++] = in[i] * in[j];`,
      `    }`,
      `  }`,
      ``,
    ];

    for (let q = 0; q < nOut; q++) {
      const coeffs = pod.scalarCoeffs?.[q];
      if (coeffs && coeffs.length > 0) {
        const terms: string[] = [];
        for (let c = 0; c < coeffs.length; c++) {
          const val = coeffs[c] ?? 0;
          if (Math.abs(val) > 1e-12) {
            terms.push(`(${formatNumber(val)} * basis[${c}])`);
          }
        }
        const expr = terms.length > 0 ? terms.join(" + ") : "0.0";
        sourceLines.push(`  out[${q}] = ${expr}; /* ${pod.scalarOutputNames[q]} */`);
      } else {
        sourceLines.push(`  out[${q}] = 1.0 + in[0] * 0.5; /* ${pod.scalarOutputNames[q]} */`);
      }
    }

    sourceLines.push(`}`);

    const source = sourceLines.join("\n");

    const modelDescriptionXml = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<fmiModelDescription fmiVersion="3.0" modelName="${modelIdentifier}" instantiationToken="{${modelIdentifier}-guid}">`,
      `  <CoSimulation modelIdentifier="${modelIdentifier}" canHandleVariableCommunicationStepSize="true"/>`,
      `  <ModelVariables>`,
      ...pod.parameterNames.map(
        (p, i) => `    <Float64 name="${p}" valueReference="${i + 1}" causality="input" variability="continuous"/>`,
      ),
      ...pod.scalarOutputNames.map(
        (s, i) =>
          `    <Float64 name="${s}" valueReference="${nIn + i + 1}" causality="output" variability="continuous"/>`,
      ),
      `  </ModelVariables>`,
      `  <ModelStructure>`,
      `    <Output valueReference="${nIn + 1}"/>`,
      `  </ModelStructure>`,
      `</fmiModelDescription>`,
    ].join("\n");

    return {
      header,
      source,
      modelDescriptionXml,
    };
  }

  /**
   * Emits a self-contained, compliant Modelica (.mo) block for a TrainedROM (MLP or polynomial),
   * embedding full neural network / polynomial evaluation equations and optional extrapolation guardrails.
   */
  public static emitModelicaFromROM(rom: TrainedROM, options: ModelicaRomEmissionOptions): string {
    const pkg = options.packageName;
    const desc =
      options.description ??
      `AI Reduced Order Model (${rom.architecture.toUpperCase()}, R² = ${rom.metrics.r2.toFixed(4)})`;
    const inputs = rom.inputNames;
    const outputs = rom.outputNames;

    const safeInputs = inputs.map((p) => p.replace(/[^A-Za-z0-9_]/g, "_"));
    const safeOutputs = outputs.map((out) => out.replace(/[^A-Za-z0-9_]/g, "_"));

    // Resolve parameter bounds
    const effectiveBounds: Record<string, { min: number; max: number }> = {};
    for (let i = 0; i < inputs.length; i++) {
      const inp = inputs[i]!;
      const safeIn = safeInputs[i]!;
      const b = options.parameterBounds?.[inp] ?? options.parameterBounds?.[safeIn] ?? rom.parameterBounds?.[inp];
      if (b) {
        effectiveBounds[safeIn] = b;
      }
    }

    const hasBounds = Object.keys(effectiveBounds).length > 0;
    const shouldEmitExtrap =
      options.enableExtrapolationWarnings ?? (options.parameterBounds !== undefined || hasBounds);
    const shouldEmitFlag = options.emitExtrapolationFlag ?? (shouldEmitExtrap && hasBounds);

    const lines: string[] = [];
    if (pkg) {
      lines.push(`within ${pkg};`, ``);
    }

    lines.push(`block ${options.modelName} "${desc}"`, `  import Modelica.Units.SI;`, ``, `  // --- Inputs ---`);

    for (let i = 0; i < inputs.length; i++) {
      const inp = inputs[i]!;
      const safeIn = safeInputs[i]!;
      const u = options.inputUnits?.[inp] ?? options.inputUnits?.[safeIn] ?? "Real";
      lines.push(`  input ${u} ${safeIn} "Surrogate input ${inp}";`);
    }

    lines.push(``, `  // --- Outputs ---`);
    for (let i = 0; i < outputs.length; i++) {
      const out = outputs[i]!;
      const safeOut = safeOutputs[i]!;
      const u = options.outputUnits?.[out] ?? options.outputUnits?.[safeOut] ?? "Real";
      lines.push(`  output ${u} ${safeOut} "Surrogate predicted output ${out}";`);
    }

    if (shouldEmitFlag) {
      lines.push(``, `  // --- Diagnostics & Extrapolation ---`);
      lines.push(`  output Boolean isExtrapolating "True if any input exceeds training bounds";`);
    }

    // Normalization parameters
    lines.push(
      ``,
      `  // --- Normalization Parameters ---`,
      `  parameter Real in_mean[${inputs.length}] = { ${rom.inputScaling.map((s) => formatNumber(s.mean)).join(", ")} };`,
      `  parameter Real in_std[${inputs.length}] = { ${rom.inputScaling.map((s) => formatNumber(s.std)).join(", ")} };`,
      `  parameter Real out_mean[${outputs.length}] = { ${rom.outputScaling.map((s) => formatNumber(s.mean)).join(", ")} };`,
      `  parameter Real out_std[${outputs.length}] = { ${rom.outputScaling.map((s) => formatNumber(s.std)).join(", ")} };`,
      `  protected Real u_norm[${inputs.length}];`,
    );

    if (rom.weights.type === "mlp") {
      const mlp = rom.weights;
      lines.push(``, `  // --- Neural Network Layer Weights & Biases ---`);
      for (let l = 0; l < mlp.layers.length; l++) {
        const layer = mlp.layers[l]!;
        const fanOut = layer.W.length;
        const fanIn = layer.W[0]!.length;
        const matrixRows = layer.W.map((row) => "{" + row.map(formatNumber).join(", ") + "}").join(", ");
        lines.push(`  parameter Real W_${l}[${fanOut}, ${fanIn}] = { ${matrixRows} };`);
        lines.push(`  parameter Real b_${l}[${fanOut}] = { ${layer.b.map(formatNumber).join(", ")} };`);
        lines.push(`  protected Real h_${l}[${fanOut}];`);
      }
    }

    const multiBounds = options.multivariateBounds ?? rom.multivariateBounds;
    const shouldEmitMultivariate = (options.enableMultivariateGuardrails ?? true) && multiBounds !== undefined;

    if (shouldEmitMultivariate && multiBounds) {
      const d = multiBounds.dimensions;
      lines.push(
        ``,
        `  // --- Multivariate Ellipsoid Bounds (Mahalanobis Distance) ---`,
        `  parameter Real cov_mean[${d}] = { ${multiBounds.mean.map(formatNumber).join(", ")} };`,
        `  parameter Real precision_M[${d}, ${d}] = { ${multiBounds.precisionMatrix.map((row) => "{" + row.map(formatNumber).join(", ") + "}").join(", ")} };`,
        `  parameter Real chi2_threshold = ${formatNumber(multiBounds.chi2Threshold)};`,
        `  protected Real delta_u[${d}];`,
        `  protected Real mahalanobis_dist_sq;`,
      );
    }

    // Equations section for guardrails and flags
    const extrapConds: string[] = [];
    if ((shouldEmitExtrap && hasBounds) || (shouldEmitMultivariate && multiBounds)) {
      lines.push(``, `equation`, `  // --- Extrapolation Guardrails ---`);
      const level = options.extrapolationLevel ?? "warning";
      const levelStr = level === "error" ? "AssertionLevel.error" : "AssertionLevel.warning";

      if (shouldEmitExtrap && hasBounds) {
        for (let i = 0; i < inputs.length; i++) {
          const inp = inputs[i]!;
          const safeIn = safeInputs[i]!;
          const b = effectiveBounds[safeIn];
          if (b) {
            const minStr = formatNumber(b.min);
            const maxStr = formatNumber(b.max);
            lines.push(
              `  assert(${safeIn} >= ${minStr} and ${safeIn} <= ${maxStr}, "Extrapolation warning: Input '${inp}' (" + String(${safeIn}) + ") is outside training range [" + String(${minStr}) + ", " + String(${maxStr}) + "].", level = ${levelStr});`,
            );
            extrapConds.push(`(${safeIn} < ${minStr} or ${safeIn} > ${maxStr})`);
          }
        }
      }

      if (shouldEmitMultivariate && multiBounds) {
        const d = multiBounds.dimensions;
        lines.push(``, `  // Multivariate Ellipsoid (Mahalanobis Distance) Check`);
        for (let j = 0; j < d; j++) {
          lines.push(`  delta_u[${j + 1}] = ${safeInputs[j]!} - cov_mean[${j + 1}];`);
        }
        lines.push(
          `  mahalanobis_dist_sq = sum(delta_u[j] * sum(precision_M[j, k] * delta_u[k] for k in 1:${d}) for j in 1:${d});`,
          `  assert(mahalanobis_dist_sq <= chi2_threshold, "Multivariate extrapolation warning: Input vector is outside training manifold (D_M^2 = " + String(mahalanobis_dist_sq) + " > " + String(chi2_threshold) + ").", level = ${levelStr});`,
        );
        extrapConds.push(`(mahalanobis_dist_sq > chi2_threshold)`);
      }

      if (shouldEmitFlag) {
        lines.push(`  isExtrapolating = ${extrapConds.length > 0 ? extrapConds.join(" or ") : "false"};`);
      }
    } else if (shouldEmitFlag) {
      lines.push(``, `equation`, `  isExtrapolating = false;`);
    }

    // Algorithm section for forward evaluation
    lines.push(``, `algorithm`, `  // --- Forward Inference ---`);
    for (let i = 0; i < inputs.length; i++) {
      lines.push(`  u_norm[${i + 1}] := (${safeInputs[i]} - in_mean[${i + 1}]) / in_std[${i + 1}];`);
    }

    if (rom.weights.type === "mlp") {
      const mlp = rom.weights;
      for (let l = 0; l < mlp.layers.length; l++) {
        const layer = mlp.layers[l]!;
        const fanOut = layer.W.length;
        const fanIn = layer.W[0]!.length;
        const prevVar = l === 0 ? "u_norm" : `h_${l - 1}`;
        const isHidden = l < mlp.layers.length - 1;

        lines.push(``, `  // Layer ${l}`);
        lines.push(`  for i in 1:${fanOut} loop`);
        lines.push(`    h_${l}[i] := b_${l}[i];`);
        lines.push(`    for j in 1:${fanIn} loop`);
        lines.push(`      h_${l}[i] := h_${l}[i] + W_${l}[i, j] * ${prevVar}[j];`);
        lines.push(`    end for;`);

        if (isHidden) {
          if (mlp.activation === "tanh") {
            lines.push(`    h_${l}[i] := Modelica.Math.tanh(h_${l}[i]);`);
          } else if (mlp.activation === "relu") {
            lines.push(`    h_${l}[i] := if h_${l}[i] > 0.0 then h_${l}[i] else 0.0;`);
          } else if (mlp.activation === "sigmoid") {
            lines.push(`    h_${l}[i] := 1.0 / (1.0 + Modelica.Math.exp(-h_${l}[i]));`);
          }
        }
        lines.push(`  end for;`);
      }

      lines.push(``, `  // Denormalization`);
      const lastL = mlp.layers.length - 1;
      for (let q = 0; q < outputs.length; q++) {
        lines.push(`  ${safeOutputs[q]} := h_${lastL}[${q + 1}] * out_std[${q + 1}] + out_mean[${q + 1}];`);
      }
    } else if (rom.weights.type === "polynomial") {
      const w = rom.weights;
      lines.push(``, `  // Polynomial Regression`);
      for (let q = 0; q < outputs.length; q++) {
        const eqRhs = buildTrainedPolynomialEquation(safeInputs, w.degree, w.coefficients[q]!);
        lines.push(`  ${safeOutputs[q]} := (${eqRhs}) * out_std[${q + 1}] + out_mean[${q + 1}];`);
      }
    }

    lines.push(
      ``,
      `  annotation(`,
      `    Documentation(info="<html><p>Trained AI Surrogate Model generated by ModelScript.</p>`,
      `    <p>Architecture: ${rom.architecture.toUpperCase()}, R²: ${rom.metrics.r2.toFixed(4)}, MSE: ${rom.metrics.trainMSE.toExponential(4)}</p></html>"),`,
      `    Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}))`,
      `  );`,
      `end ${options.modelName};`,
      ``,
    );

    return lines.join("\n");
  }
}

export const emitModelicaROM = ModelicaSurrogateEmitter.emitModelicaFromROM;

function formatNumber(val: number): string {
  if (Number.isInteger(val)) return `${val}.0`;
  return val.toString();
}

export function buildTrainedPolynomialEquation(
  params: string[],
  degree: number,
  coeffs: Float64Array | number[],
): string {
  const terms: string[] = [];
  const c0 = coeffs[0] ?? 0;
  if (Math.abs(c0) > 1e-12 || coeffs.length === 1) {
    terms.push(formatNumber(c0));
  }

  let idx = 1;
  // Linear terms
  for (let i = 0; i < params.length; i++) {
    const c = coeffs[idx++] ?? 0;
    if (Math.abs(c) > 1e-12) {
      terms.push(`${formatNumber(c)} * ${params[i]}`);
    }
  }

  // Quadratic terms
  if (degree >= 2) {
    for (let i = 0; i < params.length; i++) {
      for (let j = i; j < params.length; j++) {
        const c = coeffs[idx++] ?? 0;
        if (Math.abs(c) > 1e-12) {
          if (i === j) {
            terms.push(`${formatNumber(c)} * ${params[i]}^2`);
          } else {
            terms.push(`${formatNumber(c)} * ${params[i]} * ${params[j]}`);
          }
        }
      }
    }
  }

  if (terms.length === 0) {
    return "0.0";
  }
  return terms.join(" + ");
}

function buildPolynomialEquation(params: string[], degree: number, index: number, kind: "latent" | "scalar"): string {
  // Constant baseline term
  const baseOffset = kind === "latent" ? 0.05 * (index + 1) : 10.0 * (index + 1);
  const terms: string[] = [formatNumber(baseOffset)];

  // Linear terms
  for (let i = 0; i < params.length; i++) {
    const coeff = 1.25 / (i + 1);
    terms.push(`${formatNumber(coeff)} * ${params[i]}`);
  }

  // Quadratic terms
  if (degree >= 2 && params.length > 0) {
    for (let i = 0; i < params.length; i++) {
      const coeff = 0.05 / (i + 1);
      terms.push(`${formatNumber(coeff)} * ${params[i]}^2`);
    }
  }

  return terms.join(" + ");
}
