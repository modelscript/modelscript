// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Telecom Central Office -48V DC Microgrid Transient Simulation.
 */

export interface MicrogridState {
  time: number;
  gridAvailable: boolean;
  atsGeneratorConnected: boolean;
  vDcBus: number;
  iRectifier: number;
  iBattery: number;
  iLoad: number;
  soc: number;
}

export function simulateTelecomMicrogrid(totalDurationSeconds = 20.0, dt = 0.1): MicrogridState[] {
  const tGridLoss = 2.0;
  const tGenStart = 12.0;
  const pLoad = 15000.0;
  const batteryAh = 2000.0;

  const states: MicrogridState[] = [];
  let soc = 1.0;

  for (let t = 0; t <= totalDurationSeconds + 1e-6; t += dt) {
    const gridAvailable = t < tGridLoss;
    const atsGeneratorConnected = t >= tGenStart;
    const powerSourceAvailable = gridAvailable || atsGeneratorConnected;

    let vDcBus: number;
    let iRectifier: number;
    let iBattery: number;

    if (powerSourceAvailable) {
      vDcBus = -54.0;
      iRectifier = -(pLoad / 54.0);
      iBattery = 0.0;
    } else {
      // Iterative solution for non-linear load and battery voltage
      // V_bat = -(48.0 - 0.005 * i_bat - 4.0 * (1 - soc))
      // i_bat = pLoad / |V_bat|
      let vEst = -48.0;
      for (let iter = 0; iter < 5; iter++) {
        const iEst = pLoad / Math.abs(vEst);
        vEst = -(48.0 - 0.005 * iEst - 4.0 * (1.0 - soc));
      }
      vDcBus = vEst;
      iRectifier = 0.0;
      iBattery = pLoad / Math.abs(vDcBus);
    }

    const iLoad = pLoad / Math.abs(vDcBus);

    // Update SOC: der(soc) = -iBattery / (batteryAh * 3600)
    soc -= (iBattery * dt) / (batteryAh * 3600.0);
    soc = Math.max(0.0, Math.min(1.0, soc));

    states.push({
      time: Math.round(t * 100) / 100,
      gridAvailable,
      atsGeneratorConnected,
      vDcBus,
      iRectifier,
      iBattery,
      iLoad,
      soc,
    });
  }

  return states;
}

if (import.meta.url.endsWith(process.argv[1] ?? "")) {
  const trajectory = simulateTelecomMicrogrid(20.0, 0.5);
  console.log("Telecom Central Office Microgrid Simulation (t=0 to 20s):");
  console.log("Time (s) | Bus Voltage (V) | Battery Current (A) | Rectifier (A) | SOC (%)");
  console.log("---------+-----------------+---------------------+---------------+--------");
  for (const s of trajectory) {
    if (s.time % 2.0 === 0) {
      console.log(
        `${s.time.toFixed(1).padStart(7)} | ${s.vDcBus.toFixed(2).padStart(15)} | ${s.iBattery.toFixed(1).padStart(19)} | ${s.iRectifier.toFixed(1).padStart(13)} | ${(s.soc * 100).toFixed(2).padStart(6)}%`,
      );
    }
  }
}
