// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CpuIcon,
  DatabaseIcon,
  FileCodeIcon,
  GlobeIcon,
  PackageIcon as OcticonPackageIcon,
  WorkflowIcon,
} from "@primer/octicons-react";
import React from "react";

export interface DomainOption {
  id: string;
  label: string;
  color: string;
  icon: React.ComponentType<{ size?: number | undefined }>;
}

export const DOMAIN_OPTIONS: DomainOption[] = [
  { id: "all", label: "All Domains", color: "#06b6d4", icon: GlobeIcon },
  { id: "modelica", label: "Modelica", color: "#eab308", icon: FileCodeIcon },
  { id: "sysml2", label: "SysML v2", color: "#a855f7", icon: WorkflowIcon },
  { id: "cad", label: "3D CAD", color: "#06b6d4", icon: OcticonPackageIcon },
  { id: "fmu", label: "FMU", color: "#f43f5e", icon: CpuIcon },
  { id: "dataset", label: "Datasets", color: "#3b82f6", icon: DatabaseIcon },
];

export function formatDomainLabel(domain: string): string {
  switch (domain) {
    case "modelica":
      return "Modelica";
    case "sysml2":
    case "sysml":
      return "SysML v2";
    case "cad":
    case "step":
    case "scad":
    case "cad-structures":
      return "3D CAD";
    case "fmu":
    case "ssp":
      return "FMU / SSP";
    case "dataset":
    case "csv":
      return "Dataset";
    case "power":
    case "pscad":
      return "PSCAD / EMT";
    case "power-energy":
    case "electrical-power":
      return "Power & Energy";
    case "robotics":
    case "urdf":
      return "Robotics / URDF";
    case "hydraulics":
    case "epanet":
      return "Hydraulics";
    case "fluids-process":
    case "process":
      return "Fluids & Process";
    case "mobility-auto":
    case "mobility-systems":
    case "automotive":
      return "Mobility & Automotive";
    case "life-sciences":
    case "sbml":
    case "biomodel":
      return "Life Sciences";
    case "systems-physics":
      return "Systems & Physics";
    case "verification":
      return "Verification";
    case "cfd":
      return "CFD";
    case "fea":
      return "FEA";
    default:
      return domain;
  }
}

export function splitScopedPackageName(fullName: string): { scope: string | null; baseName: string } {
  if (fullName.startsWith("@") && fullName.includes("/")) {
    const slashIdx = fullName.indexOf("/");
    return {
      scope: fullName.slice(0, slashIdx),
      baseName: fullName.slice(slashIdx + 1),
    };
  }
  return { scope: null, baseName: fullName };
}

export function inferPackageDomains(pkg: {
  name: string;
  domains?: string[] | undefined;
  description?: string | null | undefined;
}): string[] {
  const nameLower = pkg.name.toLowerCase();
  const descLower = (pkg.description || "").toLowerCase();
  const combined = `${nameLower} ${descLower}`;
  const set = new Set<string>();

  if (nameLower === "sysml" || combined.includes("sysml") || combined.includes("kerml")) {
    set.add("sysml2");
  }
  if (
    combined.includes("pscad") ||
    combined.includes("microgrid") ||
    combined.includes("ieee 2800") ||
    combined.includes("emt") ||
    combined.includes("openipsl") ||
    combined.includes("power system") ||
    combined.includes("power grid") ||
    combined.includes("power-energy") ||
    combined.includes("powerfactory") ||
    combined.includes("psse")
  ) {
    set.add("power");
  }
  if (combined.includes("robot") || combined.includes("urdf") || combined.includes("kinematic")) {
    set.add("robotics");
  }
  if (combined.includes("epanet") || combined.includes("water distribution") || combined.includes("hydraulic")) {
    set.add("hydraulics");
  }
  if (combined.includes("reachability") || combined.includes("zonotope") || combined.includes("nelson-oppen")) {
    set.add("verification");
  }
  if (
    combined.includes("step") ||
    combined.includes("openscad") ||
    combined.includes("chassis") ||
    combined.includes("3d cad") ||
    combined.includes("cad-structures")
  ) {
    set.add("cad");
  }
  if (combined.includes("cfd") || combined.includes("su2")) {
    set.add("cfd");
  }
  if (combined.includes("fea") || combined.includes("calculix")) {
    set.add("fea");
  }
  if (combined.includes("fmu") || combined.includes("ssp") || combined.includes("co-simulation")) {
    set.add("fmu");
  }
  if (
    nameLower === "modelica" ||
    combined.includes("modelica") ||
    combined.includes("dae") ||
    nameLower === "openipsl"
  ) {
    set.add("modelica");
  }

  if (Array.isArray(pkg.domains)) {
    for (const d of pkg.domains) {
      if (!d) continue;
      // Avoid spurious fallback "modelica" tag on purely non-Modelica packages like SysML, EPANET, or Standard-Robots
      if (
        d === "modelica" &&
        nameLower !== "modelica" &&
        !combined.includes("modelica") &&
        (set.has("sysml2") || set.has("hydraulics") || set.has("robotics"))
      ) {
        continue;
      }
      set.add(d);
    }
  }

  if (set.size === 0) {
    set.add("modelica");
  }

  return Array.from(set).slice(0, 4);
}

export function getPackageLanguageBadge(pkg: {
  name: string;
  language?: string | undefined;
  lang?: string | undefined;
  domains?: string[] | undefined;
  description?: string | null | undefined;
}): { id: string; label: string } {
  const lang = (pkg.language || pkg.lang || "").toLowerCase().trim();
  if (lang === "modelica") return { id: "modelica", label: "Modelica" };
  if (lang === "sysml2" || lang === "sysml") return { id: "sysml2", label: "SysML v2" };
  if (lang === "spice") return { id: "power", label: "SPICE" };
  if (lang === "step" || lang === "cad") return { id: "cad", label: "3D CAD" };
  if (lang === "fmu" || lang === "ssp") return { id: "fmu", label: "FMU / SSP" };
  if (lang) return { id: lang, label: formatDomainLabel(lang) };

  const nameLower = pkg.name.toLowerCase();
  const descLower = (pkg.description || "").toLowerCase();
  const combined = `${nameLower} ${descLower}`;

  if (nameLower === "sysml" || combined.includes("sysml")) {
    return { id: "sysml2", label: "SysML v2" };
  }

  // Modelica is the default and canonical language for packages in the registry
  return { id: "modelica", label: "Modelica" };
}

export function formatTimeAgo(dateStr?: string | null): string {
  if (!dateStr) return "";
  try {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (days < 1) return "updated today";
    if (days === 1) return "updated yesterday";
    if (days < 30) return `updated ${days}d ago`;
    if (days < 365) return `updated ${Math.floor(days / 30)}mo ago`;
    return `updated ${Math.floor(days / 365)}y ago`;
  } catch {
    return "";
  }
}
