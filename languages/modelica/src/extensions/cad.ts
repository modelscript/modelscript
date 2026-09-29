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
      const varName = arena.getVarName(i);
      const prefix = `${varName}.`;
      const bindings: { property: string; variable: string; value?: number }[] = [];

      for (let j = 0; j < arena.varCount; j++) {
        if (arena.isVarRemoved(j)) continue;
        const subName = arena.getVarName(j);
        if (subName.startsWith(prefix)) {
          const prop = subName.slice(prefix.length);
          bindings.push({
            property: prop,
            variable: subName,
            value: arena.getVarStartValue(j),
          });
        }
      }

      data.push({
        name: varName,
        cad,
        dynamicBindings: bindings,
      });
    }
  }
  return data;
}
