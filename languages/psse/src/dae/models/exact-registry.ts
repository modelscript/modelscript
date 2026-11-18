// SPDX-License-Identifier: AGPL-3.0-or-later

import { DYR_MODEL_CANONICAL_MAP } from "../../schema/index.js";

/**
 * Canonical PSS/E DYR models with dedicated per-model differential-algebraic equations
 * in `languages/psse/src/dae/models/`.
 */
export const CANONICAL_EXACT_MODELS = new Set<string>([
  // Generators & Wind/PV Converter Generators
  "GENCLS",
  "GENROU",
  "GENROE",
  "GENSAL",
  "GENSAE",
  "GENTPJ",
  "WT1G",
  "WT2G",
  "WT3G1",
  "WT4G1",
  "PVGU1",
  // Exciters & Limiters
  "IEEET1",
  "IEEEX1",
  "ESAC1A",
  "ESAC2A",
  "ESAC3A",
  "ESAC4A",
  "ESAC8B",
  "EXST1",
  "ESST1A",
  "ESST4B",
  "SEXS",
  "SCRX",
  "MAXEX1",
  "UEL1",
  "VHZL1",
  "COMP",
  // Governors & Prime Movers
  "TGOV1",
  "TGOV2",
  "IEEEG1",
  "IEESGO",
  "GAST",
  "GGOV1",
  "HYGOV",
  "PIDGOV",
  "WTDTA1",
  "WTPTA1",
  "WTTQA1",
  // Stabilizers (PSS)
  "IEEEST",
  "STAB1",
  "PSS2A",
  "PSS2B",
  "PSS4B",
  // IBRs, Renewables & Dynamic Loads
  "REGC_A",
  "REEC_A",
  "REPC_A",
  "DER_A",
  "REGFM_A1",
  "CMPLDW",
  "CLOD",
  "CIM5",
  "IEEEL",
  "LD1PAC",
  // HVDC, FACTS & Protection Relays
  "CSVGN1",
  "CDC4T",
  "VSC_DC",
  "FRQTPAT",
  "VTGTPAT",
  "BUSFRQ",
]);

/**
 * Canonical PSS/E DYR models lowered via validated family archetypes in `languages/psse/src/dae/models/`.
 */
export const ARCHETYPE_MAPPED_MODELS = new Set<string>([
  // Generators & Motors
  "GENTRA",
  "CGEN1",
  "GENCC",
  "SYNCON",
  "GENDCO",
  "GENSDO",
  "GENEQU",
  "GENTB1",
  "CIMTR1",
  "CIMTR3",
  "MOTOR1",
  // Exciters
  "EX2000",
  // Governors
  "LCFB1",
  "DEGOV1",
  // Stabilizers
  "STAB2A",
  "STAB3",
  "PSS3B",
  "PTIST1",
  // IBRs & Dynamic Loads
  "REGC_B",
  "REGC_C",
  "REEC_B",
  "REEC_C",
  "REEC_D",
  "REPC_B",
  "REAX4B1",
  "CMLDBL",
  "CMLDAL",
  "CMLDZL",
  "CMLDOW",
  "CLODBL",
  "CLODAL",
  "CLODZL",
  "CLODOW",
  "CIM5BL",
  "CIM5AL",
  "CIM5ZL",
  "CIM5OW",
  "CIM6BL",
  "CIM6AL",
  "CIM6ZL",
  "CIM6OW",
  "CIMWBL",
  "CIMWAL",
  "CIMWZL",
  "CIMWOW",
  "IEELBL",
  "IEELAL",
  "IEELZL",
  "IEELOW",
  "LDFRBL",
  "LDFRAL",
  "LDFRZL",
  "LDFROW",
  // FACTS & Protection
  "SVSMO1",
  "SVSMO3",
  "CSTCNT",
  "LDSHBL",
  "LVSHBL",
  "OOSR1",
  "DISTRL",
]);

export type DyrLoweringTier = "canonical_exact" | "archetype_mapped" | "unmapped";

/**
 * Returns the honest DAE lowering tier for any PSS/E `.dyr` model name.
 */
export function getDyrModelLoweringTier(modelName: string): DyrLoweringTier {
  const upper = modelName.trim().toUpperCase();
  const canonical = DYR_MODEL_CANONICAL_MAP[upper] ?? upper;
  if (CANONICAL_EXACT_MODELS.has(canonical)) return "canonical_exact";
  if (ARCHETYPE_MAPPED_MODELS.has(canonical)) return "archetype_mapped";
  return "unmapped";
}

/**
 * Full expanded registry of all 366 PSS/E DYR schemas (canonical exact + archetype mapped + aliases)
 * covered by DAE lowering in `languages/psse/src/dae/models/`.
 */
export const EXACT_LOWERED_MODELS = new Set<string>();
for (const [modelName, canonicalName] of Object.entries(DYR_MODEL_CANONICAL_MAP)) {
  if (CANONICAL_EXACT_MODELS.has(canonicalName) || ARCHETYPE_MAPPED_MODELS.has(canonicalName)) {
    EXACT_LOWERED_MODELS.add(modelName);
  }
}
