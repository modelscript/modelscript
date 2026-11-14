// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared literal-retraction helpers for Nelson-Oppen theory oracles.
 */

import type { SharedEquality } from "../theory_coordinator.js";

function getJustifications(eq: SharedEquality): readonly number[] {
  return eq.justifications ?? eq.justification ?? [];
}

/**
 * Returns true if any shared equality received by an oracle is justified by `litId`.
 */
export function hasSharedEqualityWithLiteral(sharedEqualities: readonly SharedEquality[], litId: number): boolean {
  return sharedEqualities.some((eq) => getJustifications(eq).includes(litId));
}

/**
 * Filters out shared equalities whose justification set depends on a retracted `litId`.
 */
export function retainSharedEqualitiesWithoutLiteral(
  sharedEqualities: readonly SharedEquality[],
  litId: number,
): SharedEquality[] {
  return sharedEqualities.filter((eq) => !getJustifications(eq).includes(litId));
}
