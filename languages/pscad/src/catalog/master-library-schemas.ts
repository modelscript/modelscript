// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * PSCAD v5 Master Library Component Schema Catalog & LSP Intelligence Engine.
 *
 * Provides rich multi-tab parameter schemas (with physical units, bounds, defaults,
 * and enum options), XML component synthesis for canvas drag-and-drop (`addComponent`),
 * context-aware `.pscx` autocomplete, engineering hover cards with computed impedances,
 * Go-to-Definition, Document Symbols, and 1-click Quick-Fix Code Actions (`M6001–M6008`).
 */

import { lintPscx } from "../lints/index.js";
import { extractEmtNetlist } from "../netlist/emt-netlist.js";
import { parsePscx } from "../parser/pscx-parser.js";

export interface PscadParameterOption {
  label: string;
  value: string;
}

export interface PscadParameterSchema {
  key: string;
  aliases?: string[] | undefined;
  label: string;
  tab: "General" | "Ratings" | "Impedances" | "Control" | "Geometry" | "Protection";
  group: string;
  kind: "number" | "string" | "boolean" | "select";
  unit?: string | undefined;
  defaultValue: string | number | boolean;
  min?: number | undefined;
  max?: number | undefined;
  options?: PscadParameterOption[] | undefined;
  description: string;
}

export interface PscadPortSchema {
  name: string;
  kind: "electrical" | "signal";
  side: "left" | "right" | "top" | "bottom";
  offsetX: number;
  offsetY: number;
}

export interface PscadComponentSchema {
  className: string;
  aliases: string[];
  label: string;
  category:
    | "Sources & Rotating Machines"
    | "Transformers, Lines & Cables"
    | "Power Electronics, HVDC & FACTS"
    | "Switchgear & Protection"
    | "CSMF Control Blocks"
    | "Meters, Probes & Buses";
  domain: "electrical" | "control" | "meter" | "bus";
  description: string;
  defaultWidth: number;
  defaultHeight: number;
  ports: PscadPortSchema[];
  parameters: PscadParameterSchema[];
}

export const MASTER_LIBRARY_SCHEMAS: PscadComponentSchema[] = [
  // ── 1. Sources & Rotating Machines ─────────────────────────────────────────
  {
    className: "master:source3",
    aliases: ["source_3", "source3", "source_3p", "source_1", "vsrc"],
    label: "3-Phase Voltage Source",
    category: "Sources & Rotating Machines",
    domain: "electrical",
    description: "Three-phase AC Thévenin equivalent voltage source with internal R-L impedance.",
    defaultWidth: 60,
    defaultHeight: 60,
    ports: [{ name: "Term", kind: "electrical", side: "right", offsetX: 36, offsetY: 0 }],
    parameters: [
      {
        key: "Name",
        label: "Source Name",
        tab: "General",
        group: "Identification",
        kind: "string",
        defaultValue: "Src1",
        description: "Unique source identifier",
      },
      {
        key: "V",
        aliases: ["v", "Vm", "kv"],
        label: "Base Voltage (L-L RMS)",
        tab: "Ratings",
        group: "Electrical Ratings",
        kind: "number",
        unit: "kV",
        defaultValue: 230.0,
        min: 0.1,
        description: "Line-to-line RMS nominal voltage",
      },
      {
        key: "MVA",
        aliases: ["mva"],
        label: "Base Power",
        tab: "Ratings",
        group: "Electrical Ratings",
        kind: "number",
        unit: "MVA",
        defaultValue: 100.0,
        min: 0.1,
        description: "Three-phase MVA rating",
      },
      {
        key: "f",
        aliases: ["freq", "F"],
        label: "Fundamental Frequency",
        tab: "Ratings",
        group: "Electrical Ratings",
        kind: "number",
        unit: "Hz",
        defaultValue: 60.0,
        min: 1.0,
        max: 400.0,
        description: "Nominal AC frequency",
      },
      {
        key: "Ph",
        aliases: ["phase"],
        label: "Initial Phase Angle",
        tab: "Ratings",
        group: "Electrical Ratings",
        kind: "number",
        unit: "deg",
        defaultValue: 0.0,
        description: "Voltage source initial phase angle",
      },
      {
        key: "R",
        aliases: ["R1s"],
        label: "Internal Series Resistance",
        tab: "Impedances",
        group: "Source Impedance",
        kind: "number",
        unit: "Ω",
        defaultValue: 0.05,
        min: 0.0,
        description: "Positive-sequence internal series resistance",
      },
      {
        key: "L",
        aliases: ["L1p"],
        label: "Internal Series Inductance",
        tab: "Impedances",
        group: "Source Impedance",
        kind: "number",
        unit: "H",
        defaultValue: 0.005,
        min: 0.0,
        description: "Positive-sequence internal series inductance",
      },
    ],
  },
  {
    className: "master:sync_machine",
    aliases: ["sync_machine", "synchronous_machine", "syncgen"],
    label: "Synchronous Machine (Subtransient)",
    category: "Sources & Rotating Machines",
    domain: "electrical",
    description:
      "6th-order Park dq0 subtransient synchronous generator with multi-mass shaft, IEEE ST1A AVR & TGOV1 governor.",
    defaultWidth: 60,
    defaultHeight: 60,
    ports: [
      { name: "Term", kind: "electrical", side: "right", offsetX: 36, offsetY: 0 },
      { name: "Ef", kind: "signal", side: "top", offsetX: 0, offsetY: -18 },
      { name: "Pm", kind: "signal", side: "left", offsetX: -36, offsetY: 0 },
    ],
    parameters: [
      {
        key: "Name",
        label: "Generator Name",
        tab: "General",
        group: "Identification",
        kind: "string",
        defaultValue: "SyncGen1",
        description: "Machine instance name",
      },
      {
        key: "MVA",
        label: "Rated Apparent Power",
        tab: "Ratings",
        group: "Nominal Ratings",
        kind: "number",
        unit: "MVA",
        defaultValue: 250.0,
        min: 0.1,
        description: "3-phase rated MVA",
      },
      {
        key: "V",
        label: "Rated Line Voltage",
        tab: "Ratings",
        group: "Nominal Ratings",
        kind: "number",
        unit: "kV",
        defaultValue: 18.0,
        min: 0.1,
        description: "Rated line-to-line RMS voltage",
      },
      {
        key: "freq",
        label: "Rated Frequency",
        tab: "Ratings",
        group: "Nominal Ratings",
        kind: "number",
        unit: "Hz",
        defaultValue: 60.0,
        min: 1.0,
        description: "Nominal synchronous frequency",
      },
      {
        key: "H",
        label: "Inertia Constant (H)",
        tab: "Ratings",
        group: "Rotor Mechanics",
        kind: "number",
        unit: "s",
        defaultValue: 3.5,
        min: 0.05,
        description: "Combined turbine-generator inertia constant",
      },
      {
        key: "D",
        label: "Rotor Damping (D)",
        tab: "Ratings",
        group: "Rotor Mechanics",
        kind: "number",
        unit: "pu",
        defaultValue: 2.0,
        min: 0.0,
        description: "Speed damping coefficient",
      },
      {
        key: "Xd",
        label: "d-Axis Synchronous Reactance (Xd)",
        tab: "Impedances",
        group: "d/q Reactances",
        kind: "number",
        unit: "pu",
        defaultValue: 1.8,
        min: 0.05,
        description: "Unsaturated d-axis synchronous reactance",
      },
      {
        key: "Xd_prime",
        label: "d-Axis Transient Reactance (Xd')",
        tab: "Impedances",
        group: "d/q Reactances",
        kind: "number",
        unit: "pu",
        defaultValue: 0.3,
        min: 0.02,
        description: "d-axis transient reactance (must be < Xd)",
      },
      {
        key: "Xd_sub",
        label: "d-Axis Subtransient Reactance (Xd'')",
        tab: "Impedances",
        group: "d/q Reactances",
        kind: "number",
        unit: "pu",
        defaultValue: 0.2,
        min: 0.01,
        description: "d-axis subtransient reactance (must be < Xd')",
      },
      {
        key: "Xq",
        label: "q-Axis Synchronous Reactance (Xq)",
        tab: "Impedances",
        group: "d/q Reactances",
        kind: "number",
        unit: "pu",
        defaultValue: 1.7,
        min: 0.05,
        description: "Unsaturated q-axis synchronous reactance",
      },
      {
        key: "Xq_prime",
        label: "q-Axis Transient Reactance (Xq')",
        tab: "Impedances",
        group: "d/q Reactances",
        kind: "number",
        unit: "pu",
        defaultValue: 0.45,
        min: 0.02,
        description: "q-axis transient reactance",
      },
      {
        key: "Xq_sub",
        label: "q-Axis Subtransient Reactance (Xq'')",
        tab: "Impedances",
        group: "d/q Reactances",
        kind: "number",
        unit: "pu",
        defaultValue: 0.2,
        min: 0.01,
        description: "q-axis subtransient reactance",
      },
      {
        key: "Pm",
        label: "Mechanical Power Input",
        tab: "Control",
        group: "Operating Point",
        kind: "number",
        unit: "pu",
        defaultValue: 0.85,
        description: "Initial turbine mechanical power",
      },
      {
        key: "Ef",
        label: "Excitation Field Voltage",
        tab: "Control",
        group: "Operating Point",
        kind: "number",
        unit: "pu",
        defaultValue: 1.2,
        description: "Exciter field voltage",
      },
    ],
  },
  {
    className: "master:ind_machine",
    aliases: ["ind_machine", "induction_machine", "dfig", "master:dfig"],
    label: "Induction Machine / DFIG",
    category: "Sources & Rotating Machines",
    domain: "electrical",
    description:
      "5th-order 3-phase squirrel-cage motor or wound-rotor DFIG wind generator with active rotor crowbar protection.",
    defaultWidth: 60,
    defaultHeight: 60,
    ports: [{ name: "Term", kind: "electrical", side: "right", offsetX: 36, offsetY: 0 }],
    parameters: [
      {
        key: "Name",
        label: "Machine Name",
        tab: "General",
        group: "Identification",
        kind: "string",
        defaultValue: "IndMachine1",
        description: "Induction machine or DFIG identifier",
      },
      {
        key: "machine_type",
        aliases: ["type"],
        label: "Rotor Configuration",
        tab: "General",
        group: "Configuration",
        kind: "select",
        defaultValue: "squirrel_cage",
        options: [
          { label: "Squirrel-Cage Induction Motor", value: "squirrel_cage" },
          { label: "Doubly-Fed Induction Generator (DFIG)", value: "dfig" },
        ],
        description: "Short-circuited squirrel-cage rotor or converter-fed DFIG rotor",
      },
      {
        key: "MVA",
        label: "Rated Power",
        tab: "Ratings",
        group: "Electrical Ratings",
        kind: "number",
        unit: "MVA",
        defaultValue: 10.0,
        min: 0.01,
        description: "3-phase MVA base rating",
      },
      {
        key: "V",
        label: "Rated Stator Voltage",
        tab: "Ratings",
        group: "Electrical Ratings",
        kind: "number",
        unit: "kV",
        defaultValue: 13.8,
        min: 0.1,
        description: "Stator L-L RMS voltage",
      },
      {
        key: "H",
        label: "Rotor Inertia Constant",
        tab: "Ratings",
        group: "Mechanical",
        kind: "number",
        unit: "s",
        defaultValue: 1.5,
        min: 0.05,
        description: "Inertia constant H",
      },
      {
        key: "slip",
        aliases: ["s0", "initial_slip"],
        label: "Initial Slip (s)",
        tab: "Control",
        group: "Operating Point",
        kind: "number",
        unit: "pu",
        defaultValue: 0.02,
        description: "Initial slip (>0 motoring, <0 super-synchronous generating)",
      },
      {
        key: "Tm",
        aliases: ["T_load"],
        label: "Mechanical Shaft Torque",
        tab: "Control",
        group: "Operating Point",
        kind: "number",
        unit: "pu",
        defaultValue: 0.6,
        description: "Load torque (>0) or wind turbine drive torque (<0)",
      },
      {
        key: "Rs",
        label: "Stator Resistance (Rs)",
        tab: "Impedances",
        group: "Equivalent Circuit",
        kind: "number",
        unit: "pu",
        defaultValue: 0.015,
        min: 0.001,
        description: "Stator winding resistance",
      },
      {
        key: "Xs",
        label: "Stator Leakage Reactance (Xs)",
        tab: "Impedances",
        group: "Equivalent Circuit",
        kind: "number",
        unit: "pu",
        defaultValue: 0.1,
        min: 0.01,
        description: "Stator leakage reactance",
      },
      {
        key: "Xm",
        label: "Magnetizing Reactance (Xm)",
        tab: "Impedances",
        group: "Equivalent Circuit",
        kind: "number",
        unit: "pu",
        defaultValue: 3.5,
        min: 0.2,
        description: "Air-gap magnetizing reactance",
      },
      {
        key: "Rr",
        label: "Rotor Resistance (Rr')",
        tab: "Impedances",
        group: "Equivalent Circuit",
        kind: "number",
        unit: "pu",
        defaultValue: 0.015,
        min: 0.001,
        description: "Referred rotor resistance",
      },
      {
        key: "Xr",
        label: "Rotor Leakage Reactance (Xr')",
        tab: "Impedances",
        group: "Equivalent Circuit",
        kind: "number",
        unit: "pu",
        defaultValue: 0.1,
        min: 0.01,
        description: "Referred rotor leakage reactance",
      },
      {
        key: "I_crowbar",
        aliases: ["crowbar_threshold"],
        label: "DFIG Crowbar Trigger Current",
        tab: "Protection",
        group: "Rotor Crowbar",
        kind: "number",
        unit: "pu",
        defaultValue: 1.8,
        min: 1.0,
        description: "Rotor current magnitude threshold that triggers active crowbar",
      },
      {
        key: "R_cb",
        aliases: ["crowbar_r"],
        label: "DFIG Crowbar Resistance",
        tab: "Protection",
        group: "Rotor Crowbar",
        kind: "number",
        unit: "pu",
        defaultValue: 0.15,
        min: 0.01,
        description: "Active rotor crowbar bypass resistance",
      },
    ],
  },

  // ── 2. Transformers, Lines & Cables ────────────────────────────────────────
  {
    className: "master:xfmr-3p2w",
    aliases: ["xfmr-3p2w", "xfmr_3p2w", "transformer"],
    label: "3-Phase 2-Winding Transformer",
    category: "Transformers, Lines & Cables",
    domain: "electrical",
    description:
      "Three-phase 2-winding power transformer with turns ratio, vector group phase shift, and anhysteretic core saturation.",
    defaultWidth: 72,
    defaultHeight: 60,
    ports: [
      { name: "N1", kind: "electrical", side: "left", offsetX: -36, offsetY: 0 },
      { name: "N2", kind: "electrical", side: "right", offsetX: 36, offsetY: 0 },
    ],
    parameters: [
      {
        key: "Name",
        label: "Transformer Name",
        tab: "General",
        group: "Identification",
        kind: "string",
        defaultValue: "T1",
        description: "Transformer identifier",
      },
      {
        key: "Connection",
        label: "Winding Vector Group",
        tab: "General",
        group: "Configuration",
        kind: "select",
        defaultValue: "Yg-Yg",
        options: [
          { label: "Wye-Grounded / Wye-Grounded (Yg-Yg)", value: "Yg-Yg" },
          { label: "Wye-Grounded / Delta (Yg-D)", value: "Yg-D" },
          { label: "Delta / Wye-Grounded (D-Yg)", value: "D-Yg" },
          { label: "Delta / Delta (D-D)", value: "D-D" },
        ],
        description: "Primary and secondary winding connection topology",
      },
      {
        key: "MVA",
        aliases: ["Tmva"],
        label: "Rated Power (3-Phase)",
        tab: "Ratings",
        group: "Ratings",
        kind: "number",
        unit: "MVA",
        defaultValue: 250.0,
        min: 0.1,
        description: "Transformer 3-phase MVA rating",
      },
      {
        key: "V1",
        aliases: ["v1"],
        label: "Primary Winding Voltage (L-L)",
        tab: "Ratings",
        group: "Ratings",
        kind: "number",
        unit: "kV",
        defaultValue: 18.0,
        min: 0.1,
        description: "Primary nominal RMS voltage",
      },
      {
        key: "V2",
        aliases: ["v2"],
        label: "Secondary Winding Voltage (L-L)",
        tab: "Ratings",
        group: "Ratings",
        kind: "number",
        unit: "kV",
        defaultValue: 230.0,
        min: 0.1,
        description: "Secondary nominal RMS voltage",
      },
      {
        key: "X",
        aliases: ["Xl", "leakage_reactance"],
        label: "Leakage Reactance (Xl)",
        tab: "Impedances",
        group: "Short-Circuit",
        kind: "number",
        unit: "pu",
        defaultValue: 0.1,
        min: 0.005,
        max: 0.5,
        description: "Positive-sequence leakage reactance",
      },
      {
        key: "Knee",
        aliases: ["V_knee"],
        label: "Saturation Knee Voltage",
        tab: "Impedances",
        group: "Core Saturation",
        kind: "number",
        unit: "pu",
        defaultValue: 1.2,
        min: 1.0,
        max: 2.0,
        description: "Magnetizing saturation knee point in pu",
      },
    ],
  },
  {
    className: "master:tline",
    aliases: ["tline", "pi_line", "bergeron_line"],
    label: "Overhead Transmission Line",
    category: "Transformers, Lines & Cables",
    domain: "electrical",
    description:
      "3-Phase coupled overhead transmission line supporting Bergeron, Carson/Deri-Semlyen FDPM, and Pi-section models.",
    defaultWidth: 80,
    defaultHeight: 48,
    ports: [
      { name: "Send", kind: "electrical", side: "left", offsetX: -36, offsetY: 0 },
      { name: "Recv", kind: "electrical", side: "right", offsetX: 36, offsetY: 0 },
    ],
    parameters: [
      {
        key: "Name",
        label: "Line Name",
        tab: "General",
        group: "Identification",
        kind: "string",
        defaultValue: "Line1",
        description: "Transmission line identifier",
      },
      {
        key: "model_type",
        aliases: ["model"],
        label: "Line Formulation",
        tab: "General",
        group: "Formulation",
        kind: "select",
        defaultValue: "bergeron",
        options: [
          { label: "Bergeron Traveling-Wave", value: "bergeron" },
          { label: "Frequency-Dependent Phase/Modal (FDPM)", value: "fd" },
          { label: "Nominal Pi-Section", value: "pi" },
        ],
        description: "Distributed traveling-wave or lumped pi-equivalent model",
      },
      {
        key: "length",
        aliases: ["Length", "len"],
        label: "Line Length",
        tab: "Geometry",
        group: "Corridor",
        kind: "number",
        unit: "km",
        defaultValue: 100.0,
        min: 0.1,
        description: "Physical corridor length in km",
      },
      {
        key: "R",
        aliases: ["r_per_km"],
        label: "Positive-Seq Resistance (R1)",
        tab: "Impedances",
        group: "RLC per km",
        kind: "number",
        unit: "Ω/km",
        defaultValue: 0.032,
        min: 0.0,
        description: "Positive-sequence resistance per km",
      },
      {
        key: "L",
        aliases: ["l_per_km"],
        label: "Positive-Seq Inductance (L1)",
        tab: "Impedances",
        group: "RLC per km",
        kind: "number",
        unit: "H/km",
        defaultValue: 0.001,
        min: 1e-6,
        description: "Positive-sequence inductance per km",
      },
      {
        key: "C",
        aliases: ["c_per_km"],
        label: "Positive-Seq Capacitance (C1)",
        tab: "Impedances",
        group: "RLC per km",
        kind: "number",
        unit: "F/km",
        defaultValue: 11.5e-9,
        min: 1e-12,
        description: "Positive-sequence shunt capacitance per km",
      },
      {
        key: "conductor_height",
        label: "Average Conductor Height",
        tab: "Geometry",
        group: "Tower Geometry",
        kind: "number",
        unit: "m",
        defaultValue: 22.0,
        min: 2.0,
        description: "Average phase conductor height above ground",
      },
      {
        key: "conductor_radius",
        label: "Conductor Outer Radius",
        tab: "Geometry",
        group: "Tower Geometry",
        kind: "number",
        unit: "m",
        defaultValue: 0.016,
        min: 0.001,
        description: "Phase conductor radius",
      },
      {
        key: "soil_resistivity",
        label: "Earth Soil Resistivity",
        tab: "Geometry",
        group: "Tower Geometry",
        kind: "number",
        unit: "Ω·m",
        defaultValue: 100.0,
        min: 1.0,
        description: "Carson earth return soil resistivity",
      },
    ],
  },
  {
    className: "master:cable",
    aliases: ["cable", "coax_cable", "submarine_cable"],
    label: "Underground / Submarine Coaxial Cable",
    category: "Transformers, Lines & Cables",
    domain: "electrical",
    description:
      "Coaxial core-sheath-armour XLPE underground or submarine cable using Wedepohl-Wilcox Bessel skin effect & Pollaczek earth return.",
    defaultWidth: 80,
    defaultHeight: 48,
    ports: [
      { name: "Send", kind: "electrical", side: "left", offsetX: -36, offsetY: 0 },
      { name: "Recv", kind: "electrical", side: "right", offsetX: 36, offsetY: 0 },
    ],
    parameters: [
      {
        key: "Name",
        label: "Cable Name",
        tab: "General",
        group: "Identification",
        kind: "string",
        defaultValue: "SubCable1",
        description: "Cable identifier",
      },
      {
        key: "length",
        label: "Cable Route Length",
        tab: "Geometry",
        group: "Route",
        kind: "number",
        unit: "km",
        defaultValue: 45.0,
        min: 0.1,
        description: "Total route length in km",
      },
      {
        key: "core_radius",
        label: "Core Conductor Radius (r1)",
        tab: "Geometry",
        group: "Coaxial Cross-Section",
        kind: "number",
        unit: "m",
        defaultValue: 0.022,
        min: 0.002,
        description: "Inner copper/aluminium core radius",
      },
      {
        key: "insulation_radius",
        label: "XLPE Insulation Outer Radius (r2)",
        tab: "Geometry",
        group: "Coaxial Cross-Section",
        kind: "number",
        unit: "m",
        defaultValue: 0.052,
        min: 0.005,
        description: "Main insulation outer radius (inner sheath radius)",
      },
      {
        key: "eps_r",
        label: "XLPE Relative Permittivity (εr)",
        tab: "Impedances",
        group: "Dielectric",
        kind: "number",
        defaultValue: 2.3,
        min: 1.0,
        max: 10.0,
        description: "Relative permittivity of main insulation",
      },
      {
        key: "burial_depth",
        label: "Burial / Seabed Depth",
        tab: "Geometry",
        group: "Route",
        kind: "number",
        unit: "m",
        defaultValue: 1.5,
        min: 0.1,
        description: "Burial depth below ground/seabed surface",
      },
    ],
  },
  {
    className: "master:resistor",
    aliases: ["resistor", "r"],
    label: "3-Phase Resistor",
    category: "Transformers, Lines & Cables",
    domain: "electrical",
    description: "Three-phase linear series or shunt resistance branch.",
    defaultWidth: 56,
    defaultHeight: 36,
    ports: [
      { name: "p", kind: "electrical", side: "left", offsetX: -18, offsetY: 0 },
      { name: "n", kind: "electrical", side: "right", offsetX: 18, offsetY: 0 },
    ],
    parameters: [
      {
        key: "Name",
        label: "Name",
        tab: "General",
        group: "General",
        kind: "string",
        defaultValue: "R1",
        description: "Branch name",
      },
      {
        key: "R",
        label: "Resistance (R)",
        tab: "Impedances",
        group: "Parameters",
        kind: "number",
        unit: "Ω",
        defaultValue: 10.0,
        min: 1e-6,
        description: "Resistance per phase in Ohms",
      },
    ],
  },
  {
    className: "master:inductor",
    aliases: ["inductor", "l"],
    label: "3-Phase Inductor",
    category: "Transformers, Lines & Cables",
    domain: "electrical",
    description: "Three-phase linear series or shunt reactor.",
    defaultWidth: 56,
    defaultHeight: 36,
    ports: [
      { name: "p", kind: "electrical", side: "left", offsetX: -18, offsetY: 0 },
      { name: "n", kind: "electrical", side: "right", offsetX: 18, offsetY: 0 },
    ],
    parameters: [
      {
        key: "Name",
        label: "Name",
        tab: "General",
        group: "General",
        kind: "string",
        defaultValue: "L1",
        description: "Reactor name",
      },
      {
        key: "L",
        label: "Inductance (L)",
        tab: "Impedances",
        group: "Parameters",
        kind: "number",
        unit: "H",
        defaultValue: 0.01,
        min: 1e-9,
        description: "Inductance per phase in Henries",
      },
    ],
  },
  {
    className: "master:capacitor",
    aliases: ["capacitor", "c"],
    label: "3-Phase Capacitor Bank",
    category: "Transformers, Lines & Cables",
    domain: "electrical",
    description: "Three-phase shunt or series capacitor bank.",
    defaultWidth: 56,
    defaultHeight: 36,
    ports: [
      { name: "p", kind: "electrical", side: "left", offsetX: -18, offsetY: 0 },
      { name: "n", kind: "electrical", side: "right", offsetX: 18, offsetY: 0 },
    ],
    parameters: [
      {
        key: "Name",
        label: "Name",
        tab: "General",
        group: "General",
        kind: "string",
        defaultValue: "C1",
        description: "Capacitor bank name",
      },
      {
        key: "C",
        label: "Capacitance (C)",
        tab: "Impedances",
        group: "Parameters",
        kind: "number",
        unit: "F",
        defaultValue: 50e-6,
        min: 1e-12,
        description: "Capacitance per phase in Farads",
      },
    ],
  },

  // ── 3. Power Electronics, HVDC & FACTS ─────────────────────────────────────
  {
    className: "master:vsc_pwm",
    aliases: ["vsc_pwm", "vsc"],
    label: "Two-Level VSC PWM Converter",
    category: "Power Electronics, HVDC & FACTS",
    domain: "electrical",
    description: "Three-phase 2-level Sine-Triangle PWM Voltage-Source Converter with sub-step firing interpolation.",
    defaultWidth: 72,
    defaultHeight: 60,
    ports: [{ name: "AC", kind: "electrical", side: "left", offsetX: -36, offsetY: 0 }],
    parameters: [
      {
        key: "Name",
        label: "Converter Name",
        tab: "General",
        group: "Identification",
        kind: "string",
        defaultValue: "VSC1",
        description: "VSC bridge identifier",
      },
      {
        key: "MVA",
        label: "Rated Power",
        tab: "Ratings",
        group: "Ratings",
        kind: "number",
        unit: "MVA",
        defaultValue: 150.0,
        min: 0.1,
        description: "Converter MVA rating",
      },
      {
        key: "V",
        label: "Rated AC Voltage (L-L)",
        tab: "Ratings",
        group: "Ratings",
        kind: "number",
        unit: "kV",
        defaultValue: 230.0,
        min: 0.1,
        description: "Nominal AC terminal voltage",
      },
      {
        key: "Vdc",
        label: "Nominal DC-Link Voltage",
        tab: "Ratings",
        group: "DC Link",
        kind: "number",
        unit: "kV",
        defaultValue: 400.0,
        min: 0.1,
        description: "Pole-to-pole DC-link voltage",
      },
      {
        key: "f_carrier",
        label: "PWM Carrier Frequency",
        tab: "Control",
        group: "Modulation",
        kind: "number",
        unit: "Hz",
        defaultValue: 1980.0,
        min: 100.0,
        max: 50000.0,
        description: "Triangular PWM carrier switching frequency",
      },
    ],
  },
  {
    className: "master:lcc_6pulse",
    aliases: ["lcc_6pulse", "lcc"],
    label: "6-Pulse Graetz LCC HVDC Bridge",
    category: "Power Electronics, HVDC & FACTS",
    domain: "electrical",
    description: "Line-commutated 6-pulse thyristor converter bridge with firing angle α and commutation overlap μ.",
    defaultWidth: 72,
    defaultHeight: 60,
    ports: [{ name: "AC", kind: "electrical", side: "left", offsetX: -36, offsetY: 0 }],
    parameters: [
      {
        key: "Name",
        label: "Bridge Name",
        tab: "General",
        group: "Identification",
        kind: "string",
        defaultValue: "LCC1",
        description: "LCC thyristor bridge identifier",
      },
      {
        key: "MVA",
        label: "Rated Power",
        tab: "Ratings",
        group: "Ratings",
        kind: "number",
        unit: "MVA",
        defaultValue: 500.0,
        min: 0.1,
        description: "Converter rating",
      },
      {
        key: "V",
        label: "AC Commutation Voltage",
        tab: "Ratings",
        group: "Ratings",
        kind: "number",
        unit: "kV",
        defaultValue: 230.0,
        min: 0.1,
        description: "AC commutation bus RMS voltage",
      },
      {
        key: "Vdc",
        label: "Rated DC Voltage",
        tab: "Ratings",
        group: "Ratings",
        kind: "number",
        unit: "kV",
        defaultValue: 500.0,
        min: 0.1,
        description: "Nominal DC pole voltage",
      },
      {
        key: "alpha_deg",
        aliases: ["alpha"],
        label: "Firing Delay Angle (α)",
        tab: "Control",
        group: "Firing Control",
        kind: "number",
        unit: "deg",
        defaultValue: 15.0,
        min: 5.0,
        max: 165.0,
        description: "Thyristor firing angle α in degrees",
      },
    ],
  },
  {
    className: "master:mmc_thevenin",
    aliases: ["mmc_thevenin", "mmc"],
    label: "Modular Multilevel Converter (MMC)",
    category: "Power Electronics, HVDC & FACTS",
    domain: "electrical",
    description: "Half-bridge / full-bridge Thévenin equivalent arm MMC with capacitor voltage sorting and CCSC.",
    defaultWidth: 72,
    defaultHeight: 60,
    ports: [{ name: "AC", kind: "electrical", side: "left", offsetX: -36, offsetY: 0 }],
    parameters: [
      {
        key: "Name",
        label: "MMC Station Name",
        tab: "General",
        group: "Identification",
        kind: "string",
        defaultValue: "MMC1",
        description: "MMC converter station identifier",
      },
      {
        key: "MVA",
        label: "Rated Station Power",
        tab: "Ratings",
        group: "Ratings",
        kind: "number",
        unit: "MVA",
        defaultValue: 400.0,
        min: 1.0,
        description: "Station MVA rating",
      },
      {
        key: "V",
        label: "Rated AC Voltage",
        tab: "Ratings",
        group: "Ratings",
        kind: "number",
        unit: "kV",
        defaultValue: 230.0,
        min: 1.0,
        description: "AC grid L-L voltage",
      },
      {
        key: "Vdc",
        label: "Pole-to-Pole DC Voltage",
        tab: "Ratings",
        group: "Ratings",
        kind: "number",
        unit: "kV",
        defaultValue: 400.0,
        min: 1.0,
        description: "HVDC link voltage",
      },
      {
        key: "N_sm",
        aliases: ["num_submodules"],
        label: "Submodules per Arm (N)",
        tab: "Control",
        group: "Multilevel Arm",
        kind: "number",
        defaultValue: 40,
        min: 4,
        max: 512,
        description: "Number of half-bridge submodules per phase arm",
      },
      {
        key: "C_sm",
        label: "Submodule Capacitance",
        tab: "Impedances",
        group: "Multilevel Arm",
        kind: "number",
        unit: "F",
        defaultValue: 0.01,
        min: 1e-5,
        description: "Individual submodule DC capacitor value",
      },
      {
        key: "L_arm",
        label: "Arm Reactor Inductance",
        tab: "Impedances",
        group: "Multilevel Arm",
        kind: "number",
        unit: "H",
        defaultValue: 0.015,
        min: 1e-4,
        description: "Phase arm buffer inductance",
      },
    ],
  },
  {
    className: "master:fmu_ibr",
    aliases: ["fmu_ibr", "inverter_fmu", "ibr"],
    label: "OEM Black-Box IBR FMU (FMI 2.0/3.0)",
    category: "Power Electronics, HVDC & FACTS",
    domain: "electrical",
    description:
      "Multi-rate co-simulated OEM Inverter-Based Resource (Wind/Solar/BESS) FMU with IEEE 2800 ride-through telemetry.",
    defaultWidth: 60,
    defaultHeight: 60,
    ports: [{ name: "POI", kind: "electrical", side: "right", offsetX: 36, offsetY: 0 }],
    parameters: [
      {
        key: "Name",
        label: "IBR Plant Name",
        tab: "General",
        group: "Identification",
        kind: "string",
        defaultValue: "IBR_Plant1",
        description: "IBR plant instance name",
      },
      {
        key: "fmu_path",
        label: "FMU Archive Path",
        tab: "General",
        group: "Co-Simulation",
        kind: "string",
        defaultValue: "vendor_ibr_controller.fmu",
        description: "Path to FMI 2.0/3.0 .fmu binary",
      },
      {
        key: "control_mode",
        label: "Control Architecture",
        tab: "Control",
        group: "Controller",
        kind: "select",
        defaultValue: "grid_following",
        options: [
          { label: "Grid-Following (PLL + Current Loop)", value: "grid_following" },
          { label: "Grid-Forming (Virtual Synchronous Machine)", value: "grid_forming" },
          { label: "Frequency/Voltage Droop", value: "droop" },
        ],
        description: "Inverter synchronization and control mode",
      },
      {
        key: "MVA",
        label: "Rated Plant Capacity",
        tab: "Ratings",
        group: "Ratings",
        kind: "number",
        unit: "MVA",
        defaultValue: 150.0,
        min: 0.1,
        description: "Plant rated MVA at POI",
      },
      {
        key: "V",
        label: "POI Nominal Voltage",
        tab: "Ratings",
        group: "Ratings",
        kind: "number",
        unit: "kV",
        defaultValue: 230.0,
        min: 0.1,
        description: "POI nominal L-L RMS voltage",
      },
    ],
  },

  // ── 4. Switchgear & Protection ─────────────────────────────────────────────
  {
    className: "master:breaker3",
    aliases: ["breaker3", "breaker", "brk"],
    label: "3-Phase Circuit Breaker",
    category: "Switchgear & Protection",
    domain: "electrical",
    description:
      "Three-phase AC circuit breaker with natural current-zero arc extinction, current chopping, and single-pole tripping.",
    defaultWidth: 48,
    defaultHeight: 44,
    ports: [
      { name: "N1", kind: "electrical", side: "left", offsetX: -18, offsetY: 0 },
      { name: "N2", kind: "electrical", side: "right", offsetX: 18, offsetY: 0 },
    ],
    parameters: [
      {
        key: "Name",
        label: "Breaker Name",
        tab: "General",
        group: "Identification",
        kind: "string",
        defaultValue: "BRK1",
        description: "Circuit breaker identifier",
      },
      {
        key: "Status",
        label: "Initial Contact State",
        tab: "Control",
        group: "Switching Schedule",
        kind: "select",
        defaultValue: "Closed",
        options: [
          { label: "Initially Closed", value: "Closed" },
          { label: "Initially Open", value: "Open" },
        ],
        description: "Breaker state at t = 0",
      },
      {
        key: "t_open",
        label: "Trip / Opening Time",
        tab: "Control",
        group: "Switching Schedule",
        kind: "number",
        unit: "s",
        defaultValue: 0.06,
        min: 0.0,
        description: "Scheduled trip command time",
      },
      {
        key: "t_close",
        label: "Reclosing Time",
        tab: "Control",
        group: "Switching Schedule",
        kind: "number",
        unit: "s",
        defaultValue: 0.25,
        min: 0.0,
        description: "Scheduled auto-reclose time",
      },
      {
        key: "chopping_current",
        label: "Current Chopping Limit",
        tab: "Protection",
        group: "Arc Extinction",
        kind: "number",
        unit: "A",
        defaultValue: 0.5,
        min: 0.0,
        description: "Instantaneous current level below which arc extinguishes",
      },
    ],
  },
  {
    className: "master:tpflt",
    aliases: ["tpflt", "fault"],
    label: "3-Phase Timed Fault",
    category: "Switchgear & Protection",
    domain: "electrical",
    description: "Timed symmetrical (3PH) or unbalanced (SLG, LL, DLG) short-circuit fault branch.",
    defaultWidth: 40,
    defaultHeight: 44,
    ports: [{ name: "Bus", kind: "electrical", side: "top", offsetX: 0, offsetY: -18 }],
    parameters: [
      {
        key: "Name",
        label: "Fault Name",
        tab: "General",
        group: "Identification",
        kind: "string",
        defaultValue: "FLT1",
        description: "Fault element identifier",
      },
      {
        key: "type",
        aliases: ["fault_type"],
        label: "Fault Type",
        tab: "Protection",
        group: "Fault Configuration",
        kind: "select",
        defaultValue: "SLG",
        options: [
          { label: "Single-Line-to-Ground (SLG / A-G)", value: "SLG" },
          { label: "Line-to-Line (LL / B-C)", value: "LL" },
          { label: "Double-Line-to-Ground (DLG / B-C-G)", value: "DLG" },
          { label: "Three-Phase Bolted/Impedance (3PH)", value: "3PH" },
        ],
        description: "Faulted phase combination",
      },
      {
        key: "t_start",
        aliases: ["TF"],
        label: "Fault Inception Time",
        tab: "Protection",
        group: "Timing",
        kind: "number",
        unit: "s",
        defaultValue: 0.05,
        min: 0.0,
        description: "Fault start time in seconds",
      },
      {
        key: "duration",
        aliases: ["DF"],
        label: "Fault Duration",
        tab: "Protection",
        group: "Timing",
        kind: "number",
        unit: "s",
        defaultValue: 0.08,
        min: 0.001,
        description: "Fault duration in seconds",
      },
      {
        key: "R",
        aliases: ["RON"],
        label: "Fault Arc Resistance",
        tab: "Impedances",
        group: "Impedance",
        kind: "number",
        unit: "Ω",
        defaultValue: 0.01,
        min: 1e-5,
        description: "Fault path resistance in Ohms",
      },
    ],
  },
  {
    className: "master:arrester",
    aliases: ["arrester", "mov", "surge_arrester"],
    label: "ZnO Metal-Oxide Surge Arrester",
    category: "Switchgear & Protection",
    domain: "electrical",
    description:
      "Gapless non-linear metal-oxide varistor (MOV) surge arrester with 3-segment piecewise power-law V-I curve.",
    defaultWidth: 40,
    defaultHeight: 54,
    ports: [{ name: "Top", kind: "electrical", side: "top", offsetX: 0, offsetY: -18 }],
    parameters: [
      {
        key: "Name",
        label: "Arrester Name",
        tab: "General",
        group: "Identification",
        kind: "string",
        defaultValue: "MOV1",
        description: "Surge arrester identifier",
      },
      {
        key: "Vref",
        aliases: ["protection_level_kv"],
        label: "Reference / Clamping Voltage (Vref)",
        tab: "Protection",
        group: "Nonlinear V-I",
        kind: "number",
        unit: "kV",
        defaultValue: 265.0,
        min: 1.0,
        description: "MOV reference knee voltage in kV (should exceed bus BaseKV)",
      },
    ],
  },

  // ── 5. CSMF Control System Modeling Functions ──────────────────────────────
  {
    className: "master:pi_ctlr",
    aliases: ["pi_ctlr", "pi"],
    label: "PI Controller (Proportional-Integral)",
    category: "CSMF Control Blocks",
    domain: "control",
    description:
      "Continuous-time Proportional-Integral (PI) controller with anti-windup output limits: G(s) = Kp + 1/(s·Ti).",
    defaultWidth: 64,
    defaultHeight: 42,
    ports: [
      { name: "in", kind: "signal", side: "left", offsetX: -18, offsetY: 0 },
      { name: "out", kind: "signal", side: "right", offsetX: 18, offsetY: 0 },
    ],
    parameters: [
      {
        key: "Name",
        label: "Block Name",
        tab: "General",
        group: "Identification",
        kind: "string",
        defaultValue: "PI1",
        description: "Control block signal name",
      },
      {
        key: "Kp",
        label: "Proportional Gain (Kp)",
        tab: "Control",
        group: "Transfer Function",
        kind: "number",
        defaultValue: 2.5,
        description: "Proportional gain",
      },
      {
        key: "Ti",
        label: "Integral Time Constant (Ti)",
        tab: "Control",
        group: "Transfer Function",
        kind: "number",
        unit: "s",
        defaultValue: 0.02,
        min: 1e-5,
        description: "Integral reset time constant",
      },
      {
        key: "max",
        aliases: ["UL"],
        label: "Upper Output Limit",
        tab: "Control",
        group: "Anti-Windup Limits",
        kind: "number",
        defaultValue: 1.5,
        description: "Maximum output saturation limit",
      },
      {
        key: "min",
        aliases: ["LL"],
        label: "Lower Output Limit",
        tab: "Control",
        group: "Anti-Windup Limits",
        kind: "number",
        defaultValue: -1.5,
        description: "Minimum output saturation limit",
      },
    ],
  },
  {
    className: "master:realpole",
    aliases: ["realpole", "lag"],
    label: "Real Pole (First-Order Low-Pass Lag)",
    category: "CSMF Control Blocks",
    domain: "control",
    description: "First-order lag filter block: G(s) = K / (1 + s·T).",
    defaultWidth: 64,
    defaultHeight: 42,
    ports: [
      { name: "in", kind: "signal", side: "left", offsetX: -18, offsetY: 0 },
      { name: "out", kind: "signal", side: "right", offsetX: 18, offsetY: 0 },
    ],
    parameters: [
      {
        key: "Name",
        label: "Block Name",
        tab: "General",
        group: "Identification",
        kind: "string",
        defaultValue: "Lag1",
        description: "Control block identifier",
      },
      {
        key: "G",
        aliases: ["K"],
        label: "DC Gain (K)",
        tab: "Control",
        group: "Transfer Function",
        kind: "number",
        defaultValue: 1.0,
        description: "Steady-state gain",
      },
      {
        key: "T",
        label: "Time Constant (T)",
        tab: "Control",
        group: "Transfer Function",
        kind: "number",
        unit: "s",
        defaultValue: 0.02,
        min: 1e-6,
        description: "Filter time constant",
      },
    ],
  },
  {
    className: "master:sum",
    aliases: ["sum", "add"],
    label: "Summing Junction (Σ)",
    category: "CSMF Control Blocks",
    domain: "control",
    description: "Weighted two-input algebraic summer / subtractor: y = s1·u1 + s2·u2.",
    defaultWidth: 44,
    defaultHeight: 44,
    ports: [
      { name: "in1", kind: "signal", side: "left", offsetX: -18, offsetY: -8 },
      { name: "in2", kind: "signal", side: "left", offsetX: -18, offsetY: 8 },
      { name: "out", kind: "signal", side: "right", offsetX: 18, offsetY: 0 },
    ],
    parameters: [
      {
        key: "Name",
        label: "Block Name",
        tab: "General",
        group: "Identification",
        kind: "string",
        defaultValue: "Sum1",
        description: "Summing block identifier",
      },
      {
        key: "s1",
        label: "Input 1 Sign / Weight",
        tab: "Control",
        group: "Weights",
        kind: "number",
        defaultValue: 1.0,
        description: "Multiplier on input 1",
      },
      {
        key: "s2",
        label: "Input 2 Sign / Weight",
        tab: "Control",
        group: "Weights",
        kind: "number",
        defaultValue: -1.0,
        description: "Multiplier on input 2 (-1 for error subtraction)",
      },
    ],
  },
  {
    className: "master:gain",
    aliases: ["gain"],
    label: "Scalar Gain Amplifier (K)",
    category: "CSMF Control Blocks",
    domain: "control",
    description: "Linear scalar multiplier block: y = K · u.",
    defaultWidth: 52,
    defaultHeight: 40,
    ports: [
      { name: "in", kind: "signal", side: "left", offsetX: -18, offsetY: 0 },
      { name: "out", kind: "signal", side: "right", offsetX: 18, offsetY: 0 },
    ],
    parameters: [
      {
        key: "Name",
        label: "Block Name",
        tab: "General",
        group: "Identification",
        kind: "string",
        defaultValue: "Gain1",
        description: "Gain block identifier",
      },
      {
        key: "K",
        label: "Gain Multiplier (K)",
        tab: "Control",
        group: "Parameters",
        kind: "number",
        defaultValue: 1.0,
        description: "Scalar gain factor",
      },
    ],
  },
  {
    className: "master:limit",
    aliases: ["limit", "limiter"],
    label: "Hard Limiter / Saturation",
    category: "CSMF Control Blocks",
    domain: "control",
    description: "Clamps continuous control signal between lower limit LL and upper limit UL.",
    defaultWidth: 56,
    defaultHeight: 40,
    ports: [
      { name: "in", kind: "signal", side: "left", offsetX: -18, offsetY: 0 },
      { name: "out", kind: "signal", side: "right", offsetX: 18, offsetY: 0 },
    ],
    parameters: [
      {
        key: "Name",
        label: "Block Name",
        tab: "General",
        group: "Identification",
        kind: "string",
        defaultValue: "Lim1",
        description: "Limiter block identifier",
      },
      {
        key: "UL",
        aliases: ["max"],
        label: "Upper Limit (UL)",
        tab: "Control",
        group: "Saturation Bounds",
        kind: "number",
        defaultValue: 1.2,
        description: "Maximum output value",
      },
      {
        key: "LL",
        aliases: ["min"],
        label: "Lower Limit (LL)",
        tab: "Control",
        group: "Saturation Bounds",
        kind: "number",
        defaultValue: -1.2,
        description: "Minimum output value",
      },
    ],
  },
  {
    className: "master:compar",
    aliases: ["compar", "relay"],
    label: "Threshold Comparator / Relay",
    category: "CSMF Control Blocks",
    domain: "control",
    description: "Outputs logic high (1.0) when input signal exceeds pickup threshold, driving breaker trip actuators.",
    defaultWidth: 56,
    defaultHeight: 40,
    ports: [
      { name: "in", kind: "signal", side: "left", offsetX: -18, offsetY: 0 },
      { name: "out", kind: "signal", side: "right", offsetX: 18, offsetY: 0 },
    ],
    parameters: [
      {
        key: "Name",
        label: "Comparator Name",
        tab: "General",
        group: "Identification",
        kind: "string",
        defaultValue: "Relay1",
        description: "Comparator identifier",
      },
      {
        key: "threshold",
        label: "Pickup Threshold",
        tab: "Protection",
        group: "Relay Settings",
        kind: "number",
        defaultValue: 1.5,
        description: "Signal level that triggers high output",
      },
    ],
  },
  {
    className: "master:const",
    aliases: ["const", "constant"],
    label: "Constant Setpoint Source",
    category: "CSMF Control Blocks",
    domain: "control",
    description: "Outputs a constant real reference setpoint signal.",
    defaultWidth: 48,
    defaultHeight: 34,
    ports: [{ name: "out", kind: "signal", side: "right", offsetX: 18, offsetY: 0 }],
    parameters: [
      {
        key: "Name",
        label: "Setpoint Name",
        tab: "General",
        group: "Identification",
        kind: "string",
        defaultValue: "Vref_Set",
        description: "Constant signal name",
      },
      {
        key: "value",
        aliases: ["K"],
        label: "Constant Value",
        tab: "Control",
        group: "Value",
        kind: "number",
        defaultValue: 1.0,
        description: "Numeric constant value",
      },
    ],
  },

  // ── 6. Meters, Probes & Buses ──────────────────────────────────────────────
  {
    className: "master:pgb",
    aliases: ["pgb", "probe", "oscilloscope"],
    label: "Output Channel / Oscilloscope Probe (PGB)",
    category: "Meters, Probes & Buses",
    domain: "meter",
    description:
      "PSCAD Graph Builder (PGB) output channel recording signal or waveform into COMTRADE and oscilloscope plots.",
    defaultWidth: 54,
    defaultHeight: 34,
    ports: [{ name: "in", kind: "signal", side: "left", offsetX: -18, offsetY: 0 }],
    parameters: [
      {
        key: "Name",
        label: "Channel Title",
        tab: "General",
        group: "Plot Channel",
        kind: "string",
        defaultValue: "V_POI_pu",
        description: "Oscilloscope trace title",
      },
      {
        key: "Units",
        label: "Engineering Units",
        tab: "General",
        group: "Plot Channel",
        kind: "string",
        defaultValue: "pu",
        description: "Displayed y-axis engineering unit",
      },
      {
        key: "Max",
        label: "Plot Y-Axis Max",
        tab: "General",
        group: "Scaling",
        kind: "number",
        defaultValue: 2.0,
        description: "Maximum display scale",
      },
      {
        key: "Min",
        label: "Plot Y-Axis Min",
        tab: "General",
        group: "Scaling",
        kind: "number",
        defaultValue: -2.0,
        description: "Minimum display scale",
      },
    ],
  },
  {
    className: "master:multimeter",
    aliases: ["multimeter", "voltmeter", "ammeter", "master:voltmeter", "master:ammeter"],
    label: "3-Phase Digital Multimeter (V, I, P, Q)",
    category: "Meters, Probes & Buses",
    domain: "meter",
    description:
      "Measures 3-phase instantaneous and RMS bus voltage, branch current, active power P (MW), and reactive power Q (Mvar).",
    defaultWidth: 48,
    defaultHeight: 44,
    ports: [
      { name: "N1", kind: "electrical", side: "left", offsetX: -18, offsetY: 0 },
      { name: "N2", kind: "electrical", side: "right", offsetX: 18, offsetY: 0 },
      { name: "Signal", kind: "signal", side: "top", offsetX: 0, offsetY: -18 },
    ],
    parameters: [
      {
        key: "Name",
        label: "Meter Name",
        tab: "General",
        group: "Identification",
        kind: "string",
        defaultValue: "Meter1",
        description: "Multimeter identifier",
      },
      {
        key: "Vrms",
        label: "Measure RMS Voltage",
        tab: "General",
        group: "Outputs",
        kind: "boolean",
        defaultValue: true,
        description: "Export RMS voltage signal",
      },
      {
        key: "P_Q",
        label: "Measure Active/Reactive Power",
        tab: "General",
        group: "Outputs",
        kind: "boolean",
        defaultValue: true,
        description: "Export 3-phase P & Q telemetry",
      },
    ],
  },
  {
    className: "master:datalabel",
    aliases: ["datalabel", "data_label", "radio_link"],
    label: "Wireless Data Label (Signal Net)",
    category: "Meters, Probes & Buses",
    domain: "control",
    description:
      "Wireless control signal label connecting matching signal nets across the schematic without crossing wires.",
    defaultWidth: 44,
    defaultHeight: 24,
    ports: [{ name: "port", kind: "signal", side: "left", offsetX: 0, offsetY: 0 }],
    parameters: [
      {
        key: "Name",
        label: "Signal Net Name",
        tab: "General",
        group: "Identification",
        kind: "string",
        defaultValue: "Vref",
        description: "Shared wireless signal net name",
      },
    ],
  },
  {
    className: "master:xnode",
    aliases: ["xnode", "pin"],
    label: "Wireless Electrical Node (XNode / Pin)",
    category: "Meters, Probes & Buses",
    domain: "electrical",
    description: "Wireless electrical node connector / sub-page boundary pin linking matching 3-phase nodes.",
    defaultWidth: 44,
    defaultHeight: 24,
    ports: [{ name: "port", kind: "electrical", side: "left", offsetX: 0, offsetY: 0 }],
    parameters: [
      {
        key: "Name",
        label: "Electrical Node Name",
        tab: "General",
        group: "Identification",
        kind: "string",
        defaultValue: "POI_Node",
        description: "Shared electrical node / boundary port name",
      },
    ],
  },
  {
    className: "Bus",
    aliases: ["bus", "master:bus"],
    label: "3-Phase Electrical Busbar",
    category: "Meters, Probes & Buses",
    domain: "bus",
    description: "Three-phase substation busbar node with nominal line-to-line RMS voltage rating.",
    defaultWidth: 80,
    defaultHeight: 14,
    ports: [],
    parameters: [
      {
        key: "Name",
        label: "Bus Name",
        tab: "General",
        group: "Identification",
        kind: "string",
        defaultValue: "Bus1",
        description: "Substation busbar name",
      },
      {
        key: "BaseKV",
        aliases: ["vbase"],
        label: "Nominal Base Voltage (L-L)",
        tab: "Ratings",
        group: "Ratings",
        kind: "number",
        unit: "kV",
        defaultValue: 230.0,
        min: 0.1,
        description: "Nominal line-to-line RMS voltage in kV",
      },
    ],
  },
];

/**
 * Looks up a Master Library schema by definition name (e.g. `"master:sync_machine"` or `"sync_machine"`).
 */
export function getMasterComponentSchema(definitionName: string): PscadComponentSchema | undefined {
  const norm = definitionName.trim().toLowerCase();
  const short = norm.includes(":") ? norm.split(":").pop()! : norm;
  return MASTER_LIBRARY_SCHEMAS.find(
    (s) =>
      s.className.toLowerCase() === norm ||
      s.className.toLowerCase().endsWith(`:${short}`) ||
      s.aliases.some((a) => a.toLowerCase() === norm || a.toLowerCase() === short),
  );
}

export function getAllMasterComponentSchemas(): PscadComponentSchema[] {
  return MASTER_LIBRARY_SCHEMAS;
}

/**
 * Builds the 6-category palette for the VS Code / Web IDE Diagram Editor.
 */
export function getPscadPaletteCategories() {
  const categoryOrder: PscadComponentSchema["category"][] = [
    "Sources & Rotating Machines",
    "Transformers, Lines & Cables",
    "Power Electronics, HVDC & FACTS",
    "Switchgear & Protection",
    "CSMF Control Blocks",
    "Meters, Probes & Buses",
  ];

  return categoryOrder.map((catName) => ({
    name: catName,
    items: MASTER_LIBRARY_SCHEMAS.filter((s) => s.category === catName).map((s) => ({
      label: s.label,
      className: s.className,
      description: s.description,
    })),
  }));
}

/**
 * Synthesizes a well-formed PSCAD `<User classid="UserCmp" ...>` or `<Bus ...>` XML snippet
 * when a component is dragged from the palette onto the schematic canvas (`addComponent`).
 */
export function buildComponentXmlSnippet(
  className: string,
  instanceId: string,
  x: number,
  y: number,
  customParams?: Record<string, string | number>,
  indent = "        ",
): string {
  const schema = getMasterComponentSchema(className);
  const rx = Math.round(x);
  const ry = Math.round(y);

  if (className === "Bus" || schema?.domain === "bus") {
    const vbase = customParams?.["BaseKV"] ?? customParams?.["vbase"] ?? 230.0;
    return [
      `${indent}<Bus classid="Bus" id="${instanceId}" name="${instanceId}" x="${rx}" y="${ry}" length="80" vbase="${vbase}">`,
      `${indent}  <paramlist>`,
      `${indent}    <param name="Name" value="${instanceId}"/>`,
      `${indent}    <param name="BaseKV" value="${vbase}"/>`,
      `${indent}  </paramlist>`,
      `${indent}</Bus>`,
    ].join("\n");
  }

  const defn = schema?.className ?? (className.includes(":") ? className : `master:${className}`);
  const paramLines: string[] = [];

  if (schema) {
    for (const p of schema.parameters) {
      const val =
        customParams?.[p.key] !== undefined ? customParams[p.key] : p.key === "Name" ? instanceId : p.defaultValue;
      paramLines.push(`${indent}    <param name="${p.key}" value="${val}"/>`);
    }
  } else {
    paramLines.push(`${indent}    <param name="Name" value="${instanceId}"/>`);
    if (customParams) {
      for (const [k, v] of Object.entries(customParams)) {
        if (k !== "Name") {
          paramLines.push(`${indent}    <param name="${k}" value="${v}"/>`);
        }
      }
    }
  }

  return [
    `${indent}<User classid="UserCmp" name="${defn}" id="${instanceId}" x="${rx}" y="${ry}" orient="0">`,
    `${indent}  <paramlist>`,
    ...paramLines,
    `${indent}  </paramlist>`,
    `${indent}</User>`,
  ].join("\n");
}

/**
 * Context-aware LSP Completion items for `.pscx` / `.pslx` XML editing.
 */
export function getPscadCompletions(text: string, offset: number) {
  const prefix = text.slice(Math.max(0, offset - 300), offset);
  const currentLineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const linePrefix = text.slice(currentLineStart, offset);

  // 1. Inside `<User ... name="` or `defn="`: suggest all Master Library component definitions
  if (/<User\b[^>]*?\b(?:name|defn)\s*=\s*["'][^"']*$/i.test(linePrefix)) {
    return MASTER_LIBRARY_SCHEMAS.filter((s) => s.domain !== "bus").map((s) => ({
      label: s.className,
      kind: 7, // CompletionItemKind.Class
      detail: `${s.label} (${s.category})`,
      documentation: s.description,
    }));
  }

  // Find enclosing `<User ... name="master:...">` block before `offset`
  const beforeText = text.slice(0, offset);
  const lastUserOpen = beforeText.lastIndexOf("<User");
  const lastUserClose = beforeText.lastIndexOf("</User>");
  let enclosingSchema: PscadComponentSchema | undefined;
  if (lastUserOpen > lastUserClose) {
    const userHeader = beforeText.slice(lastUserOpen, Math.min(text.length, lastUserOpen + 250));
    const defMatch = /\b(?:name|defn)\s*=\s*["']([^"']+)["']/i.exec(userHeader);
    if (defMatch?.[1]) {
      enclosingSchema = getMasterComponentSchema(defMatch[1]);
    }
  }

  // 2. Inside `<param name="key" value="...`: suggest enum options if parameter has options
  const valMatch = /<param\s+name\s*=\s*["']([^"']+)["']\s+value\s*=\s*["'][^"']*$/i.exec(linePrefix);
  if (valMatch && enclosingSchema) {
    const paramKey = valMatch[1]!;
    const pSchema = enclosingSchema.parameters.find(
      (p) =>
        p.key.toLowerCase() === paramKey.toLowerCase() ||
        p.aliases?.some((a) => a.toLowerCase() === paramKey.toLowerCase()),
    );
    if (pSchema?.options) {
      return pSchema.options.map((opt) => ({
        label: opt.value,
        kind: 13, // CompletionItemKind.EnumMember
        detail: opt.label,
        documentation: `${pSchema.label}: ${opt.label}`,
      }));
    }
  }

  // 3. Inside `<param name="...`: suggest parameter names for the enclosing component (or project settings)
  if (
    /<param\s+name\s*=\s*["'][^"']*$/i.test(linePrefix) ||
    (prefix.includes("<paramlist") && !linePrefix.includes("<param"))
  ) {
    if (enclosingSchema) {
      return enclosingSchema.parameters.map((p) => ({
        label: p.key,
        kind: 10, // CompletionItemKind.Property
        detail: `${p.label}${p.unit ? ` [${p.unit}]` : ""} (default: ${p.defaultValue})`,
        documentation: p.description,
      }));
    }
    // Project-level settings
    return [
      {
        label: "time_step",
        kind: 10,
        detail: "Simulation Time Step [µs] (default: 50.0)",
        documentation: "Fixed EMT companion integration step Δt in microseconds.",
      },
      {
        label: "time_duration",
        kind: 10,
        detail: "Simulation Duration [s] (default: 1.0)",
        documentation: "Total simulation duration in seconds.",
      },
      {
        label: "f_base",
        kind: 10,
        detail: "Nominal System Frequency [Hz] (default: 60.0)",
        documentation: "Base fundamental AC frequency (50 or 60 Hz).",
      },
    ];
  }

  // 4. Default top-level XML/PSCAD completions
  return MASTER_LIBRARY_SCHEMAS.map((s) => ({
    label: s.className,
    kind: 7,
    detail: `${s.label} — ${s.category}`,
    documentation: s.description,
  }));
}

/**
 * Generates a rich Markdown Hover card with computed electrical impedances & topology for `.pscx` elements.
 */
export function getPscadHover(text: string, offset: number): { contents: string; line?: number | undefined } | null {
  try {
    const project = parsePscx(text);
    const netlist = extractEmtNetlist(project);
    const before = text.slice(0, offset);
    const cursorLine = before.split(/\r?\n/).length;

    const allComponents = [
      ...project.rootModule.components,
      ...Array.from(project.subModules.values()).flatMap((m) => m.components),
    ];
    const allBuses = [...project.rootModule.buses, ...Array.from(project.subModules.values()).flatMap((m) => m.buses)];

    // Check if cursor is on or inside a `<Bus>`
    const bus = allBuses.find(
      (b) =>
        b.line === cursorLine ||
        (b.line && Math.abs(b.line - cursorLine) <= 2 && text.split(/\r?\n/)[cursorLine - 1]?.includes(b.name)),
    );
    if (bus) {
      const netBus = netlist.buses.get(bus.name) ?? netlist.buses.get(bus.id);
      const connected = netBus?.connectedBranchIds.join(", ") || "None";
      return {
        line: bus.line,
        contents: [
          `### ⚡ 3-Phase Electrical Busbar \`${bus.name}\``,
          `- **Nominal Voltage ($V_{\\text{LL,RMS}}$):** \`${bus.voltageBaseKv ?? 230} kV\``,
          `- **Phase Nodes:** \`${bus.phaseCount}-phase (A, B, C)\``,
          `- **Connected Apparatus / Branches:** \`${connected}\``,
        ].join("\n"),
      };
    }

    // Check if cursor is on or inside a `<User>` component block
    for (const cmp of allComponents) {
      if (!cmp.line) continue;
      const lines = text.split(/\r?\n/);
      let endLine = cmp.line;
      if (!/\/>\s*$/.test(lines[cmp.line - 1] ?? "")) {
        while (endLine < lines.length && !/<\/(?:User|Component)>/i.test(lines[endLine - 1] ?? "")) {
          endLine++;
        }
      }
      if (cursorLine >= cmp.line && cursorLine <= endLine) {
        const schema = getMasterComponentSchema(cmp.definitionName);
        const title = schema
          ? `${schema.label} (\`${cmp.definitionName}\`)`
          : `PSCAD Component \`${cmp.definitionName}\``;
        const md: string[] = [
          `### 🔌 ${title}`,
          `**Instance:** \`${cmp.instanceName || cmp.id}\` ${schema ? `| **Category:** *${schema.category}*` : ""}`,
          "",
          schema?.description ?? "PSCAD schematic component instance.",
          "",
        ];

        // Compute derived engineering values
        const p = cmp.parameters;
        const mva = Number(p["MVA"] ?? p["mva"] ?? 0);
        const vKv = Number(p["V"] ?? p["V1"] ?? p["v"] ?? 0);
        const freq = project.settings.frequencyHz || 60;
        const omega = 2 * Math.PI * freq;

        if (mva > 0 && vKv > 0) {
          const zBase = (vKv * vKv) / mva;
          const iBase = (mva * 1e3) / (Math.sqrt(3) * vKv);
          md.push(`**Derived Base Quantities (${freq} Hz):**`);
          md.push(
            `- $Z_{\\text{base}} = \\frac{V^2}{S} = \\mathbf{${zBase.toFixed(3)}\\,\\Omega}$ | $I_{\\text{rated}} = \\mathbf{${iBase.toFixed(1)}\\,\\text{A}}_{\\text{RMS}}$`,
          );
          if (p["X"] !== undefined) {
            const xOhm = Number(p["X"]) * zBase;
            const lMh = (xOhm / omega) * 1e3;
            md.push(
              `- Leakage Impedance: $X_l = ${xOhm.toFixed(3)}\\,\\Omega$ ($L_l = ${lMh.toFixed(2)}\\,\\text{mH}$)`,
            );
          }
          if (p["Xd_sub"] !== undefined || p["Xd"] !== undefined) {
            const xdSub = Number(p["Xd_sub"] ?? 0.2);
            const lSubMh = ((xdSub * zBase) / omega) * 1e3;
            md.push(
              `- Subtransient Inductance: $L_d'' = ${lSubMh.toFixed(2)}\\,\\text{mH}$ ($X_d'' = ${xdSub}\\,\\text{pu}$)`,
            );
          }
          md.push("");
        }

        const lineMatch = netlist.transmissionLines.find((l) => l.id === cmp.id || l.id === cmp.instanceName);
        if (lineMatch) {
          const zc = Math.sqrt(lineMatch.lPerKm / Math.max(1e-12, lineMatch.cPerKm));
          const tauUs = lineMatch.lengthKm * Math.sqrt(lineMatch.lPerKm * lineMatch.cPerKm) * 1e6;
          md.push(`**Traveling-Wave Line Parameters (${lineMatch.lengthKm} km, \`${lineMatch.modelType}\`):**`);
          md.push(`- Surge Impedance: $Z_c = \\sqrt{L/C} = \\mathbf{${zc.toFixed(1)}\\,\\Omega}$`);
          md.push(
            `- Wave Propagation Delay: $\\tau = \\mathbf{${tauUs.toFixed(1)}\\,\\mu\\text{s}}$ (Project $\\Delta t = ${project.settings.timeStepUs}\\,\\mu\\text{s}$)`,
          );
          md.push("");
        }

        const paramEntries = Object.entries(cmp.parameters);
        if (paramEntries.length > 0) {
          md.push("| Parameter | Value | Unit | Description |");
          md.push("| :--- | :--- | :--- | :--- |");
          for (const [k, v] of paramEntries) {
            const pSchema = schema?.parameters.find(
              (ps) =>
                ps.key.toLowerCase() === k.toLowerCase() ||
                ps.aliases?.some((a) => a.toLowerCase() === k.toLowerCase()),
            );
            md.push(
              `| \`${k}\` | \`${v}\` | ${pSchema?.unit ?? "—"} | ${pSchema?.description ?? "Component parameter"} |`,
            );
          }
        }

        return {
          line: cmp.line,
          contents: md.join("\n"),
        };
      }
    }
  } catch {
    // Ignore parse errors during hover
  }
  return null;
}

/**
 * Resolves Go-to-Definition for sub-module `<User name="SubModule">` or `<call name="Main">` in `.pscx` files.
 */
export function getPscadDefinitionLocation(
  text: string,
  offset: number,
  uri: string,
): {
  uri: string;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
} | null {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const lineEnd = text.indexOf("\n", offset);
  const lineText = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);

  const nameMatch = /\b(?:name|defn)\s*=\s*["']([^"']+)["']/i.exec(lineText);
  if (!nameMatch?.[1]) return null;

  const rawTarget = nameMatch[1].includes(":") ? nameMatch[1].split(":").pop()! : nameMatch[1];
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (
      /<Definition\b/i.test(l) &&
      new RegExp(`\\bname\\s*=\\s*["'](?:[^"']*:)?${rawTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "i").test(l)
    ) {
      const col = Math.max(0, l.indexOf(rawTarget));
      return {
        uri,
        range: {
          start: { line: i, character: col },
          end: { line: i, character: col + rawTarget.length },
        },
      };
    }
  }

  return null;
}

/**
 * Builds hierarchical LSP `DocumentSymbol[]` for the VS Code Outline & Breadcrumbs bar.
 */
export function getPscadDocumentSymbols(text: string) {
  const project = parsePscx(text);
  const lines = text.split(/\r?\n/);
  const totalLines = Math.max(0, lines.length - 1);

  const makeRange = (line1Based?: number) => {
    const l = Math.max(0, Math.min(totalLines, (line1Based ?? 1) - 1));
    const len = lines[l]?.length ?? 1;
    return {
      start: { line: l, character: 0 },
      end: { line: l, character: len },
    };
  };

  const buildModuleChildren = (mod: typeof project.rootModule) => {
    const children: any[] = [];
    for (const bus of mod.buses) {
      const r = makeRange(bus.line);
      children.push({
        name: `${bus.name} (${bus.voltageBaseKv ?? 230} kV Bus)`,
        detail: `${bus.phaseCount}-Phase Bus`,
        kind: 8, // SymbolKind.Field
        range: r,
        selectionRange: r,
      });
    }
    for (const cmp of mod.components) {
      const r = makeRange(cmp.line);
      const schema = getMasterComponentSchema(cmp.definitionName);
      children.push({
        name: cmp.instanceName || cmp.id,
        detail: schema ? `${schema.label} (${cmp.definitionName})` : cmp.definitionName,
        kind: schema?.domain === "control" ? 12 : 5, // Function for control, Class for apparatus
        range: r,
        selectionRange: r,
      });
    }
    return children;
  };

  const moduleSymbols: any[] = [
    {
      name: project.rootModule.name || "Main",
      detail: "Root Schematic Module",
      kind: 2, // SymbolKind.Module
      range: { start: { line: 0, character: 0 }, end: { line: totalLines, character: 0 } },
      selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: lines[0]?.length ?? 1 } },
      children: buildModuleChildren(project.rootModule),
    },
  ];

  for (const [subName, subMod] of project.subModules.entries()) {
    const defLineIdx = lines.findIndex((l) => /<Definition\b/i.test(l) && l.includes(`"${subName}"`));
    const r = makeRange(defLineIdx >= 0 ? defLineIdx + 1 : 1);
    moduleSymbols.push({
      name: subName,
      detail: "Sub-Module Definition",
      kind: 2,
      range: r,
      selectionRange: r,
      children: buildModuleChildren(subMod),
    });
  }

  return [
    {
      name: project.name,
      detail: `PSCAD Project (${project.settings.frequencyHz} Hz, Δt=${project.settings.timeStepUs} µs)`,
      kind: 4, // SymbolKind.Package
      range: { start: { line: 0, character: 0 }, end: { line: totalLines, character: 0 } },
      selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: lines[0]?.length ?? 1 } },
      children: moduleSymbols,
    },
  ];
}

/**
 * Generates 1-click Quick-Fix Code Actions for PSCAD pre-flight lints (`M6003`, `M6006`, `M6007`, `M6008`).
 */
export function getPscadQuickFixes(text: string, uri: string) {
  const project = parsePscx(text);
  const lints = lintPscx(project);
  const lines = text.split(/\r?\n/);
  const actions: {
    title: string;
    code: string;
    edit: { changes: Record<string, { range: any; newText: string }[]> };
  }[] = [];

  for (const d of lints) {
    const lineIdx = Math.max(0, (d.line ?? 1) - 1);
    const lineText = lines[lineIdx] ?? "";

    if (d.code === "M6003") {
      // Negative/zero R, L, C, or MVA -> replace with positive magnitude
      const valMatch = /(value\s*=\s*["'])(-?[0-9.eE+-]+)(["'])/i.exec(lineText);
      if (valMatch) {
        const num = parseFloat(valMatch[2]!);
        const fixedVal = Math.abs(num) > 0 ? String(Math.abs(num)) : "1.0";
        const newLine = lineText.replace(valMatch[0], `${valMatch[1]}${fixedVal}${valMatch[3]}`);
        actions.push({
          title: `Fix M6003: Set parameter value to positive '${fixedVal}'`,
          code: d.code,
          edit: {
            changes: {
              [uri]: [
                {
                  range: { start: { line: lineIdx, character: 0 }, end: { line: lineIdx, character: lineText.length } },
                  newText: newLine,
                },
              ],
            },
          },
        });
      }
    } else if (d.code === "M6006") {
      // Line travel time tau < dt -> switch line model_type to 'pi'
      for (let i = lineIdx; i < Math.min(lines.length, lineIdx + 12); i++) {
        if (/name\s*=\s*["'](?:model_type|model)["']/i.test(lines[i]!)) {
          const oldL = lines[i]!;
          const newL = oldL.replace(/(value\s*=\s*["'])[^"']*(["'])/i, `$1pi$2`);
          actions.push({
            title: `Fix M6006: Switch short line model_type to 'pi' (Nominal Pi-Section)`,
            code: d.code,
            edit: {
              changes: {
                [uri]: [
                  {
                    range: { start: { line: i, character: 0 }, end: { line: i, character: oldL.length } },
                    newText: newL,
                  },
                ],
              },
            },
          });
          break;
        }
      }
    } else if (d.code === "M6007") {
      // Invalid subtransient reactance hierarchy Xd'' > Xd' -> set Xd_sub / Xd_pp = 0.20 pu
      for (let i = lineIdx; i < Math.min(lines.length, lineIdx + 15); i++) {
        if (/name\s*=\s*["'](?:Xd_pp|Xd_sub|Xd'')["']/i.test(lines[i]!)) {
          const oldL = lines[i]!;
          const newL = oldL.replace(/(value\s*=\s*["'])[^"']*(["'])/i, `$10.20$2`);
          actions.push({
            title: `Fix M6007: Set subtransient reactance Xd'' to valid 0.20 pu (< Xd')`,
            code: d.code,
            edit: {
              changes: {
                [uri]: [
                  {
                    range: { start: { line: i, character: 0 }, end: { line: i, character: oldL.length } },
                    newText: newL,
                  },
                ],
              },
            },
          });
          break;
        }
      }
    } else if (d.code === "M6008") {
      // Under-rated MOV arrester Vref < Vbase -> raise Vref to 1.15 * Vbase
      const vbaseMatch = /bus voltage ([0-9.]+) kV/i.exec(d.message);
      const targetVref = vbaseMatch ? (parseFloat(vbaseMatch[1]!) * 1.15).toFixed(1) : "265.0";
      for (let i = lineIdx; i < Math.min(lines.length, lineIdx + 10); i++) {
        if (/name\s*=\s*["'](?:Vref|protection_level_kv)["']/i.test(lines[i]!)) {
          const oldL = lines[i]!;
          const newL = oldL.replace(/(value\s*=\s*["'])[^"']*(["'])/i, `$1${targetVref}$2`);
          actions.push({
            title: `Fix M6008: Upgrade MOV Vref to ${targetVref} kV (1.15 pu of bus BaseKV)`,
            code: d.code,
            edit: {
              changes: {
                [uri]: [
                  {
                    range: { start: { line: i, character: 0 }, end: { line: i, character: oldL.length } },
                    newText: newL,
                  },
                ],
              },
            },
          });
          break;
        }
      }
    } else if (d.code === "M6009") {
      // Duplicate component or bus ID -> rename id="..." to unique suffix
      const dupId = d.componentId || d.busId;
      if (dupId && /\bid\s*=\s*["'][^"']*["']/i.test(lineText)) {
        const uniqueId = `${dupId}_2`;
        const newLine = lineText.replace(/\bid\s*=\s*(["'])[^"']*\1/i, `id=$1${uniqueId}$1`);
        actions.push({
          title: `Fix M6009: Rename duplicate ID '${dupId}' to '${uniqueId}'`,
          code: d.code,
          edit: {
            changes: {
              [uri]: [
                {
                  range: { start: { line: lineIdx, character: 0 }, end: { line: lineIdx, character: lineText.length } },
                  newText: newLine,
                },
              ],
            },
          },
        });
      }
    } else if (d.code === "M6010") {
      // Bus voltage conflict -> align secondary bus vbase with primary bus voltage
      const kvMatch = /\(([0-9.]+) kV\) directly to/i.exec(d.message);
      const targetKv = kvMatch?.[1] ?? "230";
      if (/\bv_?base\s*=\s*["'][^"']*["']/i.test(lineText)) {
        const newLine = lineText.replace(/\bv_?base\s*=\s*(["'])[^"']*\1/i, `vbase=$1${targetKv}$1`);
        actions.push({
          title: `Fix M6010: Align connected bus vbase to ${targetKv} kV`,
          code: d.code,
          edit: {
            changes: {
              [uri]: [
                {
                  range: { start: { line: lineIdx, character: 0 }, end: { line: lineIdx, character: lineText.length } },
                  newText: newLine,
                },
              ],
            },
          },
        });
      }
    }
  }

  return actions;
}

/**
 * Computes LSP `FoldingRange[]` for `.pscx` / `.pslx` XML elements (`<Definition>`, `<schematic>`,
 * `<User>`, `<Component>`, `<Bus>`, `<Wire>`, `<paramlist>`, `<Sticky>`).
 */
export function getPscadFoldingRanges(
  text: string,
): { startLine: number; endLine: number; kind?: string | undefined }[] {
  const lines = text.split(/\r?\n/);
  const ranges: { startLine: number; endLine: number; kind?: string | undefined }[] = [];
  const stack: { tag: string; startLine: number }[] = [];
  const foldableTags = new Set([
    "definition",
    "schematic",
    "user",
    "component",
    "bus",
    "wire",
    "paramlist",
    "sticky",
    "hierarchy",
    "definitions",
  ]);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Check for multi-line XML comments
    if (line.includes("<!--") && !line.includes("-->")) {
      stack.push({ tag: "__comment__", startLine: i });
      continue;
    }
    if (line.includes("-->")) {
      let idx = -1;
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s]!.tag === "__comment__") {
          idx = s;
          break;
        }
      }
      if (idx >= 0) {
        const popped = stack.splice(idx, 1)[0]!;
        if (i > popped.startLine) {
          ranges.push({ startLine: popped.startLine, endLine: i, kind: "comment" });
        }
      }
      continue;
    }

    // Match opening tags that are not self-closing on the same line
    const openRegex = /<([a-zA-Z_][a-zA-Z0-9_-]*)\b[^>]*?>/g;
    let m: RegExpExecArray | null;
    while ((m = openRegex.exec(line)) !== null) {
      const fullTag = m[0]!;
      if (fullTag.endsWith("/>")) continue;
      const tagLower = m[1]!.toLowerCase();
      if (!foldableTags.has(tagLower)) continue;
      // Ignore if closed on the same line
      if (new RegExp(`</${m[1]}\\s*>`, "i").test(line.slice(m.index + fullTag.length))) {
        continue;
      }
      stack.push({ tag: tagLower, startLine: i });
    }

    const closeRegex = /<\/([a-zA-Z_][a-zA-Z0-9_-]*)\s*>/g;
    while ((m = closeRegex.exec(line)) !== null) {
      const tagLower = m[1]!.toLowerCase();
      if (!foldableTags.has(tagLower)) continue;
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s]!.tag === tagLower) {
          const popped = stack.splice(s, 1)[0]!;
          if (i > popped.startLine) {
            ranges.push({ startLine: popped.startLine, endLine: i });
          }
          break;
        }
      }
    }
  }

  return ranges;
}
