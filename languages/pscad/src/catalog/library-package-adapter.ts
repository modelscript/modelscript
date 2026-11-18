// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  isModelscriptLibraryPackageJson,
  type DiagramComponentSpec,
  type LibrarySymbolStub,
  type LoadedLibraryPackage,
  type ModelscriptLibraryManifest,
} from "@modelscript/runtime";
import type { PscadComponentSchema, PscadParameterSchema, PscadPortSchema } from "./master-library-schemas.js";
import {
  PSCAD_MASTER_LIB_DIAGRAMS,
  PSCAD_MASTER_LIB_PKG_JSON,
  PSCAD_MASTER_LIB_SYMBOLS,
} from "./pscad-master-lib-data.js";

/**
 * Converts `PscadComponentSchema[]` into generic `@modelscript/runtime` `LibrarySymbolStub[]`
 * and `DiagramComponentSpec[]` payloads suitable for `package.json#modelscript` libraries.
 */
export function schemasToLibraryPayloads(schemas: PscadComponentSchema[]): {
  symbols: LibrarySymbolStub[];
  diagrams: DiagramComponentSpec[];
} {
  const symbols: LibrarySymbolStub[] = [];
  const diagrams: DiagramComponentSpec[] = [];

  for (const s of schemas) {
    const shortName = s.className.includes(":") ? s.className.split(":").pop()! : s.className;
    symbols.push({
      name: shortName,
      kind: "pscad_component",
      ruleName: "UserCmpDefn",
      namePath: s.className,
      exports: s.parameters.map((p) => p.key),
      inherits: [],
      metadata: {
        label: s.label,
        category: s.category,
        domain: s.domain,
        description: s.description,
        aliases: s.aliases,
        parameters: s.parameters,
      },
    });

    diagrams.push({
      namePath: s.className,
      aliases: s.aliases,
      label: s.label,
      category: s.category,
      domain: s.domain,
      width: s.defaultWidth,
      height: s.defaultHeight,
      ports: s.ports.map((p) => ({
        name: p.name,
        kind: p.kind,
        side: p.side,
        dx: p.offsetX,
        dy: p.offsetY,
      })),
    });
  }

  return { symbols, diagrams };
}

/**
 * Reconstructs `PscadComponentSchema[]` from all `pscad` `package.json#modelscript`
 * libraries currently registered in `globalLibraryRegistry`.
 */
export function getPscadSchemasFromLibraries(): PscadComponentSchema[] {
  ensureBuiltInPscadLibraryRegistered();
  const out: PscadComponentSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("pscad")) {
    const diagByPath = new Map<string, DiagramComponentSpec>();
    for (const d of pkg.diagrams) {
      diagByPath.set(d.namePath, d);
    }
    for (const sym of pkg.symbols) {
      const meta = (sym.metadata ?? {}) as Record<string, unknown>;
      const diag = diagByPath.get(sym.namePath);
      out.push({
        className: sym.namePath,
        aliases: Array.isArray(meta["aliases"]) ? (meta["aliases"] as string[]) : [],
        label: (meta["label"] as string) ?? diag?.label ?? sym.name,
        category: ((meta["category"] as PscadComponentSchema["category"]) ??
          "Sources & Rotating Machines") as PscadComponentSchema["category"],
        domain: ((meta["domain"] as PscadComponentSchema["domain"]) ?? "electrical") as PscadComponentSchema["domain"],
        description: (meta["description"] as string) ?? "",
        defaultWidth: diag?.width ?? 60,
        defaultHeight: diag?.height ?? 60,
        ports: (diag?.ports ?? []).map(
          (p): PscadPortSchema => ({
            name: p.name,
            kind: p.kind === "signal" ? "signal" : "electrical",
            side: p.side,
            offsetX: p.dx,
            offsetY: p.dy,
          }),
        ),
        parameters: Array.isArray(meta["parameters"]) ? (meta["parameters"] as PscadParameterSchema[]) : [],
      });
    }
  }
  const existingNames = new Set<string>();
  for (const s of out) {
    existingNames.add(s.className.toLowerCase());
    for (const a of s.aliases) existingNames.add(a.toLowerCase());
  }
  for (const extra of EXTENDED_PSCAD_CONTROL_SCHEMAS) {
    if (!existingNames.has(extra.className.toLowerCase())) {
      out.push(extra);
    }
  }
  return out;
}

const EXTENDED_PSCAD_CONTROL_SCHEMAS: PscadComponentSchema[] = [
  {
    className: "master:pll",
    aliases: ["pll", "master:pll"],
    label: "Phase-Locked Loop (SRF-PLL)",
    category: "CSMF Control Blocks",
    domain: "control",
    description:
      "2nd-order Synchronous Reference Frame / Single-Phase PI Phase-Locked Loop outputting tracked angle theta (rad) or frequency (Hz).",
    defaultWidth: 68,
    defaultHeight: 48,
    ports: [
      { name: "Va", kind: "signal", side: "left", offsetX: -36, offsetY: 0 },
      { name: "Out", kind: "signal", side: "right", offsetX: 36, offsetY: 0 },
    ],
    parameters: [
      {
        key: "Name",
        label: "Block Name",
        tab: "General",
        group: "Identification",
        kind: "string",
        defaultValue: "PLL1",
        description: "Unique PLL block identifier",
      },
      {
        key: "F0",
        aliases: ["Freq"],
        label: "Nominal Frequency",
        tab: "Ratings",
        group: "PLL Tuning",
        kind: "number",
        unit: "Hz",
        defaultValue: 60,
        min: 1,
        description: "Nominal system frequency",
      },
      {
        key: "Kp",
        aliases: ["KP"],
        label: "Proportional Gain",
        tab: "Control",
        group: "PLL Tuning",
        kind: "number",
        unit: "rad/(pu·s)",
        defaultValue: 180,
        min: 0,
        description: "PI proportional gain",
      },
      {
        key: "Ki",
        aliases: ["KI"],
        label: "Integral Gain",
        tab: "Control",
        group: "PLL Tuning",
        kind: "number",
        unit: "rad/(pu·s²)",
        defaultValue: 3200,
        min: 0,
        description: "PI integral gain",
      },
      {
        key: "OutMode",
        label: "Output Mode (0=Theta, 1=Hz)",
        tab: "Control",
        group: "Output",
        kind: "number",
        defaultValue: 0,
        min: 0,
        max: 1,
        description: "0 outputs tracked phase angle (rad), 1 outputs tracked frequency (Hz)",
      },
    ],
  },
  {
    className: "master:freq-meas",
    aliases: ["freq-meas", "freq_meas", "master:freq-meas"],
    label: "Frequency Measurement",
    category: "Meters, Probes & Buses",
    domain: "meter",
    description: "Tracks instantaneous bus frequency (Hz) from voltage zero-crossings and low-pass filtering.",
    defaultWidth: 64,
    defaultHeight: 44,
    ports: [
      { name: "In", kind: "signal", side: "left", offsetX: -36, offsetY: 0 },
      { name: "Out", kind: "signal", side: "right", offsetX: 36, offsetY: 0 },
    ],
    parameters: [
      {
        key: "Name",
        label: "Meter Name",
        tab: "General",
        group: "Identification",
        kind: "string",
        defaultValue: "Fmeas1",
        description: "Unique meter identifier",
      },
      {
        key: "F0",
        label: "Nominal Frequency",
        tab: "Ratings",
        group: "Frequency",
        kind: "number",
        unit: "Hz",
        defaultValue: 60,
        min: 1,
        description: "Nominal base frequency",
      },
      {
        key: "T",
        label: "Smoothing Time Constant",
        tab: "Control",
        group: "Filter",
        kind: "number",
        unit: "s",
        defaultValue: 0.02,
        min: 0.001,
        description: "Frequency smoothing filter time constant",
      },
    ],
  },
  {
    className: "master:fft",
    aliases: ["fft", "master:fft"],
    label: "Harmonic FFT Extractor",
    category: "CSMF Control Blocks",
    domain: "control",
    description: "1-cycle sliding-window DFT harmonic magnitude and phase extractor.",
    defaultWidth: 64,
    defaultHeight: 48,
    ports: [
      { name: "In", kind: "signal", side: "left", offsetX: -36, offsetY: 0 },
      { name: "Mag", kind: "signal", side: "right", offsetX: 36, offsetY: 0 },
    ],
    parameters: [
      {
        key: "Name",
        label: "FFT Name",
        tab: "General",
        group: "Identification",
        kind: "string",
        defaultValue: "FFT1",
        description: "Unique FFT block identifier",
      },
      {
        key: "F0",
        aliases: ["Freq"],
        label: "Fundamental Frequency",
        tab: "Ratings",
        group: "DFT Window",
        kind: "number",
        unit: "Hz",
        defaultValue: 60,
        min: 1,
        description: "Fundamental frequency for 1-cycle window",
      },
      {
        key: "H",
        aliases: ["Harmonic"],
        label: "Harmonic Order",
        tab: "Control",
        group: "DFT Window",
        kind: "number",
        defaultValue: 1,
        min: 1,
        description: "Harmonic order to extract (1=fundamental, 2=2nd harmonic, etc.)",
      },
    ],
  },
  {
    className: "master:pwm",
    aliases: ["pwm", "master:pwm"],
    label: "PWM Triangle Carrier Comparator",
    category: "Power Electronics, HVDC & FACTS",
    domain: "electrical",
    description: "Compares modulating reference against high-frequency triangle carrier to synthesize gating pulses.",
    defaultWidth: 64,
    defaultHeight: 48,
    ports: [
      { name: "Ref", kind: "signal", side: "left", offsetX: -36, offsetY: 0 },
      { name: "Gate", kind: "signal", side: "right", offsetX: 36, offsetY: 0 },
    ],
    parameters: [
      {
        key: "Name",
        label: "PWM Name",
        tab: "General",
        group: "Identification",
        kind: "string",
        defaultValue: "PWM1",
        description: "Unique PWM block identifier",
      },
      {
        key: "Freq",
        aliases: ["Fc"],
        label: "Carrier Frequency",
        tab: "Control",
        group: "Carrier",
        kind: "number",
        unit: "Hz",
        defaultValue: 1980,
        min: 50,
        description: "Triangle carrier switching frequency",
      },
      {
        key: "Bipolar",
        label: "Bipolar Output (-1/1 vs 0/1)",
        tab: "Control",
        group: "Carrier",
        kind: "number",
        defaultValue: 0,
        min: 0,
        max: 1,
        description: "0 for unipolar 0/1 pulses, 1 for bipolar -1/1",
      },
    ],
  },
  {
    className: "master:sample_hold",
    aliases: ["sample_hold", "sandhdefn", "master:sample_hold"],
    label: "Sample & Hold",
    category: "CSMF Control Blocks",
    domain: "control",
    description: "Latches the analog input signal when the sample clock input triggers.",
    defaultWidth: 56,
    defaultHeight: 44,
    ports: [
      { name: "In", kind: "signal", side: "left", offsetX: -30, offsetY: -10 },
      { name: "Clk", kind: "signal", side: "left", offsetX: -30, offsetY: 10 },
      { name: "Out", kind: "signal", side: "right", offsetX: 30, offsetY: 0 },
    ],
    parameters: [
      {
        key: "Name",
        label: "Block Name",
        tab: "General",
        group: "Identification",
        kind: "string",
        defaultValue: "SH1",
        description: "Sample & Hold identifier",
      },
    ],
  },
  {
    className: "master:flip_flop",
    aliases: ["flip_flop", "master:flip_flop"],
    label: "SR Flip-Flop",
    category: "CSMF Control Blocks",
    domain: "control",
    description: "Edge/level triggered Set-Reset latch for sequential control logic.",
    defaultWidth: 56,
    defaultHeight: 44,
    ports: [
      { name: "S", kind: "signal", side: "left", offsetX: -30, offsetY: -10 },
      { name: "R", kind: "signal", side: "left", offsetX: -30, offsetY: 10 },
      { name: "Q", kind: "signal", side: "right", offsetX: 30, offsetY: 0 },
    ],
    parameters: [
      {
        key: "Name",
        label: "Block Name",
        tab: "General",
        group: "Identification",
        kind: "string",
        defaultValue: "FF1",
        description: "Flip-flop identifier",
      },
      {
        key: "Init",
        label: "Initial State",
        tab: "Control",
        group: "State",
        kind: "number",
        defaultValue: 0,
        min: 0,
        max: 1,
        description: "Initial output state (0 or 1)",
      },
    ],
  },
  {
    className: "master:sequencer",
    aliases: ["sequencer", "master:sequencer"],
    label: "Timed Event Sequencer",
    category: "CSMF Control Blocks",
    domain: "control",
    description: "Schedules piecewise state transitions over simulation time.",
    defaultWidth: 64,
    defaultHeight: 44,
    ports: [{ name: "Out", kind: "signal", side: "right", offsetX: 34, offsetY: 0 }],
    parameters: [
      {
        key: "Name",
        label: "Block Name",
        tab: "General",
        group: "Identification",
        kind: "string",
        defaultValue: "Seq1",
        description: "Sequencer identifier",
      },
      {
        key: "T1",
        label: "First Transition Time",
        tab: "Control",
        group: "Schedule",
        kind: "number",
        unit: "s",
        defaultValue: 0.05,
        min: 0,
        description: "First event transition time",
      },
      {
        key: "T2",
        label: "Second Transition Time",
        tab: "Control",
        group: "Schedule",
        kind: "number",
        unit: "s",
        defaultValue: 0.2,
        min: 0,
        description: "Second event transition time",
      },
      {
        key: "V0",
        label: "Initial Value",
        tab: "Control",
        group: "Schedule",
        kind: "number",
        defaultValue: 0,
        description: "Output before T1",
      },
      {
        key: "V1",
        label: "Mid Value",
        tab: "Control",
        group: "Schedule",
        kind: "number",
        defaultValue: 1,
        description: "Output between T1 and T2",
      },
      {
        key: "V2",
        label: "Final Value",
        tab: "Control",
        group: "Schedule",
        kind: "number",
        defaultValue: 0,
        description: "Output after T2",
      },
    ],
  },
  {
    className: "master:avr_ieeet1",
    aliases: [
      "avr_ieeet1",
      "exciter_st1a",
      "exciter_ac1a",
      "ieee_exciter",
      "master:ieee_exciter",
      "master:exciter_st1a",
      "master:exciter_ac1a",
    ],
    label: "IEEE 421.5 Exciter (IEEET1 / ST1A)",
    category: "Sources & Rotating Machines",
    domain: "control",
    description:
      "IEEE 421.5 Type 1 / ST1A / AC1A synchronous generator automatic voltage regulator and excitation system.",
    defaultWidth: 80,
    defaultHeight: 56,
    ports: [
      { name: "Vt", kind: "signal", side: "left", offsetX: -42, offsetY: -12 },
      { name: "Vs", kind: "signal", side: "left", offsetX: -42, offsetY: 12 },
      { name: "Efd", kind: "signal", side: "right", offsetX: 42, offsetY: 0 },
    ],
    parameters: [
      {
        key: "Name",
        label: "Exciter Name",
        tab: "General",
        group: "Identification",
        kind: "string",
        defaultValue: "AVR1",
        description: "Exciter identifier",
      },
      {
        key: "Vref",
        label: "Voltage Reference",
        tab: "Control",
        group: "AVR",
        kind: "number",
        unit: "pu",
        defaultValue: 1.05,
        description: "Terminal voltage setpoint",
      },
      {
        key: "KA",
        label: "Regulator Gain",
        tab: "Control",
        group: "AVR",
        kind: "number",
        unit: "pu",
        defaultValue: 200,
        min: 1,
        description: "AVR gain",
      },
      {
        key: "TA",
        label: "Regulator Time Constant",
        tab: "Control",
        group: "AVR",
        kind: "number",
        unit: "s",
        defaultValue: 0.02,
        min: 0.001,
        description: "AVR lag time constant",
      },
      {
        key: "VRmax",
        label: "Max Regulator Output",
        tab: "Control",
        group: "Limits",
        kind: "number",
        unit: "pu",
        defaultValue: 5.0,
        description: "Upper field forcing ceiling",
      },
      {
        key: "VRmin",
        label: "Min Regulator Output",
        tab: "Control",
        group: "Limits",
        kind: "number",
        unit: "pu",
        defaultValue: -5.0,
        description: "Lower field ceiling",
      },
      {
        key: "TE",
        label: "Exciter Time Constant",
        tab: "Control",
        group: "Exciter",
        kind: "number",
        unit: "s",
        defaultValue: 0.4,
        min: 0.001,
        description: "Exciter field time constant",
      },
      {
        key: "KE",
        label: "Exciter Constant",
        tab: "Control",
        group: "Exciter",
        kind: "number",
        unit: "pu",
        defaultValue: 1.0,
        description: "Self-excited field constant",
      },
      {
        key: "KF",
        label: "Stabilizer Feedback Gain",
        tab: "Control",
        group: "Stabilizer",
        kind: "number",
        unit: "pu",
        defaultValue: 0.03,
        description: "Rate feedback gain",
      },
      {
        key: "TF",
        label: "Stabilizer Time Constant",
        tab: "Control",
        group: "Stabilizer",
        kind: "number",
        unit: "s",
        defaultValue: 1.0,
        min: 0.01,
        description: "Rate feedback washout constant",
      },
    ],
  },
  {
    className: "master:tgov1",
    aliases: ["tgov1", "hygov", "ieee_governor", "master:ieee_governor", "master:hygov"],
    label: "IEEE Turbine-Governor (TGOV1 / HYGOV)",
    category: "Sources & Rotating Machines",
    domain: "control",
    description: "IEEE steam/hydro speed-droop turbine governor regulating mechanical power from shaft speed.",
    defaultWidth: 80,
    defaultHeight: 56,
    ports: [
      { name: "w", kind: "signal", side: "left", offsetX: -42, offsetY: 0 },
      { name: "Pm", kind: "signal", side: "right", offsetX: 42, offsetY: 0 },
    ],
    parameters: [
      {
        key: "Name",
        label: "Governor Name",
        tab: "General",
        group: "Identification",
        kind: "string",
        defaultValue: "GOV1",
        description: "Governor identifier",
      },
      {
        key: "Pref",
        label: "Power Reference",
        tab: "Control",
        group: "Droop",
        kind: "number",
        unit: "pu",
        defaultValue: 0.8,
        description: "Mechanical power setpoint",
      },
      {
        key: "R",
        label: "Permanent Droop",
        tab: "Control",
        group: "Droop",
        kind: "number",
        unit: "pu",
        defaultValue: 0.05,
        min: 0.01,
        description: "Speed-droop regulation",
      },
      {
        key: "T1",
        label: "Governor Lag Time",
        tab: "Control",
        group: "Dynamics",
        kind: "number",
        unit: "s",
        defaultValue: 0.1,
        min: 0.001,
        description: "Valve servomotor time constant",
      },
      {
        key: "T2",
        label: "Reheat Lead Time",
        tab: "Control",
        group: "Dynamics",
        kind: "number",
        unit: "s",
        defaultValue: 1.0,
        min: 0,
        description: "Turbine lead time constant",
      },
      {
        key: "T3",
        label: "Reheat Lag Time",
        tab: "Control",
        group: "Dynamics",
        kind: "number",
        unit: "s",
        defaultValue: 5.0,
        min: 0.001,
        description: "Turbine reheat time constant",
      },
      {
        key: "Vmax",
        label: "Max Gate/Valve",
        tab: "Control",
        group: "Limits",
        kind: "number",
        unit: "pu",
        defaultValue: 1.2,
        description: "Upper gate limit",
      },
      {
        key: "Vmin",
        label: "Min Gate/Valve",
        tab: "Control",
        group: "Limits",
        kind: "number",
        unit: "pu",
        defaultValue: 0.0,
        description: "Lower gate limit",
      },
      {
        key: "Dt",
        label: "Turbine Damping",
        tab: "Control",
        group: "Dynamics",
        kind: "number",
        unit: "pu",
        defaultValue: 0.0,
        description: "Speed damping factor",
      },
    ],
  },
  {
    className: "master:pss1a",
    aliases: ["pss1a", "ieee_pss", "master:ieee_pss"],
    label: "IEEE Power System Stabilizer (PSS1A)",
    category: "Sources & Rotating Machines",
    domain: "control",
    description: "Washout + 2-stage lead-lag IEEE PSS1A damping controller for rotor electromechanical oscillations.",
    defaultWidth: 76,
    defaultHeight: 52,
    ports: [
      { name: "Vsi", kind: "signal", side: "left", offsetX: -40, offsetY: 0 },
      { name: "Vst", kind: "signal", side: "right", offsetX: 40, offsetY: 0 },
    ],
    parameters: [
      {
        key: "Name",
        label: "PSS Name",
        tab: "General",
        group: "Identification",
        kind: "string",
        defaultValue: "PSS1",
        description: "PSS identifier",
      },
      {
        key: "Ks",
        aliases: ["K"],
        label: "Stabilizer Gain",
        tab: "Control",
        group: "Compensation",
        kind: "number",
        unit: "pu",
        defaultValue: 10,
        description: "Overall PSS damping gain",
      },
      {
        key: "Tw",
        label: "Washout Time Constant",
        tab: "Control",
        group: "Washout",
        kind: "number",
        unit: "s",
        defaultValue: 5.0,
        min: 0.1,
        description: "Washout high-pass constant",
      },
      {
        key: "T1",
        label: "Lead Time 1",
        tab: "Control",
        group: "Compensation",
        kind: "number",
        unit: "s",
        defaultValue: 0.3,
        min: 0,
        description: "Stage-1 lead constant",
      },
      {
        key: "T2",
        label: "Lag Time 1",
        tab: "Control",
        group: "Compensation",
        kind: "number",
        unit: "s",
        defaultValue: 0.05,
        min: 0.001,
        description: "Stage-1 lag constant",
      },
      {
        key: "T3",
        label: "Lead Time 2",
        tab: "Control",
        group: "Compensation",
        kind: "number",
        unit: "s",
        defaultValue: 0.3,
        min: 0,
        description: "Stage-2 lead constant",
      },
      {
        key: "T4",
        label: "Lag Time 2",
        tab: "Control",
        group: "Compensation",
        kind: "number",
        unit: "s",
        defaultValue: 0.05,
        min: 0.001,
        description: "Stage-2 lag constant",
      },
      {
        key: "VstMax",
        label: "Max Output",
        tab: "Control",
        group: "Limits",
        kind: "number",
        unit: "pu",
        defaultValue: 0.1,
        description: "Upper stabilizer clamp",
      },
      {
        key: "VstMin",
        label: "Min Output",
        tab: "Control",
        group: "Limits",
        kind: "number",
        unit: "pu",
        defaultValue: -0.1,
        description: "Lower stabilizer clamp",
      },
    ],
  },
  {
    className: "master:wecc_regc",
    aliases: [
      "wecc_regc",
      "wecc_reec",
      "wecc_repc",
      "wecc_ibr",
      "master:wecc_ibr",
      "master:wecc_reec",
      "master:wecc_repc",
    ],
    label: "WECC Generic IBR (REGC / REEC / REPC)",
    category: "Power Electronics, HVDC & FACTS",
    domain: "control",
    description:
      "WECC second-generation generic renewable IBR current/voltage/plant controller with LVPL and Q-priority fault ride-through.",
    defaultWidth: 84,
    defaultHeight: 56,
    ports: [
      { name: "Vt", kind: "signal", side: "left", offsetX: -44, offsetY: -12 },
      { name: "Freq", kind: "signal", side: "left", offsetX: -44, offsetY: 12 },
      { name: "Icmd", kind: "signal", side: "right", offsetX: 44, offsetY: 0 },
    ],
    parameters: [
      {
        key: "Name",
        label: "Controller Name",
        tab: "General",
        group: "Identification",
        kind: "string",
        defaultValue: "IBR_Ctrl1",
        description: "WECC IBR controller identifier",
      },
      {
        key: "Vref",
        label: "Voltage Reference",
        tab: "Control",
        group: "Reactive / FRT",
        kind: "number",
        unit: "pu",
        defaultValue: 1.0,
        description: "Nominal PCC voltage reference",
      },
      {
        key: "Pref",
        label: "Active Power Reference",
        tab: "Control",
        group: "Active Power",
        kind: "number",
        unit: "pu",
        defaultValue: 0.8,
        description: "Active power dispatch",
      },
      {
        key: "Kqv",
        label: "Reactive Voltage Support Gain",
        tab: "Control",
        group: "Reactive / FRT",
        kind: "number",
        unit: "pu/pu",
        defaultValue: 2.0,
        min: 0,
        description: "Dynamic reactive current injection gain during voltage sags",
      },
      {
        key: "dbd",
        label: "Voltage Deadband",
        tab: "Control",
        group: "Reactive / FRT",
        kind: "number",
        unit: "pu",
        defaultValue: 0.05,
        min: 0,
        description: "FRT reactive injection deadband",
      },
      {
        key: "Tg",
        label: "Converter Lag Constant",
        tab: "Control",
        group: "Converter",
        kind: "number",
        unit: "s",
        defaultValue: 0.02,
        min: 0.001,
        description: "REGC current loop time constant",
      },
      {
        key: "Imax",
        label: "Max Converter Current",
        tab: "Ratings",
        group: "Limits",
        kind: "number",
        unit: "pu",
        defaultValue: 1.1,
        min: 0.1,
        description: "Thermal current limit with Q-priority clamping",
      },
    ],
  },
];

/**
 * Auto-mounts the default clean-room `@modelscript/pscad-master-lib` asset package
 * into `globalLibraryRegistry` when running in Node (similar to Modelica/MSL auto-mount).
 */
export function ensureBuiltInPscadLibraryRegistered(): LoadedLibraryPackage | undefined {
  const existing = globalLibraryRegistry
    .getPackagesForLanguage("pscad")
    .find((p) => p.packageName === "@modelscript/pscad-master-lib");
  if (existing) return existing;

  if (
    typeof process !== "undefined" &&
    typeof (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule === "function"
  ) {
    try {
      const getMod = (process as unknown as { getBuiltinModule: <T = Record<string, unknown>>(id: string) => T })
        .getBuiltinModule;
      const nodeFs = getMod<typeof import("node:fs")>("node:fs");
      const nodePath = getMod<typeof import("node:path")>("node:path");
      const nodeUrl = getMod<typeof import("node:url")>("node:url");
      const here = nodePath.dirname(nodeUrl.fileURLToPath(import.meta.url));
      const candidates = [
        nodePath.resolve(here, "../../assets/pscad-master-lib"),
        nodePath.resolve(here, "../../../assets/pscad-master-lib"),
        nodePath.resolve(process.cwd(), "languages/pscad/assets/pscad-master-lib"),
      ];
      for (const dir of candidates) {
        const pkgPath = nodePath.join(dir, "package.json");
        if (!nodeFs.existsSync(pkgPath)) continue;
        const pkgJson = JSON.parse(nodeFs.readFileSync(pkgPath, "utf-8"));
        if (!isModelscriptLibraryPackageJson(pkgJson)) continue;
        let symbols: LibrarySymbolStub[] = [];
        if (pkgJson.modelscript.symbols) {
          const symbolsPath = nodePath.resolve(dir, pkgJson.modelscript.symbols);
          if (nodeFs.existsSync(symbolsPath)) {
            symbols = JSON.parse(nodeFs.readFileSync(symbolsPath, "utf-8"));
          }
        }
        let diagrams: DiagramComponentSpec[] | undefined;
        if (pkgJson.modelscript.diagrams) {
          const diagPath = nodePath.resolve(dir, pkgJson.modelscript.diagrams);
          if (nodeFs.existsSync(diagPath)) {
            diagrams = JSON.parse(nodeFs.readFileSync(diagPath, "utf-8"));
          }
        }
        let wasmBytes: Uint8Array | undefined;
        if (pkgJson.modelscript.runtime?.wasm) {
          const wasmPath = nodePath.resolve(dir, pkgJson.modelscript.runtime.wasm);
          if (nodeFs.existsSync(wasmPath)) {
            wasmBytes = new Uint8Array(nodeFs.readFileSync(wasmPath));
          }
        }
        return globalLibraryRegistry.registerLibraryBundle(pkgJson, {
          symbols,
          diagrams,
          wasmBytes,
        });
      }
    } catch {
      // Browser or non-fs environment: fall through to bundled JSON registration below.
    }
  }
  return globalLibraryRegistry.registerLibraryBundle(PSCAD_MASTER_LIB_PKG_JSON, {
    symbols: PSCAD_MASTER_LIB_SYMBOLS,
    diagrams: PSCAD_MASTER_LIB_DIAGRAMS,
  });
}

/**
 * Registers an external `package.json#modelscript` library bundle (e.g. mined clean-room
 * `symbols.json` + `diagrams.json` + optional `.wasm`) for PSCAD in Node or Browser/Morsel.
 */
export function registerPscadLibraryBundle(
  pkgJson: { name: string; version?: string; modelscript: ModelscriptLibraryManifest },
  payload: {
    symbols: LibrarySymbolStub[];
    diagrams?: DiagramComponentSpec[] | undefined;
    wasmBytes?: Uint8Array | undefined;
  },
): LoadedLibraryPackage {
  return globalLibraryRegistry.registerLibraryBundle(pkgJson, payload);
}

/**
 * Looks up a component's diagram/port specification from any registered `package.json#modelscript`
 * PSCAD library (including `@modelscript/pscad-master-lib` and user-loaded packs).
 */
export function getPscadDiagramSpecFromLibraries(defnOrAlias: string): DiagramComponentSpec | undefined {
  ensureBuiltInPscadLibraryRegistered();
  return globalLibraryRegistry.getDiagramSpec("pscad", defnOrAlias);
}

/**
 * Node.js helper: exports `PscadComponentSchema[]` (defaulting to loaded library schemas)
 * to a standalone `package.json` library directory (`package.json`, `dist/symbols.json`, `dist/diagrams.json`).
 */
export async function exportSchemasToLibraryPackageDir(
  outDir: string,
  options?: { name?: string; version?: string; schemas?: PscadComponentSchema[] },
): Promise<void> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const pkgName = options?.name ?? "@modelscript/pscad-master-lib";
  const version = options?.version ?? "0.1.0";
  const schemas = options?.schemas ?? getPscadSchemasFromLibraries();

  const { symbols, diagrams } = schemasToLibraryPayloads(schemas);
  const distDir = path.join(outDir, "dist");
  fs.mkdirSync(distDir, { recursive: true });

  const pkgJson = {
    name: pkgName,
    version,
    license: "AGPL-3.0-or-later",
    modelscript: {
      category: "library",
      language: "pscad",
      symbols: "./dist/symbols.json",
      diagrams: "./dist/diagrams.json",
    } satisfies ModelscriptLibraryManifest,
  };

  fs.writeFileSync(path.join(outDir, "package.json"), JSON.stringify(pkgJson, null, 2) + "\n", "utf-8");
  fs.writeFileSync(path.join(distDir, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
  fs.writeFileSync(path.join(distDir, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");
}
