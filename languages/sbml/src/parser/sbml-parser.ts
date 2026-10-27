// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sbml — Zero-Regex SBML Level 2 & Level 3 Core Parser and Serializer.
 *
 * Uses @modelscript/dsl/xml to parse SBML models, compartments, species, parameters,
 * reactions, stoichiometry, and MathML / infix kinetic laws.
 */

import { parseXml, type XmlElement } from "@modelscript/dsl/xml";
import type {
  SbmlCompartment,
  SbmlDocument,
  SbmlKineticLaw,
  SbmlModel,
  SbmlParameter,
  SbmlRange,
  SbmlReaction,
  SbmlSpecies,
  SbmlSpeciesReference,
} from "../types.js";

function getAttr(elem: XmlElement, name: string): string | undefined {
  const a = elem.attributes.find((attr) => attr.name.toLowerCase() === name.toLowerCase());
  return a?.value;
}

function getNumAttr(elem: XmlElement, name: string, defaultValue?: number): number | undefined {
  const val = getAttr(elem, name);
  if (val === undefined) return defaultValue;
  const num = parseFloat(val);
  return isNaN(num) ? defaultValue : num;
}

function getBoolAttr(elem: XmlElement, name: string, defaultValue = false): boolean {
  const val = getAttr(elem, name)?.toLowerCase();
  if (val === "true" || val === "1") return true;
  if (val === "false" || val === "0") return false;
  return defaultValue;
}

function findChild(elem: XmlElement, name: string): XmlElement | undefined {
  return elem.children.find((c) => c.name.toLowerCase() === name.toLowerCase());
}

function findChildren(elem: XmlElement, name: string): XmlElement[] {
  return elem.children.filter((c) => c.name.toLowerCase() === name.toLowerCase());
}

function computeRange(source: string, elem: XmlElement): SbmlRange {
  let line = 1;
  let col = 1;
  let startLine = 1;
  let startCol = 1;
  let endLine = 1;
  let endCol = 1;

  const start = elem.start;
  const end = elem.end;

  for (let i = 0; i < source.length; i++) {
    if (i === start) {
      startLine = line;
      startCol = col;
    }
    if (i === end) {
      endLine = line;
      endCol = col;
      break;
    }
    if (source[i] === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
  }

  return {
    startLine,
    startColumn: startCol,
    endLine: endLine >= startLine ? endLine : startLine,
    endColumn: endCol,
    startOffset: start,
    endOffset: end,
  };
}

/**
 * Converts MathML XML AST into standard mathematical infix expression.
 */
function mathMlToInfix(elem: XmlElement): string {
  const name = elem.name.toLowerCase();

  if (name === "math") {
    if (elem.children.length === 0) return elem.text?.trim() ?? "";
    return elem.children.map(mathMlToInfix).join(" ");
  }

  if (name === "ci" || name === "cn") {
    return elem.text?.trim() ?? "";
  }

  if (name === "apply") {
    const opElem = elem.children[0];
    if (!opElem) return "";
    const op = opElem.name.toLowerCase();
    const args = elem.children.slice(1).map(mathMlToInfix);

    switch (op) {
      case "plus":
        return args.length > 0 ? `(${args.join(" + ")})` : "0";
      case "times":
        return args.length > 0 ? `(${args.join(" * ")})` : "1";
      case "minus":
        if (args.length === 1) return `(-${args[0]})`;
        return args.length === 2 ? `(${args[0]} - ${args[1]})` : `(${args.join(" - ")})`;
      case "divide":
        return args.length === 2 ? `(${args[0]} / ${args[1]})` : args.join(" / ");
      case "power":
        return args.length === 2 ? `(${args[0]} ^ ${args[1]})` : args.join(" ^ ");
      case "root":
        return `sqrt(${args[0] ?? ""})`;
      case "exp":
        return `exp(${args[0] ?? ""})`;
      case "ln":
        return `log(${args[0] ?? ""})`;
      default:
        return `${op}(${args.join(", ")})`;
    }
  }

  if (elem.children.length > 0) {
    return elem.children.map(mathMlToInfix).join(" ");
  }

  return elem.text?.trim() ?? "";
}

export function parseSbml(source: string, filename?: string): SbmlDocument {
  const doc = parseXml(source);
  const root = doc.root;

  if (!root || (root.name.toLowerCase() !== "sbml" && root.name.toLowerCase() !== "model")) {
    throw new Error("Invalid SBML: root element must be <sbml> or <model>");
  }

  const level = getNumAttr(root, "level", 2) ?? 2;
  const version = getNumAttr(root, "version", 4) ?? 4;

  const modelElem = root.name.toLowerCase() === "model" ? root : findChild(root, "model");
  if (!modelElem) {
    throw new Error("Invalid SBML: missing <model> element");
  }

  const modelId = getAttr(modelElem, "id") ?? "";
  const modelName = getAttr(modelElem, "name");
  const modelRange = computeRange(source, modelElem);

  const compartments = new Map<string, SbmlCompartment>();
  const species = new Map<string, SbmlSpecies>();
  const parameters = new Map<string, SbmlParameter>();
  const reactions = new Map<string, SbmlReaction>();

  // 1. Compartments
  const listOfCompartments = findChild(modelElem, "listOfCompartments");
  if (listOfCompartments) {
    for (const cElem of findChildren(listOfCompartments, "compartment")) {
      const cId = getAttr(cElem, "id");
      if (cId) {
        compartments.set(cId, {
          id: cId,
          name: getAttr(cElem, "name"),
          spatialDimensions: getNumAttr(cElem, "spatialDimensions", 3) ?? 3,
          size: getNumAttr(cElem, "size", 1.0) ?? 1.0,
          units: getAttr(cElem, "units"),
          constant: getBoolAttr(cElem, "constant", true),
          range: computeRange(source, cElem),
        });
      }
    }
  }

  // 2. Species
  const listOfSpecies = findChild(modelElem, "listOfSpecies");
  if (listOfSpecies) {
    for (const sElem of findChildren(listOfSpecies, "species")) {
      const sId = getAttr(sElem, "id");
      if (sId) {
        species.set(sId, {
          id: sId,
          name: getAttr(sElem, "name"),
          compartment: getAttr(sElem, "compartment") ?? "",
          initialAmount: getNumAttr(sElem, "initialAmount"),
          initialConcentration: getNumAttr(sElem, "initialConcentration"),
          substanceUnits: getAttr(sElem, "substanceUnits"),
          hasOnlySubstanceUnits: getBoolAttr(sElem, "hasOnlySubstanceUnits", false),
          boundaryCondition: getBoolAttr(sElem, "boundaryCondition", false),
          constant: getBoolAttr(sElem, "constant", false),
          range: computeRange(source, sElem),
        });
      }
    }
  }

  // 3. Global Parameters
  const listOfParameters = findChild(modelElem, "listOfParameters");
  if (listOfParameters) {
    for (const pElem of findChildren(listOfParameters, "parameter")) {
      const pId = getAttr(pElem, "id");
      if (pId) {
        parameters.set(pId, {
          id: pId,
          name: getAttr(pElem, "name"),
          value: getNumAttr(pElem, "value", 0.0) ?? 0.0,
          units: getAttr(pElem, "units"),
          constant: getBoolAttr(pElem, "constant", true),
          range: computeRange(source, pElem),
        });
      }
    }
  }

  // 4. Reactions
  const listOfReactions = findChild(modelElem, "listOfReactions");
  if (listOfReactions) {
    for (const rElem of findChildren(listOfReactions, "reaction")) {
      const rId = getAttr(rElem, "id");
      if (rId) {
        const reactants: SbmlSpeciesReference[] = [];
        const products: SbmlSpeciesReference[] = [];
        const modifiers: SbmlSpeciesReference[] = [];

        // Reactants
        const listOfReactants = findChild(rElem, "listOfReactants");
        if (listOfReactants) {
          for (const refElem of findChildren(listOfReactants, "speciesReference")) {
            const specId = getAttr(refElem, "species");
            if (specId) {
              reactants.push({
                species: specId,
                stoichiometry: getNumAttr(refElem, "stoichiometry", 1.0) ?? 1.0,
                constant: getBoolAttr(refElem, "constant", true),
                range: computeRange(source, refElem),
              });
            }
          }
        }

        // Products
        const listOfProducts = findChild(rElem, "listOfProducts");
        if (listOfProducts) {
          for (const refElem of findChildren(listOfProducts, "speciesReference")) {
            const specId = getAttr(refElem, "species");
            if (specId) {
              products.push({
                species: specId,
                stoichiometry: getNumAttr(refElem, "stoichiometry", 1.0) ?? 1.0,
                constant: getBoolAttr(refElem, "constant", true),
                range: computeRange(source, refElem),
              });
            }
          }
        }

        // Modifiers
        const listOfModifiers = findChild(rElem, "listOfModifiers");
        if (listOfModifiers) {
          for (const modElem of findChildren(listOfModifiers, "modifierSpeciesReference")) {
            const specId = getAttr(modElem, "species");
            if (specId) {
              modifiers.push({
                species: specId,
                stoichiometry: 1.0,
                constant: true,
                range: computeRange(source, modElem),
              });
            }
          }
        }

        // Kinetic Law
        let kineticLaw: SbmlKineticLaw | undefined;
        const klElem = findChild(rElem, "kineticLaw");
        if (klElem) {
          const localParams = new Map<string, SbmlParameter>();
          const listOfLocalParams = findChild(klElem, "listOfParameters") ?? findChild(klElem, "listOfLocalParameters");
          if (listOfLocalParams) {
            for (const lpElem of findChildren(listOfLocalParams, "parameter") ||
              findChildren(listOfLocalParams, "localParameter")) {
              const lpId = getAttr(lpElem, "id");
              if (lpId) {
                localParams.set(lpId, {
                  id: lpId,
                  name: getAttr(lpElem, "name"),
                  value: getNumAttr(lpElem, "value", 0.0) ?? 0.0,
                  units: getAttr(lpElem, "units"),
                  constant: getBoolAttr(lpElem, "constant", true),
                  range: computeRange(source, lpElem),
                });
              }
            }
          }

          let formula = "";
          const formulaElem = findChild(klElem, "formula");
          if (formulaElem && formulaElem.text) {
            formula = formulaElem.text.trim();
          } else {
            const mathElem = findChild(klElem, "math");
            if (mathElem) {
              formula = mathMlToInfix(mathElem);
            }
          }

          kineticLaw = {
            formula,
            parameters: localParams,
            range: computeRange(source, klElem),
          };
        }

        reactions.set(rId, {
          id: rId,
          name: getAttr(rElem, "name"),
          reversible: getBoolAttr(rElem, "reversible", true),
          fast: getBoolAttr(rElem, "fast", false),
          compartment: getAttr(rElem, "compartment"),
          reactants,
          products,
          modifiers,
          kineticLaw,
          range: computeRange(source, rElem),
        });
      }
    }
  }

  const model: SbmlModel = {
    id: modelId,
    name: modelName,
    level,
    version,
    compartments,
    species,
    parameters,
    reactions,
    range: modelRange,
  };

  return {
    level,
    version,
    model,
    sourceFile: filename,
  };
}

export function serializeSbml(doc: SbmlDocument): string {
  const m = doc.model;
  const lines: string[] = [];

  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(
    `<sbml xmlns="http://www.sbml.org/sbml/level${doc.level}/version${doc.version}" level="${doc.level}" version="${doc.version}">`,
  );
  lines.push(`  <model id="${m.id}"${m.name ? ` name="${m.name}"` : ""}>`);

  // Compartments
  if (m.compartments.size > 0) {
    lines.push(`    <listOfCompartments>`);
    for (const c of m.compartments.values()) {
      lines.push(
        `      <compartment id="${c.id}" size="${c.size}" spatialDimensions="${c.spatialDimensions}" constant="${c.constant}"${c.units ? ` units="${c.units}"` : ""}/>`,
      );
    }
    lines.push(`    </listOfCompartments>`);
  }

  // Species
  if (m.species.size > 0) {
    lines.push(`    <listOfSpecies>`);
    for (const s of m.species.values()) {
      const initAttr =
        s.initialConcentration !== undefined
          ? ` initialConcentration="${s.initialConcentration}"`
          : s.initialAmount !== undefined
            ? ` initialAmount="${s.initialAmount}"`
            : "";
      lines.push(
        `      <species id="${s.id}" compartment="${s.compartment}"${initAttr} constant="${s.constant}" boundaryCondition="${s.boundaryCondition}" hasOnlySubstanceUnits="${s.hasOnlySubstanceUnits}"/>`,
      );
    }
    lines.push(`    </listOfSpecies>`);
  }

  // Parameters
  if (m.parameters.size > 0) {
    lines.push(`    <listOfParameters>`);
    for (const p of m.parameters.values()) {
      lines.push(
        `      <parameter id="${p.id}" value="${p.value}" constant="${p.constant}"${p.units ? ` units="${p.units}"` : ""}/>`,
      );
    }
    lines.push(`    </listOfParameters>`);
  }

  // Reactions
  if (m.reactions.size > 0) {
    lines.push(`    <listOfReactions>`);
    for (const r of m.reactions.values()) {
      lines.push(`      <reaction id="${r.id}" reversible="${r.reversible}" fast="${r.fast}">`);
      if (r.reactants.length > 0) {
        lines.push(`        <listOfReactants>`);
        for (const ref of r.reactants) {
          lines.push(`          <speciesReference species="${ref.species}" stoichiometry="${ref.stoichiometry}"/>`);
        }
        lines.push(`        </listOfReactants>`);
      }
      if (r.products.length > 0) {
        lines.push(`        <listOfProducts>`);
        for (const ref of r.products) {
          lines.push(`          <speciesReference species="${ref.species}" stoichiometry="${ref.stoichiometry}"/>`);
        }
        lines.push(`        </listOfProducts>`);
      }
      if (r.modifiers.length > 0) {
        lines.push(`        <listOfModifiers>`);
        for (const mod of r.modifiers) {
          lines.push(`          <modifierSpeciesReference species="${mod.species}"/>`);
        }
        lines.push(`        </listOfModifiers>`);
      }
      if (r.kineticLaw) {
        lines.push(`        <kineticLaw>`);
        lines.push(`          <formula>${r.kineticLaw.formula}</formula>`);
        if (r.kineticLaw.parameters.size > 0) {
          lines.push(`          <listOfParameters>`);
          for (const lp of r.kineticLaw.parameters.values()) {
            lines.push(`            <parameter id="${lp.id}" value="${lp.value}"/>`);
          }
          lines.push(`          </listOfParameters>`);
        }
        lines.push(`        </kineticLaw>`);
      }
      lines.push(`      </reaction>`);
    }
    lines.push(`    </listOfReactions>`);
  }

  lines.push(`  </model>`);
  lines.push(`</sbml>`);

  return lines.join("\n");
}
