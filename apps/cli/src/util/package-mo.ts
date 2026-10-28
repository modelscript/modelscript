// SPDX-License-Identifier: AGPL-3.0-or-later

// SPDX-License-Identifier: AGPL-3.0-or-later

function stripModelicaComments(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

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
  const clean = stripModelicaComments(content);

  // Extract package name from `package <Name>` declaration
  const nameMatch = clean.match(/^\s*(?:within\s+[^;]*;\s*)?(?:encapsulated\s+)?package\s+([A-Za-z_][A-Za-z0-9_]*)/m);
  const name = nameMatch?.[1] ?? null;

  // Extract description string: package Name "Some description"
  const descMatch = clean.match(
    /^\s*(?:within\s+[^;]*;\s*)?(?:encapsulated\s+)?package\s+[A-Za-z_][A-Za-z0-9_]*\s+"([^"]*)"/m,
  );
  const description = descMatch?.[1] ?? null;

  // Extract version from annotation(...) — handles various whitespace patterns and positions
  const versionMatch = clean.match(/\bversion\s*=\s*"([^"]+)"/);
  const version = versionMatch?.[1] ?? null;

  return { name, description, version };
}

/**
 * Parses Modelica `annotation(uses(PkgA(version="1.0.0"), PkgB(version="2.0.0")))` dependencies.
 */
export function parsePackageUses(content: string): Record<string, string> {
  const clean = stripModelicaComments(content);
  const deps: Record<string, string> = {};
  const usesIdx = clean.search(/\buses\s*\(/i);
  if (usesIdx === -1) return deps;

  const startIdx = clean.indexOf("(", usesIdx) + 1;
  let depth = 1;
  let endIdx = startIdx;

  while (endIdx < clean.length && depth > 0) {
    if (clean[endIdx] === "(") depth++;
    else if (clean[endIdx] === ")") depth--;
    endIdx++;
  }

  const inner = clean.slice(startIdx, endIdx - 1);
  const regex = /([a-zA-Z0-9_.]+)\s*\(\s*version\s*=\s*"([^"]+)"\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(inner)) !== null) {
    if (m[1] && m[2]) {
      deps[m[1]] = m[2];
    }
  }
  return deps;
}
