// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate/twin/frac — Hydraulic Completions & Frac Analytics Types.
 *
 * Defines data structures for:
 * 1. Wellbore geometry and trajectory survey (MD vs TVD, casing ID, roughness).
 * 2. Non-Newtonian proppant slurry rheology and drag-reducing agent (DRA) friction.
 * 3. Multi-cluster perforation friction and dynamic abrasive erosion kinetics.
 * 4. Dynamic fracture compliance, net pressure, and Carter leakoff dynamics.
 * 5. Nolte-Smith diagnostic regime classification and screen-out forecasting.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Wellbore & Completion Geometry
// ─────────────────────────────────────────────────────────────────────────────

export interface WellboreSurveyStation {
  /** Measured depth along wellbore (meters). */
  measuredDepth: number;
  /** True vertical depth below surface (meters). */
  trueVerticalDepth: number;
  /** Wellbore inclination from vertical (degrees, 0 = vertical, 90 = horizontal). */
  inclinationDeg: number;
  /** Inner casing/liner diameter at this station (meters). Default ~0.1143m (4.5") or 0.1397m (5.5"). */
  innerDiameter: number;
  /** Absolute pipe wall roughness (meters, default: 4.5e-5 m for commercial steel). */
  roughnessMeters?: number | undefined;
}

export interface WellboreGeometry {
  /** Well identifier or name. */
  wellName: string;
  /** Total measured depth of stage toe (meters). */
  totalMeasuredDepth: number;
  /** True vertical depth at target stage (meters). */
  trueVerticalDepth: number;
  /** Casing survey trajectory stations from surface to toe. */
  surveyStations: WellboreSurveyStation[];
  /** Maximum Allowable Operating Pressure (MAOP) of casing / wellhead (Pascals). */
  maopPascals?: number | undefined;
}

export interface PerforationClusterConfig {
  /** Cluster sequence index within the stage (0-indexed from toe to heel). */
  clusterIndex: number;
  /** Measured depth location of this cluster (meters). */
  measuredDepth: number;
  /** Total number of perforation holes in this cluster (shot count). */
  shotCount: number;
  /** Initial perforation hole diameter (meters, e.g. 0.010668 m for 0.42 inch). */
  initialDiameterMeters: number;
  /** Initial discharge coefficient before erosion (typically ~0.60 to 0.65 for sharp-edged perfs). */
  initialCd: number;
  /** Maximum discharge coefficient after full smoothing (typically ~0.85 to 0.92). */
  maxCd?: number | undefined;
  /**
   * Cramer / Long-Xu erosion rate coefficient K_e [(m/s)^(-2) * kg^(-1) or dimensionless scale].
   * Typical range: 1.0e-9 to 5.0e-8 depending on proppant sphericity and casing hardness.
   */
  erosionCoefficient?: number | undefined;
  /** Discharge coefficient rounding saturation factor beta [1/kg]. Default: 0.005. */
  cdRoundingBeta?: number | undefined;
  /** Formation fracture breakdown/initiation stress at this cluster (Pascals). */
  breakdownStressPascals?: number | undefined;
}

export interface StageCompletionConfig {
  /** Stage number. */
  stageNumber: number;
  /** Cluster specifications for this stage (toe-to-heel or heel-to-toe). */
  clusters: PerforationClusterConfig[];
  /** Nominal casing inner diameter across the stage (meters). */
  casingDiameterMeters: number;
  /** Minimum in-situ horizontal stress / closure pressure sigma_min (Pascals). */
  closurePressurePascals: number;
  /** Young's modulus of target formation E (Pascals, e.g. 20-50 GPa). */
  youngsModulusPascals?: number | undefined;
  /** Poisson's ratio nu (dimensionless, e.g. 0.20-0.28). */
  poissonsRatio?: number | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fluid & Slurry Properties
// ─────────────────────────────────────────────────────────────────────────────

export interface SlurryRheologyConfig {
  /** Base clean fluid density (kg/m³, default: 1000 for fresh water, ~1020-1080 for brine). */
  baseFluidDensityKgPerM3?: number | undefined;
  /** Proppant solid grain density (kg/m³, 2650 for quartz sand, 3200-3600 for ceramic). */
  proppantGrainDensityKgPerM3?: number | undefined;
  /** Power-law fluid consistency index K (Pa * s^n, default: 0.005 to 0.05). */
  consistencyIndexK?: number | undefined;
  /** Power-law flow behavior index n (dimensionless, slickwater n ~ 0.5 to 0.8). */
  flowBehaviorIndexN?: number | undefined;
  /** Maximum Drag Reduction Agent (DRA) friction reduction efficiency (0.0 to 0.80, default: 0.70). */
  maxDragReduction?: number | undefined;
  /** DRA shear degradation rate constant per meter traveled (default: 1.5e-5 1/m). */
  draDegradationRatePerMeter?: number | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Telemetry & State Observations
// ─────────────────────────────────────────────────────────────────────────────

export interface FracTelemetrySample {
  /** Elapsed time (seconds). */
  timeSeconds: number;
  /** Surface treating pressure at wellhead (Pascals, or gauge Pa). */
  surfacePressurePascals: number;
  /** Total slurry pump rate into wellhead (m³/s, 1 bpm = 0.00264979 m³/s). */
  slurryRateM3PerSec: number;
  /** Surface proppant concentration added at blender (kg of proppant per m³ of clean fluid). */
  proppantConcentrationKgPerM3: number;
  /** Optional downhole pressure gauge measurement (Pascals), if available for validation. */
  downholePressurePascals?: number | undefined;
  /** Clean fluid rate (m³/s). If omitted, inferred from slurry rate and proppant concentration. */
  cleanRateM3PerSec?: number | undefined;
  /** Friction Reducer (FR) active dosing (gallons per thousand gal or volume fraction). */
  frictionReducerConcentrationGpt?: number | undefined;
}

export interface WellboreHydraulicsState {
  /** Current time (seconds). */
  timeSeconds: number;
  /** Computed dynamic mixture slurry density entering perforations (kg/m³). */
  slurryDensityKgPerM3: number;
  /** Total integrated hydrostatic pressure column (Pascals). */
  hydrostaticPressurePascals: number;
  /** Total wellbore pipe frictional pressure loss (Pascals). */
  pipeFrictionPressurePascals: number;
  /** Effective Drag Reduction (DRA) fraction (0.0 to 1.0). */
  effectiveDragReduction: number;
  /** Estimated Bottom-Hole Treating Pressure: BHTP = P_surf + P_hyd - P_fric (Pascals). */
  bottomHoleTreatingPressurePascals: number;
}

export interface ClusterErosionState {
  /** Cluster sequence index. */
  clusterIndex: number;
  /** Current eroded perforation diameter (meters). */
  currentDiameterMeters: number;
  /** Current discharge coefficient Cd (dimensionless). */
  currentCd: number;
  /** Cumulative proppant mass delivered through this cluster (kg). */
  cumulativeProppantKg: number;
  /** Allocated slurry flow rate into this cluster (m³/s). */
  allocatedRateM3PerSec: number;
  /** Percentage of total stage flow taken by this cluster (0% to 100%). */
  rateSharePercent: number;
  /** Perforation fluid entry velocity (m/s). */
  perforationVelocityMetersPerSec: number;
  /** Perforation friction pressure drop across this cluster (Pascals). */
  perforationPressureDropPascals: number;
  /** True if cluster is actively taking fluid (> 5% of equal share). */
  isActive: boolean;
}

export interface StageErosionSummary {
  /** Elapsed time (seconds). */
  timeSeconds: number;
  /** States for all clusters. */
  clusters: ClusterErosionState[];
  /** Cluster Efficiency: percentage of clusters effectively taking proppant (0 to 100%). */
  clusterEfficiencyPercent: number;
  /** Stage-averaged perforation pressure drop (Pascals). */
  averagePerfFrictionPascals: number;
  /** Total cumulative proppant pumped into the stage (kg). */
  totalProppantPumpedKg: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic Fracture Compliance & Net Pressure
// ─────────────────────────────────────────────────────────────────────────────

export interface FractureComplianceState {
  /** Elapsed time (seconds). */
  timeSeconds: number;
  /** Estimated net fracture propagation pressure: P_net = BHTP - sigma_min - dP_perf - dP_nearwellbore (Pascals). */
  netPressurePascals: number;
  /** Dynamic fracture compliance: C_f = dV_frac / dP_net (m³ / Pa). */
  complianceM3PerPascal: number;
  /** Current total accumulated open fracture volume (m³). */
  fractureVolumeM3: number;
  /** Instantaneous fluid leak-off rate to the formation (m³/s). */
  leakoffRateM3PerSec: number;
  /** Near-wellbore tortuosity / choke pressure drop (Pascals). */
  nearWellboreTortuosityPascals: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Screen-Out Detection & Nolte-Smith Diagnostic
// ─────────────────────────────────────────────────────────────────────────────

export type NolteSmithRegime =
  | "MODE_I_STABLE_PROPAGATION" // b in [0.10, 0.25]: PKN length propagation (Normal)
  | "MODE_II_HEIGHT_GROWTH" // b ~ 0.0 or negative: Height growth or natural fracture loss
  | "MODE_III_TIP_SCREENOUT" // b ~ 1.0 (0.8 to 1.5): Tip Screen-Out (TSO), proppant bridging
  | "MODE_IV_NEAR_WELLBORE_SCREENOUT"; // b >= 1.8: Severe near-wellbore pack-off (Critical)

export type ScreenoutAlarmLevel = "NORMAL" | "WATCH" | "WARNING" | "EMERGENCY_SHUTDOWN";

export interface ScreenoutDiagnostic {
  /** Elapsed time (seconds). */
  timeSeconds: number;
  /** Nolte-Smith logarithmic slope: b = d(ln P_net) / d(ln t). */
  nolteSmithSlope: number;
  /** Net pressure rate of change: dP_net / dt (Pa / s). */
  dNetPressureDt: number;
  /** Surface pressure rate of change: dP_surf / dt (Pa / s). */
  dSurfacePressureDt: number;
  /** Current identified propagation regime. */
  regime: NolteSmithRegime;
  /** Actionable alarm level. */
  alarmLevel: ScreenoutAlarmLevel;
  /** Estimated Time-to-Screenout / MAOP breach (seconds), or null if stable. */
  timeToScreenoutSeconds: number | null;
  /** Diagnostic human-readable explanation. */
  message: string;
}
