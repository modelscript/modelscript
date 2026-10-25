// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Standard NASA ROCETS component module catalog and port metadata.
 */

export interface ModuleDescriptor {
  type: string;
  name: string;
  category: "turbomachinery" | "combustion" | "fluid" | "thermal" | "control";
  inputs: string[];
  outputs: string[];
  parameters: Record<string, number | string>;
  description: string;
}

export const ROCETS_MODULE_CATALOG: Record<string, ModuleDescriptor> = {
  CHAMBER: {
    type: "CHAMBER",
    name: "Main Combustion Chamber & Nozzle",
    category: "combustion",
    inputs: ["INJ_OX", "INJ_FUEL"],
    outputs: ["NOZZLE_EXIT"],
    parameters: {
      THROAT_AREA: 0.05,
      EXPANSION_RATIO: 35.0,
      DESIGN_PC: 1.0e7,
      DESIGN_MR: 6.0,
      EFFICIENCY_CSTAR: 0.98,
    },
    description: "Rocket thrust chamber and convergent-divergent supersonic nozzle expansion.",
  },

  PUMP: {
    type: "PUMP",
    name: "Centrifugal Propellant Pump",
    category: "turbomachinery",
    inputs: ["INLET", "SHAFT_IN"],
    outputs: ["DISCHARGE"],
    parameters: {
      DESIGN_FLOW: 50.0,
      DESIGN_HEAD: 1500.0,
      DESIGN_RPM: 30000.0,
      EFFICIENCY: 0.75,
      INERTIA: 0.05,
    },
    description: "Centrifugal or axial liquid propellant turbopump stage.",
  },

  TURBINE: {
    type: "TURBINE",
    name: "Drive Gas Turbine",
    category: "turbomachinery",
    inputs: ["INLET"],
    outputs: ["DISCHARGE", "SHAFT_OUT"],
    parameters: {
      DESIGN_FLOW: 15.0,
      PRESSURE_RATIO: 1.8,
      EFFICIENCY: 0.82,
      DESIGN_RPM: 30000.0,
    },
    description: "Axial or radial drive gas turbine powering turbopump shaft.",
  },

  SHAFT: {
    type: "SHAFT",
    name: "Turbopump Common Rotor Shaft",
    category: "turbomachinery",
    inputs: ["TURBINE_POWER"],
    outputs: ["PUMP_POWER"],
    parameters: {
      SPEED_RPM: 30000.0,
      INERTIA: 0.1,
      MAX_RPM: 45000.0,
      FRICTION_TORQUE: 5.0,
    },
    description: "Common rotating mechanical shaft connecting turbines and pumps.",
  },

  GAS_GENERATOR: {
    type: "GAS_GENERATOR",
    name: "Preburner / Gas Generator",
    category: "combustion",
    inputs: ["OX_IN", "FUEL_IN"],
    outputs: ["GAS_OUT"],
    parameters: {
      TARGET_TEMP: 900.0,
      PRESSURE_PA: 1.2e7,
      CSTAR_EFF: 0.95,
    },
    description: "Fuel-rich or oxidizer-rich precombustor driving the turbopump turbine.",
  },

  COOLING_JACKET: {
    type: "COOLING_JACKET",
    name: "Regenerative Cooling Channels",
    category: "thermal",
    inputs: ["COOL_IN"],
    outputs: ["COOL_OUT"],
    parameters: {
      SURFACE_AREA: 1.5,
      HYDRAULIC_DIAMETER: 0.003,
      LENGTH: 1.2,
      WALL_THICKNESS: 0.001,
      WALL_CONDUCTIVITY: 350.0,
    },
    description: "Nozzle and chamber regenerative coolant passage array.",
  },

  LINE: {
    type: "LINE",
    name: "Compressible Propellant Duct / Manifold",
    category: "fluid",
    inputs: ["INLET"],
    outputs: ["OUTLET"],
    parameters: {
      LENGTH: 2.0,
      DIAMETER: 0.08,
      VOLUME: 0.01,
      FRICTION_FACTOR: 0.02,
    },
    description: "Liquid or gas fluid line with inertance, volume capacitance, and wall friction.",
  },

  VALVE: {
    type: "VALVE",
    name: "Propellant Control Valve / Orifice",
    category: "control",
    inputs: ["INLET"],
    outputs: ["OUTLET"],
    parameters: {
      CD_A_MAX: 0.002,
      POSITION: 1.0,
      OPEN_TIME: 0.25,
    },
    description: "Modulating control valve, cavitating venturi, or trim orifice.",
  },

  JUNCTION: {
    type: "JUNCTION",
    name: "Flow Splitter / Mixer Manifold",
    category: "fluid",
    inputs: ["IN1", "IN2"],
    outputs: ["OUT1", "OUT2"],
    parameters: {},
    description: "Pressure nodal junction for flow distribution and mixing.",
  },
};

export function getModuleDescriptor(type: string): ModuleDescriptor | undefined {
  const norm = type.toUpperCase().replace(/^GP\//, "");
  return ROCETS_MODULE_CATALOG[norm];
}

export const ROCETS_MODULE_DESCRIPTORS = ROCETS_MODULE_CATALOG;
