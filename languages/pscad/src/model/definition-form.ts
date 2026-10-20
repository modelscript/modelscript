// SPDX-License-Identifier: AGPL-3.0-or-later

import { attr, buildProjectModel, childrenNamed, type ModelDefinition } from "./pscad-model.js";
import { registeredExternalDefinitions } from "./workspace-registry.js";

/** One parameter of a user definition's `<form>` (what PSCAD shows in the component dialog). */
export interface FormParameter {
  name: string;
  /** Human label (`desc`), falls back to the name. */
  label: string;
  /** PSCAD declared type: `Real`, `Integer`, `Literal`, `Boolean`, ... */
  type: string;
  /** `Constant` (fixed at compile time) or `Variable` (may be animated/changed at run time). */
  contentType: string;
  unit: string;
  min: number | undefined;
  max: number | undefined;
  defaultValue: string;
  /** Raw `cond` expression: when false the parameter is disabled in the dialog. */
  cond: string;
  /** Raw `vis` expression: when false the parameter is hidden. */
  vis: string;
  help: string;
}

export interface FormCategory {
  name: string;
  visible: boolean;
  parameters: FormParameter[];
}

export interface DefinitionForm {
  title: string;
  categories: FormCategory[];
}

const bound = (s: string | undefined): number | undefined => {
  if (s === undefined || s === "") return undefined;
  const n = Number(s);
  // PSCAD encodes "unbounded" as +/-1E+308.
  return Number.isFinite(n) && Math.abs(n) < 1e300 ? n : undefined;
};

function cdataOrText(el: { cdata: { text: string }[]; text: string } | undefined): string {
  if (!el) return "";
  return el.cdata.length > 0 ? el.cdata.map((c) => c.text).join("") : el.text;
}

export function readDefinitionForm(def: ModelDefinition): DefinitionForm | undefined {
  const form = childrenNamed(def.element, "form")[0];
  if (!form) return undefined;
  const categories: FormCategory[] = [];
  for (const cat of childrenNamed(form, "category")) {
    const parameters: FormParameter[] = [];
    for (const p of childrenNamed(cat, "parameter")) {
      const name = attr(p, "name") ?? "";
      if (!name) continue;
      parameters.push({
        name,
        label: attr(p, "desc")?.trim() || name,
        type: attr(p, "type") ?? "Real",
        contentType: attr(p, "content_type") ?? "Constant",
        unit: attr(p, "unit") ?? "",
        min: bound(attr(p, "min")),
        max: bound(attr(p, "max")),
        defaultValue: cdataOrText(childrenNamed(p, "value")[0]),
        cond: cdataOrText(childrenNamed(p, "cond")[0]),
        vis: cdataOrText(childrenNamed(p, "vis")[0]),
        help: cdataOrText(childrenNamed(p, "help")[0]),
      });
    }
    categories.push({
      name: attr(cat, "name") ?? "Configuration",
      visible: attr(cat, "visible") !== "false",
      parameters,
    });
  }
  return { title: attr(form, "name") ?? def.name, categories };
}

/**
 * Finds the `<form>` of a user definition referenced from `documentText`
 * (`definitionName` like `DC_EMT_lib:AC_Grid_Eq` or a local `Main`), consulting indexed
 * workspace libraries for cross-file definitions.
 */
export function getUserDefinitionForm(documentText: string, definitionName: string): DefinitionForm | undefined {
  const colon = definitionName.indexOf(":");
  const lib = colon >= 0 ? definitionName.slice(0, colon) : "";
  const name = colon >= 0 ? definitionName.slice(colon + 1) : definitionName;
  if (lib === "master") return undefined;
  const external = registeredExternalDefinitions();
  let model;
  try {
    model = buildProjectModel(documentText, external);
  } catch {
    return undefined;
  }
  const def =
    lib === "" || lib === model.name
      ? model.definitions.get(name)
      : (external?.(lib, name) ?? model.definitions.get(name));
  return def ? readDefinitionForm(def) : undefined;
}
