// SPDX-License-Identifier: LicenseRef-ModelScript-Enterprise

import type { Express } from "express";
import {
  mountEnterpriseAdminAndDevops,
  type EnterpriseAdminDevopsRouters,
} from "./admin-devops/admin-devops-governance.js";
import {
  runGatekeeperScreeningPipeline,
  type GatekeeperScorecard,
  type GatekeeperStageResult,
  type GatekeeperSubmissionPackage,
} from "./admin-devops/gatekeeper-pipeline.js";
import { createGatekeeperRouter } from "./admin-devops/gatekeeper-service.js";
import {
  defaultOidcService,
  OidcService,
  type OidcClaims,
  type OidcDatabaseAdapter,
  type OidcUserRecord,
} from "./auth/oidc.js";
import { mountEnterpriseAuthAndRbac, type EnterpriseAuthRouters } from "./auth/sso-governance.js";
import { runLicenseCli } from "./cli/license-cli.js";
import {
  mountEnterpriseCollabAndExports,
  verifyEnterpriseCollabSession,
  verifyPrivateVisibilityEntitlement,
  type EnterpriseEntitlementCheck,
} from "./collab-reviews/collab-reviews-governance.js";
import {
  createAirgapSecurityHeadersMiddleware,
  createEnterpriseComplianceRouter,
  type EnterpriseComplianceContext,
} from "./compliance/airgap.js";
import {
  computeAttestationDigest,
  createDhfAttestationRouter,
  signComplianceAttestation,
  verifyComplianceAttestation,
  verifyComplianceAttestationChain,
  type AttestationChainVerificationResult,
  type ComplianceAttestationPayload,
  type RegulatoryStandard,
  type SignedComplianceAttestation,
} from "./compliance/dhf-attestation.js";
import {
  buildRegulatoryDossier,
  compileNercRsawDocument,
  compileOscalAssessmentResults,
  generateCeiiWatermarkHeader,
  type CompiledRegulatoryDossier,
  type DossierCompilationInput,
  type RegulatoryDossierFinding,
} from "./compliance/regulatory-dossier.js";
import {
  createExportComplianceMiddleware,
  extractRequestCountry,
  extractRequestRegion,
  isExportRestricted,
  isOfacSanctioned,
  OFAC_SANCTIONED_COUNTRIES,
  OFAC_SANCTIONED_REGIONS,
  SANCTIONED_COUNTRIES,
  SANCTIONED_REGIONS,
  type ExportControlAuditLogger,
  type GeoLocationLookupAdapter,
} from "./compliance/export-control.js";
import {
  auditTelecomSupplyChain,
  evaluateFccPart4Outage,
  FCC_COVERED_LIST_VENDORS,
  generateDirsEmergencySnapshot,
  generateNorsFilingDossier,
  type DirsSnapshotInput,
  type DirsSnapshotReport,
  type FccPart4NorsEvaluation,
  type NorsFilingDossier,
  type ScrmAuditResult,
  type TelecomEquipmentItem,
  type TelecomOutageEvent,
} from "./compliance/telecom-compliance.js";
import {
  checkEnterpriseDesktopAirgapCompliance,
  createEnterpriseDesktopRouter,
  verifyBlackboxFmuEntitlement,
  type BlackboxFmuEntitlementResult,
  type EnterpriseDesktopAirgapReport,
} from "./desktop/desktop-compliance.js";
import {
  createEnterpriseHilPlmRouter,
  ENTERPRISE_HIL_TARGETS,
  ENTERPRISE_PLM_CONNECTORS,
  verifyEnterpriseCliCommand,
  type CliEntitlementCheckResult,
  type EnterpriseHilTargetDescriptor,
  type EnterprisePlmConnectorDescriptor,
} from "./hil-plm/hil-plm-governance.js";
import { mountEnterpriseHpcAndBilling, type EnterpriseHpcBillingRouters } from "./hpc-billing/hpc-governance.js";
import { mountEnterpriseInteropGateways, type EnterpriseInteropRouters } from "./interop/interop-governance.js";
import { createEnterpriseLicenseRouter, requireEnterpriseFeature } from "./license/middleware.js";
import {
  ALL_ENTERPRISE_FEATURES,
  DEFAULT_ENTERPRISE_PUBLIC_KEY_PEM,
  generateLicenseKeyPair,
  resolveActiveEnterpriseLicense,
  signEnterpriseLicense,
  verifyEnterpriseLicense,
  type Ed25519KeyPairPem,
  type EnterpriseFeature,
  type EnterpriseLicenseClaims,
  type EnterpriseTier,
  type LicenseVerificationResult,
} from "./license/verifier.js";
import { mountEnterpriseThreadGovernance, type EnterpriseThreadRouters } from "./thread/thread-governance.js";
import { mountEnterpriseTwinsAndHistorian, type EnterpriseTwinsRouters } from "./twins/twins-governance.js";

export interface EnterprisePluginHostContext extends EnterpriseComplianceContext {
  app: Express;
  auth?: EnterpriseAuthRouters | undefined;
  hpcBilling?: EnterpriseHpcBillingRouters | undefined;
  twins?: EnterpriseTwinsRouters | undefined;
  interop?: EnterpriseInteropRouters | undefined;
  thread?: EnterpriseThreadRouters | undefined;
  adminDevops?: EnterpriseAdminDevopsRouters | undefined;
}

/**
 * Registers all ModelScript Enterprise Edition (`@modelscript/ee`) subsystems onto the host Express application:
 * - Batch A: Air-Gap Security Headers, FERC CEII / NERC CIP Probes, and FDA 21 CFR Part 11 DHF Attestations
 * - Batch B: SAML 2.0 / OIDC Corporate SSO and Multi-Organization RBAC (`/api/v1/organizations`)
 * - Batch C: Slurm HPC Cluster Offload, Cloud CAE Sweeps, and Stripe Compute Credit Wallet (`/api/v1/cae`, `/api/v1/cloud`, `/api/v1/billing`)
 * - Batch D: Operational Digital Twins, Asset Birth Certificates, TimescaleDB Historian, OMG SysML v2 REST, and Hosted MCP SSE Gateway
 * - Batch E: Digital Thread Hypergraph Governance (`/api/v1/threads`) and ITAR/EAR/OFAC Export Compliance
 * - Batch F: Distributed MQTT/FMU Co-Simulation Master Orchestrator (`/api/v1/cosim`, `/api/v1/mqtt/participants`)
 * - Batch G: Real-Time HIL Codegen & Enterprise PLM/CAE Translator Gateways (`/api/v1/ee/capabilities`, `/api/v1/ee/hil/*`, `/api/v1/ee/plm/*`)
 * - Batch H: Enterprise Admin Console (`/api/v1/admin/*`), Signed CI/CD Webhooks (`/api/v1/webhooks`), Self-Hosted GitLab Bridge (`/api/v1/git`, `/api/v1/gitlab`), W3C SPARQL 1.1 Knowledge Graph (`/api/v1/libraries/sparql`), and Air-Gapped Desktop & Black-Box Binary FMU Governance (`/api/v1/ee/desktop/*`)
 * - Batch I: Real-Time Multi-User Co-Editing & Private Repositories (`/api/v1/ee/collab/status`), Automated AI PR Reviews (`/api/v1/repos/:id/reviews`), and Industry 4.0 `.aasx` / OMG `.kpar` Digital Twin Archive Export
 */
export function mountEnterpriseEdition(ctx: EnterprisePluginHostContext): void {
  ctx.app.use("/api/v1", createEnterpriseLicenseRouter());
  ctx.app.use("/api/v1", createEnterpriseComplianceRouter(ctx));
  ctx.app.use("/api/v1", createDhfAttestationRouter());
  ctx.app.use("/api/v1", createEnterpriseHilPlmRouter());
  ctx.app.use("/api/v1", createEnterpriseDesktopRouter());
  ctx.app.use("/api/v1", createGatekeeperRouter());
  mountEnterpriseCollabAndExports(ctx.app);

  if (ctx.auth) {
    mountEnterpriseAuthAndRbac(ctx.app, ctx.auth);
  }
  if (ctx.hpcBilling) {
    mountEnterpriseHpcAndBilling(ctx.app, ctx.hpcBilling);
  }
  if (ctx.twins) {
    mountEnterpriseTwinsAndHistorian(ctx.app, ctx.twins);
  }
  if (ctx.interop) {
    mountEnterpriseInteropGateways(ctx.app, ctx.interop);
  }
  if (ctx.thread) {
    mountEnterpriseThreadGovernance(ctx.app, ctx.thread);
  }
  if (ctx.adminDevops) {
    mountEnterpriseAdminAndDevops(ctx.app, ctx.adminDevops);
  }
}

export {
  ALL_ENTERPRISE_FEATURES,
  auditTelecomSupplyChain,
  buildRegulatoryDossier,
  checkEnterpriseDesktopAirgapCompliance,
  compileNercRsawDocument,
  compileOscalAssessmentResults,
  computeAttestationDigest,
  generateCeiiWatermarkHeader,
  createAirgapSecurityHeadersMiddleware,
  createDhfAttestationRouter,
  createEnterpriseComplianceRouter,
  createEnterpriseDesktopRouter,
  createEnterpriseHilPlmRouter,
  createEnterpriseLicenseRouter,
  createExportComplianceMiddleware,
  createGatekeeperRouter,
  DEFAULT_ENTERPRISE_PUBLIC_KEY_PEM,
  defaultOidcService,
  ENTERPRISE_HIL_TARGETS,
  ENTERPRISE_PLM_CONNECTORS,
  evaluateFccPart4Outage,
  extractRequestCountry,
  extractRequestRegion,
  FCC_COVERED_LIST_VENDORS,
  generateDirsEmergencySnapshot,
  generateLicenseKeyPair,
  generateNorsFilingDossier,
  isExportRestricted,
  isOfacSanctioned,
  mountEnterpriseAdminAndDevops,
  mountEnterpriseAuthAndRbac,
  mountEnterpriseCollabAndExports,
  mountEnterpriseHpcAndBilling,
  mountEnterpriseInteropGateways,
  mountEnterpriseThreadGovernance,
  mountEnterpriseTwinsAndHistorian,
  OFAC_SANCTIONED_COUNTRIES,
  OFAC_SANCTIONED_REGIONS,
  OidcService,
  requireEnterpriseFeature,
  resolveActiveEnterpriseLicense,
  runGatekeeperScreeningPipeline,
  runLicenseCli,
  SANCTIONED_COUNTRIES,
  SANCTIONED_REGIONS,
  signComplianceAttestation,
  signEnterpriseLicense,
  verifyBlackboxFmuEntitlement,
  verifyComplianceAttestation,
  verifyComplianceAttestationChain,
  verifyEnterpriseCliCommand,
  verifyEnterpriseCollabSession,
  verifyEnterpriseLicense,
  verifyPrivateVisibilityEntitlement,
  type AttestationChainVerificationResult,
  type BlackboxFmuEntitlementResult,
  type CliEntitlementCheckResult,
  type ComplianceAttestationPayload,
  type CompiledRegulatoryDossier,
  type DirsSnapshotInput,
  type DirsSnapshotReport,
  type DossierCompilationInput,
  type Ed25519KeyPairPem,
  type EnterpriseAdminDevopsRouters,
  type EnterpriseAuthRouters,
  type EnterpriseComplianceContext,
  type EnterpriseDesktopAirgapReport,
  type EnterpriseEntitlementCheck,
  type EnterpriseFeature,
  type EnterpriseHilTargetDescriptor,
  type EnterpriseHpcBillingRouters,
  type EnterpriseInteropRouters,
  type EnterpriseLicenseClaims,
  type EnterprisePlmConnectorDescriptor,
  type EnterpriseThreadRouters,
  type EnterpriseTier,
  type EnterpriseTwinsRouters,
  type ExportControlAuditLogger,
  type FccPart4NorsEvaluation,
  type GatekeeperScorecard,
  type GatekeeperStageResult,
  type GatekeeperSubmissionPackage,
  type GeoLocationLookupAdapter,
  type LicenseVerificationResult,
  type NorsFilingDossier,
  type OidcClaims,
  type OidcDatabaseAdapter,
  type OidcUserRecord,
  type RegulatoryDossierFinding,
  type RegulatoryStandard,
  type ScrmAuditResult,
  type SignedComplianceAttestation,
  type TelecomEquipmentItem,
  type TelecomOutageEvent,
};
