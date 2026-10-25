// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Parse a Modelica package.mo file to extract the package name and version annotation.
 *
 * Expected format:
 * ```modelica
 * package LibraryName "Optional description"
 *   annotation(version="X.Y.Z");
 * end LibraryName;
 * ```
 */
export function parsePackageMo(content: string): {
  name: string | null;
  description: string | null;
  version: string | null;
} {
  // Extract package name from `package <Name>` declaration
  const nameMatch = content.match(/^\s*(?:within\s+[^;]*;\s*)?package\s+(\w+)/m);
  const name = nameMatch?.[1] ?? null;

  // Extract description string: package Name "Some description"
  const descMatch = content.match(/^\s*(?:within\s+[^;]*;\s*)?package\s+\w+\s+"([^"]*)"/m);
  const description = descMatch?.[1] ?? null;

  // Extract version from annotation(...) — handles various whitespace patterns and positions
  const versionMatch = content.match(/\bversion\s*=\s*"([^"]+)"/);
  const version = versionMatch?.[1] ?? null;

  return { name, description, version };
}

/**
 * Parses Modelica `annotation(uses(PkgA(version="1.0.0"), PkgB(version="2.0.0")))` dependencies.
 */
export function parsePackageUses(content: string): Record<string, string> {
  const deps: Record<string, string> = {};
  const usesIdx = content.search(/\buses\s*\(/i);
  if (usesIdx === -1) return deps;

  const startIdx = content.indexOf("(", usesIdx) + 1;
  let depth = 1;
  let endIdx = startIdx;

  while (endIdx < content.length && depth > 0) {
    if (content[endIdx] === "(") depth++;
    else if (content[endIdx] === ")") depth--;
    endIdx++;
  }

  const inner = content.slice(startIdx, endIdx - 1);
  const regex = /([a-zA-Z0-9_]+)\s*\(\s*version\s*=\s*"([^"]+)"\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(inner)) !== null) {
    if (m[1] && m[2]) {
      deps[m[1]] = m[2];
    }
  }
  return deps;
}
