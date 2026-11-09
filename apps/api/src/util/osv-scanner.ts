// SPDX-License-Identifier: AGPL-3.0-or-later

import semver from "semver";

export interface OsvAdvisory {
  id: string; // e.g. "GHSA-mod-2024-0001", "CVE-2024-38910"
  summary: string;
  details?: string | undefined;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  cvssScore?: number | undefined;
  aliases?: string[] | undefined;
  packageName: string;
  purl?: string | undefined;
  affectedRange: string;
  introducedVersion?: string | undefined;
  fixedVersion?: string | undefined;
  published?: string | undefined;
  references?: Array<{ type: string; url: string }> | undefined;
}

export interface OsvScanResult {
  package: string;
  version: string;
  vulnerabilities: OsvAdvisory[];
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    total: number;
  };
  hasCriticalOrHigh: boolean;
  clean: boolean;
}

export interface OsvComparisonResult {
  baseVersion: string;
  headVersion: string;
  fixed: OsvAdvisory[];
  introduced: OsvAdvisory[];
  unresolved: OsvAdvisory[];
  current: OsvAdvisory[];
}

// Built-in curated catalog of ModelScript and physical simulation CVEs/GHSAs
const BUILTIN_ADVISORIES: OsvAdvisory[] = [
  {
    id: "GHSA-mod-2024-0001",
    aliases: ["CVE-2024-38910"],
    summary: "Integer overflow in SPICE semiconductor diode junction capacitance solver",
    details:
      "A numeric overflow flaw in junction capacitance calculation can lead to unbounded looping and denial of service during transient DC bias sweeps.",
    severity: "HIGH",
    cvssScore: 7.8,
    packageName: "@modelica/electrical",
    affectedRange: "< 4.0.0",
    fixedVersion: "4.0.0",
    published: "2024-04-12T10:00:00Z",
    references: [
      { type: "ADVISORY", url: "https://osv.dev/vulnerability/GHSA-mod-2024-0001" },
      { type: "WEB", url: "https://cve.org/CVERecord?id=CVE-2024-38910" },
    ],
  },
  {
    id: "GHSA-mod-2024-0002",
    aliases: ["CVE-2024-42115"],
    summary: "Arbitrary DLL path traversal via unescaped fmi2Instantiate resourceLocation",
    details:
      "When loading an unverified FMU binary, malicious resourceLocation paths can cause arbitrary native shared library injection outside the unpacking sandbox.",
    severity: "CRITICAL",
    cvssScore: 9.3,
    packageName: "@ansatz/fmu-runtime",
    affectedRange: "< 1.2.0",
    fixedVersion: "1.2.0",
    published: "2024-06-20T14:30:00Z",
    references: [
      { type: "ADVISORY", url: "https://osv.dev/vulnerability/GHSA-mod-2024-0002" },
      { type: "WEB", url: "https://cve.org/CVERecord?id=CVE-2024-42115" },
    ],
  },
  {
    id: "GHSA-mod-2024-0003",
    aliases: ["CVE-2024-45099"],
    summary: "Heap out-of-bounds read during linear matrix factorisation",
    details:
      "Sparse matrix LU decomposition without sufficient pivot check may read past allocated buffers in dense solver fallback.",
    severity: "MEDIUM",
    cvssScore: 5.5,
    packageName: "@alice/CoreUtils",
    affectedRange: "< 1.1.0",
    fixedVersion: "1.1.0",
    published: "2024-08-05T09:15:00Z",
    references: [
      { type: "ADVISORY", url: "https://osv.dev/vulnerability/GHSA-mod-2024-0003" },
      { type: "WEB", url: "https://cve.org/CVERecord?id=CVE-2024-45099" },
    ],
  },
  {
    id: "GHSA-mod-2024-0004",
    aliases: ["CVE-2024-49001"],
    summary: "Denial of service in power flow Newton-Raphson Jacobian matrix inversion",
    details: "Singular bus admittance matrices can cause floating point SIGFPE exceptions crashing simulation workers.",
    severity: "HIGH",
    cvssScore: 7.5,
    packageName: "@org/power-grid",
    affectedRange: "< 1.2.0",
    fixedVersion: "1.2.0",
    published: "2024-09-18T16:00:00Z",
    references: [
      { type: "ADVISORY", url: "https://osv.dev/vulnerability/GHSA-mod-2024-0004" },
      { type: "WEB", url: "https://cve.org/CVERecord?id=CVE-2024-49001" },
    ],
  },
  {
    id: "GHSA-mod-2024-0005",
    aliases: ["CVE-2024-52011"],
    summary: "Unsanitized dynamic memory allocation in external C simulation wrapper",
    details: "Buffer overflow in external C wrapper function when unpacking multi-dimensional real array inputs.",
    severity: "CRITICAL",
    cvssScore: 9.8,
    packageName: "@bob/insecure-device",
    affectedRange: "< 2.0.0",
    fixedVersion: "2.0.0",
    published: "2024-10-30T11:45:00Z",
    references: [
      { type: "ADVISORY", url: "https://osv.dev/vulnerability/GHSA-mod-2024-0005" },
      { type: "WEB", url: "https://cve.org/CVERecord?id=CVE-2024-52011" },
    ],
  },
];

const customAdvisories: OsvAdvisory[] = [];

export function registerOsvAdvisory(advisory: OsvAdvisory): void {
  customAdvisories.push(advisory);
}

export function clearCustomOsvAdvisories(): void {
  customAdvisories.length = 0;
}

function getAllAdvisories(): OsvAdvisory[] {
  return [...BUILTIN_ADVISORIES, ...customAdvisories];
}

/**
 * Checks whether a given semantic version is vulnerable according to an advisory.
 */
export function isVersionVulnerable(version: string, advisory: OsvAdvisory): boolean {
  if (!semver.valid(version)) {
    return false;
  }

  if (advisory.fixedVersion && semver.valid(advisory.fixedVersion)) {
    if (advisory.introducedVersion && semver.valid(advisory.introducedVersion)) {
      return semver.gte(version, advisory.introducedVersion) && semver.lt(version, advisory.fixedVersion);
    }
    return semver.lt(version, advisory.fixedVersion);
  }

  if (advisory.affectedRange) {
    try {
      return semver.satisfies(version, advisory.affectedRange);
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Optional remote query to Google OSV database api.osv.dev with 1.5s timeout.
 */
export async function queryOsvDev(purl: string): Promise<OsvAdvisory[]> {
  try {
    const res = await fetch("https://api.osv.dev/v1/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ package: { purl } }),
      signal: AbortSignal.timeout(1500),
    });

    if (!res.ok) return [];

    const data = (await res.json()) as {
      vulns?: Array<{
        id: string;
        summary?: string;
        details?: string;
        aliases?: string[];
        database_specific?: { severity?: string };
        severity?: Array<{ score?: string }>;
        references?: Array<{ type: string; url: string }>;
      }>;
    };

    if (!data.vulns || !Array.isArray(data.vulns)) return [];

    return data.vulns.map((v) => {
      const rawSev = v.database_specific?.severity?.toUpperCase();
      const severity: OsvAdvisory["severity"] =
        rawSev === "CRITICAL" ? "CRITICAL" : rawSev === "HIGH" ? "HIGH" : rawSev === "LOW" ? "LOW" : "MEDIUM";
      return {
        id: v.id,
        summary: v.summary || "Security advisory reported in OSV database",
        details: v.details,
        severity,
        aliases: v.aliases,
        packageName: purl,
        purl,
        affectedRange: "*",
        references: v.references,
      };
    });
  } catch {
    // Air-gapped or network failure: fallback to local database
    return [];
  }
}

/**
 * Scan a single package release against the OSV vulnerability feed.
 */
export async function scanPackageVulnerabilities(
  packageName: string,
  version: string,
  options?: { allowRemote?: boolean | undefined },
): Promise<OsvScanResult> {
  const normName = packageName.toLowerCase();
  const all = getAllAdvisories();

  const matching = all.filter((adv) => {
    const advPkg = adv.packageName.toLowerCase();
    if (advPkg !== normName && advPkg !== `@${normName}` && !normName.endsWith(advPkg)) {
      return false;
    }
    return isVersionVulnerable(version, adv);
  });

  if (options?.allowRemote && process.env["ENABLE_REMOTE_OSV"] === "true") {
    const purl = `pkg:modelscript/${packageName}@${version}`;
    const remote = await queryOsvDev(purl);
    for (const r of remote) {
      if (!matching.some((m) => m.id === r.id)) {
        matching.push(r);
      }
    }
  }

  const summary = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    total: matching.length,
  };

  for (const v of matching) {
    if (v.severity === "CRITICAL") summary.critical++;
    else if (v.severity === "HIGH") summary.high++;
    else if (v.severity === "MEDIUM") summary.medium++;
    else if (v.severity === "LOW") summary.low++;
  }

  return {
    package: packageName,
    version,
    vulnerabilities: matching,
    summary,
    hasCriticalOrHigh: summary.critical > 0 || summary.high > 0,
    clean: matching.length === 0,
  };
}

/**
 * Scan a collection of locked dependencies against the OSV feed.
 */
export async function scanDependenciesVulnerabilities(
  dependencies: Record<string, { version?: string | undefined; purl?: string | undefined }>,
): Promise<Map<string, OsvAdvisory[]>> {
  const result = new Map<string, OsvAdvisory[]>();

  for (const [depKey, dep] of Object.entries(dependencies)) {
    const lastAt = depKey.lastIndexOf("@");
    const depName = lastAt > 0 ? depKey.slice(0, lastAt) : depKey;
    const depVer = dep.version || (lastAt > 0 ? depKey.slice(lastAt + 1) : "1.0.0");

    const scan = await scanPackageVulnerabilities(depName, depVer);
    if (scan.vulnerabilities.length > 0) {
      result.set(`${depName}@${depVer}`, scan.vulnerabilities);
    }
  }

  return result;
}

/**
 * Compare vulnerabilities between two versions of a package.
 */
export async function comparePackageVulnerabilities(
  packageName: string,
  baseVersion: string,
  headVersion: string,
): Promise<OsvComparisonResult> {
  const baseScan = await scanPackageVulnerabilities(packageName, baseVersion);
  const headScan = await scanPackageVulnerabilities(packageName, headVersion);

  const baseIds = new Set(baseScan.vulnerabilities.map((v) => v.id));
  const headIds = new Set(headScan.vulnerabilities.map((v) => v.id));

  const fixed = baseScan.vulnerabilities.filter((v) => !headIds.has(v.id));
  const introduced = headScan.vulnerabilities.filter((v) => !baseIds.has(v.id));
  const unresolved = headScan.vulnerabilities.filter((v) => baseIds.has(v.id));

  return {
    baseVersion,
    headVersion,
    fixed,
    introduced,
    unresolved,
    current: headScan.vulnerabilities,
  };
}

/**
 * Format advisories into standard CycloneDX 1.6 vulnerabilities array.
 */
export function formatCycloneDxVulnerabilities(
  advisories: OsvAdvisory[],
  targetPurl?: string,
): Record<string, unknown>[] {
  return advisories.map((adv) => ({
    id: adv.id,
    source: {
      name: "OSV",
      url: adv.references?.[0]?.url || `https://osv.dev/vulnerability/${adv.id}`,
    },
    ratings: [
      {
        source: { name: "OSV" },
        score:
          adv.cvssScore ??
          (adv.severity === "CRITICAL" ? 9.5 : adv.severity === "HIGH" ? 7.5 : adv.severity === "MEDIUM" ? 5.0 : 2.5),
        severity: adv.severity.toLowerCase(),
        method: "CVSSv3",
      },
    ],
    description: adv.summary,
    detail: adv.details,
    affects: [
      {
        ref: targetPurl || adv.purl || `pkg:modelscript/${adv.packageName}`,
      },
    ],
    advisories: adv.references?.map((r) => ({ url: r.url })),
  }));
}

/**
 * Format advisories into SPDX 2.3 security externalRefs.
 */
export function formatSpdxSecurityRefs(advisories: OsvAdvisory[]): Record<string, unknown>[] {
  return advisories.map((adv) => ({
    referenceCategory: "SECURITY",
    referenceType: "advisory",
    referenceLocator: adv.references?.[0]?.url || `https://osv.dev/vulnerability/${adv.id}`,
    comment: `${adv.id}: ${adv.summary} (${adv.severity})`,
  }));
}
