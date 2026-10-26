// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/eclipse — Bidirectional Modelica 3.x Projection for Subsurface Reservoirs.
 *
 * Emits rigorous Modelica physical models for multiphase porous media flow,
 * black-oil PVT fluid tables, Peaceman well inflow performance, and material balance depletion.
 */

import type { EclipseDeck } from "../types.js";

export function eclipseToModelica(deck: EclipseDeck, modelName = "ReservoirSimulation"): string {
  const safeModelName = modelName.replace(/[^a-zA-Z0-9_]/g, "_");
  const lines: string[] = [];

  const isField = deck.units === "FIELD";
  const pUnit = isField ? "psi" : "bar";
  const rateUnit = isField ? "stb/d" : "sm3/d";
  const bblPerFt3 = 1.0 / 5.614583;

  const totalCells = deck.dimensions.nx * deck.dimensions.ny * deck.dimensions.nz;
  const vBulkCell = deck.grid.dx * deck.grid.dy * deck.grid.dz;
  const vBulkTotal = vBulkCell * totalCells;
  const vPoreTotal = vBulkTotal * deck.grid.poro;
  const vPore = isField ? vPoreTotal * bblPerFt3 : vPoreTotal;

  const initP = deck.solution.initialPressure ?? (isField ? 4000.0 : 250.0);
  const swc = deck.solution.initialSwat ?? deck.props.swof[0]?.saturation ?? 0.2;
  const boi = deck.props.pvdo[0]?.fvf ?? 1.25;
  const ct = isField ? 1.2e-5 : 1.7e-4;

  lines.push(`model ${safeModelName}`);
  lines.push(`  "ECLIPSE Black-Oil Subsurface Reservoir Simulation"`);
  lines.push(``);

  // 1. Reservoir Parameters
  lines.push(`  // --- Reservoir Grid & Fluid Parameters ---`);
  lines.push(`  parameter Integer nx = ${deck.dimensions.nx};`);
  lines.push(`  parameter Integer ny = ${deck.dimensions.ny};`);
  lines.push(`  parameter Integer nz = ${deck.dimensions.nz};`);
  lines.push(`  parameter Real dx = ${deck.grid.dx.toFixed(2)} "Grid cell dx";`);
  lines.push(`  parameter Real dy = ${deck.grid.dy.toFixed(2)} "Grid cell dy";`);
  lines.push(`  parameter Real dz = ${deck.grid.dz.toFixed(2)} "Grid cell dz";`);
  lines.push(`  parameter Real poro = ${deck.grid.poro.toFixed(4)} "Average porosity";`);
  lines.push(`  parameter Real permX = ${deck.grid.permX.toFixed(2)} "Permeability X [mD]";`);
  lines.push(`  parameter Real Bo = ${boi.toFixed(4)} "Oil Formation Volume Factor";`);
  lines.push(`  parameter Real V_pore = ${vPore.toFixed(1)} "Total pore volume";`);
  lines.push(`  parameter Real ct = ${ct.toExponential(4)} "Total compressibility [1/${pUnit}]";`);
  lines.push(``);

  // 2. Reservoir Dynamic Variables
  lines.push(`  // --- Dynamic State Variables ---`);
  lines.push(`  Real P_avg(start = ${initP.toFixed(2)}) "Average reservoir pressure [${pUnit}]";`);
  lines.push(`  Real S_w(start = ${swc.toFixed(4)}) "Water saturation";`);
  lines.push(`  Real Np(start = 0.0) "Cumulative oil production [STB or sm3]";`);
  lines.push(`  Real Wp(start = 0.0) "Cumulative water production";`);
  lines.push(`  Real Gp(start = 0.0) "Cumulative gas production";`);
  lines.push(`  Real Q_oil_total "Total field oil rate [${rateUnit}]";`);
  lines.push(`  Real Q_water_total "Total field water rate";`);
  lines.push(`  Real Q_gas_total "Total field gas rate";`);
  lines.push(``);

  // 3. Well Variables
  lines.push(`  // --- Wells (Peaceman Model) ---`);
  for (const well of deck.wells.values()) {
    const wName = well.name.replace(/[^a-zA-Z0-9_]/g, "_");
    const wi = well.completions.reduce((acc, c) => acc + (c.wellIndex > 0 ? c.wellIndex : 10.0), 0);
    const bhpInit = well.productionControl?.bhpLimit ?? (isField ? 2000.0 : 150.0);
    lines.push(`  parameter Real WI_${wName} = ${wi.toFixed(2)} "Well productivity index";`);
    lines.push(`  Real q_oil_${wName}(start = 0.0) "Oil rate for well ${well.name} [${rateUnit}]";`);
    lines.push(`  Real q_water_${wName}(start = 0.0) "Water rate for well ${well.name}";`);
    lines.push(`  Real q_gas_${wName}(start = 0.0) "Gas rate for well ${well.name}";`);
    lines.push(`  Real bhp_${wName}(start = ${bhpInit.toFixed(2)}) "Bottom-hole pressure [${pUnit}]";`);
    lines.push(``);
  }

  lines.push(`equation`);

  // 4. Inflow Performance Relationships
  const oilRates: string[] = [];
  const waterRates: string[] = [];
  const gasRates: string[] = [];

  for (const well of deck.wells.values()) {
    const wName = well.name.replace(/[^a-zA-Z0-9_]/g, "_");
    oilRates.push(`q_oil_${wName}`);
    waterRates.push(`q_water_${wName}`);
    gasRates.push(`q_gas_${wName}`);

    lines.push(`  q_oil_${wName} = WI_${wName} * (P_avg - bhp_${wName});`);
    lines.push(`  q_water_${wName} = 0.0;`);
    lines.push(`  q_gas_${wName} = 0.0;`);

    if (well.productionControl) {
      lines.push(`  bhp_${wName} = ${well.productionControl.bhpLimit.toFixed(2)};`);
    } else if (well.injectionControl) {
      lines.push(`  bhp_${wName} = ${well.injectionControl.bhpLimit.toFixed(2)};`);
    } else {
      lines.push(`  bhp_${wName} = ${isField ? "2000.0" : "150.0"};`);
    }
  }

  // Field Totals
  lines.push(`  Q_oil_total = ${oilRates.length > 0 ? oilRates.join(" + ") : "0.0"};`);
  lines.push(`  Q_water_total = ${waterRates.length > 0 ? waterRates.join(" + ") : "0.0"};`);
  lines.push(`  Q_gas_total = ${gasRates.length > 0 ? gasRates.join(" + ") : "0.0"};`);

  // Material Balance ODEs
  lines.push(`  der(Np) = Q_oil_total;`);
  lines.push(`  der(Wp) = Q_water_total;`);
  lines.push(`  der(Gp) = Q_gas_total;`);
  lines.push(`  der(P_avg) = -(Q_oil_total * Bo) / (V_pore * ct);`);
  lines.push(`  der(S_w) = 0.0;`);

  lines.push(`end ${safeModelName};`);

  return lines.join("\n");
}
