// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sbol — Synthetic Genetic Circuit Hill-Function ODE Solver.
 *
 * Synthesizes and integrates transcriptional regulatory ODEs from SBOL3 genetic circuit
 * definitions using 4th-order Runge-Kutta (RK4) integration:
 *
 *   d[P_i]/dt = alpha_{0,i}
 *             + alpha_i * prod_{a in Act(i)} ([P_a]^{n_a} / (K_a^{n_a} + [P_a]^{n_a}))
 *                       * prod_{r in Rep(i)} (K_r^{n_r} / (K_r^{n_r} + [P_r]^{n_r}))
 *             - gamma_i * [P_i]
 */

import { SEQUENCE_ONTOLOGY, type SbolComponent, type SbolDocument } from "../types.js";

export interface HillRegulator {
  regulatorId: string;
  role: "activator" | "repressor";
  K: number; // Dissociation / half-saturation threshold constant
  n: number; // Hill cooperativity coefficient
}

export interface RegulatedSpeciesSpec {
  id: string;
  name: string;
  initialConcentration: number;
  alpha0: number; // Basal leaky expression rate
  alpha: number; // Maximal regulated expression rate
  gamma: number; // Protein degradation / dilution rate
  regulators: HillRegulator[];
}

export interface GeneticCircuitSolverOptions {
  duration?: number | undefined; // Total simulation duration (default: 50.0)
  timeStep?: number | undefined; // RK4 integration step dt (default: 0.05)
  initialConcentrations?: Record<string, number> | undefined;
  defaultAlpha?: number | undefined;
  defaultAlpha0?: number | undefined;
  defaultGamma?: number | undefined;
  defaultK?: number | undefined;
  defaultN?: number | undefined;
}

export interface GeneticCircuitStepRecord {
  time: number;
  concentrations: Record<string, number>;
  productionRates: Record<string, number>;
}

export interface GeneticCircuitSimulationResult {
  speciesNames: string[];
  network: RegulatedSpeciesSpec[];
  initialConcentrations: Record<string, number>;
  finalConcentrations: Record<string, number>;
  trajectory: GeneticCircuitStepRecord[];
  stepsCount: number;
}

/**
 * Extracts the transcriptional regulatory network (expressed species, kinetic rates, and Hill
 * activators/repressors) from an `SbolDocument`.
 */
export function extractRegulatoryNetwork(
  doc: SbolDocument,
  options?: GeneticCircuitSolverOptions,
): RegulatedSpeciesSpec[] {
  const defaultAlpha = options?.defaultAlpha ?? 10.0;
  const defaultAlpha0 = options?.defaultAlpha0 ?? 0.05;
  const defaultGamma = options?.defaultGamma ?? 1.0;
  const defaultK = options?.defaultK ?? 1.0;
  const defaultN = options?.defaultN ?? 3.0;

  const compById = new Map<string, SbolComponent>();
  for (const c of doc.components) {
    compById.set(c.displayId, c);
  }

  // Map promoter / template IDs -> downstream expressed CDS/protein IDs
  const promoterToProducts = new Map<string, Set<string>>();
  const addPromoterProduct = (promId: string, prodId: string): void => {
    if (!promId || !prodId) return;
    const set = promoterToProducts.get(promId) ?? new Set<string>();
    set.add(prodId);
    promoterToProducts.set(promId, set);
  };

  // 1. Inspect transcriptional unit components to link promoters to downstream CDS parts
  for (const comp of doc.components) {
    const unitPromoters: string[] = [];
    const unitCds: string[] = [];

    for (const sub of comp.subComponents) {
      const target = compById.get(sub.instanceOf);
      const roles = sub.roles && sub.roles.length > 0 ? sub.roles : (target?.roles ?? []);
      const partId = target?.displayId ?? sub.instanceOf ?? sub.displayId;
      if (roles.includes(SEQUENCE_ONTOLOGY.PROMOTER)) {
        unitPromoters.push(partId);
        unitPromoters.push(sub.displayId);
      }
      if (roles.includes(SEQUENCE_ONTOLOGY.CDS)) {
        unitCds.push(partId);
      }
    }

    for (const feat of comp.features) {
      if (feat.roles.includes(SEQUENCE_ONTOLOGY.PROMOTER)) {
        unitPromoters.push(feat.displayId);
      }
      if (feat.roles.includes(SEQUENCE_ONTOLOGY.CDS)) {
        unitCds.push(feat.displayId);
      }
    }

    for (const p of unitPromoters) {
      for (const c of unitCds) {
        addPromoterProduct(p, c);
      }
    }
    if (unitCds.length > 0) {
      for (const c of unitCds) {
        addPromoterProduct(comp.displayId, c);
      }
    }
  }

  // 2. Inspect genetic_production interactions to link templates/promoters to products
  for (const inter of doc.interactions) {
    if (inter.type === "genetic_production") {
      const templates: string[] = [];
      const products: string[] = [];
      for (const part of inter.participants) {
        if (part.roles.includes("template") || part.roles.includes("promoter")) {
          templates.push(part.participant);
        }
        if (part.roles.includes("product")) {
          products.push(part.participant);
        }
      }
      for (const t of templates) {
        for (const p of products) {
          addPromoterProduct(t, p);
        }
      }
    }
  }

  // 3. Identify expressed species (proteins, CDS components, or interaction participants)
  const speciesMap = new Map<string, RegulatedSpeciesSpec>();
  const ensureSpecies = (id: string): RegulatedSpeciesSpec => {
    const existing = speciesMap.get(id);
    if (existing) return existing;
    const comp = compById.get(id);
    const spec: RegulatedSpeciesSpec = {
      id,
      name: comp?.name ?? id,
      initialConcentration: options?.initialConcentrations?.[id] ?? comp?.initialConcentration ?? 0.1,
      alpha0: comp?.basalRate ?? defaultAlpha0,
      alpha: comp?.maxExpressionRate ?? defaultAlpha,
      gamma: comp?.degradationRate ?? defaultGamma,
      regulators: [],
    };
    speciesMap.set(id, spec);
    return spec;
  };

  // Register CDS and protein components
  for (const comp of doc.components) {
    const isProteinType = comp.types.some(
      (t) => t.toLowerCase().includes("protein") || t.toUpperCase().includes("SBO:0000252"),
    );
    const isCds = comp.roles.includes(SEQUENCE_ONTOLOGY.CDS);
    if (isProteinType || isCds) {
      ensureSpecies(comp.displayId);
    }
  }

  // Process all interactions
  for (const inter of doc.interactions) {
    const pAlpha = inter.parameters["alpha"];
    const pAlpha0 = inter.parameters["alpha0"];
    const pBasal = inter.parameters["basal"];
    const pGamma = inter.parameters["gamma"];
    const pKd = inter.parameters["kd"];
    const pK = inter.parameters["K"];
    const pN = inter.parameters["n"];

    if (inter.type === "genetic_production") {
      for (const part of inter.participants) {
        if (part.roles.includes("product")) {
          const spec = ensureSpecies(part.participant);
          if (pAlpha !== undefined) spec.alpha = pAlpha;
          if (pAlpha0 !== undefined) spec.alpha0 = pAlpha0;
          if (pBasal !== undefined) spec.alpha0 = pBasal;
          if (pGamma !== undefined) spec.gamma = pGamma;
        }
      }
    } else if (inter.type === "degradation") {
      for (const part of inter.participants) {
        if (part.roles.includes("reactant") || part.roles.includes("degraded") || inter.participants.length === 1) {
          const spec = ensureSpecies(part.participant);
          const g = pGamma ?? pKd;
          if (g !== undefined) spec.gamma = g;
        }
      }
    } else if (inter.type === "inhibition" || inter.type === "stimulation") {
      const regRole: "repressor" | "activator" = inter.type === "inhibition" ? "repressor" : "activator";
      const regulators: string[] = [];
      const targets: string[] = [];

      for (const part of inter.participants) {
        if (part.roles.includes("inhibitor") || part.roles.includes("stimulator") || part.roles.includes("modifier")) {
          regulators.push(part.participant);
        } else if (
          part.roles.includes("inhibited") ||
          part.roles.includes("stimulated") ||
          part.roles.includes("promoter") ||
          part.roles.includes("template")
        ) {
          targets.push(part.participant);
        }
      }

      const K = pK ?? defaultK;
      const n = pN ?? defaultN;

      for (const regId of regulators) {
        ensureSpecies(regId);
        for (const rawTarget of targets) {
          const mappedProducts = promoterToProducts.get(rawTarget);
          const resolvedTargets = mappedProducts && mappedProducts.size > 0 ? Array.from(mappedProducts) : [rawTarget];

          for (const targetId of resolvedTargets) {
            const targetSpec = ensureSpecies(targetId);
            if (pAlpha !== undefined) targetSpec.alpha = pAlpha;
            if (pAlpha0 !== undefined) targetSpec.alpha0 = pAlpha0;
            if (pGamma !== undefined) targetSpec.gamma = pGamma;
            targetSpec.regulators.push({
              regulatorId: regId,
              role: regRole,
              K,
              n,
            });
          }
        }
      }
    }
  }

  // Fallback: if no CDS/protein/interactions found, include all components
  if (speciesMap.size === 0) {
    for (const comp of doc.components) {
      ensureSpecies(comp.displayId);
    }
  }

  // Assign deterministic asymmetric default initial concentrations if all species have identical defaults
  const specs = Array.from(speciesMap.values());
  if (
    specs.length > 1 &&
    !options?.initialConcentrations &&
    specs.every((s) => compById.get(s.id)?.initialConcentration === undefined)
  ) {
    specs[0]!.initialConcentration = 2.0;
    for (let i = 1; i < specs.length; i++) {
      specs[i]!.initialConcentration = 0.1 * i;
    }
  }

  return specs;
}

/**
 * Evaluates the instantaneous Hill synthesis rate for a regulated species given current concentrations.
 */
export function evaluateHillSynthesisRate(spec: RegulatedSpeciesSpec, state: Record<string, number>): number {
  let regFactor = 1.0;

  for (const reg of spec.regulators) {
    const p = Math.max(0.0, state[reg.regulatorId] ?? 0.0);
    const pPow = Math.pow(p, reg.n);
    const kPow = Math.pow(Math.max(1e-12, reg.K), reg.n);
    if (reg.role === "activator") {
      regFactor *= pPow / (kPow + pPow);
    } else {
      regFactor *= kPow / (kPow + pPow);
    }
  }

  return spec.alpha0 + spec.alpha * regFactor;
}

/**
 * Integrates the synthetic genetic circuit ODEs using 4th-order Runge-Kutta (RK4).
 */
export function solveGeneticCircuit(
  doc: SbolDocument,
  options?: GeneticCircuitSolverOptions,
): GeneticCircuitSimulationResult {
  const duration = options?.duration ?? 50.0;
  const dt = options?.timeStep ?? 0.05;
  const network = extractRegulatoryNetwork(doc, options);
  const speciesNames = network.map((s) => s.id);

  const initialConcentrations: Record<string, number> = {};
  const state: Record<string, number> = {};
  for (const s of network) {
    const initVal = Math.max(0.0, s.initialConcentration);
    initialConcentrations[s.id] = initVal;
    state[s.id] = initVal;
  }

  const computeDerivatives = (
    curr: Record<string, number>,
  ): { dState: Record<string, number>; prodRates: Record<string, number> } => {
    const dState: Record<string, number> = {};
    const prodRates: Record<string, number> = {};
    for (const s of network) {
      const synth = evaluateHillSynthesisRate(s, curr);
      const val = Math.max(0.0, curr[s.id] ?? 0.0);
      prodRates[s.id] = synth;
      dState[s.id] = synth - s.gamma * val;
    }
    return { dState, prodRates };
  };

  const trajectory: GeneticCircuitStepRecord[] = [];
  const steps = Math.max(1, Math.round(duration / dt));

  const initEval = computeDerivatives(state);
  trajectory.push({
    time: 0.0,
    concentrations: { ...state },
    productionRates: initEval.prodRates,
  });

  for (let step = 1; step <= steps; step++) {
    const t = Number((step * dt).toFixed(6));

    const k1 = computeDerivatives(state).dState;

    const s2: Record<string, number> = {};
    for (const id of speciesNames) {
      s2[id] = Math.max(0.0, (state[id] ?? 0.0) + 0.5 * dt * (k1[id] ?? 0.0));
    }
    const k2 = computeDerivatives(s2).dState;

    const s3: Record<string, number> = {};
    for (const id of speciesNames) {
      s3[id] = Math.max(0.0, (state[id] ?? 0.0) + 0.5 * dt * (k2[id] ?? 0.0));
    }
    const k3 = computeDerivatives(s3).dState;

    const s4: Record<string, number> = {};
    for (const id of speciesNames) {
      s4[id] = Math.max(0.0, (state[id] ?? 0.0) + dt * (k3[id] ?? 0.0));
    }
    const k4 = computeDerivatives(s4).dState;

    for (const id of speciesNames) {
      const delta = (dt / 6.0) * ((k1[id] ?? 0.0) + 2.0 * (k2[id] ?? 0.0) + 2.0 * (k3[id] ?? 0.0) + (k4[id] ?? 0.0));
      state[id] = Math.max(0.0, (state[id] ?? 0.0) + delta);
    }

    const stepEval = computeDerivatives(state);
    trajectory.push({
      time: t,
      concentrations: { ...state },
      productionRates: stepEval.prodRates,
    });
  }

  return {
    speciesNames,
    network,
    initialConcentrations,
    finalConcentrations: { ...state },
    trajectory,
    stepsCount: steps,
  };
}
