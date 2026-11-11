// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import {
  HUB_DOMAIN_FILTERS,
  HUB_GALLERY_COMPONENTS,
  type HubComponentItem,
  type HubDomainId,
} from "./component-hub-catalog.js";
import { DiagramEditorProvider } from "./diagram-editor-provider.js";
import { getRegistryUrl, isAirgapped } from "./utils/config.js";
import { getNonce } from "./utils/nonce.js";

const VALID_PACKAGE_NAME_RE = /^(?:@[a-zA-Z0-9._-]+\/)?[a-zA-Z0-9._-]+$/;
const VALID_VERSION_RE = /^[a-zA-Z0-9.+_-]+$/;

function isValidPackageName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed || trimmed.includes("..") || trimmed.includes("\\")) return false;
  return VALID_PACKAGE_NAME_RE.test(trimmed);
}

function isValidVersionSpec(version: string): boolean {
  const trimmed = version.trim();
  if (!trimmed || trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) return false;
  return VALID_VERSION_RE.test(trimmed);
}

function isAllowedImportUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === "https:") return true;
    if (parsed.protocol === "http:" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export interface LspClientLike {
  sendNotification: (method: string, params: unknown) => void;
  sendRequest?: (<R = unknown>(method: string, params?: unknown) => Promise<R>) | undefined;
}

export interface AnsatzPackageSummary {
  name: string;
  versions?: string[] | undefined;
  latestVersion?: string | null | undefined;
  description?: string | undefined;
  license?: string | undefined;
  author?: string | undefined;
  scope?: string | undefined;
  totalDownloads?: number | undefined;
  downloads30d?: number | undefined;
  domains?: string[] | undefined;
  domainId?: Exclude<HubDomainId, "all"> | undefined;
  language?: string | undefined;
  isDeprecated?: boolean | undefined;
  dependencies?: Record<string, string> | undefined;
  components?: { name: string; kind: string; description?: string | undefined }[] | undefined;
  verified?: boolean | undefined;
  readme?: string | undefined;
}

export interface RegistryPackument {
  name: string;
  version: string;
  description?: string | undefined;
  modelicaVersion?: string | undefined;
  license?: string | undefined;
  size?: number | undefined;
}

interface PackageQuickPickItem extends vscode.QuickPickItem {
  pkg?: AnsatzPackageSummary | undefined;
  actionCommand?: string | undefined;
}

interface MountedLibSnapshot {
  name: string;
  version: string;
  explicitlyInstalled?: boolean | undefined;
}

const PINNED_QUICK_ACTIONS: PackageQuickPickItem[] = [
  {
    label: "$(circuit-board) Open Model Gallery...",
    description: "Visual schematic diagrams",
    detail: "Browse and open runnable models with schematic diagrams from examples, Ansatz libraries, or files",
    alwaysShow: true,
    actionCommand: "modelscript.openModelGallery",
  },
  {
    label: "$(file-zip) Import Library from .zip Archive...",
    description: "Local file",
    detail: "Mount a local .zip library archive directly into the workspace Libraries panel",
    alwaysShow: true,
    actionCommand: "modelscript.libraryView.importZip",
  },
  {
    label: "$(cloud-download) Import Library from URL...",
    description: "GitHub / HTTP .zip",
    detail: "Download and mount a .zip library archive from any URL",
    alwaysShow: true,
    actionCommand: "modelscript.libraryView.importUrl",
  },
];

export const CURATED_LIBRARIES: AnsatzPackageSummary[] = [
  {
    name: "Modelica",
    latestVersion: "4.1.0",
    versions: ["4.1.0", "4.0.0", "3.2.3"],
    description:
      "Modelica Standard Library (MSL) — multi-domain physical modeling across Electrical, Mechanics, Fluids, Thermal & Control Blocks.",
    license: "BSD-3-Clause",
    domains: ["Modelica", "Electrical", "Mechanics", "Fluids & Thermal", "Control Blocks"],
    domainId: "electrical",
    language: "Modelica",
    totalDownloads: 148200,
    verified: true,
    dependencies: { Complex: ">=4.0.0" },
    components: [
      {
        name: "Modelica.Electrical.Analog.Basic.Resistor",
        kind: "model",
        description: "Ideal linear electrical resistor (v = R·i)",
      },
      {
        name: "Modelica.Electrical.Analog.Basic.Capacitor",
        kind: "model",
        description: "Ideal linear electrical capacitor (i = C·der(v))",
      },
      {
        name: "Modelica.Electrical.Analog.Basic.Inductor",
        kind: "model",
        description: "Ideal linear electrical inductor (v = L·der(i))",
      },
      {
        name: "Modelica.Electrical.Analog.Basic.Ground",
        kind: "model",
        description: "Zero-potential electrical reference node",
      },
      {
        name: "Modelica.Mechanics.Rotational.Components.Inertia",
        kind: "model",
        description: "1D rotational inertia with dual shaft flanges",
      },
      {
        name: "Modelica.Blocks.Continuous.PID",
        kind: "block",
        description: "Continuous PID controller with anti-windup",
      },
    ],
  },
  {
    name: "Buildings",
    latestVersion: "11.0.0",
    versions: ["11.0.0", "10.0.0"],
    description:
      "LBNL Modelica Buildings Library — hydronic HVAC, centrifugal pumps, modulating valves, heat exchangers & district energy.",
    license: "BSD-3-Clause",
    domains: ["Modelica", "Fluids & Thermal", "HVAC"],
    domainId: "fluids-thermal",
    language: "Modelica",
    totalDownloads: 54300,
    verified: true,
    dependencies: { Modelica: ">=4.0.0" },
    components: [
      {
        name: "Buildings.Fluid.Movers.FlowControlled_m_flow",
        kind: "model",
        description: "Hydronic centrifugal pump / fan mover",
      },
      {
        name: "Buildings.Fluid.Actuators.TwoWayEqualPercentage",
        kind: "model",
        description: "Modulating two-way hydronic control valve",
      },
      {
        name: "Buildings.Fluid.MixingVolumes.MixingVolume",
        kind: "model",
        description: "Well-mixed thermofluid tank or room zone volume",
      },
    ],
  },
  {
    name: "PlanarMechanics",
    latestVersion: "1.6.1",
    versions: ["1.6.1", "1.6.0"],
    description:
      "DLR 2D planar multi-body mechanical systems — revolute/prismatic joints, rigid links, gear trains & kinematic loops.",
    license: "BSD-3-Clause",
    domains: ["Modelica", "Mechanics", "MultiBody"],
    domainId: "mechanics",
    language: "Modelica",
    totalDownloads: 41800,
    verified: true,
    dependencies: { Modelica: ">=4.0.0" },
    components: [
      { name: "PlanarMechanics.Joints.Revolute", kind: "model", description: "2D planar 1-DOF revolute pin joint" },
      {
        name: "PlanarMechanics.Parts.BodyCylinder",
        kind: "model",
        description: "2D rigid planar link with mass and inertia",
      },
    ],
  },
  {
    name: "SysML",
    latestVersion: "2026.3.0",
    versions: ["2026.3.0", "2025.1.0"],
    description:
      "OMG Systems Modeling Language (SysML v2) & KerML Standard Library — ISO 80000 quantities, requirements & architecture views.",
    license: "OMG-SysML-2.0",
    domains: ["SysML v2", "Systems Engineering"],
    domainId: "systems",
    language: "SysML v2",
    totalDownloads: 94100,
    verified: true,
    components: [
      { name: "SysML.ISQ.Length", kind: "part def", description: "ISO 80000 SI base length dimension and unit" },
      { name: "SysML.ISQ.Mass", kind: "part def", description: "ISO 80000 SI base mass dimension and kilogram unit" },
      {
        name: "SysML.StandardViews.BlockDefinitionDiagram",
        kind: "view def",
        description: "Structural system architecture viewpoint",
      },
    ],
  },
  {
    name: "Complex",
    latestVersion: "4.1.0",
    versions: ["4.1.0", "4.0.0"],
    description: "Modelica Complex Numbers Standard Library for AC phasor power systems and frequency-domain physics.",
    license: "BSD-3-Clause",
    domains: ["Modelica", "Electrical", "Power Grids"],
    domainId: "electrical",
    language: "Modelica",
    totalDownloads: 62000,
    verified: true,
    dependencies: { Modelica: ">=4.0.0" },
  },
  {
    name: "OpenIPSL",
    latestVersion: "3.1.0",
    versions: ["3.1.0"],
    description:
      "Open-Instance Power System Library (OpenIPSL) — phasor time-domain power system dynamic simulation, synchronous machines, AVRs, PSS, renewable generation & transmission grids.",
    license: "BSD-3-Clause",
    domains: ["Modelica", "Electrical", "Power Grids", "Dynamics"],
    domainId: "power-grids",
    language: "Modelica",
    totalDownloads: 48500,
    verified: true,
    dependencies: { Modelica: ">=4.0.0", Complex: ">=4.0.0" },
    components: [
      {
        name: "OpenIPSL.Electrical.Machines.PSSE.GENROU",
        kind: "model",
        description: "Round rotor synchronous generator model (PSSE GENROU)",
      },
      {
        name: "OpenIPSL.Electrical.Controls.PSSE.ES.ESST1A",
        kind: "model",
        description: "IEEE type ST1A excitation system model",
      },
      {
        name: "OpenIPSL.Electrical.Controls.PSSE.TG.TGOV1",
        kind: "model",
        description: "Steam turbine-governor model (TGOV1)",
      },
      {
        name: "OpenIPSL.Electrical.Controls.PSSE.PSS.PSS2A",
        kind: "model",
        description: "Dual-input power system stabilizer (PSS2A)",
      },
      {
        name: "OpenIPSL.Electrical.Branches.Line",
        kind: "model",
        description: "Phasor transmission line model with distributed parameters",
      },
      { name: "OpenIPSL.Electrical.Buses.Bus", kind: "model", description: "Phasor AC power grid bus node" },
    ],
  },
  {
    name: "SPICE-Standard",
    latestVersion: "1.0.0",
    versions: ["1.0.0"],
    description:
      "Standard discrete semiconductor diodes (1N4148), bipolar transistors (2N2222), power MOSFETs & op-amp macromodels.",
    license: "BSD-3-Clause",
    domains: ["Electrical", "SPICE", "Electronics"],
    domainId: "electrical",
    language: "SPICE",
    totalDownloads: 38400,
    verified: true,
    components: [
      { name: "SPICE.Semiconductors.Diode1N4148", kind: "model", description: "High-speed silicon switching PN diode" },
      { name: "SPICE.Semiconductors.MOSFET_NMOS", kind: "model", description: "Enhancement-mode N-channel MOSFET" },
      {
        name: "SPICE.Semiconductors.Transistor2N2222",
        kind: "model",
        description: "General-purpose NPN bipolar junction transistor",
      },
    ],
  },
  {
    name: "IEEE-Test-Feeders",
    latestVersion: "1.0.0",
    versions: ["1.0.0"],
    description: "IEEE 13-Bus, 34-Bus, 123-Bus & 8500-Node unbalanced 3-phase OpenDSS distribution test feeders.",
    license: "Apache-2.0",
    domains: ["Power Grids", "OpenDSS", "Distribution"],
    domainId: "power-grids",
    language: "OpenDSS",
    totalDownloads: 27900,
    verified: true,
    components: [
      { name: "IEEEFeeders.IEEE13Node", kind: "model", description: "Unbalanced 4.16 kV 13-node distribution feeder" },
    ],
  },
  {
    name: "PSSE-Standard-Dynamics",
    latestVersion: "1.0.0",
    versions: ["1.0.0"],
    description:
      "Standard IEEE & WECC synchronous generators (GENROU), exciters, governors & renewable IBR inverters (REGC_A).",
    license: "Apache-2.0",
    domains: ["Power Grids", "PSS/E", "Dynamics"],
    domainId: "power-grids",
    language: "PSS/E",
    totalDownloads: 22150,
    verified: true,
    components: [
      { name: "PSSEDynamics.GENROU", kind: "model", description: "Round-rotor synchronous turbine generator" },
      { name: "PSSEDynamics.REGC_A", kind: "model", description: "WECC grid-following solar PV / BESS inverter" },
    ],
  },
  {
    name: "IEEE-Transmission-Benchmarks",
    latestVersion: "1.0.0",
    versions: ["1.0.0"],
    description: "Standard IEEE 14, 30, 57, 118 & 300-bus bulk transmission test networks with bus coordinates.",
    license: "CC0-1.0",
    domains: ["Power Grids", "PSS/E", "Transmission"],
    domainId: "power-grids",
    language: "PSS/E",
    totalDownloads: 19800,
    verified: true,
  },
  {
    name: "Standard-Robots",
    latestVersion: "1.0.0",
    versions: ["1.0.0"],
    description:
      "Industrial & collaborative robot kinematic and dynamic manipulators (Universal Robots UR5, Franka Panda, KUKA).",
    license: "BSD-3-Clause",
    domains: ["Robotics & CAD", "URDF", "Robotics"],
    domainId: "robotics-cad",
    language: "URDF",
    totalDownloads: 31500,
    verified: true,
    components: [
      { name: "StandardRobots.UR5", kind: "model", description: "Universal Robots UR5 6-DOF articulated arm" },
      {
        name: "StandardRobots.FrankaPanda",
        kind: "model",
        description: "Franka Emika Panda 7-DOF torque-controlled arm",
      },
    ],
  },
  {
    name: "AUTOSAR-Metamodels",
    latestVersion: "4.4.0",
    versions: ["4.4.0"],
    description:
      "AUTOSAR Classic & Adaptive software component definitions, sender-receiver port interfaces & ECU templates.",
    license: "AUTOSAR-Standard",
    domains: ["Systems", "AUTOSAR", "Embedded"],
    domainId: "systems",
    language: "AUTOSAR",
    totalDownloads: 14800,
    verified: true,
    components: [
      {
        name: "AUTOSAR.ApplicationSwComponentType",
        kind: "block",
        description: "AUTOSAR Atomic Application Software Component",
      },
    ],
  },
  {
    name: "EPANET-Benchmark-Networks",
    latestVersion: "2.2.0",
    versions: ["2.2.0", "1.0.0"],
    description:
      "Municipal pressurized water distribution networks (Net1, Net3, Hanoi), Hazen-Williams pipes & pump stations.",
    license: "Public-Domain",
    domains: ["Fluids & Thermal", "EPANET", "Hydraulics"],
    domainId: "fluids-thermal",
    language: "EPANET",
    totalDownloads: 16200,
    verified: true,
    components: [
      {
        name: "EPANET.PressurizedPipe",
        kind: "model",
        description: "Hazen-Williams municipal water distribution pipe",
      },
    ],
  },
  {
    name: "SWMM-Reference-Networks",
    latestVersion: "5.2.0",
    versions: ["5.2.0", "1.0.0"],
    description:
      "EPA SWMM urban stormwater runoff catchments, detention basins, culverts & open-channel routing networks.",
    license: "Public-Domain",
    domains: ["Fluids & Thermal", "SWMM", "Hydrology"],
    domainId: "fluids-thermal",
    language: "SWMM",
    totalDownloads: 12400,
    verified: true,
  },
  {
    name: "STEP-Fasteners",
    latestVersion: "1.0.0",
    versions: ["1.0.0"],
    description:
      "ISO 4762 socket head cap screws, ISO 4017 hex bolts & ISO 4032 nuts parametric B-Rep CAD fastener catalog.",
    license: "CC0-1.0",
    domains: ["Robotics & CAD", "STEP", "Mechanical"],
    domainId: "robotics-cad",
    language: "STEP",
    totalDownloads: 21000,
    verified: true,
    components: [
      {
        name: "STEPFasteners.M8x30_SocketCapScrew",
        kind: "record",
        description: "ISO 4762 M8×30 socket head cap screw",
      },
    ],
  },
];

/** In-memory mounted package tracker for single-file / virtual workspaces or notification-only clients. */
const sessionInstalledPackages = new Map<string, string>();

let activePackageHubPanel: vscode.WebviewPanel | undefined;
let lastActiveModelUri: string | undefined;

function isUntrustedWorkspace(): boolean {
  return (vscode.workspace as { isTrusted?: boolean | undefined }).isTrusted === false;
}

function recordActiveModelUri(uriStr?: string | undefined): void {
  if (!uriStr) return;
  if (
    uriStr.startsWith("output:") ||
    uriStr.startsWith("vscode:") ||
    uriStr.startsWith("debug:") ||
    uriStr.endsWith("/package.json")
  ) {
    return;
  }
  lastActiveModelUri = uriStr;
}

function findTargetModelOrDiagramUri(): string | undefined {
  const activeDoc = vscode.window.activeTextEditor?.document?.uri?.toString();
  if (activeDoc && !activeDoc.endsWith("/package.json") && !activeDoc.startsWith("output:")) {
    return activeDoc;
  }

  const visibleEditors = (vscode.window as { visibleTextEditors?: readonly vscode.TextEditor[] | undefined })
    .visibleTextEditors;
  if (Array.isArray(visibleEditors)) {
    for (const ed of visibleEditors) {
      const u = ed?.document?.uri?.toString();
      if (u && !u.endsWith("/package.json") && !u.startsWith("output:")) {
        return u;
      }
    }
  }

  const tabGroups = (vscode.window as { tabGroups?: { all?: readonly { tabs?: readonly unknown[] }[] } | undefined })
    .tabGroups;
  if (tabGroups && Array.isArray(tabGroups.all)) {
    for (const group of tabGroups.all) {
      if (!Array.isArray(group.tabs)) continue;
      for (const rawTab of group.tabs) {
        const input = (
          rawTab as { input?: { uri?: vscode.Uri | undefined; viewType?: string | undefined } | undefined }
        )?.input;
        if (input?.uri) {
          const u = input.uri.toString();
          if (!u.endsWith("/package.json") && !u.startsWith("output:")) {
            return u;
          }
        }
      }
    }
  }

  return lastActiveModelUri;
}

/**
 * Fetches matching packages from the Ansatz registry (`/api/v1/packages` with fallback to `/api/v1/libraries`).
 */
export async function searchAnsatzPackages(query: string, signal?: AbortSignal): Promise<AnsatzPackageSummary[]> {
  const baseUrl = getRegistryUrl().replace(/\/+$/, "");
  if (isAirgapped()) {
    try {
      const parsed = new URL(baseUrl);
      const h = parsed.hostname.toLowerCase();
      if (
        h === "api.modelscript.org" ||
        h.endsWith(".modelscript.org") ||
        h === "ansatz.social" ||
        h.endsWith(".ansatz.social")
      ) {
        return [];
      }
    } catch {
      return [];
    }
  }
  const encodedQuery = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
  const endpoints = [`${baseUrl}/packages${encodedQuery}`, `${baseUrl}/libraries${encodedQuery}`];

  let lastError: unknown;
  for (const url of endpoints) {
    try {
      const resp = await fetch(url, signal ? { signal } : undefined);
      if (!resp.ok) {
        lastError = new Error(`HTTP ${resp.status}`);
        continue;
      }
      const data = (await resp.json()) as { packages?: AnsatzPackageSummary[] | undefined };
      if (Array.isArray(data.packages)) {
        return data.packages;
      }
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") {
        throw err;
      }
      lastError = err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "Failed to reach Ansatz registry"));
}

function toQuickPickItem(pkg: AnsatzPackageSummary): PackageQuickPickItem {
  const version = pkg.latestVersion || pkg.versions?.[0] || "latest";
  const domainBadges = pkg.domains && pkg.domains.length > 0 ? ` · [${pkg.domains.join(", ")}]` : "";
  const downloads =
    typeof pkg.totalDownloads === "number" && pkg.totalDownloads > 0
      ? ` · $(cloud-download) ${pkg.totalDownloads}`
      : "";
  const deprecated = pkg.isDeprecated ? " $(warning) [Deprecated]" : "";

  return {
    label: `$(package) ${pkg.name}`,
    description: `v${version}${domainBadges}${downloads}${deprecated}`,
    detail: pkg.description || `Install ${pkg.name}@${version} from Ansatz into Libraries`,
    alwaysShow: true,
    buttons: [
      {
        iconPath: new vscode.ThemeIcon("info"),
        tooltip: "View Package Details",
      },
    ],
    pkg,
  };
}

/**
 * Opens an interactive VS Code QuickPick that searches Ansatz live and installs the chosen package
 * directly into the workspace and Libraries tree view.
 */
export async function showAnsatzPackagePicker(): Promise<void> {
  const quickPick = vscode.window.createQuickPick<PackageQuickPickItem>();
  quickPick.title = "Add Library to Workspace";
  quickPick.placeholder =
    "Search Ansatz packages by name, domain, or keyword (e.g., Modelica, SysML, Buildings, PlanarMechanics)...";
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let activeAbort: AbortController | null = null;

  const filterCurated = (q: string): AnsatzPackageSummary[] => {
    const trimmed = q.trim().toLowerCase();
    if (!trimmed) return CURATED_LIBRARIES;
    return CURATED_LIBRARIES.filter(
      (c) =>
        c.name.toLowerCase().includes(trimmed) ||
        (c.description && c.description.toLowerCase().includes(trimmed)) ||
        c.domains?.some((d) => d.toLowerCase().includes(trimmed)),
    );
  };

  const runSearch = async (query: string) => {
    if (activeAbort) {
      activeAbort.abort();
    }
    const controller = new AbortController();
    activeAbort = controller;
    quickPick.busy = true;

    try {
      const results = await searchAnsatzPackages(query, controller.signal);
      if (controller.signal.aborted) return;

      const seen = new Set(results.map((r) => r.name.toLowerCase()));
      const extraCurated = filterCurated(query).filter((c) => !seen.has(c.name.toLowerCase()));
      const merged = [...results.slice(0, 50), ...extraCurated];

      if (merged.length === 0 && query.trim().length > 0) {
        const [rawName, rawVer] = query.trim().split("@");
        const directPkg: AnsatzPackageSummary = {
          name: rawName || query.trim(),
          latestVersion: rawVer || "latest",
          description: `Install '${query.trim()}' directly from Ansatz registry`,
        };
        quickPick.items = [toQuickPickItem(directPkg), ...PINNED_QUICK_ACTIONS];
      } else {
        quickPick.items = [...merged.map(toQuickPickItem), ...PINNED_QUICK_ACTIONS];
      }
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      const raw = query.trim();
      const curated = filterCurated(raw).map(toQuickPickItem);
      if (raw.length > 0) {
        const [rawName, rawVer] = raw.split("@");
        quickPick.items = [
          toQuickPickItem({
            name: rawName || raw,
            latestVersion: rawVer || "latest",
            description: `Install '${raw}' from Ansatz (${getRegistryUrl()})`,
          }),
          ...curated,
          ...PINNED_QUICK_ACTIONS,
        ];
      } else {
        quickPick.items = [...curated, ...PINNED_QUICK_ACTIONS];
      }
    } finally {
      if (activeAbort === controller) {
        quickPick.busy = false;
      }
    }
  };

  quickPick.onDidChangeValue((value) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      void runSearch(value);
    }, 220);
  });

  quickPick.onDidTriggerItemButton((event) => {
    const { pkg } = event.item;
    if (!pkg) return;
    const version = pkg.latestVersion || pkg.versions?.[0] || "latest";
    quickPick.hide();
    void vscode.commands.executeCommand("modelscript.registry.openPackage", pkg.name, version);
  });

  quickPick.onDidAccept(async () => {
    const selected = quickPick.selectedItems[0];
    if (!selected) return;
    quickPick.hide();

    if (selected.actionCommand) {
      await vscode.commands.executeCommand(selected.actionCommand);
      return;
    }

    const { pkg } = selected;
    if (!pkg) return;
    let targetVersion = pkg.latestVersion || pkg.versions?.[0] || "latest";

    if (pkg.versions && pkg.versions.length > 1) {
      const versionItems: (vscode.QuickPickItem & { version: string })[] = pkg.versions.map((v, idx) =>
        idx === 0 ? { label: v, description: "(latest)", version: v } : { label: v, version: v },
      );
      const pickedVer = await vscode.window.showQuickPick(versionItems, {
        title: `Select Version for ${pkg.name}`,
        placeHolder: `Choose version of ${pkg.name} to add to Libraries`,
      });
      if (!pickedVer) return;
      targetVersion = pickedVer.version;
    }

    await vscode.commands.executeCommand("modelscript.registry.install", pkg.name, targetVersion);
  });

  quickPick.onDidHide(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (activeAbort) activeAbort.abort();
    quickPick.dispose();
  });

  quickPick.show();
  void runSearch("");
}

/**
 * Resolves `"latest"` version against Ansatz if needed so the LSP loader receives a concrete semver when available.
 */
async function resolveConcreteVersion(packageName: string, requestedVersion: string): Promise<string> {
  if (requestedVersion && requestedVersion !== "latest") {
    return requestedVersion;
  }
  const curated = CURATED_LIBRARIES.find((c) => c.name.toLowerCase() === packageName.toLowerCase());
  const baseUrl = getRegistryUrl().replace(/\/+$/, "");
  if (isAirgapped()) {
    try {
      const parsed = new URL(baseUrl);
      const h = parsed.hostname.toLowerCase();
      if (
        h === "api.modelscript.org" ||
        h.endsWith(".modelscript.org") ||
        h === "ansatz.social" ||
        h.endsWith(".ansatz.social")
      ) {
        return curated?.latestVersion || requestedVersion || "latest";
      }
    } catch {
      return curated?.latestVersion || requestedVersion || "latest";
    }
  }
  for (const prefix of ["packages", "libraries"]) {
    try {
      const resp = await fetch(`${baseUrl}/${prefix}/${encodeURIComponent(packageName)}`);
      if (resp.ok) {
        const data = (await resp.json()) as { latestVersion?: string | undefined; versions?: string[] | undefined };
        if (data.latestVersion) return data.latestVersion;
        const firstVer = Array.isArray(data.versions) ? data.versions[0] : undefined;
        if (firstVer) return firstVer;
      }
    } catch {
      // Fall through to curated version
    }
  }
  if (curated?.latestVersion) return curated.latestVersion;
  return requestedVersion || "latest";
}

function extractPackageNameFromArg(
  arg?:
    | string
    | { info?: { name?: string | undefined; id?: string | undefined; description?: string | undefined } | undefined },
): {
  name?: string | undefined;
  currentVersion?: string | undefined;
} {
  if (typeof arg === "string") {
    return { name: arg };
  }
  const name =
    typeof arg?.info?.name === "string"
      ? arg.info.name
      : typeof arg?.info?.id === "string"
        ? arg.info.id.replace(/^__LIB__:/, "")
        : undefined;
  const rawDesc = typeof arg?.info?.description === "string" ? arg.info.description : undefined;
  const currentVersion = rawDesc?.startsWith("v") ? rawDesc.slice(1).split(" ")[0] : undefined;
  return { name, currentVersion };
}

async function installViaLsp(lspClient: LspClientLike | undefined, name: string, version: string): Promise<void> {
  if (!lspClient) return;
  if (typeof lspClient.sendRequest === "function") {
    const res = await lspClient.sendRequest<{
      ok?: boolean | undefined;
      name?: string | undefined;
      version?: string | undefined;
      error?: string | undefined;
    }>("modelscript/installPackage", { name, version });
    if (res && res.ok === false) {
      throw new Error(res.error || `Failed to mount ${name}@${version}`);
    }
  } else {
    lspClient.sendNotification("modelscript/installDependency", { name, version });
  }
}

async function uninstallViaLsp(lspClient: LspClientLike | undefined, name: string): Promise<void> {
  if (!lspClient) return;
  if (typeof lspClient.sendRequest === "function") {
    await lspClient.sendRequest("modelscript/uninstallPackage", { name });
  } else {
    lspClient.sendNotification("modelscript/uninstallDependency", { name });
  }
}

export function registerRegistryView(context: vscode.ExtensionContext, lspClient?: LspClientLike): void {
  recordActiveModelUri(vscode.window.activeTextEditor?.document?.uri?.toString());
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      recordActiveModelUri(editor?.document?.uri?.toString());
    }),
  );

  const openPicker = async () => {
    await showAnsatzPackagePicker();
  };

  const openHub = (initialPackageName?: string) => {
    openAnsatzPackageHub(context, lspClient, initialPackageName);
  };

  // Register unified Libraries '+' button to open visual Component & Library Hub directly
  context.subscriptions.push(
    vscode.commands.registerCommand("modelscript.libraryView.addPackage", () => openHub()),
    vscode.commands.registerCommand("modelscript.openPackageHub", (pkg?: string) => openHub(pkg)),
    vscode.commands.registerCommand("modelscript.openRegistry", () => openHub()),
    vscode.commands.registerCommand("modelscript.registry.search", openPicker),
    vscode.commands.registerCommand("modelscript.registry.quickPick", openPicker),
  );

  // Install package from Ansatz into Libraries & workspace package.json
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "modelscript.registry.install",
      async (packageName?: string, packageVersion = "latest"): Promise<boolean> => {
        if (isUntrustedWorkspace()) {
          vscode.window.showErrorMessage("Cannot install packages in an untrusted workspace.");
          return false;
        }
        if (!packageName || typeof packageName !== "string") {
          await showAnsatzPackagePicker();
          return false;
        }
        if (!isValidPackageName(packageName) || !isValidVersionSpec(packageVersion)) {
          vscode.window.showErrorMessage(`Invalid package name or version: '${packageName}@${packageVersion}'.`);
          return false;
        }

        const resolvedVersion = await resolveConcreteVersion(packageName, packageVersion);
        if (!isValidVersionSpec(resolvedVersion)) {
          vscode.window.showErrorMessage(`Invalid resolved version '${resolvedVersion}' for package '${packageName}'.`);
          return false;
        }

        let succeeded = false;
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Adding ${packageName}@${resolvedVersion} to Libraries...`,
            cancellable: false,
          },
          async () => {
            try {
              const currentInstalled = await getEffectiveInstalledDependencies(lspClient);

              // Requirement 3: Automatic peer-dependency version bump & auto-mount
              const targetCurated = CURATED_LIBRARIES.find((c) => c.name.toLowerCase() === packageName.toLowerCase());
              const autoBumpedDeps: Array<{ depName: string; bumped: string; from?: string | undefined }> = [];
              if (targetCurated?.dependencies) {
                for (const [depName, reqVer] of Object.entries(targetCurated.dependencies)) {
                  const minVer = reqVer.replace(/^[\^~>=<\s]+/, "").trim();
                  if (!minVer) continue;
                  const existingEntry = Object.entries(currentInstalled).find(
                    ([k]) => k.toLowerCase() === depName.toLowerCase(),
                  );
                  const curVer = existingEntry?.[1];
                  if (!curVer) {
                    autoBumpedDeps.push({ depName, bumped: minVer });
                  } else if (
                    reqVer.startsWith(">=") &&
                    curVer.localeCompare(minVer, undefined, { numeric: true }) < 0
                  ) {
                    autoBumpedDeps.push({ depName, bumped: minVer, from: curVer });
                  }
                }
              }

              // 1. Update workspace package.json if a workspace folder is open
              const folders = (vscode.workspace as { workspaceFolders?: readonly { uri: vscode.Uri }[] | undefined })
                .workspaceFolders;
              const targetFolder = folders?.[0];
              if (targetFolder) {
                try {
                  const packageJsonUri = vscode.Uri.joinPath(targetFolder.uri, "package.json");
                  let packageJsonObj: { dependencies?: Record<string, string> | undefined } = {};
                  try {
                    const data = await vscode.workspace.fs.readFile(packageJsonUri);
                    packageJsonObj = JSON.parse(new TextDecoder().decode(data)) as {
                      dependencies?: Record<string, string> | undefined;
                    };
                  } catch {
                    // Create or ignore if package.json does not exist yet
                  }
                  const depsMap: Record<string, string> = packageJsonObj.dependencies || {};
                  depsMap[packageName] = resolvedVersion;
                  for (const dep of autoBumpedDeps) {
                    depsMap[dep.depName] = dep.bumped;
                  }
                  packageJsonObj.dependencies = depsMap;
                  const encoded = new TextEncoder().encode(JSON.stringify(packageJsonObj, null, 2));
                  await vscode.workspace.fs.writeFile(packageJsonUri, encoded);
                } catch {
                  // Non-fatal if workspace is read-only or virtual without package.json
                }
              }

              // 2. Mount peer dependencies first if bumped/missing, then target package in LSP VFS
              for (const dep of autoBumpedDeps) {
                await installViaLsp(lspClient, dep.depName, dep.bumped);
                sessionInstalledPackages.set(dep.depName, dep.bumped);
                if (dep.from) {
                  void vscode.window.showInformationMessage(
                    `Auto-bumped ${dep.depName} from v${dep.from} to v${dep.bumped} for compatibility with ${packageName}@${resolvedVersion}.`,
                  );
                }
              }

              await installViaLsp(lspClient, packageName, resolvedVersion);
              sessionInstalledPackages.set(packageName, resolvedVersion);
              succeeded = true;

              await vscode.commands.executeCommand("modelscript.libraryView.refresh");
              if (activePackageHubPanel) {
                await postInstalledPackages(activePackageHubPanel, lspClient);
              }
            } catch (err) {
              vscode.window.showErrorMessage(`Failed to add package '${packageName}': ${err}`);
            }
          },
        );
        return succeeded;
      },
    ),
  );

  // Switch version command for any mounted library (standard or custom)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "modelscript.libraryView.switchVersion",
      async (arg?: string | { info?: { name?: string; id?: string; description?: string } }) => {
        const { name: extractedName, currentVersion } = extractPackageNameFromArg(arg);
        const packageName =
          extractedName ||
          (typeof vscode.window.showInputBox === "function"
            ? (
                await vscode.window.showInputBox({
                  prompt: "Enter library name to switch version",
                })
              )?.trim()
            : undefined);
        if (!packageName) return;

        let versions: string[] = [];
        const baseUrl = getRegistryUrl().replace(/\/+$/, "");
        for (const prefix of ["packages", "libraries"]) {
          try {
            const resp = await fetch(`${baseUrl}/${prefix}/${encodeURIComponent(packageName)}`);
            if (resp.ok) {
              const data = (await resp.json()) as { versions?: string[]; latestVersion?: string };
              if (Array.isArray(data.versions) && data.versions.length > 0) {
                versions = data.versions;
                break;
              } else if (data.latestVersion) {
                versions = [data.latestVersion];
                break;
              }
            }
          } catch {
            // Fall through
          }
        }

        if (versions.length === 0) {
          const curated = CURATED_LIBRARIES.find((c) => c.name.toLowerCase() === packageName.toLowerCase());
          if (curated?.versions) {
            versions = curated.versions;
          } else if (currentVersion) {
            versions = [currentVersion];
          }
        }

        const items: (vscode.QuickPickItem & { version: string })[] = versions.map((v, idx) => ({
          label: `v${v}`,
          description: v === currentVersion ? "(currently mounted)" : idx === 0 ? "(latest)" : "",
          version: v,
        }));

        items.push({
          label: "$(edit) Enter custom version...",
          description: "Type a specific semver tag",
          version: "__CUSTOM__",
        });

        const picked = await vscode.window.showQuickPick(items, {
          title: `Switch Version for ${packageName}`,
          placeHolder: currentVersion
            ? `Currently mounted: v${currentVersion}. Select target version:`
            : `Select version of ${packageName} to mount:`,
        });
        if (!picked) return;

        let targetVersion = picked.version;
        if (targetVersion === "__CUSTOM__") {
          if (typeof vscode.window.showInputBox !== "function") return;
          const customInput = await vscode.window.showInputBox({
            prompt: `Enter version for ${packageName}`,
            value: currentVersion || "latest",
          });
          if (!customInput) return;
          targetVersion = customInput.trim();
        }

        await uninstallViaLsp(lspClient, packageName);
        await vscode.commands.executeCommand("modelscript.registry.install", packageName, targetVersion);
      },
    ),
  );

  // Open package details from tree item context menu
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "modelscript.libraryView.openPackageDetails",
      async (arg?: string | { info?: { name?: string; id?: string; description?: string } }) => {
        const { name, currentVersion } = extractPackageNameFromArg(arg);
        if (!name) return;
        await vscode.commands.executeCommand("modelscript.registry.openPackage", name, currentVersion || "latest");
      },
    ),
  );

  // Uninstall / remove package command
  const uninstallHandler = async (arg?: string | { info?: { name?: string; id?: string } }) => {
    if (isUntrustedWorkspace()) {
      vscode.window.showErrorMessage("Cannot remove packages in an untrusted workspace.");
      return;
    }
    let packageName = extractPackageNameFromArg(arg).name;

    if (!packageName) {
      const input =
        typeof vscode.window.showInputBox === "function"
          ? await vscode.window.showInputBox({ prompt: "Library name to remove from workspace" })
          : undefined;
      if (!input) return;
      packageName = input.trim();
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Removing ${packageName}...`,
        cancellable: false,
      },
      async () => {
        try {
          const folders = (vscode.workspace as { workspaceFolders?: readonly { uri: vscode.Uri }[] | undefined })
            .workspaceFolders;
          const targetFolder = folders?.[0];
          if (targetFolder) {
            try {
              const packageJsonUri = vscode.Uri.joinPath(targetFolder.uri, "package.json");
              const data = await vscode.workspace.fs.readFile(packageJsonUri);
              const packageJsonObj = JSON.parse(new TextDecoder().decode(data)) as {
                dependencies?: Record<string, string> | undefined;
                modelscript?: { dependencies?: Record<string, string> | undefined } | undefined;
              };
              let modified = false;
              if (packageJsonObj.dependencies) {
                Reflect.deleteProperty(packageJsonObj.dependencies, packageName);
                Reflect.deleteProperty(packageJsonObj.dependencies, `@modelscript/${packageName.toLowerCase()}`);
                modified = true;
              }
              if (packageJsonObj.modelscript?.dependencies) {
                Reflect.deleteProperty(packageJsonObj.modelscript.dependencies, packageName);
                Reflect.deleteProperty(
                  packageJsonObj.modelscript.dependencies,
                  `@modelscript/${packageName.toLowerCase()}`,
                );
                modified = true;
              }
              if (modified) {
                const encoded = new TextEncoder().encode(JSON.stringify(packageJsonObj, null, 2));
                await vscode.workspace.fs.writeFile(packageJsonUri, encoded);
              }
            } catch {
              // Ignore if no package.json
            }
          }

          for (const key of [...sessionInstalledPackages.keys()]) {
            if (key.toLowerCase() === packageName.toLowerCase()) {
              sessionInstalledPackages.delete(key);
            }
          }

          await uninstallViaLsp(lspClient, packageName);
          await vscode.commands.executeCommand("modelscript.libraryView.refresh");
          if (activePackageHubPanel) {
            await postInstalledPackages(activePackageHubPanel, lspClient);
          }
          vscode.window.showInformationMessage(`Removed ${packageName} from workspace.`);
        } catch (err) {
          vscode.window.showErrorMessage(`Failed to remove library '${packageName}': ${err}`);
        }
      },
    );
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("modelscript.registry.uninstall", uninstallHandler),
    vscode.commands.registerCommand("modelscript.libraryView.removePackage", uninstallHandler),
  );

  // Open package details / README in Ansatz Package Hub
  context.subscriptions.push(
    vscode.commands.registerCommand("modelscript.registry.openPackage", async (name: string, _version?: string) => {
      openAnsatzPackageHub(context, lspClient, name);
    }),
  );

  // Import library from a local .zip archive
  context.subscriptions.push(
    vscode.commands.registerCommand("modelscript.libraryView.importZip", async () => {
      if (isUntrustedWorkspace()) {
        vscode.window.showErrorMessage("Cannot import library archives in an untrusted workspace.");
        return;
      }
      try {
        if (typeof vscode.window.showOpenDialog !== "function") return;
        const picked = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          filters: { "Library Archive (.zip)": ["zip"] },
          openLabel: "Mount Library (.zip)",
        });
        const uri = picked?.[0];
        if (!uri) return;
        const bytes = await vscode.workspace.fs.readFile(uri);
        const fileName = uri.path.split("/").pop() || "Library.zip";
        const defaultName = fileName.replace(/\.zip$/i, "").split(/[-_ ]/)[0] || "CustomLibrary";
        let binary = "";
        const chunkSize = 8192;
        for (let i = 0; i < bytes.byteLength; i += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }
        const zipBase64 = btoa(binary);
        let mountedName = defaultName;
        let mountedVersion = "1.0.0";
        if (lspClient?.sendRequest) {
          const res = await lspClient.sendRequest<{
            ok?: boolean;
            name?: string;
            version?: string;
            error?: string;
          }>("modelscript/importLibraryZipReq", {
            name: defaultName,
            version: "1.0.0",
            zipBase64,
          });
          if (res?.ok === false) {
            throw new Error(res.error || `Failed to mount ${fileName}`);
          }
          if (res?.name) mountedName = res.name;
          if (res?.version) mountedVersion = res.version;
        } else if (lspClient) {
          lspClient.sendNotification("modelscript/importLibraryZip", {
            name: defaultName,
            version: "1.0.0",
            zipBase64,
          });
        }
        sessionInstalledPackages.set(mountedName, mountedVersion);
        await vscode.commands.executeCommand("modelscript.libraryView.refresh");
        if (activePackageHubPanel) {
          await postInstalledPackages(activePackageHubPanel, lspClient);
        }
        vscode.window.showInformationMessage(`Mounted library archive '${mountedName}' into Libraries.`);
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to import .zip library: ${err}`);
      }
    }),
  );

  // Import library from an HTTP/HTTPS URL
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "modelscript.libraryView.importUrl",
      async (passedUrl?: string, skipModalConfirm = false) => {
        if (isUntrustedWorkspace()) {
          vscode.window.showErrorMessage("Cannot import external library URLs in an untrusted workspace.");
          return;
        }
        const isProgrammaticUrl = typeof passedUrl === "string" && passedUrl.trim().length > 0;
        const url = isProgrammaticUrl
          ? passedUrl.trim()
          : typeof vscode.window.showInputBox === "function"
            ? (
                await vscode.window.showInputBox({
                  title: "Import Library from URL",
                  prompt: "Enter the URL of a .zip library archive (e.g., GitHub release or raw archive URL)",
                  placeHolder: "https://example.com/MyLibrary-1.0.0.zip",
                })
              )?.trim()
            : undefined;
        if (!url) return;

        if (!isAllowedImportUrl(url)) {
          vscode.window.showErrorMessage(
            "Only https:// (or localhost http://) URLs are allowed when importing library archives.",
          );
          return;
        }

        if (isProgrammaticUrl && !skipModalConfirm) {
          const confirm = await vscode.window.showWarningMessage(
            `Import and mount library archive from ${url}?`,
            { modal: true },
            "Import",
          );
          if (confirm !== "Import") return;
        }

        const fileName = url.split("/").pop()?.split("?")[0] || "Library.zip";
        const defaultName = fileName.replace(/\.zip$/i, "").split(/[-_ ]/)[0] || "CustomLibrary";
        try {
          let mountedName = defaultName;
          let mountedVersion = "1.0.0";
          if (lspClient?.sendRequest) {
            const res = await lspClient.sendRequest<{
              ok?: boolean;
              name?: string;
              version?: string;
              error?: string;
            }>("modelscript/importLibraryZipReq", {
              name: defaultName,
              version: "1.0.0",
              url,
            });
            if (res?.ok === false) {
              throw new Error(res.error || `Failed to import ${url}`);
            }
            if (res?.name) mountedName = res.name;
            if (res?.version) mountedVersion = res.version;
          } else if (lspClient) {
            lspClient.sendNotification("modelscript/importLibraryZip", {
              name: defaultName,
              version: "1.0.0",
              url,
            });
          }
          sessionInstalledPackages.set(mountedName, mountedVersion);
          await vscode.commands.executeCommand("modelscript.libraryView.refresh");
          if (activePackageHubPanel) {
            await postInstalledPackages(activePackageHubPanel, lspClient);
          }
          vscode.window.showInformationMessage(`Mounted library '${mountedName}' from ${url}.`);
        } catch (err) {
          vscode.window.showErrorMessage(`Failed to import library URL: ${err}`);
        }
      },
    ),
  );
}

export async function getWorkspaceDependencies(): Promise<Record<string, string>> {
  const folders = (vscode.workspace as { workspaceFolders?: readonly { uri: vscode.Uri }[] | undefined })
    .workspaceFolders;
  const targetFolder = folders?.[0];
  if (!targetFolder) return {};
  try {
    const packageJsonUri = vscode.Uri.joinPath(targetFolder.uri, "package.json");
    const data = await vscode.workspace.fs.readFile(packageJsonUri);
    const parsed = JSON.parse(new TextDecoder().decode(data)) as {
      dependencies?: Record<string, string> | undefined;
      modelscript?: { dependencies?: Record<string, string> | undefined } | undefined;
    };
    return {
      ...(parsed.modelscript?.dependencies || {}),
      ...(parsed.dependencies || {}),
    };
  } catch {
    return {};
  }
}

/**
 * Merges `package.json` dependencies with live LSP `modelscript/getMountedLibraries`
 * so the Hub reflects mounted stdlibs and packages even in single-file / virtual workspaces.
 */
export async function getEffectiveInstalledDependencies(lspClient?: LspClientLike): Promise<Record<string, string>> {
  const merged: Record<string, string> = {};
  for (const [k, v] of sessionInstalledPackages.entries()) {
    merged[k] = v;
  }
  const diskDeps = await getWorkspaceDependencies();
  for (const [k, v] of Object.entries(diskDeps)) {
    merged[k] = v;
  }
  if (lspClient?.sendRequest) {
    try {
      const resp = await lspClient.sendRequest<{ mounted?: MountedLibSnapshot[] | undefined } | MountedLibSnapshot[]>(
        "modelscript/getMountedLibraries",
        {},
      );
      const list = Array.isArray(resp) ? resp : Array.isArray(resp?.mounted) ? resp.mounted : [];
      for (const lib of list) {
        if (lib?.name && lib?.version) {
          merged[lib.name] = lib.version;
        }
      }
    } catch {
      // Fallback to diskDeps + sessionInstalledPackages if LSP is still starting
    }
  }
  return merged;
}

interface CatalogComponentSnapshot {
  fqn: string;
  name: string;
  kind: string;
  packageName: string;
  description?: string | undefined;
  language?: string | undefined;
  hasIcon?: boolean | undefined;
}

async function postInstalledPackages(panel: vscode.WebviewPanel, lspClient?: LspClientLike): Promise<void> {
  const deps = await getEffectiveInstalledDependencies(lspClient);
  await panel.webview.postMessage({
    command: "setInstalled",
    dependencies: deps,
  });
}

async function postCatalogComponents(panel: vscode.WebviewPanel, lspClient?: LspClientLike): Promise<void> {
  if (!lspClient?.sendRequest) return;
  try {
    const resp = await lspClient.sendRequest<
      { components?: CatalogComponentSnapshot[] | undefined } | CatalogComponentSnapshot[]
    >("modelscript/getComponentCatalog", {});
    const components = Array.isArray(resp) ? resp : Array.isArray(resp?.components) ? resp.components : [];
    if (components.length > 0) {
      await panel.webview.postMessage({
        command: "setCatalogComponents",
        components,
      });
    }
  } catch {
    // Curated catalog remains active if LSP is still starting
  }
}

async function ensureParentLibraryInstalled(
  packageName: string | undefined,
  packageVersion: string | undefined,
  lspClient?: LspClientLike,
): Promise<boolean> {
  if (!packageName) return false;
  const current = await getEffectiveInstalledDependencies(lspClient);
  const alreadyMounted = Object.keys(current).some((k) => k.toLowerCase() === packageName.toLowerCase());
  if (alreadyMounted) return false;
  await vscode.commands.executeCommand("modelscript.registry.install", packageName, packageVersion || "latest");
  return true;
}

async function placeComponentIntoWorkspace(
  payload: {
    fqn: string;
    shortName: string;
    kind: string;
    declarationSnippet: string;
    packageName?: string | undefined;
    packageVersion?: string | undefined;
  },
  lspClient?: LspClientLike,
): Promise<{ ok: boolean; autoInstalled: boolean; message: string }> {
  const autoInstalled = await ensureParentLibraryInstalled(payload.packageName, payload.packageVersion, lspClient);
  const installSuffix = autoInstalled && payload.packageName ? ` (auto-mounted ${payload.packageName})` : "";
  const targetUri = findTargetModelOrDiagramUri();

  // 1. Try structured diagram/model placement via LSP diagram.applyEdits when targeting a diagram-capable model
  if (targetUri && lspClient?.sendRequest && /\.(?:mo|ms|msim|sysml|kerml|ssd|pscx)$/i.test(targetUri)) {
    try {
      const response = await lspClient.sendRequest<{
        edits?:
          | {
              range: {
                start: { line: number; character: number };
                end: { line: number; character: number };
              };
              newText: string;
            }[]
          | undefined;
      }>("modelscript/diagram.applyEdits", {
        uri: targetUri,
        seq: 0,
        actions: [{ type: "addComponent", className: payload.fqn, x: 0, y: 0 }],
      });
      const edits = response?.edits;
      if (edits && edits.length > 0) {
        const workspaceEdit = new vscode.WorkspaceEdit();
        const parsedUri = vscode.Uri.parse(targetUri);
        for (const edit of edits) {
          const range = new vscode.Range(
            edit.range.start.line,
            edit.range.start.character,
            edit.range.end.line,
            edit.range.end.character,
          );
          workspaceEdit.replace(parsedUri, range, edit.newText);
        }
        await vscode.workspace.applyEdit(workspaceEdit);
        setTimeout(() => {
          void vscode.commands.executeCommand("modelscript.autoLayout");
        }, 350);
        const msg = `Placed ${payload.shortName} into ${targetUri.split("/").pop() || "model"}${installSuffix}.`;
        void vscode.window.showInformationMessage(msg);
        return { ok: true, autoInstalled, message: msg };
      }
    } catch {
      // Fall back to direct text snippet insertion below
    }
  }

  // 2. Fallback: Insert declaration snippet into open text document
  if (targetUri) {
    try {
      const parsedUri = vscode.Uri.parse(targetUri);
      const doc = await vscode.workspace.openTextDocument(parsedUri);
      const text = doc.getText();
      const lines = text.split("\n");
      let insertLine = 0;
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor && activeEditor.document.uri.toString() === targetUri && activeEditor.selection) {
        insertLine = activeEditor.selection.active.line;
      } else {
        // Insert cleanly before `equation`, `algorithm`, or closing `end <Model>;`
        const eqIdx = lines.findIndex((l) => /^\s*(?:equation|algorithm)\b/.test(l));
        const endIdx = lines.findIndex((l, idx) => idx > 0 && /^\s*end\s+[A-Za-z0-9_']+\s*;/.test(l));
        if (eqIdx > 0) insertLine = eqIdx;
        else if (endIdx > 0) insertLine = endIdx;
        else insertLine = lines.length;
      }
      const wsEdit = new vscode.WorkspaceEdit();
      wsEdit.insert(parsedUri, new vscode.Position(insertLine, 0), `  ${payload.declarationSnippet}\n`);
      await vscode.workspace.applyEdit(wsEdit);
      const msg = `Inserted ${payload.shortName} into ${targetUri.split("/").pop() || "document"}${installSuffix}.`;
      void vscode.window.showInformationMessage(msg);
      return { ok: true, autoInstalled, message: msg };
    } catch {
      // Fall through to clipboard fallback
    }
  }

  // 3. No open model file yet — copy declaration snippet to clipboard if available
  const clipboard = (vscode as unknown as { env?: { clipboard?: { writeText?: (t: string) => Promise<void> } } }).env
    ?.clipboard;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(payload.declarationSnippet);
    } catch {
      // Ignore clipboard failure
    }
  }
  const msg = autoInstalled
    ? `Mounted ${payload.packageName} and copied '${payload.declarationSnippet}' (open a model or diagram to place directly).`
    : `Copied '${payload.declarationSnippet}' — open a model or schematic diagram to place components directly.`;
  void vscode.window.showInformationMessage(msg);
  return { ok: true, autoInstalled, message: msg };
}

export function openAnsatzPackageHub(
  _context: vscode.ExtensionContext,
  lspClient?: LspClientLike,
  initialPackageName?: string,
): vscode.WebviewPanel {
  recordActiveModelUri(vscode.window.activeTextEditor?.document?.uri?.toString());

  if (activePackageHubPanel) {
    activePackageHubPanel.reveal(vscode.ViewColumn.One);
    void postInstalledPackages(activePackageHubPanel, lspClient);
    void postCatalogComponents(activePackageHubPanel, lspClient);
    if (initialPackageName) {
      void activePackageHubPanel.webview.postMessage({
        command: "inspectPackage",
        name: initialPackageName,
      });
    }
    return activePackageHubPanel;
  }

  const panel = vscode.window.createWebviewPanel(
    "modelscript.packageHub",
    "Component & Library Hub",
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [],
    },
  );

  activePackageHubPanel = panel;
  panel.onDidDispose(() => {
    activePackageHubPanel = undefined;
  });

  // Render synchronously with session cache first so panel.webview.html is populated immediately,
  // then hydrate live mounted libraries + full 1,350+ component catalog from LSP.
  const initialDeps: Record<string, string> = {};
  for (const [k, v] of sessionInstalledPackages.entries()) {
    initialDeps[k] = v;
  }
  panel.webview.html = renderPackageHubHtml(CURATED_LIBRARIES, HUB_GALLERY_COMPONENTS, initialDeps, initialPackageName);
  void postInstalledPackages(panel, lspClient);
  void postCatalogComponents(panel, lspClient);

  panel.webview.onDidReceiveMessage(async (message: Record<string, unknown>) => {
    const cmd = typeof message["command"] === "string" ? message["command"] : "";
    const reqId = typeof message["requestId"] === "string" ? message["requestId"] : undefined;

    switch (cmd) {
      case "install": {
        const name = typeof message["name"] === "string" ? message["name"] : "";
        const version = typeof message["version"] === "string" ? message["version"] : "latest";
        const ok = await vscode.commands.executeCommand<boolean>("modelscript.registry.install", name, version);
        await Promise.all([postInstalledPackages(panel, lspClient), postCatalogComponents(panel, lspClient)]);
        await panel.webview.postMessage({
          command: "actionComplete",
          requestId: reqId,
          ok: ok !== false,
          message: ok !== false ? `Mounted ${name}@${version} in workspace.` : `Failed to mount ${name}.`,
        });
        break;
      }
      case "switchVersion": {
        const name = typeof message["name"] === "string" ? message["name"] : "";
        await vscode.commands.executeCommand("modelscript.libraryView.switchVersion", name);
        await Promise.all([postInstalledPackages(panel, lspClient), postCatalogComponents(panel, lspClient)]);
        await panel.webview.postMessage({
          command: "actionComplete",
          requestId: reqId,
          ok: true,
        });
        break;
      }
      case "uninstall": {
        const name = typeof message["name"] === "string" ? message["name"] : "";
        await vscode.commands.executeCommand("modelscript.libraryView.removePackage", name);
        await Promise.all([postInstalledPackages(panel, lspClient), postCatalogComponents(panel, lspClient)]);
        await panel.webview.postMessage({
          command: "actionComplete",
          requestId: reqId,
          ok: true,
          message: `Removed ${name} from workspace.`,
        });
        break;
      }
      case "placeComponent": {
        const fqn = typeof message["fqn"] === "string" ? message["fqn"] : "";
        const shortName = typeof message["shortName"] === "string" ? message["shortName"] : fqn;
        const kind = typeof message["kind"] === "string" ? message["kind"] : "model";
        const declarationSnippet =
          typeof message["declarationSnippet"] === "string" ? message["declarationSnippet"] : `${fqn} comp1;`;
        const packageName = typeof message["packageName"] === "string" ? message["packageName"] : undefined;
        const packageVersion = typeof message["packageVersion"] === "string" ? message["packageVersion"] : undefined;
        if (!fqn) break;
        const result = await placeComponentIntoWorkspace(
          { fqn, shortName, kind, declarationSnippet, packageName, packageVersion },
          lspClient,
        );
        await Promise.all([postInstalledPackages(panel, lspClient), postCatalogComponents(panel, lspClient)]);
        await panel.webview.postMessage({
          command: "actionComplete",
          requestId: reqId,
          ok: result.ok,
          message: result.message,
        });
        break;
      }
      case "dragStartComponent": {
        const fqn = typeof message["fqn"] === "string" ? message["fqn"] : "";
        const kind = typeof message["kind"] === "string" ? message["kind"] : "model";
        const iconSvg = typeof message["iconSvg"] === "string" ? message["iconSvg"] : undefined;
        const packageName = typeof message["packageName"] === "string" ? message["packageName"] : undefined;
        const packageVersion = typeof message["packageVersion"] === "string" ? message["packageVersion"] : undefined;
        if (!fqn) break;
        if (packageName) {
          void ensureParentLibraryInstalled(packageName, packageVersion, lspClient).then((installed) => {
            if (installed) {
              void postInstalledPackages(panel, lspClient);
              void postCatalogComponents(panel, lspClient);
            }
          });
        }
        DiagramEditorProvider.instance?.postToActiveWebviews({
          type: "startPlacement",
          isDrag: true,
          className: fqn,
          classKind: kind,
          iconSvg,
        });
        break;
      }
      case "dragEndComponent": {
        DiagramEditorProvider.instance?.postToActiveWebviews({ type: "dragEnd" });
        break;
      }
      case "fetchIcons": {
        const classNames = Array.isArray(message["classNames"])
          ? (message["classNames"] as unknown[]).filter((x): x is string => typeof x === "string")
          : [];
        if (classNames.length === 0 || !lspClient?.sendRequest) break;
        const icons: Record<string, string> = {};
        try {
          const batch = await lspClient.sendRequest<Record<string, string | null>>("modelscript/getClassIcons", {
            classNames: classNames.slice(0, 80),
          });
          if (batch && typeof batch === "object") {
            for (const [k, v] of Object.entries(batch)) {
              if (typeof v === "string" && v.includes("<svg")) {
                icons[k] = v;
              }
            }
          }
        } catch {
          await Promise.all(
            classNames.slice(0, 24).map(async (cls) => {
              try {
                const svg = await lspClient.sendRequest!<string | null>("modelscript/getClassIcon", {
                  className: cls,
                });
                if (typeof svg === "string" && svg.includes("<svg")) {
                  icons[cls] = svg;
                }
              } catch {
                // Ignore missing icon
              }
            }),
          );
        }
        if (Object.keys(icons).length > 0) {
          await panel.webview.postMessage({
            command: "iconsLoaded",
            icons,
          });
        }
        break;
      }
      case "searchLive": {
        const query = typeof message["query"] === "string" ? message["query"].trim() : "";
        if (query.length < 2) break;
        type LiveClassItem = {
          name: string;
          compositeName: string;
          classKind: string;
          description?: string | undefined;
          language?: string | undefined;
        };
        const [liveClassesResp, livePackages] = await Promise.all([
          lspClient?.sendRequest
            ? lspClient
                .sendRequest<{ results?: LiveClassItem[] | undefined } | LiveClassItem[]>("modelscript/searchClasses", {
                  query,
                  limit: 48,
                })
                .catch(() => [])
            : Promise.resolve([]),
          searchAnsatzPackages(query).catch(() => []),
        ]);
        const liveClasses = Array.isArray(liveClassesResp)
          ? liveClassesResp
          : Array.isArray(liveClassesResp?.results)
            ? liveClassesResp.results
            : [];
        await panel.webview.postMessage({
          command: "liveSearchResults",
          query,
          classes: liveClasses,
          packages: Array.isArray(livePackages) ? livePackages : [],
        });
        break;
      }
      case "copyText": {
        const text = typeof message["text"] === "string" ? message["text"] : "";
        const clipboard = (vscode as unknown as { env?: { clipboard?: { writeText?: (t: string) => Promise<void> } } })
          .env?.clipboard;
        if (text && clipboard?.writeText) {
          await clipboard.writeText(text);
        }
        break;
      }
      case "importZip": {
        await vscode.commands.executeCommand("modelscript.libraryView.importZip");
        await Promise.all([postInstalledPackages(panel, lspClient), postCatalogComponents(panel, lspClient)]);
        break;
      }
      case "openModelHub": {
        await vscode.commands.executeCommand("modelscript.openModelGallery");
        break;
      }
      case "importUrl": {
        const passedUrl = typeof message["url"] === "string" ? message["url"].trim() : undefined;
        if (passedUrl) {
          await vscode.commands.executeCommand("modelscript.libraryView.importUrl", passedUrl, true);
        } else {
          await vscode.commands.executeCommand("modelscript.libraryView.importUrl");
        }
        await Promise.all([postInstalledPackages(panel, lspClient), postCatalogComponents(panel, lspClient)]);
        await panel.webview.postMessage({
          command: "actionComplete",
          requestId: reqId,
          ok: true,
        });
        break;
      }
      case "refresh": {
        await Promise.all([postInstalledPackages(panel, lspClient), postCatalogComponents(panel, lspClient)]);
        break;
      }
    }
  });

  return panel;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderPackageHubHtml(
  packages: AnsatzPackageSummary[],
  components: HubComponentItem[],
  installedDeps: Record<string, string>,
  initialPackageName?: string,
): string {
  const nonce = getNonce();
  const safeJson = (val: unknown) => JSON.stringify(val).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Component &amp; Library Hub</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background, #0d1117);
      --surface: var(--vscode-sideBar-background, #161b22);
      --card-bg: var(--vscode-editorWidget-background, #161b22);
      --stage-bg: rgba(127, 140, 160, 0.06);
      --fg: var(--vscode-editor-foreground, #e6edf3);
      --muted: var(--vscode-descriptionForeground, #8b949e);
      --border: var(--vscode-widget-border, rgba(128, 138, 152, 0.22));
      --border-strong: rgba(59, 130, 246, 0.55);
      --accent: var(--vscode-button-background, #2563eb);
      --accent-hover: var(--vscode-button-hoverBackground, #1d4ed8);
      --accent-fg: var(--vscode-button-foreground, #ffffff);
      --input-bg: var(--vscode-input-background, #0d1117);
      --input-fg: var(--vscode-input-foreground, #e6edf3);
      --input-border: var(--vscode-input-border, rgba(128, 138, 152, 0.3));
      --success: #2ea043;
      --success-bg: rgba(46, 160, 67, 0.14);
      --warning: #d29922;
      --danger: #f85149;
    }
    body.vscode-light {
      --stage-bg: #f8fafc;
      --border: rgba(15, 23, 42, 0.12);
      --input-border: rgba(15, 23, 42, 0.18);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      background: var(--bg);
      color: var(--fg);
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
      font-size: 13px;
    }

    /* Header & Segmented Switcher */
    .hub-header {
      padding: 14px 20px 12px;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
      display: flex;
      flex-direction: column;
      gap: 11px;
      flex-shrink: 0;
    }
    .header-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .brand-emblem {
      width: 28px;
      height: 28px;
      border-radius: 7px;
      background: linear-gradient(135deg, #2563eb, #4f46e5);
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .brand-title {
      font-size: 15px;
      font-weight: 600;
      letter-spacing: -0.2px;
    }
    .brand-sub {
      font-size: 11px;
      color: var(--muted);
      padding: 2px 7px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: var(--bg);
    }
    .segmented {
      display: inline-flex;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 3px;
      gap: 2px;
    }
    .seg-btn {
      background: transparent;
      border: none;
      color: var(--muted);
      font-size: 12px;
      font-weight: 500;
      padding: 5px 12px;
      border-radius: 6px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
      transition: background 0.12s, color 0.12s;
    }
    .seg-btn:hover { color: var(--fg); }
    .seg-btn.active {
      background: var(--accent);
      color: var(--accent-fg);
      font-weight: 600;
    }
    .seg-count {
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 999px;
      background: rgba(128, 138, 152, 0.2);
      color: inherit;
    }
    .seg-btn.active .seg-count {
      background: rgba(255, 255, 255, 0.22);
    }

    /* Unified Search & Filter Controls */
    .toolbar-row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .search-wrap {
      flex: 1;
      min-width: 220px;
      position: relative;
      display: flex;
      align-items: center;
    }
    .search-svg {
      position: absolute;
      left: 10px;
      width: 14px;
      height: 14px;
      color: var(--muted);
      pointer-events: none;
    }
    .search-input {
      width: 100%;
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--input-border);
      border-radius: 6px;
      padding: 7px 30px 7px 32px;
      font-size: 12.5px;
      outline: none;
    }
    .search-input:focus {
      border-color: var(--accent);
    }
    .clear-btn {
      position: absolute;
      right: 7px;
      background: transparent;
      border: none;
      color: var(--muted);
      cursor: pointer;
      font-size: 13px;
      padding: 2px 5px;
      border-radius: 4px;
      display: none;
    }
    .clear-btn.visible { display: inline-block; }
    .clear-btn:hover { color: var(--fg); }

    .pill-toggle {
      background: var(--bg);
      border: 1px solid var(--border);
      color: var(--muted);
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 11.5px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
    }
    .pill-toggle:hover { color: var(--fg); border-color: var(--border-strong); }
    .pill-toggle.active {
      background: rgba(37, 99, 235, 0.14);
      color: #60a5fa;
      border-color: rgba(59, 130, 246, 0.5);
      font-weight: 600;
    }
    body.vscode-light .pill-toggle.active { color: #1d4ed8; }

    /* Domain Pills */
    .domain-bar {
      display: flex;
      align-items: center;
      gap: 6px;
      overflow-x: auto;
      scrollbar-width: none;
      padding-bottom: 1px;
    }
    .domain-bar::-webkit-scrollbar { display: none; }
    .domain-pill {
      background: var(--bg);
      border: 1px solid var(--border);
      color: var(--muted);
      font-size: 11.5px;
      font-weight: 500;
      padding: 4px 10px;
      border-radius: 999px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
      flex-shrink: 0;
      transition: all 0.12s;
    }
    .domain-pill svg { width: 13px; height: 13px; flex-shrink: 0; }
    .domain-pill:hover { color: var(--fg); border-color: var(--border-strong); }
    .domain-pill.active {
      background: var(--accent);
      color: var(--accent-fg);
      border-color: var(--accent);
      font-weight: 600;
    }

    /* Main Workspace & Grids */
    .workspace-body {
      flex: 1;
      display: flex;
      overflow: hidden;
      position: relative;
    }
    .scroll-pane {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 18px 20px 28px;
    }
    .comp-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 12px;
    }
    .comp-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      cursor: pointer;
      transition: border-color 0.14s, transform 0.12s;
    }
    .comp-card:hover {
      border-color: var(--border-strong);
    }
    .comp-card.selected {
      border-color: var(--accent);
      box-shadow: 0 0 0 1px var(--accent);
    }
    .comp-stage {
      height: 92px;
      background-color: var(--stage-bg);
      background-image: radial-gradient(rgba(128, 138, 152, 0.22) 1px, transparent 1px);
      background-size: 12px 12px;
      border-bottom: 1px solid var(--border);
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 10px 16px;
    }
    .comp-stage svg {
      max-width: 108px;
      max-height: 68px;
      width: auto;
      height: auto;
      color: var(--fg);
    }
    .stage-kind {
      position: absolute;
      top: 6px;
      left: 7px;
      font-size: 9.5px;
      font-family: var(--vscode-editor-font-family, monospace);
      color: var(--muted);
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 1px 5px;
    }
    .stage-pkg {
      position: absolute;
      top: 6px;
      right: 7px;
      font-size: 9.5px;
      font-weight: 600;
      border-radius: 999px;
      padding: 1px 6px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: var(--card-bg);
      border: 1px solid var(--border);
      color: var(--muted);
    }
    .stage-pkg.mounted {
      color: var(--success);
      border-color: rgba(46, 160, 67, 0.4);
      background: var(--success-bg);
    }
    .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
    }
    .comp-body {
      padding: 10px 12px 11px;
      display: flex;
      flex-direction: column;
      gap: 5px;
      flex: 1;
    }
    .comp-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--fg);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .comp-summary {
      font-size: 11.5px;
      color: var(--muted);
      line-height: 1.4;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      min-height: 32px;
    }
    .comp-ports {
      font-size: 10.5px;
      font-family: var(--vscode-editor-font-family, monospace);
      color: var(--muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-top: 1px;
    }
    .comp-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 6px;
      padding-top: 7px;
      border-top: 1px solid var(--border);
    }

    /* Library Grid */
    .lib-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
      gap: 12px;
    }
    .lib-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      transition: border-color 0.14s;
    }
    .lib-card:hover { border-color: var(--border-strong); }
    .lib-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
    }
    .lib-title-wrap {
      display: flex;
      align-items: center;
      gap: 7px;
      flex-wrap: wrap;
      min-width: 0;
    }
    .lib-name {
      font-size: 14px;
      font-weight: 600;
      color: var(--fg);
      cursor: pointer;
      background: none;
      border: none;
      padding: 0;
      text-align: left;
    }
    .lib-name:hover { color: #60a5fa; text-decoration: underline; }
    .tag {
      font-size: 10px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 4px;
      border: 1px solid var(--border);
      color: var(--muted);
      background: var(--bg);
      white-space: nowrap;
    }
    .tag.verified {
      color: var(--success);
      border-color: rgba(46, 160, 67, 0.35);
      background: var(--success-bg);
    }
    .lib-controls {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }
    .ver-select {
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--input-border);
      border-radius: 5px;
      padding: 4px 7px;
      font-size: 11px;
      outline: none;
      cursor: pointer;
    }
    .lib-desc {
      font-size: 12px;
      line-height: 1.48;
      color: var(--muted);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      min-height: 35px;
    }
    .lib-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--border);
      font-size: 11px;
      color: var(--muted);
      flex-wrap: wrap;
    }
    .link-btn {
      background: none;
      border: none;
      color: #60a5fa;
      font-size: 11.5px;
      font-weight: 500;
      cursor: pointer;
      padding: 0;
    }
    body.vscode-light .link-btn { color: #2563eb; }
    .link-btn:hover { text-decoration: underline; }

    /* Buttons */
    .btn {
      background: var(--accent);
      color: var(--accent-fg);
      border: 1px solid transparent;
      border-radius: 5px;
      padding: 5px 11px;
      font-size: 11.5px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      white-space: nowrap;
      transition: background 0.12s, border-color 0.12s;
    }
    .btn:hover:not(:disabled) { background: var(--accent-hover); }
    .btn:disabled { opacity: 0.65; cursor: default; }
    .btn.secondary {
      background: var(--bg);
      color: var(--fg);
      border-color: var(--border);
    }
    .btn.secondary:hover:not(:disabled) { border-color: var(--border-strong); }
    .btn.installed-pill {
      background: var(--success-bg);
      color: var(--success);
      border-color: rgba(46, 160, 67, 0.4);
      cursor: default;
    }
    .btn.ghost-danger {
      background: transparent;
      color: var(--muted);
      border-color: var(--border);
      padding: 5px 8px;
    }
    .btn.ghost-danger:hover:not(:disabled) {
      color: var(--danger);
      border-color: rgba(248, 81, 73, 0.45);
    }
    .btn.full { flex: 1; }

    /* Component Bottom Inspector */
    .comp-inspector {
      border-top: 1px solid var(--border);
      background: var(--surface);
      padding: 11px 20px;
      display: none;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      flex-shrink: 0;
      flex-wrap: wrap;
    }
    .comp-inspector.open { display: flex; }
    .insp-left {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
      flex: 1;
    }
    .insp-thumb {
      width: 56px;
      height: 42px;
      border-radius: 6px;
      background: var(--stage-bg);
      border: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 4px;
      flex-shrink: 0;
    }
    .insp-thumb svg { max-width: 46px; max-height: 32px; color: var(--fg); }
    .insp-meta { min-width: 0; flex: 1; }
    .insp-fqn {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11.5px;
      color: var(--fg);
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .insp-code {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      color: var(--muted);
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 3px 8px;
      margin-top: 3px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 520px;
    }

    /* Package Drawer */
    .drawer {
      width: 380px;
      max-width: 45vw;
      border-left: 1px solid var(--border);
      background: var(--surface);
      display: none;
      flex-direction: column;
      flex-shrink: 0;
      overflow: hidden;
    }
    .drawer.open { display: flex; }
    .drawer-head {
      padding: 14px 16px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .drawer-tabs {
      display: flex;
      gap: 4px;
      padding: 8px 16px;
      border-bottom: 1px solid var(--border);
    }
    .drawer-body {
      flex: 1;
      overflow-y: auto;
      padding: 14px 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .drawer-comp-row {
      padding: 9px 10px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--card-bg);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    /* Import View */
    .import-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 16px;
      max-width: 820px;
      margin: 12px auto;
    }
    .import-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 22px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .import-icon-box {
      width: 38px;
      height: 38px;
      border-radius: 8px;
      background: rgba(37, 99, 235, 0.14);
      color: #60a5fa;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    /* Status Toast */
    .toast {
      position: fixed;
      bottom: 16px;
      right: 20px;
      background: var(--card-bg);
      border: 1px solid var(--border-strong);
      color: var(--fg);
      padding: 9px 14px;
      border-radius: 7px;
      font-size: 12px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
      display: none;
      align-items: center;
      gap: 8px;
      z-index: 50;
      max-width: 440px;
    }
    .toast.visible { display: flex; }
    .empty-state {
      text-align: center;
      padding: 52px 20px;
      color: var(--muted);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
    }
  </style>
</head>
<body>
  <header class="hub-header">
    <div class="header-row">
      <div class="brand">
        <div class="brand-emblem">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 1.5L14 5v6l-6 3.5L2 11V5l6-3.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
            <circle cx="8" cy="8" r="2" fill="currentColor"/>
          </svg>
        </div>
        <span class="brand-title">Component &amp; Library Hub</span>
        <span class="brand-sub" id="mounted-summary">0 mounted</span>
      </div>

      <div class="segmented" role="tablist" aria-label="Hub Mode">
        <button class="seg-btn active" data-action="set-mode" data-mode="components" id="mode-components">
          Components <span class="seg-count" id="count-components">0</span>
        </button>
        <button class="seg-btn" data-action="set-mode" data-mode="libraries" id="mode-libraries">
          Libraries <span class="seg-count" id="count-libraries">0</span>
        </button>
        <button class="seg-btn" data-action="set-mode" data-mode="import" id="mode-import">
          Import
        </button>
      </div>
    </div>

    <div class="toolbar-row" id="toolbar-row">
      <div class="search-wrap">
        <svg class="search-svg" viewBox="0 0 16 16" fill="none">
          <circle cx="7" cy="7" r="4.8" stroke="currentColor" stroke-width="1.5"/>
          <path d="M10.6 10.6L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <input
          type="text"
          class="search-input"
          id="search-input"
          placeholder="Search schematic components, classes, or libraries (e.g., resistor, pid, pump, mosfet, ur5)..."
        />
        <button class="clear-btn" id="clear-search-btn" data-action="clear-search" title="Clear search">✕</button>
      </div>

      <button class="pill-toggle" id="pkg-filter-chip" data-action="clear-pkg-filter" style="display: none;"></button>
      <button class="pill-toggle" id="mounted-only-btn" data-action="toggle-mounted-only">Mounted only</button>
      <button class="pill-toggle" id="sort-toggle-btn" data-action="cycle-sort" style="display: none;">Sort: Popular</button>
      <button class="pill-toggle" data-action="open-model-hub" title="Open visual model gallery with schematic diagrams">Open Model…</button>
    </div>

    <div class="domain-bar" id="domain-bar"></div>
    <div class="domain-bar" id="subpkg-bar" style="display: none; padding-top: 4px;"></div>
  </header>

  <div class="workspace-body">
    <div class="scroll-pane" id="scroll-pane"></div>

    <aside class="drawer" id="pkg-drawer">
      <div class="drawer-head">
        <div>
          <div style="font-size: 14px; font-weight: 600;" id="drawer-title"></div>
          <div style="font-size: 11px; color: var(--muted);" id="drawer-sub"></div>
        </div>
        <button class="btn secondary" data-action="close-drawer" style="padding: 3px 8px;">✕</button>
      </div>
      <div class="drawer-tabs">
        <button class="pill-toggle active" data-action="set-drawer-tab" data-tab="components" id="dtab-components">Components</button>
        <button class="pill-toggle" data-action="set-drawer-tab" data-tab="dependencies" id="dtab-dependencies">Dependencies</button>
        <button class="pill-toggle" data-action="set-drawer-tab" data-tab="about" id="dtab-about">About</button>
      </div>
      <div class="drawer-body" id="drawer-body"></div>
    </aside>
  </div>

  <footer class="comp-inspector" id="comp-inspector"></footer>
  <div class="toast" id="hub-toast"></div>

  <script nonce="${nonce}">
    (function () {
      const vscode = acquireVsCodeApi();
      const DOMAINS = ${safeJson(HUB_DOMAIN_FILTERS)};
      const BASE_COMPONENTS = ${safeJson(components)};
      const BASE_PACKAGES = ${safeJson(packages)};
      const INITIAL_PKG = ${safeJson(initialPackageName || "")};
      const PAGE_SIZE = 72;

      let installedDeps = ${safeJson(installedDeps)};
      let catalogClasses = [];
      let livePackages = [];
      let liveClasses = [];
      let cachedAllComps = null;
      let liveIcons = {};
      let requestedIcons = new Set();

      let currentMode = INITIAL_PKG ? "libraries" : "components";
      let currentDomain = "all";
      let packageFilter = "";
      let subpackageFilter = "";
      let mountedOnly = false;
      let librarySort = "popular";
      let visibleLimit = PAGE_SIZE;
      let selectedCompId = BASE_COMPONENTS[0] ? BASE_COMPONENTS[0].id : "";
      let inspectingPkgName = INITIAL_PKG || "";
      let drawerTab = "components";
      let selectedVersions = {};
      let busyRequests = new Map();
      let copiedId = "";
      let toastTimer = null;
      let searchDebounce = null;

      function esc(str) {
        return String(str || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      }

      function showToast(msg) {
        if (!msg) return;
        const el = document.getElementById("hub-toast");
        if (!el) return;
        el.textContent = msg;
        el.classList.add("visible");
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.classList.remove("visible"), 3600);
      }

      function getInstalledVersion(pkgName) {
        if (!pkgName) return "";
        const target = pkgName.toLowerCase();
        for (const [k, v] of Object.entries(installedDeps)) {
          if (k.toLowerCase() === target) return v;
        }
        return "";
      }

      function resetVisibleWindow() {
        visibleLimit = PAGE_SIZE;
        const pane = document.getElementById("scroll-pane");
        if (pane) pane.scrollTop = 0;
      }

      function normalizeLiveSvg(svg) {
        if (!svg || !svg.includes("<svg")) return "";
        let out = svg;
        const vb = out.match(/viewBox\\s*=\\s*(["'])([-\\d.]+)\\s+([-\\d.]+)\\s+([-\\d.]+)\\s+([-\\d.]+)\\1/);
        if (vb) {
          const vx = parseFloat(vb[2]);
          const vy = parseFloat(vb[3]);
          const vw = parseFloat(vb[4]);
          const vh = parseFloat(vb[5]);
          if (vw > 0 && vh > 0 && (vx < 0 || vy < 0)) {
            const px = +(vw * 0.05).toFixed(2);
            const py = +(vh * 0.05).toFixed(2);
            out = out.replace(vb[0], 'viewBox="' + (vx - px) + " " + (vy - py) + " " + (vw + px * 2) + " " + (vh + py * 2) + '"');
          }
        }
        const isDark = !document.body.classList.contains("vscode-light");
        if (isDark) {
          out = out
            .replace(/stroke=(["'])(?:#000000|#000|black|rgb\\(0,\\s*0,\\s*0\\))\\1/gi, 'stroke="#e2e8f0"')
            .replace(/fill=(["'])(?:#000000|#000|black|rgb\\(0,\\s*0,\\s*0\\))\\1/gi, 'fill="#e2e8f0"');
        }
        return out;
      }

      function inferDomain(fqn, lang) {
        const s = (fqn + " " + (lang || "")).toLowerCase();
        if (s.includes("electrical") || s.includes("magnetic") || s.includes("spice") || s.includes("analog")) return "electrical";
        if (s.includes("mechanics") || s.includes("rotational") || s.includes("translational") || s.includes("planar")) return "mechanics";
        if (s.includes("fluid") || s.includes("thermal") || s.includes("heat") || s.includes("buildings") || s.includes("epanet") || s.includes("swmm")) return "fluids-thermal";
        if (s.includes("blocks") || s.includes("complexblocks") || s.includes("stategraph") || s.includes("control") || s.includes("pid")) return "control";
        if (s.includes("ieee") || s.includes("psse") || s.includes("opendss") || s.includes("grid")) return "power-grids";
        if (s.includes("robot") || s.includes("urdf") || s.includes("step")) return "robotics-cad";
        return "systems";
      }

      function extractSubpkg(fqn) {
        const parts = String(fqn || "").split(".");
        if (parts.length < 3) return "";
        if (parts[0] === "Modelica" && parts.length >= 4) {
          return parts[1] + " · " + parts[2];
        }
        return parts[0] + " · " + parts[1];
      }

      function buildFallbackSchematic(shortName, kind, category) {
        const dom = DOMAINS.find(d => d.id === category) || DOMAINS[0];
        const accent = dom.accent || "#3b82f6";
        const label = esc(shortName.replace(/[^A-Za-z0-9]/g, "").slice(0, 5).toUpperCase() || "CMP");
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 56" fill="none">' +
          '<line x1="6" y1="28" x2="18" y2="28" stroke="' + accent + '" stroke-width="2.2"/>' +
          '<rect x="18" y="12" width="44" height="32" rx="4" stroke="currentColor" stroke-width="2" fill="rgba(59,130,246,0.10)"/>' +
          '<text x="40" y="32" text-anchor="middle" font-size="10.5" font-weight="700" font-family="monospace" fill="currentColor">' + label + "</text>" +
          '<line x1="62" y1="28" x2="74" y2="28" stroke="' + accent + '" stroke-width="2.2"/>' +
          "</svg>";
      }

      function getAllPackages() {
        const seen = new Set();
        const merged = [];
        for (const p of [...BASE_PACKAGES, ...livePackages]) {
          const key = p.name.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push(p);
        }
        // Include any dynamically mounted custom/imported libraries
        for (const [depName, depVer] of Object.entries(installedDeps)) {
          if (!seen.has(depName.toLowerCase())) {
            seen.add(depName.toLowerCase());
            merged.push({
              name: depName,
              latestVersion: depVer,
              versions: [depVer],
              description: "Mounted workspace library package.",
              domainId: inferDomain(depName, ""),
              language: "Modelica",
              verified: false,
            });
          }
        }
        return merged;
      }

      function getAllComponents() {
        if (cachedAllComps) return cachedAllComps;
        const byFqn = new Set(BASE_COMPONENTS.map(c => c.fqn.toLowerCase()));
        const extras = [];

        for (const item of catalogClasses) {
          const fqn = item.fqn;
          if (!fqn || byFqn.has(fqn.toLowerCase())) continue;
          byFqn.add(fqn.toLowerCase());
          const kind = (item.kind || "model").toLowerCase();
          const rootPkg = item.packageName || fqn.split(".")[0] || "Modelica";
          const cat = inferDomain(fqn, item.language);
          const shortName = item.name || fqn.split(".").pop() || fqn;
          const parts = fqn.split(".");
          const subPath = parts.length > 2 ? parts.slice(1, -1).join(" · ") : rootPkg;
          const baseIdent = shortName.replace(/[^A-Za-z0-9_]/g, "") || "comp";
          const instName = baseIdent.charAt(0).toLowerCase() + baseIdent.slice(1, 14) + "1";
          extras.push({
            id: "cat-" + fqn,
            shortName,
            fqn,
            kind,
            category: cat,
            packageName: rootPkg,
            packageVersion: getInstalledVersion(rootPkg) || (rootPkg === "Modelica" ? "4.1.0" : "latest"),
            summary: item.description || (subPath + " (" + kind + ")"),
            portsAndParams: parts.length > 2 ? parts.slice(0, -1).join(".") : fqn,
            declarationSnippet: fqn + " " + instName + ";",
            keywords: [shortName.toLowerCase(), fqn.toLowerCase(), subPath.toLowerCase()],
            schematicSvg: buildFallbackSchematic(shortName, kind, cat),
          });
        }

        for (const cls of liveClasses) {
          const fqn = cls.compositeName || cls.name;
          if (!fqn || byFqn.has(fqn.toLowerCase())) continue;
          const kind = (cls.classKind || "model").toLowerCase();
          if (kind === "package" || kind === "file" || kind === "folder") continue;
          byFqn.add(fqn.toLowerCase());
          const rootPkg = fqn.split(".")[0] || "Workspace";
          const cat = inferDomain(fqn, cls.language);
          const shortName = cls.name || fqn.split(".").pop() || fqn;
          const instName = shortName.replace(/[^A-Za-z0-9_]/g, "").slice(0, 12).toLowerCase() + "1";
          extras.push({
            id: "live-" + fqn,
            shortName,
            fqn,
            kind,
            category: cat,
            packageName: rootPkg,
            packageVersion: getInstalledVersion(rootPkg) || "latest",
            summary: cls.description || ("Indexed " + kind + " from " + rootPkg),
            portsAndParams: fqn,
            declarationSnippet: fqn + " " + instName + ";",
            keywords: [shortName.toLowerCase(), fqn.toLowerCase()],
            schematicSvg: buildFallbackSchematic(shortName, kind, cat),
          });
        }

        cachedAllComps = [...BASE_COMPONENTS, ...extras];
        return cachedAllComps;
      }

      function getBaseFilteredComponents() {
        const q = (document.getElementById("search-input")?.value || "").trim().toLowerCase();
        return getAllComponents().filter(c => {
          if (packageFilter && c.packageName.toLowerCase() !== packageFilter.toLowerCase()) return false;
          if (mountedOnly && !getInstalledVersion(c.packageName)) return false;
          if (currentDomain !== "all" && c.category !== currentDomain) return false;
          if (q) {
            const hay = (c.shortName + " " + c.fqn + " " + c.summary + " " + c.packageName + " " + (c.keywords || []).join(" ")).toLowerCase();
            if (!hay.includes(q)) return false;
          }
          return true;
        });
      }

      function getFilteredComponents(baseComps) {
        const list = baseComps || getBaseFilteredComponents();
        if (!subpackageFilter) return list;
        return list.filter(c => extractSubpkg(c.fqn) === subpackageFilter);
      }

      function getFilteredPackages() {
        const q = (document.getElementById("search-input")?.value || "").trim().toLowerCase();
        const matchingPkgFromComps = new Set();
        if (q) {
          for (const c of getAllComponents()) {
            if (c.shortName.toLowerCase().includes(q) || c.fqn.toLowerCase().includes(q)) {
              matchingPkgFromComps.add(c.packageName.toLowerCase());
            }
          }
        }
        const list = getAllPackages().filter(p => {
          if (mountedOnly && !getInstalledVersion(p.name)) return false;
          if (currentDomain !== "all") {
            const domId = p.domainId || inferDomain(p.name + " " + (p.domains || []).join(" "), p.language);
            if (domId !== currentDomain) return false;
          }
          if (q) {
            const compNames = (p.components || []).map(c => c.name).join(" ");
            const hay = (p.name + " " + (p.description || "") + " " + (p.language || "") + " " + compNames).toLowerCase();
            if (!hay.includes(q) && !matchingPkgFromComps.has(p.name.toLowerCase())) return false;
          }
          return true;
        });

        if (librarySort === "name") {
          list.sort((a, b) => a.name.localeCompare(b.name));
        } else {
          list.sort((a, b) => (b.totalDownloads || 0) - (a.totalDownloads || 0));
        }
        return list;
      }

      function requestMissingIcons(comps) {
        const toFetch = [];
        for (const c of comps) {
          if (!requestedIcons.has(c.fqn) && (c.packageName === "Modelica" || getInstalledVersion(c.packageName))) {
            requestedIcons.add(c.fqn);
            toFetch.push(c.fqn);
            if (toFetch.length >= 80) break;
          }
        }
        if (toFetch.length > 0) {
          vscode.postMessage({ command: "fetchIcons", classNames: toFetch });
        }
      }

      function renderDomainBar(baseComps) {
        const bar = document.getElementById("domain-bar");
        if (bar) {
          bar.style.display = currentMode === "import" ? "none" : "flex";
          bar.innerHTML = DOMAINS.map(d =>
            '<button class="domain-pill ' + (currentDomain === d.id ? "active" : "") + '" data-action="set-domain" data-domain="' + esc(d.id) + '">' +
              '<svg viewBox="0 0 16 16" fill="none">' + d.svgInner + "</svg>" +
              "<span>" + esc(d.label) + "</span>" +
            "</button>"
          ).join("");
        }

        const subBar = document.getElementById("subpkg-bar");
        if (!subBar) return;
        if (currentMode !== "components" || (currentDomain === "all" && !packageFilter)) {
          subBar.style.display = "none";
          subBar.innerHTML = "";
          return;
        }
        const counts = new Map();
        for (const c of baseComps) {
          const g = extractSubpkg(c.fqn);
          if (g) counts.set(g, (counts.get(g) || 0) + 1);
        }
        const topGroups = Array.from(counts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10);
        if (topGroups.length <= 1) {
          subBar.style.display = "none";
          subBar.innerHTML = "";
          return;
        }
        subBar.style.display = "flex";
        subBar.innerHTML = topGroups.map(([label, cnt]) =>
          '<button class="domain-pill ' + (subpackageFilter === label ? "active" : "") + '" data-action="set-subpkg" data-subpkg="' + esc(label) + '" style="font-size: 11px; padding: 3px 9px;">' +
            "<span>" + esc(label) + "</span>" +
            '<span style="opacity: 0.7; font-family: monospace; font-size: 10px;">' + cnt + "</span>" +
          "</button>"
        ).join("");
      }

      function renderHeaderMeta(filteredComps, filteredPkgs) {
        const mountedCount = Object.keys(installedDeps).length;
        const sumEl = document.getElementById("mounted-summary");
        if (sumEl) sumEl.textContent = mountedCount + " mounted";

        document.getElementById("count-components").textContent = Number(filteredComps.length).toLocaleString();
        document.getElementById("count-libraries").textContent = String(filteredPkgs.length);

        ["components", "libraries", "import"].forEach(m => {
          document.getElementById("mode-" + m)?.classList.toggle("active", currentMode === m);
        });

        const toolbar = document.getElementById("toolbar-row");
        if (toolbar) toolbar.style.display = currentMode === "import" ? "none" : "flex";

        const q = document.getElementById("search-input")?.value || "";
        document.getElementById("clear-search-btn")?.classList.toggle("visible", q.length > 0);

        const pkgChip = document.getElementById("pkg-filter-chip");
        if (pkgChip) {
          if (currentMode === "components" && packageFilter) {
            pkgChip.style.display = "inline-flex";
            pkgChip.className = "pill-toggle active";
            pkgChip.textContent = "Package: " + packageFilter + " ✕";
          } else {
            pkgChip.style.display = "none";
          }
        }

        const mountedBtn = document.getElementById("mounted-only-btn");
        if (mountedBtn) {
          mountedBtn.classList.toggle("active", mountedOnly);
          mountedBtn.textContent = currentMode === "libraries"
            ? "Installed (" + mountedCount + ")"
            : "Mounted only";
        }

        const sortBtn = document.getElementById("sort-toggle-btn");
        if (sortBtn) {
          sortBtn.style.display = currentMode === "libraries" ? "inline-flex" : "none";
          sortBtn.textContent = librarySort === "popular" ? "Sort: Popular" : "Sort: A–Z";
        }
      }

      function renderComponentsPane(filteredComps) {
        const pane = document.getElementById("scroll-pane");
        if (!pane) return;
        if (filteredComps.length === 0) {
          pane.innerHTML =
            '<div class="empty-state">' +
              '<div style="font-size: 14px; font-weight: 600; color: var(--fg);">No matching components</div>' +
              '<div>Try clearing filters or searching another engineering term (e.g., resistor, pid, pump, revolute).</div>' +
              '<button class="btn secondary" data-action="reset-filters">Reset Filters</button>' +
            "</div>";
          return;
        }

        const visibleSlice = filteredComps.slice(0, visibleLimit);
        requestMissingIcons(visibleSlice);

        const moreFooter = visibleSlice.length < filteredComps.length
          ? '<div style="margin-top: 14px; padding: 10px 14px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 12px; color: var(--muted);">' +
              "<span>Showing <strong>" + visibleSlice.length.toLocaleString() + "</strong> of <strong>" + filteredComps.length.toLocaleString() + "</strong> schematic components</span>" +
              '<button class="btn secondary" data-action="load-more-comps">Show more (+' + Math.min(PAGE_SIZE, filteredComps.length - visibleSlice.length) + ")</button>" +
            "</div>"
          : "";

        pane.innerHTML = '<div class="comp-grid">' + visibleSlice.map(c => {
          const mountedVer = getInstalledVersion(c.packageName);
          const svgMarkup = liveIcons[c.fqn] || c.schematicSvg;
          const isSelected = selectedCompId === c.id;
          const isPlacing = busyRequests.has("place:" + c.fqn);
          const isCopied = copiedId === c.id;
          return (
            '<div class="comp-card ' + (isSelected ? "selected" : "") + '" draggable="true" data-action="select-comp" data-comp-id="' + esc(c.id) + '">' +
              '<div class="comp-stage">' +
                '<span class="stage-kind">' + esc(c.kind) + "</span>" +
                '<span class="stage-pkg ' + (mountedVer ? "mounted" : "") + '">' +
                  '<span class="dot"></span>' + esc(c.packageName) +
                "</span>" +
                svgMarkup +
              "</div>" +
              '<div class="comp-body">' +
                '<div class="comp-title" title="' + esc(c.fqn) + '">' + esc(c.shortName) + "</div>" +
                '<div class="comp-summary">' + esc(c.summary) + "</div>" +
                '<div class="comp-ports">' + esc(c.portsAndParams) + "</div>" +
                '<div class="comp-actions">' +
                  '<button class="btn full" data-action="place-comp" data-comp-id="' + esc(c.id) + '" ' + (isPlacing ? "disabled" : "") + ">" +
                    (isPlacing ? "Placing..." : (mountedVer ? "Place" : "Place + Mount")) +
                  "</button>" +
                  '<button class="btn secondary" data-action="copy-comp" data-comp-id="' + esc(c.id) + '" title="Copy declaration snippet">' +
                    (isCopied ? "✓" : "Copy") +
                  "</button>" +
                "</div>" +
              "</div>" +
            "</div>"
          );
        }).join("") + "</div>" + moreFooter;
      }

      function renderLibrariesPane(filteredPkgs) {
        const pane = document.getElementById("scroll-pane");
        if (!pane) return;
        if (filteredPkgs.length === 0) {
          const rawQ = (document.getElementById("search-input")?.value || "").trim();
          pane.innerHTML =
            '<div class="empty-state">' +
              '<div style="font-size: 14px; font-weight: 600; color: var(--fg);">No matching libraries</div>' +
              (rawQ
                ? '<div>Install <strong>' + esc(rawQ) + '</strong> directly from Ansatz or reset filters.</div>' +
                  '<button class="btn" data-action="install-pkg" data-pkg="' + esc(rawQ) + '" data-ver="latest">+ Add ' + esc(rawQ) + "</button>"
                : '<div>No libraries match the active filters.</div>') +
              '<button class="btn secondary" data-action="reset-filters">Reset Filters</button>' +
            "</div>";
          return;
        }

        const allComps = getAllComponents();
        const pkgCounts = new Map();
        for (const c of allComps) {
          const key = c.packageName.toLowerCase();
          pkgCounts.set(key, (pkgCounts.get(key) || 0) + 1);
        }

        pane.innerHTML = '<div class="lib-grid">' + filteredPkgs.map(pkg => {
          const installedVer = getInstalledVersion(pkg.name);
          const versions = Array.isArray(pkg.versions) && pkg.versions.length > 0
            ? pkg.versions
            : [pkg.latestVersion || installedVer || "1.0.0"];
          const chosenVer = selectedVersions[pkg.name] || installedVer || versions[0];
          const isBusy = busyRequests.has("pkg:" + pkg.name);
          const showcaseCount = pkgCounts.get(pkg.name.toLowerCase()) || 0;

          const verOptions = versions.map((v, idx) =>
            '<option value="' + esc(v) + '" ' + (v === chosenVer ? "selected" : "") + ">v" + esc(v) + (idx === 0 ? " (latest)" : "") + "</option>"
          ).join("");

          let actionHtml = "";
          if (isBusy) {
            actionHtml = '<button class="btn" disabled>Working...</button>';
          } else if (installedVer) {
            if (installedVer === chosenVer) {
              actionHtml =
                '<span class="btn installed-pill">✓ Installed</span>' +
                '<button class="btn ghost-danger" data-action="uninstall-pkg" data-pkg="' + esc(pkg.name) + '" title="Remove from workspace">Remove</button>';
            } else {
              actionHtml =
                '<button class="btn secondary" data-action="install-pkg" data-pkg="' + esc(pkg.name) + '" data-ver="' + esc(chosenVer) + '">Switch to v' + esc(chosenVer) + "</button>";
            }
          } else {
            actionHtml =
              '<button class="btn" data-action="install-pkg" data-pkg="' + esc(pkg.name) + '" data-ver="' + esc(chosenVer) + '">+ Add Library</button>';
          }

          return (
            '<div class="lib-card">' +
              '<div class="lib-top">' +
                '<div class="lib-title-wrap">' +
                  '<button class="lib-name" data-action="open-drawer" data-pkg="' + esc(pkg.name) + '">' + esc(pkg.name) + "</button>" +
                  (pkg.language ? '<span class="tag">' + esc(pkg.language) + "</span>" : "") +
                  (pkg.verified ? '<span class="tag verified">Verified</span>' : "") +
                "</div>" +
                '<div class="lib-controls">' +
                  '<select class="ver-select" data-action="select-ver" data-pkg="' + esc(pkg.name) + '">' + verOptions + "</select>" +
                  actionHtml +
                "</div>" +
              "</div>" +
              '<p class="lib-desc">' + esc(pkg.description || "Engineering library package.") + "</p>" +
              '<div class="lib-footer">' +
                '<span>' +
                  esc(pkg.license || "Standard") +
                  (pkg.totalDownloads ? " · " + Number(pkg.totalDownloads).toLocaleString() + " installs" : "") +
                "</span>" +
                '<div style="display: flex; align-items: center; gap: 12px;">' +
                  (showcaseCount > 0
                    ? '<button class="link-btn" data-action="browse-pkg-comps" data-pkg="' + esc(pkg.name) + '">Browse ' + showcaseCount.toLocaleString() + " components →</button>"
                    : "") +
                  '<button class="link-btn" data-action="open-drawer" data-pkg="' + esc(pkg.name) + '">Details</button>' +
                "</div>" +
              "</div>" +
            "</div>"
          );
        }).join("") + "</div>";
      }

      function renderImportPane() {
        const pane = document.getElementById("scroll-pane");
        if (!pane) return;
        pane.innerHTML =
          '<div class="import-grid">' +
            '<div class="import-card">' +
              '<div class="import-icon-box">' +
                '<svg width="20" height="20" viewBox="0 0 16 16" fill="none"><path d="M2.5 4.5A1.5 1.5 0 014 3h3l1.5 1.5H12A1.5 1.5 0 0113.5 6v5.5A1.5 1.5 0 0112 13H4a1.5 1.5 0 01-1.5-1.5v-7z" stroke="currentColor" stroke-width="1.4"/></svg>' +
              "</div>" +
              '<div style="font-size: 14px; font-weight: 600;">Local .zip Library Archive</div>' +
              '<p style="font-size: 12px; color: var(--muted); line-height: 1.5;">Mount a local Modelica (.mo), SysML v2 (.sysml), SPICE, or multi-file package archive directly into the workspace VFS.</p>' +
              '<div style="margin-top: auto; padding-top: 6px;">' +
                '<button class="btn" data-action="import-zip">Choose .zip Archive...</button>' +
              "</div>" +
            "</div>" +
            '<div class="import-card">' +
              '<div class="import-icon-box">' +
                '<svg width="20" height="20" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.8" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 8h11M8 2.2c1.8 1.8 1.8 9.8 0 11.6M8 2.2c-1.8 1.8-1.8 9.8 0 11.6" stroke="currentColor" stroke-width="1.3"/></svg>' +
              "</div>" +
              '<div style="font-size: 14px; font-weight: 600;">Remote Archive URL / GitHub Release</div>' +
              '<p style="font-size: 12px; color: var(--muted); line-height: 1.5;">Paste an HTTPS .zip release URL to fetch, index, and mount into Libraries.</p>' +
              '<div style="display: flex; gap: 6px; margin-top: auto; padding-top: 6px;">' +
                '<input type="url" class="search-input" id="import-url-input" placeholder="https://github.com/org/lib/archive/refs/tags/v1.0.0.zip" style="padding-left: 10px;" />' +
                '<button class="btn" data-action="submit-import-url">Mount URL</button>' +
              "</div>" +
            "</div>" +
          "</div>";
      }

      function renderInspector(filteredComps) {
        const bar = document.getElementById("comp-inspector");
        if (!bar) return;
        if (currentMode !== "components" || filteredComps.length === 0) {
          bar.classList.remove("open");
          return;
        }
        const comp = getAllComponents().find(c => c.id === selectedCompId) || filteredComps[0];
        if (!comp) {
          bar.classList.remove("open");
          return;
        }
        selectedCompId = comp.id;
        const mountedVer = getInstalledVersion(comp.packageName);
        const svgMarkup = liveIcons[comp.fqn] || comp.schematicSvg;
        const isPlacing = busyRequests.has("place:" + comp.fqn);

        bar.classList.add("open");
        bar.innerHTML =
          '<div class="insp-left">' +
            '<div class="insp-thumb">' + svgMarkup + "</div>" +
            '<div class="insp-meta">' +
              '<div class="insp-fqn">' + esc(comp.fqn) +
                ' <span style="font-weight: 400; color: var(--muted);">· ' +
                  esc(comp.packageName) + (mountedVer ? " v" + esc(mountedVer) + " (Mounted)" : " (Auto-mounts on Place)") +
                "</span>" +
              "</div>" +
              '<div class="insp-code">' + esc(comp.declarationSnippet) + "</div>" +
            "</div>" +
          "</div>" +
          '<div style="display: flex; align-items: center; gap: 8px;">' +
            '<button class="btn secondary" data-action="filter-to-pkg" data-pkg="' + esc(comp.packageName) + '">Filter ' + esc(comp.packageName) + "</button>" +
            '<button class="btn secondary" data-action="copy-comp" data-comp-id="' + esc(comp.id) + '">' + (copiedId === comp.id ? "✓ Copied" : "Copy Snippet") + "</button>" +
            '<button class="btn" data-action="place-comp" data-comp-id="' + esc(comp.id) + '" ' + (isPlacing ? "disabled" : "") + ">" +
              (isPlacing ? "Placing..." : "Place in Model") +
            "</button>" +
          "</div>";
      }

      function renderDrawer() {
        const drawer = document.getElementById("pkg-drawer");
        if (!drawer) return;
        const pkg = inspectingPkgName
          ? getAllPackages().find(p => p.name.toLowerCase() === inspectingPkgName.toLowerCase())
          : null;
        if (!pkg || currentMode === "import") {
          drawer.classList.remove("open");
          return;
        }
        drawer.classList.add("open");
        document.getElementById("drawer-title").textContent = pkg.name;
        document.getElementById("drawer-sub").textContent =
          (pkg.language || "Modelica") + " · " + (pkg.license || "Standard License");

        ["components", "dependencies", "about"].forEach(t => {
          document.getElementById("dtab-" + t)?.classList.toggle("active", drawerTab === t);
        });

        const body = document.getElementById("drawer-body");
        if (!body) return;

        if (drawerTab === "components") {
          const galleryMatches = getAllComponents().filter(c => c.packageName.toLowerCase() === pkg.name.toLowerCase());
          const summaryList = pkg.components || [];
          if (galleryMatches.length === 0 && summaryList.length === 0) {
            body.innerHTML = '<div style="color: var(--muted); font-size: 12px;">Mount this library to browse all classes in the sidebar tree.</div>';
            return;
          }
          if (galleryMatches.length > 0) {
            const previewRows = galleryMatches.slice(0, 80);
            const moreBtn = galleryMatches.length > 80
              ? '<button class="btn secondary" data-action="browse-pkg-comps" data-pkg="' + esc(pkg.name) + '" style="margin-top: 6px; width: 100%;">Browse all ' + galleryMatches.length.toLocaleString() + " components in gallery →</button>"
              : "";
            body.innerHTML = previewRows.map(c =>
              '<div class="drawer-comp-row">' +
                '<div style="min-width: 0;">' +
                  '<div style="font-size: 12px; font-weight: 600;">' + esc(c.shortName) + "</div>" +
                  '<div style="font-size: 10.5px; color: var(--muted); font-family: monospace; overflow: hidden; text-overflow: ellipsis;">' + esc(c.fqn) + "</div>" +
                "</div>" +
                '<button class="btn secondary" data-action="place-comp" data-comp-id="' + esc(c.id) + '">Place</button>' +
              "</div>"
            ).join("") + moreBtn;
          } else {
            body.innerHTML = summaryList.map(c =>
              '<div class="drawer-comp-row">' +
                '<div>' +
                  '<div style="font-size: 12px; font-weight: 600;">' + esc(c.name) + "</div>" +
                  '<div style="font-size: 11px; color: var(--muted);">' + esc(c.description || c.kind) + "</div>" +
                "</div>" +
              "</div>"
            ).join("");
          }
        } else if (drawerTab === "dependencies") {
          const deps = pkg.dependencies ? Object.entries(pkg.dependencies) : [];
          body.innerHTML =
            '<div style="font-size: 11.5px; color: var(--muted); margin-bottom: 6px;">Peer dependencies are automatically mounted or version-bumped when needed.</div>' +
            (deps.length > 0
              ? deps.map(([k, v]) =>
                  '<div class="drawer-comp-row"><strong>' + esc(k) + '</strong><span class="tag">' + esc(v) + "</span></div>"
                ).join("")
              : '<div style="color: var(--muted); font-size: 12px;">Standalone library (no peer dependencies).</div>');
        } else {
          body.innerHTML =
            '<div style="font-size: 12px; line-height: 1.55; color: var(--fg);">' + esc(pkg.readme || pkg.description || "") + "</div>" +
            '<div style="margin-top: 10px; padding: 10px; border-radius: 6px; border: 1px solid var(--border); font-size: 11.5px; color: var(--muted);">' +
              "Verified Ansatz package archive · Deterministic VFS symbol indexing" +
            "</div>";
        }
      }

      function renderAll() {
        const baseComps = getBaseFilteredComponents();
        const filteredComps = getFilteredComponents(baseComps);
        const filteredPkgs = getFilteredPackages();
        renderDomainBar(baseComps);
        renderHeaderMeta(filteredComps, filteredPkgs);
        if (currentMode === "components") {
          renderComponentsPane(filteredComps);
        } else if (currentMode === "libraries") {
          renderLibrariesPane(filteredPkgs);
        } else {
          renderImportPane();
        }
        renderInspector(filteredComps);
        renderDrawer();
      }

      function sendTracked(key, payload) {
        const requestId = key + ":" + Date.now();
        busyRequests.set(key, requestId);
        renderAll();
        vscode.postMessage(Object.assign({}, payload, { requestId }));
      }

      const scrollPane = document.getElementById("scroll-pane");
      if (scrollPane) {
        scrollPane.addEventListener("scroll", () => {
          if (currentMode !== "components") return;
          const total = getFilteredComponents().length;
          if (visibleLimit >= total) return;
          if (scrollPane.scrollTop + scrollPane.clientHeight >= scrollPane.scrollHeight - 260) {
            visibleLimit = Math.min(visibleLimit + PAGE_SIZE, total);
            renderAll();
          }
        });
      }

      // Delegated Click Handler (strictly CSP-safe, zero inline onclick attributes)
      document.addEventListener("click", (e) => {
        const target = e.target instanceof Element ? e.target.closest("[data-action]") : null;
        if (!target) return;
        const action = target.getAttribute("data-action");

        if (action === "set-mode") {
          currentMode = target.getAttribute("data-mode") || "components";
          renderAll();
        } else if (action === "set-domain") {
          currentDomain = target.getAttribute("data-domain") || "all";
          subpackageFilter = "";
          resetVisibleWindow();
          renderAll();
        } else if (action === "set-subpkg") {
          const nextSub = target.getAttribute("data-subpkg") || "";
          subpackageFilter = subpackageFilter === nextSub ? "" : nextSub;
          resetVisibleWindow();
          renderAll();
        } else if (action === "load-more-comps") {
          visibleLimit += PAGE_SIZE;
          renderAll();
        } else if (action === "clear-search") {
          const inp = document.getElementById("search-input");
          if (inp) { inp.value = ""; inp.focus(); }
          liveClasses = [];
          cachedAllComps = null;
          resetVisibleWindow();
          renderAll();
        } else if (action === "clear-pkg-filter") {
          packageFilter = "";
          subpackageFilter = "";
          resetVisibleWindow();
          renderAll();
        } else if (action === "filter-to-pkg") {
          packageFilter = target.getAttribute("data-pkg") || "";
          subpackageFilter = "";
          currentMode = "components";
          resetVisibleWindow();
          renderAll();
        } else if (action === "browse-pkg-comps") {
          packageFilter = target.getAttribute("data-pkg") || "";
          subpackageFilter = "";
          currentDomain = "all";
          currentMode = "components";
          inspectingPkgName = "";
          resetVisibleWindow();
          renderAll();
        } else if (action === "toggle-mounted-only") {
          mountedOnly = !mountedOnly;
          resetVisibleWindow();
          renderAll();
        } else if (action === "cycle-sort") {
          librarySort = librarySort === "popular" ? "name" : "popular";
          renderAll();
        } else if (action === "reset-filters") {
          currentDomain = "all";
          packageFilter = "";
          subpackageFilter = "";
          mountedOnly = false;
          const inp = document.getElementById("search-input");
          if (inp) inp.value = "";
          resetVisibleWindow();
          renderAll();
        } else if (action === "select-comp") {
          selectedCompId = target.getAttribute("data-comp-id") || "";
          renderAll();
        } else if (action === "place-comp") {
          e.stopPropagation();
          const compId = target.getAttribute("data-comp-id") || "";
          const comp = getAllComponents().find(c => c.id === compId);
          if (!comp) return;
          selectedCompId = comp.id;
          sendTracked("place:" + comp.fqn, {
            command: "placeComponent",
            fqn: comp.fqn,
            shortName: comp.shortName,
            kind: comp.kind,
            declarationSnippet: comp.declarationSnippet,
            packageName: comp.packageName,
            packageVersion: comp.packageVersion,
          });
        } else if (action === "copy-comp") {
          e.stopPropagation();
          const compId = target.getAttribute("data-comp-id") || "";
          const comp = getAllComponents().find(c => c.id === compId);
          if (!comp) return;
          copiedId = comp.id;
          vscode.postMessage({ command: "copyText", text: comp.declarationSnippet });
          showToast("Copied: " + comp.declarationSnippet);
          renderAll();
          setTimeout(() => { if (copiedId === comp.id) { copiedId = ""; renderAll(); } }, 1500);
        } else if (action === "install-pkg") {
          const pkgName = target.getAttribute("data-pkg") || "";
          const ver = target.getAttribute("data-ver") || "latest";
          if (!pkgName) return;
          sendTracked("pkg:" + pkgName, { command: "install", name: pkgName, version: ver });
        } else if (action === "uninstall-pkg") {
          const pkgName = target.getAttribute("data-pkg") || "";
          if (!pkgName) return;
          sendTracked("pkg:" + pkgName, { command: "uninstall", name: pkgName });
        } else if (action === "open-drawer") {
          inspectingPkgName = target.getAttribute("data-pkg") || "";
          renderAll();
        } else if (action === "close-drawer") {
          inspectingPkgName = "";
          renderAll();
        } else if (action === "set-drawer-tab") {
          drawerTab = target.getAttribute("data-tab") || "components";
          renderDrawer();
        } else if (action === "open-model-hub") {
          vscode.postMessage({ command: "openModelHub" });
        } else if (action === "import-zip") {
          vscode.postMessage({ command: "importZip" });
        } else if (action === "submit-import-url") {
          const urlInp = document.getElementById("import-url-input");
          const rawUrl = urlInp ? urlInp.value.trim() : "";
          if (!rawUrl) {
            vscode.postMessage({ command: "importUrl" });
            return;
          }
          sendTracked("import:url", { command: "importUrl", url: rawUrl });
        }
      });

      document.addEventListener("change", (e) => {
        const target = e.target instanceof HTMLSelectElement ? e.target : null;
        if (!target) return;
        if (target.getAttribute("data-action") === "select-ver") {
          const pkgName = target.getAttribute("data-pkg") || "";
          if (pkgName) {
            selectedVersions[pkgName] = target.value;
            renderAll();
          }
        }
      });

      const searchInput = document.getElementById("search-input");
      if (searchInput) {
        searchInput.addEventListener("input", () => {
          resetVisibleWindow();
          renderAll();
          const q = searchInput.value.trim();
          if (searchDebounce) clearTimeout(searchDebounce);
          if (q.length >= 2) {
            searchDebounce = setTimeout(() => {
              vscode.postMessage({ command: "searchLive", query: q });
            }, 180);
          } else {
            liveClasses = [];
            cachedAllComps = null;
          }
        });
      }

      document.addEventListener("keydown", (e) => {
        if ((e.key === "/" || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) && document.activeElement !== searchInput) {
          e.preventDefault();
          searchInput?.focus();
        } else if (e.key === "Escape" && inspectingPkgName) {
          inspectingPkgName = "";
          renderAll();
        }
      });

      // Drag-to-Canvas / Drag-to-Editor support
      document.addEventListener("dragstart", (e) => {
        const card = e.target instanceof Element ? e.target.closest(".comp-card") : null;
        if (!card || !e.dataTransfer) return;
        const compId = card.getAttribute("data-comp-id") || "";
        const comp = getAllComponents().find(c => c.id === compId);
        if (!comp) return;
        const svgMarkup = liveIcons[comp.fqn] || comp.schematicSvg;
        const payload = JSON.stringify({
          className: comp.fqn,
          classKind: comp.kind,
          iconSvg: svgMarkup,
          isDrag: true,
        });
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData("application/json", payload);
        e.dataTransfer.setData("application/vnd.modelscript.classname", comp.fqn);
        e.dataTransfer.setData("application/vnd.modelscript.iconsvg", svgMarkup);
        e.dataTransfer.setData("text/plain", comp.declarationSnippet);
        vscode.postMessage({
          command: "dragStartComponent",
          fqn: comp.fqn,
          kind: comp.kind,
          iconSvg: svgMarkup,
          packageName: comp.packageName,
          packageVersion: comp.packageVersion,
        });
      });

      document.addEventListener("dragend", () => {
        vscode.postMessage({ command: "dragEndComponent" });
      });

      window.addEventListener("message", (event) => {
        const msg = event.data || {};
        if (msg.command === "setInstalled") {
          installedDeps = msg.dependencies || {};
          cachedAllComps = null;
          renderAll();
        } else if (msg.command === "setCatalogComponents") {
          catalogClasses = Array.isArray(msg.components) ? msg.components : [];
          cachedAllComps = null;
          renderAll();
        } else if (msg.command === "inspectPackage") {
          inspectingPkgName = msg.name || "";
          currentMode = "libraries";
          renderAll();
        } else if (msg.command === "iconsLoaded" && msg.icons) {
          for (const [k, svg] of Object.entries(msg.icons)) {
            const norm = normalizeLiveSvg(svg);
            if (norm) liveIcons[k] = norm;
          }
          renderAll();
        } else if (msg.command === "liveSearchResults") {
          const curQ = (document.getElementById("search-input")?.value || "").trim();
          if (curQ && msg.query === curQ) {
            liveClasses = Array.isArray(msg.classes) ? msg.classes : [];
            livePackages = Array.isArray(msg.packages) ? msg.packages : [];
            cachedAllComps = null;
            renderAll();
          }
        } else if (msg.command === "actionComplete") {
          for (const [k, reqId] of busyRequests.entries()) {
            if (!msg.requestId || reqId === msg.requestId) {
              busyRequests.delete(k);
            }
          }
          if (msg.message) showToast(msg.message);
          renderAll();
        }
      });

      renderAll();
    })();
  </script>
</body>
</html>`;
}
