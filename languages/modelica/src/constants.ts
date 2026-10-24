// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @module constants
 *
 * Canonical Modelica mathematical and physical constants per the Modelica
 * Language Specification §3.7.1 and the Modelica Standard Library
 * (`Modelica.Constants.*` and `ModelicaServices.Machine.*`).
 *
 * Centralizes all numeric constants across the compiler frontend, expression
 * evaluators, flattener, and diagram annotation interpreters to eliminate
 * duplicate, inconsistent magic numbers.
 */

/** Canonical numeric value for positive Real infinity (OpenModelica compatible). */
export const MODELICA_INF = 1e60;

/** Canonical numeric value for positive 32-bit Integer infinity. */
export const MODELICA_INTEGER_INF = 2147483647;

/** Maximum allowed dimension length or unrolled array expansion count. */
export const MAX_ARRAY_EXPANSION_LENGTH = 100000;

/** Machine epsilon used for floating-point tolerance in Modelica evaluation. */
export const MODELICA_EPS = 1e-15;

/** Minimum positive non-zero floating-point magnitude. */
export const MODELICA_SMALL = 1e-60;

/** Absolute zero temperature in degrees Celsius ($0\text{ K} = -273.15\text{ }^\circ\text{C}$). */
export const MODELICA_T_ZERO = -273.15;

/** Speed of light in vacuum ($\text{m/s}$). */
export const MODELICA_C = 299792458;

/** Standard acceleration of gravity ($\text{m/s}^2$). */
export const MODELICA_G_0 = 9.80665;

/** Planck constant ($\text{J}\cdot\text{s}$). */
export const MODELICA_H = 6.62607015e-34;

/** Boltzmann constant ($\text{J/K}$). */
export const MODELICA_K = 1.380649e-23;

/** Avogadro constant ($1/\text{mol}$). */
export const MODELICA_N_A = 6.02214076e23;

/** Elementary charge ($\text{C}$). */
export const MODELICA_Q = 1.602176634e-19;

/** Molar gas constant ($\text{J}/(\text{mol}\cdot\text{K})$). */
export const MODELICA_R = MODELICA_K * MODELICA_N_A; // ~8.31446261815324

/** Faraday constant ($\text{C/mol}$). */
export const MODELICA_F = MODELICA_Q * MODELICA_N_A; // ~96485.33212331

/** Newtonian constant of gravitation ($\text{m}^3/(\text{kg}\cdot\text{s}^2)$). */
export const MODELICA_G = 6.6743e-11;

/** Vacuum magnetic permeability ($\text{N/A}^2$). */
export const MODELICA_MU_0 = 4 * Math.PI * 1.00000000055e-7;

/** Vacuum electric permittivity ($\text{F/m}$). */
export const MODELICA_EPSILON_0 = 1 / (MODELICA_MU_0 * MODELICA_C * MODELICA_C);

/** Stefan-Boltzmann constant ($\text{W}/(\text{m}^2\cdot\text{K}^4)$). */
export const MODELICA_SIGMA = 5.670374419e-8;

/** Rydberg constant ($1/\text{m}$). */
export const MODELICA_R_INF = 10973731.56816;

/** Euler-Mascheroni constant $\gamma$. */
export const MODELICA_GAMMA = 0.5772156649015329;

/** Degrees to radians conversion factor ($\pi / 180$). */
export const MODELICA_D2R = Math.PI / 180;

/** Radians to degrees conversion factor ($180 / \pi$). */
export const MODELICA_R2D = 180 / Math.PI;

/**
 * Base map of Modelica standard constants (unqualified short names).
 */
export const MODELICA_BASE_CONSTANTS: Readonly<Record<string, number>> = Object.freeze({
  pi: Math.PI,
  e: Math.E,
  D2R: MODELICA_D2R,
  R2D: MODELICA_R2D,
  gamma: MODELICA_GAMMA,
  c: MODELICA_C,
  c_0: MODELICA_C,
  h: MODELICA_H,
  hbar: MODELICA_H / (2 * Math.PI),
  k: MODELICA_K,
  N_A: MODELICA_N_A,
  R: MODELICA_R,
  F: MODELICA_F,
  G: MODELICA_G,
  g_0: MODELICA_G_0,
  g_n: MODELICA_G_0,
  q: MODELICA_Q,
  mu_0: MODELICA_MU_0,
  epsilon_0: MODELICA_EPSILON_0,
  sigma: MODELICA_SIGMA,
  R_inf: MODELICA_R_INF,
  T_zero: MODELICA_T_ZERO,
  eps: MODELICA_EPS,
  small: MODELICA_SMALL,
  inf: MODELICA_INF,
  Integer_inf: MODELICA_INTEGER_INF,
});

/**
 * Bare single-letter physical constants defined in `Modelica.Constants`
 * which can only be substituted when in `Constants` scope or explicitly imported.
 */
export const BARE_SINGLE_LETTER_MODELICA_CONSTANTS: Readonly<Record<string, number>> = Object.freeze({
  c: MODELICA_C,
  G: MODELICA_G,
  q: MODELICA_Q,
  h: MODELICA_H,
  k: MODELICA_K,
  F: MODELICA_F,
  R: MODELICA_R,
});

/**
 * Comprehensive dictionary of Modelica constants supporting unqualified,
 * `Constants.*`, `Modelica.Constants.*`, and `ModelicaServices.Machine.*` paths.
 */
export const MODELICA_CONSTANTS: Readonly<Record<string, number>> = Object.freeze(
  (() => {
    const dict: Record<string, number> = {};
    for (const [name, val] of Object.entries(MODELICA_BASE_CONSTANTS)) {
      dict[name] = val;
      dict[`Constants.${name}`] = val;
      dict[`Modelica.Constants.${name}`] = val;
    }
    // Machine-specific service constants
    dict["ModelicaServices.Machine.eps"] = MODELICA_EPS;
    dict["ModelicaServices.Machine.small"] = MODELICA_SMALL;
    dict["ModelicaServices.Machine.inf"] = MODELICA_INF;
    dict["ModelicaServices.Machine.Integer_inf"] = MODELICA_INTEGER_INF;
    return dict;
  })(),
);

/**
 * Resolves a constant identifier or qualified reference to its numeric value.
 * Returns `undefined` if the name is not a known Modelica constant.
 */
export function resolveModelicaConstant(name: string): number | undefined {
  if (!name || typeof name !== "string") return undefined;
  const trimmed = name.trim();
  if (Object.prototype.hasOwnProperty.call(MODELICA_CONSTANTS, trimmed)) {
    return MODELICA_CONSTANTS[trimmed];
  }
  return undefined;
}

/**
 * Checks whether a given identifier or qualified name represents a recognized
 * Modelica constant.
 */
export function isModelicaConstant(name: string): boolean {
  return resolveModelicaConstant(name) !== undefined;
}
