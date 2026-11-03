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
  // Extract package/class name from `package <Name>`, `operator record <Name>`, etc.
  const nameMatch = content.match(
    /^\s*(?:within\s+[^;]*;\s*)?(?:encapsulated\s+|partial\s+)?(?:package|operator\s+record|record|model|class|block|connector|type|function)\s+(\w+)/m,
  );
  const name = nameMatch?.[1] ?? null;

  // Extract description string: package/record Name "Some description"
  const descMatch = content.match(
    /^\s*(?:within\s+[^;]*;\s*)?(?:encapsulated\s+|partial\s+)?(?:package|operator\s+record|record|model|class|block|connector|type|function)\s+\w+\s+"([^"]*)"/m,
  );
  const description = descMatch?.[1] ?? null;

  // Extract version from annotation(...) — handles various whitespace patterns and positions
  const versionMatch = content.match(/\bversion\s*=\s*"([^"]+)"/);
  const version = versionMatch?.[1] ?? null;

  return { name, description, version };
}
