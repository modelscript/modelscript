// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Dotted component path splitting and scalarized array subscript matching utilities.
 */

/**
 * Splits a dotted component path into top-level segments while keeping dots inside
 * array subscript brackets (`[...]`) intact.
 */
export function splitPath(path: string): string[] {
  const parts: string[] = [];
  let bracketDepth = 0;
  let last = 0;
  for (let i = 0; i < path.length; i++) {
    const ch = path[i];
    if (ch === "[") bracketDepth++;
    else if (ch === "]") bracketDepth--;
    else if (ch === "." && bracketDepth === 0) {
      parts.push(path.substring(last, i));
      last = i + 1;
    }
  }
  parts.push(path.substring(last));
  return parts;
}

/**
 * Matches a potentially subscripted scalarized variable path `vn` (e.g., `a[1].b[2]`)
 * against an unsubscripted base path `baseName` (e.g., `a.b`), extracting the 1-based
 * subscript indices across all dimensions.
 */
export function matchVarPath(vn: string, baseName: string, labelMaps?: Map<string, number>[]): number[] | null {
  const baseParts = splitPath(baseName);
  const vnParts = splitPath(vn);
  if (vnParts.length !== baseParts.length) return null;
  const indices: number[] = [];
  for (let i = 0; i < baseParts.length; i++) {
    const bp = baseParts[i]!;
    const vp = vnParts[i]!;
    if (bp === vp) continue;
    const prefix = `${bp}[`;
    if (vp.startsWith(prefix) && vp.endsWith("]")) {
      const idxStrs = vp.slice(prefix.length, -1).split(",");
      for (let subIdx = 0; subIdx < idxStrs.length; subIdx++) {
        const s = idxStrs[subIdx]!.trim();
        const dim = indices.length;
        if (/^\d+$/.test(s)) {
          indices.push(parseInt(s, 10));
        } else if (labelMaps) {
          if (!labelMaps[dim]) labelMaps[dim] = new Map<string, number>();
          let mapped = labelMaps[dim]!.get(s);
          if (mapped === undefined) {
            mapped = labelMaps[dim]!.size + 1;
            labelMaps[dim]!.set(s, mapped);
          }
          indices.push(mapped);
        } else {
          return null;
        }
      }
    } else {
      return null;
    }
  }
  return indices;
}
