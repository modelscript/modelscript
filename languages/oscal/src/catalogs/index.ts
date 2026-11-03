// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/oscal — Built-in Offline NIST SP 800-53 Rev 5 & NIST SP 800-82 Rev 3 (OT/ICS Overlay) Catalogs.
 *
 * Provides air-gapped control resolution, hover documentation, parameter definitions,
 * and baseline control sets across all 11 core security control families.
 */

import type { OscalControl, OscalDocument, OscalGroup, OscalSourceRange } from "../types.js";

const ZERO_RANGE: OscalSourceRange = {
  startOffset: 0,
  endOffset: 0,
  startLine: 1,
  startColumn: 1,
  endLine: 1,
  endColumn: 1,
};

export const MANDATORY_OT_ICS_CONTROLS = ["sc-7", "ac-3", "si-7", "pe-3"] as const;

export const NIST_800_53_GROUPS: OscalGroup[] = [
  {
    id: "ac",
    class: "family",
    title: "Access Control",
    controls: [
      {
        id: "ac-1",
        class: "SP800-53",
        title: "Policy and Procedures",
        family: "AC",
        baselines: ["low", "moderate", "high", "ot-ics"],
        params: [
          {
            id: "ac-1_prm_1",
            label: "organization-defined personnel or roles",
            values: ["designated system security and OT operations personnel"],
          },
          {
            id: "ac-1_prm_2",
            label: "organization-defined frequency for policy review",
            values: ["annually"],
          },
        ],
        parts: [
          {
            id: "ac-1_smt",
            name: "statement",
            prose:
              "Develop, document, and disseminate to {{ insert: param, ac-1_prm_1 }} an access control policy and review/update the policy {{ insert: param, ac-1_prm_2 }}.",
          },
        ],
      },
      {
        id: "ac-2",
        class: "SP800-53",
        title: "Account Management",
        family: "AC",
        baselines: ["low", "moderate", "high", "ot-ics"],
        params: [
          {
            id: "ac-2_prm_1",
            label: "organization-defined time period of inactivity",
            values: ["30 days"],
          },
        ],
        parts: [
          {
            id: "ac-2_smt",
            name: "statement",
            prose:
              "Define and manage system accounts; disable inactive accounts after {{ insert: param, ac-2_prm_1 }}.",
          },
        ],
        controls: [
          {
            id: "ac-2.1",
            class: "SP800-53-enhancement",
            title: "Account Management | Automated System Account Management",
            family: "AC",
            baselines: ["moderate", "high"],
            parts: [
              {
                id: "ac-2.1_smt",
                name: "statement",
                prose: "Support the management of system accounts using automated mechanisms.",
              },
            ],
          },
        ],
      },
      {
        id: "ac-3",
        class: "SP800-53",
        title: "Access Enforcement",
        family: "AC",
        isOtOverlay: true,
        baselines: ["low", "moderate", "high", "ot-ics"],
        params: [
          {
            id: "ac-3_prm_1",
            label: "access control policy enforcement mechanism",
            values: ["role-based access control (RBAC) and physical keyswitches"],
          },
        ],
        parts: [
          {
            id: "ac-3_smt",
            name: "statement",
            prose:
              "Enforce approved authorizations for logical access to information and system resources in accordance with {{ insert: param, ac-3_prm_1 }}.",
          },
          {
            id: "ac-3_ot",
            name: "ot-guidance",
            prose:
              "NIST SP 800-82 Rev 3: Ensure enforcement does not introduce unacceptable latency on deterministic PLC/IED control loops.",
          },
        ],
      },
      {
        id: "ac-4",
        class: "SP800-53",
        title: "Information Flow Enforcement",
        family: "AC",
        isOtOverlay: true,
        baselines: ["moderate", "high", "ot-ics"],
        params: [
          {
            id: "ac-4_prm_1",
            label: "information flow control policies",
            values: ["unidirectional gateway / Purdue Model Level 3.5 DMZ policies"],
          },
        ],
        parts: [
          {
            id: "ac-4_smt",
            name: "statement",
            prose:
              "Enforce approved authorizations for controlling the flow of information within the system and between interconnected systems based on {{ insert: param, ac-4_prm_1 }}.",
          },
        ],
      },
      {
        id: "ac-17",
        class: "SP800-53",
        title: "Remote Access",
        family: "AC",
        isOtOverlay: true,
        baselines: ["low", "moderate", "high", "ot-ics"],
        params: [
          {
            id: "ac-17_prm_1",
            label: "remote access usage restrictions",
          },
        ],
        parts: [
          {
            id: "ac-17_smt",
            name: "statement",
            prose:
              "Establish and document usage restrictions, configuration/connection requirements, and implementation guidance for each type of remote access allowed: {{ insert: param, ac-17_prm_1 }}.",
          },
        ],
      },
    ],
  },
  {
    id: "au",
    class: "family",
    title: "Audit and Accountability",
    controls: [
      {
        id: "au-2",
        class: "SP800-53",
        title: "Event Logging",
        family: "AU",
        baselines: ["low", "moderate", "high", "ot-ics"],
        params: [
          {
            id: "au-2_prm_1",
            label: "organization-defined event types to be logged",
            values: ["logon/logoff, firmware changes, PLC mode transitions, safety setpoint overrides"],
          },
        ],
        parts: [
          {
            id: "au-2_smt",
            name: "statement",
            prose:
              "Identify the types of events that the system is capable of logging in support of the audit function: {{ insert: param, au-2_prm_1 }}.",
          },
        ],
      },
      {
        id: "au-6",
        class: "SP800-53",
        title: "Audit Record Review, Analysis, and Reporting",
        family: "AU",
        baselines: ["low", "moderate", "high", "ot-ics"],
        params: [
          {
            id: "au-6_prm_1",
            label: "organization-defined frequency for audit review",
            values: ["weekly"],
          },
        ],
        parts: [
          {
            id: "au-6_smt",
            name: "statement",
            prose:
              "Review and analyze system audit records {{ insert: param, au-6_prm_1 }} for indications of inappropriate or unusual activity.",
          },
        ],
      },
    ],
  },
  {
    id: "cm",
    class: "family",
    title: "Configuration Management",
    controls: [
      {
        id: "cm-2",
        class: "SP800-53",
        title: "Baseline Configuration",
        family: "CM",
        isOtOverlay: true,
        baselines: ["low", "moderate", "high", "ot-ics"],
        params: [
          {
            id: "cm-2_prm_1",
            label: "baseline review frequency",
            values: ["annually or upon engineering change order"],
          },
        ],
        parts: [
          {
            id: "cm-2_smt",
            name: "statement",
            prose:
              "Develop, document, and maintain under configuration control, a current baseline configuration of the system and review {{ insert: param, cm-2_prm_1 }}.",
          },
        ],
      },
      {
        id: "cm-7",
        class: "SP800-53",
        title: "Least Functionality",
        family: "CM",
        isOtOverlay: true,
        baselines: ["low", "moderate", "high", "ot-ics"],
        params: [
          {
            id: "cm-7_prm_1",
            label: "prohibited or restricted functions, ports, protocols, and services",
            values: ["Telnet (TCP/23), FTP (TCP/21), unauthenticated Modbus write functions"],
          },
        ],
        parts: [
          {
            id: "cm-7_smt",
            name: "statement",
            prose:
              "Configure the system to provide only mission-essential capabilities and prohibit or restrict the use of the following functions, ports, protocols, and services: {{ insert: param, cm-7_prm_1 }}.",
          },
        ],
      },
      {
        id: "cm-8",
        class: "SP800-53",
        title: "System Component Inventory",
        family: "CM",
        isOtOverlay: true,
        baselines: ["low", "moderate", "high", "ot-ics"],
        params: [
          {
            id: "cm-8_prm_1",
            label: "inventory update frequency",
            values: ["monthly"],
          },
        ],
        parts: [
          {
            id: "cm-8_smt",
            name: "statement",
            prose:
              "Develop and document an inventory of system components that accurately reflects the system and update {{ insert: param, cm-8_prm_1 }}.",
          },
        ],
      },
    ],
  },
  {
    id: "cp",
    class: "family",
    title: "Contingency Planning",
    controls: [
      {
        id: "cp-9",
        class: "SP800-53",
        title: "System Backup",
        family: "CP",
        baselines: ["low", "moderate", "high", "ot-ics"],
        params: [
          {
            id: "cp-9_prm_1",
            label: "backup frequency for system-level and PLC logic images",
            values: ["daily and prior to any ladder/ST logic deployment"],
          },
        ],
        parts: [
          {
            id: "cp-9_smt",
            name: "statement",
            prose:
              "Conduct backups of user-level and system-level information (including PLC/IED firmware and logic configurations) {{ insert: param, cp-9_prm_1 }}.",
          },
        ],
      },
      {
        id: "cp-10",
        class: "SP800-53",
        title: "System Recovery and Reconstitution",
        family: "CP",
        isOtOverlay: true,
        baselines: ["low", "moderate", "high", "ot-ics"],
        parts: [
          {
            id: "cp-10_smt",
            name: "statement",
            prose:
              "Provide for the recovery and reconstitution of the system to a known and safe operational state within defined recovery time objectives.",
          },
        ],
      },
    ],
  },
  {
    id: "ia",
    class: "family",
    title: "Identification and Authentication",
    controls: [
      {
        id: "ia-2",
        class: "SP800-53",
        title: "Identification and Authentication (Organizational Users)",
        family: "IA",
        baselines: ["low", "moderate", "high", "ot-ics"],
        parts: [
          {
            id: "ia-2_smt",
            name: "statement",
            prose:
              "Uniquely identify and authenticate organizational users and associate that unique identification with processes acting on behalf of those users.",
          },
        ],
        controls: [
          {
            id: "ia-2.1",
            class: "SP800-53-enhancement",
            title: "Multi-Factor Authentication to Privileged Accounts",
            family: "IA",
            baselines: ["low", "moderate", "high"],
            parts: [
              {
                id: "ia-2.1_smt",
                name: "statement",
                prose: "Implement multi-factor authentication for access to privileged accounts.",
              },
            ],
          },
        ],
      },
      {
        id: "ia-3",
        class: "SP800-53",
        title: "Device Identification and Authentication",
        family: "IA",
        isOtOverlay: true,
        baselines: ["moderate", "high", "ot-ics"],
        params: [
          {
            id: "ia-3_prm_1",
            label: "devices requiring mutual authentication",
            values: ["all field controllers, PLCs, RTUs, and IEDs"],
          },
        ],
        parts: [
          {
            id: "ia-3_smt",
            name: "statement",
            prose:
              "Uniquely identify and authenticate {{ insert: param, ia-3_prm_1 }} before establishing a local, remote, or network connection.",
          },
        ],
      },
    ],
  },
  {
    id: "ir",
    class: "family",
    title: "Incident Response",
    controls: [
      {
        id: "ir-4",
        class: "SP800-53",
        title: "Incident Handling",
        family: "IR",
        isOtOverlay: true,
        baselines: ["low", "moderate", "high", "ot-ics"],
        parts: [
          {
            id: "ir-4_smt",
            name: "statement",
            prose:
              "Implement an incident handling capability for cyber and cyber-physical security incidents that includes preparation, detection, analysis, containment, eradication, and safe physical process recovery.",
          },
        ],
      },
    ],
  },
  {
    id: "pe",
    class: "family",
    title: "Physical and Environmental Protection",
    controls: [
      {
        id: "pe-3",
        class: "SP800-53",
        title: "Physical Access Control",
        family: "PE",
        isOtOverlay: true,
        baselines: ["low", "moderate", "high", "ot-ics"],
        params: [
          {
            id: "pe-3_prm_1",
            label: "facility and cabinet entry points",
            values: ["substation control house doors, PLC enclosures, and safety instrumented system cabinets"],
          },
        ],
        parts: [
          {
            id: "pe-3_smt",
            name: "statement",
            prose:
              "Enforce physical access authorizations at {{ insert: param, pe-3_prm_1 }} by verifying individual access authorizations and maintaining physical access audit logs.",
          },
          {
            id: "pe-3_ot",
            name: "ot-guidance",
            prose:
              "NIST SP 800-82 Rev 3: Lock field controller cabinets and require physical key-switches to remain in RUN/REM-RUN mode during normal operation.",
          },
        ],
      },
    ],
  },
  {
    id: "ra",
    class: "family",
    title: "Risk Assessment",
    controls: [
      {
        id: "ra-3",
        class: "SP800-53",
        title: "Risk Assessment",
        family: "RA",
        baselines: ["low", "moderate", "high", "ot-ics"],
        parts: [
          {
            id: "ra-3_smt",
            name: "statement",
            prose:
              "Conduct a risk assessment, including assessment of cyber-physical safety hazards and failure modes.",
          },
        ],
      },
      {
        id: "ra-5",
        class: "SP800-53",
        title: "Vulnerability Monitoring and Scanning",
        family: "RA",
        isOtOverlay: true,
        baselines: ["low", "moderate", "high", "ot-ics"],
        params: [
          {
            id: "ra-5_prm_1",
            label: "vulnerability monitoring frequency",
            values: ["continuously via passive OT network monitoring and during scheduled maintenance outages"],
          },
        ],
        parts: [
          {
            id: "ra-5_smt",
            name: "statement",
            prose:
              "Monitor and scan for vulnerabilities in the system and hosted applications {{ insert: param, ra-5_prm_1 }}.",
          },
          {
            id: "ra-5_ot",
            name: "ot-guidance",
            prose:
              "NIST SP 800-82 Rev 3: Avoid active vulnerability scanning on live production PLCs/IEDs; use passive asset/vulnerability detection or offline testbeds.",
          },
        ],
      },
    ],
  },
  {
    id: "sc",
    class: "family",
    title: "System and Communications Protection",
    controls: [
      {
        id: "sc-7",
        class: "SP800-53",
        title: "Boundary Protection",
        family: "SC",
        isOtOverlay: true,
        baselines: ["low", "moderate", "high", "ot-ics"],
        params: [
          {
            id: "sc-7_prm_1",
            label: "boundary protection mechanisms and Purdue zones",
            values: ["industrial firewalls, data diodes, and IEC 62443 zones/conduits"],
          },
        ],
        parts: [
          {
            id: "sc-7_smt",
            name: "statement",
            prose:
              "Monitor and control communications at the external managed interfaces to the system and at key internal boundaries within the system using {{ insert: param, sc-7_prm_1 }}.",
          },
          {
            id: "sc-7_ot",
            name: "ot-guidance",
            prose:
              "NIST SP 800-82 Rev 3: Isolate safety systems and Level 0/1/2 OT control networks from corporate IT networks using DMZ architectures.",
          },
        ],
        controls: [
          {
            id: "sc-7.5",
            class: "SP800-53-enhancement",
            title: "Boundary Protection | Deny by Default — Allow by Exception",
            family: "SC",
            isOtOverlay: true,
            baselines: ["moderate", "high", "ot-ics"],
            parts: [
              {
                id: "sc-7.5_smt",
                name: "statement",
                prose:
                  "Deny network communications traffic by default and allow network communications traffic by exception at managed interfaces.",
              },
            ],
          },
        ],
      },
      {
        id: "sc-8",
        class: "SP800-53",
        title: "Transmission Confidentiality and Integrity",
        family: "SC",
        isOtOverlay: true,
        baselines: ["moderate", "high", "ot-ics"],
        params: [
          {
            id: "sc-8_prm_1",
            label: "transmission protection attribute",
            values: ["confidentiality and integrity"],
          },
        ],
        parts: [
          {
            id: "sc-8_smt",
            name: "statement",
            prose: "Protect the {{ insert: param, sc-8_prm_1 }} of transmitted information.",
          },
        ],
      },
    ],
  },
  {
    id: "si",
    class: "family",
    title: "System and Information Integrity",
    controls: [
      {
        id: "si-4",
        class: "SP800-53",
        title: "System Monitoring",
        family: "SI",
        isOtOverlay: true,
        baselines: ["low", "moderate", "high", "ot-ics"],
        params: [
          {
            id: "si-4_prm_1",
            label: "monitoring techniques and physics-based anomaly detection",
            values: ["deep packet inspection for industrial protocols and physical process invariant checks"],
          },
        ],
        parts: [
          {
            id: "si-4_smt",
            name: "statement",
            prose:
              "Monitor the system to detect attacks, indicators of potential attacks, and unauthorized local, network, and remote connections using {{ insert: param, si-4_prm_1 }}.",
          },
        ],
      },
      {
        id: "si-7",
        class: "SP800-53",
        title: "Software, Firmware, and Information Integrity",
        family: "SI",
        isOtOverlay: true,
        baselines: ["moderate", "high", "ot-ics"],
        params: [
          {
            id: "si-7_prm_1",
            label: "integrity verification targets",
            values: ["PLC/IED firmware images, ladder/ST control logic, and safety parameters"],
          },
        ],
        parts: [
          {
            id: "si-7_smt",
            name: "statement",
            prose:
              "Employ integrity verification tools to detect unauthorized changes to {{ insert: param, si-7_prm_1 }}.",
          },
          {
            id: "si-7_ot",
            name: "ot-guidance",
            prose:
              "NIST SP 800-82 Rev 3: Verify cryptographic hashes/signatures of controller firmware and control logic before loading onto PLCs or IEDs.",
          },
        ],
      },
    ],
  },
  {
    id: "sr",
    class: "family",
    title: "Supply Chain Risk Management",
    controls: [
      {
        id: "sr-3",
        class: "SP800-53",
        title: "Supply Chain Controls and Processes",
        family: "SR",
        baselines: ["low", "moderate", "high", "ot-ics"],
        parts: [
          {
            id: "sr-3_smt",
            name: "statement",
            prose:
              "Establish a process to identify and address weaknesses or deficiencies in the supply chain elements and processes of hardware, firmware, and software components.",
          },
        ],
      },
      {
        id: "sr-4",
        class: "SP800-53",
        title: "Provenance",
        family: "SR",
        isOtOverlay: true,
        baselines: ["high", "ot-ics"],
        parts: [
          {
            id: "sr-4_smt",
            name: "statement",
            prose:
              "Document, monitor, and maintain valid provenance of critical OT hardware, firmware, and software components.",
          },
        ],
      },
    ],
  },
];

export const NIST_800_53_REV5_CATALOG: OscalDocument = {
  kind: "catalog",
  uuid: "750918a8-0136-4e14-a92c-b1482047694b",
  metadata: {
    title: "NIST SP 800-53 Rev 5 Security and Privacy Controls + NIST SP 800-82 Rev 3 OT/ICS Overlay",
    version: "5.1.1",
    oscalVersion: "1.1.2",
  },
  groups: NIST_800_53_GROUPS,
  range: ZERO_RANGE,
};

const BUILTIN_CONTROLS_MAP = new Map<string, OscalControl>();

function indexControlsRecursive(controls: OscalControl[]): void {
  for (const ctrl of controls) {
    BUILTIN_CONTROLS_MAP.set(ctrl.id.toLowerCase(), ctrl);
    if (ctrl.controls) {
      indexControlsRecursive(ctrl.controls);
    }
  }
}

for (const group of NIST_800_53_GROUPS) {
  if (group.controls) {
    indexControlsRecursive(group.controls);
  }
}

export function getBuiltInControl(controlId: string): OscalControl | undefined {
  return BUILTIN_CONTROLS_MAP.get(controlId.trim().toLowerCase());
}

export function getAllBuiltInControls(): OscalControl[] {
  return Array.from(BUILTIN_CONTROLS_MAP.values());
}

export function getBaselineControlIds(baseline: "low" | "moderate" | "high" | "ot-ics"): string[] {
  const result: string[] = [];
  for (const ctrl of BUILTIN_CONTROLS_MAP.values()) {
    if (ctrl.baselines?.includes(baseline)) {
      result.push(ctrl.id);
    }
  }
  return result;
}

export const NIST_800_82_OT_OVERLAY_PROFILE: OscalDocument = {
  kind: "profile",
  uuid: "9b8f3524-7d4b-4e6a-8215-6110e83a9100",
  metadata: {
    title: "NIST SP 800-82 Rev 3 Operational Technology (OT) / ICS Security Baseline Profile",
    version: "3.0.0",
    oscalVersion: "1.1.2",
  },
  imports: [
    {
      href: "builtin://nist-sp-800-53-r5",
      includeControls: [...MANDATORY_OT_ICS_CONTROLS, "ac-4", "cm-7", "ia-3", "ra-5", "si-4"],
    },
  ],
  range: ZERO_RANGE,
};

export function resolveBuiltInProfileHref(href: string): {
  baseline?: "low" | "moderate" | "high" | "ot-ics" | undefined;
  requiredControlIds: string[];
  catalog: OscalDocument;
} {
  const lower = href.toLowerCase();
  if (lower.includes("800-82") || lower.includes("ot") || lower.includes("ics")) {
    return {
      baseline: "ot-ics",
      requiredControlIds: [...MANDATORY_OT_ICS_CONTROLS],
      catalog: NIST_800_53_REV5_CATALOG,
    };
  }
  if (lower.includes("low")) {
    return {
      baseline: "low",
      requiredControlIds: ["ac-1", "ac-2", "ac-3", "pe-3", "sc-7"],
      catalog: NIST_800_53_REV5_CATALOG,
    };
  }
  if (lower.includes("high")) {
    return {
      baseline: "high",
      requiredControlIds: ["ac-1", "ac-2", "ac-3", "ac-4", "cm-7", "ia-2", "pe-3", "sc-7", "si-4", "si-7"],
      catalog: NIST_800_53_REV5_CATALOG,
    };
  }
  if (lower.includes("moderate")) {
    return {
      baseline: "moderate",
      requiredControlIds: ["ac-1", "ac-2", "ac-3", "cm-7", "pe-3", "sc-7", "si-7"],
      catalog: NIST_800_53_REV5_CATALOG,
    };
  }
  return {
    requiredControlIds: [],
    catalog: NIST_800_53_REV5_CATALOG,
  };
}
