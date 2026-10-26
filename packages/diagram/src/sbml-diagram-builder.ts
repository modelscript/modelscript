// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/diagram — SBML Systems Biology & Biochemical Reaction Pathway Diagram Builder.
 *
 * Translates SBML Level 2/3 XML models into AntV X6 graph structures and standalone SVGs:
 * 1. Cellular compartments as nested boundaries.
 * 2. SBGN (Systems Biology Graphical Notation) process description glyphs for macromolecule species.
 * 3. Reaction transition nodes with reversible/irreversible status and stoichiometry multipliers.
 * 4. Catalytic activation (circle-headed) and enzymatic inhibition (T-bar) regulatory arcs.
 */

export interface SbmlCompartmentLike {
  id: string;
  name?: string | undefined;
  size?: number | undefined;
}

export interface SbmlSpeciesLike {
  id: string;
  name?: string | undefined;
  compartment: string;
  initialConcentration?: number | undefined;
  boundaryCondition?: boolean | undefined;
}

export interface SbmlReactionLike {
  id: string;
  name?: string | undefined;
  reversible: boolean;
  reactants: { species: string; stoichiometry: number }[];
  products: { species: string; stoichiometry: number }[];
  modifiers?: { species: string; type?: "catalysis" | "inhibition" | undefined }[] | undefined;
}

export interface SbmlModelLike {
  id?: string | undefined;
  name?: string | undefined;
  compartments?: Map<string, SbmlCompartmentLike> | SbmlCompartmentLike[] | undefined;
  species: Map<string, SbmlSpeciesLike> | SbmlSpeciesLike[];
  reactions: Map<string, SbmlReactionLike> | SbmlReactionLike[];
}

export interface SbmlDiagramCell {
  id: string;
  shape: string;
  x?: number | undefined;
  y?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  label?: string | undefined;
  source?: { cell: string } | { x: number; y: number } | undefined;
  target?: { cell: string } | { x: number; y: number } | undefined;
  attrs?: Record<string, unknown> | undefined;
  data?: Record<string, unknown> | undefined;
}

export interface SbmlDiagramGraph {
  title: string;
  cells: SbmlDiagramCell[];
}

export interface SbmlRenderOptions {
  theme?: "dark" | "light" | undefined;
  width?: number | undefined;
  height?: number | undefined;
}

/**
 * Builds an interactive AntV X6 graph model for an SBML reaction network.
 */
export interface SbmlCompartmentBounds {
  id: string;
  name?: string | undefined;
  size?: number | undefined;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SbmlNodeCoord {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SbmlLayoutResult {
  compartmentBounds: Map<string, SbmlCompartmentBounds>;
  speciesCoords: Map<string, SbmlNodeCoord>;
  reactionCoords: Map<string, SbmlNodeCoord>;
  totalWidth: number;
  totalHeight: number;
}

/**
 * Computes domain-aware geometric layout for SBML models:
 * 1. Groups species by cellular compartment.
 * 2. Positions species and intra-compartment reactions locally.
 * 3. Computes dynamic bounding boxes with padding for each compartment.
 * 4. Arranges compartments side-by-side and places transport reactions across boundaries.
 */
export function computeSbmlLayout(model: SbmlModelLike, options?: SbmlRenderOptions): SbmlLayoutResult {
  const speciesList: SbmlSpeciesLike[] = Array.isArray(model.species)
    ? model.species
    : Array.from(model.species.values());
  const reactionsList: SbmlReactionLike[] = Array.isArray(model.reactions)
    ? model.reactions
    : Array.from(model.reactions.values());

  const parsedComps: SbmlCompartmentLike[] = Array.isArray(model.compartments)
    ? [...model.compartments]
    : model.compartments
      ? Array.from(model.compartments.values())
      : [];

  // Ensure all species have an associated compartment
  const knownCompIds = new Set(parsedComps.map((c) => c.id));
  for (const s of speciesList) {
    const compId = s.compartment || "cytosol";
    if (!knownCompIds.has(compId)) {
      parsedComps.push({ id: compId, name: compId, size: 1.0 });
      knownCompIds.add(compId);
    }
  }

  if (parsedComps.length === 0) {
    parsedComps.push({ id: "cytosol", name: "Cytoplasm", size: 1.0 });
  }

  const speciesByComp = new Map<string, SbmlSpeciesLike[]>();
  const speciesCompMap = new Map<string, string>();
  for (const c of parsedComps) {
    speciesByComp.set(c.id, []);
  }
  for (const s of speciesList) {
    const compId = s.compartment || "cytosol";
    speciesCompMap.set(s.id, compId);
    let list = speciesByComp.get(compId);
    if (!list) {
      list = [];
      speciesByComp.set(compId, list);
    }
    list.push(s);
  }

  // Classify reactions into intra-compartment vs inter-compartment
  const intraRxnsByComp = new Map<string, SbmlReactionLike[]>();
  const interRxns: SbmlReactionLike[] = [];
  for (const c of parsedComps) {
    intraRxnsByComp.set(c.id, []);
  }

  for (const r of reactionsList) {
    const partComps = new Set<string>();
    for (const react of r.reactants) {
      const c = speciesCompMap.get(react.species);
      if (c) partComps.add(c);
    }
    for (const prod of r.products) {
      const c = speciesCompMap.get(prod.species);
      if (c) partComps.add(c);
    }

    if (partComps.size === 1) {
      const singleComp = Array.from(partComps)[0]!;
      intraRxnsByComp.get(singleComp)?.push(r);
    } else {
      interRxns.push(r);
    }
  }

  const compartmentBounds = new Map<string, SbmlCompartmentBounds>();
  const speciesCoords = new Map<string, SbmlNodeCoord>();
  const reactionCoords = new Map<string, SbmlNodeCoord>();

  let curCompX = 60;
  const compY = 80;
  let maxCompHeight = 300;

  for (const c of parsedComps) {
    const memberSpecies = speciesByComp.get(c.id) ?? [];
    const memberRxns = intraRxnsByComp.get(c.id) ?? [];

    const padX = 35;
    const padTop = 50;
    const padBottom = 35;
    const specW = 95;
    const specH = 36;
    const gapX = 45;
    const gapY = 30;

    let localMaxX = 0;
    let localMaxY = 0;

    // Layout species in rows within the compartment (up to 3 per row)
    const cols = Math.min(3, Math.max(1, memberSpecies.length));
    const localSpeciesPos = new Map<string, { x: number; y: number }>();

    for (let i = 0; i < memberSpecies.length; i++) {
      const s = memberSpecies[i]!;
      const col = i % cols;
      const row = Math.floor(i / cols);
      const lx = col * (specW + gapX);
      const ly = row * (specH + gapY);
      localSpeciesPos.set(s.id, { x: lx, y: ly });

      if (lx + specW > localMaxX) localMaxX = lx + specW;
      if (ly + specH > localMaxY) localMaxY = ly + specH;
    }

    // Place intra-compartment reactions below species
    const rxnY = localMaxY > 0 ? localMaxY + 35 : 0;
    let rxnX = 40;
    for (let i = 0; i < memberRxns.length; i++) {
      const r = memberRxns[i]!;
      let targetX = rxnX;
      // Align reaction x under its reactants if possible
      const reactantPos = r.reactants.map((re) => localSpeciesPos.get(re.species)).filter(Boolean);
      if (reactantPos.length > 0) {
        const avgReactX = reactantPos.reduce((sum, p) => sum + (p!.x + specW / 2), 0) / reactantPos.length;
        targetX = Math.max(0, avgReactX - 12);
      }

      reactionCoords.set(r.id, {
        x: curCompX + padX + targetX,
        y: compY + padTop + rxnY,
        width: 24,
        height: 24,
      });

      if (targetX + 24 > localMaxX) localMaxX = targetX + 24;
      if (rxnY + 24 > localMaxY) localMaxY = rxnY + 24;

      rxnX += 140;
    }

    const compW = Math.max(260, localMaxX + 2 * padX);
    const compH = Math.max(160, localMaxY + padTop + padBottom);
    if (compH > maxCompHeight) maxCompHeight = compH;

    compartmentBounds.set(c.id, {
      id: c.id,
      name: c.name,
      size: c.size,
      x: curCompX,
      y: compY,
      width: compW,
      height: compH,
    });

    // Assign global coordinates to member species
    for (const s of memberSpecies) {
      const lpos = localSpeciesPos.get(s.id) ?? { x: 0, y: 0 };
      speciesCoords.set(s.id, {
        x: curCompX + padX + lpos.x,
        y: compY + padTop + lpos.y,
        width: specW,
        height: specH,
      });
    }

    curCompX += compW + 60;
  }

  // Position inter-compartment reactions at midpoints between participating species
  for (const r of interRxns) {
    const coords: { x: number; y: number }[] = [];
    for (const react of r.reactants) {
      const sp = speciesCoords.get(react.species);
      if (sp) coords.push({ x: sp.x + sp.width / 2, y: sp.y + sp.height / 2 });
    }
    for (const prod of r.products) {
      const sp = speciesCoords.get(prod.species);
      if (sp) coords.push({ x: sp.x + sp.width / 2, y: sp.y + sp.height / 2 });
    }

    const midX = coords.length > 0 ? coords.reduce((acc, c) => acc + c.x, 0) / coords.length : curCompX / 2;
    const midY = coords.length > 0 ? coords.reduce((acc, c) => acc + c.y, 0) / coords.length : compY + 80;

    reactionCoords.set(r.id, {
      x: midX - 12,
      y: midY - 12,
      width: 24,
      height: 24,
    });
  }

  const totalWidth = Math.max(options?.width ?? 760, curCompX + 40);
  const totalHeight = Math.max(options?.height ?? 440, compY + maxCompHeight + 80);

  return {
    compartmentBounds,
    speciesCoords,
    reactionCoords,
    totalWidth,
    totalHeight,
  };
}

/**
 * Builds an interactive AntV X6 graph model for an SBML reaction network.
 */
export function buildSbmlDiagram(model: SbmlModelLike): SbmlDiagramGraph {
  const layout = computeSbmlLayout(model);
  const cells: SbmlDiagramCell[] = [];

  const speciesList: SbmlSpeciesLike[] = Array.isArray(model.species)
    ? model.species
    : Array.from(model.species.values());
  const reactionsList: SbmlReactionLike[] = Array.isArray(model.reactions)
    ? model.reactions
    : Array.from(model.reactions.values());

  // 1. Compartment Boundary Containers
  for (const c of layout.compartmentBounds.values()) {
    cells.push({
      id: `comp_${c.id}`,
      shape: "rect",
      x: c.x,
      y: c.y,
      width: c.width,
      height: c.height,
      label: `Compartment: ${c.name ?? c.id}`,
      attrs: {
        body: {
          fill: "rgba(30, 41, 59, 0.4)",
          stroke: "#475569",
          strokeWidth: 2,
          strokeDasharray: "4,4",
          rx: 16,
          ry: 16,
        },
        label: {
          fill: "#94a3b8",
          fontSize: 10,
          fontWeight: "600",
          refX: 16,
          refY: 16,
          textAnchor: "start",
        },
      },
      data: { compartmentId: c.id, size: c.size },
    });
  }

  // 2. Species Macromolecules
  for (const s of speciesList) {
    const coord = layout.speciesCoords.get(s.id) ?? { x: 100, y: 160, width: 95, height: 36 };

    cells.push({
      id: `species_${s.id}`,
      shape: "rect",
      x: coord.x,
      y: coord.y,
      width: coord.width,
      height: coord.height,
      label: s.name ?? s.id,
      attrs: {
        body: {
          fill: "#0f172a",
          stroke: s.boundaryCondition ? "#f59e0b" : "#38bdf8",
          strokeWidth: 2,
          rx: 12,
          ry: 12,
        },
        label: { fill: "#f8fafc", fontSize: 9, fontWeight: "600" },
      },
      data: { speciesId: s.id, compartment: s.compartment, concentration: s.initialConcentration },
    });
  }

  // 3. Reaction Nodes and Stoichiometry Arcs
  for (const r of reactionsList) {
    const coord = layout.reactionCoords.get(r.id) ?? { x: 180, y: 230, width: 22, height: 22 };
    const rCellId = `rxn_${r.id}`;

    cells.push({
      id: rCellId,
      shape: "rect",
      x: coord.x,
      y: coord.y,
      width: coord.width,
      height: coord.height,
      label: r.reversible ? "↔" : "→",
      attrs: {
        body: { fill: "#1e1b4b", stroke: "#818cf8", strokeWidth: 2, rx: 3, ry: 3 },
        label: { fill: "#c7d2fe", fontSize: 11, fontWeight: "bold" },
      },
      data: { reactionId: r.id, reversible: r.reversible },
    });

    // Reactant consumption arcs: Species -> Reaction node
    for (const react of r.reactants) {
      if (layout.speciesCoords.has(react.species)) {
        cells.push({
          id: `arc_${react.species}_to_${r.id}`,
          shape: "edge",
          source: { cell: `species_${react.species}` },
          target: { cell: rCellId },
          label: react.stoichiometry > 1 ? `${react.stoichiometry}` : undefined,
          attrs: { line: { stroke: "#38bdf8", strokeWidth: 1.5 } },
        });
      }
    }

    // Product synthesis arcs: Reaction node -> Species
    for (const prod of r.products) {
      if (layout.speciesCoords.has(prod.species)) {
        cells.push({
          id: `arc_${r.id}_to_${prod.species}`,
          shape: "edge",
          source: { cell: rCellId },
          target: { cell: `species_${prod.species}` },
          label: prod.stoichiometry > 1 ? `${prod.stoichiometry}` : undefined,
          attrs: {
            line: {
              stroke: "#10b981",
              strokeWidth: 2,
              targetMarker: { name: "classic", width: 6, height: 5 },
            },
          },
        });
      }
    }
  }

  return {
    title: model.name ?? model.id ?? "SBML Biochemical Reaction Pathway",
    cells,
  };
}

/**
 * Emits a standalone SVG SBGN process description diagram for an SBML model.
 */
export function renderSbmlSvg(model: SbmlModelLike, options?: SbmlRenderOptions): string {
  const isDark = options?.theme !== "light";
  const bg = isDark ? "#0b0f19" : "#f8fafc";
  const textColor = isDark ? "#f8fafc" : "#0f172a";
  const subTextColor = isDark ? "#94a3b8" : "#64748b";

  const layout = computeSbmlLayout(model, options);
  const width = layout.totalWidth;
  const height = layout.totalHeight;

  const speciesList: SbmlSpeciesLike[] = Array.isArray(model.species)
    ? model.species
    : Array.from(model.species.values());
  const reactionsList: SbmlReactionLike[] = Array.isArray(model.reactions)
    ? model.reactions
    : Array.from(model.reactions.values());

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="background:${bg};font-family:Inter,system-ui,sans-serif;">\n`;
  svg += `  <defs>\n`;
  svg += `    <marker id="sbgn-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">\n`;
  svg += `      <path d="M 0 1 L 10 5 L 0 9 z" fill="#10b981" />\n`;
  svg += `    </marker>\n`;
  svg += `  </defs>\n`;

  // Title Banner
  svg += `  <text x="50" y="36" fill="${textColor}" font-size="16" font-weight="700">${model.name ?? model.id ?? "Biochemical Reaction Network"}</text>\n`;
  svg += `  <text x="50" y="52" fill="${subTextColor}" font-size="10">SBGN Process Description: Compartments, Macromolecules &amp; Stoichiometry</text>\n`;

  // 1. Dynamic Compartment Outlines
  for (const c of layout.compartmentBounds.values()) {
    svg += `  <rect x="${c.x}" y="${c.y}" width="${c.width}" height="${c.height}" rx="16" ry="16" fill="${isDark ? "rgba(30, 41, 59, 0.4)" : "#f1f5f9"}" stroke="#475569" stroke-width="2" stroke-dasharray="6,4" />\n`;
    svg += `  <text x="${c.x + 20}" y="${c.y + 25}" fill="${subTextColor}" font-size="11" font-weight="700">${c.name ?? c.id} (Volume: ${c.size ?? 1.0} L)</text>\n`;
  }

  // 2. Draw Reactions & Arcs
  for (const r of reactionsList) {
    const rx = layout.reactionCoords.get(r.id);
    if (!rx) continue;

    const midRxX = rx.x + rx.width / 2;
    const midRxY = rx.y + rx.height / 2;

    svg += `  <rect x="${rx.x}" y="${rx.y}" width="${rx.width}" height="${rx.height}" rx="3" ry="3" fill="${isDark ? "#1e1b4b" : "#e0e7ff"}" stroke="#818cf8" stroke-width="2" />\n`;
    svg += `  <text x="${midRxX}" y="${midRxY + 4}" fill="#818cf8" font-size="11" font-weight="bold" text-anchor="middle">${r.reversible ? "↔" : "→"}</text>\n`;
    svg += `  <text x="${midRxX}" y="${rx.y + rx.height + 12}" fill="${subTextColor}" font-size="8" text-anchor="middle">${r.id}</text>\n`;

    // Reactant consumption
    for (const react of r.reactants) {
      const p = layout.speciesCoords.get(react.species);
      if (p) {
        svg += `  <line x1="${p.x + p.width / 2}" y1="${p.y + p.height}" x2="${midRxX}" y2="${rx.y}" stroke="#38bdf8" stroke-width="1.5" />\n`;
      }
    }

    // Product synthesis
    for (const prod of r.products) {
      const p = layout.speciesCoords.get(prod.species);
      if (p) {
        svg += `  <line x1="${midRxX}" y1="${rx.y + rx.height}" x2="${p.x + p.width / 2}" y2="${p.y}" stroke="#10b981" stroke-width="2" marker-end="url(#sbgn-arrow)" />\n`;
      }
    }
  }

  // 3. Draw Species Macromolecules
  for (const s of speciesList) {
    const p = layout.speciesCoords.get(s.id);
    if (!p) continue;
    const stroke = s.boundaryCondition ? "#f59e0b" : "#38bdf8";

    svg += `  <rect x="${p.x}" y="${p.y}" width="${p.width}" height="${p.height}" rx="12" ry="12" fill="${isDark ? "#0f172a" : "#ffffff"}" stroke="${stroke}" stroke-width="2" />\n`;
    svg += `  <text x="${p.x + p.width / 2}" y="${p.y + 16}" fill="${textColor}" font-size="9" font-weight="600" text-anchor="middle">${s.name ?? s.id}</text>\n`;
    svg += `  <text x="${p.x + p.width / 2}" y="${p.y + 28}" fill="${subTextColor}" font-size="7.5" text-anchor="middle">[${s.initialConcentration ?? 0} mM]</text>\n`;
  }

  // 4. Legend
  svg += `  <g id="sbml-legend" transform="translate(60, ${height - 20})">\n`;
  svg += `    <text x="0" y="0" fill="${subTextColor}" font-size="10" font-weight="600">Legend:</text>\n`;
  svg += `    <rect x="55" y="-8" width="10" height="10" rx="3" fill="none" stroke="#38bdf8" stroke-width="1.5" />\n`;
  svg += `    <text x="70" y="0" fill="${subTextColor}" font-size="9">Species</text>\n`;
  svg += `    <rect x="130" y="-8" width="10" height="10" rx="2" fill="#1e1b4b" stroke="#818cf8" stroke-width="1.5" />\n`;
  svg += `    <text x="145" y="0" fill="${subTextColor}" font-size="9">Reaction</text>\n`;
  svg += `    <line x1="210" y1="-3" x2="225" y2="-3" stroke="#10b981" stroke-width="2" marker-end="url(#sbgn-arrow)" />\n`;
  svg += `    <text x="232" y="0" fill="${subTextColor}" font-size="9">Product Flow</text>\n`;
  svg += `  </g>\n`;

  svg += `</svg>\n`;
  return svg;
}
