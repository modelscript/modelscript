// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * LPS cleanroom pipeline equipment & EOS archetype IDs matching `assets/lps-std-lib/src/models.ts`.
 */
export const LpsArchetypeId = {
  // Pipeline & Hydraulic Elements
  PIPE_GAS: 1,
  PIPE_LIQUID: 2,
  COMPRESSOR_CENTRIFUGAL: 10,
  COMPRESSOR_RECIP: 11,
  PUMP_CENTRIFUGAL: 12,
  REGULATOR_PRESSURE: 20,
  VALVE_CONTROL: 21,
  VALVE_CHECK: 22,
  VALVE_BLOCK: 23,
  HEATER_GAS: 30,
  COOLER_GAS: 31,
  TANK_STORAGE: 40,
  SURGE_VESSEL: 41,
  SUPPLY_NODE: 50,
  DELIVERY_NODE: 51,
  // Equations of State & Fluid Standards
  EOS_AGA8: 60,
  EOS_GERG2008: 61,
  EOS_PENG_ROBINSON: 62,
  LIQUID_CRUDE: 70,
  LIQUID_DIESEL: 71,
  LIQUID_GASOLINE: 72,
  LIQUID_WATER: 73,
} as const;

export type LpsArchetypeId = (typeof LpsArchetypeId)[keyof typeof LpsArchetypeId];

export interface LpsModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category:
    | "Pipeline"
    | "Machinery"
    | "Valve / Regulator"
    | "Thermal"
    | "Storage / Surge"
    | "Boundary Node"
    | "Gas EOS"
    | "Liquid Fluid";
  archetypeId: LpsArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<LpsModelSpec["category"], { fill: string; stroke: string; badge: string }> = {
  Pipeline: { fill: "#1e3a5f", stroke: "#60a5fa", badge: "PIPE" },
  Machinery: { fill: "#3b1f47", stroke: "#c084fc", badge: "MACH" },
  "Valve / Regulator": { fill: "#3f2e18", stroke: "#fbbf24", badge: "VLV" },
  Thermal: { fill: "#3b2323", stroke: "#f87171", badge: "THRM" },
  "Storage / Surge": { fill: "#1e3f2f", stroke: "#34d399", badge: "STOR" },
  "Boundary Node": { fill: "#2a2b4a", stroke: "#818cf8", badge: "NODE" },
  "Gas EOS": { fill: "#163b3b", stroke: "#2dd4bf", badge: "EOS" },
  "Liquid Fluid": { fill: "#422006", stroke: "#fb923c", badge: "LIQ" },
};

/**
 * Generates a deterministic cleanroom parametric SVG block icon for an LPS pipeline equipment or fluid model.
 */
export function generateLpsBlockSvg(modelType: string, category: LpsModelSpec["category"]): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.toUpperCase().replace(/_/g, " ").slice(0, 10);
  let glyph = "";
  if (category === "Pipeline") {
    glyph = `<line x1="12" y1="24" x2="68" y2="24" stroke="${c.stroke}" stroke-width="2.2" stroke-opacity="0.45"/>`;
  } else if (category === "Machinery") {
    glyph = `<circle cx="62" cy="14" r="6" fill="none" stroke="${c.stroke}" stroke-width="1.3" stroke-opacity="0.6"/>`;
  } else if (category === "Valve / Regulator") {
    glyph = `<polygon points="56,10 68,18 68,10 56,18" fill="none" stroke="${c.stroke}" stroke-width="1.2" stroke-opacity="0.6"/>`;
  } else if (category === "Storage / Surge") {
    glyph = `<rect x="57" y="8" width="12" height="12" rx="3" fill="none" stroke="${c.stroke}" stroke-width="1.2" stroke-opacity="0.6"/>`;
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 48" width="80" height="48">` +
    `<rect x="2" y="2" width="76" height="44" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    glyph +
    `<rect x="6" y="6" width="28" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="20" y="15" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="40" y="34" text-anchor="middle" font-family="monospace" font-size="9" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForCategory(category: LpsModelSpec["category"]): DiagramPortSpec[] {
  switch (category) {
    case "Pipeline":
    case "Valve / Regulator":
    case "Thermal":
      return [
        { name: "inlet", kind: "fluid", side: "left", dx: 0, dy: 24 },
        { name: "outlet", kind: "fluid", side: "right", dx: 80, dy: 24 },
      ];
    case "Machinery":
      return [
        { name: "suction", kind: "fluid", side: "left", dx: 0, dy: 24 },
        { name: "discharge", kind: "fluid", side: "right", dx: 80, dy: 24 },
        { name: "ctrl", kind: "signal", side: "top", dx: 40, dy: 0 },
      ];
    case "Storage / Surge":
      return [
        { name: "nozzle", kind: "fluid", side: "left", dx: 0, dy: 24 },
        { name: "vent", kind: "fluid", side: "top", dx: 40, dy: 0 },
      ];
    case "Boundary Node":
      return [{ name: "port", kind: "fluid", side: "right", dx: 80, dy: 24 }];
    case "Gas EOS":
    case "Liquid Fluid":
      return [
        { name: "pt_in", kind: "signal", side: "left", dx: 0, dy: 24 },
        { name: "props_out", kind: "signal", side: "right", dx: 80, dy: 24 },
      ];
  }
}

export const LPS_MODEL_SPECS: LpsModelSpec[] = [
  // ── Pipeline & Hydraulic Elements ──────────────────────────────────────────────────────────
  {
    modelType: "PIPE_GAS",
    aliases: ["pipe_gas", "gas_pipe", "tgnet_pipe", "PIPE"],
    label: "Compressible Gas Pipeline Segment",
    category: "Pipeline",
    archetypeId: LpsArchetypeId.PIPE_GAS,
    description:
      "Steady-state and transient compressible natural gas pipeline segment using Weymouth / Panhandle / Darcy-Weisbach friction and Swamee-Jain roughness.",
    provenance: "Weymouth (1912) / Panhandle B / Darcy-Weisbach / ISO 20765-1 (AGA-8)",
    params: [
      ["length", 10000.0, "m", "Pipeline segment length"],
      ["diameter", 0.5, "m", "Internal pipe diameter"],
      ["roughness", 4.5e-5, "m", "Absolute internal wall roughness"],
      ["elevationChange", 0.0, "m", "Outlet minus inlet elevation"],
      ["molarMass", 17.4, "kg/kmol", "Gas mixture molar mass"],
      ["zFactor", 0.0, "1", "Fixed compressibility factor (0 = compute via Papay/AGA-8)"],
      ["efficiency", 0.95, "1", "Pipeline hydraulic drag efficiency factor"],
      ["viscosity", 1.15e-5, "Pa*s", "Dynamic gas viscosity"],
    ],
  },
  {
    modelType: "PIPE_LIQUID",
    aliases: ["pipe_liquid", "liquid_pipe", "tlnet_pipe"],
    label: "Incompressible Liquid Pipeline & Surge Segment",
    category: "Pipeline",
    archetypeId: LpsArchetypeId.PIPE_LIQUID,
    description:
      "Darcy-Weisbach liquid pipeline hydraulics with Korteweg-Moens acoustic wave speed and Joukowsky water-hammer surge pressure evaluation.",
    provenance: "Darcy-Weisbach / Swamee-Jain (1976) / Joukowsky (1898) Water-Hammer Equation",
    params: [
      ["length", 10000.0, "m", "Pipeline segment length"],
      ["diameter", 0.5, "m", "Internal pipe diameter"],
      ["roughness", 4.5e-5, "m", "Absolute internal wall roughness"],
      ["wallThickness", 0.012, "m", "Pipe steel wall thickness"],
      ["elevationChange", 0.0, "m", "Outlet minus inlet elevation"],
      ["density", 850.0, "kg/m3", "Liquid operating density"],
      ["viscosity", 0.005, "Pa*s", "Dynamic liquid viscosity"],
      ["bulkModulus", 1.5e9, "Pa", "Liquid adiabatic bulk modulus K"],
      ["pipeElasticModulus", 2.07e11, "Pa", "Pipe wall Young's modulus E (carbon steel)"],
    ],
  },
  {
    modelType: "COMPRESSOR_CENTRIFUGAL",
    aliases: ["compressor_centrifugal", "centrifugal_compressor", "COMP", "CS"],
    label: "Centrifugal Gas Compressor Station",
    category: "Machinery",
    archetypeId: LpsArchetypeId.COMPRESSOR_CENTRIFUGAL,
    description:
      "Polytropic centrifugal gas compressor calculating discharge pressure, polytropic head, discharge temperature, and shaft power.",
    provenance: "ASME PTC 10 / GPSA Engineering Data Book Ch. 13 Polytropic Compression",
    params: [
      ["pressureRatio", 1.5, "1", "Target discharge-to-suction pressure ratio"],
      ["polytropicEfficiency", 0.82, "1", "Polytropic compression efficiency"],
      ["gamma", 1.3, "1", "Isentropic specific heat ratio cp/cv"],
      ["molarMass", 17.4, "kg/kmol", "Gas mixture molar mass"],
      ["maxPowerW", 2.5e7, "W", "Maximum available driver shaft power"],
      ["maxPressureRatio", 2.2, "1", "Maximum allowable compression ratio"],
      ["zFactor", 0.88, "1", "Mean suction/discharge compressibility factor"],
    ],
  },
  {
    modelType: "COMPRESSOR_RECIP",
    aliases: ["compressor_recip", "reciprocating_compressor", "RECIP"],
    label: "Reciprocating Gas Compressor Station",
    category: "Machinery",
    archetypeId: LpsArchetypeId.COMPRESSOR_RECIP,
    description:
      "Positive-displacement reciprocating gas compressor with clearance volumetric efficiency and adiabatic head/power calculation.",
    provenance: "API Std 618 / GPSA Engineering Data Book Reciprocating Compressors",
    params: [
      ["pressureRatio", 1.8, "1", "Target compression ratio"],
      ["mechanicalEfficiency", 0.88, "1", "Adiabatic/mechanical efficiency"],
      ["gamma", 1.3, "1", "Specific heat ratio cp/cv"],
      ["molarMass", 17.4, "kg/kmol", "Gas mixture molar mass"],
      ["maxPowerW", 1.2e7, "W", "Maximum rated shaft power"],
      ["clearanceFraction", 0.08, "1", "Cylinder clearance volume ratio"],
      ["zFactor", 0.88, "1", "Average compressibility factor"],
    ],
  },
  {
    modelType: "PUMP_CENTRIFUGAL",
    aliases: ["pump_centrifugal", "centrifugal_pump", "PUMP"],
    label: "Centrifugal Liquid Booster Pump",
    category: "Machinery",
    archetypeId: LpsArchetypeId.PUMP_CENTRIFUGAL,
    description:
      "Centrifugal liquid pipeline pump modeled with parabolic affinity H-Q characteristic curve, differential pressure, and brake power.",
    provenance: "API Std 610 / Hydraulic Institute ANSI/HI 1.3 Centrifugal Pump Curves",
    params: [
      ["ratedHeadM", 120.0, "m", "Rated differential hydraulic head"],
      ["ratedFlowM3S", 0.5, "m3/s", "Rated volumetric flow rate"],
      ["efficiency", 0.8, "1", "Hydraulic pump efficiency at BEP"],
      ["density", 850.0, "kg/m3", "Pumped liquid density"],
      ["shutoffRatio", 1.25, "1", "Shutoff head to rated head ratio"],
      ["speedRatio", 1.0, "1", "Normalized shaft speed N/N_rated"],
    ],
  },
  {
    modelType: "REGULATOR_PRESSURE",
    aliases: ["regulator_pressure", "pressure_regulator", "REG", "PRV"],
    label: "Pressure Reducing Regulator",
    category: "Valve / Regulator",
    archetypeId: LpsArchetypeId.REGULATOR_PRESSURE,
    description:
      "Downstream pressure-clamping gas regulator with Joule-Thomson expansion cooling and non-boosting check.",
    provenance: "ASME B31.8 / ISA-75.01 Pressure Regulator & Joule-Thomson Expansion",
    params: [
      ["setpointPressurePa", 4.0e6, "Pa", "Controlled downstream pressure setpoint"],
      ["maxCapacityKgS", 200.0, "kg/s", "Maximum regulator mass flow capacity"],
      ["jtCoeffKPerPa", 4.5e-6, "K/Pa", "Joule-Thomson cooling coefficient"],
      ["minPressureDropPa", 5.0e4, "Pa", "Minimum wide-open differential pressure"],
    ],
  },
  {
    modelType: "VALVE_CONTROL",
    aliases: ["valve_control", "control_valve", "FCV", "PCV"],
    label: "Throttling Control Valve",
    category: "Valve / Regulator",
    archetypeId: LpsArchetypeId.VALVE_CONTROL,
    description:
      "Modulating flow/pressure control valve governed by ISA Cv flow coefficient and fractional stem opening.",
    provenance: "ANSI/ISA-75.01.01 (IEC 60534-2-1) Control Valve Sizing Equations",
    params: [
      ["cv", 1200.0, "gpm/sqrt(psi)", "Valve flow coefficient Cv"],
      ["opening", 1.0, "1", "Fractional valve stem opening (0..1)"],
      ["density", 50.0, "kg/m3", "Fluid density at valve inlet"],
      ["closingTimeS", 15.0, "s", "Full-stroke actuator closing time"],
    ],
  },
  {
    modelType: "VALVE_CHECK",
    aliases: ["valve_check", "check_valve", "NRV"],
    label: "Non-Return Check Valve",
    category: "Valve / Regulator",
    archetypeId: LpsArchetypeId.VALVE_CHECK,
    description:
      "Swing/axial non-return check valve permitting forward flow with cracking differential pressure and blocking reverse flow.",
    provenance: "API Spec 6D / Crane TP-410 Check Valve Hydraulics",
    params: [
      ["cv", 2500.0, "gpm/sqrt(psi)", "Full-open valve flow coefficient Cv"],
      ["crackingDeltaPPa", 5000.0, "Pa", "Minimum cracking pressure differential"],
      ["density", 850.0, "kg/m3", "Fluid density at valve inlet"],
    ],
  },
  {
    modelType: "VALVE_BLOCK",
    aliases: ["valve_block", "block_valve", "ESD_VALVE", "BV"],
    label: "Mainline Isolation / ESD Block Valve",
    category: "Valve / Regulator",
    archetypeId: LpsArchetypeId.VALVE_BLOCK,
    description:
      "Full-bore mainline isolation or emergency shutdown (ESD) block valve with open/closed state and stroke time.",
    provenance: "API Spec 6D / ASME B31.4 & B31.8 Mainline Block Valve",
    params: [
      ["cv", 5000.0, "gpm/sqrt(psi)", "Full-bore flow coefficient Cv"],
      ["opening", 1.0, "1", "Valve status (1 = open, 0 = closed)"],
      ["density", 50.0, "kg/m3", "Fluid density at valve"],
      ["closingTimeS", 20.0, "s", "ESD closure stroke duration"],
    ],
  },
  {
    modelType: "HEATER_GAS",
    aliases: ["heater_gas", "gas_heater", "PREHEATER", "HEATER"],
    label: "Inline Gas Pre-Heater",
    category: "Thermal",
    archetypeId: LpsArchetypeId.HEATER_GAS,
    description:
      "Line heater preventing hydrate formation upstream of pressure reduction stations by heating gas to target temperature.",
    provenance: "GPSA Engineering Data Book Ch. 9 / ASME BPVC Fired Line Heaters",
    params: [
      ["targetTempK", 313.15, "K", "Controlled outlet gas temperature"],
      ["cpJPerKgK", 2200.0, "J/(kg*K)", "Isobaric specific heat capacity"],
      ["pressureDropPa", 20000.0, "Pa", "Tube-side frictional pressure loss"],
      ["thermalEfficiency", 0.85, "1", "Burner thermal efficiency"],
    ],
  },
  {
    modelType: "COOLER_GAS",
    aliases: ["cooler_gas", "gas_cooler", "AFTERCOOLER", "COOLER"],
    label: "Compressor Discharge Gas Aftercooler",
    category: "Thermal",
    archetypeId: LpsArchetypeId.COOLER_GAS,
    description:
      "Aerial fin-fan or shell-and-tube gas aftercooler rejecting compression heat to protect downstream pipeline coating.",
    provenance: "API Std 661 (ISO 13706) Air-Cooled Heat Exchangers",
    params: [
      ["targetTempK", 308.15, "K", "Controlled outlet gas temperature"],
      ["cpJPerKgK", 2200.0, "J/(kg*K)", "Isobaric specific heat capacity"],
      ["pressureDropPa", 35000.0, "Pa", "Cooler bundle pressure drop"],
      ["ambientTempK", 293.15, "K", "Ambient air/water sink temperature"],
    ],
  },
  {
    modelType: "TANK_STORAGE",
    aliases: ["tank_storage", "storage_tank", "TANK"],
    label: "Atmospheric Liquid Storage Tank",
    category: "Storage / Surge",
    archetypeId: LpsArchetypeId.TANK_STORAGE,
    description: "Atmospheric or pressurized liquid storage tank providing hydrostatic head and inventory buffering.",
    provenance: "API Std 650 Welded Tanks for Oil Storage",
    params: [
      ["diameterM", 30.0, "m", "Tank internal diameter"],
      ["liquidLevelM", 12.0, "m", "Current liquid column height"],
      ["maxLevelM", 18.0, "m", "Maximum safe fill height"],
      ["density", 850.0, "kg/m3", "Stored liquid density"],
      ["headspacePressurePa", 101325.0, "Pa", "Vapor headspace pressure"],
    ],
  },
  {
    modelType: "SURGE_VESSEL",
    aliases: ["surge_vessel", "surge_tank", "ACCUMULATOR"],
    label: "Gas-Cushioned Hydraulic Surge Vessel",
    category: "Storage / Surge",
    archetypeId: LpsArchetypeId.SURGE_VESSEL,
    description:
      "Pressurized bladder/gas-cushioned surge vessel mitigating liquid pipeline water-hammer transients via polytropic gas cushion.",
    provenance: "Wylie & Streeter Fluid Transients / ASME BPVC Section VIII Surge Vessel",
    params: [
      ["vesselVolumeM3", 25.0, "m3", "Total internal vessel volume"],
      ["gasVolumeM3", 12.0, "m3", "Pre-charge gas cushion volume"],
      ["prechargePressurePa", 3.5e6, "Pa", "Initial nitrogen cushion pressure"],
      ["polytropicExponent", 1.2, "1", "Gas cushion polytropic exponent n"],
      ["orificeLossCoeff", 2.5, "1", "Nozzle throttling loss coefficient K"],
    ],
  },
  {
    modelType: "SUPPLY_NODE",
    aliases: ["supply_node", "supply", "SOURCE", "RECEIPT"],
    label: "Pipeline Supply / Receipt Boundary",
    category: "Boundary Node",
    archetypeId: LpsArchetypeId.SUPPLY_NODE,
    description:
      "Network supply or receipt station enforcing boundary pressure, temperature, and maximum contract supply rate.",
    provenance: "PipelineStudio TGNET / TLNET & Synergi Gas Boundary Conditions",
    params: [
      ["setpointPressurePa", 7.0e6, "Pa", "Supply boundary pressure"],
      ["temperatureK", 288.15, "K", "Supply fluid temperature"],
      ["maxFlowKgS", 500.0, "kg/s", "Maximum available supply mass rate"],
      ["elevationM", 0.0, "m", "Node elevation above datum"],
    ],
  },
  {
    modelType: "DELIVERY_NODE",
    aliases: ["delivery_node", "delivery", "SINK", "DEMAND"],
    label: "Pipeline Delivery / Offtake Boundary",
    category: "Boundary Node",
    archetypeId: LpsArchetypeId.DELIVERY_NODE,
    description:
      "Network delivery or customer offtake node specifying contract flow rate and minimum delivery pressure.",
    provenance: "PipelineStudio TGNET / TLNET & Synergi Gas Boundary Conditions",
    params: [
      ["minPressurePa", 3.0e6, "Pa", "Minimum contractual delivery pressure"],
      ["targetFlowKgS", 100.0, "kg/s", "Scheduled delivery mass flow rate"],
      ["elevationM", 0.0, "m", "Node elevation above datum"],
    ],
  },

  // ── Equations of State & Fluid Standards ───────────────────────────────────────────────────
  {
    modelType: "EOS_AGA8",
    aliases: ["eos_aga8", "AGA8", "AGA-8", "aga8_detail"],
    label: "AGA-8 / ISO 20765-1 Natural Gas EOS",
    category: "Gas EOS",
    archetypeId: LpsArchetypeId.EOS_AGA8,
    description:
      "Natural gas compressibility factor Z(P,T), density, and speed of sound per AGA Report No. 8 / ISO 20765-1 with pseudocritical Papay formulation.",
    provenance: "ISO 20765-1:2005 / AGA Report No. 8 Detailed Characterization Method",
    params: [
      ["molarMass", 17.4, "kg/kmol", "Gas mixture molar mass"],
      ["pPseudocriticalPa", 4.64e6, "Pa", "Pseudocritical pressure P_pc"],
      ["tPseudocriticalK", 205.0, "K", "Pseudocritical temperature T_pc"],
      ["gamma", 1.3, "1", "Isentropic exponent k"],
    ],
  },
  {
    modelType: "EOS_GERG2008",
    aliases: ["eos_gerg2008", "GERG2008", "GERG-2008", "ISO20765-2"],
    label: "GERG-2008 / ISO 20765-2 Wide-Range Gas EOS",
    category: "Gas EOS",
    archetypeId: LpsArchetypeId.EOS_GERG2008,
    description:
      "Wide-range multi-component natural gas and hydrogen-blend thermodynamic equation of state per ISO 20765-2 (GERG-2008).",
    provenance: "ISO 20765-2:2015 / Kunz & Wagner (2012) GERG-2008 Equation of State",
    params: [
      ["molarMass", 17.4, "kg/kmol", "Gas mixture molar mass"],
      ["pPseudocriticalPa", 4.64e6, "Pa", "Pseudocritical pressure P_pc"],
      ["tPseudocriticalK", 205.0, "K", "Pseudocritical temperature T_pc"],
      ["hydrogenFraction", 0.0, "1", "Hydrogen molar blend fraction (0..1)"],
      ["gamma", 1.31, "1", "Isentropic exponent k"],
    ],
  },
  {
    modelType: "EOS_PENG_ROBINSON",
    aliases: ["eos_peng_robinson", "PENG_ROBINSON", "PR_EOS", "PR76"],
    label: "Peng-Robinson Cubic Equation of State",
    category: "Gas EOS",
    archetypeId: LpsArchetypeId.EOS_PENG_ROBINSON,
    description:
      "Two-parameter Peng-Robinson (1976) cubic equation of state solving vapor-phase compressibility Z(P,T), density, and acoustic speed.",
    provenance: "Peng & Robinson (1976), Ind. Eng. Chem. Fundam. 15(1): 59-64",
    params: [
      ["molarMass", 16.043, "kg/kmol", "Fluid molar mass"],
      ["pCriticalPa", 4.599e6, "Pa", "Critical pressure Pc"],
      ["tCriticalK", 190.564, "K", "Critical temperature Tc"],
      ["acentricFactor", 0.0115, "1", "Pitzer acentric factor omega"],
      ["gamma", 1.31, "1", "Isentropic exponent k"],
    ],
  },
  {
    modelType: "LIQUID_CRUDE",
    aliases: ["liquid_crude", "CRUDE_OIL", "CRUDE"],
    label: "Crude Oil Liquid Property Standard",
    category: "Liquid Fluid",
    archetypeId: LpsArchetypeId.LIQUID_CRUDE,
    description:
      "API MPMS Ch. 11.1 temperature/pressure-compensated crude oil density, viscosity, bulk modulus, and wave speed.",
    provenance: "API MPMS Chapter 11.1 / ASTM D1250 Petroleum Measurement Tables",
    params: [
      ["refDensityKgM3", 860.0, "kg/m3", "Reference density at 15 degC, 1 atm"],
      ["bulkModulusPa", 1.5e9, "Pa", "Adiabatic bulk modulus K"],
      ["thermalExpPerK", 7.8e-4, "1/K", "Volumetric thermal expansion coefficient"],
      ["viscosityPaS", 0.012, "Pa*s", "Reference dynamic viscosity"],
    ],
  },
  {
    modelType: "LIQUID_DIESEL",
    aliases: ["liquid_diesel", "DIESEL", "ULSD"],
    label: "Ultra-Low Sulfur Diesel Fluid Standard",
    category: "Liquid Fluid",
    archetypeId: LpsArchetypeId.LIQUID_DIESEL,
    description:
      "Refined diesel distillate fluid properties for TLNET multi-product batch pipelines and hydraulic surge analysis.",
    provenance: "API MPMS Chapter 11.1 / ASTM D975 Diesel Fuel Oil Standard",
    params: [
      ["refDensityKgM3", 835.0, "kg/m3", "Reference density at 15 degC, 1 atm"],
      ["bulkModulusPa", 1.45e9, "Pa", "Adiabatic bulk modulus K"],
      ["thermalExpPerK", 8.3e-4, "1/K", "Volumetric thermal expansion coefficient"],
      ["viscosityPaS", 0.003, "Pa*s", "Reference dynamic viscosity"],
    ],
  },
  {
    modelType: "LIQUID_GASOLINE",
    aliases: ["liquid_gasoline", "GASOLINE", "MOGAS"],
    label: "Motor Gasoline Fluid Standard",
    category: "Liquid Fluid",
    archetypeId: LpsArchetypeId.LIQUID_GASOLINE,
    description:
      "Refined motor gasoline liquid properties with lower bulk modulus and higher thermal expansion for refined product pipelines.",
    provenance: "API MPMS Chapter 11.1 / ASTM D4814 Automotive Spark-Ignition Fuel",
    params: [
      ["refDensityKgM3", 745.0, "kg/m3", "Reference density at 15 degC, 1 atm"],
      ["bulkModulusPa", 1.15e9, "Pa", "Adiabatic bulk modulus K"],
      ["thermalExpPerK", 1.15e-3, "1/K", "Volumetric thermal expansion coefficient"],
      ["viscosityPaS", 0.00055, "Pa*s", "Reference dynamic viscosity"],
    ],
  },
  {
    modelType: "LIQUID_WATER",
    aliases: ["liquid_water", "WATER", "H2O"],
    label: "Liquid Water Fluid Standard (IAPWS-95)",
    category: "Liquid Fluid",
    archetypeId: LpsArchetypeId.LIQUID_WATER,
    description:
      "Standard liquid water density, compressibility, and acoustic wave speed reference for hydrotest and water-hammer verification.",
    provenance: "IAPWS-95 / ISO 4185 Liquid Water Reference Properties",
    params: [
      ["refDensityKgM3", 999.1, "kg/m3", "Reference density at 15 degC, 1 atm"],
      ["bulkModulusPa", 2.15e9, "Pa", "Adiabatic bulk modulus K"],
      ["thermalExpPerK", 1.5e-4, "1/K", "Volumetric thermal expansion coefficient"],
      ["viscosityPaS", 0.00114, "Pa*s", "Reference dynamic viscosity"],
    ],
  },
];

/**
 * Converts `LPS_MODEL_SPECS` into shared `@modelscript/runtime` `CleanroomModelSchema[]`
 * with cleanroom parametric SVG icons and port layouts.
 */
export function buildLpsCleanroomSchemas(): CleanroomModelSchema[] {
  return LPS_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `lps:${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases,
      label: spec.label,
      category: spec.category,
      domain: "fluid",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "lps_component_model",
      width: 80,
      height: 48,
      svg: generateLpsBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForCategory(spec.category),
      parameters,
      wasmKernel: spec.modelType,
      extra: {
        archetypeId: spec.archetypeId,
      },
    };
  });
}
