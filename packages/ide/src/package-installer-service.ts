// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import type { HubDomainId } from "./component-hub-catalog.js";
import { getRegistryUrl, isAirgapped } from "./utils/config.js";

const VALID_PACKAGE_NAME_RE = /^(?:@[a-zA-Z0-9._-]+\/)?[a-zA-Z0-9._-]+$/;
const VALID_VERSION_RE = /^[a-zA-Z0-9.+_-]+$/;

export function isValidPackageName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed || trimmed.includes("..") || trimmed.includes("\\")) return false;
  return VALID_PACKAGE_NAME_RE.test(trimmed);
}

export function isValidVersionSpec(version: string): boolean {
  const trimmed = version.trim();
  if (!trimmed || trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) return false;
  return VALID_VERSION_RE.test(trimmed);
}

export function isAllowedImportUrl(rawUrl: string): boolean {
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

export function isUntrustedWorkspace(): boolean {
  return (vscode.workspace as { isTrusted?: boolean | undefined }).isTrusted === false;
}

export function isBlockedByAirgap(baseUrl: string): boolean {
  if (!isAirgapped()) return false;
  try {
    const parsed = new URL(baseUrl);
    const h = parsed.hostname.toLowerCase();
    return (
      h === "api.modelscript.org" ||
      h.endsWith(".modelscript.org") ||
      h === "ansatz.social" ||
      h.endsWith(".ansatz.social")
    );
  } catch {
    return true;
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

export interface MountedLibSnapshot {
  name: string;
  version: string;
  explicitlyInstalled?: boolean | undefined;
}

export interface AnsatzStreamedComponentItem {
  fqn: string;
  name: string;
  kind: string;
  domain: string;
  subpackage?: string | null | undefined;
  packageName: string;
  packageVersion: string;
  description?: string | null | undefined;
  language?: string | undefined;
  hasIcon?: boolean | undefined;
  iconSvg?: string | undefined;
}

export interface AnsatzStreamComponentsParams {
  q?: string | undefined;
  domain?: string | undefined;
  packageName?: string | undefined;
  subpackage?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  includeSvg?: boolean | undefined;
}

export interface AnsatzStreamComponentsResult {
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  items: AnsatzStreamedComponentItem[];
  availablePackages: { name: string; version: string; count: number }[];
  availableSubpackages: { id: string; label: string; count: number }[];
  packageDependencies: Record<string, Record<string, string>>;
  fromRegistry: boolean;
}

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
export const sessionInstalledPackages = new Map<string, string>();

const sessionRegistryDependencies = new Map<string, Record<string, string>>();

export function registerSessionRegistryDependencies(deps: Record<string, Record<string, string>> | undefined): void {
  if (!deps || typeof deps !== "object") return;
  for (const [pkg, peerMap] of Object.entries(deps)) {
    if (peerMap && typeof peerMap === "object") {
      sessionRegistryDependencies.set(pkg.toLowerCase(), peerMap);
    }
  }
}

/**
 * Fetches matching packages from the Ansatz registry (`/api/v1/packages` with fallback to `/api/v1/libraries`).
 */
export async function searchAnsatzPackages(query: string, signal?: AbortSignal): Promise<AnsatzPackageSummary[]> {
  const baseUrl = getRegistryUrl().replace(/\/+$/, "");
  if (isBlockedByAirgap(baseUrl)) {
    return [];
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

/**
 * Resolves `"latest"` version against Ansatz if needed so the LSP loader receives a concrete semver when available.
 */
export async function resolveConcreteVersion(packageName: string, requestedVersion: string): Promise<string> {
  if (requestedVersion && requestedVersion !== "latest") {
    return requestedVersion;
  }
  const curated = CURATED_LIBRARIES.find((c) => c.name.toLowerCase() === packageName.toLowerCase());
  const baseUrl = getRegistryUrl().replace(/\/+$/, "");
  if (isBlockedByAirgap(baseUrl)) {
    return curated?.latestVersion || requestedVersion || "latest";
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

export function extractPackageNameFromArg(
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

export async function installViaLsp(
  lspClient: LspClientLike | undefined,
  name: string,
  version: string,
): Promise<void> {
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

export async function uninstallViaLsp(lspClient: LspClientLike | undefined, name: string): Promise<void> {
  if (!lspClient) return;
  if (typeof lspClient.sendRequest === "function") {
    await lspClient.sendRequest("modelscript/uninstallPackage", { name });
  } else {
    lspClient.sendNotification("modelscript/uninstallDependency", { name });
  }
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

export function compareSemverParts(a: string, b: string): number {
  const pa = a
    .replace(/^[^\d]*/, "")
    .split(".")
    .map((n) => Number.parseInt(n, 10) || 0);
  const pb = b
    .replace(/^[^\d]*/, "")
    .split(".")
    .map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export async function ensureParentLibraryInstalled(
  packageName: string | undefined,
  packageVersion: string | undefined,
  lspClient?: LspClientLike,
): Promise<boolean> {
  if (!packageName) return false;
  const current = await getEffectiveInstalledDependencies(lspClient);
  const alreadyMounted = Object.keys(current).some((k) => k.toLowerCase() === packageName.toLowerCase());
  if (alreadyMounted) return false;

  const curatedMeta = CURATED_LIBRARIES.find((lib) => lib.name.toLowerCase() === packageName.toLowerCase());
  const peerDeps = curatedMeta?.dependencies ?? sessionRegistryDependencies.get(packageName.toLowerCase());
  if (peerDeps) {
    for (const [peerName, range] of Object.entries(peerDeps)) {
      if (peerName === "Complex" || peerName === "ModelicaServices") continue;
      const minVer = range.replace(/^[^\d]*/, "").trim();
      if (!minVer) continue;
      const mountedKey = Object.keys(current).find((k) => k.toLowerCase() === peerName.toLowerCase());
      const mountedVer = mountedKey ? current[mountedKey] : undefined;
      if (!mountedVer || compareSemverParts(mountedVer, minVer) < 0) {
        await vscode.commands.executeCommand("modelscript.registry.install", peerName, minVer);
      }
    }
  }

  await vscode.commands.executeCommand("modelscript.registry.install", packageName, packageVersion || "latest");
  return true;
}

export async function installRegistryPackage(
  packageName: string,
  packageVersion: string,
  lspClient: LspClientLike | undefined,
  onInstalledChanged?: () => Promise<void>,
): Promise<boolean> {
  if (isUntrustedWorkspace()) {
    vscode.window.showErrorMessage("Cannot install packages in an untrusted workspace.");
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

        // Automatic peer-dependency version bump & auto-mount
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
            } else if (reqVer.startsWith(">=") && curVer.localeCompare(minVer, undefined, { numeric: true }) < 0) {
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
        if (onInstalledChanged) {
          await onInstalledChanged();
        }
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to add package '${packageName}': ${err}`);
      }
    },
  );
  return succeeded;
}

export async function switchLibraryVersion(
  arg: string | { info?: { name?: string; id?: string; description?: string } } | undefined,
  lspClient: LspClientLike | undefined,
): Promise<void> {
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
}

export async function uninstallRegistryPackage(
  arg: string | { info?: { name?: string; id?: string } } | undefined,
  lspClient: LspClientLike | undefined,
  onInstalledChanged?: () => Promise<void>,
): Promise<void> {
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
        if (onInstalledChanged) {
          await onInstalledChanged();
        }
        vscode.window.showInformationMessage(`Removed ${packageName} from workspace.`);
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to remove library '${packageName}': ${err}`);
      }
    },
  );
}

export async function toggleStandardPackProfile(
  arg: string | { info?: { name?: string; id?: string; description?: string } } | undefined,
  lspClient: LspClientLike | undefined,
): Promise<void> {
  if (!lspClient?.sendRequest) return;
  const { name } = extractPackageNameFromArg(arg);
  try {
    const resp = await lspClient.sendRequest<{
      standards?: Array<{ name: string; standardCode?: string; active?: boolean; activation?: string }>;
    }>("modelscript/getActiveStandards", {});
    const standards = resp?.standards ?? [];
    if (standards.length === 0) {
      vscode.window.showInformationMessage("No standard packs are currently mounted in the workspace.");
      return;
    }
    let target = name ? standards.find((s) => s.name.toLowerCase() === name.toLowerCase()) : undefined;
    let nextActive = target ? !target.active : true;
    if (!target && typeof vscode.window.showQuickPick === "function") {
      const picked = await vscode.window.showQuickPick(
        standards.map((s) => ({
          label: s.name,
          description: `${s.standardCode ?? "Standard Pack"} · ${s.active ? "Active globally" : `Activation: ${s.activation ?? "import"}`}`,
          pack: s,
        })),
        { placeHolder: "Select a mounted standard pack to toggle global activation" },
      );
      if (!picked) return;
      target = picked.pack;
      nextActive = !target.active;
    }
    if (!target) return;
    await lspClient.sendRequest("modelscript/setActiveStandards", {
      packageName: target.name,
      active: nextActive,
    });
    await vscode.commands.executeCommand("modelscript.libraryView.refresh");
    vscode.window.showInformationMessage(
      `Standard pack '${target.name}' is now ${nextActive ? "globally active" : "import-scoped"}.`,
    );
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to toggle standard pack profile: ${err}`);
  }
}

export async function importLibraryFromZip(
  lspClient: LspClientLike | undefined,
  onInstalledChanged?: () => Promise<void>,
): Promise<void> {
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
    if (onInstalledChanged) {
      await onInstalledChanged();
    }
    vscode.window.showInformationMessage(`Mounted library archive '${mountedName}' into Libraries.`);
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to import .zip library: ${err}`);
  }
}

export async function importLibraryFromUrl(
  lspClient: LspClientLike | undefined,
  passedUrl?: string,
  skipModalConfirm = false,
  onInstalledChanged?: () => Promise<void>,
): Promise<void> {
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
    if (onInstalledChanged) {
      await onInstalledChanged();
    }
    vscode.window.showInformationMessage(`Mounted library '${mountedName}' from ${url}.`);
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to import library URL: ${err}`);
  }
}
