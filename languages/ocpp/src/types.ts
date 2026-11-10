// SPDX-License-Identifier: AGPL-3.0-or-later

export type ChargingProfilePurposeType =
  | "ChargePointMaxProfile"
  | "TxDefaultProfile"
  | "TxProfile";

export type ChargingRateUnitType = "W" | "kW" | "A";

export interface ChargingSchedulePeriod {
  startPeriod: number; // seconds from schedule start
  limit: number; // power in kW (or W/A)
  numberPhases?: number | undefined;
}

export interface ChargingSchedule {
  id: number;
  durationSeconds?: number | undefined;
  chargingRateUnit: ChargingRateUnitType;
  chargingSchedulePeriod: ChargingSchedulePeriod[];
  minChargingRate?: number | undefined;
}

export interface ChargingProfile {
  id: number;
  stackLevel: number;
  chargingProfilePurpose: ChargingProfilePurposeType;
  chargingSchedule: ChargingSchedule;
}

export interface ChargingSession {
  transactionId: string;
  evBatteryCapacityKWh: number;
  currentSoC: number; // 0.0 to 1.0
  targetSoC: number; // 0.0 to 1.0
  departureMinutes: number;
  allocatedPowerKW?: number | undefined;
}

export type ConnectorStatus =
  | "Available"
  | "Occupied"
  | "Charging"
  | "SuspendedEV"
  | "SuspendedEVSE"
  | "Finishing"
  | "Reserved"
  | "Unavailable"
  | "Faulted";

export interface Connector {
  id: number;
  type: string;
  maxPowerKW: number;
  status: ConnectorStatus;
  currentSession?: ChargingSession | undefined;
  line: number;
}

export interface Evse {
  id: number;
  connectors: Connector[];
  line: number;
}

export interface ChargingStation {
  id: string;
  model?: string | undefined;
  vendor?: string | undefined;
  gridLimitKW: number;
  evses: Evse[];
  chargingProfiles?: ChargingProfile[] | undefined;
  line: number;
}

export interface OcppNetwork {
  stations: ChargingStation[];
}

export interface AllocationResult {
  stationId: string;
  evseId: number;
  connectorId: number;
  transactionId: string;
  allocatedPowerKW: number;
  energyRequiredKWh: number;
  estimatedTimeToTargetMinutes: number;
}
