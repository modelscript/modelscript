// SPDX-License-Identifier: AGPL-3.0-or-later

export interface ModelicaCadComponent {
  name: string;
  cad: string;
  dynamicBindings: any[];
}

/**
 * Extracts CAD components from a Modelica model using linear memory arena flattening.
 */
export function extractModelicaCadComponents(
  sharedContext: any,
  targetClassName: string,
  targetSymbolId?: number,
  uri?: string,
): ModelicaCadComponent[] {
  if (!sharedContext || !targetClassName) return [];

  const arena = sharedContext.flattenArena(targetClassName, targetSymbolId, uri);
  if (!arena) return [];

  const data: ModelicaCadComponent[] = [];
  for (let i = 0; i < arena.varCount; i++) {
    if (arena.isVarRemoved(i)) continue;
    const cad = arena.getVarCadAnnotation(i);
    if (cad) {
      data.push({
        name: arena.getVarName(i),
        cad: cad,
        dynamicBindings: [],
      });
    }
  }
  return data;
}
