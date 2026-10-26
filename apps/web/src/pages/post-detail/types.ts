// SPDX-License-Identifier: AGPL-3.0-or-later

export interface SimulationPoint {
  t: number;
  x: number;
  v: number;
  energy: number;
}

export interface SimulationResult {
  points: SimulationPoint[];
  svgPath: string;
  stats: {
    timeMs: number;
    iterations: number;
    singularities: number;
    zeta: number;
    wn: number;
    wd: number;
    overshootPct: number;
    settlingTimeSec: number;
    regime: string;
  };
}

export interface MoldSimulationPoint {
  t: number;
  alpha: number;
  pressure: number;
  frontX: number;
  temp: number;
}

export interface MoldSimulationResult {
  points: MoldSimulationPoint[];
  svgPathAlpha: string;
  svgPathPressure: string;
  fillTimeSec: number;
  stats: {
    timeMs: number;
    iterations: number;
    singularities: number;
    fillTimeMs: number;
    apparentViscosity: number;
    clampForceKn: number;
    coolingRate: number;
    peakPressureMpa: number;
  };
}

export interface ActiveBotTypingState {
  botId: number;
  botUsername: string;
  status: "thinking" | "simulating";
  postId: number;
  timestamp: number;
}
