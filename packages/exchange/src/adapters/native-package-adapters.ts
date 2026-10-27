// SPDX-License-Identifier: AGPL-3.0-or-later

import { deflateRaw, inflateRaw } from "pako";
import type {
  CanonicalBOMItem,
  CanonicalSubmodelDescriptor,
  CanonicalWorkspaceManifest,
  PackageJsonProjection,
} from "../lens/types.js";

/**
 * Complete extension-to-language mapping across all 44 ModelScript languages.
 */
export const EXTENSION_TO_LANGUAGE_ID: Record<string, string> = {
  ".adm": "adams",
  ".acf": "adams",
  ".cmd": "adams",
  ".bkp": "aspen",
  ".arxml": "autosar",
  ".c": "c",
  ".h": "c",
  ".oem": "ccsds",
  ".omm": "ccsds",
  ".opm": "ccsds",
  ".tdm": "ccsds",
  ".cfg": "cfd",
  ".foam": "cfd",
  ".su2": "cfd",
  ".msh": "cfd",
  ".csv": "csv",
  ".tsv": "csv",
  ".ezmf": "easy5",
  ".ezanl": "easy5",
  ".data": "eclipse",
  ".inc": "eclipse",
  ".grdecl": "eclipse",
  ".idf": "energyplus",
  ".epw": "energyplus",
  ".epanet": "epanet",
  ".bdf": "fea",
  ".dat": "fea",
  ".fem": "fea",
  ".f90": "fortran",
  ".f": "fortran",
  ".for": "fortran",
  ".gensys": "gensys",
  ".tsimf": "gensys",
  ".runf": "gensys",
  ".mrund": "gensys",
  ".gtm": "gtsuite",
  ".gtsub": "gtsuite",
  ".ibs": "ibis",
  ".ebd": "ibis",
  ".pkg": "ibis",
  ".jsbsim": "jsbsim",
  ".lps": "lps",
  ".pl": "lps",
  ".swmm": "swmm",
  ".mo": "modelica",
  ".mos": "modelica",
  ".mol": "modelica",
  ".msx": "modelscript",
  ".modelscript": "modelscript",
  ".olga": "olga",
  ".opi": "olga",
  ".tab": "olga",
  ".xodr": "opendrive",
  ".dss": "opendss",
  ".xosc": "openscenario",
  ".owl": "owl2",
  ".owl2": "owl2",
  ".ofn": "owl2",
  ".omn": "owl2",
  ".owx": "owl2",
  ".ttl": "owl2",
  ".plcopen": "plcopen",
  ".st": "plcopen",
  ".iec": "plcopen",
  ".pscx": "pscad",
  ".pslx": "pscad",
  ".pswx": "pscad",
  ".raw": "psse",
  ".dyr": "psse",
  ".seq": "psse",
  ".r5": "relap5",
  ".i": "relap5",
  ".reqif": "reqif",
  ".reqifz": "reqif",
  ".roc": "rocets",
  ".rocin": "rocets",
  ".sbml": "sbml",
  ".omex": "sbml",
  ".scad": "scad",
  ".csg": "scad",
  ".sima": "sima",
  ".riflex": "sima",
  ".simo": "sima",
  ".stask": "sima",
  ".spck": "simpack",
  ".sim": "simpack",
  ".sbr": "simpack",
  ".slx": "simulink",
  ".mdl": "simulink",
  ".cir": "spice",
  ".sp": "spice",
  ".spice": "spice",
  ".net": "spice",
  ".lib": "spice",
  ".sub": "spice",
  ".ssp": "ssp",
  ".ssd": "ssp",
  ".ssv": "ssp",
  ".ssm": "ssp",
  ".step": "step",
  ".stp": "step",
  ".p21": "step",
  ".sysml": "sysml2",
  ".kerml": "sysml2",
  ".sysml2": "sysml2",
  ".sysmlx": "sysml2",
  ".kpar": "sysml2",
  ".s1p": "touchstone",
  ".s2p": "touchstone",
  ".s3p": "touchstone",
  ".s4p": "touchstone",
  ".s5p": "touchstone",
  ".s6p": "touchstone",
  ".s7p": "touchstone",
  ".s8p": "touchstone",
  ".snp": "touchstone",
  ".urdf": "urdf",
  ".sdf": "urdf",
  ".xacro": "urdf",
  ".va": "verilog-a",
  ".vams": "verilog-a",
  ".ams": "verilog-a",
};

/**
 * Detect all ModelScript language IDs present in a list of file paths.
 */
export function detectLanguagesFromPaths(
  filePaths: string[],
  contentLookup?: (relPath: string) => string | undefined,
): string[] {
  const langs = new Set<string>();
  for (const rawPath of filePaths) {
    const lower = rawPath.toLowerCase();
    const dotIdx = lower.lastIndexOf(".");
    const ext = dotIdx >= 0 ? lower.slice(dotIdx) : "";

    if (ext === ".inp") {
      const sample = contentLookup?.(rawPath) ?? "";
      if (/\[JUNCTIONS\]|\[PIPES\]|\[RESERVOIRS\]/i.test(sample)) langs.add("epanet");
      else if (/\[SUBCATCHMENTS\]|\[CONDUITS\]|\[OUTFALLS\]/i.test(sample)) langs.add("swmm");
      else if (/\bOLGA\b|\bPVTTABLE\b|\bBRANCH\b/i.test(sample)) langs.add("olga");
      else if (/^\s*\*(?:HEADING|NODE|ELEMENT|MATERIAL|STEP)/im.test(sample)) langs.add("fea");
      else if (/\bTITLE\b[\s\S]*\bCOMPONENTS\b|\bFLOWSHEET\b/i.test(sample)) langs.add("aspen");
      else if (/^=\s*|^0000100/m.test(sample)) langs.add("relap5");
      else langs.add("fea");
      continue;
    }

    if (ext === ".xml") {
      const sample = contentLookup?.(rawPath) ?? "";
      if (/<fdm_config\b/i.test(sample)) langs.add("jsbsim");
      else if (/<sbml\b/i.test(sample)) langs.add("sbml");
      else if (/<project\b[^>]*plcopen/i.test(sample) || /<pous\b/i.test(sample)) langs.add("plcopen");
      continue;
    }

    const mapped = EXTENSION_TO_LANGUAGE_ID[ext];
    if (mapped) {
      langs.add(mapped);
    }
  }
  return Array.from(langs);
}

/**
 * Normalize non-semver strings (e.g. "4.1", "2026-03", "v1.2") into valid SemVer.
 */
export function normalizeToSemver(raw?: string | null, fallback = "1.0.0"): string {
  if (!raw || typeof raw !== "string") return fallback;
  const cleaned = raw.trim().replace(/^[vV]/, "");
  if (/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(cleaned)) {
    return cleaned;
  }
  // e.g. "2026-03" -> "2026.3.0"
  const dateMatch = cleaned.match(/^(\d{4})[-.]0*(\d{1,2})(?:[-.]0*(\d{1,2}))?$/);
  if (dateMatch) {
    return `${dateMatch[1]}.${Number(dateMatch[2])}.${dateMatch[3] ? Number(dateMatch[3]) : 0}`;
  }
  // e.g. "4.1" -> "4.1.0"
  const twoPart = cleaned.match(/^(\d+)\.(\d+)$/);
  if (twoPart) {
    return `${twoPart[1]}.${twoPart[2]}.0`;
  }
  // e.g. "4" -> "4.0.0"
  const onePart = cleaned.match(/^(\d+)$/);
  if (onePart) {
    return `${onePart[1]}.0.0`;
  }
  return fallback;
}

/* ============================================================================
 * 1. OMG KerML / SysML v2 Package Archive (.kpar) Adapter
 * ============================================================================ */

export interface KparUsageEntry {
  resource: string;
  versionConstraint?: string | undefined;
}

export interface KparMetaJson {
  name: string;
  version: string;
  description?: string | undefined;
  license?: string | undefined;
  created?: string | undefined;
  maintainer?: string | { name: string; email?: string | undefined } | undefined;
  usage?: KparUsageEntry[] | undefined;
}

export type KparIndexJson = Record<string, string>;

export class KparPackageAdapter {
  /**
   * Ingest an OMG .kpar `.meta.json` and optional `.Index.json` into a CanonicalWorkspaceManifest.
   */
  static ingestFromKpar(
    metaJson: string | KparMetaJson,
    indexJson?: string | KparIndexJson,
  ): {
    manifest: CanonicalWorkspaceManifest;
    dependencies: Record<string, string>;
    entryPoint?: string | undefined;
  } {
    const meta: KparMetaJson = typeof metaJson === "string" ? JSON.parse(metaJson) : metaJson;
    const index: KparIndexJson = typeof indexJson === "string" ? JSON.parse(indexJson) : (indexJson ?? {});

    const rawName = (meta.name || "sysml-package").trim();
    const scope = rawName.startsWith("@") ? rawName.split("/")[0] : undefined;
    const idShort = rawName.startsWith("@") ? (rawName.split("/")[1] ?? rawName) : rawName;
    const version = normalizeToSemver(meta.version, "1.0.0");

    const dependencies: Record<string, string> = {};
    const bom: CanonicalBOMItem[] = [];
    if (Array.isArray(meta.usage)) {
      for (const u of meta.usage) {
        if (!u.resource) continue;
        // Extract package name from URI or direct identifier
        const depName = u.resource.includes("/")
          ? (u.resource.split("/").filter(Boolean).pop() ?? u.resource)
          : u.resource;
        const verConstraint = u.versionConstraint || "*";
        dependencies[depName] = verConstraint;
        bom.push({
          name: depName,
          quantity: 1,
          packageDependency: `${depName}@${verConstraint}`,
          category: "other",
        });
      }
    }

    const requirements: CanonicalWorkspaceManifest["requirements"] = [];
    let firstFile: string | undefined;
    for (const [pkgName, relPath] of Object.entries(index)) {
      if (!firstFile) firstFile = relPath;
      requirements.push({
        id: pkgName,
        path: relPath,
        format: relPath.endsWith(".kerml") ? "KerML 1.0" : "SysML v2",
        description: `SysML v2 / KerML package ${pkgName}`,
      });
    }

    const author =
      typeof meta.maintainer === "string"
        ? { name: meta.maintainer }
        : meta.maintainer
          ? { name: meta.maintainer.name, email: meta.maintainer.email }
          : undefined;

    const manifest: CanonicalWorkspaceManifest = {
      globalAssetId: `urn:omg:sysml2:kpar:${idShort}:${version}`,
      idShort,
      title: meta.description || idShort,
      version,
      scope,
      description: meta.description ?? `OMG SysML v2 / KerML Package Archive (${idShort})`,
      author,
      license: meta.license ?? "OMG-SysML-2.0",
      bom: bom.length > 0 ? bom : undefined,
      requirements: requirements.length > 0 ? requirements : undefined,
    };

    return { manifest, dependencies, entryPoint: firstFile };
  }

  /**
   * Project a CanonicalWorkspaceManifest into OMG `.kpar` `.meta.json` and `.Index.json`.
   */
  static projectToKpar(
    manifest: CanonicalWorkspaceManifest,
    sysmlFiles?: { packageName: string; path: string }[],
  ): { metaJson: KparMetaJson; indexJson: KparIndexJson } {
    const usage: KparUsageEntry[] = [];
    if (manifest.bom) {
      for (const item of manifest.bom) {
        if (item.packageDependency) {
          const atIdx = item.packageDependency.lastIndexOf("@");
          const pkg = atIdx > 0 ? item.packageDependency.slice(0, atIdx) : item.packageDependency;
          const ver = atIdx > 0 ? item.packageDependency.slice(atIdx + 1) : undefined;
          usage.push({
            resource: `https://hub.modelscript.org/api/v1/libraries/${pkg}`,
            versionConstraint: ver,
          });
        }
      }
    }

    const indexJson: KparIndexJson = {};
    if (sysmlFiles && sysmlFiles.length > 0) {
      for (const f of sysmlFiles) {
        indexJson[f.packageName] = f.path;
      }
    } else if (manifest.requirements) {
      for (const req of manifest.requirements) {
        if (req.path.endsWith(".sysml") || req.path.endsWith(".kerml")) {
          indexJson[req.id] = req.path;
        }
      }
    }

    const metaJson: KparMetaJson = {
      name: manifest.scope ? `${manifest.scope}/${manifest.idShort}` : manifest.idShort,
      version: manifest.version,
      description: manifest.description ?? manifest.title,
      license: manifest.license,
      created: new Date().toISOString(),
      maintainer: manifest.author ? { name: manifest.author.name, email: manifest.author.email } : undefined,
      usage: usage.length > 0 ? usage : undefined,
    };

    return { metaJson, indexJson };
  }

  /**
   * Build a standard OMG `.kpar` ZIP archive buffer containing `.meta.json`, `.Index.json`,
   * `package.json` (for NPM registry compatibility), and all `.sysml`/`.kerml` source files.
   */
  static buildKparArchive(options: {
    manifest: CanonicalWorkspaceManifest;
    files: { path: string; data: string | Uint8Array }[];
    packageJson?: PackageJsonProjection | undefined;
  }): Uint8Array {
    const discoveredSysml: { packageName: string; path: string }[] = [];
    for (const f of options.files) {
      if (f.path.endsWith(".sysml") || f.path.endsWith(".kerml")) {
        const text = typeof f.data === "string" ? f.data : new TextDecoder().decode(f.data);
        const pkgMatch = text.match(/\bpackage\s+(?:'([^']+)'|([A-Za-z_][A-Za-z0-9_]*))/);
        const pkgName =
          pkgMatch?.[1] ??
          pkgMatch?.[2] ??
          f.path
            .replace(/\.(sysml|kerml)$/i, "")
            .split("/")
            .pop()!;
        discoveredSysml.push({ packageName: pkgName, path: f.path });
      }
    }

    const { metaJson, indexJson } = KparPackageAdapter.projectToKpar(options.manifest, discoveredSysml);
    const entries: { path: string; data: Uint8Array }[] = [
      { path: ".meta.json", data: new TextEncoder().encode(JSON.stringify(metaJson, null, 2)) },
      { path: ".Index.json", data: new TextEncoder().encode(JSON.stringify(indexJson, null, 2)) },
    ];

    if (options.packageJson) {
      entries.push({
        path: "package.json",
        data: new TextEncoder().encode(JSON.stringify(options.packageJson, null, 2)),
      });
    }

    for (const f of options.files) {
      if (f.path === ".meta.json" || f.path === ".Index.json") continue;
      entries.push({
        path: f.path,
        data: typeof f.data === "string" ? new TextEncoder().encode(f.data) : f.data,
      });
    }

    return buildDeterministicZip(entries);
  }
}

/* ============================================================================
 * 2. Native Manifest Adapters Across the 44 Engineering Languages
 * ============================================================================ */

export type NativeArchiveFormat =
  | "npm"
  | "modelscript"
  | "kpar"
  | "modelica"
  | "fmu"
  | "ssp"
  | "ddp"
  | "aasx"
  | "okh"
  | "omex"
  | "reqifz"
  | "slx"
  | "sima"
  | "ros"
  | "gazebo"
  | "fpm"
  | "pscad"
  | "datapackage"
  | "ipxact"
  | "autosar"
  | "plcopen"
  | "ibis"
  | "spice"
  | "polyglot";

export interface AdaptedPackageManifest {
  format: NativeArchiveFormat;
  name: string;
  version: string;
  description?: string | undefined;
  license?: string | undefined;
  author?: string | undefined;
  main?: string | undefined;
  dependencies: Record<string, string>;
  languages: string[];
  canonical: CanonicalWorkspaceManifest;
  packageJson: PackageJsonProjection;
}

/**
 * Parse Modelica `package.mo` and optional `impact.json`.
 */
export function adaptModelicaPackageMo(
  packageMoContent: string,
  impactJsonContent?: string,
  fallbackName = "ModelicaPackage",
  fallbackVersion = "1.0.0",
): {
  name: string;
  version: string;
  description?: string | undefined;
  license?: string | undefined;
  author?: string | undefined;
  dependencies: Record<string, string>;
} {
  let name = fallbackName;
  let description: string | undefined;
  let version = fallbackVersion;
  let license: string | undefined;
  let author: string | undefined;
  const dependencies: Record<string, string> = {};

  if (impactJsonContent) {
    try {
      const impact = JSON.parse(impactJsonContent) as Record<string, unknown>;
      if (typeof impact["name"] === "string") name = impact["name"];
      if (typeof impact["version"] === "string") version = normalizeToSemver(impact["version"], fallbackVersion);
      if (typeof impact["description"] === "string") description = impact["description"];
      if (typeof impact["license"] === "string") license = impact["license"];
      if (typeof impact["author"] === "string") {
        author = impact["author"];
      } else if (
        impact["author"] &&
        typeof impact["author"] === "object" &&
        typeof (impact["author"] as Record<string, unknown>)["name"] === "string"
      ) {
        author = (impact["author"] as Record<string, unknown>)["name"] as string;
      }
      if (Array.isArray(impact["dependencies"])) {
        for (const dep of impact["dependencies"]) {
          if (dep && typeof dep === "object") {
            const depRec = dep as Record<string, unknown>;
            if (typeof depRec["name"] === "string") {
              dependencies[depRec["name"]] = String(depRec["version"] || "*");
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }

  const headerMatch = packageMoContent.match(/\bpackage\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+"([^"]*)")?/);
  if (headerMatch) {
    if (headerMatch[1]) name = headerMatch[1];
    if (headerMatch[2]) description = headerMatch[2];
  }

  if (!author) {
    const authorMatch = packageMoContent.match(/\bauthor\s*=\s*"([^"]+)"/i);
    if (authorMatch?.[1]) author = authorMatch[1].trim();
  }

  // Extract annotation(version="...") at package level (not inside uses(...))
  const strippedUses = packageMoContent.replace(/\buses\s*\([\s\S]*?\)\s*(?=[,)])/g, "");
  const verMatch = strippedUses.match(/\bversion\s*=\s*"([^"]+)"/);
  if (verMatch?.[1]) {
    version = normalizeToSemver(verMatch[1], version);
  }

  // Extract uses(Lib(version="..."))
  const usesBlockMatch = packageMoContent.match(/\buses\s*\(([\s\S]*?)\)\s*(?:,|\))/);
  if (usesBlockMatch?.[1]) {
    for (const part of usesBlockMatch[1].split(",")) {
      const trimmed = part.trim();
      const parenIdx = trimmed.indexOf("(");
      if (parenIdx > 0) {
        const depName = trimmed.slice(0, parenIdx).trim();
        const verMatch = trimmed.slice(parenIdx).match(/\bversion\s*=\s*"([^"]+)"/i);
        if (depName && verMatch?.[1]) {
          dependencies[depName] = verMatch[1];
        }
      }
    }
  }

  return { name, version, description, license, author, dependencies };
}

/**
 * Parse FMI 2.0 / 3.0 `modelDescription.xml`.
 */
export function adaptFmuModelDescription(
  xml: string,
  fallbackName = "fmu-model",
  fallbackVersion = "1.0.0",
): {
  name: string;
  version: string;
  description?: string | undefined;
  license?: string | undefined;
  author?: string | undefined;
  guid?: string | undefined;
  fmiVersion?: string | undefined;
} {
  const getAttr = (attr: string): string | undefined => {
    const m = xml.match(new RegExp(`\\b${attr}\\s*=\\s*"([^"]*)"`, "i"));
    return m?.[1]?.trim() || undefined;
  };
  const name = getAttr("modelName") || fallbackName;
  const version = normalizeToSemver(getAttr("version"), fallbackVersion);
  const description = getAttr("description");
  const license = getAttr("license");
  const author = getAttr("author");
  const guid = getAttr("guid") || getAttr("instantiationToken");
  const fmiVersion = getAttr("fmiVersion");
  return { name, version, description, license, author, guid, fmiVersion };
}

/**
 * Parse Modelica Association SSP `SystemStructure.ssd`.
 */
export function adaptSspSystemStructure(
  xml: string,
  fallbackName = "ssp-system",
  fallbackVersion = "1.0.0",
): {
  name: string;
  version: string;
  description?: string | undefined;
  author?: string | undefined;
  submodels: CanonicalSubmodelDescriptor[];
} {
  const sysTag = xml.match(/<(?:ssd:)?System\b(?![A-Za-z])([^>]*)>/i)?.[1] ?? "";
  const rootTag = xml.match(/<(?:ssd:)?SystemStructureDescription\b([^>]*)>/i)?.[1] ?? "";
  const getAttr = (src: string, attr: string): string | undefined => {
    const m = src.match(new RegExp(`\\b${attr}\\s*=\\s*"([^"]*)"`, "i"));
    return m?.[1]?.trim() || undefined;
  };
  const name = getAttr(sysTag, "name") || getAttr(rootTag, "name") || fallbackName;
  const version = normalizeToSemver(getAttr(sysTag, "version") || getAttr(rootTag, "version"), fallbackVersion);
  const description = getAttr(sysTag, "description") || getAttr(rootTag, "description");
  const author = getAttr(sysTag, "author") || getAttr(rootTag, "author");

  const submodels: CanonicalSubmodelDescriptor[] = [];
  const compRegex = /<(?:ssd:)?Component\b([^>]*)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = compRegex.exec(xml)) !== null) {
    const attrs = m[1] ?? "";
    const compName = getAttr(attrs, "name");
    const source = getAttr(attrs, "source");
    if (compName) {
      submodels.push({
        idShort: compName,
        category: "FMU",
        path: source,
        description: getAttr(attrs, "description") ?? `SSP Component ${compName}`,
      });
    }
  }
  return { name, version, description, author, submodels };
}

/**
 * Parse ROS 1 / ROS 2 `package.xml` or Gazebo `model.config`.
 */
export function adaptRosOrGazeboXml(
  xml: string,
  fallbackName = "ros-robot-pkg",
  fallbackVersion = "1.0.0",
): {
  name: string;
  version: string;
  description?: string | undefined;
  license?: string | undefined;
  author?: string | undefined;
  dependencies: Record<string, string>;
} {
  const getTag = (tag: string): string | undefined => {
    const m = xml.match(new RegExp(`<${tag}\\b[^>]*>([^<]*)<\\/${tag}>`, "i"));
    return m?.[1]?.trim() || undefined;
  };
  const name = getTag("name") || fallbackName;
  const version = normalizeToSemver(getTag("version"), fallbackVersion);
  const description = getTag("description");
  const license = getTag("license");
  const maintainerMatch = xml.match(/<maintainer\b([^>]*)>([^<]*)<\/maintainer>/i);
  const maintainerEmail = maintainerMatch?.[1]?.match(/\bemail="([^"]*)"/i)?.[1];
  const maintainerName = maintainerMatch?.[2]?.trim();
  const author = maintainerMatch
    ? maintainerEmail
      ? `${maintainerName} <${maintainerEmail}>`
      : maintainerName
    : getTag("author");

  const dependencies: Record<string, string> = {};
  const depRegex = /<(?:depend|exec_depend|build_depend)\b[^>]*>([^<]*)<\/(?:depend|exec_depend|build_depend)>/gi;
  let m: RegExpExecArray | null;
  while ((m = depRegex.exec(xml)) !== null) {
    const dep = m[1]?.trim();
    if (dep && dep !== "xacro" && dep !== "roscpp" && dep !== "rospy" && dep !== "rclcpp" && dep !== "rclpy") {
      dependencies[dep] = "*";
    }
  }
  return { name, version, description, license, author, dependencies };
}

/**
 * Parse Fortran Package Manager `fpm.toml`.
 */
export function adaptFpmToml(
  toml: string,
  fallbackName = "fortran-pkg",
  fallbackVersion = "1.0.0",
): {
  name: string;
  version: string;
  description?: string | undefined;
  license?: string | undefined;
  author?: string | undefined;
  dependencies: Record<string, string>;
} {
  const getField = (key: string): string | undefined => {
    const m = toml.match(new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']`, "m"));
    return m?.[1]?.trim() || undefined;
  };
  const name = getField("name") || fallbackName;
  const version = normalizeToSemver(getField("version"), fallbackVersion);
  const description = getField("description");
  const license = getField("license");
  const author = getField("author") || getField("maintainer");
  const dependencies: Record<string, string> = {};

  let inDependencies = false;
  for (const rawLine of toml.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("[") && line.endsWith("]")) {
      const section = line.slice(1, -1).trim();
      inDependencies = section.toLowerCase() === "dependencies";
      continue;
    }
    if (inDependencies) {
      if (!line || line.startsWith("#")) continue;
      const eqIdx = line.indexOf("=");
      if (eqIdx !== -1) {
        const key = line.slice(0, eqIdx).trim();
        if (/^[A-Za-z0-9_-]+$/.test(key)) {
          dependencies[key] = "*";
        }
      }
    }
  }

  return { name, version, description, license, author, dependencies };
}

/**
 * Inspect a map of archive/directory files and automatically adapt any supported native manifest
 * across the 44 engineering languages into a CanonicalWorkspaceManifest and NPM PackageJsonProjection.
 */
export function detectAndAdaptArchiveManifest(
  files: Map<string, string>,
  options?: { fallbackName?: string | undefined; fallbackVersion?: string | undefined },
): AdaptedPackageManifest {
  const fallbackName = options?.fallbackName || "engineering-package";
  const fallbackVersion = normalizeToSemver(options?.fallbackVersion, "1.0.0");

  // Helper to find shallowest matching file
  const findShallowest = (
    predicate: (baseName: string, relPath: string) => boolean,
  ): { path: string; content: string } | null => {
    let best: { depth: number; path: string; content: string } | null = null;
    for (const [rawPath, content] of files.entries()) {
      const normalized = rawPath.replace(/\\/g, "/").replace(/^\/+/, "");
      const parts = normalized.split("/").filter(Boolean);
      if (parts.length === 0) continue;
      const baseName = parts[parts.length - 1]!;
      if (predicate(baseName, normalized)) {
        if (!best || parts.length < best.depth) {
          best = { depth: parts.length, path: normalized, content };
        }
      }
    }
    return best ? { path: best.path, content: best.content } : null;
  };

  const allPaths = Array.from(files.keys());
  const detectedLangs = detectLanguagesFromPaths(allPaths, (p) => files.get(p));

  let format: NativeArchiveFormat = "polyglot";
  let name = fallbackName;
  let version = fallbackVersion;
  let description: string | undefined;
  let license: string | undefined;
  let author: string | undefined;
  let main: string | undefined;
  let dependencies: Record<string, string> = {};
  let submodels: CanonicalSubmodelDescriptor[] = [];

  // 1. Check modelscript.json or package.json
  const msxJsonEntry = findShallowest((b) => b === "modelscript.json");
  const pkgJsonEntry = findShallowest((b) => b === "package.json");
  const metaJsonEntry = findShallowest((b) => b === ".meta.json");
  const indexJsonEntry = findShallowest((b) => b === ".Index.json");
  const ddpEntry = findShallowest((b) => b === "ddp-manifest.json");
  const aasEntry = findShallowest((b, p) => b === "aas.json" || p.endsWith("aasx/aas.json"));
  const okhEntry = findShallowest((b) => b === "okh.json");
  const pkgMoEntry = findShallowest((b) => b === "package.mo");
  const impactEntry = findShallowest((b) => b === "impact.json");
  const fmuEntry = findShallowest((b) => b === "modelDescription.xml");
  const sspEntry = findShallowest((b) => b === "SystemStructure.ssd" || b.endsWith(".ssd"));
  const omexEntry = findShallowest((b) => b === "manifest.xml");
  const reqifEntry = findShallowest((b) => b.toLowerCase().endsWith(".reqif"));
  const slxEntry = findShallowest((_b, p) => p.endsWith("simulink/blockdiagram.xml"));
  const simaEntry = findShallowest((b) => b === "workspace.xml" || b.endsWith(".stask") || b.endsWith(".sima"));
  const rosEntry = findShallowest((b) => b === "package.xml");
  const gazeboEntry = findShallowest((b) => b === "model.config");
  const fpmEntry = findShallowest((b) => b === "fpm.toml");
  const dataPkgEntry = findShallowest((b) => b === "datapackage.json");
  const pscadEntry = findShallowest((b) => b.endsWith(".pswx") || b.endsWith(".pslx") || b.endsWith(".pscx"));
  const ipxactEntry = findShallowest((b) => b === "component.xml");

  if (pkgJsonEntry || msxJsonEntry) {
    const target = pkgJsonEntry ?? msxJsonEntry!;
    format = pkgJsonEntry ? "npm" : "modelscript";
    try {
      const parsed = JSON.parse(target.content) as Record<string, unknown>;
      const parsedAuthor =
        parsed["author"] && typeof parsed["author"] === "object"
          ? (parsed["author"] as Record<string, unknown>)
          : undefined;
      const parsedMsx =
        parsed["modelscript"] && typeof parsed["modelscript"] === "object"
          ? (parsed["modelscript"] as Record<string, unknown>)
          : undefined;
      name = typeof parsed["name"] === "string" && parsed["name"].trim() ? parsed["name"].trim() : fallbackName;
      version = normalizeToSemver(
        typeof parsed["version"] === "string" ? parsed["version"] : undefined,
        fallbackVersion,
      );
      description =
        typeof parsed["description"] === "string"
          ? parsed["description"]
          : typeof parsed["title"] === "string"
            ? parsed["title"]
            : undefined;
      license = typeof parsed["license"] === "string" ? parsed["license"] : undefined;
      author =
        typeof parsed["author"] === "string"
          ? parsed["author"]
          : typeof parsedAuthor?.["name"] === "string"
            ? parsedAuthor["name"]
            : undefined;
      main =
        typeof parsed["main"] === "string"
          ? parsed["main"]
          : typeof parsedMsx?.["main"] === "string"
            ? parsedMsx["main"]
            : undefined;
      dependencies = {
        ...(typeof parsed["dependencies"] === "object" && parsed["dependencies"]
          ? (parsed["dependencies"] as Record<string, string>)
          : {}),
        ...(typeof parsedMsx?.["dependencies"] === "object" && parsedMsx["dependencies"]
          ? (parsedMsx["dependencies"] as Record<string, string>)
          : {}),
      };
      if (Array.isArray(parsedMsx?.["languages"])) {
        for (const l of parsedMsx["languages"]) {
          if (typeof l === "string" && !detectedLangs.includes(l)) detectedLangs.push(l);
        }
      }
    } catch {
      // fall through
    }
  } else if (metaJsonEntry) {
    format = "kpar";
    try {
      const kpar = KparPackageAdapter.ingestFromKpar(metaJsonEntry.content, indexJsonEntry?.content);
      name = kpar.manifest.scope ? `${kpar.manifest.scope}/${kpar.manifest.idShort}` : kpar.manifest.idShort;
      version = kpar.manifest.version;
      description = kpar.manifest.description;
      license = kpar.manifest.license;
      author = kpar.manifest.author?.name;
      dependencies = kpar.dependencies;
      main = kpar.entryPoint;
      if (!detectedLangs.includes("sysml2")) detectedLangs.push("sysml2");
    } catch {
      // fall through
    }
  } else if (pkgMoEntry || impactEntry) {
    format = "modelica";
    const mo = adaptModelicaPackageMo(pkgMoEntry?.content ?? "", impactEntry?.content, fallbackName, fallbackVersion);
    name = mo.name;
    version = mo.version;
    description = mo.description;
    license = mo.license;
    author = mo.author;
    dependencies = mo.dependencies;
    main = pkgMoEntry?.path ?? "package.mo";
    if (!detectedLangs.includes("modelica")) detectedLangs.push("modelica");
  } else if (ddpEntry) {
    format = "ddp";
    try {
      const ddp = JSON.parse(ddpEntry.content) as Record<string, unknown>;
      const pkgId = typeof ddp["packageId"] === "string" ? ddp["packageId"].split(":").pop() : undefined;
      const ddpTitle = typeof ddp["title"] === "string" ? ddp["title"] : undefined;
      const ddpDesc = typeof ddp["description"] === "string" ? ddp["description"] : undefined;
      const creator =
        ddp["creator"] && typeof ddp["creator"] === "object" ? (ddp["creator"] as Record<string, unknown>) : undefined;
      name = pkgId || ddpTitle || fallbackName;
      version = normalizeToSemver(typeof ddp["version"] === "string" ? ddp["version"] : undefined, fallbackVersion);
      description = ddpDesc || ddpTitle;
      author =
        typeof creator?.["name"] === "string"
          ? creator["name"]
          : typeof creator?.["organization"] === "string"
            ? creator["organization"]
            : undefined;
    } catch {
      // ignore
    }
  } else if (aasEntry) {
    format = "aasx";
    try {
      const aas = JSON.parse(aasEntry.content) as Record<string, unknown>;
      const shells = Array.isArray(aas["assetAdministrationShells"]) ? aas["assetAdministrationShells"] : undefined;
      const shell = shells?.[0] && typeof shells[0] === "object" ? (shells[0] as Record<string, unknown>) : undefined;
      name = (typeof shell?.["idShort"] === "string" ? shell["idShort"] : undefined) || fallbackName;
      description = `Industrie 4.0 Asset Administration Shell (${name})`;
    } catch {
      // ignore
    }
  } else if (okhEntry) {
    format = "okh";
    try {
      const okh = JSON.parse(okhEntry.content) as Record<string, unknown>;
      const okhName = typeof okh["name"] === "string" ? okh["name"] : undefined;
      const okhTitle = typeof okh["title"] === "string" ? okh["title"] : undefined;
      const okhDesc = typeof okh["description"] === "string" ? okh["description"] : undefined;
      name = okhName || okhTitle || fallbackName;
      version = normalizeToSemver(typeof okh["version"] === "string" ? okh["version"] : undefined, fallbackVersion);
      description = okhDesc || okhTitle;
      license = typeof okh["license"] === "string" ? okh["license"] : undefined;
    } catch {
      // ignore
    }
  } else if (sspEntry) {
    format = "ssp";
    const ssp = adaptSspSystemStructure(sspEntry.content, fallbackName, fallbackVersion);
    name = ssp.name;
    version = ssp.version;
    description = ssp.description ?? `SSP System Structure (${ssp.name})`;
    author = ssp.author;
    submodels = ssp.submodels;
    main = sspEntry.path;
    if (!detectedLangs.includes("ssp")) detectedLangs.push("ssp");
  } else if (fmuEntry) {
    format = "fmu";
    const fmu = adaptFmuModelDescription(fmuEntry.content, fallbackName, fallbackVersion);
    name = fmu.name;
    version = fmu.version;
    description = fmu.description ?? `FMI ${fmu.fmiVersion ?? "2.0"} Functional Mock-up Unit (${fmu.name})`;
    license = fmu.license;
    author = fmu.author;
    main = fmuEntry.path;
  } else if (omexEntry && /omexManifest/i.test(omexEntry.content)) {
    format = "omex";
    const sbmlEntry = findShallowest((b) => b.endsWith(".sbml") || b.endsWith(".xml"));
    const modelNameMatch = sbmlEntry?.content.match(/<model\b[^>]*\b(?:name|id)\s*=\s*"([^"]+)"/i);
    name = modelNameMatch?.[1] || fallbackName;
    description = `COMBINE Systems Biology Archive (${name})`;
    main = sbmlEntry?.path ?? omexEntry.path;
    if (!detectedLangs.includes("sbml")) detectedLangs.push("sbml");
  } else if (reqifEntry) {
    format = "reqifz";
    const titleMatch = reqifEntry.content.match(/<TITLE\b[^>]*>([^<]*)<\/TITLE>/i);
    const commentMatch = reqifEntry.content.match(/<COMMENT\b[^>]*>([^<]*)<\/COMMENT>/i);
    name = titleMatch?.[1]?.trim().replace(/\s+/g, "-") || fallbackName;
    description = commentMatch?.[1]?.trim() || titleMatch?.[1]?.trim() || `OMG ReqIF Requirements Package (${name})`;
    main = reqifEntry.path;
    if (!detectedLangs.includes("reqif")) detectedLangs.push("reqif");
  } else if (slxEntry) {
    format = "slx";
    const coreProps = findShallowest((_b, p) => p.endsWith("metadata/coreProperties.xml"));
    const titleMatch = coreProps?.content.match(/<dc:title\b[^>]*>([^<]*)<\/dc:title>/i);
    const creatorMatch = coreProps?.content.match(/<dc:creator\b[^>]*>([^<]*)<\/dc:creator>/i);
    const verMatch = slxEntry.content.match(/<P\s+Name="ModelVersionFormat">([^<]+)<\/P>/i);
    name = titleMatch?.[1]?.trim() || fallbackName;
    version = normalizeToSemver(verMatch?.[1]?.replace(/[^0-9.]/g, ""), fallbackVersion);
    author = creatorMatch?.[1]?.trim();
    description = `Simulink Block Diagram Model (${name})`;
    main = slxEntry.path;
    if (!detectedLangs.includes("simulink")) detectedLangs.push("simulink");
  } else if (rosEntry && /<package\b/i.test(rosEntry.content)) {
    format = "ros";
    const ros = adaptRosOrGazeboXml(rosEntry.content, fallbackName, fallbackVersion);
    name = ros.name;
    version = ros.version;
    description = ros.description;
    license = ros.license;
    author = ros.author;
    dependencies = ros.dependencies;
    main = rosEntry.path;
    if (!detectedLangs.includes("urdf")) detectedLangs.push("urdf");
  } else if (gazeboEntry && /<model\b/i.test(gazeboEntry.content)) {
    format = "gazebo";
    const gaz = adaptRosOrGazeboXml(gazeboEntry.content, fallbackName, fallbackVersion);
    name = gaz.name;
    version = gaz.version;
    description = gaz.description;
    author = gaz.author;
    main = gazeboEntry.path;
    if (!detectedLangs.includes("urdf")) detectedLangs.push("urdf");
  } else if (fpmEntry) {
    format = "fpm";
    const fpm = adaptFpmToml(fpmEntry.content, fallbackName, fallbackVersion);
    name = fpm.name;
    version = fpm.version;
    description = fpm.description;
    license = fpm.license;
    author = fpm.author;
    dependencies = fpm.dependencies;
    main = fpmEntry.path;
    if (!detectedLangs.includes("fortran")) detectedLangs.push("fortran");
  } else if (dataPkgEntry) {
    format = "datapackage";
    try {
      const dp = JSON.parse(dataPkgEntry.content) as Record<string, unknown>;
      const dpName = typeof dp["name"] === "string" ? dp["name"] : undefined;
      const dpDesc = typeof dp["description"] === "string" ? dp["description"] : undefined;
      const dpTitle = typeof dp["title"] === "string" ? dp["title"] : undefined;
      const dpLicenses = Array.isArray(dp["licenses"]) ? dp["licenses"] : undefined;
      const firstLic =
        dpLicenses?.[0] && typeof dpLicenses[0] === "object" ? (dpLicenses[0] as Record<string, unknown>) : undefined;
      name = dpName || fallbackName;
      version = normalizeToSemver(typeof dp["version"] === "string" ? dp["version"] : undefined, fallbackVersion);
      description = dpDesc || dpTitle;
      license =
        typeof firstLic?.["name"] === "string"
          ? firstLic["name"]
          : typeof dp["license"] === "string"
            ? dp["license"]
            : undefined;
      main = dataPkgEntry.path;
      if (!detectedLangs.includes("csv")) detectedLangs.push("csv");
    } catch {
      // ignore
    }
  } else if (pscadEntry) {
    format = "pscad";
    const projMatch = pscadEntry.content.match(/<project\b[^>]*\bname="([^"]+)"/i);
    const descMatch = pscadEntry.content.match(/<param\b[^>]*\bname="description"[^>]*\bvalue="([^"]*)"/i);
    name = projMatch?.[1] || fallbackName;
    description = descMatch?.[1] || `PSCAD EMT Power Systems Workspace (${name})`;
    main = pscadEntry.path;
    if (!detectedLangs.includes("pscad")) detectedLangs.push("pscad");
  } else if (simaEntry) {
    format = "sima";
    name = fallbackName;
    description = `SINTEF Ocean SIMA / RIFLEX / SIMO Marine Package (${name})`;
    main = simaEntry.path;
    if (!detectedLangs.includes("sima")) detectedLangs.push("sima");
  } else if (ipxactEntry && /(?:spirit|ipxact):component/i.test(ipxactEntry.content)) {
    format = "ipxact";
    const nameMatch = ipxactEntry.content.match(/<(?:spirit|ipxact):name>([^<]+)<\/(?:spirit|ipxact):name>/i);
    const verMatch = ipxactEntry.content.match(/<(?:spirit|ipxact):version>([^<]+)<\/(?:spirit|ipxact):version>/i);
    const descMatch = ipxactEntry.content.match(
      /<(?:spirit|ipxact):description>([^<]+)<\/(?:spirit|ipxact):description>/i,
    );
    name = nameMatch?.[1]?.trim() || fallbackName;
    version = normalizeToSemver(verMatch?.[1], fallbackVersion);
    description = descMatch?.[1]?.trim();
    main = ipxactEntry.path;
  }

  const scope = name.startsWith("@") ? name.split("/")[0] : undefined;
  const idShort = name.startsWith("@") ? (name.split("/")[1] ?? name) : name;

  const canonical: CanonicalWorkspaceManifest = {
    globalAssetId: `urn:modelscript:${name}:${version}`,
    idShort,
    title: description || idShort,
    version,
    scope,
    description: description ?? `ModelScript polyglot package (${idShort})`,
    author: author ? { name: author } : undefined,
    license: license ?? "UNLICENSED",
    submodels: submodels.length > 0 ? submodels : undefined,
  };

  const packageJson: PackageJsonProjection = {
    name,
    version,
    description: canonical.description,
    main: main ?? allPaths[0] ?? "index.msx",
    author,
    license: canonical.license,
    dependencies: Object.keys(dependencies).length > 0 ? dependencies : undefined,
    modelscript: {
      globalAssetId: canonical.globalAssetId,
      submodels: submodels.length > 0 ? submodels.map((s) => s.idShort) : undefined,
      languages: detectedLangs,
      nativeFormat: format,
    },
  };

  return {
    format,
    name,
    version,
    description: canonical.description,
    license: canonical.license,
    author,
    main: packageJson.main,
    dependencies,
    languages: detectedLangs,
    canonical,
    packageJson,
  };
}

/* ============================================================================
 * Minimal Deterministic ZIP Builder & Reader (No Node-only dependencies)
 * ============================================================================ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function buildDeterministicZip(entries: { path: string; data: Uint8Array }[]): Uint8Array {
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  const localParts: Uint8Array[] = [];
  const cdParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of sorted) {
    const nameBytes = new TextEncoder().encode(entry.path.replace(/\\/g, "/"));
    const uncompressed = entry.data;
    const compressed = deflateRaw(uncompressed);
    const crc = crc32(uncompressed);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, 8, true); // DEFLATE
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0x21, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, compressed.length, true);
    lv.setUint32(22, uncompressed.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, compressed);

    const cdHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cdHeader.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 8, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, compressed.length, true);
    cv.setUint32(24, uncompressed.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    cdHeader.set(nameBytes, 46);
    cdParts.push(cdHeader);

    offset += localHeader.length + compressed.length;
  }

  const cdSize = cdParts.reduce((s, p) => s + p.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, sorted.length, true);
  ev.setUint16(10, sorted.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const totalLen = offset + cdSize + 22;
  const out = new Uint8Array(totalLen);
  let pos = 0;
  for (const p of localParts) {
    out.set(p, pos);
    pos += p.length;
  }
  for (const p of cdParts) {
    out.set(p, pos);
    pos += p.length;
  }
  out.set(eocd, pos);
  return out;
}

export function readZipTextEntries(
  zipData: Uint8Array,
  maxEntryBytes = 2 * 1024 * 1024,
): {
  allFiles: string[];
  textFiles: Map<string, string>;
} {
  const allFiles: string[] = [];
  const textFiles = new Map<string, string>();

  let eocdOffset = -1;
  for (let i = zipData.length - 22; i >= 0; i--) {
    if (zipData[i] === 0x50 && zipData[i + 1] === 0x4b && zipData[i + 2] === 0x05 && zipData[i + 3] === 0x06) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) return { allFiles, textFiles };

  const view = new DataView(zipData.buffer, zipData.byteOffset, zipData.byteLength);
  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const cdSize = view.getUint32(eocdOffset + 12, true);
  const cdEnd = cdOffset + cdSize;

  let pos = cdOffset;
  while (pos < cdEnd && pos + 46 <= zipData.byteLength) {
    if (view.getUint32(pos, true) !== 0x02014b50) break;
    const compressionMethod = view.getUint16(pos + 10, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const uncompressedSize = view.getUint32(pos + 24, true);
    const fileNameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    const localHeaderOffset = view.getUint32(pos + 42, true);
    const fileName = new TextDecoder().decode(zipData.subarray(pos + 46, pos + 46 + fileNameLength));

    if (!fileName.endsWith("/")) {
      allFiles.push(fileName);
      if (uncompressedSize <= maxEntryBytes && localHeaderOffset + 30 <= zipData.byteLength) {
        if (view.getUint32(localHeaderOffset, true) === 0x04034b50) {
          const localNameLen = view.getUint16(localHeaderOffset + 26, true);
          const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
          const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
          if (dataStart + compressedSize <= zipData.byteLength) {
            try {
              let raw: Uint8Array | null = null;
              if (compressionMethod === 0) {
                raw = zipData.subarray(dataStart, dataStart + compressedSize);
              } else if (compressionMethod === 8) {
                raw = inflateRaw(zipData.subarray(dataStart, dataStart + compressedSize));
              }
              if (raw) {
                textFiles.set(fileName, new TextDecoder().decode(raw));
              }
            } catch {
              // ignore binary / corrupt entry
            }
          }
        }
      }
    }

    pos += 46 + fileNameLength + extraLength + commentLength;
  }

  return { allFiles, textFiles };
}
