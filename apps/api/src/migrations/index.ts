// SPDX-License-Identifier: AGPL-3.0-or-later

import { baselineMigration } from "./0001_baseline.js";
import { spaceIssuesExternalMigration } from "./0002_space_issues_external.js";
import { oidcReleaseAttestationsMigration } from "./0003_oidc_release_attestations.js";
import { tokenIpCidrRestrictionsMigration } from "./0004_token_ip_cidr_restrictions.js";
import { lowercaseUserIndexesMigration } from "./0005_lowercase_user_indexes.js";
import { sysml2ProjectOwnersMigration } from "./0006_sysml2_project_owners.js";
import { referenceCollectionsMigration } from "./0007_reference_collections.js";
import { rlhfArenaMigration } from "./0008_rlhf_arena.js";
import { diskannMemoryAndDatasetsMigration } from "./0009_diskann_memory_and_datasets.js";
import { datasetOverlayPatchesMigration } from "./0010_dataset_overlay_patches.js";
import { trainingRunsAndModelRegistryMigration } from "./0011_training_runs_and_model_registry.js";
import { annotationCampaignsAndConsensusMigration } from "./0012_annotation_campaigns_and_consensus.js";
import { formalizeMemoryFederationAndEmbeddingsMigration } from "./0013_formalize_memory_federation_and_embeddings.js";
import { aiInteractionTracesAndFeedbackMigration } from "./0014_ai_interaction_traces_and_feedback.js";
import { provenanceDagAndRoyaltyLedgerMigration } from "./0015_provenance_dag_and_royalty_ledger.js";
import { livingRecipesAndRbacRolesMigration } from "./0016_living_recipes_and_rbac_roles.js";
import type { Migration } from "./types.js";

export * from "./runner.js";
export * from "./types.js";

export const allMigrations: Migration[] = [
  baselineMigration,
  spaceIssuesExternalMigration,
  oidcReleaseAttestationsMigration,
  tokenIpCidrRestrictionsMigration,
  lowercaseUserIndexesMigration,
  sysml2ProjectOwnersMigration,
  referenceCollectionsMigration,
  rlhfArenaMigration,
  diskannMemoryAndDatasetsMigration,
  datasetOverlayPatchesMigration,
  trainingRunsAndModelRegistryMigration,
  annotationCampaignsAndConsensusMigration,
  formalizeMemoryFederationAndEmbeddingsMigration,
  aiInteractionTracesAndFeedbackMigration,
  provenanceDagAndRoyaltyLedgerMigration,
  livingRecipesAndRbacRolesMigration,
];
