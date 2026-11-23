// SPDX-License-Identifier: AGPL-3.0-or-later

import type { TrnsysDeck, TrnsysUnit, TrnsysValue } from "../types.js";

function numParam(unit: TrnsysUnit, idx: number, fallback: number): number {
  const p: TrnsysValue | undefined = unit.parameters[idx];
  return p && p.kind === "number" && Number.isFinite(p.value) ? p.value : fallback;
}

/**
 * Projects a parsed `TrnsysDeck` into an EnergyPlus Input Data File (IDF).
 */
export function trnsysToEnergyPlus(deck: TrnsysDeck): string {
  const lines: string[] = [];
  const dtHours = deck.simulation?.dt ?? 1.0;
  const stepsPerHour = Math.max(1, Math.min(60, Math.round(1.0 / Math.max(1 / 60, dtHours))));

  lines.push(`!- Projected from TRNSYS deck '${deck.name}'`);
  lines.push("");
  lines.push("Version,");
  lines.push("  24.1;                                   !- Version Identifier");
  lines.push("");
  lines.push("SimulationControl,");
  lines.push("  No,                                     !- Do Zone Sizing Calculation");
  lines.push("  No,                                     !- Do System Sizing Calculation");
  lines.push("  No,                                     !- Do Plant Sizing Calculation");
  lines.push("  No,                                     !- Run Simulation for Sizing Periods");
  lines.push("  Yes;                                    !- Run Simulation for Weather File Run Periods");
  lines.push("");
  lines.push("Timestep,");
  lines.push(`  ${stepsPerHour};                                      !- Number of Timesteps per Hour`);
  lines.push("");

  for (const unit of deck.units) {
    const tag = unit.label ? `${unit.label}_U${unit.unitNumber}` : `UNIT_${unit.unitNumber}`;
    switch (unit.typeNumber) {
      case 1: {
        const area = numParam(unit, 0, 4.0);
        const frTauAlpha = numParam(unit, 2, 0.75);
        // Convert kJ/(h.m2.K) -> W/(m2.K) by dividing by 3.6
        const frUlW = numParam(unit, 3, 15.0) / 3.6;
        lines.push("SolarCollectorPerformance:FlatPlate,");
        lines.push(`  ${tag}_Perf,                            !- Name`);
        lines.push(`  ${area.toFixed(4)},                     !- Gross Area {m2}`);
        lines.push("  Water,                                  !- Test Fluid");
        lines.push("  0.00005,                                !- Test Flow Rate {m3/s}");
        lines.push("  Inlet,                                  !- Test Correlation Type");
        lines.push(`  ${frTauAlpha.toFixed(4)},               !- Coefficient 1 of Efficiency Equation`);
        lines.push(`  ${(-frUlW).toFixed(4)},                 !- Coefficient 2 of Efficiency Equation {W/m2-K}`);
        lines.push("  0.0;                                    !- Coefficient 3 of Efficiency Equation {W/m2-K2}");
        lines.push("");
        lines.push("SolarCollector:FlatPlate:Water,");
        lines.push(`  ${tag},                                 !- Name`);
        lines.push(`  ${tag}_Perf,                            !- SolarCollectorPerformance Name`);
        lines.push(`  ${tag}_Surface,                         !- Surface Name`);
        lines.push(`  ${tag}_Inlet,                           !- Inlet Node Name`);
        lines.push(`  ${tag}_Outlet;                          !- Outlet Node Name`);
        lines.push("");
        break;
      }

      case 3: {
        const mDotMaxKgH = numParam(unit, 0, 200.0);
        const flowM3s = mDotMaxKgH / (3600.0 * 1000.0);
        const powerW = numParam(unit, 2, 180.0) / 3.6;
        lines.push("Pump:ConstantSpeed,");
        lines.push(`  ${tag},                                 !- Name`);
        lines.push(`  ${tag}_Inlet,                           !- Inlet Node Name`);
        lines.push(`  ${tag}_Outlet,                          !- Outlet Node Name`);
        lines.push(`  ${flowM3s.toFixed(6)},                  !- Design Flow Rate {m3/s}`);
        lines.push("  15000.0,                                !- Design Pump Head {Pa}");
        lines.push(`  ${powerW.toFixed(2)},                   !- Design Power Consumption {W}`);
        lines.push("  0.9;                                    !- Motor Efficiency");
        lines.push("");
        break;
      }

      case 4: {
        const vol = numParam(unit, 0, 0.3);
        const uLossW = numParam(unit, 3, 1.5) / 3.6;
        const height = numParam(unit, 4, 1.5);
        lines.push("WaterHeater:Stratified,");
        lines.push(`  ${tag},                                 !- Name`);
        lines.push("  SolarThermal,                           !- End-Use Subcategory");
        lines.push(`  ${vol.toFixed(4)},                      !- Tank Volume {m3}`);
        lines.push(`  ${height.toFixed(3)},                   !- Tank Height {m}`);
        lines.push("  VerticalCylinder,                       !- Tank Shape");
        lines.push("  ,                                       !- Tank Perimeter {m}");
        lines.push("  95.0,                                   !- Maximum Temperature Limit {C}");
        lines.push("  MasterSlave,                            !- Heater Priority Control");
        lines.push("  ,                                       !- Heater 1 Setpoint Temperature Schedule Name");
        lines.push("  2.0,                                    !- Heater 1 Deadband Temperature Difference {deltaC}");
        lines.push("  0.0,                                    !- Heater 1 Capacity {W}");
        lines.push("  0.0,                                    !- Heater 1 Height {m}");
        lines.push("  ,                                       !- Heater 2 Setpoint Temperature Schedule Name");
        lines.push("  2.0,                                    !- Heater 2 Deadband Temperature Difference {deltaC}");
        lines.push("  0.0,                                    !- Heater 2 Capacity {W}");
        lines.push("  0.0,                                    !- Heater 2 Height {m}");
        lines.push("  Electricity,                            !- Heater Fuel Type");
        lines.push("  1.0,                                    !- Heater Thermal Efficiency");
        lines.push("  0.0,                                    !- Off Cycle Parasitic Fuel Consumption Rate {W}");
        lines.push("  Electricity,                            !- Off Cycle Parasitic Fuel Type");
        lines.push("  0.0,                                    !- Off Cycle Parasitic Heat Fraction to Tank");
        lines.push("  0.0,                                    !- Off Cycle Parasitic Height {m}");
        lines.push("  0.0,                                    !- On Cycle Parasitic Fuel Consumption Rate {W}");
        lines.push("  Electricity,                            !- On Cycle Parasitic Fuel Type");
        lines.push("  0.0,                                    !- On Cycle Parasitic Heat Fraction to Tank");
        lines.push("  0.0,                                    !- On Cycle Parasitic Height {m}");
        lines.push("  Schedule,                               !- Ambient Temperature Indicator");
        lines.push("  AmbientTempSched,                       !- Ambient Temperature Schedule Name");
        lines.push("  ,                                       !- Ambient Temperature Zone Name");
        lines.push("  ,                                       !- Ambient Temperature Outdoor Air Node Name");
        lines.push(
          `  ${uLossW.toFixed(4)};                   !- Uniform Skin Loss Coefficient per Unit Area to Ambient Temperature {W/m2-K}`,
        );
        lines.push("");
        break;
      }

      case 14: {
        lines.push("Schedule:Compact,");
        lines.push(`  ${tag}_Schedule,                        !- Name`);
        lines.push("  Any Number,                             !- Schedule Type Limits Name");
        lines.push("  Through: 12/31,                         !- Field 1");
        lines.push("  For: AllDays,                           !- Field 2");
        lines.push(`  Until: 24:00, ${numParam(unit, 1, 1.0)};`);
        lines.push("");
        break;
      }

      case 56: {
        lines.push("Zone,");
        lines.push(`  ${tag},                                 !- Name`);
        lines.push("  0.0,                                    !- Direction of Relative North {deg}");
        lines.push("  0.0, 0.0, 0.0,                          !- X,Y,Z Origin {m}");
        lines.push("  1,                                      !- Type");
        lines.push("  1;                                      !- Multiplier");
        lines.push("");
        break;
      }

      default:
        break;
    }
  }

  return lines.join("\n");
}
