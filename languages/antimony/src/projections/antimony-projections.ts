// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/antimony — Modelica 3.x and SBML Level 3 XML Projections for Antimony Models.
 */

import { flattenAntimonyModule } from "../solvers/antimony-solver.js";
import type { AntimonyDocument, AntimonyRule } from "../types.js";

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
  return out.length > 0 ? out : "AntimonyPathway";
}

function rewriteFormulaSymbols(
  formula: string,
  speciesIds: Set<string>,
  paramIds: Set<string>,
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
        out += `S_${ident}`;
      } else if (paramIds.has(ident)) {
        out += `param_${ident}`;
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
 * Projects an AntimonyDocument into a standalone Modelica 3.x biochemical pathway model.
 */
export function antimonyToModelica(doc: AntimonyDocument, modelName?: string): string {
  const mod = flattenAntimonyModule(doc, doc.mainModule);
  const safeModelName = sanitizeIdentifier(modelName ?? (mod.id || "AntimonyPathway"));
  const lines: string[] = [];

  lines.push(`model ${safeModelName}`);
  lines.push(`  "Antimony Biochemical Reaction Network: ${mod.name || mod.id}"`);
  lines.push(``);

  const compIds = new Set<string>(mod.compartments.keys());
  compIds.add("default_compartment");
  const paramIds = new Set<string>(mod.parameters.keys());
  const speciesIds = new Set<string>(mod.species.keys());

  const rateRuleByVar = new Map<string, AntimonyRule>();
  const assignRuleByVar = new Map<string, AntimonyRule>();
  for (const rule of mod.rules) {
    if (rule.type === "rate") {
      rateRuleByVar.set(rule.variable, rule);
      if (!paramIds.has(rule.variable) && !compIds.has(rule.variable)) {
        speciesIds.add(rule.variable);
      }
    } else if (rule.type === "assignment") {
      assignRuleByVar.set(rule.variable, rule);
      if (!paramIds.has(rule.variable) && !compIds.has(rule.variable)) {
        speciesIds.add(rule.variable);
      }
    }
  }

  // 1. Compartments
  lines.push(`  // --- Compartments ---`);
  if (mod.compartments.size === 0) {
    lines.push(`  parameter Real V_default_compartment = 1.0000 "Volume of default compartment";`);
  } else {
    for (const [id, c] of mod.compartments) {
      lines.push(`  parameter Real V_${id} = ${c.size.toFixed(4)} "Volume of compartment ${c.name || id}";`);
    }
  }
  lines.push(``);

  // 2. Global Parameters
  if (mod.parameters.size > 0) {
    lines.push(`  // --- Global Parameters ---`);
    for (const [id, p] of mod.parameters) {
      const hasRule = rateRuleByVar.has(id) || assignRuleByVar.has(id);
      if (p.constant && !hasRule) {
        lines.push(`  parameter Real param_${id} = ${p.value.toExponential(4)} "Parameter ${p.name || id}";`);
      } else {
        lines.push(`  Real param_${id}(start = ${p.value.toExponential(4)}) "Variable ${p.name || id}";`);
      }
    }
    lines.push(``);
  }

  // 3. Species Concentrations
  lines.push(`  // --- Species Concentrations ---`);
  for (const id of speciesIds) {
    const s = mod.species.get(id);
    const cSize = s ? (mod.compartments.get(s.compartment)?.size ?? 1.0) : 1.0;
    let initialConc = s?.initialConcentration;
    if (initialConc === undefined && s?.initialAmount !== undefined) {
      initialConc = s.initialAmount / Math.max(1e-9, cSize);
    }
    const val = initialConc ?? 0.0;
    lines.push(`  Real S_${id}(start = ${val.toExponential(4)}) "Concentration of ${s?.name || id} [mol/L]";`);
  }
  lines.push(``);

  // 4. Reaction Flux Variables
  if (mod.reactions.size > 0) {
    lines.push(`  // --- Reaction Fluxes ---`);
    for (const [id, r] of mod.reactions) {
      lines.push(`  Real v_${id} "Reaction flux of ${r.name || id}";`);
    }
    lines.push(``);
  }

  lines.push(`equation`);

  // 5. Reaction Flux Equations
  for (const [id, r] of mod.reactions) {
    if (r.rateLaw && r.rateLaw.trim().length > 0) {
      const formula = rewriteFormulaSymbols(r.rateLaw, speciesIds, paramIds, compIds);
      lines.push(`  v_${id} = ${formula};`);
    } else {
      const reactTerms = r.reactants.map((ref) => `S_${ref.species}`);
      const rateStr = reactTerms.length > 0 ? reactTerms.join(" * ") : "1.0";
      lines.push(`  v_${id} = ${rateStr};`);
    }
  }
  if (mod.reactions.size > 0) {
    lines.push(``);
  }

  // 6. Parameter Rules
  for (const [id, p] of mod.parameters) {
    const assignRule = assignRuleByVar.get(id);
    const rateRule = rateRuleByVar.get(id);
    if (assignRule) {
      const rhs = rewriteFormulaSymbols(assignRule.formula, speciesIds, paramIds, compIds);
      lines.push(`  param_${id} = ${rhs};`);
    } else if (rateRule) {
      const rhs = rewriteFormulaSymbols(rateRule.formula, speciesIds, paramIds, compIds);
      lines.push(`  der(param_${id}) = ${rhs};`);
    } else if (!p.constant) {
      lines.push(`  der(param_${id}) = 0.0;`);
    }
  }

  // 7. Species Differential / Rule Equations
  for (const id of speciesIds) {
    const assignRule = assignRuleByVar.get(id);
    if (assignRule) {
      const rhs = rewriteFormulaSymbols(assignRule.formula, speciesIds, paramIds, compIds);
      lines.push(`  S_${id} = ${rhs};`);
      continue;
    }

    const rateRule = rateRuleByVar.get(id);
    if (rateRule) {
      const rhs = rewriteFormulaSymbols(rateRule.formula, speciesIds, paramIds, compIds);
      lines.push(`  der(S_${id}) = ${rhs};`);
      continue;
    }

    const s = mod.species.get(id);
    if (!s || s.constant || s.boundaryCondition) {
      lines.push(`  der(S_${id}) = 0.0;`);
      continue;
    }

    const netTerms: string[] = [];
    for (const [rId, r] of mod.reactions) {
      for (const ref of r.reactants) {
        if (ref.species === id && !ref.boundaryCondition) {
          const stoich = ref.stoichiometry === 1.0 ? "" : `${ref.stoichiometry} * `;
          netTerms.push(`- ${stoich}v_${rId}`);
        }
      }
      for (const ref of r.products) {
        if (ref.species === id && !ref.boundaryCondition) {
          const stoich = ref.stoichiometry === 1.0 ? "" : `${ref.stoichiometry} * `;
          netTerms.push(`+ ${stoich}v_${rId}`);
        }
      }
    }

    const compName = mod.compartments.has(s.compartment) ? s.compartment : "default_compartment";
    const rhs = netTerms.length > 0 ? netTerms.join(" ") : "0.0";
    lines.push(`  der(S_${id}) = (${rhs}) / V_${compName};`);
  }

  // 8. Events
  for (const ev of mod.events) {
    const trig = rewriteFormulaSymbols(ev.trigger, speciesIds, paramIds, compIds);
    lines.push(`  when ${trig} then`);
    for (const a of ev.assignments) {
      const target = speciesIds.has(a.variable)
        ? `S_${a.variable}`
        : paramIds.has(a.variable)
          ? `param_${a.variable}`
          : a.variable;
      const expr = rewriteFormulaSymbols(a.formula, speciesIds, paramIds, compIds);
      lines.push(`    reinit(${target}, ${expr});`);
    }
    lines.push(`  end when;`);
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
 * Projects an AntimonyDocument into an SBML Level 3 Version 2 XML document.
 */
export function antimonyToSbmlXml(doc: AntimonyDocument): string {
  const mod = flattenAntimonyModule(doc, doc.mainModule);
  const lines: string[] = [];

  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<sbml xmlns="http://www.sbml.org/sbml/level3/version2/core" level="3" version="2">`);
  lines.push(
    `  <model id="${escapeXmlAttr(mod.id || "AntimonyModel")}"${mod.name ? ` name="${escapeXmlAttr(mod.name)}"` : ""}>`,
  );

  // Function Definitions
  if (doc.functions.size > 0) {
    lines.push(`    <listOfFunctionDefinitions>`);
    for (const fn of doc.functions.values()) {
      lines.push(
        `      <functionDefinition id="${escapeXmlAttr(fn.id)}" arguments="${escapeXmlAttr(fn.arguments.join(", "))}" formula="${escapeXmlAttr(fn.body)}"/>`,
      );
    }
    lines.push(`    </listOfFunctionDefinitions>`);
  }

  // Compartments
  lines.push(`    <listOfCompartments>`);
  if (mod.compartments.size === 0) {
    lines.push(`      <compartment id="default_compartment" size="1" spatialDimensions="3" constant="true"/>`);
  } else {
    for (const c of mod.compartments.values()) {
      lines.push(
        `      <compartment id="${escapeXmlAttr(c.id)}"${c.name ? ` name="${escapeXmlAttr(c.name)}"` : ""} size="${c.size}" spatialDimensions="3" constant="${c.constant}"/>`,
      );
    }
  }
  lines.push(`    </listOfCompartments>`);

  // Species
  if (mod.species.size > 0) {
    lines.push(`    <listOfSpecies>`);
    for (const s of mod.species.values()) {
      const compId =
        mod.compartments.has(s.compartment) || mod.compartments.size === 0
          ? s.compartment || "default_compartment"
          : s.compartment;
      const initAttr =
        s.initialConcentration !== undefined
          ? ` initialConcentration="${s.initialConcentration}"`
          : s.initialAmount !== undefined
            ? ` initialAmount="${s.initialAmount}"`
            : ` initialConcentration="0"`;
      lines.push(
        `      <species id="${escapeXmlAttr(s.id)}"${s.name ? ` name="${escapeXmlAttr(s.name)}"` : ""} compartment="${escapeXmlAttr(compId)}"${initAttr} boundaryCondition="${s.boundaryCondition}" constant="${s.constant}" hasOnlySubstanceUnits="${s.hasOnlySubstanceUnits}"/>`,
      );
    }
    lines.push(`    </listOfSpecies>`);
  }

  // Parameters
  if (mod.parameters.size > 0) {
    lines.push(`    <listOfParameters>`);
    for (const p of mod.parameters.values()) {
      lines.push(
        `      <parameter id="${escapeXmlAttr(p.id)}"${p.name ? ` name="${escapeXmlAttr(p.name)}"` : ""} value="${p.value}" constant="${p.constant}"/>`,
      );
    }
    lines.push(`    </listOfParameters>`);
  }

  // Rules
  const sbmlRules = mod.rules.filter((r) => r.type === "rate" || r.type === "assignment");
  if (sbmlRules.length > 0) {
    lines.push(`    <listOfRules>`);
    for (const r of sbmlRules) {
      const tag = r.type === "rate" ? "rateRule" : "assignmentRule";
      lines.push(`      <${tag} variable="${escapeXmlAttr(r.variable)}" formula="${escapeXmlAttr(r.formula)}"/>`);
    }
    lines.push(`    </listOfRules>`);
  }

  // Reactions
  if (mod.reactions.size > 0) {
    lines.push(`    <listOfReactions>`);
    for (const r of mod.reactions.values()) {
      lines.push(
        `      <reaction id="${escapeXmlAttr(r.id)}"${r.name ? ` name="${escapeXmlAttr(r.name)}"` : ""} reversible="${r.reversible}" fast="false">`,
      );
      if (r.reactants.length > 0) {
        lines.push(`        <listOfReactants>`);
        for (const ref of r.reactants) {
          lines.push(
            `          <speciesReference species="${escapeXmlAttr(ref.species)}" stoichiometry="${ref.stoichiometry}" constant="true"/>`,
          );
        }
        lines.push(`        </listOfReactants>`);
      }
      if (r.products.length > 0) {
        lines.push(`        <listOfProducts>`);
        for (const ref of r.products) {
          lines.push(
            `          <speciesReference species="${escapeXmlAttr(ref.species)}" stoichiometry="${ref.stoichiometry}" constant="true"/>`,
          );
        }
        lines.push(`        </listOfProducts>`);
      }
      if (r.rateLaw && r.rateLaw.trim().length > 0) {
        lines.push(`        <kineticLaw>`);
        lines.push(`          <formula>${escapeXmlAttr(r.rateLaw)}</formula>`);
        lines.push(`        </kineticLaw>`);
      }
      lines.push(`      </reaction>`);
    }
    lines.push(`    </listOfReactions>`);
  }

  // Events
  if (mod.events.length > 0) {
    lines.push(`    <listOfEvents>`);
    for (const ev of mod.events) {
      lines.push(`      <event id="${escapeXmlAttr(ev.id)}"${ev.name ? ` name="${escapeXmlAttr(ev.name)}"` : ""}>`);
      lines.push(`        <trigger formula="${escapeXmlAttr(ev.trigger)}"/>`);
      if (ev.assignments.length > 0) {
        lines.push(`        <listOfEventAssignments>`);
        for (const a of ev.assignments) {
          lines.push(
            `          <eventAssignment variable="${escapeXmlAttr(a.variable)}" formula="${escapeXmlAttr(a.formula)}"/>`,
          );
        }
        lines.push(`        </listOfEventAssignments>`);
      }
      lines.push(`      </event>`);
    }
    lines.push(`    </listOfEvents>`);
  }

  lines.push(`  </model>`);
  lines.push(`</sbml>`);

  return lines.join("\n");
}

export const antimonyToSbml = antimonyToSbmlXml;
