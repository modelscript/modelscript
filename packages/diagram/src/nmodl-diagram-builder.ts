// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/diagram — Computational Neuroscience & Electrophysiology Schematic Builder.
 *
 * Translates NEURON NMODL (.mod) ion channel mechanisms into interactive AntV X6 graphs and standalone SVGs:
 * 1. Membrane lipid bilayer equivalent circuit (Membrane capacitance Cm, intracellular vs extracellular).
 * 2. Voltage-gated and ligand-gated ion channel conductances (Nav, Kv, Cav, Leak) with reversal potentials.
 * 3. Intracellular current-clamp injection electrodes (Iclamp).
 * 4. Real-time action potential Vm(t) waveform sparklines and gating variable limit cycles.
 */

export interface NmodlChannelBranch {
  id: string;
  name: string;
  ion: "na" | "k" | "ca" | "cl" | "leak" | "generic";
  conductanceParam?: string | undefined;
  reversalPotentialParam?: string | undefined;
  gatingFormula?: string | undefined;
  currentVariable?: string | undefined;
  sparklineSvg?: string | undefined;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NmodlElectrodePort {
  id: string;
  label: string;
  ampParam?: string | undefined;
  durParam?: string | undefined;
}

export interface NmodlDiagramGraph {
  title: string;
  mechanismName: string;
  membraneCapacitanceUf: number;
  channels: NmodlChannelBranch[];
  electrodes: NmodlElectrodePort[];
  width: number;
  height: number;
  actionPotentialTrajectory?: { times: number[]; vm: number[] } | undefined;
  peakVoltageMv?: number | undefined;
  apDurationMs?: number | undefined;
}

/**
 * Builds an electrophysiology equivalent membrane circuit diagram from NMODL parameters.
 */
export function buildNmodlDiagram(options: {
  title?: string | undefined;
  mechanismName?: string | undefined;
  channels?:
    | Array<{
        name: string;
        ion: "na" | "k" | "ca" | "cl" | "leak" | "generic";
        conductanceParam?: string | undefined;
        reversalPotentialParam?: string | undefined;
        gatingFormula?: string | undefined;
        currentVariable?: string | undefined;
      }>
    | undefined;
  hasElectrode?: boolean | undefined;
  membraneCapacitanceUf?: number | undefined;
}): NmodlDiagramGraph {
  const mechanismName = options.mechanismName ?? "HodgkinHuxley";
  const title = options.title ?? `${mechanismName} Membrane Circuit`;
  const cm = options.membraneCapacitanceUf ?? 1.0;

  const defaultChannels = [
    {
      name: "Sodium Nav",
      ion: "na" as const,
      conductanceParam: "gnabar = 0.12",
      reversalPotentialParam: "ena = 50.0 mV",
      gatingFormula: "m^3 * h",
      currentVariable: "ina",
    },
    {
      name: "Potassium Kv",
      ion: "k" as const,
      conductanceParam: "gkbar = 0.036",
      reversalPotentialParam: "ek = -77.0 mV",
      gatingFormula: "n^4",
      currentVariable: "ik",
    },
    {
      name: "Leak Channel",
      ion: "leak" as const,
      conductanceParam: "gl = 0.0003",
      reversalPotentialParam: "el = -54.3 mV",
      gatingFormula: "1.0",
      currentVariable: "il",
    },
  ];

  const channelDefs = options.channels ?? defaultChannels;
  const startX = 140;
  const spacingX = 135;
  const branchY = 110;
  const boxW = 110;
  const boxH = 115;

  const channels: NmodlChannelBranch[] = channelDefs.map((ch, idx) => ({
    id: `ch_${idx + 1}`,
    name: ch.name,
    ion: ch.ion,
    conductanceParam: ch.conductanceParam,
    reversalPotentialParam: ch.reversalPotentialParam,
    gatingFormula: ch.gatingFormula,
    currentVariable: ch.currentVariable,
    x: startX + idx * spacingX,
    y: branchY,
    width: boxW,
    height: boxH,
  }));

  const electrodes: NmodlElectrodePort[] = [];
  if (options.hasElectrode ?? true) {
    electrodes.push({
      id: "iclamp_1",
      label: "I_inj = 10 nA",
      ampParam: "amp = 10.0 nA",
      durParam: "dur = 20.0 ms",
    });
  }

  const totalWidth = Math.max(680, startX + channels.length * spacingX + 80);
  const totalHeight = 340;

  return {
    title,
    mechanismName,
    membraneCapacitanceUf: cm,
    channels,
    electrodes,
    width: totalWidth,
    height: totalHeight,
  };
}

/**
 * Attaches real-time action potential simulation trajectories to the electrophysiology diagram.
 */
export function attachActionPotentialTrajectory(
  graph: NmodlDiagramGraph,
  trajectory: { times: number[]; vm: number[] },
): NmodlDiagramGraph {
  if (!trajectory.vm || trajectory.vm.length === 0) return graph;

  graph.actionPotentialTrajectory = trajectory;
  graph.peakVoltageMv = Math.max(...trajectory.vm);

  // Compute AP duration APD90 (time above 90% repolarization)
  const restVm = trajectory.vm[0] ?? -65.0;
  const peak = graph.peakVoltageMv;
  const thresh90 = restVm + 0.1 * (peak - restVm);

  let firstCrossing = -1;
  let lastCrossing = -1;
  for (let i = 0; i < trajectory.times.length; i++) {
    const v = trajectory.vm[i] ?? -65;
    const t = trajectory.times[i] ?? 0;
    if (v >= thresh90 && firstCrossing < 0) firstCrossing = t;
    if (v >= thresh90) lastCrossing = t;
  }
  if (firstCrossing >= 0 && lastCrossing >= firstCrossing) {
    graph.apDurationMs = lastCrossing - firstCrossing;
  }

  return graph;
}

/**
 * Renders standalone high-fidelity vector SVG of the electrophysiology membrane circuit.
 */
export function renderNmodlDiagramSvg(graph: NmodlDiagramGraph, theme: "light" | "dark" = "dark"): string {
  const isDark = theme === "dark";
  const bg = isDark ? "#0b0f19" : "#ffffff";
  const textColor = isDark ? "#f8fafc" : "#0f172a";
  const subTextColor = isDark ? "#94a3b8" : "#475569";
  const intraRailY = 70;
  const extraRailY = 270;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${graph.width} ${graph.height}" width="100%" height="100%" style="background-color: ${bg}; font-family: ui-sans-serif, system-ui, sans-serif;">\n`;

  // Defs & Gradients
  svg += `  <defs>\n`;
  svg += `    <linearGradient id="intra-grad" x1="0%" y1="0%" x2="100%" y2="0%">\n`;
  svg += `      <stop offset="0%" stop-color="#38bdf8" />\n`;
  svg += `      <stop offset="100%" stop-color="#818cf8" />\n`;
  svg += `    </linearGradient>\n`;
  svg += `  </defs>\n`;

  // Header Title
  svg += `  <text x="30" y="36" fill="${textColor}" font-size="16" font-weight="700">${graph.title}</text>\n`;
  if (graph.peakVoltageMv !== undefined) {
    svg += `  <text x="${graph.width - 30}" y="36" fill="#38bdf8" font-size="13" font-weight="700" text-anchor="end">Peak Vm: ${graph.peakVoltageMv.toFixed(1)} mV (APD90: ${(graph.apDurationMs ?? 2.5).toFixed(1)} ms)</text>\n`;
  }

  // Intracellular Rail (Top)
  svg += `  <!-- Intracellular Rail (Vm) -->\n`;
  svg += `  <line x1="50" y1="${intraRailY}" x2="${graph.width - 50}" y2="${intraRailY}" stroke="url(#intra-grad)" stroke-width="4" stroke-linecap="round" />\n`;
  svg += `  <text x="45" y="${intraRailY - 10}" fill="#38bdf8" font-size="11" font-weight="700">Intracellular (Vm)</text>\n`;

  // Extracellular Rail (Bottom)
  svg += `  <!-- Extracellular Ground Rail -->\n`;
  svg += `  <line x1="50" y1="${extraRailY}" x2="${graph.width - 50}" y2="${extraRailY}" stroke="${subTextColor}" stroke-width="4" stroke-linecap="round" />\n`;
  svg += `  <text x="45" y="${extraRailY + 22}" fill="${subTextColor}" font-size="11" font-weight="600">Extracellular (Ground 0 mV)</text>\n`;

  // Membrane Capacitance Branch
  const capX = 75;
  svg += `  <!-- Membrane Capacitance (Cm) -->\n`;
  svg += `  <line x1="${capX}" y1="${intraRailY}" x2="${capX}" y2="${intraRailY + 40}" stroke="#38bdf8" stroke-width="2.5" />\n`;
  svg += `  <line x1="${capX - 16}" y1="${intraRailY + 40}" x2="${capX + 16}" y2="${intraRailY + 40}" stroke="#38bdf8" stroke-width="3.5" />\n`;
  svg += `  <line x1="${capX - 16}" y1="${intraRailY + 52}" x2="${capX + 16}" y2="${intraRailY + 52}" stroke="#38bdf8" stroke-width="3.5" />\n`;
  svg += `  <line x1="${capX}" y1="${intraRailY + 52}" x2="${capX}" y2="${extraRailY}" stroke="${subTextColor}" stroke-width="2.5" />\n`;
  svg += `  <text x="${capX + 18}" y="${intraRailY + 50}" fill="${textColor}" font-size="10" font-weight="700">Cm</text>\n`;
  svg += `  <text x="${capX + 18}" y="${intraRailY + 63}" fill="${subTextColor}" font-size="8.5">${graph.membraneCapacitanceUf} µF/cm²</text>\n`;

  // Ion Channel Conductance Branches
  for (const ch of graph.channels) {
    let ionColor = "#38bdf8";
    if (ch.ion === "na")
      ionColor = "#f59e0b"; // Sodium amber
    else if (ch.ion === "k")
      ionColor = "#8b5cf6"; // Potassium purple
    else if (ch.ion === "ca")
      ionColor = "#ec4899"; // Calcium pink
    else if (ch.ion === "leak") ionColor = "#10b981"; // Leak green

    const midX = ch.x + ch.width / 2;

    // Connectors from intra/extra rails to channel box
    svg += `  <line x1="${midX}" y1="${intraRailY}" x2="${midX}" y2="${ch.y}" stroke="${ionColor}" stroke-width="2" />\n`;
    svg += `  <circle cx="${midX}" cy="${intraRailY}" r="3.5" fill="${ionColor}" />\n`;
    svg += `  <line x1="${midX}" y1="${ch.y + ch.height}" x2="${midX}" y2="${extraRailY}" stroke="${subTextColor}" stroke-width="2" />\n`;
    svg += `  <circle cx="${midX}" cy="${extraRailY}" r="3.5" fill="${subTextColor}" />\n`;

    // Channel Box
    const boxBg = isDark ? "rgba(15, 23, 42, 0.85)" : "#f8fafc";
    svg += `  <!-- Channel Branch: ${ch.name} -->\n`;
    svg += `  <rect x="${ch.x}" y="${ch.y}" width="${ch.width}" height="${ch.height}" rx="8" fill="${boxBg}" stroke="${ionColor}" stroke-width="2" />\n`;
    svg += `  <rect x="${ch.x}" y="${ch.y}" width="${ch.width}" height="24" rx="8" fill="${ionColor}" opacity="0.25" />\n`;
    svg += `  <text x="${ch.x + 8}" y="${ch.y + 16}" fill="${textColor}" font-size="10" font-weight="700">${ch.name}</text>\n`;

    if (ch.conductanceParam) {
      svg += `  <text x="${ch.x + 8}" y="${ch.y + 42}" fill="${subTextColor}" font-size="8.5">Cond: ${ch.conductanceParam}</text>\n`;
    }
    if (ch.reversalPotentialParam) {
      svg += `  <text x="${ch.x + 8}" y="${ch.y + 58}" fill="${subTextColor}" font-size="8.5">Rev: ${ch.reversalPotentialParam}</text>\n`;
    }
    if (ch.gatingFormula) {
      svg += `  <text x="${ch.x + 8}" y="${ch.y + 74}" fill="${ionColor}" font-size="8.5" font-weight="600">Gate: ${ch.gatingFormula}</text>\n`;
    }
    if (ch.currentVariable) {
      svg += `  <text x="${ch.x + 8}" y="${ch.y + 90}" fill="${textColor}" font-size="8.5">Current: ${ch.currentVariable}</text>\n`;
    }
  }

  // Draw Current Clamp Electrode
  for (const el of graph.electrodes) {
    const elX = graph.width - 55;
    const elY = intraRailY - 35;
    svg += `  <!-- Current Clamp Electrode -->\n`;
    svg += `  <line x1="${elX}" y1="${elY}" x2="${elX}" y2="${intraRailY}" stroke="#e11d48" stroke-width="3" />\n`;
    svg += `  <polygon points="${elX},${intraRailY} ${elX - 4},${intraRailY - 10} ${elX + 4},${intraRailY - 10}" fill="#e11d48" />\n`;
    svg += `  <circle cx="${elX}" cy="${elY}" r="7" fill="#e11d48" />\n`;
    svg += `  <text x="${elX - 10}" y="${elY + 4}" fill="#e11d48" font-size="9" font-weight="700" text-anchor="end">${el.label}</text>\n`;
  }

  // Sparkline Overlay for Action Potential if present
  if (graph.actionPotentialTrajectory) {
    const traj = graph.actionPotentialTrajectory;
    const sparkW = 120;
    const sparkH = 45;
    const sparkX = graph.width - sparkW - 35;
    const sparkY = extraRailY - sparkH - 10;

    const minV = Math.min(...traj.vm);
    const maxV = Math.max(...traj.vm);
    const rangeV = maxV > minV ? maxV - minV : 1;
    const minT = traj.times[0] ?? 0;
    const maxT = traj.times[traj.times.length - 1] ?? 1;
    const rangeT = maxT > minT ? maxT - minT : 1;

    const pts: string[] = [];
    for (let i = 0; i < traj.times.length; i++) {
      const t = traj.times[i] ?? 0;
      const v = traj.vm[i] ?? 0;
      const px = sparkX + ((t - minT) / rangeT) * sparkW;
      const py = sparkY + sparkH - ((v - minV) / rangeV) * sparkH;
      pts.push(`${px.toFixed(1)},${py.toFixed(1)}`);
    }

    svg += `  <!-- Action Potential Vm(t) Sparkline -->\n`;
    svg += `  <rect x="${sparkX - 6}" y="${sparkY - 6}" width="${sparkW + 12}" height="${sparkH + 18}" rx="6" fill="${isDark ? "rgba(2, 6, 23, 0.9)" : "#ffffff"}" stroke="#38bdf8" stroke-width="1.5" />\n`;
    svg += `  <text x="${sparkX}" y="${sparkY + sparkH + 8}" fill="#38bdf8" font-size="8.5" font-weight="700">Action Potential Vm(t)</text>\n`;
    svg += `  <polyline points="${pts.join(" ")}" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" />\n`;
  }

  svg += `</svg>\n`;
  return svg;
}

// ─────────────────────────────────────────────────────────────────────────────
// Morphological Multi-Compartment Cable Model
// ─────────────────────────────────────────────────────────────────────────────

export type MorphologyCompartmentKind =
  | "soma"
  | "apical_dendrite"
  | "basal_dendrite"
  | "axon_initial_segment"
  | "axon"
  | "synapse";

export interface NmodlChannelBadge {
  ion: "na" | "k" | "ca" | "cl" | "leak" | "generic";
  name: string;
  density: number; // Conductance multiplier or S/cm²
  formula?: string | undefined;
}

export interface NmodlMorphologyNode {
  id: string;
  parentId: string | null;
  kind: MorphologyCompartmentKind;
  name: string;
  lengthUm: number;
  diameterUm: number;
  x: number;
  y: number;
  vmMv?: number | undefined;
  channels: NmodlChannelBadge[];
  electrode?: { ampNa: number; label: string } | undefined;
}

export interface NmodlMorphologyCable {
  title: string;
  mechanismName?: string | undefined;
  nodes: NmodlMorphologyNode[];
  width: number;
  height: number;
  scaleBarUm?: number | undefined;
  timeMs?: number | undefined;
}

/**
 * Builds a canonical multi-compartment neuron arborization morphology with
 * soma, apical dendrite trunk/tuft, basal dendrites, axon initial segment (AIS),
 * and main axon with ion channel badges.
 */
export function buildDefaultNeuronMorphology(
  mechanismName = "HodgkinHuxley",
  options?: {
    injAmp?: number | undefined;
    somaVm?: number | undefined;
  },
): NmodlMorphologyCable {
  const injAmp = options?.injAmp ?? 10.0;
  const restVm = options?.somaVm ?? -65.0;

  const nodes: NmodlMorphologyNode[] = [
    // 1. Soma
    {
      id: "soma",
      parentId: null,
      kind: "soma",
      name: "Soma",
      lengthUm: 20.0,
      diameterUm: 20.0,
      x: 350,
      y: 220,
      vmMv: restVm,
      channels: [
        { ion: "na", name: "Nav1.6", density: 1.0, formula: "m^3*h" },
        { ion: "k", name: "Kv2.1", density: 0.8, formula: "n^4" },
        { ion: "ca", name: "Cav2.2", density: 0.3, formula: "s^2*r" },
        { ion: "leak", name: "I_leak", density: 0.1 },
      ],
      electrode: { ampNa: injAmp, label: `I_inj = ${injAmp.toFixed(1)} nA` },
    },
    // 2. Apical Dendrite Trunk
    {
      id: "apical_trunk",
      parentId: "soma",
      kind: "apical_dendrite",
      name: "Apical Trunk",
      lengthUm: 70.0,
      diameterUm: 3.5,
      x: 350,
      y: 135,
      vmMv: restVm + 1.2,
      channels: [
        { ion: "k", name: "Kv4.2 (A-type)", density: 1.2, formula: "a^3*b" },
        { ion: "ca", name: "Cav1.2 (L-type)", density: 0.5 },
        { ion: "leak", name: "I_leak", density: 0.1 },
      ],
    },
    // 3. Apical Tuft Branch A (Left)
    {
      id: "apical_tuft_1",
      parentId: "apical_trunk",
      kind: "apical_dendrite",
      name: "Apical Tuft A",
      lengthUm: 50.0,
      diameterUm: 1.8,
      x: 260,
      y: 55,
      vmMv: restVm + 0.8,
      channels: [
        { ion: "ca", name: "Cav3.1 (T-type)", density: 0.7 },
        { ion: "k", name: "SK2", density: 0.4 },
        { ion: "leak", name: "I_leak", density: 0.1 },
      ],
    },
    // 4. Apical Tuft Branch B (Right)
    {
      id: "apical_tuft_2",
      parentId: "apical_trunk",
      kind: "apical_dendrite",
      name: "Apical Tuft B",
      lengthUm: 50.0,
      diameterUm: 1.8,
      x: 440,
      y: 55,
      vmMv: restVm + 0.8,
      channels: [
        { ion: "ca", name: "Cav3.1 (T-type)", density: 0.7 },
        { ion: "k", name: "SK2", density: 0.4 },
        { ion: "leak", name: "I_leak", density: 0.1 },
      ],
    },
    // 5. Basal Dendrite Left
    {
      id: "basal_1",
      parentId: "soma",
      kind: "basal_dendrite",
      name: "Basal Dendrite A",
      lengthUm: 45.0,
      diameterUm: 2.2,
      x: 230,
      y: 265,
      vmMv: restVm + 0.3,
      channels: [
        { ion: "k", name: "Kv1.1", density: 0.4 },
        { ion: "leak", name: "I_leak", density: 0.1 },
      ],
    },
    // 6. Basal Dendrite Right
    {
      id: "basal_2",
      parentId: "soma",
      kind: "basal_dendrite",
      name: "Basal Dendrite B",
      lengthUm: 45.0,
      diameterUm: 2.2,
      x: 470,
      y: 265,
      vmMv: restVm + 0.3,
      channels: [
        { ion: "k", name: "Kv1.1", density: 0.4 },
        { ion: "leak", name: "I_leak", density: 0.1 },
      ],
    },
    // 7. Axon Initial Segment (AIS) - High Nav Density for Spike Triggering
    {
      id: "ais",
      parentId: "soma",
      kind: "axon_initial_segment",
      name: "Axon Initial Segment (AIS)",
      lengthUm: 30.0,
      diameterUm: 1.5,
      x: 350,
      y: 295,
      vmMv: restVm + 2.5,
      channels: [
        { ion: "na", name: "Nav1.6 (Dense)", density: 3.5, formula: "m^3*h" },
        { ion: "k", name: "Kv1.2/Kv7", density: 1.8, formula: "n^4" },
        { ion: "leak", name: "I_leak", density: 0.05 },
      ],
    },
    // 8. Main Axon Trunk
    {
      id: "axon_trunk",
      parentId: "ais",
      kind: "axon",
      name: "Myelinated Axon Trunk",
      lengthUm: 80.0,
      diameterUm: 1.0,
      x: 350,
      y: 380,
      vmMv: restVm + 1.0,
      channels: [
        { ion: "na", name: "Nav1.6 (Node)", density: 1.0 },
        { ion: "k", name: "Kv3.1", density: 0.6 },
        { ion: "leak", name: "I_leak", density: 0.02 },
      ],
    },
    // 9. Axon Terminal & Bouton
    {
      id: "axon_terminal",
      parentId: "axon_trunk",
      kind: "axon",
      name: "Presynaptic Terminal",
      lengthUm: 35.0,
      diameterUm: 1.4,
      x: 350,
      y: 440,
      vmMv: restVm,
      channels: [
        { ion: "ca", name: "Cav2.1 (P/Q-type)", density: 2.0 },
        { ion: "k", name: "BK/SK", density: 0.8 },
        { ion: "leak", name: "I_leak", density: 0.05 },
      ],
    },
  ];

  return {
    title: `${mechanismName} Multi-Compartment Cable Morphology`,
    mechanismName,
    nodes,
    width: 720,
    height: 520,
    scaleBarUm: 50.0,
  };
}

/**
 * Maps a membrane potential (in mV) to an electrophysiology heat colormap:
 * - -75 mV: Resting Hyperpolarized (#0284c7 cyan-blue)
 * - -55 mV: Spike Threshold (#10b981 emerald)
 * - 0 mV: Depolarized Neutral (#f59e0b amber)
 * - +40 mV: Action Potential Peak (#ef4444 ruby red)
 */
function voltageToColor(vm: number, range: [number, number] = [-75, 40]): string {
  const minV = range[0];
  const maxV = range[1];
  const clamped = Math.max(minV, Math.min(maxV, vm));
  const t = (clamped - minV) / (maxV - minV || 1);

  if (t < 0.25) {
    // Deep blue to cyan
    return "#0284c7";
  } else if (t < 0.45) {
    // Cyan to emerald (threshold)
    return "#10b981";
  } else if (t < 0.75) {
    // Emerald to amber
    return "#f59e0b";
  } else {
    // Amber to crimson peak
    return "#ef4444";
  }
}

/**
 * Returns ion-specific color badge styling.
 */
function getIonColor(ion: NmodlChannelBadge["ion"]): string {
  switch (ion) {
    case "na":
      return "#f59e0b"; // Amber (Sodium)
    case "k":
      return "#8b5cf6"; // Violet (Potassium)
    case "ca":
      return "#ec4899"; // Pink/Rose (Calcium)
    case "cl":
      return "#06b6d4"; // Cyan (Chloride)
    case "leak":
      return "#10b981"; // Emerald (Leak)
    default:
      return "#38bdf8"; // Light Blue
  }
}

/**
 * Renders standalone anatomical multi-compartment cable diagram SVG for NEURON mechanisms.
 */
export function renderMorphologicalCableSvg(
  cable: NmodlMorphologyCable,
  options?: {
    theme?: "light" | "dark" | undefined;
    showChannelBadges?: boolean | undefined;
    showVoltageHeatmap?: boolean | undefined;
    voltageRange?: [number, number] | undefined;
  },
): string {
  const theme = options?.theme ?? "dark";
  const isDark = theme === "dark";
  const bg = isDark ? "#090d16" : "#ffffff";
  const textColor = isDark ? "#f8fafc" : "#0f172a";
  const subTextColor = isDark ? "#94a3b8" : "#475569";
  const borderColor = isDark ? "#1e293b" : "#e2e8f0";
  const showBadges = options?.showChannelBadges ?? true;
  const showHeatmap = options?.showVoltageHeatmap ?? true;
  const vRange = options?.voltageRange ?? [-75, 40];

  const nodeMap = new Map<string, NmodlMorphologyNode>();
  for (const n of cable.nodes) nodeMap.set(n.id, n);

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cable.width} ${cable.height}" width="100%" height="100%" style="background-color: ${bg}; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;">\n`;

  // Defs & Gradients
  svg += `  <defs>\n`;
  svg += `    <filter id="cable-glow" x="-20%" y="-20%" width="140%" height="140%">\n`;
  svg += `      <feGaussianBlur stdDeviation="3" result="blur" />\n`;
  svg += `      <feComposite in="SourceGraphic" in2="blur" operator="over" />\n`;
  svg += `    </filter>\n`;
  svg += `    <linearGradient id="v-scale-grad" x1="0%" y1="100%" x2="0%" y2="0%">\n`;
  svg += `      <stop offset="0%" stop-color="#0284c7" />\n`;
  svg += `      <stop offset="35%" stop-color="#10b981" />\n`;
  svg += `      <stop offset="70%" stop-color="#f59e0b" />\n`;
  svg += `      <stop offset="100%" stop-color="#ef4444" />\n`;
  svg += `    </linearGradient>\n`;
  svg += `  </defs>\n`;

  // Title Header
  svg += `  <!-- Header -->\n`;
  svg += `  <text x="30" y="32" fill="${textColor}" font-size="15" font-weight="700">${cable.title}</text>\n`;
  svg += `  <text x="30" y="48" fill="${subTextColor}" font-size="11">Multi-compartment anatomical cable model (Soma, AIS, Axon, Apical &amp; Basal dendrites)</text>\n`;

  // Draw Neurite Segments (Connecting Edges)
  svg += `  <!-- Neurite Cable Branches -->\n`;
  for (const node of cable.nodes) {
    if (!node.parentId) continue;
    const parent = nodeMap.get(node.parentId);
    if (!parent) continue;

    const strokeColor =
      showHeatmap && node.vmMv !== undefined
        ? voltageToColor(node.vmMv, vRange)
        : node.kind.includes("axon")
          ? "#818cf8"
          : "#38bdf8";

    const strokeW = Math.max(2.5, Math.min(12, node.diameterUm * 2.2));

    svg += `  <line x1="${parent.x}" y1="${parent.y}" x2="${node.x}" y2="${node.y}" stroke="${strokeColor}" stroke-width="${strokeW.toFixed(1)}" stroke-linecap="round" />\n`;
  }

  // Draw Soma Body & Nodes
  svg += `  <!-- Compartment Nodes -->\n`;
  for (const node of cable.nodes) {
    const isSoma = node.kind === "soma";
    const vColor = showHeatmap && node.vmMv !== undefined ? voltageToColor(node.vmMv, vRange) : "#38bdf8";

    if (isSoma) {
      // Anatomical Soma Body
      const r = Math.max(14, node.diameterUm * 0.9);
      svg += `  <ellipse cx="${node.x}" cy="${node.y}" rx="${(r * 1.25).toFixed(1)}" ry="${r.toFixed(1)}" fill="${isDark ? "rgba(15, 23, 42, 0.9)" : "#f8fafc"}" stroke="${vColor}" stroke-width="3" filter="url(#cable-glow)" />\n`;
      svg += `  <text x="${node.x}" y="${node.y - 2}" fill="${textColor}" font-size="11" font-weight="700" text-anchor="middle">${node.name}</text>\n`;
      if (node.vmMv !== undefined) {
        svg += `  <text x="${node.x}" y="${node.y + 11}" fill="${vColor}" font-size="9.5" font-weight="700" text-anchor="middle">${node.vmMv.toFixed(1)} mV</text>\n`;
      }
    } else {
      // Branch Node Endpoint
      const nr = Math.max(3, node.diameterUm * 0.85);
      svg += `  <circle cx="${node.x}" cy="${node.y}" r="${nr.toFixed(1)}" fill="${vColor}" stroke="${borderColor}" stroke-width="1.5" />\n`;
    }

    // Electrode Pipet Marker
    if (node.electrode) {
      const el = node.electrode;
      const elX = node.x - 70;
      const elY = node.y - 20;
      svg += `  <!-- Current Clamp Electrode -->\n`;
      svg += `  <line x1="${elX}" y1="${elY}" x2="${node.x - 18}" y2="${node.y - 6}" stroke="#ef4444" stroke-width="2.5" />\n`;
      svg += `  <polygon points="${node.x - 18},${node.y - 6} ${node.x - 26},${node.y - 12} ${node.x - 22},${node.y - 2}" fill="#ef4444" />\n`;
      svg += `  <rect x="${elX - 60}" y="${elY - 14}" width="65" height="18" rx="4" fill="${isDark ? "rgba(239, 68, 68, 0.2)" : "#fee2e2"}" stroke="#ef4444" stroke-width="1.2" />\n`;
      svg += `  <text x="${elX - 28}" y="${elY - 2}" fill="#ef4444" font-size="8.5" font-weight="700" text-anchor="middle">${el.label}</text>\n`;
    }

    // Channel Badges Group
    if (showBadges && node.channels.length > 0) {
      let badgeX = node.x + 14;
      let badgeY = node.y - node.channels.length * 9;
      if (node.x > cable.width - 180) {
        badgeX = node.x - 110;
      }

      svg += `  <!-- Badges for ${node.name} -->\n`;
      for (const ch of node.channels) {
        const ionColor = getIonColor(ch.ion);
        svg += `  <g transform="translate(${badgeX}, ${badgeY})">\n`;
        svg += `    <rect x="0" y="0" width="85" height="15" rx="3.5" fill="${isDark ? "rgba(15, 23, 42, 0.85)" : "#f1f5f9"}" stroke="${ionColor}" stroke-width="1" />\n`;
        svg += `    <circle cx="7" cy="7.5" r="3" fill="${ionColor}" />\n`;
        svg += `    <text x="14" y="10.5" fill="${textColor}" font-size="8" font-weight="600">${ch.name}</text>\n`;
        svg += `    <text x="80" y="10.5" fill="${subTextColor}" font-size="7.5" text-anchor="end">${ch.density.toFixed(1)}x</text>\n`;
        svg += `  </g>\n`;
        badgeY += 17;
      }
    }
  }

  // Scale Bar (50 µm) in bottom-left
  const sbX = 30;
  const sbY = cable.height - 35;
  const sbWidth = 70; // 70px = 50 µm
  svg += `  <!-- Scale Bar -->\n`;
  svg += `  <line x1="${sbX}" y1="${sbY}" x2="${sbX + sbWidth}" y2="${sbY}" stroke="${textColor}" stroke-width="3" stroke-linecap="square" />\n`;
  svg += `  <line x1="${sbX}" y1="${sbY - 4}" x2="${sbX}" y2="${sbY + 4}" stroke="${textColor}" stroke-width="1.5" />\n`;
  svg += `  <line x1="${sbX + sbWidth}" y1="${sbY - 4}" x2="${sbX + sbWidth}" y2="${sbY + 4}" stroke="${textColor}" stroke-width="1.5" />\n`;
  svg += `  <text x="${sbX + sbWidth / 2}" y="${sbY - 6}" fill="${textColor}" font-size="9" font-weight="700" text-anchor="middle">${cable.scaleBarUm ?? 50} µm</text>\n`;

  // Voltage Heatmap Colormap Bar in bottom-right
  if (showHeatmap) {
    const cbX = cable.width - 150;
    const cbY = cable.height - 95;
    const cbW = 12;
    const cbH = 65;

    svg += `  <!-- Voltage Colormap Legend -->\n`;
    svg += `  <rect x="${cbX}" y="${cbY}" width="${cbW}" height="${cbH}" rx="2" fill="url(#v-scale-grad)" stroke="${borderColor}" stroke-width="1" />\n`;
    svg += `  <text x="${cbX + cbW + 8}" y="${cbY + 8}" fill="#ef4444" font-size="8" font-weight="700">+40 mV (Peak)</text>\n`;
    svg += `  <text x="${cbX + cbW + 8}" y="${cbY + cbH / 2 + 3}" fill="#10b981" font-size="8" font-weight="600">-55 mV (Thresh)</text>\n`;
    svg += `  <text x="${cbX + cbW + 8}" y="${cbY + cbH}" fill="#0284c7" font-size="8" font-weight="600">-75 mV (Rest)</text>\n`;
    svg += `  <text x="${cbX - 6}" y="${cbY - 6}" fill="${subTextColor}" font-size="8.5" font-weight="600">Membrane Vm</text>\n`;
  }

  svg += `</svg>\n`;
  return svg;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2D Action Potential Limit Cycle Phase-Plane Visualizer
// ─────────────────────────────────────────────────────────────────────────────

export interface PhasePlaneOptions {
  theme?: "light" | "dark" | undefined;
  width?: number | undefined;
  height?: number | undefined;
  mode?: "vm_vs_m" | "vm_vs_dvdt" | undefined;
  title?: string | undefined;
  vThreshMv?: number | undefined;
  vRestMv?: number | undefined;
}

/**
 * Renders a publication-grade 2D phase-plane plot for action potentials:
 * - Mode "vm_vs_m": Vm (mV) on X-axis vs m gating variable on Y-axis.
 * - Mode "vm_vs_dvdt": Vm (mV) on X-axis vs dVm/dt (mV/ms) on Y-axis.
 * Visualizes limit cycle orbit, resting fixed point, threshold line, and peak depolarization.
 */
export function renderPhasePlaneSvg(
  trajectory: {
    times: number[];
    vm: number[];
    m?: number[] | undefined;
    dvdt?: number[] | undefined;
  },
  options?: PhasePlaneOptions,
): string {
  const theme = options?.theme ?? "dark";
  const isDark = theme === "dark";
  const bg = isDark ? "#090d16" : "#ffffff";
  const textColor = isDark ? "#f8fafc" : "#0f172a";
  const subTextColor = isDark ? "#94a3b8" : "#475569";
  const gridColor = isDark ? "#1e293b" : "#e2e8f0";
  const width = options?.width ?? 480;
  const height = options?.height ?? 360;
  const mode = options?.mode ?? (trajectory.m && trajectory.m.length > 0 ? "vm_vs_m" : "vm_vs_dvdt");
  const vThresh = options?.vThreshMv ?? -55.0;
  const vRest = options?.vRestMv ?? -65.0;

  const defaultTitle = mode === "vm_vs_m" ? "Phase Plane: Vm vs m (Activation)" : "Phase Portrait: Vm vs dVm/dt";
  const title = options?.title ?? defaultTitle;

  // Compute dVm/dt if mode is vm_vs_dvdt and not provided
  let yValues: number[] = [];
  let yAxisLabel = "";
  if (mode === "vm_vs_m" && trajectory.m && trajectory.m.length === trajectory.vm.length) {
    yValues = trajectory.m;
    yAxisLabel = "Activation Gating Variable m";
  } else {
    yAxisLabel = "dVm/dt (mV / ms)";
    if (trajectory.dvdt && trajectory.dvdt.length === trajectory.vm.length) {
      yValues = trajectory.dvdt;
    } else {
      yValues = new Array(trajectory.vm.length).fill(0);
      for (let i = 0; i < trajectory.vm.length; i++) {
        if (i === 0 && trajectory.vm.length > 1) {
          const dt = (trajectory.times[1] ?? 1) - (trajectory.times[0] ?? 0) || 0.05;
          yValues[i] = ((trajectory.vm[1] ?? 0) - (trajectory.vm[0] ?? 0)) / dt;
        } else if (i === trajectory.vm.length - 1) {
          const dt = (trajectory.times[i] ?? 1) - (trajectory.times[i - 1] ?? 0) || 0.05;
          yValues[i] = ((trajectory.vm[i] ?? 0) - (trajectory.vm[i - 1] ?? 0)) / dt;
        } else {
          const dt = (trajectory.times[i + 1] ?? 1) - (trajectory.times[i - 1] ?? 0) || 0.1;
          yValues[i] = ((trajectory.vm[i + 1] ?? 0) - (trajectory.vm[i - 1] ?? 0)) / dt;
        }
      }
    }
  }

  // Plot Margins
  const mTop = 45;
  const mBottom = 45;
  const mLeft = 55;
  const mRight = 30;
  const plotW = width - mLeft - mRight;
  const plotH = height - mTop - mBottom;

  const minV = Math.min(-85, ...trajectory.vm);
  const maxV = Math.max(45, ...trajectory.vm);
  const rangeV = maxV > minV ? maxV - minV : 1;

  let minY = Math.min(...yValues);
  let maxY = Math.max(...yValues);
  if (mode === "vm_vs_m") {
    minY = 0.0;
    maxY = 1.0;
  } else {
    // Add 10% padding
    const pad = (maxY - minY) * 0.1 || 10;
    minY -= pad;
    maxY += pad;
  }
  const rangeY = maxY > minY ? maxY - minY : 1;

  const toX = (v: number) => mLeft + ((v - minV) / rangeV) * plotW;
  const toY = (y: number) => mTop + plotH - ((y - minY) / rangeY) * plotH;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="background-color: ${bg}; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;">\n`;

  // Gradients & Defs
  svg += `  <defs>\n`;
  svg += `    <linearGradient id="orbit-grad" x1="0%" y1="100%" x2="100%" y2="0%">\n`;
  svg += `      <stop offset="0%" stop-color="#06b6d4" />\n`;
  svg += `      <stop offset="40%" stop-color="#10b981" />\n`;
  svg += `      <stop offset="75%" stop-color="#f59e0b" />\n`;
  svg += `      <stop offset="100%" stop-color="#f43f5e" />\n`;
  svg += `    </linearGradient>\n`;
  svg += `    <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">\n`;
  svg += `      <path d="M 0 1 L 8 5 L 0 9 z" fill="#f43f5e" />\n`;
  svg += `    </marker>\n`;
  svg += `  </defs>\n`;

  // Title
  svg += `  <text x="${mLeft}" y="26" fill="${textColor}" font-size="13" font-weight="700">${title}</text>\n`;

  // Grid Lines & Axis Ticks
  svg += `  <!-- Grid & Ticks -->\n`;
  const vStep = 20;
  for (let v = Math.ceil(minV / vStep) * vStep; v <= maxV; v += vStep) {
    const x = toX(v);
    svg += `  <line x1="${x.toFixed(1)}" y1="${mTop}" x2="${x.toFixed(1)}" y2="${mTop + plotH}" stroke="${gridColor}" stroke-width="1" stroke-dasharray="2,2" />\n`;
    svg += `  <text x="${x.toFixed(1)}" y="${mTop + plotH + 16}" fill="${subTextColor}" font-size="9" text-anchor="middle">${v}</text>\n`;
  }

  const yTicks = mode === "vm_vs_m" ? [0.0, 0.25, 0.5, 0.75, 1.0] : 4;
  if (Array.isArray(yTicks)) {
    for (const val of yTicks) {
      const y = toY(val);
      svg += `  <line x1="${mLeft}" y1="${y.toFixed(1)}" x2="${mLeft + plotW}" y2="${y.toFixed(1)}" stroke="${gridColor}" stroke-width="1" stroke-dasharray="2,2" />\n`;
      svg += `  <text x="${mLeft - 8}" y="${(y + 3).toFixed(1)}" fill="${subTextColor}" font-size="9" text-anchor="end">${val.toFixed(2)}</text>\n`;
    }
  } else {
    const step = rangeY / yTicks;
    for (let i = 0; i <= yTicks; i++) {
      const val = minY + i * step;
      const y = toY(val);
      svg += `  <line x1="${mLeft}" y1="${y.toFixed(1)}" x2="${mLeft + plotW}" y2="${y.toFixed(1)}" stroke="${gridColor}" stroke-width="1" stroke-dasharray="2,2" />\n`;
      svg += `  <text x="${mLeft - 8}" y="${(y + 3).toFixed(1)}" fill="${subTextColor}" font-size="9" text-anchor="end">${val.toFixed(0)}</text>\n`;
    }
  }

  // Axes Outer Rect
  svg += `  <rect x="${mLeft}" y="${mTop}" width="${plotW}" height="${plotH}" fill="none" stroke="${gridColor}" stroke-width="1.5" />\n`;

  // Action Potential Threshold Line (dashed amber)
  if (vThresh >= minV && vThresh <= maxV) {
    const xThresh = toX(vThresh);
    svg += `  <!-- V_threshold -->\n`;
    svg += `  <line x1="${xThresh.toFixed(1)}" y1="${mTop}" x2="${xThresh.toFixed(1)}" y2="${mTop + plotH}" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="4,3" />\n`;
    svg += `  <text x="${xThresh.toFixed(1)}" y="${mTop - 6}" fill="#f59e0b" font-size="8.5" font-weight="700" text-anchor="middle">V_th (${vThresh} mV)</text>\n`;
  }

  // Trajectory Orbit Points
  const pts: string[] = [];
  for (let i = 0; i < trajectory.vm.length; i++) {
    const x = toX(trajectory.vm[i] ?? 0);
    const y = toY(yValues[i] ?? 0);
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }

  svg += `  <!-- Limit Cycle Trajectory Orbit -->\n`;
  svg += `  <polyline points="${pts.join(" ")}" fill="none" stroke="url(#orbit-grad)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />\n`;

  // Directional Flow Indicator on mid-trajectory
  if (pts.length > 10) {
    const midIdx = Math.floor(pts.length * 0.35);
    const p1 = pts[midIdx - 1]?.split(",") ?? [];
    const p2 = pts[midIdx]?.split(",") ?? [];
    if (p1.length === 2 && p2.length === 2) {
      svg += `  <line x1="${p1[0]}" y1="${p1[1]}" x2="${p2[0]}" y2="${p2[1]}" stroke="#f43f5e" stroke-width="2" marker-end="url(#arrow)" />\n`;
    }
  }

  // Resting Fixed Point Marker (green)
  const restX = toX(vRest);
  const restY = toY(yValues[0] ?? 0);
  svg += `  <!-- Resting Fixed Point -->\n`;
  svg += `  <circle cx="${restX.toFixed(1)}" cy="${restY.toFixed(1)}" r="4.5" fill="#10b981" stroke="#ffffff" stroke-width="1.5" />\n`;
  svg += `  <text x="${(restX - 8).toFixed(1)}" y="${(restY - 8).toFixed(1)}" fill="#10b981" font-size="8.5" font-weight="700" text-anchor="end">Resting Point</text>\n`;

  // Peak Depolarization Marker (crimson)
  const maxIdx = trajectory.vm.indexOf(Math.max(...trajectory.vm));
  if (maxIdx >= 0) {
    const peakX = toX(trajectory.vm[maxIdx] ?? 0);
    const peakY = toY(yValues[maxIdx] ?? 0);
    svg += `  <!-- Peak Depolarization -->\n`;
    svg += `  <circle cx="${peakX.toFixed(1)}" cy="${peakY.toFixed(1)}" r="4.5" fill="#f43f5e" stroke="#ffffff" stroke-width="1.5" />\n`;
    svg += `  <text x="${(peakX + 8).toFixed(1)}" y="${(peakY - 6).toFixed(1)}" fill="#f43f5e" font-size="8.5" font-weight="700">Peak Vm</text>\n`;
  }

  // X & Y Axis Labels
  svg += `  <!-- Axis Titles -->\n`;
  svg += `  <text x="${mLeft + plotW / 2}" y="${height - 10}" fill="${textColor}" font-size="10" font-weight="600" text-anchor="middle">Membrane Voltage Vm (mV)</text>\n`;
  svg += `  <text x="14" y="${mTop + plotH / 2}" fill="${textColor}" font-size="10" font-weight="600" transform="rotate(-90 14 ${mTop + plotH / 2})" text-anchor="middle">${yAxisLabel}</text>\n`;

  svg += `</svg>\n`;
  return svg;
}
