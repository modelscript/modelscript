// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/diagram — SBML Systems Biology & Biochemical Reaction Pathway Diagram Builder.
 *
 * Translates SBML Level 2/3 XML models into AntV X6 graph structures and standalone SVGs:
 * 1. Cellular compartments as nested boundaries with harmonized sizing.
 * 2. SBGN (Systems Biology Graphical Notation) process description glyphs for macromolecule species with dynamically sized labels.
 * 3. Linear & cascading reaction pathways with alternating species and reaction hub layout.
 * 4. Membrane transport reactions positioned cleanly in inter-compartment channels without node collisions.
 * 5. Clean non-looping orthogonal / direct vector arcs with stoichiometry multipliers and regulatory modifiers.
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
  router?: { name: string; args?: Record<string, unknown> | undefined } | string | undefined;
  connector?: { name: string; args?: Record<string, unknown> | undefined } | string | undefined;
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

function estimateSpeciesWidth(nameOrId: string): number {
  const charCount = nameOrId.length;
  return Math.max(160, Math.min(260, Math.round(charCount * 7.0 + 32)));
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getRectConnection(from: SbmlNodeCoord, to: SbmlNodeCoord): { x1: number; y1: number; x2: number; y2: number } {
  const c1x = from.x + from.width / 2;
  const c1y = from.y + from.height / 2;
  const c2x = to.x + to.width / 2;
  const c2y = to.y + to.height / 2;
  const dx = c2x - c1x;
  const dy = c2y - c1y;

  let x1 = c1x;
  let y1 = c1y;
  let x2 = c2x;
  let y2 = c2y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    if (dx > 0) {
      x1 = from.x + from.width;
      x2 = to.x;
    } else {
      x1 = from.x;
      x2 = to.x + to.width;
    }
  } else {
    if (dy > 0) {
      y1 = from.y + from.height;
      y2 = to.y;
    } else {
      y1 = from.y;
      y2 = to.y + to.height;
    }
  }
  return { x1, y1, x2, y2 };
}

/**
 * Computes domain-aware geometric layout for SBML models:
 * 1. Groups species by cellular compartment.
 * 2. Structures reaction cascades horizontally within compartments: Reactant -> Reaction Hub -> Product.
 * 3. Places shared co-substrates / donors (e.g. UDP-Galactose, ATP) in a dedicated top tier.
 * 4. Stacks non-reacting pool species neatly in non-overlapping columns.
 * 5. Positions inter-compartment membrane transport reactions cleanly in inter-compartmental channels.
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
  let maxCompHeight = 220;

  const specH = 40;
  const rxnDim = 24;
  const padX = 40;
  const padTop = 50;
  const padBottom = 40;
  const gapX = 40;
  const gapY = 30;

  for (const c of parsedComps) {
    const memberSpecies = speciesByComp.get(c.id) ?? [];
    const memberRxns = intraRxnsByComp.get(c.id) ?? [];

    let localMaxX = 0;
    let localMaxY = 0;

    if (memberRxns.length > 0) {
      // Compartment contains an internal reaction cascade (e.g. Golgi galactosylation or cytosolic glycolysis)
      const consumptionCount = new Map<string, number>();
      const productionCount = new Map<string, number>();
      for (const r of memberRxns) {
        for (const re of r.reactants) {
          consumptionCount.set(re.species, (consumptionCount.get(re.species) ?? 0) + 1);
        }
        for (const pr of r.products) {
          productionCount.set(pr.species, (productionCount.get(pr.species) ?? 0) + 1);
        }
      }

      // Shared cofactors / donors: consumed multiple times without being produced
      const cofactors = new Set<string>();
      for (const s of memberSpecies) {
        const consumed = consumptionCount.get(s.id) ?? 0;
        const produced = productionCount.get(s.id) ?? 0;
        if (consumed > 1 && produced === 0) {
          cofactors.add(s.id);
        }
      }

      // Place cofactors in top row (row 0)
      const cofactorList = memberSpecies.filter((s) => cofactors.has(s.id));
      const nonCofactorSpecies = memberSpecies.filter((s) => !cofactors.has(s.id));

      const cofactorRowY = 0;
      let curCofactorX = 0;
      for (const s of cofactorList) {
        const w = estimateSpeciesWidth(s.name ?? s.id);
        speciesCoords.set(s.id, {
          x: curCompX + padX + curCofactorX,
          y: compY + padTop + cofactorRowY,
          width: w,
          height: specH,
        });
        if (curCofactorX + w > localMaxX) localMaxX = curCofactorX + w;
        curCofactorX += w + gapX;
      }
      if (cofactorList.length > 0) {
        localMaxY = Math.max(localMaxY, specH + gapY);
      }

      // Layout reaction cascade: order reactions and alternating species horizontally
      const pathwayY = cofactorList.length > 0 ? specH + 45 : 0;
      let curPathX = 0;

      const placedSpecies = new Set<string>(cofactors);
      const placedRxns = new Set<string>();

      // Find root species (no intra-reaction produces them)
      const rootSpecies = nonCofactorSpecies.filter((s) => (productionCount.get(s.id) ?? 0) === 0);
      const queueSpecies = rootSpecies.length > 0 ? [...rootSpecies] : [nonCofactorSpecies[0]!].filter(Boolean);

      while (queueSpecies.length > 0 || placedRxns.size < memberRxns.length) {
        if (queueSpecies.length > 0) {
          const s = queueSpecies.shift()!;
          if (placedSpecies.has(s.id)) continue;
          placedSpecies.add(s.id);

          const w = estimateSpeciesWidth(s.name ?? s.id);
          speciesCoords.set(s.id, {
            x: curCompX + padX + curPathX,
            y: compY + padTop + pathwayY,
            width: w,
            height: specH,
          });
          curPathX += w + gapX;
          if (curPathX > localMaxX) localMaxX = curPathX;
          if (pathwayY + specH > localMaxY) localMaxY = pathwayY + specH;

          // Find reactions that consume this species
          for (const r of memberRxns) {
            if (!placedRxns.has(r.id) && r.reactants.some((re) => re.species === s.id)) {
              placedRxns.add(r.id);
              reactionCoords.set(r.id, {
                x: curCompX + padX + curPathX,
                y: compY + padTop + pathwayY + (specH - rxnDim) / 2,
                width: rxnDim,
                height: rxnDim,
              });
              curPathX += rxnDim + gapX;
              if (curPathX > localMaxX) localMaxX = curPathX;

              // Enqueue products
              for (const prod of r.products) {
                const prodSpec = nonCofactorSpecies.find((sp) => sp.id === prod.species);
                if (prodSpec && !placedSpecies.has(prodSpec.id)) {
                  queueSpecies.push(prodSpec);
                }
              }
            }
          }
        } else {
          // Any remaining unplaced reactions
          const nextRxn = memberRxns.find((r) => !placedRxns.has(r.id));
          if (!nextRxn) break;
          placedRxns.add(nextRxn.id);
          reactionCoords.set(nextRxn.id, {
            x: curCompX + padX + curPathX,
            y: compY + padTop + pathwayY + (specH - rxnDim) / 2,
            width: rxnDim,
            height: rxnDim,
          });
          curPathX += rxnDim + gapX;
          for (const prod of nextRxn.products) {
            const prodSpec = nonCofactorSpecies.find((sp) => sp.id === prod.species);
            if (prodSpec && !placedSpecies.has(prodSpec.id)) {
              queueSpecies.push(prodSpec);
            }
          }
        }
      }

      // Any remaining species
      for (const s of nonCofactorSpecies) {
        if (!placedSpecies.has(s.id)) {
          placedSpecies.add(s.id);
          const w = estimateSpeciesWidth(s.name ?? s.id);
          speciesCoords.set(s.id, {
            x: curCompX + padX + curPathX,
            y: compY + padTop + pathwayY,
            width: w,
            height: specH,
          });
          curPathX += w + gapX;
          if (curPathX > localMaxX) localMaxX = curPathX;
        }
      }

      // Center cofactor over the pathway line
      if (cofactorList.length === 1 && curPathX > 0) {
        const cof = cofactorList[0]!;
        const cCoord = speciesCoords.get(cof.id);
        if (cCoord) {
          cCoord.x = curCompX + padX + Math.max(0, (curPathX - cCoord.width) / 2);
        }
      }
    } else {
      // Compartment without intra-reactions: arrange species in a neat vertical stack
      // Prioritize species involved in inter-compartment transport
      const interReactingSpecies = new Set<string>();
      for (const r of interRxns) {
        for (const re of r.reactants) interReactingSpecies.add(re.species);
        for (const pr of r.products) interReactingSpecies.add(pr.species);
      }

      const sortedSpecies = [...memberSpecies].sort((a, b) => {
        const aActive = interReactingSpecies.has(a.id) ? 0 : 1;
        const bActive = interReactingSpecies.has(b.id) ? 0 : 1;
        return aActive - bActive;
      });

      let curY = 0;
      for (let i = 0; i < sortedSpecies.length; i++) {
        const s = sortedSpecies[i]!;
        const w = estimateSpeciesWidth(s.name ?? s.id);
        speciesCoords.set(s.id, {
          x: curCompX + padX,
          y: compY + padTop + curY,
          width: w,
          height: specH,
        });
        if (w > localMaxX) localMaxX = w;
        curY += specH + gapY;
      }
      localMaxY = Math.max(localMaxY, curY - gapY);
    }

    const compW = Math.max(260, localMaxX + 2 * padX);
    const compH = Math.max(170, localMaxY + padTop + padBottom);
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

    // Space between compartments (leave 100px for membrane transport reactions)
    curCompX += compW + (interRxns.length > 0 ? 100 : 60);
  }

  // Harmonize compartment heights for visual balance
  const uniformCompHeight = Math.max(180, maxCompHeight);
  for (const c of compartmentBounds.values()) {
    c.height = uniformCompHeight;
  }

  // Position inter-compartment reactions in the membrane channel between participating compartments
  const rxnsByPair = new Map<string, SbmlReactionLike[]>();
  for (const r of interRxns) {
    const partComps = new Set<string>();
    for (const react of r.reactants) {
      const c = speciesCompMap.get(react.species);
      if (c) partComps.add(c);
    }
    for (const prod of r.products) {
      const c = speciesCompMap.get(prod.species);
      if (c) partComps.add(c);
    }
    const pairKey = Array.from(partComps).sort().join("__");
    let list = rxnsByPair.get(pairKey);
    if (!list) {
      list = [];
      rxnsByPair.set(pairKey, list);
    }
    list.push(r);
  }

  for (const [pairKey, rxnList] of rxnsByPair.entries()) {
    const compIds = pairKey.split("__");
    const b1 = compIds[0] ? compartmentBounds.get(compIds[0]) : undefined;
    const b2 = compIds[1] ? compartmentBounds.get(compIds[1]) : undefined;

    let channelX: number;
    if (b1 && b2) {
      const leftB = b1.x < b2.x ? b1 : b2;
      const rightB = b1.x < b2.x ? b2 : b1;
      channelX = (leftB.x + leftB.width + rightB.x) / 2 - rxnDim / 2;
    } else {
      channelX = curCompX / 2 - rxnDim / 2;
    }

    // Stagger inter-compartment reactions vertically, aligning with participating species if possible
    let lastY = compY + padTop + (specH - rxnDim) / 2;
    for (let i = 0; i < rxnList.length; i++) {
      const r = rxnList[i]!;
      const partSpeciesY: number[] = [];
      for (const re of r.reactants) {
        const sc = speciesCoords.get(re.species);
        if (sc) partSpeciesY.push(sc.y + (sc.height - rxnDim) / 2);
      }
      for (const pr of r.products) {
        const sc = speciesCoords.get(pr.species);
        if (sc) partSpeciesY.push(sc.y + (sc.height - rxnDim) / 2);
      }

      let targetY = partSpeciesY.length > 0 ? partSpeciesY.reduce((a, b) => a + b, 0) / partSpeciesY.length : lastY;
      if (i > 0 && targetY <= lastY) {
        targetY = lastY + 50;
      }
      lastY = targetY;

      reactionCoords.set(r.id, {
        x: channelX,
        y: targetY,
        width: rxnDim,
        height: rxnDim,
      });
    }
  }

  const totalWidth = Math.max(options?.width ?? 760, curCompX + 40);
  const totalHeight = Math.max(options?.height ?? 440, compY + uniformCompHeight + 80);

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
          fill: "rgba(30, 41, 59, 0.35)",
          stroke: "#475569",
          strokeWidth: 2,
          strokeDasharray: "5,5",
          rx: 16,
          ry: 16,
        },
        label: {
          fill: "#94a3b8",
          fontSize: 11,
          fontWeight: "600",
          refX: 16,
          refY: 16,
          textAnchor: "start",
        },
      },
      data: { compartmentId: c.id, isContainer: true, size: c.size },
    });
  }

  // 2. Species Macromolecules
  for (const s of speciesList) {
    const coord = layout.speciesCoords.get(s.id) ?? { x: 100, y: 160, width: 180, height: 40 };

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
        label: {
          fill: "#f8fafc",
          fontSize: 10,
          fontWeight: "600",
          textWrap: {
            width: -12,
            ellipsis: true,
          },
        },
      },
      data: { speciesId: s.id, compartment: s.compartment, concentration: s.initialConcentration },
    });
  }

  // 3. Reaction Nodes and Stoichiometry Arcs
  for (const r of reactionsList) {
    const coord = layout.reactionCoords.get(r.id) ?? { x: 180, y: 230, width: 24, height: 24 };
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
        body: { fill: "#1e1b4b", stroke: "#818cf8", strokeWidth: 2, rx: 4, ry: 4 },
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
          router: { name: "normal" },
          connector: { name: "rounded", args: { radius: 8 } },
          attrs: {
            line: {
              stroke: "#38bdf8",
              strokeWidth: 1.5,
            },
            label: { fill: "#38bdf8", fontSize: 10, fontWeight: "bold" },
          },
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
          router: { name: "normal" },
          connector: { name: "rounded", args: { radius: 8 } },
          attrs: {
            line: {
              stroke: "#10b981",
              strokeWidth: 2,
              targetMarker: { name: "classic", width: 7, height: 6 },
            },
            label: { fill: "#10b981", fontSize: 10, fontWeight: "bold" },
          },
        });
      }
    }

    // Catalytic and inhibitory regulatory modifiers
    for (const mod of r.modifiers ?? []) {
      if (layout.speciesCoords.has(mod.species)) {
        const isInhibition = mod.type === "inhibition";
        cells.push({
          id: `arc_${mod.species}_mod_${r.id}`,
          shape: "edge",
          source: { cell: `species_${mod.species}` },
          target: { cell: rCellId },
          router: { name: "normal" },
          connector: { name: "rounded", args: { radius: 8 } },
          attrs: {
            line: {
              stroke: isInhibition ? "#ef4444" : "#f59e0b",
              strokeWidth: 1.5,
              strokeDasharray: "4,4",
              targetMarker: {
                name: isInhibition ? "path" : "circle",
                r: isInhibition ? undefined : 4,
                d: isInhibition ? "M 0 -5 L 0 5" : undefined,
              },
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
  svg += `    <marker id="sbgn-catalysis" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">\n`;
  svg += `      <circle cx="5" cy="5" r="3.5" fill="#0b0f19" stroke="#f59e0b" stroke-width="1.5" />\n`;
  svg += `    </marker>\n`;
  svg += `    <marker id="sbgn-inhibition" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">\n`;
  svg += `      <line x1="5" y1="1" x2="5" y2="9" stroke="#ef4444" stroke-width="2" />\n`;
  svg += `    </marker>\n`;
  svg += `  </defs>\n`;

  // Title Banner
  svg += `  <text x="50" y="36" fill="${textColor}" font-size="16" font-weight="700">${escapeXml(model.name ?? model.id ?? "Biochemical Reaction Network")}</text>\n`;
  svg += `  <text x="50" y="52" fill="${subTextColor}" font-size="10">SBGN Process Description: Compartments, Macromolecules &amp; Stoichiometry</text>\n`;

  // 1. Dynamic Compartment Outlines
  for (const c of layout.compartmentBounds.values()) {
    svg += `  <rect x="${c.x}" y="${c.y}" width="${c.width}" height="${c.height}" rx="16" ry="16" fill="${isDark ? "rgba(30, 41, 59, 0.35)" : "#f1f5f9"}" stroke="#475569" stroke-width="2" stroke-dasharray="6,4" />\n`;
    svg += `  <text x="${c.x + 20}" y="${c.y + 25}" fill="${subTextColor}" font-size="11" font-weight="700">${escapeXml(c.name ?? c.id)} (Volume: ${c.size ?? 1.0} L)</text>\n`;
  }

  // 2. Draw Reactions & Arcs
  for (const r of reactionsList) {
    const rx = layout.reactionCoords.get(r.id);
    if (!rx) continue;

    const midRxX = rx.x + rx.width / 2;
    const midRxY = rx.y + rx.height / 2;

    // Reactant consumption
    for (const react of r.reactants) {
      const p = layout.speciesCoords.get(react.species);
      if (p) {
        const conn = getRectConnection(p, rx);
        svg += `  <line x1="${conn.x1}" y1="${conn.y1}" x2="${conn.x2}" y2="${conn.y2}" stroke="#38bdf8" stroke-width="1.5" />\n`;
        if (react.stoichiometry > 1) {
          const midX = (conn.x1 + conn.x2) / 2;
          const midY = (conn.y1 + conn.y2) / 2 - 4;
          svg += `  <text x="${midX}" y="${midY}" fill="#38bdf8" font-size="9" font-weight="bold">${react.stoichiometry}</text>\n`;
        }
      }
    }

    // Product synthesis
    for (const prod of r.products) {
      const p = layout.speciesCoords.get(prod.species);
      if (p) {
        const conn = getRectConnection(rx, p);
        svg += `  <line x1="${conn.x1}" y1="${conn.y1}" x2="${conn.x2}" y2="${conn.y2}" stroke="#10b981" stroke-width="2" marker-end="url(#sbgn-arrow)" />\n`;
        if (prod.stoichiometry > 1) {
          const midX = (conn.x1 + conn.x2) / 2;
          const midY = (conn.y1 + conn.y2) / 2 - 4;
          svg += `  <text x="${midX}" y="${midY}" fill="#10b981" font-size="9" font-weight="bold">${prod.stoichiometry}</text>\n`;
        }
      }
    }

    // Catalytic / inhibitory modifiers
    for (const mod of r.modifiers ?? []) {
      const p = layout.speciesCoords.get(mod.species);
      if (p) {
        const conn = getRectConnection(p, rx);
        const isInhibition = mod.type === "inhibition";
        const marker = isInhibition ? "url(#sbgn-inhibition)" : "url(#sbgn-catalysis)";
        const stroke = isInhibition ? "#ef4444" : "#f59e0b";
        svg += `  <line x1="${conn.x1}" y1="${conn.y1}" x2="${conn.x2}" y2="${conn.y2}" stroke="${stroke}" stroke-width="1.5" stroke-dasharray="4,4" marker-end="${marker}" />\n`;
      }
    }

    // Reaction hub glyph
    svg += `  <rect x="${rx.x}" y="${rx.y}" width="${rx.width}" height="${rx.height}" rx="4" ry="4" fill="${isDark ? "#1e1b4b" : "#e0e7ff"}" stroke="#818cf8" stroke-width="2" />\n`;
    svg += `  <text x="${midRxX}" y="${midRxY + 4}" fill="#818cf8" font-size="11" font-weight="bold" text-anchor="middle">${r.reversible ? "↔" : "→"}</text>\n`;
    svg += `  <text x="${midRxX}" y="${rx.y + rx.height + 12}" fill="${subTextColor}" font-size="8" text-anchor="middle">${escapeXml(r.id)}</text>\n`;
  }

  // 3. Draw Species Macromolecules
  for (const s of speciesList) {
    const p = layout.speciesCoords.get(s.id);
    if (!p) continue;
    const stroke = s.boundaryCondition ? "#f59e0b" : "#38bdf8";
    const label = s.name ?? s.id;
    const maxChars = Math.floor(p.width / 7.0);
    const displayLabel = label.length > maxChars ? label.slice(0, maxChars - 1) + "…" : label;

    svg += `  <rect x="${p.x}" y="${p.y}" width="${p.width}" height="${p.height}" rx="12" ry="12" fill="${isDark ? "#0f172a" : "#ffffff"}" stroke="${stroke}" stroke-width="2" />\n`;
    svg += `  <text x="${p.x + p.width / 2}" y="${p.y + 18}" fill="${textColor}" font-size="10" font-weight="600" text-anchor="middle">${escapeXml(displayLabel)}</text>\n`;
    if (s.initialConcentration !== undefined) {
      svg += `  <text x="${p.x + p.width / 2}" y="${p.y + 30}" fill="${subTextColor}" font-size="8" text-anchor="middle">[${s.initialConcentration} mM]</text>\n`;
    }
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
  svg += `    <line x1="315" y1="-3" x2="330" y2="-3" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="3,3" marker-end="url(#sbgn-catalysis)" />\n`;
  svg += `    <text x="337" y="0" fill="${subTextColor}" font-size="9">Catalysis</text>\n`;
  svg += `  </g>\n`;

  svg += `</svg>\n`;
  return svg;
}
