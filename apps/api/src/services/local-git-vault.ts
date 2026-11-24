// SPDX-License-Identifier: AGPL-3.0-or-later

import type express from "express";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path, { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { LibraryDatabase } from "../database.js";

const SERVICES_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_API_ROOT = path.resolve(SERVICES_DIR, "../..");
const DEFAULT_REPO_ROOT = path.resolve(DEFAULT_API_ROOT, "../..");

export const SAFE_GIT_SEGMENT_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/;

export interface GitTreeEntry {
  path: string;
  mode: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
}

export interface GitFileContentResult {
  name: string;
  path: string;
  sha: string;
  size: number;
  type: "file";
  encoding: "base64";
  content: string;
}

export interface GitBlobResult {
  sha: string;
  size: number;
  encoding: "base64";
  content: string;
}

export interface GitCommitSummary {
  sha: string;
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  message: string;
}

export interface LocalRepoTreeCacheEntry {
  tree: GitTreeEntry[];
  blobPathBySha: Map<string, string>;
  virtualContentBySha: Map<string, Buffer>;
  extractedDir: string | null;
  virtualFiles: Record<string, string>;
}

export interface LocalRepoAccessResult {
  allowed: boolean;
  isPrivateOrInternal: boolean;
  status?: 401 | 403;
  message?: string;
}

export interface LocalGitVaultOptions {
  apiRoot?: string;
  repoRoot?: string;
  gitReposBaseDirs?: string[];
  showcaseFiles?: Record<string, Record<string, string>>;
}

// Curated showcase files & local extracted standard libraries for offline / rate-limit resilience
export const SHOWCASE_REPO_FILES: Record<string, Record<string, string>> = {
  "modelica/modelicastandardlibrary": {
    "README.md": `# Modelica Standard Library 4.1.0\n\n**Modelica** is a freely available, object-oriented language for modeling of large, complex, and heterogeneous physical systems.\n\n## Package Overview\n\n- \`Modelica/Blocks/\` — Continuous & discrete input/output control blocks\n- \`Modelica/Electrical/\` — Analog, Digital, Machines, MultiPhase, PowerConverters, QuasiStationary\n- \`Modelica/Mechanics/\` — Rotational, Translational, and 3D MultiBody dynamics\n- \`Modelica/Fluid/\` & \`Modelica/Media/\` — 1D thermo-fluid flow and media property models\n- \`Modelica/Thermal/\` — HeatTransfer and FluidHeatFlow components\n- \`Modelica/Magnetic/\` — FluxTubes, FundamentalWave, and QuasiStatic magnetic models\n`,
    "Modelica/package.mo": `within ;\npackage Modelica "Modelica Standard Library - Version 4.1.0"\n  extends Modelica.Icons.Package;\n  annotation(version = "4.1.0", versionDate = "2026-04-15");\nend Modelica;\n`,
    "Modelica/Electrical/Analog/Basic/Resistor.mo": `within Modelica.Electrical.Analog.Basic;\nmodel Resistor "Ideal linear electrical resistor"\n  parameter Modelica.Units.SI.Resistance R(start = 1) "Resistance at temperature T_ref";\n  parameter Modelica.Units.SI.Temperature T_ref = 300.15 "Reference temperature";\n  parameter Modelica.Units.SI.LinearTemperatureCoefficient alpha = 0 "Temperature coefficient of resistance";\n  extends Modelica.Electrical.Analog.Interfaces.OnePort;\n  Modelica.Units.SI.Resistance R_actual "Actual resistance";\nequation\n  R_actual = R * (1 + alpha * (T_ref - 300.15));\n  v = R_actual * i;\nend Resistor;\n`,
    "Modelica/Electrical/Analog/Examples/ChuaCircuit.mo": `within Modelica.Electrical.Analog.Examples;\nmodel ChuaCircuit "Chua's circuit with nonlinear piecewise-linear resistor"\n  extends Modelica.Icons.Example;\n  Modelica.Electrical.Analog.Basic.Inductor L(L=18);\n  Modelica.Electrical.Analog.Basic.Resistor Ro(R=12.5e-3);\n  Modelica.Electrical.Analog.Basic.Conductor G(G=0.565);\n  Modelica.Electrical.Analog.Basic.Capacitor C1(C=10, v(start=4, fixed=true));\n  Modelica.Electrical.Analog.Basic.Capacitor C2(C=100, v(start=0, fixed=true));\nequation\n  connect(L.p, G.p);\n  connect(G.n, C1.p);\n  connect(C1.n, L.n);\nend ChuaCircuit;\n`,
    "Modelica/Mechanics/Rotational/Examples/CoupledClutches.mo": `within Modelica.Mechanics.Rotational.Examples;\nmodel CoupledClutches "Drive train with three coupled clutches"\n  parameter Real J1 = 1.0 "Inertia 1 (kg.m2)";\n  parameter Real J2 = 0.4 "Inertia 2 (kg.m2)";\n  Real phi1(start = 0.0, fixed = true);\n  Real w1(start = 10.0, fixed = true);\nequation\n  der(phi1) = w1;\n  J1 * der(w1) = -0.25 * w1 + sin(2.0 * time);\nend CoupledClutches;\n`,
  },
  "systems-modeling/sysml-v2-release": {
    "README.md": `# OMG SysML v2 Release Repository\n\nThis repository contains the official incremental release artifacts for **OMG Systems Modeling Language (SysML v2)** and **Kernel Modeling Language (KerML)**.\n\n## Contents\n\n- \`sysml/\` — SysML v2 textual notation standard domain libraries and training models\n- \`kerml/\` — Kernel Modeling Language normative model libraries\n- \`doc/\` — Normative specification documents\n`,
    "sysml/src/examples/VehicleExample.sysml": `package VehicleExample {\n  import ScalarValues::*;\n  part def Vehicle {\n    attribute mass : Real = 1850.0;\n    part propulsion : PropulsionSystem;\n    part chassis : ChassisAssembly;\n  }\n  part def PropulsionSystem {\n    attribute peakTorque : Real = 420.0;\n  }\n  part def ChassisAssembly;\n}\n`,
    "sysml/src/validation/SafetyRequirements.sysml": `package SafetyRequirements {\n  requirement def <'ASIL-D-01'> RedundantBrakingRequirement {\n    doc /* Braking deceleration shall exceed 8.5 m/s^2 under single hydraulic circuit fault. */\n  }\n}\n`,
    "kerml/src/KernelLibrary/ScalarValues.kerml": `standard library package ScalarValues {\n  datatype Boolean;\n  datatype String;\n  datatype Real;\n  datatype Integer;\n}\n`,
  },
  "libeigen/eigen": {
    "README.md": `# Eigen — C++ Template Library for Linear Algebra\n\nEigen is a high-performance C++ template library for linear algebra: matrices, vectors, numerical solvers, and related algorithms.\n\n## Key Subsystems\n\n- \`Eigen/Core\` — Dense matrix & array manipulation with SIMD vectorization\n- \`Eigen/SparseLU\` & \`Eigen/SparseCholesky\` — Direct solvers for sparse Jacobian systems\n- \`Eigen/Eigenvalues\` — Real/Complex Schur & generalized eigenvalue decompositions\n`,
    "Eigen/SparseLU": `// SPDX-License-Identifier: MPL-2.0\n#ifndef EIGEN_SPARSELU_MODULE_H\n#define EIGEN_SPARSELU_MODULE_H\n\nnamespace Eigen {\n  // Supernodal Sparse LU factorization for DAE Newton-Raphson Jacobians\n  template<typename MatrixType, typename OrderingType>\n  class SparseLU {\n  public:\n    void compute(const MatrixType& matrix);\n  };\n}\n#endif\n`,
    "CMakeLists.txt": `cmake_minimum_required(VERSION 3.16)\nproject(Eigen3 VERSION 3.4.1 LANGUAGES CXX)\nset(CMAKE_CXX_STANDARD 17)\n`,
  },
  "openmodelica/openmodelica": {
    "README.md": `# OpenModelica\n\n**OpenModelica** is an open-source Modelica-based modeling and simulation environment intended for industrial and academic usage.\n\n## Architecture\n\n- \`OMCompiler/Compiler/NFFrontEnd/\` — New Frontend (NF) instantiation and type checker\n- \`OMCompiler/Compiler/NBBackend/\` — New Backend BLT, Pantelides index reduction, and tearing\n- \`OMCompiler/SimulationRuntime/c/\` — DASSL, IDA, CVODE, and GBODE numerical integrators\n`,
    "OMCompiler/Compiler/NBBackend/NBMatching.mo": `encapsulated package NBMatching "Bipartite matching and Pantelides index reduction"\n  public function regularMatching\n    input Integer nEqns;\n    input Integer nVars;\n    output Integer matchCount;\n  algorithm\n    matchCount := min(nEqns, nVars);\n  end regularMatching;\nend NBMatching;\n`,
  },
  "modelica/fmi-standard": {
    "README.md": `# Functional Mock-up Interface (FMI) Standard\n\nThe **Functional Mock-up Interface (FMI)** is a free standard that defines a container and an interface to exchange dynamic simulation models using a combination of XML files, binaries, and C code.\n`,
    "headers/fmi3Functions.h": `#ifndef fmi3Functions_h\n#define fmi3Functions_h\n#include "fmi3PlatformTypes.h"\n\ntypedef fmi3Status fmi3EnterEventModeTYPE(fmi3Instance instance);\ntypedef fmi3Status fmi3DoStepTYPE(fmi3Instance instance, fmi3Float64 currentCommunicationPoint, fmi3Float64 communicationStepSize);\n#endif\n`,
  },
  "openscad/openscad": {
    "README.md": `# OpenSCAD — The Programmers Solid 3D CAD Modeller\n\nOpenSCAD is software for creating solid 3D CAD models using script-based Constructive Solid Geometry (CSG).\n`,
    "examples/ParametricGear.scad": `// Parametric involute spur gear\n$fn = 64;\nmodule spur_gear(teeth = 24, module_mm = 2.0, thickness = 8.0, bore = 10.0) {\n  pitch_r = (teeth * module_mm) / 2;\n  difference() {\n    cylinder(h = thickness, r = pitch_r + module_mm, center = true);\n    cylinder(h = thickness + 2, r = bore / 2, center = true);\n  }\n}\nspur_gear();\n`,
  },
  "su2code/su2": {
    "README.md": `# SU2: Multiphysics Simulation and Design Software\n\nSU2 is an open-source collection of C++ software tools for partial differential equation (PDE) analysis and adjoint-based aerodynamic optimization.\n`,
    "TestCases/rans/naca0012/inv_NACA0012.cfg": `SOLVER= EULER\nMATH_PROBLEM= DIRECT\nMACH_NUMBER= 0.8\nAOA= 1.25\nFREESTREAM_PRESSURE= 101325.0\nFREESTREAM_TEMPERATURE= 288.15\nREF_LENGTH= 1.0\nREF_AREA= 1.0\nNUM_METHOD_GRAD= GREEN_GAUSS\nCFL_NUMBER= 25.0\nITER= 250\nMESH_FILENAME= mesh_NACA0012_inv.su2\n`,
  },
  "graphviz/graphviz": {
    "README.md": `# Graphviz — Graph Visualization Software\n\nGraphviz is open-source graph visualization software used for structural schematic layout, orthogonal connector routing, and BLT dependency visualization.\n`,
    "examples/dae_blt_causality.dot": `digraph BLT_Causality {\n  rankdir=LR;\n  node [shape=box, style="rounded,filled", fillcolor="#0f172a", fontcolor="#f8fafc"];\n  "u(t)" -> "Block 1: i_q = K*(r - theta)";\n  "Block 1: i_q = K*(r - theta)" -> "Block 2: J*der(w) = k_t*i_q - b*w";\n  "Block 2: J*der(w) = k_t*i_q - b*w" -> "Block 3: der(theta) = w";\n}\n`,
  },
  "inkscape/inkscape": {
    "README.md": `# Inkscape — Vector Graphics & Technical Schematic Engine\n\nInkscape is a professional-grade open-source vector graphics editor supporting W3C SVG standards and engineering component iconography.\n`,
    "share/icons/modelica-inductor.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 80">\n  <path d="M 10 40 L 40 40 A 15 15 0 0 1 70 40 A 15 15 0 0 1 100 40 A 15 15 0 0 1 130 40 A 15 15 0 0 1 160 40 L 190 40" fill="none" stroke="#38bdf8" stroke-width="4"/>\n</svg>\n`,
  },
  "modelscript/modelscript": {
    "README.md": `# ModelScript — Polyglot Systems Engineering & Simulation Compiler\n\n**ModelScript** compiles Modelica 3.x, SysML v2, STEP (ISO 10303), OpenSCAD, PSCAD, GENSYS, and SIMPACK models to WebAssembly DAE arenas for real-time numerical simulation.\n`,
    "examples/rlc_circuit.mo": `model RLCCircuit "Series RLC resonant circuit"\n  parameter Real R = 10.0;\n  parameter Real L = 0.1;\n  parameter Real C = 1e-4;\n  Real i(start = 0.0, fixed = true);\n  Real v_c(start = 5.0, fixed = true);\nequation\n  der(v_c) = i / C;\n  L * der(i) = -R * i - v_c;\nend RLCCircuit;\n`,
  },
};

export function sanitizeGitRef(rawRef: unknown, fallback = "HEAD"): string {
  if (typeof rawRef !== "string") return fallback;
  const trimmed = decodeURIComponent(rawRef).trim();
  if (!trimmed || trimmed.startsWith("-") || trimmed.includes("..") || !/^[a-zA-Z0-9_./-]+$/.test(trimmed)) {
    return fallback;
  }
  return trimmed;
}

export function normalizeGitFilePath(rawFilePath: string): string | null {
  const cleaned = rawFilePath.replace(/^\/+/, "");
  const normalizedPath = path.posix.normalize(cleaned);
  if (!normalizedPath || normalizedPath === "." || normalizedPath.startsWith("..") || normalizedPath.includes("/../")) {
    return null;
  }
  return normalizedPath;
}

export function isValidGitSha(sha: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(sha);
}

export function parseGitLsTreeOutput(output: string): GitTreeEntry[] {
  const tree: GitTreeEntry[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const tabIdx = line.indexOf("\t");
    if (tabIdx === -1) continue;
    const meta = line.slice(0, tabIdx).trim().split(/\s+/);
    const entryPath = line.slice(tabIdx + 1);
    const mode = meta[0] || "100644";
    const type = (meta[1] === "tree" ? "tree" : "blob") as "blob" | "tree";
    const sha = meta[2] || "";
    const sizeRaw = meta[3];
    const size = sizeRaw && sizeRaw !== "-" ? Number.parseInt(sizeRaw, 10) : undefined;
    tree.push({
      path: entryPath,
      mode,
      type,
      sha,
      ...(size !== undefined && !Number.isNaN(size) ? { size } : {}),
    });
  }
  return tree;
}

/**
 * Reusable local bare-Git vault & extracted library / showcase repository reader.
 * Shared across `ide-workbench.ts`, `git-server.ts`, `repos.ts`, and `spaces.ts`.
 */
export class LocalGitVaultService {
  private readonly apiRoot: string;
  private readonly repoRoot: string;
  private readonly gitReposBaseDirs: string[];
  private readonly showcaseFiles: Record<string, Record<string, string>>;
  private readonly localRepoTreeCache = new Map<string, LocalRepoTreeCacheEntry>();

  constructor(options: LocalGitVaultOptions = {}) {
    this.apiRoot = options.apiRoot ? path.resolve(options.apiRoot) : DEFAULT_API_ROOT;
    this.repoRoot = options.repoRoot ? path.resolve(options.repoRoot) : DEFAULT_REPO_ROOT;
    this.gitReposBaseDirs = options.gitReposBaseDirs ?? [
      resolve(this.repoRoot, "data/git-repos"),
      resolve(this.apiRoot, "data/git-repos"),
    ];
    this.showcaseFiles = options.showcaseFiles ?? SHOWCASE_REPO_FILES;
  }

  resolveExtractedLibraryDir(repoKeyLower: string): string | null {
    if (repoKeyLower === "modelica/modelicastandardlibrary" || repoKeyLower === "modelica/modelica") {
      const candidates = [
        resolve(this.repoRoot, "data/libraries/Modelica/4.1.0/extracted"),
        resolve(this.apiRoot, "data/libraries/Modelica/4.1.0/extracted"),
      ];
      return candidates.find(existsSync) || null;
    }
    if (repoKeyLower === "systems-modeling/sysml-v2-release" || repoKeyLower === "systems-modeling/sysml-v2") {
      const candidates = [
        resolve(this.repoRoot, "data/libraries/SysML/2026.3.0/extracted"),
        resolve(this.apiRoot, "data/libraries/SysML/2026.3.0/extracted"),
      ];
      return candidates.find(existsSync) || null;
    }
    return null;
  }

  resolveLocalGitRepoDir(owner: string, repo: string): string | null {
    const cleanOwner = owner.trim();
    const cleanRepo = repo.trim().replace(/\.git$/i, "");
    if (
      !cleanOwner ||
      !cleanRepo ||
      cleanOwner.includes("..") ||
      cleanRepo.includes("..") ||
      cleanOwner.toLowerCase() === "_activity_cache" ||
      !SAFE_GIT_SEGMENT_RE.test(cleanOwner) ||
      !SAFE_GIT_SEGMENT_RE.test(cleanRepo)
    ) {
      return null;
    }
    for (const baseDir of this.gitReposBaseDirs) {
      const candidate = resolve(baseDir, cleanOwner, `${cleanRepo}.git`);
      if (candidate.startsWith(baseDir + path.sep) && existsSync(candidate)) {
        return candidate;
      }
    }
    if (
      process.env["NODE_ENV"] !== "production" &&
      `${cleanOwner}/${cleanRepo}`.toLowerCase() === "modelscript/modelscript" &&
      existsSync(join(this.repoRoot, ".git"))
    ) {
      return this.repoRoot;
    }
    return null;
  }

  isNonGitHubShowcaseRepo(repoKeyLower: string): boolean {
    return (
      repoKeyLower === "libeigen/eigen" || repoKeyLower === "graphviz/graphviz" || repoKeyLower === "inkscape/inkscape"
    );
  }

  getOrBuildLocalRepoTree(repoKeyLower: string): LocalRepoTreeCacheEntry | null {
    const existing = this.localRepoTreeCache.get(repoKeyLower);
    if (existing) return existing;

    const extractedDir = this.resolveExtractedLibraryDir(repoKeyLower);
    const virtualFiles = this.showcaseFiles[repoKeyLower] || {};
    if (!extractedDir && Object.keys(virtualFiles).length === 0) {
      return null;
    }

    const tree: GitTreeEntry[] = [];
    const blobPathBySha = new Map<string, string>();
    const virtualContentBySha = new Map<string, Buffer>();
    const seenPaths = new Set<string>();

    if (extractedDir && existsSync(extractedDir)) {
      const walk = (dir: string, prefix: string): void => {
        let entries;
        try {
          entries = readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        entries.sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
          if (entry.name.startsWith(".")) continue;
          const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            const sha = crypto.createHash("sha1").update(`tree:${relPath}`).digest("hex");
            tree.push({ path: relPath, mode: "040000", type: "tree", sha });
            seenPaths.add(relPath);
            walk(fullPath, relPath);
          } else if (entry.isFile()) {
            try {
              const st = statSync(fullPath);
              const sha = crypto.createHash("sha1").update(`blob:${relPath}:${st.size}`).digest("hex");
              tree.push({ path: relPath, mode: "100644", type: "blob", sha, size: st.size });
              blobPathBySha.set(sha, fullPath);
              seenPaths.add(relPath);
            } catch {
              // ignore unreadable file
            }
          }
        }
      };
      walk(extractedDir, "");
    }

    for (const [rawPath, content] of Object.entries(virtualFiles)) {
      const cleanPath = rawPath.replace(/^\/+/, "");
      const parts = cleanPath.split("/");
      for (let i = 1; i < parts.length; i++) {
        const dirPrefix = parts.slice(0, i).join("/");
        if (!seenPaths.has(dirPrefix)) {
          const dirSha = crypto.createHash("sha1").update(`vtree:${dirPrefix}`).digest("hex");
          tree.push({ path: dirPrefix, mode: "040000", type: "tree", sha: dirSha });
          seenPaths.add(dirPrefix);
        }
      }
      if (!seenPaths.has(cleanPath)) {
        const buf = Buffer.from(content, "utf-8");
        const sha = crypto.createHash("sha1").update(`vblob:${cleanPath}`).digest("hex");
        tree.push({ path: cleanPath, mode: "100644", type: "blob", sha, size: buf.length });
        virtualContentBySha.set(sha, buf);
        seenPaths.add(cleanPath);
      }
    }

    const entry: LocalRepoTreeCacheEntry = {
      tree,
      blobPathBySha,
      virtualContentBySha,
      extractedDir,
      virtualFiles,
    };
    if (this.localRepoTreeCache.size >= 100 && !this.localRepoTreeCache.has(repoKeyLower)) {
      const oldestKey = this.localRepoTreeCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.localRepoTreeCache.delete(oldestKey);
      }
    }
    this.localRepoTreeCache.set(repoKeyLower, entry);
    return entry;
  }

  readGitTree(
    gitRepoPath: string,
    rawRequestedRef: unknown,
    headSha = "HEAD",
  ): { resolvedRef: string; tree: GitTreeEntry[] } | null {
    const requestedRef = sanitizeGitRef(rawRequestedRef, headSha);
    const candidates = Array.from(new Set([requestedRef, headSha, "HEAD", "main", "master"]));
    for (const refCandidate of candidates) {
      try {
        const out = execFileSync("git", ["ls-tree", "-r", "-t", "-l", refCandidate], {
          cwd: gitRepoPath,
          encoding: "utf-8",
        });
        return {
          resolvedRef: refCandidate,
          tree: parseGitLsTreeOutput(out),
        };
      } catch {
        // try next candidate ref
      }
    }
    return null;
  }

  readGitFileContent(
    gitRepoPath: string,
    normalizedPath: string,
    rawRequestedRef: unknown,
    headSha = "HEAD",
  ): GitFileContentResult | null {
    const requestedRef = sanitizeGitRef(rawRequestedRef, headSha);
    const candidates = Array.from(new Set([requestedRef, headSha, "HEAD", "main", "master"]));
    for (const refCandidate of candidates) {
      try {
        const buf = execFileSync("git", ["show", `${refCandidate}:${normalizedPath}`], {
          cwd: gitRepoPath,
        });
        return {
          name: path.posix.basename(normalizedPath),
          path: normalizedPath,
          sha: refCandidate,
          size: buf.length,
          type: "file",
          encoding: "base64",
          content: buf.toString("base64"),
        };
      } catch {
        // try next candidate ref
      }
    }
    return null;
  }

  readGitBlob(gitRepoPath: string, sha: string): GitBlobResult | null {
    if (!isValidGitSha(sha)) {
      return null;
    }
    try {
      const buf = execFileSync("git", ["cat-file", "blob", sha], {
        cwd: gitRepoPath,
      });
      return {
        sha,
        size: buf.length,
        encoding: "base64",
        content: buf.toString("base64"),
      };
    } catch {
      return null;
    }
  }

  readGitCommits(gitRepoPath: string, rawRef: unknown = "HEAD", limit = 20): GitCommitSummary[] {
    const ref = sanitizeGitRef(rawRef, "HEAD");
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    const candidates = Array.from(new Set([ref, "HEAD", "main", "master"]));
    for (const refCandidate of candidates) {
      try {
        const out = execFileSync(
          "git",
          ["log", `-n`, String(safeLimit), "--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%s", refCandidate],
          { cwd: gitRepoPath, encoding: "utf-8" },
        );
        const commits: GitCommitSummary[] = [];
        for (const line of out.split("\n")) {
          if (!line.trim()) continue;
          const [sha = "", authorName = "", authorEmail = "", authoredAt = "", message = ""] = line.split("\x1f");
          if (sha) {
            commits.push({ sha, authorName, authorEmail, authoredAt, message });
          }
        }
        return commits;
      } catch {
        // try next candidate ref
      }
    }
    return [];
  }

  readGitHeadCommit(gitRepoPath: string, rawRef: unknown = "HEAD"): GitCommitSummary | null {
    return this.readGitCommits(gitRepoPath, rawRef, 1)[0] ?? null;
  }

  checkLocalRepoAccess(
    database: LibraryDatabase,
    user: express.Request["user"],
    ownerParam: string,
    repoParam: string,
  ): LocalRepoAccessResult {
    const cleanNsLower = ownerParam.trim().toLowerCase();
    const cleanProjLower = repoParam.replace(/\.git$/i, "").toLowerCase();
    const ownerUser = database.getUserByUsername(ownerParam);
    const org = database.getOrganizationBySlug(cleanNsLower);
    const space = database.getSpaceByNamespaceAndSlug(cleanNsLower, cleanProjLower);
    let matchedRepo = ownerUser
      ? database.getUserRepos(ownerUser.id).find((r) => {
          const rProj = (r.project || "").replace(/\.git$/i, "").toLowerCase();
          const rFull = `${r.namespace || ""}/${r.project || ""}`.replace(/\.git$/i, "").toLowerCase();
          return rProj === cleanProjLower || rFull === `${cleanNsLower}/${cleanProjLower}`;
        })
      : undefined;
    if (!matchedRepo) {
      matchedRepo = database.getLinkedRepoById(`${cleanNsLower}/${cleanProjLower}`);
    }
    const vis = space ? space.visibility : (matchedRepo as { visibility?: string | undefined } | undefined)?.visibility;

    if (vis !== "private" && vis !== "internal") {
      return { allowed: true, isPrivateOrInternal: false };
    }

    if (!user) {
      return {
        allowed: false,
        isPrivateOrInternal: true,
        status: 401,
        message: "Authentication required to access private repository.",
      };
    }

    const isAdmin = user.account_type === "admin" || (user as { role?: string | undefined }).role === "admin";
    if (!isAdmin) {
      const isSpaceMember = space ? Boolean(database.getSpaceMemberRole(space.id, user.id)) : false;
      const isOwner =
        (space &&
          (space.owner_namespace.toLowerCase() === (user.username || "").toLowerCase() || space.user_id === user.id)) ||
        (ownerUser !== undefined && user.id === ownerUser.id) ||
        (matchedRepo !== undefined && user.id === matchedRepo.user_id);
      const isOrgMember = org != null && Boolean(database.getOrganizationMemberRole(org.id, user.id));
      if (vis === "private" && !isOwner && !isOrgMember && !isSpaceMember) {
        return {
          allowed: false,
          isPrivateOrInternal: true,
          status: 403,
          message: "Forbidden: This repository is private.",
        };
      }
      if (
        vis === "internal" &&
        user.account_type === "community_federated" &&
        !isOwner &&
        !isOrgMember &&
        !isSpaceMember
      ) {
        return {
          allowed: false,
          isPrivateOrInternal: true,
          status: 403,
          message: "Forbidden: Internal repository is restricted to organization and instance members.",
        };
      }
    }

    return { allowed: true, isPrivateOrInternal: true };
  }

  serveGitRepoApiRequest(
    req: express.Request,
    res: express.Response,
    gitRepoPath: string,
    owner: string,
    repo: string,
    restPath: string,
    headSha = "HEAD",
  ): boolean {
    if (restPath.startsWith("git/trees/")) {
      const requestedRef = sanitizeGitRef(restPath.slice("git/trees/".length).split("?")[0], headSha);
      const result = this.readGitTree(gitRepoPath, requestedRef, headSha);
      if (!result) {
        res.status(404).json({ message: `Tree '${requestedRef}' not found in ${owner}/${repo}` });
        return true;
      }
      res.json({
        sha: result.resolvedRef,
        url: `${req.protocol}://${req.get("host") || "localhost"}/api/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${result.resolvedRef}`,
        tree: result.tree,
        truncated: false,
      });
      return true;
    }

    if (restPath.startsWith("contents/")) {
      const rawFilePath = decodeURIComponent(restPath.slice("contents/".length));
      const normalizedPath = normalizeGitFilePath(rawFilePath);
      if (!normalizedPath) {
        res.status(400).json({ message: "Invalid file path" });
        return true;
      }
      const fileResult = this.readGitFileContent(gitRepoPath, normalizedPath, req.query["ref"], headSha);
      if (fileResult) {
        res.json(fileResult);
        return true;
      }
      res.status(404).json({ message: `File '${normalizedPath}' not found in ${owner}/${repo}` });
      return true;
    }

    if (restPath.startsWith("git/blobs/")) {
      const sha = restPath.slice("git/blobs/".length).trim();
      if (!isValidGitSha(sha)) {
        res.status(400).json({ message: "Invalid blob SHA" });
        return true;
      }
      const blobResult = this.readGitBlob(gitRepoPath, sha);
      if (blobResult) {
        res.json(blobResult);
      } else {
        res.status(404).json({ message: "Blob not found" });
      }
      return true;
    }

    return false;
  }

  serveLocalOrShowcaseRepoRequest(
    req: express.Request,
    res: express.Response,
    owner: string,
    repo: string,
    restPath: string,
    cacheEntry: LocalRepoTreeCacheEntry,
  ): boolean {
    if (restPath.startsWith("git/trees/")) {
      const rawRef = decodeURIComponent(restPath.slice("git/trees/".length)).trim() || "main";
      res.json({
        sha: rawRef,
        url: `${req.protocol}://${req.get("host") || "localhost"}/api/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(rawRef)}`,
        tree: cacheEntry.tree,
        truncated: false,
      });
      return true;
    }

    if (restPath.startsWith("contents/")) {
      const rawFilePath = decodeURIComponent(restPath.slice("contents/".length));
      const normalizedPath = normalizeGitFilePath(rawFilePath);
      if (!normalizedPath) {
        res.status(400).json({ message: "Invalid file path" });
        return true;
      }
      if (cacheEntry.extractedDir) {
        const fullPath = resolve(cacheEntry.extractedDir, normalizedPath);
        if (fullPath.startsWith(cacheEntry.extractedDir + path.sep) && existsSync(fullPath)) {
          try {
            const st = statSync(fullPath);
            if (st.isFile()) {
              const buf = readFileSync(fullPath);
              const sha = crypto.createHash("sha1").update(`blob:${normalizedPath}:${st.size}`).digest("hex");
              res.json({
                name: path.posix.basename(normalizedPath),
                path: normalizedPath,
                sha,
                size: buf.length,
                type: "file",
                encoding: "base64",
                content: buf.toString("base64"),
              });
              return true;
            }
          } catch {
            // fall through
          }
        }
      }
      const virtualContent = cacheEntry.virtualFiles[normalizedPath];
      if (virtualContent !== undefined) {
        const buf = Buffer.from(virtualContent, "utf-8");
        const sha = crypto.createHash("sha1").update(`vblob:${normalizedPath}`).digest("hex");
        res.json({
          name: path.posix.basename(normalizedPath),
          path: normalizedPath,
          sha,
          size: buf.length,
          type: "file",
          encoding: "base64",
          content: buf.toString("base64"),
        });
        return true;
      }
      res.status(404).json({ message: `File '${normalizedPath}' not found` });
      return true;
    }

    if (restPath.startsWith("git/blobs/")) {
      const sha = restPath.slice("git/blobs/".length).trim();
      const diskPath = cacheEntry.blobPathBySha.get(sha);
      if (diskPath && existsSync(diskPath)) {
        try {
          const buf = readFileSync(diskPath);
          res.json({
            sha,
            size: buf.length,
            encoding: "base64",
            content: buf.toString("base64"),
          });
          return true;
        } catch {
          // fall through
        }
      }
      const vbuf = cacheEntry.virtualContentBySha.get(sha);
      if (vbuf) {
        res.json({
          sha,
          size: vbuf.length,
          encoding: "base64",
          content: vbuf.toString("base64"),
        });
        return true;
      }
      res.status(404).json({ message: "Blob not found" });
      return true;
    }

    return false;
  }
}
