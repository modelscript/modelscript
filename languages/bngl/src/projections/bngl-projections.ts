// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/bngl — Modelica 3.x and SBML Level 3 XML Projections for BioNetGen Models.
 */

import { generateBnglNetwork } from "../solvers/bngl-solver.js";
import type { BnglDocument } from "../types.js";

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isAlpha(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

function isAlphaNum(ch: string): boolean {
  return isAlpha(ch) || isDigit(ch);
}

function sanitizeIdentifier(name: string): string {
  let out = "";
  for (let i = 0; i < name.length; i++) {
    const ch = name[i] ?? "";
    out += isAlphaNum(ch) ? ch : "_";
  }
  return out.length > 0 ? out : "BioNetGenNetwork";
}

function rewriteRateLawSymbols(
  formula: string,
  speciesIds: Set<string>,
  paramIds: Set<string>,
  obsIds: Set<string>,
  compIds: Set<string>,
): string {
  let out = "";
  let i = 0;
  const n = formula.length;
  while (i < n) {
    const ch = formula[i] ?? "";
    if (isAlpha(ch)) {
      const prev = i > 0 ? (formula[i - 1] ?? "") : "";
      let ident = "";
      while (i < n && isAlphaNum(formula[i] ?? "")) {
        ident += formula[i] ?? "";
        i++;
      }
      if ((ident[0] === "e" || ident[0] === "E") && (isDigit(prev) || prev === ".")) {
        out += ident;
        continue;
      }
      if (speciesIds.has(ident)) {
        out += ident;
      } else if (paramIds.has(ident)) {
        out += `param_${ident}`;
      } else if (obsIds.has(ident)) {
        out += `obs_${ident}`;
      } else if (compIds.has(ident)) {
        out += `V_${ident}`;
      } else {
        out += ident;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Projects a BioNetGen document and its expanded reaction network into a standalone Modelica 3.x model.
 */
export function bnglToModelica(doc: BnglDocument, modelName?: string): string {
  const model = doc.model;
  const network = generateBnglNetwork(doc);
  const safeModelName = sanitizeIdentifier(modelName ?? (model.id || "BioNetGenNetwork"));
  const lines: string[] = [];

  lines.push(`model ${safeModelName}`);
  lines.push(`  "BioNetGen Rule-Based Biochemical Network: ${model.name || model.id}"`);
  lines.push(``);

  const compIds = new Set<string>(model.compartments.keys());
  compIds.add("default_compartment");
  const paramIds = new Set<string>(model.parameters.keys());
  const speciesIds = new Set<string>(network.species.map((s) => s.id));
  const obsIds = new Set<string>(network.observableGroups.map((g) => g.name));

  // 1. Compartments
  lines.push(`  // --- Compartments ---`);
  if (model.compartments.size === 0) {
    lines.push(`  parameter Real V_default_compartment = 1.0000 "Volume of default compartment";`);
  } else {
    for (const [cId, comp] of model.compartments) {
      lines.push(`  parameter Real V_${cId} = ${comp.size.toFixed(4)} "Volume of compartment ${cId}";`);
    }
  }
  lines.push(``);

  // 2. Parameters
  if (model.parameters.size > 0) {
    lines.push(`  // --- Rate & Concentration Parameters ---`);
    for (const [pId, param] of model.parameters) {
      lines.push(`  parameter Real param_${pId} = ${param.value.toExponential(4)} "Parameter ${pId}";`);
    }
    lines.push(``);
  }

  // 3. Expanded Concrete Species
  lines.push(`  // --- Concrete Chemical Species ---`);
  for (const sp of network.species) {
    lines.push(
      `  Real ${sp.id}(start = ${sp.initialConcentration.toExponential(4)}) "Species ${sp.canonicalPattern}";`,
    );
  }
  lines.push(``);

  // 4. Observables
  if (network.observableGroups.length > 0) {
    lines.push(`  // --- Observables ---`);
    for (const grp of network.observableGroups) {
      lines.push(`  Real obs_${grp.name} "Observable (${grp.type}) ${grp.name}";`);
    }
    lines.push(``);
  }

  // 5. Reaction Fluxes
  if (network.reactions.length > 0) {
    lines.push(`  // --- Elementary Reaction Fluxes ---`);
    for (const rxn of network.reactions) {
      lines.push(
        `  Real v_${rxn.id} "Flux of ${rxn.ruleId}: ${rxn.reactantIds.join(" + ")} -> ${rxn.productIds.join(" + ")}";`,
      );
    }
    lines.push(``);
  }

  lines.push(`equation`);

  // 6. Observable Equations
  for (const grp of network.observableGroups) {
    const terms: string[] = [];
    for (const [spId, weight] of grp.weights) {
      terms.push(weight === 1 ? spId : `${weight} * ${spId}`);
    }
    const rhs = terms.length > 0 ? terms.join(" + ") : "0.0";
    lines.push(`  obs_${grp.name} = ${rhs};`);
  }
  if (network.observableGroups.length > 0) {
    lines.push(``);
  }

  // 7. Reaction Flux Equations
  for (const rxn of network.reactions) {
    const rewritten = rewriteRateLawSymbols(rxn.rateLaw, speciesIds, paramIds, obsIds, compIds);
    lines.push(`  v_${rxn.id} = ${rewritten};`);
  }
  if (network.reactions.length > 0) {
    lines.push(``);
  }

  // 8. Species Differential Balance Equations
  for (const sp of network.species) {
    if (sp.constant) {
      lines.push(`  der(${sp.id}) = 0.0;`);
      continue;
    }

    const netTerms: string[] = [];
    for (const rxn of network.reactions) {
      let delta = 0;
      for (const rId of rxn.reactantIds) {
        if (rId === sp.id) delta -= 1;
      }
      for (const pId of rxn.productIds) {
        if (pId === sp.id) delta += 1;
      }
      if (delta < 0) {
        const coeff = Math.abs(delta);
        netTerms.push(`- ${coeff === 1 ? "" : `${coeff} * `}v_${rxn.id}`);
      } else if (delta > 0) {
        netTerms.push(`+ ${delta === 1 ? "" : `${delta} * `}v_${rxn.id}`);
      }
    }

    const compName = sp.compartment && model.compartments.has(sp.compartment) ? sp.compartment : "default_compartment";
    const rhs = netTerms.length > 0 ? netTerms.join(" ") : "0.0";
    lines.push(`  der(${sp.id}) = (${rhs}) / V_${compName};`);
  }

  lines.push(`end ${safeModelName};`);
  return lines.join("\n");
}

function escapeXmlAttr(str: string): string {
  let out = "";
  for (let i = 0; i < str.length; i++) {
    const ch = str[i] ?? "";
    if (ch === "&") out += "&amp;";
    else if (ch === "<") out += "&lt;";
    else if (ch === ">") out += "&gt;";
    else if (ch === '"') out += "&quot;";
    else out += ch;
  }
  return out;
}

/**
 * Projects a BioNetGen document and its expanded reaction network into an SBML Level 3 Version 2 XML document.
 */
export function bnglToSbmlXml(doc: BnglDocument): string {
  const model = doc.model;
  const network = generateBnglNetwork(doc);
  const lines: string[] = [];

  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<sbml xmlns="http://www.sbml.org/sbml/level3/version2/core" level="3" version="2">`);
  lines.push(
    `  <model id="${escapeXmlAttr(model.id || "BioNetGenModel")}" name="${escapeXmlAttr(model.name || model.id || "BioNetGenModel")}">`,
  );

  // Compartments
  lines.push(`    <listOfCompartments>`);
  if (model.compartments.size === 0) {
    lines.push(`      <compartment id="default_compartment" size="1" spatialDimensions="3" constant="true"/>`);
  } else {
    for (const c of model.compartments.values()) {
      lines.push(
        `      <compartment id="${escapeXmlAttr(c.id)}" size="${c.size}" spatialDimensions="${c.dimensions}" constant="true"/>`,
      );
    }
  }
  lines.push(`    </listOfCompartments>`);

  // Species
  if (network.species.length > 0) {
    lines.push(`    <listOfSpecies>`);
    for (const sp of network.species) {
      const compId = sp.compartment && model.compartments.has(sp.compartment) ? sp.compartment : "default_compartment";
      lines.push(
        `      <species id="${escapeXmlAttr(sp.id)}" name="${escapeXmlAttr(sp.canonicalPattern)}" compartment="${escapeXmlAttr(compId)}" initialConcentration="${sp.initialConcentration}" boundaryCondition="${sp.constant}" constant="${sp.constant}" hasOnlySubstanceUnits="false"/>`,
      );
    }
    lines.push(`    </listOfSpecies>`);
  }

  // Parameters (including observables as non-constant parameters for assignment rules)
  if (model.parameters.size > 0 || network.observableGroups.length > 0) {
    lines.push(`    <listOfParameters>`);
    for (const p of model.parameters.values()) {
      lines.push(`      <parameter id="${escapeXmlAttr(p.id)}" value="${p.value}" constant="true"/>`);
    }
    for (const grp of network.observableGroups) {
      lines.push(`      <parameter id="${escapeXmlAttr(grp.name)}" value="0" constant="false"/>`);
    }
    lines.push(`    </listOfParameters>`);
  }

  // Observable Assignment Rules
  if (network.observableGroups.length > 0) {
    lines.push(`    <listOfRules>`);
    for (const grp of network.observableGroups) {
      const terms: string[] = [];
      for (const [spId, weight] of grp.weights) {
        terms.push(weight === 1 ? spId : `${weight} * ${spId}`);
      }
      const formula = terms.length > 0 ? terms.join(" + ") : "0";
      lines.push(`      <assignmentRule variable="${escapeXmlAttr(grp.name)}" formula="${escapeXmlAttr(formula)}"/>`);
    }
    lines.push(`    </listOfRules>`);
  }

  // Reactions
  if (network.reactions.length > 0) {
    lines.push(`    <listOfReactions>`);
    for (const rxn of network.reactions) {
      lines.push(
        `      <reaction id="${escapeXmlAttr(rxn.id)}" name="${escapeXmlAttr(rxn.ruleId)}" reversible="false" fast="false">`,
      );
      if (rxn.reactantIds.length > 0) {
        lines.push(`        <listOfReactants>`);
        for (const rId of rxn.reactantIds) {
          lines.push(`          <speciesReference species="${escapeXmlAttr(rId)}" stoichiometry="1" constant="true"/>`);
        }
        lines.push(`        </listOfReactants>`);
      }
      if (rxn.productIds.length > 0) {
        lines.push(`        <listOfProducts>`);
        for (const pId of rxn.productIds) {
          lines.push(`          <speciesReference species="${escapeXmlAttr(pId)}" stoichiometry="1" constant="true"/>`);
        }
        lines.push(`        </listOfProducts>`);
      }
      lines.push(`        <kineticLaw>`);
      lines.push(`          <formula>${escapeXmlAttr(rxn.rateLaw)}</formula>`);
      lines.push(`        </kineticLaw>`);
      lines.push(`      </reaction>`);
    }
    lines.push(`    </listOfReactions>`);
  }

  lines.push(`  </model>`);
  lines.push(`</sbml>`);
  return lines.join("\n");
}

export const bnglToSbml = bnglToSbmlXml;
