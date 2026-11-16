// SPDX-License-Identifier: AGPL-3.0-or-later

import { EXCITER_SCHEMAS } from "./models/exciters.js";
import { GENERATOR_SCHEMAS } from "./models/generators.js";
import { GOVERNOR_SCHEMAS } from "./models/governors.js";
import { HVDC_FACTS_SCHEMAS } from "./models/hvdc-facts.js";
import { IBR_RENEWABLE_SCHEMAS } from "./models/ibr-renewables.js";
import { LOAD_SCHEMAS } from "./models/loads.js";
import { RELAY_PROTECTION_SCHEMAS } from "./models/relays-protection.js";
import { STABILIZER_SCHEMAS } from "./models/stabilizers.js";
import type { DyrModelSchema } from "./types.js";

export * from "./types.js";
export {
  EXCITER_SCHEMAS,
  GENERATOR_SCHEMAS,
  GOVERNOR_SCHEMAS,
  HVDC_FACTS_SCHEMAS,
  IBR_RENEWABLE_SCHEMAS,
  LOAD_SCHEMAS,
  RELAY_PROTECTION_SCHEMAS,
  STABILIZER_SCHEMAS,
};

/**
 * Canonical clean-room dynamic model definitions (without alias expansions).
 */
export const CANONICAL_DYR_MODEL_SCHEMAS: Record<string, DyrModelSchema> = {
  ...GENERATOR_SCHEMAS,
  ...EXCITER_SCHEMAS,
  ...GOVERNOR_SCHEMAS,
  ...STABILIZER_SCHEMAS,
  ...IBR_RENEWABLE_SCHEMAS,
  ...LOAD_SCHEMAS,
  ...HVDC_FACTS_SCHEMAS,
  ...RELAY_PROTECTION_SCHEMAS,
};

/**
 * Expanded clean-room `DYR_MODEL_SCHEMAS` catalog mapping every standard PSS/E Model Library
 * model name (canonical + standard aliases) to its full schema, `ICON`s, `CON`s, and DAE archetype.
 */
export const DYR_MODEL_SCHEMAS: Record<string, DyrModelSchema> = {};
export const DYR_MODEL_CANONICAL_MAP: Record<string, string> = {};

for (const [key, schema] of Object.entries(CANONICAL_DYR_MODEL_SCHEMAS)) {
  const upperKey = key.toUpperCase();
  DYR_MODEL_SCHEMAS[upperKey] = schema;
  DYR_MODEL_CANONICAL_MAP[upperKey] = upperKey;
  if (schema.aliases) {
    for (const alias of schema.aliases) {
      const upperAlias = alias.toUpperCase();
      if (!DYR_MODEL_SCHEMAS[upperAlias]) {
        DYR_MODEL_SCHEMAS[upperAlias] = {
          ...schema,
          model: upperAlias,
          aliases: undefined,
        };
        DYR_MODEL_CANONICAL_MAP[upperAlias] = upperKey;
      }
    }
  }
}

/**
 * Deterministic ordered list of all schemas (1-based `schemaId = index + 1`) for WASM/SoA tables.
 */
export const DYR_SCHEMA_LIST: DyrModelSchema[] = Object.keys(DYR_MODEL_SCHEMAS)
  .sort()
  .map((k) => DYR_MODEL_SCHEMAS[k]!);

const DYR_SCHEMA_ID_BY_NAME = new Map<string, number>();
for (let i = 0; i < DYR_SCHEMA_LIST.length; i++) {
  DYR_SCHEMA_ID_BY_NAME.set(DYR_SCHEMA_LIST[i]!.model.toUpperCase(), i + 1);
}

/**
 * Resolves a `.dyr` model name (case-insensitive) to its clean-room `DyrModelSchema`.
 */
export function resolveDyrModelSchema(modelName: string): DyrModelSchema | undefined {
  return DYR_MODEL_SCHEMAS[modelName.trim().toUpperCase()];
}

/**
 * Resolves the canonical model name for aliases (e.g. `REGCA1` -> `REGC_A`, `PSS1A` -> `IEEEST`).
 */
export function resolveCanonicalDyrModelName(modelName: string): string {
  const upper = modelName.trim().toUpperCase();
  return DYR_MODEL_CANONICAL_MAP[upper] ?? upper;
}

/**
 * Returns the 1-based deterministic schema ID (`0` if unknown) used in `PsseDyrSoaTables`.
 */
export function getDyrSchemaId(modelName: string): number {
  return DYR_SCHEMA_ID_BY_NAME.get(modelName.trim().toUpperCase()) ?? 0;
}

/**
 * Returns the schema by 1-based ID (`0` returns `undefined`).
 */
export function getDyrSchemaById(schemaId: number): DyrModelSchema | undefined {
  if (schemaId <= 0 || schemaId > DYR_SCHEMA_LIST.length) return undefined;
  return DYR_SCHEMA_LIST[schemaId - 1];
}
