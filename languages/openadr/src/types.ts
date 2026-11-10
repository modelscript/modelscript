// SPDX-License-Identifier: AGPL-3.0-or-later

export type OadrEventStatus = "near" | "active" | "completed" | "cancelled";

export type OadrSignalType = "level" | "price" | "setpoint" | "delta" | "multiplier";

export interface OadrInterval {
  start: string;
  durationSeconds: number;
  payload: number;
  line: number;
}

export interface OadrEvent {
  id: string;
  programId?: string | undefined;
  status: OadrEventStatus;
  signalType: OadrSignalType;
  targetVenId?: string | undefined;
  intervals: OadrInterval[];
  line: number;
}

export interface OadrProgram {
  id: string;
  name?: string | undefined;
  events: OadrEvent[];
  line: number;
}

export interface OpenAdrDeck {
  programs: OadrProgram[];
  events: OadrEvent[];
}

export interface CurtailmentSchedulePoint {
  timeSeconds: number;
  activeLimitKW: number;
  signalType: OadrSignalType;
}
