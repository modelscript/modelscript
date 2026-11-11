// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/diagram — Chemical Reaction Coordinate & Potential Free Energy Diagram Builder.
 *
 * Generates interactive Free Energy / Enthalpy reaction coordinate diagrams (ΔG‡, Ea, ΔrG°)
 * for elementary and multi-step chemical reaction pathways (Cantera, Chemkin, SBML):
 * 1. Reaction states (Reactants, Transition States TS‡, Intermediates, Products) as energy plateaus.
 * 2. Smooth cubic Bézier potential energy surface (PES) trajectories.
 * 3. Activation barrier (ΔG‡ / Ea) and reaction free energy (ΔrG°) annotations.
 * 4. Bi-directional modification reconciling barrier adjustments back into Cantera YAML/CTI models.
 */

export interface ReactionSpeciesReference {
  name: string;
  stoichiometry: number;
}

export interface ReactionStateNode {
  id: string;
  name: string;
  energy: number; // in energyUnit (e.g. kJ/mol or kcal/mol)
  coordinate: number; // Reaction progress coordinate ξ ∈ [0, 1]
  isTransitionState?: boolean | undefined;
  species?: ReactionSpeciesReference[] | undefined;
  x?: number | undefined;
  y?: number | undefined;
}

export interface ReactionPathwayStep {
  id: string;
  name: string;
  reactantStateId: string;
  transitionStateId?: string | undefined;
  productStateId: string;
  activationEnergy?: number | undefined; // Ea or ΔG‡ in energyUnit
  reactionEnergy?: number | undefined; // ΔrG° or ΔrH° in energyUnit
  isReversible?: boolean | undefined;
  rateConstant?: { A: number; b?: number | undefined; Ea: number } | undefined;
}

export interface ReactionCoordinateDiagram {
  title: string;
  energyUnit: "kJ/mol" | "kcal/mol" | "eV";
  states: ReactionStateNode[];
  steps: ReactionPathwayStep[];
  width: number;
  height: number;
  minEnergy: number;
  maxEnergy: number;
}

/**
 * Builds a ReactionCoordinateDiagram from a single or multi-step reaction profile.
 */
export function buildReactionCoordinateFromSteps(options: {
  title?: string | undefined;
  energyUnit?: "kJ/mol" | "kcal/mol" | "eV" | undefined;
  steps: {
    id: string;
    equation: string;
    reactantEnergy: number;
    barrierEnergy?: number | undefined; // Transition state peak
    productEnergy: number;
    reactants?: string[] | undefined;
    products?: string[] | undefined;
    isReversible?: boolean | undefined;
  }[];
}): ReactionCoordinateDiagram {
  const title = options.title ?? "Reaction Coordinate Potential Energy Profile";
  const energyUnit = options.energyUnit ?? "kJ/mol";
  const rawSteps = options.steps;

  const states: ReactionStateNode[] = [];
  const steps: ReactionPathwayStep[] = [];

  const totalPoints = rawSteps.length * 2 + 1;
  let currentCoordinate = 0.05;
  const deltaCoord = 0.9 / Math.max(1, totalPoints - 1);

  let allEnergies: number[] = [];

  for (let i = 0; i < rawSteps.length; i++) {
    const s = rawSteps[i]!;
    const rId = `state_r_${i}`;
    const pId = `state_p_${i}`;
    const tsId = s.barrierEnergy !== undefined ? `state_ts_${i}` : undefined;

    // Reactant state
    if (i === 0 || states.length === 0) {
      states.push({
        id: rId,
        name: s.reactants?.join(" + ") || `Reactants ${i + 1}`,
        energy: s.reactantEnergy,
        coordinate: currentCoordinate,
        isTransitionState: false,
      });
      allEnergies.push(s.reactantEnergy);
      currentCoordinate += deltaCoord;
    }

    // Transition state
    if (tsId && s.barrierEnergy !== undefined) {
      states.push({
        id: tsId,
        name: `TS‡ (${s.id})`,
        energy: s.barrierEnergy,
        coordinate: currentCoordinate,
        isTransitionState: true,
      });
      allEnergies.push(s.barrierEnergy);
      currentCoordinate += deltaCoord;
    }

    // Product state
    states.push({
      id: pId,
      name: s.products?.join(" + ") || `Products ${i + 1}`,
      energy: s.productEnergy,
      coordinate: currentCoordinate,
      isTransitionState: false,
    });
    allEnergies.push(s.productEnergy);
    currentCoordinate += deltaCoord;

    const actualRId = i === 0 ? rId : states[states.length - (tsId ? 3 : 2)]!.id;
    const actualREnergy = states.find((st) => st.id === actualRId)?.energy ?? s.reactantEnergy;

    steps.push({
      id: s.id,
      name: s.equation,
      reactantStateId: actualRId,
      transitionStateId: tsId,
      productStateId: pId,
      activationEnergy: s.barrierEnergy !== undefined ? Math.max(0, s.barrierEnergy - actualREnergy) : undefined,
      reactionEnergy: s.productEnergy - actualREnergy,
      isReversible: s.isReversible ?? true,
    });
  }

  const minEnergy = Math.min(...allEnergies, 0);
  const maxEnergy = Math.max(...allEnergies, 100);

  return {
    title,
    energyUnit,
    states,
    steps,
    width: 800,
    height: 480,
    minEnergy,
    maxEnergy,
  };
}

/**
 * Builds a ReactionCoordinateDiagram from a Cantera reaction mechanism.
 */
export function buildReactionCoordinateFromCantera(
  reaction: {
    id: string;
    equation: string;
    rateConstant: { A: number; b?: number | undefined; Ea: number };
    reversible?: boolean | undefined;
    reactants: { species: string; stoichiometry: number }[];
    products: { species: string; stoichiometry: number }[];
  },
  options?: {
    reactantEnergy?: number | undefined;
    reactionDeltaH?: number | undefined;
    energyUnit?: "kJ/mol" | "kcal/mol" | "eV" | undefined;
  },
): ReactionCoordinateDiagram {
  const energyUnit = options?.energyUnit ?? "kJ/mol";
  // Cantera Ea is in J/mol or J/kmol; convert to kJ/mol if in J/mol
  const eaKj = reaction.rateConstant.Ea > 1000 ? reaction.rateConstant.Ea / 1000 : reaction.rateConstant.Ea;

  const rEnergy = options?.reactantEnergy ?? 0.0;
  const deltaH = options?.reactionDeltaH ?? -45.0; // default exothermic step if thermo not provided
  const barrierEnergy = rEnergy + Math.max(5.0, eaKj);
  const pEnergy = rEnergy + deltaH;

  const rNames = reaction.reactants.map((r) => (r.stoichiometry > 1 ? `${r.stoichiometry} ${r.species}` : r.species));
  const pNames = reaction.products.map((p) => (p.stoichiometry > 1 ? `${p.stoichiometry} ${p.species}` : p.species));

  return buildReactionCoordinateFromSteps({
    title: `Reaction Coordinate: ${reaction.equation}`,
    energyUnit,
    steps: [
      {
        id: reaction.id,
        equation: reaction.equation,
        reactantEnergy: rEnergy,
        barrierEnergy,
        productEnergy: pEnergy,
        reactants: rNames,
        products: pNames,
        isReversible: reaction.reversible ?? true,
      },
    ],
  });
}

/**
 * Renders a publication-grade SVG potential energy surface (PES) profile with Bézier transitions.
 */
export function renderReactionCoordinateSvg(
  diagram: ReactionCoordinateDiagram,
  options?: { theme?: "dark" | "light" | undefined },
): string {
  const theme = options?.theme ?? "dark";
  const isDark = theme === "dark";

  const bg = isDark ? "#0f172a" : "#ffffff";
  const axisColor = isDark ? "#475569" : "#cbd5e1";
  const gridColor = isDark ? "#1e293b" : "#f1f5f9";
  const textColor = isDark ? "#f8fafc" : "#0f172a";
  const subtextColor = isDark ? "#94a3b8" : "#64748b";
  const curveColor = isDark ? "#38bdf8" : "#0284c7";
  const plateauColor = isDark ? "#38bdf8" : "#0369a1";
  const tsColor = isDark ? "#f43f5e" : "#e11d48";
  const barrierDimColor = isDark ? "#fbbf24" : "#d97706";

  const w = diagram.width;
  const h = diagram.height;

  const padLeft = 80;
  const padRight = 60;
  const padTop = 60;
  const padBottom = 70;

  const plotW = w - padLeft - padRight;
  const plotH = h - padTop - padBottom;

  const eMargin = Math.max(10, (diagram.maxEnergy - diagram.minEnergy) * 0.15);
  const yMin = diagram.minEnergy - eMargin;
  const yMax = diagram.maxEnergy + eMargin;
  const ySpan = Math.max(1e-5, yMax - yMin);

  const toY = (e: number) => padTop + plotH - ((e - yMin) / ySpan) * plotH;
  const toX = (coord: number) => padLeft + coord * plotW;

  // Compute plateau positions
  const plateauHalfW = 28;
  const calculatedStates = diagram.states.map((st) => ({
    ...st,
    cx: toX(st.coordinate),
    cy: toY(st.energy),
    x1: toX(st.coordinate) - plateauHalfW,
    x2: toX(st.coordinate) + plateauHalfW,
  }));

  // Build smooth cubic Bézier pathway through states
  let pathD = "";
  for (let i = 0; i < calculatedStates.length; i++) {
    const cur = calculatedStates[i]!;
    if (i === 0) {
      pathD += `M ${cur.x1.toFixed(1)} ${cur.cy.toFixed(1)} L ${cur.x2.toFixed(1)} ${cur.cy.toFixed(1)}`;
    } else {
      const prev = calculatedStates[i - 1]!;
      const cp1x = prev.x2 + (cur.x1 - prev.x2) * 0.5;
      const cp1y = prev.cy;
      const cp2x = prev.x2 + (cur.x1 - prev.x2) * 0.5;
      const cp2y = cur.cy;
      pathD += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${cur.x1.toFixed(1)} ${cur.cy.toFixed(1)}`;
      pathD += ` L ${cur.x2.toFixed(1)} ${cur.cy.toFixed(1)}`;
    }
  }

  // Energy tick marks
  const tickCount = 5;
  const ticks: { e: number; y: number }[] = [];
  for (let i = 0; i <= tickCount; i++) {
    const val = yMin + (i / tickCount) * ySpan;
    ticks.push({ e: Math.round(val), y: toY(val) });
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <style>
    .title { font: 600 16px/1.2 Inter, -apple-system, system-ui, sans-serif; fill: ${textColor}; }
    .axis-label { font: 500 12px Inter, sans-serif; fill: ${subtextColor}; }
    .tick { font: 400 11px JetBrains Mono, monospace; fill: ${subtextColor}; }
    .state-name { font: 600 12px Inter, sans-serif; fill: ${textColor}; text-anchor: middle; }
    .energy-val { font: 500 11px JetBrains Mono, monospace; fill: ${subtextColor}; text-anchor: middle; }
    .barrier-text { font: 600 11px JetBrains Mono, monospace; fill: ${barrierDimColor}; text-anchor: middle; }
    .rxn-curve { fill: none; stroke: ${curveColor}; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
    .plateau-line { stroke-width: 4; stroke-linecap: round; }
    .ts-plateau { stroke: ${tsColor}; }
    .stable-plateau { stroke: ${plateauColor}; }
    .dimension-line { stroke: ${barrierDimColor}; stroke-width: 1.5; stroke-dasharray: 4,3; }
  </style>

  <rect width="${w}" height="${h}" fill="${bg}" rx="8"/>

  <!-- Grid Lines -->
  ${ticks
    .map(
      (t) =>
        `<line x1="${padLeft}" y1="${t.y.toFixed(1)}" x2="${w - padRight}" y2="${t.y.toFixed(1)}" stroke="${gridColor}" stroke-width="1"/>
         <text x="${padLeft - 10}" y="${(t.y + 4).toFixed(1)}" class="tick" text-anchor="end">${t.e}</text>`,
    )
    .join("\n  ")}

  <!-- Axes -->
  <line x1="${padLeft}" y1="${padTop}" x2="${padLeft}" y2="${h - padBottom}" stroke="${axisColor}" stroke-width="2"/>
  <line x1="${padLeft}" y1="${h - padBottom}" x2="${w - padRight}" y2="${h - padBottom}" stroke="${axisColor}" stroke-width="2"/>

  <!-- Axis Titles -->
  <text x="${padLeft}" y="${padTop - 25}" class="title">${diagram.title}</text>
  <text x="${padLeft - 50}" y="${padTop + plotH / 2}" class="axis-label" transform="rotate(-90, ${padLeft - 50}, ${padTop + plotH / 2})" text-anchor="middle">Energy (${diagram.energyUnit})</text>
  <text x="${padLeft + plotW / 2}" y="${h - padBottom + 40}" class="axis-label" text-anchor="middle">Reaction Coordinate (ξ)</text>

  <!-- PES Potential Energy Curve -->
  <path d="${pathD}" class="rxn-curve"/>

  <!-- Energy Plateaus and Labels -->
  ${calculatedStates
    .map((st) => {
      const isTs = st.isTransitionState;
      const pClass = isTs ? "ts-plateau" : "stable-plateau";
      const labelY = isTs ? st.cy - 14 : st.cy + 22;
      const energyY = isTs ? st.cy - 28 : st.cy + 36;
      return `
    <g class="state-group" id="${st.id}">
      <line x1="${st.x1.toFixed(1)}" y1="${st.cy.toFixed(1)}" x2="${st.x2.toFixed(1)}" y2="${st.cy.toFixed(1)}" class="plateau-line ${pClass}"/>
      <text x="${st.cx.toFixed(1)}" y="${labelY.toFixed(1)}" class="state-name">${st.name}</text>
      <text x="${st.cx.toFixed(1)}" y="${energyY.toFixed(1)}" class="energy-val">${st.energy.toFixed(1)} ${diagram.energyUnit}</text>
    </g>`;
    })
    .join("")}

  <!-- Barrier Annotations -->
  ${diagram.steps
    .filter((s) => s.activationEnergy !== undefined && s.transitionStateId)
    .map((s) => {
      const r = calculatedStates.find((st) => st.id === s.reactantStateId);
      const ts = calculatedStates.find((st) => st.id === s.transitionStateId);
      if (!r || !ts) return "";
      const arrowX = ts.cx;
      return `
    <g class="barrier-annotation">
      <line x1="${r.x2}" y1="${r.cy}" x2="${arrowX + 20}" y2="${r.cy}" class="dimension-line"/>
      <line x1="${arrowX + 16}" y1="${ts.cy}" x2="${arrowX + 16}" y2="${r.cy}" stroke="${barrierDimColor}" stroke-width="1.5" marker-start="url(#arrow)" marker-end="url(#arrow)"/>
      <text x="${arrowX + 24}" y="${((ts.cy + r.cy) / 2 + 4).toFixed(1)}" class="barrier-text" text-anchor="start">Ea = ${s.activationEnergy?.toFixed(1)} ${diagram.energyUnit}</text>
    </g>`;
    })
    .join("")}
</svg>`;
}

/**
 * Reconciles a modified activation energy or reaction barrier back into Cantera YAML source text.
 */
export function reconcileReactionBarrierChange(
  sourceYaml: string,
  reactionEquation: string,
  newEaJoulesPerMol: number,
): string {
  // Normalize equation whitespaces for matching
  const escapedEq = reactionEquation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
  const regex = new RegExp(
    `(equation:\\s*['"]?${escapedEq}['"]?[\\s\\S]*?rate-constant:[\\s\\S]*?Ea:\\s*)([0-9.eE+-]+)`,
    "i",
  );

  if (regex.test(sourceYaml)) {
    return sourceYaml.replace(regex, `$1${newEaJoulesPerMol}`);
  }

  // Fallback for inline Ea format: Ea = ...
  const fallbackRegex = new RegExp(`(${escapedEq}[\\s\\S]*?Ea\\s*=\\s*)([0-9.eE+-]+)`, "i");
  if (fallbackRegex.test(sourceYaml)) {
    return sourceYaml.replace(fallbackRegex, `$1${newEaJoulesPerMol}`);
  }

  return sourceYaml;
}
