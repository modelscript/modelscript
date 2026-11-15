// SPDX-License-Identifier: AGPL-3.0-or-later

import { validateP3743Package } from "./p3743-reader.js";
import type { P3743Package } from "./types.js";

/**
 * Serializes an IEEE P3743 package to canonical formatted JSON after validation.
 */
export function serializeP3743Package(pkg: P3743Package, pretty = true): string {
  const validation = validateP3743Package(pkg);
  if (!validation.valid) {
    throw new Error(`Invalid IEEE P3743 package: ${validation.errors.join("; ")}`);
  }
  return JSON.stringify(pkg, null, pretty ? 2 : undefined);
}
