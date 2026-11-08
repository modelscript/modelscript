// SPDX-License-Identifier: AGPL-3.0-or-later

import type { AssumeGuaranteeContract } from "@modelscript/sysml2";

export const POWERTRAIN_DEFAULT_SYSTEM: AssumeGuaranteeContract = {
  name: "PowertrainSystemContract",
  assumptions: ["voltage >= 350.0 && voltage <= 420.0", "temp <= 65.0"],
  guarantees: ["torque >= 250.0", "speed <= 160.0"],
};

export const POWERTRAIN_DEFAULT_COMPONENTS: AssumeGuaranteeContract[] = [
  {
    name: "BatterySubsystemContract",
    assumptions: ["temp <= 65.0"],
    guarantees: ["voltage >= 350.0 && voltage <= 420.0", "current <= 200.0"],
  },
  {
    name: "InverterMotorContract",
    assumptions: ["voltage >= 350.0", "current <= 200.0"],
    guarantees: ["torque >= 250.0", "speed <= 160.0"],
  },
];

export const POWERTRAIN_DEFAULT_TRACES = [
  {
    step: 1,
    actor: "Battery",
    event: "powerOn",
    targetActor: "Inverter",
    message: "voltageReady (380V)",
  },
  { step: 2, actor: "Inverter", event: "syncBus", targetActor: "Motor", message: "enableDrive" },
  {
    step: 3,
    actor: "Motor",
    event: "produceTorque",
    targetActor: "Chassis",
    message: "torqueApplied (260Nm)",
  },
  {
    step: 4,
    actor: "Chassis",
    event: "accelerate",
    targetActor: "Sensor",
    message: "speedUpdate (85km/h)",
  },
  {
    step: 5,
    actor: "Sensor",
    event: "telemetryReport",
    targetActor: "Controller",
    message: "allNominal",
  },
];
