// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, DAEBuilder, EqKind, VarType, Variability } from "@modelscript/runtime";
import {
  CircularTelemetryBuffer,
  CusumDriftDetector,
  MovingHorizonEstimator,
  RulPredictor,
  VirtualSensorSynthesizer,
  type MheResult,
} from "@modelscript/simulate/twin";
import type { LibraryDatabase } from "../../database.js";
import { SocialTwinNotifier } from "./social-twin-notifier.js";

export interface TwinConfig {
  channels: string[]; // e.g. ["T", "speed"]
  mheWindowDuration?: number; // e.g. 4.0 seconds
  mheIntervals?: number; // e.g. 41 points
  parametersToEstimate: string[]; // e.g. ["R_th"]
  parameterBounds?: Record<string, { min?: number; max?: number; prior?: number; regWeight?: number }>;
  driftChannels?: {
    name: string;
    expectedMean?: number;
    expectedStd?: number;
    minShift?: number;
    threshold?: number;
  }[];
  virtualSensors?: {
    id: string;
    name: string;
    unit: string;
    daeVariableName: string;
    alarmThreshold?: number;
  }[];
  rul?: {
    type?: "arrhenius" | "fatigue_miner" | "linear_wear";
    rateConstant?: number;
    activationEnergy?: number;
    criticalDamageThreshold?: number;
  };
}

export interface ActiveTwinSession {
  twinId: number;
  instanceId: number;
  serialNumber: string;
  name: string;
  modelicaClass: string;
  status: string;
  healthScore: number;
  config: TwinConfig;
  arena: DAEBuilder;
  buffer: CircularTelemetryBuffer;
  driftDetector: CusumDriftDetector;
  mhe: MovingHorizonEstimator;
  virtualSensors: VirtualSensorSynthesizer;
  rulPredictor: RulPredictor;
  currentParameters: Record<string, number>;
  lastTelemetryAt: string | null;
  lastAdaptedAt: string | null;
  subscribers: Set<(event: any) => void>;
}

export class TwinManager {
  private sessions = new Map<number, ActiveTwinSession>();

  /**
   * Helper to construct a standard DAE arena for the digital twin model.
   */
  private buildArenaForClass(modelicaClass: string, initialParams: Record<string, number>): DAEBuilder {
    const arena = new DAEBuilder();

    // Inverter Thermal Cooling Loop model:
    // der(T) = (P_loss - (T - T_amb) / R_th) / C_th
    const rTh = initialParams["R_th"] ?? 0.15;
    const pLoss = initialParams["P_loss"] ?? 100.0;
    const cTh = initialParams["C_th"] ?? 20.0;
    const tAmb = initialParams["T_amb"] ?? 25.0;

    const v_T = arena.addVariable("T", VarType.Real, Variability.Continuous, 0, 25.0);
    arena.setVarStartValue(v_T, 25.0);

    const p_Rth = arena.addVariable("R_th", VarType.Real, Variability.Parameter, 0, rTh);
    arena.setVarExpression(p_Rth, arena.addRealLiteral(rTh));

    const p_Ploss = arena.addVariable("P_loss", VarType.Real, Variability.Parameter, 0, pLoss);
    arena.setVarExpression(p_Ploss, arena.addRealLiteral(pLoss));

    const p_Cth = arena.addVariable("C_th", VarType.Real, Variability.Parameter, 0, cTh);
    arena.setVarExpression(p_Cth, arena.addRealLiteral(cTh));

    const p_Tamb = arena.addVariable("T_amb", VarType.Real, Variability.Parameter, 0, tAmb);
    arena.setVarExpression(p_Tamb, arena.addRealLiteral(tAmb));

    const tExpr = arena.addNameExpr("T");
    const derT = arena.addDerExpr(tExpr);
    const pLossExpr = arena.addNameExpr("P_loss");
    const rThExpr = arena.addNameExpr("R_th");
    const cThExpr = arena.addNameExpr("C_th");
    const tAmbExpr = arena.addNameExpr("T_amb");

    const T_minus_Tamb = arena.addBinaryExpr(BinOp.Sub, tExpr, tAmbExpr);
    const q_cooling = arena.addBinaryExpr(BinOp.Div, T_minus_Tamb, rThExpr);
    const net_P = arena.addBinaryExpr(BinOp.Sub, pLossExpr, q_cooling);
    const rhs_derT = arena.addBinaryExpr(BinOp.Div, net_P, cThExpr);
    arena.addEquation(EqKind.Simple, derT, rhs_derT);

    return arena;
  }

  /**
   * Retrieve active in-memory session or instantiate it from the database.
   */
  async getOrCreateSession(twinId: number, db: LibraryDatabase): Promise<ActiveTwinSession> {
    const existing = this.sessions.get(twinId);
    if (existing) {
      return existing;
    }

    const row = db.getTwin(twinId);
    if (!row) {
      throw new Error(`Digital Twin #${twinId} not found in database`);
    }

    let config: TwinConfig;
    try {
      config = JSON.parse(row.config);
    } catch {
      config = {
        channels: ["T"],
        parametersToEstimate: ["R_th"],
      };
    }

    let currentParams: Record<string, number>;
    try {
      currentParams = JSON.parse(row.current_parameters);
    } catch {
      currentParams = { R_th: 0.15, P_loss: 100.0, C_th: 20.0, T_amb: 25.0 };
    }

    const arena = this.buildArenaForClass(row.modelica_class, currentParams);

    const buffer = new CircularTelemetryBuffer({
      numChannels: config.channels.length || 1,
      capacity: 500,
      channelNames: config.channels,
    });

    const driftChannels = config.driftChannels ?? [
      {
        name: config.channels[0] ?? "residual",
        expectedMean: 0.0,
        expectedStd: 0.5,
        minShift: 0.75,
        threshold: 5.0,
      },
    ];
    const driftDetector = new CusumDriftDetector(driftChannels);

    const mhe = new MovingHorizonEstimator({
      problem: { builder: arena },
      parametersToEstimate: config.parametersToEstimate.length > 0 ? config.parametersToEstimate : ["R_th"],
      parameterBounds: config.parameterBounds ?? {
        R_th: { min: 0.05, max: 0.6, prior: currentParams["R_th"] ?? 0.12 },
      },
      regularizationLambda: 1e-5,
      optimizerOptions: { maxIterations: 25, tolerance: 1e-5 },
    });

    for (const [k, v] of Object.entries(currentParams)) {
      mhe.setParameter(k, v);
    }

    const virtualSensors = new VirtualSensorSynthesizer(
      config.virtualSensors ?? [
        {
          id: "inverter_hotspot",
          name: "Inverter Hotspot Temperature",
          unit: "degC",
          daeVariableName: "T",
          alarmThreshold: 85.0,
        },
      ],
    );

    const rulPredictor = new RulPredictor({
      type: config.rul?.type ?? "arrhenius",
      rateConstant: config.rul?.rateConstant ?? 1e-4,
      activationEnergy: config.rul?.activationEnergy ?? 0.7,
      criticalDamageThreshold: config.rul?.criticalDamageThreshold ?? 1.0,
    });

    const session: ActiveTwinSession = {
      twinId,
      instanceId: row.instance_id,
      serialNumber: row.instance_serial ?? "UNKNOWN",
      name: row.name,
      modelicaClass: row.modelica_class,
      status: row.status,
      healthScore: row.health_score,
      config,
      arena,
      buffer,
      driftDetector,
      mhe,
      virtualSensors,
      rulPredictor,
      currentParameters: currentParams,
      lastTelemetryAt: row.last_telemetry_at,
      lastAdaptedAt: row.last_adapted_at,
      subscribers: new Set(),
    };

    this.sessions.set(twinId, session);
    return session;
  }

  /**
   * Subscribe to real-time events on a twin session.
   */
  subscribe(twinId: number, callback: (event: any) => void): () => void {
    const session = this.sessions.get(twinId);
    if (session) {
      session.subscribers.add(callback);
    }
    return () => {
      session?.subscribers.delete(callback);
    };
  }

  /**
   * Broadcast event to all subscribers of a twin.
   */
  broadcast(twinId: number, event: any): void {
    const session = this.sessions.get(twinId);
    if (!session) return;
    for (const cb of session.subscribers) {
      try {
        cb(event);
      } catch (err) {
        console.error(`Error broadcasting twin event:`, err);
      }
    }
  }

  /**
   * Ingest real-time telemetry sample, compute residuals, test for CUSUM drift,
   * and conditionally trigger online adaptation.
   */
  async ingestTelemetry(
    twinId: number,
    timestamp: number,
    channels: number[],
    db: LibraryDatabase,
  ): Promise<{
    timestamp: number;
    driftEvent: any;
    healthScore: number;
    adaptationTriggered: boolean;
  }> {
    const session = await this.getOrCreateSession(twinId, db);

    // 1. Push to circular buffer
    session.buffer.push(timestamp, channels);
    const nowIso = new Date().toISOString();
    session.lastTelemetryAt = nowIso;

    // 2. Innovation residual comparison against expected nominal baseline
    // In an operational twin, residual is y_meas - y_nominal
    const measuredVal = channels[0] ?? 0;
    const rThNom = session.currentParameters["R_th"] ?? 0.12;
    const tau = Math.max(0.1, 20.0 * rThNom);
    const nominalT = 25.0 + 100.0 * rThNom * (1.0 - Math.exp(-timestamp / tau));
    const residual = measuredVal - nominalT;

    // 3. Test sequential CUSUM drift
    const driftEvent = session.driftDetector.update(timestamp, [residual]);
    let adaptationTriggered = false;

    if (driftEvent) {
      session.status = "degraded";
      session.healthScore = Math.max(10.0, session.healthScore - 15.0);

      db.updateTwinState(twinId, {
        status: "degraded",
        healthScore: session.healthScore,
        lastTelemetryAt: nowIso,
      });

      // Automatically trigger MHE calibration on drift (with cooldown to prevent redundant solves on consecutive samples)
      const lastAdaptMs = session.lastAdaptedAt ? Date.parse(session.lastAdaptedAt) : 0;
      const cooldownPassed = Date.now() - lastAdaptMs > 2000;

      if (cooldownPassed) {
        try {
          await this.adaptTwin(twinId, "cusum_drift", db, driftEvent);
          adaptationTriggered = true;
        } catch (err) {
          console.error(`Failed auto-adaptation for twin #${twinId}:`, err);
        }
      }
    } else {
      db.updateTwinState(twinId, {
        lastTelemetryAt: nowIso,
      });
    }

    const payload = {
      type: "telemetry",
      twinId,
      timestamp,
      channels,
      residual,
      healthScore: session.healthScore,
      driftEvent,
    };
    this.broadcast(twinId, payload);

    return {
      timestamp,
      driftEvent,
      healthScore: session.healthScore,
      adaptationTriggered,
    };
  }

  /**
   * Trigger Moving Horizon Estimation (MHE) calibration over the rolling window.
   */
  async adaptTwin(twinId: number, reason: string, db: LibraryDatabase, driftEvent?: any): Promise<MheResult> {
    const session = await this.getOrCreateSession(twinId, db);
    const range = session.buffer.getTimeRange();
    if (!range || range.endTime - range.startTime < 0.2) {
      throw new Error(`Insufficient telemetry in buffer to perform MHE (need at least 0.2s of data)`);
    }

    const duration = session.config.mheWindowDuration ?? 4.0;
    const windowStart = Math.max(range.startTime, range.endTime - duration);
    const numIntervals = session.config.mheIntervals ?? 41;

    const mheWindow = session.buffer.resampleUniform(windowStart, range.endTime, numIntervals);
    const targetNames = session.config.channels;

    const result = session.mhe.estimate(mheWindow, targetNames);

    // Update in-memory parameters
    for (const [k, v] of Object.entries(result.calibratedParameters)) {
      session.currentParameters[k] = Number(v);
    }

    const nowIso = new Date().toISOString();
    session.lastAdaptedAt = nowIso;
    session.status = "active";

    // Insert into twin_adaptations
    const priorParams = JSON.stringify(
      Object.fromEntries(Object.entries(result.parameterDeltas).map(([k, d]: [string, any]) => [k, d.prior])),
    );
    const updatedParams = JSON.stringify(result.calibratedParameters);

    const adaptationId = db.createTwinAdaptation({
      twinId,
      triggerReason: reason,
      priorParameters: priorParams,
      updatedParameters: updatedParams,
      residualBefore: result.lossBefore,
      residualAfter: result.lossAfter,
      iterations: result.iterations,
    });

    db.updateTwinState(twinId, {
      status: "active",
      currentParameters: updatedParams,
      lastAdaptedAt: nowIso,
    });

    // Notify social platform & open Physics PR
    const notifier = new SocialTwinNotifier(db);
    const alertScore = driftEvent?.score ?? 4.5;
    const severity = driftEvent?.severity ?? "medium";

    await notifier.notifyDriftAndOpenProposal({
      twinId,
      twinName: session.name,
      instanceSerial: session.serialNumber,
      modelicaClass: session.modelicaClass,
      channel: session.config.channels[0] ?? "T",
      direction: driftEvent?.direction ?? "positive",
      magnitude: driftEvent?.magnitude ?? 1.5,
      score: alertScore,
      severity,
      timestamp: range.endTime,
      calibratedParameters: result.calibratedParameters,
      parameterDeltas: result.parameterDeltas,
      healthScore: session.healthScore,
      rulHours: 340.0,
      adaptationId,
    });

    this.broadcast(twinId, {
      type: "adapted",
      twinId,
      reason,
      calibratedParameters: result.calibratedParameters,
      parameterDeltas: result.parameterDeltas,
      lossBefore: result.lossBefore,
      lossAfter: result.lossAfter,
    });

    return result;
  }

  /**
   * Forecast Remaining Useful Life (RUL) under projected mission profile.
   */
  async predictPrognostics(
    twinId: number,
    dutyStressTempK: number = 343.15,
    currentDamage: number = 0.35,
    db: LibraryDatabase,
  ) {
    const session = await this.getOrCreateSession(twinId, db);
    const forecast = session.rulPredictor.predictRul(currentDamage, dutyStressTempK, 0.15);
    return {
      twinId,
      dutyStressTempK,
      currentDamage: forecast.currentDamage,
      healthScore: forecast.healthScore,
      rulHoursP10: forecast.rulP10 / 3600,
      rulHoursP50: forecast.rulP50 / 3600,
      rulHoursP90: forecast.rulP90 / 3600,
      projectedFailureDurationHours: forecast.projectedFailureDuration / 3600,
    };
  }
}

export const twinManager = new TwinManager();
