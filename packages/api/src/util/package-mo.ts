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
  version: string | null;
} {
  // Extract package name from `package <Name>` declaration
  const nameMatch = content.match(/^\s*(?:within\s+[^;]*;\s*)?package\s+(\w+)/m);
  const name = nameMatch?.[1] ?? null;

  // Extract version from annotation(version="...") — handles various whitespace patterns
  const versionMatch = content.match(/annotation\s*\(\s*version\s*=\s*"([^"]+)"/);
  const version = versionMatch?.[1] ?? null;

  return { name, version };
}
