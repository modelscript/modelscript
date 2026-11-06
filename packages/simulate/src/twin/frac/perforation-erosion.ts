// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate/twin/frac — Multi-Cluster Perforation Friction & Erosion Engine.
 *
 * Implements:
 * 1. Mechanistic orifice pressure drop across perforated casing holes.
 * 2. Dynamic Cramer & Long-Xu abrasive proppant erosion kinetics:
 *    - Hole diameter enlargement dD/dt
 *    - Entrance rounding discharge coefficient transition: Cd(t) -> Cd_max
 * 3. Fast monotonic cross-cluster flow allocation solver across M clusters.
 * 4. Cluster efficiency (%) and flow distribution variance metrics.
 */

import type {
  ClusterErosionState,
  PerforationClusterConfig,
  StageCompletionConfig,
  StageErosionSummary,
} from "./types.js";

// Default physical constants
const DEFAULT_INITIAL_CD = 0.62;
const DEFAULT_MAX_CD = 0.88;
const DEFAULT_EROSION_COEFF = 4.5e-9; // (m/s)^(-2) * kg^(-1)
const DEFAULT_CD_BETA = 0.003; // 1/kg proppant per cluster

/**
 * Calculates perforation orifice pressure drop across a cluster for a given flow rate.
 *
 * Formula:
 *   dP_perf = (8 * rho_slurry * Q_cluster^2) / (pi^2 * Cd^2 * N_perf^2 * D_perf^4)
 *
 * @param rateM3PerSec     Slurry volume flow rate entering this cluster (m³/s).
 * @param numPerfs         Total shot count in cluster.
 * @param diameterMeters   Current perforation hole diameter (meters).
 * @param cd               Discharge coefficient (dimensionless, ~0.60 to 0.90).
 * @param slurryDensity    Mixture density (kg/m³).
 */
export function calculatePerforationFriction(
  rateM3PerSec: number,
  numPerfs: number,
  diameterMeters: number,
  cd: number,
  slurryDensity: number,
): { pressureDropPascals: number; perforationVelocity: number } {
  const q = Math.abs(rateM3PerSec);
  const n = Math.max(1, numPerfs);
  const d = Math.max(0.002, diameterMeters);
  const c = Math.max(0.3, Math.min(1.0, cd));

  // Single perforation hole cross-sectional area
  const aHole = (Math.PI / 4.0) * d * d;
  const totalArea = n * aHole;

  // Velocity through the perforation hole (m/s)
  const v = q / totalArea;

  // Pressure drop: dP = (rho / (2 * Cd^2)) * v^2
  const dp = (slurryDensity / (2.0 * c * c)) * (v * v);

  return { pressureDropPascals: dp, perforationVelocity: v };
}

/**
 * Updates dynamic erosion kinetics for a single cluster over a time-step dt.
 *
 * @param state          Current cluster erosion state.
 * @param config         Static cluster completion configuration.
 * @param proppantConc   Slurry proppant concentration (kg/m³).
 * @param slurryDensity  Slurry mixture density (kg/m³).
 * @param dtSeconds      Time step duration (seconds).
 */
export function stepClusterErosion(
  state: ClusterErosionState,
  config: PerforationClusterConfig,
  proppantConc: number,
  slurryDensity: number,
  dtSeconds: number,
): ClusterErosionState {
  if (dtSeconds <= 0.0 || state.allocatedRateM3PerSec <= 1e-7) {
    return { ...state };
  }

  const kErosion = config.erosionCoefficient ?? DEFAULT_EROSION_COEFF;
  const cdMax = config.maxCd ?? DEFAULT_MAX_CD;
  const cdBeta = config.cdRoundingBeta ?? DEFAULT_CD_BETA;
  const cd0 = config.initialCd ?? DEFAULT_INITIAL_CD;

  // Mass rate of proppant passing through this cluster: m_dot = C_prop * Q_cluster (kg/s)
  const proppantRate = Math.max(0.0, proppantConc) * state.allocatedRateM3PerSec;
  const deltaProppantKg = proppantRate * dtSeconds;
  const newCumulativeProppant = state.cumulativeProppantKg + deltaProppantKg;

  // 1. Entrance Rounding Cd Evolution
  // Cd(m) = Cd_0 + (Cd_max - Cd_0) * (1 - exp(-beta * m_prop))
  const newCd = Math.min(cdMax, cd0 + (cdMax - cd0) * (1.0 - Math.exp(-cdBeta * newCumulativeProppant)));

  // 2. Abrasive Hole Enlargement
  // dD/dt = K_erosion * (0.5 * rho * v_perf^2) * (m_dot / N_perf)
  const v = state.perforationVelocityMetersPerSec;
  const kineticTerm = 0.5 * slurryDensity * v * v;
  const erosionRatePerSec = kErosion * kineticTerm * (proppantRate / Math.max(1, config.shotCount));

  // Limit max realistic enlargement to 3x initial diameter to avoid non-physical runaway
  const maxDiameter = config.initialDiameterMeters * 3.0;
  const newDiameter = Math.min(maxDiameter, state.currentDiameterMeters + erosionRatePerSec * dtSeconds);

  // Recalculate perforation pressure drop with new geometry
  const { pressureDropPascals, perforationVelocity } = calculatePerforationFriction(
    state.allocatedRateM3PerSec,
    config.shotCount,
    newDiameter,
    newCd,
    slurryDensity,
  );

  return {
    ...state,
    currentDiameterMeters: newDiameter,
    currentCd: newCd,
    cumulativeProppantKg: newCumulativeProppant,
    perforationPressureDropPascals: pressureDropPascals,
    perforationVelocityMetersPerSec: perforationVelocity,
  };
}

/**
 * Initializes a new stage erosion state from stage configuration.
 */
export function initializeStageErosion(stage: StageCompletionConfig): StageErosionSummary {
  const clusterStates: ClusterErosionState[] = stage.clusters.map((c) => ({
    clusterIndex: c.clusterIndex,
    currentDiameterMeters: c.initialDiameterMeters,
    currentCd: c.initialCd,
    cumulativeProppantKg: 0.0,
    allocatedRateM3PerSec: 0.0,
    rateSharePercent: stage.clusters.length > 0 ? 100.0 / stage.clusters.length : 0.0,
    perforationVelocityMetersPerSec: 0.0,
    perforationPressureDropPascals: 0.0,
    isActive: true,
  }));

  return {
    timeSeconds: 0.0,
    clusters: clusterStates,
    clusterEfficiencyPercent: 100.0,
    averagePerfFrictionPascals: 0.0,
    totalProppantPumpedKg: 0.0,
  };
}

/**
 * Solves cross-cluster flow distribution across all clusters in the stage.
 *
 * All clusters share the common wellbore pressure BHTP (with minor inter-cluster pipe friction).
 * We find the common fracture propagation pressure P_frac such that:
 *   sum_{i=1}^M Q_i(P_frac) = Q_total
 *
 * @param totalSlurryRate Total slurry rate entering the stage (m³/s).
 * @param stage           Stage completion configuration.
 * @param currentStates   Current erosion state of each cluster.
 * @param slurryDensity   Current slurry mixture density (kg/m³).
 * @param bhtp            Bottom-hole treating pressure (Pascals).
 */
export function solveCrossClusterFlowSplit(
  totalSlurryRate: number,
  stage: StageCompletionConfig,
  currentStates: ClusterErosionState[],
  slurryDensity: number,
  bhtp: number,
): ClusterErosionState[] {
  const qTotal = Math.max(0.0, totalSlurryRate);
  const m = stage.clusters.length;
  if (m === 0 || qTotal < 1e-6) {
    return currentStates.map((s) => ({
      ...s,
      allocatedRateM3PerSec: 0.0,
      rateSharePercent: 0.0,
      perforationVelocityMetersPerSec: 0.0,
      perforationPressureDropPascals: 0.0,
      isActive: false,
    }));
  }

  // Precompute hydraulic conductance factor for each cluster:
  // dP_perf = K_i * Q_i^2 ==> Q_i = sqrt(dP_perf / K_i)
  // where K_i = 8 * rho / (pi^2 * Cd^2 * N^2 * D^4)
  const conductances: number[] = [];
  for (let i = 0; i < m; i++) {
    const c = currentStates[i]!;
    const cfg = stage.clusters[i]!;
    const n = Math.max(1, cfg.shotCount);
    const d = Math.max(0.002, c.currentDiameterMeters);
    const cd = Math.max(0.3, c.currentCd);

    const kOrifice = (8.0 * slurryDensity) / (Math.PI * Math.PI * cd * cd * n * n * Math.pow(d, 4.0));
    conductances.push(kOrifice);
  }

  // Inter-cluster wellbore frictional head drop between heel and each cluster
  const interClusterLoss: number[] = [];
  const heelMd = stage.clusters[0]?.measuredDepth ?? 0.0;
  for (let i = 0; i < m; i++) {
    const deltaMd = Math.abs(stage.clusters[i]!.measuredDepth - heelMd);
    // Wellbore friction inside casing between clusters is small compared to perf friction (~5-20 psi)
    // Approximate with linear laminar/turbulent scaling
    const lossPa = deltaMd * 15.0; // ~15 Pa/m (typical ~10-30 psi over 100m)
    interClusterLoss.push(lossPa);
  }

  // Monotonic Root-Finding for P_frac via Brent / Bisection
  // At P_frac: dP_i = max(0, (BHTP - loss_i) - P_frac), Q_i = sqrt(dP_i / K_i)
  const computeTotalQ = (pFrac: number): { qSum: number; qPerCluster: number[] } => {
    let sum = 0.0;
    const qList: number[] = [];
    for (let i = 0; i < m; i++) {
      const pAvailable = Math.max(0.0, bhtp - interClusterLoss[i]! - pFrac);
      const qi = Math.sqrt(pAvailable / conductances[i]!);
      sum += qi;
      qList.push(qi);
    }
    return { qSum: sum, qPerCluster: qList };
  };

  // Bounds for P_frac: [bhtp - max_perf_friction, bhtp]
  let pMin = bhtp - 1e8; // bhtp - 100 MPa
  let pMax = bhtp;
  let qResult: number[] = [];

  // Bisection search (25 iterations gives sub-millibar precision)
  for (let iter = 0; iter < 28; iter++) {
    const pMid = (pMin + pMax) / 2.0;
    const { qSum, qPerCluster } = computeTotalQ(pMid);
    qResult = qPerCluster;

    if (qSum > qTotal) {
      pMin = pMid; // P_frac is higher (less pressure drop across perfs)
    } else {
      pMax = pMid;
    }
  }

  // Build updated cluster states
  const nominalRate = qTotal / m;
  const updatedClusters: ClusterErosionState[] = [];
  let sumAllocated = 0.0;
  for (let i = 0; i < m; i++) {
    const qi = qResult[i] ?? nominalRate;
    sumAllocated += qi;
  }

  // Normalize small bisection residual to exact mass conservation
  const normFactor = sumAllocated > 0.0 ? qTotal / sumAllocated : 1.0;

  for (let i = 0; i < m; i++) {
    const cfg = stage.clusters[i]!;
    const prev = currentStates[i]!;
    const qi = (qResult[i] ?? nominalRate) * normFactor;
    const share = qTotal > 0.0 ? (qi / qTotal) * 100.0 : 100.0 / m;

    const { pressureDropPascals, perforationVelocity } = calculatePerforationFriction(
      qi,
      cfg.shotCount,
      prev.currentDiameterMeters,
      prev.currentCd,
      slurryDensity,
    );

    // Active if taking at least 40% of nominal average share
    const isActive = qi >= 0.4 * nominalRate;

    updatedClusters.push({
      ...prev,
      allocatedRateM3PerSec: qi,
      rateSharePercent: share,
      perforationVelocityMetersPerSec: perforationVelocity,
      perforationPressureDropPascals: pressureDropPascals,
      isActive,
    });
  }

  return updatedClusters;
}

/**
 * Advances the multi-cluster stage erosion state by one time step dt.
 */
export function stepStageErosion(
  stage: StageCompletionConfig,
  currentSummary: StageErosionSummary,
  totalSlurryRate: number,
  proppantConc: number,
  slurryDensity: number,
  bhtp: number,
  dtSeconds: number,
): StageErosionSummary {
  // 1. Solve instantaneous flow allocation across clusters
  const allocatedClusters = solveCrossClusterFlowSplit(
    totalSlurryRate,
    stage,
    currentSummary.clusters,
    slurryDensity,
    bhtp,
  );

  // 2. Step erosion kinetics for each cluster
  const erodedClusters = allocatedClusters.map((c, i) =>
    stepClusterErosion(c, stage.clusters[i]!, proppantConc, slurryDensity, dtSeconds),
  );

  // 3. Compute stage aggregate metrics
  const activeCount = erodedClusters.filter((c) => c.isActive).length;
  const clusterEfficiency = (activeCount / Math.max(1, stage.clusters.length)) * 100.0;

  const totalPerfFriction = erodedClusters.reduce((sum, c) => sum + c.perforationPressureDropPascals, 0.0);
  const avgPerfFriction = totalPerfFriction / Math.max(1, erodedClusters.length);

  const totalPropDelta = Math.max(0.0, proppantConc) * totalSlurryRate * dtSeconds;

  return {
    timeSeconds: currentSummary.timeSeconds + dtSeconds,
    clusters: erodedClusters,
    clusterEfficiencyPercent: clusterEfficiency,
    averagePerfFrictionPascals: avgPerfFriction,
    totalProppantPumpedKg: currentSummary.totalProppantPumpedKg + totalPropDelta,
  };
}
