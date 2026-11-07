// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BinOp,
  DAEBuilder,
  EqKind,
  ExprKind,
  VarType,
  Variability,
  evaluateArenaExpression,
} from "@modelscript/runtime";
import {
  CircularTelemetryBuffer,
  CusumDriftDetector,
  MovingHorizonEstimator,
  RulPredictor,
  VirtualSensorSynthesizer,
  type MheResult,
} from "@modelscript/simulate/twin";
import type { LibraryDatabase } from "../../database.js";
import { compileAndFlattenModelicaSource } from "../studies/study-execution-service.js";
import { SocialTwinNotifier } from "./social-twin-notifier.js";

export interface TwinConfig {
  channels: string[]; // e.g. ["T", "speed"]
  modelCode?: string | undefined; // Optional inline Modelica source for custom DAE compilation
  mheWindowDuration?: number | undefined; // e.g. 4.0 seconds
  mheIntervals?: number | undefined; // e.g. 41 points
  parametersToEstimate: string[]; // e.g. ["R_th"]
  parameterBounds?:
    | Record<
        string,
        {
          min?: number | undefined;
          max?: number | undefined;
          prior?: number | undefined;
          regWeight?: number | undefined;
        }
      >
    | undefined;
  driftChannels?:
    | {
        name: string;
        expectedMean?: number | undefined;
        expectedStd?: number | undefined;
        minShift?: number | undefined;
        threshold?: number | undefined;
      }[]
    | undefined;
  virtualSensors?:
    | {
        id: string;
        name: string;
        unit: string;
        daeVariableName: string;
        alarmThreshold?: number | undefined;
      }[]
    | undefined;
  rul?:
    | {
        type?: "arrhenius" | "fatigue_miner" | "linear_wear" | undefined;
        rateConstant?: number | undefined;
        activationEnergy?: number | undefined;
        criticalDamageThreshold?: number | undefined;
      }
    | undefined;
}

export type TwinDomain = "thermal" | "rotational" | "electrical";

export interface ActiveTwinSession {
  twinId: number;
  instanceId: number;
  serialNumber: string;
  name: string;
  modelicaClass: string;
  domain: TwinDomain;
  status: string;
  healthScore: number;
  config: TwinConfig;
  arena: DAEBuilder;
  derEquations: { stateName: string; rhsExpr: number }[];
  algEquations: { varName: string; rhsExpr: number }[];
  initialNominalState: Record<string, number>;
  nominalState: Record<string, number>;
  lastSimTimestamp: number | null;
  buffer: CircularTelemetryBuffer;
  driftDetector: CusumDriftDetector;
  mhe: MovingHorizonEstimator;
  virtualSensors: VirtualSensorSynthesizer;
  rulPredictor: RulPredictor;
  currentParameters: Record<string, number>;
  lastTelemetryAt: string | null;
  lastAdaptedAt: string | null;
  lastAccessedAt: number;
  subscribers: Set<(event: Record<string, unknown>) => void>;
}

export class TwinManager {
  private sessions = new Map<number, ActiveTwinSession>();
  private readonly maxIdleMs = 30 * 60 * 1000;

  /**
   * Evict idle twin sessions without active SSE subscribers and dispose their DAEBuilder arenas.
   */
  public evictIdleSessions(maxIdleMs: number = this.maxIdleMs): number {
    const now = Date.now();
    let evicted = 0;
    for (const [id, session] of this.sessions.entries()) {
      if (session.subscribers.size === 0 && now - session.lastAccessedAt > maxIdleMs) {
        try {
          (session.arena as { dispose?: () => void }).dispose?.();
        } catch {}
        this.sessions.delete(id);
        evicted++;
      }
    }
    return evicted;
  }

  /**
   * Detect the engineering domain of a digital twin from its class name, parameters, and channels.
   */
  private detectDomain(
    modelicaClass: string,
    initialParams: Record<string, number>,
    channels: string[] = [],
  ): TwinDomain {
    if ("R_th" in initialParams || "C_th" in initialParams || channels.includes("T")) {
      return "thermal";
    }
    const cls = modelicaClass.toLowerCase();
    if (
      "J" in initialParams ||
      "b" in initialParams ||
      cls.includes("rotational") ||
      cls.includes("drivetrain") ||
      cls.includes("rotor") ||
      channels.includes("w") ||
      channels.includes("omega")
    ) {
      return "rotational";
    }
    if (
      "C" in initialParams ||
      "V_in" in initialParams ||
      cls.includes("electrical") ||
      cls.includes("circuit") ||
      cls.includes("battery") ||
      channels.includes("v")
    ) {
      return "electrical";
    }
    return "thermal";
  }

  /**
   * Helper to construct a DAE arena for the digital twin model, compiling Modelica source
   * when provided or constructing the canonical domain DAE.
   */
  private buildArenaForClass(
    modelicaClass: string,
    initialParams: Record<string, number>,
    channels: string[] = [],
    modelCode?: string,
  ): DAEBuilder {
    const candidateSource =
      modelCode && modelCode.trim().length > 0
        ? modelCode
        : /\b(?:model|class|block)\s+[A-Za-z_]/.test(modelicaClass)
          ? modelicaClass
          : undefined;

    if (candidateSource) {
      const compiled = compileAndFlattenModelicaSource(candidateSource);
      if (compiled && compiled.arena.varCount > 0 && compiled.arena.eqCount > 0) {
        const compiledArena = compiled.arena;
        compiledArena.isMutatedBySim = false;
        for (const [paramName, paramVal] of Object.entries(initialParams)) {
          if (typeof paramVal !== "number") continue;
          const vIdx = compiledArena.getVarIdxByName(paramName);
          if (vIdx >= 0) {
            compiledArena.setVarStartValue(vIdx, paramVal);
            compiledArena.setVarExpression(vIdx, compiledArena.addRealLiteral(paramVal));
          } else {
            const pIdx = compiledArena.addVariable(paramName, VarType.Real, Variability.Parameter, 0, paramVal);
            compiledArena.setVarExpression(pIdx, compiledArena.addRealLiteral(paramVal));
          }
        }
        return compiledArena;
      }
    }

    const arena = new DAEBuilder();
    const domain = this.detectDomain(modelicaClass, initialParams, channels);

    if (domain === "rotational") {
      // Rotational Drivetrain / Inertia-Damper model:
      // der(w) = (tau_load - b * w) / J
      const stateName = channels[0] && channels[0] !== "T" ? channels[0] : "w";
      const jVal = initialParams["J"] ?? 0.25;
      const bVal = initialParams["b"] ?? 0.05;
      const tauVal = initialParams["tau_load"] ?? initialParams["tau"] ?? 10.0;

      const vW = arena.addVariable(stateName, VarType.Real, Variability.Continuous, 0, 0.0);
      arena.setVarStartValue(vW, 0.0);

      const pJ = arena.addVariable("J", VarType.Real, Variability.Parameter, 0, jVal);
      arena.setVarExpression(pJ, arena.addRealLiteral(jVal));
      const pB = arena.addVariable("b", VarType.Real, Variability.Parameter, 0, bVal);
      arena.setVarExpression(pB, arena.addRealLiteral(bVal));
      const pTau = arena.addVariable("tau_load", VarType.Real, Variability.Parameter, 0, tauVal);
      arena.setVarExpression(pTau, arena.addRealLiteral(tauVal));

      const builtInNames = new Set([stateName, "J", "b", "tau_load"]);
      for (const [paramName, paramVal] of Object.entries(initialParams)) {
        if (!builtInNames.has(paramName) && typeof paramVal === "number") {
          const pIdx = arena.addVariable(paramName, VarType.Real, Variability.Parameter, 0, paramVal);
          arena.setVarExpression(pIdx, arena.addRealLiteral(paramVal));
          builtInNames.add(paramName);
        }
      }
      for (const ch of channels) {
        if (!builtInNames.has(ch)) {
          const chIdx = arena.addVariable(ch, VarType.Real, Variability.Continuous, 0, 0.0);
          arena.setVarStartValue(chIdx, 0.0);
          builtInNames.add(ch);
        }
      }

      const wExpr = arena.addNameExpr(stateName);
      const derW = arena.addDerExpr(wExpr);
      const tauExpr = arena.addNameExpr("tau_load");
      const bExpr = arena.addNameExpr("b");
      const jExpr = arena.addNameExpr("J");

      const dampingTorque = arena.addBinaryExpr(BinOp.Mul, bExpr, wExpr);
      const netTorque = arena.addBinaryExpr(BinOp.Sub, tauExpr, dampingTorque);
      const rhsDerW = arena.addBinaryExpr(BinOp.Div, netTorque, jExpr);
      arena.addEquation(EqKind.Simple, derW, rhsDerW);
      return arena;
    }

    if (domain === "electrical") {
      // Electrical RC / Bus Voltage model:
      // der(v) = (V_in - v) / (R * C)
      const stateName = channels[0] && channels[0] !== "T" ? channels[0] : "v";
      const rVal = initialParams["R"] ?? 2.0;
      const cVal = initialParams["C"] ?? 0.5;
      const vInVal = initialParams["V_in"] ?? 48.0;

      const vState = arena.addVariable(stateName, VarType.Real, Variability.Continuous, 0, 0.0);
      arena.setVarStartValue(vState, 0.0);

      const pR = arena.addVariable("R", VarType.Real, Variability.Parameter, 0, rVal);
      arena.setVarExpression(pR, arena.addRealLiteral(rVal));
      const pC = arena.addVariable("C", VarType.Real, Variability.Parameter, 0, cVal);
      arena.setVarExpression(pC, arena.addRealLiteral(cVal));
      const pVin = arena.addVariable("V_in", VarType.Real, Variability.Parameter, 0, vInVal);
      arena.setVarExpression(pVin, arena.addRealLiteral(vInVal));

      const builtInNames = new Set([stateName, "R", "C", "V_in"]);
      for (const [paramName, paramVal] of Object.entries(initialParams)) {
        if (!builtInNames.has(paramName) && typeof paramVal === "number") {
          const pIdx = arena.addVariable(paramName, VarType.Real, Variability.Parameter, 0, paramVal);
          arena.setVarExpression(pIdx, arena.addRealLiteral(paramVal));
          builtInNames.add(paramName);
        }
      }
      for (const ch of channels) {
        if (!builtInNames.has(ch)) {
          const chIdx = arena.addVariable(ch, VarType.Real, Variability.Continuous, 0, 0.0);
          arena.setVarStartValue(chIdx, 0.0);
          builtInNames.add(ch);
        }
      }

      const vExpr = arena.addNameExpr(stateName);
      const derV = arena.addDerExpr(vExpr);
      const vInExpr = arena.addNameExpr("V_in");
      const rExpr = arena.addNameExpr("R");
      const cExpr = arena.addNameExpr("C");

      const vDiff = arena.addBinaryExpr(BinOp.Sub, vInExpr, vExpr);
      const rc = arena.addBinaryExpr(BinOp.Mul, rExpr, cExpr);
      const rhsDerV = arena.addBinaryExpr(BinOp.Div, vDiff, rc);
      arena.addEquation(EqKind.Simple, derV, rhsDerV);
      return arena;
    }

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

    // Register any additional custom parameters supplied for the twin class
    const builtInNames = new Set(["T", "R_th", "P_loss", "C_th", "T_amb"]);
    for (const [paramName, paramVal] of Object.entries(initialParams)) {
      if (!builtInNames.has(paramName) && typeof paramVal === "number") {
        const pIdx = arena.addVariable(paramName, VarType.Real, Variability.Parameter, 0, paramVal);
        arena.setVarExpression(pIdx, arena.addRealLiteral(paramVal));
        builtInNames.add(paramName);
      }
    }

    for (const ch of channels) {
      if (!builtInNames.has(ch)) {
        const chIdx = arena.addVariable(ch, VarType.Real, Variability.Continuous, 0, 0.0);
        arena.setVarStartValue(chIdx, 0.0);
        builtInNames.add(ch);
      }
    }

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
   * Extracts ODE derivative (`der(x) = rhs`) and algebraic (`y = rhs`) equations
   * along with continuous variable initial values from a `DAEBuilder` arena.
   */
  private extractArenaEquations(arena: DAEBuilder): {
    derEquations: { stateName: string; rhsExpr: number }[];
    algEquations: { varName: string; rhsExpr: number }[];
    initialState: Record<string, number>;
  } {
    const derEquations: { stateName: string; rhsExpr: number }[] = [];
    const algEquations: { varName: string; rhsExpr: number }[] = [];
    const initialState: Record<string, number> = {};

    for (let i = 0; i < arena.varCount; i++) {
      if (arena.isVarRemoved(i)) continue;
      const v = arena.getVarVariability(i);
      if (v === Variability.Parameter || v === Variability.Constant) continue;
      const name = arena.getVarName(i);
      if (name && !name.startsWith("der(")) {
        initialState[name] = arena.getVarStartValue(i);
      }
    }

    for (let eqIdx = 0; eqIdx < arena.eqCount; eqIdx++) {
      if (arena.getEqKind(eqIdx) !== EqKind.Simple) continue;
      const lhs = arena.getEqLhs(eqIdx);
      const rhs = arena.getEqRhs(eqIdx);
      if (lhs < 0 || rhs < 0) continue;

      const lhsKind = arena.getExprKind(lhs);
      if (lhsKind === ExprKind.Der) {
        const d1 = arena.getExprData1(lhs);
        const argExpr = d1 >= 0 && d1 < arena.exprCount ? d1 : arena.getExprLeft(lhs);
        if (argExpr >= 0 && argExpr < arena.exprCount && arena.getExprKind(argExpr) === ExprKind.Name) {
          const stateName = arena.interner.resolve(arena.getExprData1(argExpr));
          if (stateName) {
            derEquations.push({ stateName, rhsExpr: rhs });
            if (!(stateName in initialState)) {
              const vIdx = arena.getVarIdxByName(stateName);
              initialState[stateName] = vIdx >= 0 ? arena.getVarStartValue(vIdx) : 0;
            }
          }
        }
      } else if (lhsKind === ExprKind.Name) {
        const varName = arena.interner.resolve(arena.getExprData1(lhs));
        if (varName) {
          algEquations.push({ varName, rhsExpr: rhs });
        }
      }
    }

    return { derEquations, algEquations, initialState };
  }

  /**
   * Steps the session's nominal DAE arena state forward to `targetTimestamp` using
   * 4th-order Runge-Kutta (RK4) integration over the arena's derivative equations.
   */
  private stepNominalArenaState(session: ActiveTwinSession, targetTimestamp: number): number {
    const primaryChannel = session.config.channels[0] ?? "T";

    if (session.lastSimTimestamp === null || targetTimestamp < session.lastSimTimestamp) {
      session.nominalState = { ...session.initialNominalState };
      session.lastSimTimestamp = 0.0;
    }

    const totalDt = targetTimestamp - session.lastSimTimestamp;
    const evalRhs = (t: number, stateMap: Record<string, number>): Record<string, number> => {
      const env = new Map<string, number>();
      env.set("time", t);
      for (const [k, v] of Object.entries(session.currentParameters)) {
        if (typeof v === "number" && Number.isFinite(v)) env.set(k, v);
      }
      for (const [k, v] of Object.entries(stateMap)) {
        if (typeof v === "number" && Number.isFinite(v)) env.set(k, v);
      }
      for (const alg of session.algEquations) {
        const val = evaluateArenaExpression(session.arena, alg.rhsExpr, env);
        if (typeof val === "number" && Number.isFinite(val)) {
          env.set(alg.varName, val);
          stateMap[alg.varName] = val;
        }
      }
      const derivs: Record<string, number> = {};
      for (const deq of session.derEquations) {
        const dVal = evaluateArenaExpression(session.arena, deq.rhsExpr, env);
        derivs[deq.stateName] = typeof dVal === "number" && Number.isFinite(dVal) ? dVal : 0.0;
      }
      return derivs;
    };

    if (totalDt > 0 && session.derEquations.length > 0) {
      const subSteps = Math.min(64, Math.max(4, Math.ceil(totalDt / 0.02)));
      const h = totalDt / subSteps;
      let t = session.lastSimTimestamp;

      for (let s = 0; s < subSteps; s++) {
        const y0 = { ...session.nominalState };
        const k1 = evalRhs(t, y0);

        const y1: Record<string, number> = { ...y0 };
        for (const deq of session.derEquations) {
          const name = deq.stateName;
          y1[name] = (y0[name] ?? 0) + 0.5 * h * (k1[name] ?? 0);
        }
        const k2 = evalRhs(t + 0.5 * h, y1);

        const y2: Record<string, number> = { ...y0 };
        for (const deq of session.derEquations) {
          const name = deq.stateName;
          y2[name] = (y0[name] ?? 0) + 0.5 * h * (k2[name] ?? 0);
        }
        const k3 = evalRhs(t + 0.5 * h, y2);

        const y3: Record<string, number> = { ...y0 };
        for (const deq of session.derEquations) {
          const name = deq.stateName;
          y3[name] = (y0[name] ?? 0) + h * (k3[name] ?? 0);
        }
        const k4 = evalRhs(t + h, y3);

        for (const deq of session.derEquations) {
          const name = deq.stateName;
          session.nominalState[name] =
            (y0[name] ?? 0) +
            (h / 6.0) * ((k1[name] ?? 0) + 2 * (k2[name] ?? 0) + 2 * (k3[name] ?? 0) + (k4[name] ?? 0));
        }
        t += h;
      }
    }

    evalRhs(targetTimestamp, session.nominalState);
    session.lastSimTimestamp = targetTimestamp;

    if (primaryChannel in session.nominalState) {
      return session.nominalState[primaryChannel]!;
    }
    const firstState = session.derEquations[0]?.stateName;
    return firstState ? (session.nominalState[firstState] ?? 0) : 0;
  }

  /**
   * Retrieve active in-memory session or instantiate it from the database.
   */
  async getOrCreateSession(twinId: number, db: LibraryDatabase): Promise<ActiveTwinSession> {
    this.evictIdleSessions();
    const existing = this.sessions.get(twinId);
    if (existing) {
      existing.lastAccessedAt = Date.now();
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

    const domain = this.detectDomain(row.modelica_class, currentParams, config.channels);
    const arena = this.buildArenaForClass(row.modelica_class, currentParams, config.channels, config.modelCode);
    const { derEquations, algEquations, initialState } = this.extractArenaEquations(arena);

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
      domain,
      status: row.status,
      healthScore: row.health_score,
      config,
      arena,
      derEquations,
      algEquations,
      initialNominalState: { ...initialState },
      nominalState: { ...initialState },
      lastSimTimestamp: null,
      buffer,
      driftDetector,
      mhe,
      virtualSensors,
      rulPredictor,
      currentParameters: currentParams,
      lastTelemetryAt: row.last_telemetry_at,
      lastAdaptedAt: row.last_adapted_at,
      lastAccessedAt: Date.now(),
      subscribers: new Set(),
    };

    this.sessions.set(twinId, session);
    return session;
  }

  /**
   * Subscribe to real-time events on a twin session.
   */
  subscribe(twinId: number, callback: (event: Record<string, unknown>) => void): () => void {
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
  broadcast(twinId: number, event: Record<string, unknown>): void {
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
   * Ingest real-time telemetry sample, compute residuals by stepping the DAE state forward in time,
   * test for CUSUM drift, and conditionally trigger online adaptation.
   */
  async ingestTelemetry(
    twinId: number,
    timestamp: number,
    channels: number[],
    db: LibraryDatabase,
    skipDbUpdate: boolean = false,
  ): Promise<{
    timestamp: number;
    driftEvent: ReturnType<CusumDriftDetector["update"]>;
    healthScore: number;
    adaptationTriggered: boolean;
  }> {
    const session = await this.getOrCreateSession(twinId, db);

    // 1. Push to circular buffer
    session.buffer.push(timestamp, channels);
    const nowIso = new Date().toISOString();
    session.lastTelemetryAt = nowIso;

    // 2. Innovation residual comparison by stepping the DAE arena state forward over dt
    const measuredVal = channels[0] ?? 0;
    const nominalVal = this.stepNominalArenaState(session, timestamp);
    const residual = measuredVal - nominalVal;

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
    } else if (!skipDbUpdate) {
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
  async adaptTwin(
    twinId: number,
    reason: string,
    db: LibraryDatabase,
    driftEvent?:
      | (NonNullable<ReturnType<CusumDriftDetector["update"]>> & { magnitude?: number | undefined })
      | undefined,
  ): Promise<MheResult> {
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
      Object.fromEntries(
        Object.entries(result.parameterDeltas).map(([k, d]: [string, { prior: number }]) => [k, d.prior]),
      ),
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
    const rawSeverity = driftEvent?.severity;
    const severity: "low" | "medium" | "high" =
      rawSeverity === "low" || rawSeverity === "high" ? rawSeverity : "medium";

    const driftMagnitude = driftEvent?.magnitude ?? 1.5;
    const estimatedDamage = Math.min(0.95, Math.max(0.05, 1 - session.healthScore / 100));
    const rulForecast = session.rulPredictor.predictRul(
      estimatedDamage,
      343.15 + Math.max(0, driftMagnitude) * 2,
      Math.max(0.05, Math.abs(driftMagnitude) * 0.1),
    );
    const rulMedianHours = rulForecast.rulP50 / 3600;
    const computedRulHours =
      Number.isFinite(rulMedianHours) && rulMedianHours > 0
        ? Math.round(rulMedianHours * 10) / 10
        : Math.max(10, Math.round((500 / Math.max(0.1, Math.abs(driftMagnitude))) * 10) / 10);

    await notifier.notifyDriftAndOpenProposal({
      twinId,
      twinName: session.name,
      instanceSerial: session.serialNumber,
      modelicaClass: session.modelicaClass,
      channel: session.config.channels[0] ?? "T",
      direction: driftEvent?.direction ?? "positive",
      magnitude: driftMagnitude,
      score: alertScore,
      severity,
      timestamp: range.endTime,
      calibratedParameters: result.calibratedParameters,
      parameterDeltas: result.parameterDeltas,
      healthScore: session.healthScore,
      rulHours: computedRulHours,
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
