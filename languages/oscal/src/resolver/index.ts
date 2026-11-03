// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/oscal — NIST OSCAL Profile Resolution Pipeline.
 *
 * Implements the 3-phase NIST OSCAL Profile Resolution specification:
 * 1. Import: Control selection (`include-all`, `include-controls`, `exclude-controls`)
 * 2. Merge: Combining and flattening controls (`use-first`, `merge`, `keep`)
 * 3. Modify: Applying `set-parameter` overrides, `alter` additions/removals, and
 *    substituting `{{ insert: param, <id> }}` placeholders in control prose.
 */

import {
  NIST_800_53_REV5_CATALOG,
  getAllBuiltInControls,
  getBuiltInControl,
  resolveBuiltInProfileHref,
} from "../catalogs/index.js";
import type {
  OscalControl,
  OscalDocument,
  OscalGroup,
  OscalPart,
  OscalResolvedCatalog,
  OscalResolvedControl,
} from "../types.js";

const PARAM_INSERT_REGEX = /\{\{\s*insert:\s*param\s*,\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

function clonePart(part: OscalPart): OscalPart {
  return {
    ...part,
    props: part.props ? part.props.map((p) => ({ ...p })) : undefined,
    parts: part.parts ? part.parts.map(clonePart) : undefined,
  };
}

function cloneControl(ctrl: OscalControl): OscalControl {
  return {
    ...ctrl,
    params: ctrl.params
      ? ctrl.params.map((p) => ({
          ...p,
          values: p.values ? [...p.values] : undefined,
          guidelines: p.guidelines ? [...p.guidelines] : undefined,
        }))
      : undefined,
    props: ctrl.props ? ctrl.props.map((p) => ({ ...p })) : undefined,
    links: ctrl.links ? ctrl.links.map((l) => ({ ...l })) : undefined,
    parts: ctrl.parts ? ctrl.parts.map(clonePart) : undefined,
    controls: ctrl.controls ? ctrl.controls.map(cloneControl) : undefined,
  };
}

function collectCatalogControls(doc: OscalDocument, out: Map<string, OscalControl>): void {
  const visit = (controls: OscalControl[]) => {
    for (const c of controls) {
      out.set(c.id.toLowerCase(), c);
      if (c.controls) visit(c.controls);
    }
  };
  if (doc.controls) visit(doc.controls);
  if (doc.groups) {
    const visitGroups = (groups: OscalGroup[]) => {
      for (const g of groups) {
        if (g.controls) visit(g.controls);
        if (g.groups) visitGroups(g.groups);
      }
    };
    visitGroups(doc.groups);
  }
}

export function extractReferencedParamIds(prose: string): string[] {
  const ids: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(PARAM_INSERT_REGEX.source, "g");
  while ((match = re.exec(prose)) !== null) {
    const id = match[1];
    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids;
}

export function substituteProseString(
  prose: string,
  paramValues: Record<string, string>,
): { text: string; unresolved: string[] } {
  const unresolved: string[] = [];
  const text = prose.replace(PARAM_INSERT_REGEX, (fullMatch, rawParamId: string) => {
    const val = paramValues[rawParamId] ?? paramValues[rawParamId.toLowerCase()];
    if (val !== undefined && val !== "") {
      return val;
    }
    if (!unresolved.includes(rawParamId)) {
      unresolved.push(rawParamId);
    }
    return fullMatch;
  });
  return { text, unresolved };
}

export function substituteControlProse(
  control: OscalControl,
  paramOverrides?: Record<string, string>,
): {
  prose: string;
  resolvedParameters: Record<string, string>;
  unresolvedParameters: string[];
} {
  const resolvedParameters: Record<string, string> = {};
  const unresolvedParameters: string[] = [];

  if (control.params) {
    for (const p of control.params) {
      const overrideVal = paramOverrides?.[p.id] ?? paramOverrides?.[p.id.toLowerCase()];
      if (overrideVal !== undefined && overrideVal !== "") {
        resolvedParameters[p.id] = overrideVal;
      } else if (p.values && p.values.length > 0 && p.values[0] !== "") {
        resolvedParameters[p.id] = p.values.join(", ");
      } else {
        unresolvedParameters.push(p.id);
      }
    }
  }

  if (paramOverrides) {
    for (const [k, v] of Object.entries(paramOverrides)) {
      if (v !== "") {
        resolvedParameters[k] = v;
      }
    }
  }

  const proseSegments: string[] = [];
  const visitParts = (parts: OscalPart[]) => {
    for (const pt of parts) {
      if (pt.prose) {
        const sub = substituteProseString(pt.prose, resolvedParameters);
        proseSegments.push(sub.text);
        for (const u of sub.unresolved) {
          if (!unresolvedParameters.includes(u)) {
            unresolvedParameters.push(u);
          }
        }
      }
      if (pt.parts) {
        visitParts(pt.parts);
      }
    }
  };

  if (control.parts) {
    visitParts(control.parts);
  }

  return {
    prose: proseSegments.join("\n\n"),
    resolvedParameters,
    unresolvedParameters,
  };
}

/**
 * Resolves an OSCAL Profile (or Catalog / SSP) into a flattened `OscalResolvedCatalog`
 * with parameter values substituted and control alterations applied.
 */
export function resolveOscalProfile(profileDoc: OscalDocument, catalogs?: OscalDocument[]): OscalResolvedCatalog {
  const availableControls = new Map<string, OscalControl>();

  // 1. Seed with built-in NIST SP 800-53 Rev 5 / 800-82 Rev 3 controls
  for (const builtIn of getAllBuiltInControls()) {
    availableControls.set(builtIn.id.toLowerCase(), builtIn);
  }

  // 2. Overlay any user-supplied catalogs
  if (catalogs) {
    for (const cat of catalogs) {
      collectCatalogControls(cat, availableControls);
    }
  }

  // If the input document is itself a catalog, index its own controls
  if (profileDoc.kind === "catalog") {
    collectCatalogControls(profileDoc, availableControls);
  }

  const unresolvedControlIds: string[] = [];
  const selectedControls: OscalControl[] = [];

  // Phase 1: Import Selection
  if (profileDoc.kind === "catalog") {
    for (const c of availableControls.values()) {
      selectedControls.push(cloneControl(c));
    }
  } else if (profileDoc.imports && profileDoc.imports.length > 0) {
    for (const imp of profileDoc.imports) {
      const excluded = new Set((imp.excludeControls ?? []).map((id) => id.toLowerCase()));

      if (imp.includeControls && imp.includeControls.length > 0) {
        for (const rawId of imp.includeControls) {
          const normId = rawId.toLowerCase();
          if (excluded.has(normId)) continue;
          const found = availableControls.get(normId) ?? getBuiltInControl(normId);
          if (found) {
            selectedControls.push(cloneControl(found));
          } else {
            unresolvedControlIds.push(rawId);
          }
        }
      } else if (imp.includeAll) {
        for (const [id, ctrl] of availableControls.entries()) {
          if (!excluded.has(id)) {
            selectedControls.push(cloneControl(ctrl));
          }
        }
      } else {
        const builtInHref = resolveBuiltInProfileHref(imp.href);
        if (builtInHref.requiredControlIds.length > 0) {
          for (const reqId of builtInHref.requiredControlIds) {
            if (excluded.has(reqId.toLowerCase())) continue;
            const found = availableControls.get(reqId.toLowerCase());
            if (found) {
              selectedControls.push(cloneControl(found));
            }
          }
        } else {
          for (const [id, ctrl] of availableControls.entries()) {
            if (!excluded.has(id)) {
              selectedControls.push(cloneControl(ctrl));
            }
          }
        }
      }
    }
  } else if (profileDoc.kind === "system-security-plan") {
    const href = profileDoc.importProfile?.href ?? "";
    const resolvedHref = resolveBuiltInProfileHref(href);
    const ids = new Set<string>(resolvedHref.requiredControlIds.map((id) => id.toLowerCase()));
    if (profileDoc.controlImplementation?.implementedRequirements) {
      for (const ir of profileDoc.controlImplementation.implementedRequirements) {
        ids.add(ir.controlId.toLowerCase());
      }
    }
    for (const id of ids) {
      const found = availableControls.get(id);
      if (found) {
        selectedControls.push(cloneControl(found));
      } else {
        unresolvedControlIds.push(id);
      }
    }
  }

  // Phase 2: Merge / Combine
  const combineMethod = profileDoc.merge?.combine?.method ?? "merge";
  const mergedMap = new Map<string, OscalControl>();
  const keptControls: OscalControl[] = [];

  for (const ctrl of selectedControls) {
    const key = ctrl.id.toLowerCase();
    if (combineMethod === "keep") {
      keptControls.push(ctrl);
      continue;
    }
    const existing = mergedMap.get(key);
    if (!existing) {
      mergedMap.set(key, ctrl);
    } else if (combineMethod === "use-first") {
      // Keep existing unchanged
    } else {
      // "merge": combine parts and params
      if (ctrl.parts) {
        existing.parts = [...(existing.parts ?? []), ...ctrl.parts];
      }
      if (ctrl.params) {
        const existingParamIds = new Set((existing.params ?? []).map((p) => p.id));
        for (const p of ctrl.params) {
          if (!existingParamIds.has(p.id)) {
            existing.params = [...(existing.params ?? []), p];
          }
        }
      }
    }
  }

  const workingControls = combineMethod === "keep" ? keptControls : Array.from(mergedMap.values());

  // Phase 3: Modify (set-parameter & alter)
  const parameterValues: Record<string, string> = {};

  // Seed default parameter values from controls
  for (const ctrl of workingControls) {
    if (ctrl.params) {
      for (const p of ctrl.params) {
        if (p.values && p.values.length > 0 && p.values[0] !== undefined) {
          parameterValues[p.id] = p.values.join(", ");
        }
      }
    }
  }

  // Apply profile modify.setParameters
  if (profileDoc.modify?.setParameters) {
    for (const sp of profileDoc.modify.setParameters) {
      if (sp.values.length > 0) {
        const joined = sp.values.join(", ");
        parameterValues[sp.paramId] = joined;
      }
    }
  }

  // Apply SSP controlImplementation.setParameters if present
  if (profileDoc.controlImplementation?.setParameters) {
    for (const sp of profileDoc.controlImplementation.setParameters) {
      if (sp.values.length > 0) {
        parameterValues[sp.paramId] = sp.values.join(", ");
      }
    }
  }
  if (profileDoc.controlImplementation?.implementedRequirements) {
    for (const ir of profileDoc.controlImplementation.implementedRequirements) {
      if (ir.setParameters) {
        for (const sp of ir.setParameters) {
          if (sp.values.length > 0) {
            parameterValues[sp.paramId] = sp.values.join(", ");
          }
        }
      }
    }
  }

  // Apply profile modify.alters
  if (profileDoc.modify?.alters) {
    for (const alt of profileDoc.modify.alters) {
      const target = workingControls.find((c) => c.id.toLowerCase() === alt.controlId.toLowerCase());
      if (!target) continue;

      if (alt.removes && target.parts) {
        target.parts = target.parts.filter((pt) => {
          return !alt.removes!.some(
            (rem) => (rem.byName && pt.name === rem.byName) || (rem.byId && pt.id === rem.byId),
          );
        });
      }

      if (alt.adds) {
        for (const add of alt.adds) {
          if (add.props) {
            target.props = [...(target.props ?? []), ...add.props.map((p) => ({ ...p }))];
          }
          if (add.parts) {
            const clonedAdds = add.parts.map(clonePart);
            if (add.position === "starting" || add.position === "before") {
              target.parts = [...clonedAdds, ...(target.parts ?? [])];
            } else {
              target.parts = [...(target.parts ?? []), ...clonedAdds];
            }
          }
        }
      }
    }
  }

  // Substitute parameters into control parts and build OscalResolvedControl[]
  const resolvedControls: OscalResolvedControl[] = workingControls.map((ctrl) => {
    if (ctrl.params) {
      for (const p of ctrl.params) {
        const assigned = parameterValues[p.id];
        if (assigned !== undefined) {
          p.values = [assigned];
        }
      }
    }

    const subResult = substituteControlProse(ctrl, parameterValues);

    // Mutate cloned parts so their prose also reflects resolved parameter values
    const mutateParts = (parts: OscalPart[]) => {
      for (const pt of parts) {
        if (pt.prose) {
          pt.prose = substituteProseString(pt.prose, subResult.resolvedParameters).text;
        }
        if (pt.parts) mutateParts(pt.parts);
      }
    };
    if (ctrl.parts) mutateParts(ctrl.parts);

    return {
      ...ctrl,
      resolvedProse: subResult.prose,
      resolvedParameters: subResult.resolvedParameters,
      unresolvedParameters: subResult.unresolvedParameters,
    };
  });

  return {
    uuid: profileDoc.uuid || NIST_800_53_REV5_CATALOG.uuid,
    metadata: {
      ...profileDoc.metadata,
      title: `${profileDoc.metadata.title} (Resolved Profile Catalog)`,
    },
    controls: resolvedControls,
    groups: NIST_800_53_REV5_CATALOG.groups ?? [],
    parameterValues,
    unresolvedControlIds,
  };
}
