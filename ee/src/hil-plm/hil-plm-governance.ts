// SPDX-License-Identifier: LicenseRef-ModelScript-Enterprise

import { Router, type Request, type Response } from "express";
import { requireEnterpriseFeature } from "../license/middleware.js";
import { resolveActiveEnterpriseLicense, type EnterpriseFeature } from "../license/verifier.js";

export interface EnterpriseHilTargetDescriptor {
  id: string;
  name: string;
  category: "hil-realtime" | "automotive-bus" | "industrial-plc" | "fmu-ip-protection";
  feature: "hil_codegen";
  description: string;
}

export interface EnterprisePlmConnectorDescriptor {
  id: string;
  name: string;
  category: "plm-alm" | "commercial-cae-translator";
  feature: "plm_connectors";
  description: string;
}

export const ENTERPRISE_HIL_TARGETS: readonly EnterpriseHilTargetDescriptor[] = [
  {
    id: "dspace",
    name: "dSPACE SCALEXIO / ConfigurationDesk Real-Time Target",
    category: "hil-realtime",
    feature: "hil_codegen",
    description: "Deterministic fixed-step C99 code generation and Simulink/RTICAN wrapper for dSPACE HIL rigs.",
  },
  {
    id: "speedgoat",
    name: "Speedgoat Real-Time Target Machine Wrapper",
    category: "hil-realtime",
    feature: "hil_codegen",
    description: "Real-time kernel wrapper and I/O driver bindings for Speedgoat test benches.",
  },
  {
    id: "ni-veristand",
    name: "NI VeriStand Real-Time Model Framework",
    category: "hil-realtime",
    feature: "hil_codegen",
    description: "Compiled shared library and channel mapping export for National Instruments VeriStand.",
  },
  {
    id: "fmi-ls-bus",
    name: "FMI 3.0 Layered Standard for Network Buses (FMI-LS-BUS)",
    category: "automotive-bus",
    feature: "hil_codegen",
    description: "Virtual bus simulation for CAN, CAN-FD, FlexRay, LIN, and Automotive Ethernet.",
  },
  {
    id: "fmu-shm",
    name: "Zero-Copy POSIX Shared-Memory Real-Time Co-Simulation",
    category: "hil-realtime",
    feature: "hil_codegen",
    description: "Sub-microsecond IPC shared-memory transport for hard real-time multi-FMU co-simulation.",
  },
  {
    id: "autosar",
    name: "AUTOSAR Classic & Adaptive ARXML Code & Virtual RTE Generator",
    category: "automotive-bus",
    feature: "hil_codegen",
    description: "Bidirectional ARXML SWC/Composition lowering, linting, and Virtual RTE execution.",
  },
  {
    id: "plcopen",
    name: "IEC 61131-3 PLCopen XML & Structured Text Industrial Codegen",
    category: "industrial-plc",
    feature: "hil_codegen",
    description:
      "Deterministic PLCopen TC6 XML and Structured Text export for Siemens TIA Portal, Beckhoff TwinCAT, and Rockwell Studio 5000.",
  },
] as const;

export const ENTERPRISE_PLM_CONNECTORS: readonly EnterprisePlmConnectorDescriptor[] = [
  {
    id: "oslc",
    name: "OASIS OSLC Core 3.0 Linked Data Server & Client (RM/QM/AM)",
    category: "plm-alm",
    feature: "plm_connectors",
    description: "Live requirements and test traceability bridge for IBM DOORS Next, Siemens Polarion, and Jira.",
  },
  {
    id: "reqif",
    name: "OMG ReqIF 1.2 Requirements Interchange Round-Tripper",
    category: "plm-alm",
    feature: "plm_connectors",
    description: "Bidirectional ReqIF XML import/export with cryptographic requirement verification links.",
  },
  {
    id: "ddp",
    name: "ProSTEP iViP / ISO 10303-242 Digital Data Package (DDP)",
    category: "plm-alm",
    feature: "plm_connectors",
    description: "Signed OEM-to-Tier-1 supplier handoff container with manifest and trace links.",
  },
  {
    id: "aasx",
    name: "Industrie 4.0 Asset Administration Shell (IDTA AASX v3.0)",
    category: "plm-alm",
    feature: "plm_connectors",
    description: "Digital nameplate, submodel templates, and technical data package export.",
  },
  {
    id: "simulink",
    name: "MathWorks Simulink (.slx / .mdl) Bidirectional Translator",
    category: "commercial-cae-translator",
    feature: "plm_connectors",
    description: "Automated block-diagram and Stateflow lowering into ModelScript / Modelica.",
  },
  {
    id: "gtsuite",
    name: "Gamma Technologies GT-SUITE (.gtm) Translator",
    category: "commercial-cae-translator",
    feature: "plm_connectors",
    description: "1D thermo-fluid and powertrain network migration adapter.",
  },
  {
    id: "adams",
    name: "MSC Adams (.adm / .cmd) Multibody Dynamics Translator",
    category: "commercial-cae-translator",
    feature: "plm_connectors",
    description: "Spatial mechanism, joint, and force element translator.",
  },
  {
    id: "aspen",
    name: "Aspen Plus (.bkp / .inp) Process Flowsheet Translator",
    category: "commercial-cae-translator",
    feature: "plm_connectors",
    description: "Chemical process engineering unit-operation and thermodynamic property migration.",
  },
  {
    id: "olga",
    name: "Schlumberger OLGA (.inp) Multiphase Flow Translator & FMU Exporter",
    category: "commercial-cae-translator",
    feature: "plm_connectors",
    description: "Transient multiphase pipeline simulator import and co-simulation wrapper.",
  },
  {
    id: "relap5",
    name: "RELAP5 / TRACE Thermal-Hydraulics Deck Translator",
    category: "commercial-cae-translator",
    feature: "plm_connectors",
    description: "Nuclear reactor system thermal-hydraulics nodalization translator.",
  },
  {
    id: "psse",
    name: "Siemens PTI PSS®E (.raw / .dyr) Transmission Grid Translator",
    category: "commercial-cae-translator",
    feature: "plm_connectors",
    description: "Bulk power system load-flow and dynamic stability model migration.",
  },
] as const;

const CLI_COMMAND_TO_FEATURE: Readonly<Record<string, EnterpriseFeature>> = {
  autosar: "hil_codegen",
  plcopen: "hil_codegen",
  oslc: "plm_connectors",
  reqif: "plm_connectors",
  ddp: "plm_connectors",
  simulink: "plm_connectors",
  gtsuite: "plm_connectors",
  adams: "plm_connectors",
  easy5: "plm_connectors",
  rocets: "plm_connectors",
  aspen: "plm_connectors",
  olga: "plm_connectors",
  relap5: "plm_connectors",
  eclipse: "plm_connectors",
  psse: "plm_connectors",
  dhf: "dhf_attestation",
};

export interface CliEntitlementCheckResult {
  allowed: boolean;
  requiredFeature?: EnterpriseFeature | undefined;
  reason?: string | undefined;
}

/**
 * Verifies whether a CLI command or SDK adapter invocation is entitled to run under the current
 * `MSX_EDITION` and `MSX_LICENSE_KEY` environment.
 */
export function verifyEnterpriseCliCommand(commandName: string): CliEntitlementCheckResult {
  const normalized = commandName.trim().toLowerCase();
  const requiredFeature = CLI_COMMAND_TO_FEATURE[normalized];
  if (!requiredFeature) {
    return { allowed: true };
  }

  const editionEnv = (process.env["MSX_EDITION"] || "").toLowerCase().trim();
  if (editionEnv === "ce" || editionEnv === "community") {
    return {
      allowed: false,
      requiredFeature,
      reason: `Command 'msx ${normalized}' requires ModelScript Enterprise Edition (feature '${requiredFeature}') and is disabled when MSX_EDITION=ce.`,
    };
  }

  const status = resolveActiveEnterpriseLicense();
  if (!status.valid) {
    return {
      allowed: false,
      requiredFeature,
      reason:
        status.reason ??
        `Command 'msx ${normalized}' requires a valid ModelScript Enterprise Edition license with feature '${requiredFeature}'.`,
    };
  }

  if (status.mode === "licensed" && status.claims && !status.claims.features.includes(requiredFeature)) {
    return {
      allowed: false,
      requiredFeature,
      reason: `Active Enterprise license for '${status.claims.org}' does not include the '${requiredFeature}' entitlement required by 'msx ${normalized}'.`,
    };
  }

  return { allowed: true, requiredFeature };
}

/**
 * Express router mounted under `/api/v1/ee` exposing Enterprise HIL & PLM catalog
 * discovery and target authorization endpoints.
 */
export function createEnterpriseHilPlmRouter(): Router {
  const router = Router();

  router.get("/ee/capabilities", (_req: Request, res: Response) => {
    const license = resolveActiveEnterpriseLicense();
    res.json({
      edition: "ee",
      licenseSpdx: "LicenseRef-ModelScript-Enterprise",
      mode: license.mode,
      valid: license.valid,
      hilTargets: ENTERPRISE_HIL_TARGETS,
      plmConnectors: ENTERPRISE_PLM_CONNECTORS,
    });
  });

  router.post("/ee/hil/authorize", requireEnterpriseFeature("hil_codegen"), (req: Request, res: Response) => {
    const targetId = String(req.body?.target ?? "")
      .trim()
      .toLowerCase();
    const descriptor = ENTERPRISE_HIL_TARGETS.find((t) => t.id === targetId);
    if (!descriptor) {
      res.status(404).json({
        error: "Unknown Enterprise HIL Target",
        supportedTargets: ENTERPRISE_HIL_TARGETS.map((t) => t.id),
      });
      return;
    }
    res.json({
      authorized: true,
      feature: "hil_codegen",
      target: descriptor,
    });
  });

  router.post("/ee/plm/authorize", requireEnterpriseFeature("plm_connectors"), (req: Request, res: Response) => {
    const connectorId = String(req.body?.connector ?? "")
      .trim()
      .toLowerCase();
    const descriptor = ENTERPRISE_PLM_CONNECTORS.find((c) => c.id === connectorId);
    if (!descriptor) {
      res.status(404).json({
        error: "Unknown Enterprise PLM/CAE Connector",
        supportedConnectors: ENTERPRISE_PLM_CONNECTORS.map((c) => c.id),
      });
      return;
    }
    res.json({
      authorized: true,
      feature: "plm_connectors",
      connector: descriptor,
    });
  });

  return router;
}
