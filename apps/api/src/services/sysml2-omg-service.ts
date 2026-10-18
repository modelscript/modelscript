// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * OMG Systems Modeling API and Services (SysML v2 REST API) Domain Service.
 *
 * Implements the official OMG Systems Modeling API (ptc/2024-02-03) data model:
 *   - Projects, Commits, Elements, and Relationships
 *   - Lossless conversion between ModelScript SymbolEntry index and OMG JSON-LD metaclasses
 *   - Standard JSON-LD payload formatting (@context, @id, @type)
 *   - Model ingestion from raw SysML v2 text or pre-compiled standard library snapshots
 *   - High-performance in-memory index with pagination and structured querying
 */

import { PhysicsSimplexReconciler } from "@modelscript/runtime";
import {
  GenericModelicaBridge,
  SysML2ContainerExporter,
  createSysML2WorkspaceIndex,
  loadEmbeddedKerMLStdlib,
  type SspSystem,
  type Sysml2ContainerExportOptions,
} from "@modelscript/sysml2";
import { randomUUID } from "node:crypto";
import type { LibraryDatabase } from "../database.js";

export const OMG_SYSML2_CONTEXT = "https://www.omg.org/spec/SysML/20240201/context.jsonld";

export interface OmgIdentified {
  "@id": string;
  "@type": string;
}

export interface OmgBranch extends OmgIdentified {
  "@type": "Branch";
  projectId: string;
  name: string;
  headCommitId?: string | undefined;
  created: string;
}

export interface OmgTag extends OmgIdentified {
  "@type": "Tag";
  projectId: string;
  name: string;
  taggedCommit: { "@id": string };
  created: string;
}

export interface OmgProject extends OmgIdentified {
  "@type": "Project";
  name: string;
  description?: string | undefined;
  created: string;
  defaultBranch: {
    "@id": string;
    name: string;
    headCommitId?: string | undefined;
  };
}

export interface OmgCommit extends OmgIdentified {
  "@type": "Commit";
  projectId: string;
  description: string;
  created: string;
  previousCommit?: { "@id": string } | null | undefined;
  mergedCommit?: { "@id": string } | null | undefined;
}

export interface OmgElement extends OmgIdentified {
  name: string;
  qualifiedName: string;
  owner?: { "@id": string } | null | undefined;
  ownedElement?: { "@id": string }[] | undefined;
  documentation?: string[] | undefined;
  isAbstract?: boolean | undefined;
  attributes?: Record<string, unknown> | undefined;
  sourceUri?: string | undefined;
}

export interface OmgRelationship extends OmgIdentified {
  source: { "@id": string }[];
  target: { "@id": string }[];
  relationshipType: string;
}

export interface OmgCommitDiff {
  baseCommitId: string;
  targetCommitId: string;
  addedElements: OmgElement[];
  modifiedElements: {
    qualifiedName: string;
    baseElement: OmgElement;
    targetElement: OmgElement;
    changedFields: string[];
  }[];
  deletedElements: OmgElement[];
  addedRelationships: OmgRelationship[];
  deletedRelationships: OmgRelationship[];
}

export interface OmgMergeConflict {
  qualifiedName: string;
  elementType: string;
  description: string;
  baseValue?: unknown;
  sourceValue?: unknown;
  targetValue?: unknown;
}

export interface OmgMergeResult {
  status: "merged" | "reconciled" | "conflicted";
  hasConflicts: boolean;
  lcaCommitId: string | null;
  sourceBranchId: string;
  targetBranchId: string;
  mergeCommit?: OmgCommit | undefined;
  conflicts: OmgMergeConflict[];
  reconciledParameters: Record<string, number>;
}

export interface OmgQuerySpec {
  select?: string[] | undefined;
  where?:
    | {
        "@type"?: string | undefined;
        name?: string | undefined;
        qualifiedName?: string | undefined;
        isAbstract?: boolean | undefined;
        [key: string]: unknown;
      }
    | undefined;
}

export interface QueryOptions {
  type?: string | undefined;
  name?: string | undefined;
  pageSize?: number | undefined;
  pageAfter?: string | undefined; // element ID cursor
}

export class SysML2OmgService {
  private projects = new Map<string, OmgProject>();
  private branches = new Map<string, OmgBranch[]>(); // projectId -> branches
  private tags = new Map<string, OmgTag[]>(); // projectId -> tags
  private commits = new Map<string, OmgCommit[]>(); // projectId -> commits
  private elements = new Map<string, Map<string, OmgElement>>(); // commitId -> (elementId -> element)
  private relationships = new Map<string, OmgRelationship[]>(); // commitId -> relationships

  constructor(private db?: LibraryDatabase | null) {
    if (this.db) {
      this.loadFromDatabase();
    }
    this.seedStandardLibraryProject();
    this.seedSampleDroneProject();
  }

  private loadFromDatabase(): void {
    if (!this.db) return;
    try {
      const projects = this.db.getSysml2Projects();
      for (const p of projects) {
        this.projects.set(p["@id"], p);
        const dbBranches = this.db.getSysml2Branches(p["@id"]);
        if (dbBranches.length > 0) {
          this.branches.set(p["@id"], dbBranches);
        } else {
          this.branches.set(p["@id"], [
            {
              "@id": p.defaultBranch["@id"],
              "@type": "Branch",
              projectId: p["@id"],
              name: p.defaultBranch.name,
              headCommitId: p.defaultBranch.headCommitId,
              created: p.created,
            },
          ]);
        }
        const dbTags = this.db.getSysml2Tags(p["@id"]);
        this.tags.set(p["@id"], dbTags);

        const commits = this.db.getSysml2Commits(p["@id"]);
        this.commits.set(p["@id"], commits);
        for (const c of commits) {
          const elements = this.db.getSysml2Elements(c["@id"]);
          const elemMap = new Map<string, OmgElement>();
          for (const e of elements) {
            elemMap.set(e["@id"], e);
          }
          this.elements.set(c["@id"], elemMap);
          const rels = this.db.getSysml2Relationships(c["@id"]);
          this.relationships.set(c["@id"], rels);
        }
      }
    } catch (err) {
      console.warn("[SysML2OmgService] Could not load from database:", err);
    }
  }

  /**
   * Lists all available projects.
   */
  listProjects(): OmgProject[] {
    return Array.from(this.projects.values());
  }

  /**
   * Retrieves a single project by ID.
   */
  getProject(projectId: string): OmgProject | undefined {
    return this.projects.get(projectId);
  }

  /**
   * Creates a new SysML v2 project with an initial commit and default branch.
   */
  createProject(name: string, description?: string, customId?: string): OmgProject {
    const projectId = customId || randomUUID();
    const branchId = customId ? `${customId}-branch` : randomUUID();
    const initialCommitId = customId ? `${customId}-init` : randomUUID();
    const now = new Date().toISOString();

    const initialCommit: OmgCommit = {
      "@id": initialCommitId,
      "@type": "Commit",
      projectId,
      description: "Initial empty commit",
      created: now,
      previousCommit: null,
    };

    const defaultBranch: OmgBranch = {
      "@id": branchId,
      "@type": "Branch",
      projectId,
      name: "main",
      headCommitId: initialCommitId,
      created: now,
    };

    const project: OmgProject = {
      "@id": projectId,
      "@type": "Project",
      name,
      description: description || `SysML v2 Project: ${name}`,
      created: now,
      defaultBranch: {
        "@id": branchId,
        name: "main",
        headCommitId: initialCommitId,
      },
    };

    this.projects.set(projectId, project);
    this.branches.set(projectId, [defaultBranch]);
    this.tags.set(projectId, []);
    this.commits.set(projectId, [initialCommit]);
    this.elements.set(initialCommitId, new Map());
    this.relationships.set(initialCommitId, []);

    if (this.db) {
      try {
        this.db.saveSysml2Project(project);
        this.db.saveSysml2Branch(defaultBranch);
        this.db.saveSysml2Commit(initialCommit);
      } catch (err) {
        console.warn("[SysML2OmgService] Could not persist project to database:", err);
      }
    }

    return project;
  }

  /**
   * Deletes a project and its associated commits, branches, tags, and elements.
   */
  deleteProject(projectId: string): boolean {
    if (!this.projects.has(projectId)) return false;
    const projectCommits = this.commits.get(projectId) || [];
    for (const c of projectCommits) {
      this.elements.delete(c["@id"]);
      this.relationships.delete(c["@id"]);
    }
    this.commits.delete(projectId);
    this.branches.delete(projectId);
    this.tags.delete(projectId);
    this.projects.delete(projectId);

    if (this.db) {
      try {
        this.db.deleteSysml2Project(projectId);
      } catch (err) {
        console.warn("[SysML2OmgService] Could not delete project from database:", err);
      }
    }

    return true;
  }

  /**
   * Lists branches for a project.
   */
  listBranches(projectId: string): OmgBranch[] {
    return this.branches.get(projectId) || [];
  }

  /**
   * Retrieves a branch by ID or name.
   */
  getBranch(projectId: string, branchIdOrName: string): OmgBranch | undefined {
    const projectBranches = this.branches.get(projectId) || [];
    return projectBranches.find((b) => b["@id"] === branchIdOrName || b.name === branchIdOrName);
  }

  /**
   * Creates a new branch pointing at a specified commit (or the default branch head).
   */
  createBranch(projectId: string, name: string, headCommitId?: string): OmgBranch {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`Project '${projectId}' not found`);

    const projectBranches = this.branches.get(projectId) || [];
    if (projectBranches.some((b) => b.name === name)) {
      throw new Error(`Branch '${name}' already exists in project '${projectId}'`);
    }

    const resolvedHead = headCommitId || project.defaultBranch.headCommitId;
    if (resolvedHead && !this.getCommit(projectId, resolvedHead)) {
      throw new Error(`Head commit '${resolvedHead}' not found in project '${projectId}'`);
    }

    const branch: OmgBranch = {
      "@id": randomUUID(),
      "@type": "Branch",
      projectId,
      name,
      headCommitId: resolvedHead,
      created: new Date().toISOString(),
    };

    projectBranches.push(branch);
    this.branches.set(projectId, projectBranches);

    if (this.db) {
      try {
        this.db.saveSysml2Branch(branch);
      } catch (err) {
        console.warn("[SysML2OmgService] Could not persist branch to database:", err);
      }
    }

    return branch;
  }

  /**
   * Deletes a non-default branch from a project.
   */
  deleteBranch(projectId: string, branchIdOrName: string): boolean {
    const project = this.projects.get(projectId);
    if (!project) return false;

    const projectBranches = this.branches.get(projectId) || [];
    const target = projectBranches.find((b) => b["@id"] === branchIdOrName || b.name === branchIdOrName);
    if (!target) return false;
    if (target["@id"] === project.defaultBranch["@id"] || target.name === project.defaultBranch.name) {
      throw new Error(`Cannot delete default branch '${target.name}'`);
    }

    this.branches.set(
      projectId,
      projectBranches.filter((b) => b["@id"] !== target["@id"]),
    );

    if (this.db) {
      try {
        this.db.deleteSysml2Branch(projectId, target["@id"]);
      } catch (err) {
        console.warn("[SysML2OmgService] Could not delete branch from database:", err);
      }
    }

    return true;
  }

  /**
   * Lists tags for a project.
   */
  listTags(projectId: string): OmgTag[] {
    return this.tags.get(projectId) || [];
  }

  /**
   * Retrieves a tag by ID or name.
   */
  getTag(projectId: string, tagIdOrName: string): OmgTag | undefined {
    const projectTags = this.tags.get(projectId) || [];
    return projectTags.find((t) => t["@id"] === tagIdOrName || t.name === tagIdOrName);
  }

  /**
   * Creates an immutable tag pointing at a specific commit.
   */
  createTag(projectId: string, name: string, commitId?: string): OmgTag {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`Project '${projectId}' not found`);

    const projectTags = this.tags.get(projectId) || [];
    if (projectTags.some((t) => t.name === name)) {
      throw new Error(`Tag '${name}' already exists in project '${projectId}'`);
    }

    const resolvedCommitId = commitId || project.defaultBranch.headCommitId;
    if (!resolvedCommitId || !this.getCommit(projectId, resolvedCommitId)) {
      throw new Error(`Commit '${resolvedCommitId}' not found in project '${projectId}'`);
    }

    const tag: OmgTag = {
      "@id": randomUUID(),
      "@type": "Tag",
      projectId,
      name,
      taggedCommit: { "@id": resolvedCommitId },
      created: new Date().toISOString(),
    };

    projectTags.push(tag);
    this.tags.set(projectId, projectTags);

    if (this.db) {
      try {
        this.db.saveSysml2Tag(tag);
      } catch (err) {
        console.warn("[SysML2OmgService] Could not persist tag to database:", err);
      }
    }

    return tag;
  }

  /**
   * Lists commits for a project.
   */
  listCommits(projectId: string): OmgCommit[] {
    return this.commits.get(projectId) || [];
  }

  /**
   * Retrieves a specific commit by ID.
   */
  getCommit(projectId: string, commitId: string): OmgCommit | undefined {
    const projectCommits = this.commits.get(projectId) || [];
    return projectCommits.find((c) => c["@id"] === commitId);
  }

  /**
   * Creates a new commit in a project (on the specified branch or default branch) with elements and relationships.
   */
  createCommit(
    projectId: string,
    description: string,
    elements: OmgElement[],
    relationships: OmgRelationship[] = [],
    branchIdOrName?: string,
    mergedCommitId?: string,
  ): OmgCommit {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    let targetBranch = branchIdOrName
      ? this.getBranch(projectId, branchIdOrName)
      : this.getBranch(projectId, project.defaultBranch["@id"]) ||
        this.getBranch(projectId, project.defaultBranch.name);

    if (branchIdOrName && !targetBranch) {
      throw new Error(`Branch '${branchIdOrName}' not found in project '${projectId}'`);
    }

    const commitId = randomUUID();
    const now = new Date().toISOString();
    const projectCommits = this.commits.get(projectId) || [];
    const parentCommitId = targetBranch?.headCommitId ?? projectCommits[projectCommits.length - 1]?.["@id"];

    const commit: OmgCommit = {
      "@id": commitId,
      "@type": "Commit",
      projectId,
      description,
      created: now,
      previousCommit: parentCommitId ? { "@id": parentCommitId } : null,
      ...(mergedCommitId ? { mergedCommit: { "@id": mergedCommitId } } : {}),
    };

    projectCommits.push(commit);

    if (targetBranch) {
      targetBranch.headCommitId = commitId;
      if (targetBranch["@id"] === project.defaultBranch["@id"] || targetBranch.name === project.defaultBranch.name) {
        project.defaultBranch.headCommitId = commitId;
      }
    } else {
      project.defaultBranch.headCommitId = commitId;
    }

    const elementMap = new Map<string, OmgElement>();
    for (const elem of elements) {
      elementMap.set(elem["@id"], elem);
    }

    this.elements.set(commitId, elementMap);
    this.relationships.set(commitId, relationships);

    if (this.db) {
      try {
        this.db.saveSysml2Commit(commit);
        this.db.saveSysml2Elements(commitId, elements);
        this.db.saveSysml2Relationships(commitId, relationships);
        if (targetBranch) {
          this.db.saveSysml2Branch(targetBranch);
        }
        this.db.saveSysml2Project(project);
      } catch (err) {
        console.warn("[SysML2OmgService] Could not persist commit to database:", err);
      }
    }

    return commit;
  }

  /**
   * Finds the Lowest Common Ancestor (LCA) commit ID between two commits in the project commit DAG.
   */
  findLowestCommonAncestor(projectId: string, commitIdA: string, commitIdB: string): string | null {
    if (commitIdA === commitIdB) return commitIdA;

    const commitMap = new Map<string, OmgCommit>();
    for (const c of this.listCommits(projectId)) {
      commitMap.set(c["@id"], c);
    }

    // Collect all ancestors of A with shortest distance
    const ancestorsA = new Map<string, number>();
    const queueA: { id: string; dist: number }[] = [{ id: commitIdA, dist: 0 }];
    while (queueA.length > 0) {
      const cur = queueA.shift()!;
      if (ancestorsA.has(cur.id)) continue;
      ancestorsA.set(cur.id, cur.dist);
      const node = commitMap.get(cur.id);
      if (node?.previousCommit?.["@id"]) {
        queueA.push({ id: node.previousCommit["@id"], dist: cur.dist + 1 });
      }
      if (node?.mergedCommit?.["@id"]) {
        queueA.push({ id: node.mergedCommit["@id"], dist: cur.dist + 1 });
      }
    }

    // BFS from B to find the closest ancestor also in ancestorsA
    const visitedB = new Set<string>();
    const queueB: string[] = [commitIdB];
    let bestLca: string | null = null;
    let bestDist = Infinity;

    while (queueB.length > 0) {
      const curId = queueB.shift()!;
      if (visitedB.has(curId)) continue;
      visitedB.add(curId);

      const distA = ancestorsA.get(curId);
      if (distA !== undefined && distA < bestDist) {
        bestDist = distA;
        bestLca = curId;
      }

      const node = commitMap.get(curId);
      if (node?.previousCommit?.["@id"]) {
        queueB.push(node.previousCommit["@id"]);
      }
      if (node?.mergedCommit?.["@id"]) {
        queueB.push(node.mergedCommit["@id"]);
      }
    }

    return bestLca;
  }

  /**
   * Computes a semantic diff between two commits in a project.
   */
  diffCommits(projectId: string, baseCommitId: string, targetCommitId: string): OmgCommitDiff {
    if (!this.getCommit(projectId, baseCommitId)) {
      throw new Error(`Base commit '${baseCommitId}' not found in project '${projectId}'`);
    }
    if (!this.getCommit(projectId, targetCommitId)) {
      throw new Error(`Target commit '${targetCommitId}' not found in project '${projectId}'`);
    }

    const baseElems = Array.from(this.elements.get(baseCommitId)?.values() ?? []);
    const targetElems = Array.from(this.elements.get(targetCommitId)?.values() ?? []);

    const keyOfElem = (e: OmgElement) => `${e["@type"]}::${e.qualifiedName || e.name || e["@id"]}`;
    const baseByKey = new Map<string, OmgElement>(baseElems.map((e) => [keyOfElem(e), e]));
    const targetByKey = new Map<string, OmgElement>(targetElems.map((e) => [keyOfElem(e), e]));

    const addedElements: OmgElement[] = [];
    const modifiedElements: OmgCommitDiff["modifiedElements"] = [];
    const deletedElements: OmgElement[] = [];

    for (const [k, tElem] of targetByKey.entries()) {
      const bElem = baseByKey.get(k);
      if (!bElem) {
        addedElements.push(tElem);
      } else {
        const changedFields: string[] = [];
        if (bElem.isAbstract !== tElem.isAbstract) changedFields.push("isAbstract");
        const bAttrs = bElem.attributes || {};
        const tAttrs = tElem.attributes || {};
        const attrKeys = new Set([...Object.keys(bAttrs), ...Object.keys(tAttrs)]);
        for (const ak of attrKeys) {
          if (ak === "sourceText") continue;
          if (JSON.stringify(bAttrs[ak]) !== JSON.stringify(tAttrs[ak])) {
            changedFields.push(`attributes.${ak}`);
          }
        }
        if (changedFields.length > 0) {
          modifiedElements.push({
            qualifiedName: tElem.qualifiedName || tElem.name,
            baseElement: bElem,
            targetElement: tElem,
            changedFields,
          });
        }
      }
    }

    for (const [k, bElem] of baseByKey.entries()) {
      if (!targetByKey.has(k)) {
        deletedElements.push(bElem);
      }
    }

    const baseRels = this.relationships.get(baseCommitId) || [];
    const targetRels = this.relationships.get(targetCommitId) || [];
    const keyOfRel = (r: OmgRelationship) =>
      `${r.relationshipType}::${r.source.map((s) => s["@id"]).join(",")}->${r.target.map((t) => t["@id"]).join(",")}`;
    const baseRelKeys = new Set(baseRels.map(keyOfRel));
    const targetRelKeys = new Set(targetRels.map(keyOfRel));

    const addedRelationships = targetRels.filter((r) => !baseRelKeys.has(keyOfRel(r)));
    const deletedRelationships = baseRels.filter((r) => !targetRelKeys.has(keyOfRel(r)));

    return {
      baseCommitId,
      targetCommitId,
      addedElements,
      modifiedElements,
      deletedElements,
      addedRelationships,
      deletedRelationships,
    };
  }

  /**
   * Performs a 3-way semantic merge from `sourceBranch` into `targetBranch`.
   */
  mergeBranches(
    projectId: string,
    sourceBranchIdOrName: string,
    targetBranchIdOrName: string,
    options: {
      strategy?: "strict" | "source-wins" | "target-wins" | "physics-simplex" | undefined;
      description?: string | undefined;
      bounds?: Record<string, { min: number; max: number }> | undefined;
    } = {},
  ): OmgMergeResult {
    const sourceBranch = this.getBranch(projectId, sourceBranchIdOrName);
    if (!sourceBranch || !sourceBranch.headCommitId) {
      throw new Error(`Source branch '${sourceBranchIdOrName}' not found or has no head commit`);
    }
    const targetBranch = this.getBranch(projectId, targetBranchIdOrName);
    if (!targetBranch || !targetBranch.headCommitId) {
      throw new Error(`Target branch '${targetBranchIdOrName}' not found or has no head commit`);
    }

    const strategy = options.strategy || "strict";
    const sourceHead = sourceBranch.headCommitId;
    const targetHead = targetBranch.headCommitId;
    const lcaCommitId = this.findLowestCommonAncestor(projectId, sourceHead, targetHead);

    const baseElems = lcaCommitId ? Array.from(this.elements.get(lcaCommitId)?.values() ?? []) : [];
    const sourceElems = Array.from(this.elements.get(sourceHead)?.values() ?? []);
    const targetElems = Array.from(this.elements.get(targetHead)?.values() ?? []);

    const keyOfElem = (e: OmgElement) => `${e["@type"]}::${e.qualifiedName || e.name}`;
    const baseMap = new Map<string, OmgElement>(baseElems.map((e) => [keyOfElem(e), e]));
    const sourceMap = new Map<string, OmgElement>(sourceElems.map((e) => [keyOfElem(e), e]));
    const targetMap = new Map<string, OmgElement>(targetElems.map((e) => [keyOfElem(e), e]));

    const allKeys = new Set<string>([...baseMap.keys(), ...sourceMap.keys(), ...targetMap.keys()]);
    const mergedElements: OmgElement[] = [];
    const conflicts: OmgMergeConflict[] = [];
    const reconciledParameters: Record<string, number> = {};

    const stripSourceText = (attrs?: Record<string, unknown>) => {
      if (!attrs) return {};
      const copy = { ...attrs };
      delete copy["sourceText"];
      return copy;
    };
    const elemEqual = (a: OmgElement, b: OmgElement) =>
      a["@type"] === b["@type"] &&
      a.isAbstract === b.isAbstract &&
      JSON.stringify(stripSourceText(a.attributes)) === JSON.stringify(stripSourceText(b.attributes));

    for (const key of allKeys) {
      const b = baseMap.get(key);
      const s = sourceMap.get(key);
      const t = targetMap.get(key);

      if (!b) {
        // Added in one or both branches
        if (s && !t) {
          mergedElements.push({ ...s });
        } else if (!s && t) {
          mergedElements.push({ ...t });
        } else if (s && t) {
          if (elemEqual(s, t) || strategy === "target-wins") {
            mergedElements.push({ ...t });
          } else if (strategy === "source-wins") {
            mergedElements.push({ ...s });
          } else if (strategy === "physics-simplex") {
            const sVal = Number(s.attributes?.["defaultValue"]);
            const tVal = Number(t.attributes?.["defaultValue"]);
            if (Number.isFinite(sVal) && Number.isFinite(tVal)) {
              const env = options.bounds?.[s.qualifiedName] || options.bounds?.[s.name];
              const simplex = PhysicsSimplexReconciler.reconcile({
                name: s.qualifiedName,
                parameters: {
                  [s.name]: {
                    name: s.name,
                    unit: "1",
                    ...(env ? { bounds: env } : {}),
                    proposals: [
                      { domain: "source", value: sVal, unit: "1" },
                      { domain: "target", value: tVal, unit: "1" },
                    ],
                  },
                },
              });
              const optVal = simplex.parameters[s.name]?.optimalValue;
              if (simplex.status === "OPTIMAL" && optVal !== undefined) {
                reconciledParameters[s.qualifiedName] = optVal;
                mergedElements.push({
                  ...t,
                  attributes: { ...t.attributes, defaultValue: String(optVal) },
                });
                continue;
              }
            }
            conflicts.push({
              qualifiedName: s.qualifiedName,
              elementType: s["@type"],
              description: `Concurrent conflicting creation of '${s.qualifiedName}'`,
              sourceValue: s.attributes,
              targetValue: t.attributes,
            });
          } else {
            conflicts.push({
              qualifiedName: s.qualifiedName,
              elementType: s["@type"],
              description: `Concurrent conflicting creation of '${s.qualifiedName}'`,
              sourceValue: s.attributes,
              targetValue: t.attributes,
            });
          }
        }
        continue;
      }

      // Existed in base
      if (!s && !t) {
        // Deleted in both
        continue;
      }
      if (!s && t) {
        // Deleted in source
        if (elemEqual(b, t) || strategy === "source-wins") {
          continue;
        }
        if (strategy === "target-wins") {
          mergedElements.push({ ...t });
          continue;
        }
        conflicts.push({
          qualifiedName: b.qualifiedName,
          elementType: b["@type"],
          description: `'${b.qualifiedName}' was deleted in '${sourceBranch.name}' but modified in '${targetBranch.name}'`,
          baseValue: b.attributes,
          targetValue: t.attributes,
        });
        continue;
      }
      if (s && !t) {
        // Deleted in target
        if (elemEqual(b, s) || strategy === "target-wins") {
          continue;
        }
        if (strategy === "source-wins") {
          mergedElements.push({ ...s });
          continue;
        }
        conflicts.push({
          qualifiedName: b.qualifiedName,
          elementType: b["@type"],
          description: `'${b.qualifiedName}' was modified in '${sourceBranch.name}' but deleted in '${targetBranch.name}'`,
          baseValue: b.attributes,
          sourceValue: s.attributes,
        });
        continue;
      }

      // Present in all three
      const sChanged = !elemEqual(b, s!);
      const tChanged = !elemEqual(b, t!);

      if (!sChanged && !tChanged) {
        mergedElements.push({ ...t! });
      } else if (sChanged && !tChanged) {
        mergedElements.push({ ...s! });
      } else if (!sChanged && tChanged) {
        mergedElements.push({ ...t! });
      } else {
        // Both modified
        if (elemEqual(s!, t!) || strategy === "target-wins") {
          mergedElements.push({ ...t! });
        } else if (strategy === "source-wins") {
          mergedElements.push({ ...s! });
        } else if (strategy === "physics-simplex") {
          const sVal = Number(s!.attributes?.["defaultValue"]);
          const tVal = Number(t!.attributes?.["defaultValue"]);
          if (Number.isFinite(sVal) && Number.isFinite(tVal)) {
            const env = options.bounds?.[s!.qualifiedName] || options.bounds?.[s!.name];
            const simplex = PhysicsSimplexReconciler.reconcile({
              name: s!.qualifiedName,
              parameters: {
                [s!.name]: {
                  name: s!.name,
                  unit: "1",
                  ...(env ? { bounds: env } : {}),
                  proposals: [
                    { domain: "source", value: sVal, unit: "1" },
                    { domain: "target", value: tVal, unit: "1" },
                  ],
                },
              },
            });
            const optVal = simplex.parameters[s!.name]?.optimalValue;
            if (simplex.status === "OPTIMAL" && optVal !== undefined) {
              reconciledParameters[s!.qualifiedName] = optVal;
              mergedElements.push({
                ...t!,
                attributes: { ...t!.attributes, defaultValue: String(optVal) },
              });
              continue;
            }
          }
          conflicts.push({
            qualifiedName: b.qualifiedName,
            elementType: b["@type"],
            description: `Conflicting modifications to '${b.qualifiedName}'`,
            baseValue: b.attributes,
            sourceValue: s!.attributes,
            targetValue: t!.attributes,
          });
        } else {
          conflicts.push({
            qualifiedName: b.qualifiedName,
            elementType: b["@type"],
            description: `Conflicting modifications to '${b.qualifiedName}'`,
            baseValue: b.attributes,
            sourceValue: s!.attributes,
            targetValue: t!.attributes,
          });
        }
      }
    }

    if (conflicts.length > 0) {
      return {
        status: "conflicted",
        hasConflicts: true,
        lcaCommitId,
        sourceBranchId: sourceBranch["@id"],
        targetBranchId: targetBranch["@id"],
        conflicts,
        reconciledParameters,
      };
    }

    // Merge relationships (union by relationshipType + source + target)
    const sourceRels = this.relationships.get(sourceHead) || [];
    const targetRels = this.relationships.get(targetHead) || [];
    const mergedRelsMap = new Map<string, OmgRelationship>();
    for (const r of [...targetRels, ...sourceRels]) {
      const k = `${r.relationshipType}::${r.source.map((x) => x["@id"]).join(",")}->${r.target.map((x) => x["@id"]).join(",")}`;
      if (!mergedRelsMap.has(k)) {
        mergedRelsMap.set(k, r);
      }
    }

    // Ensure root element's ownedElement array reflects all merged child elements
    const rootElem = mergedElements.find((e) => !e.owner);
    if (rootElem) {
      rootElem.ownedElement = mergedElements.filter((e) => e !== rootElem).map((e) => ({ "@id": e["@id"] }));
      if (rootElem.attributes?.["sourceText"]) {
        delete rootElem.attributes["sourceText"];
      }
    }

    const mergeDescription = options.description || `Merge branch '${sourceBranch.name}' into '${targetBranch.name}'`;
    const mergeCommit = this.createCommit(
      projectId,
      mergeDescription,
      mergedElements,
      Array.from(mergedRelsMap.values()),
      targetBranch["@id"],
      sourceHead,
    );

    return {
      status: Object.keys(reconciledParameters).length > 0 ? "reconciled" : "merged",
      hasConflicts: false,
      lcaCommitId,
      sourceBranchId: sourceBranch["@id"],
      targetBranchId: targetBranch["@id"],
      mergeCommit,
      conflicts: [],
      reconciledParameters,
    };
  }

  /**
   * Queries elements within a specific commit with pagination and filtering.
   */
  getElements(
    _projectId: string,
    commitId: string,
    options: QueryOptions = {},
  ): { elements: OmgElement[]; nextCursor?: string | undefined; totalCount: number } {
    const elementMap = this.elements.get(commitId);
    if (!elementMap) return { elements: [], totalCount: 0 };

    let list = Array.from(elementMap.values());

    // Filter by type
    if (options.type) {
      const typeLower = options.type.toLowerCase();
      list = list.filter((e) => e["@type"].toLowerCase() === typeLower);
    }

    // Filter by name
    if (options.name) {
      const nameLower = options.name.toLowerCase();
      list = list.filter((e) => e.name.toLowerCase().includes(nameLower));
    }

    const totalCount = list.length;

    // Pagination
    let startIndex = 0;
    if (options.pageAfter) {
      const idx = list.findIndex((e) => e["@id"] === options.pageAfter);
      if (idx !== -1) {
        startIndex = idx + 1;
      }
    }

    const pageSize = Math.min(options.pageSize || 50, 200);
    const paginated = list.slice(startIndex, startIndex + pageSize);
    const nextCursor = startIndex + pageSize < totalCount ? paginated[paginated.length - 1]?.["@id"] : undefined;

    return {
      elements: paginated,
      nextCursor,
      totalCount,
    };
  }

  /**
   * Retrieves a single element by ID from a commit.
   */
  getElementById(_projectId: string, commitId: string, elementId: string): OmgElement | undefined {
    const elementMap = this.elements.get(commitId);
    return elementMap?.get(elementId);
  }

  /**
   * Retrieves all relationships where the element is source or target.
   */
  getElementRelationships(_projectId: string, commitId: string, elementId: string): OmgRelationship[] {
    const rels = this.relationships.get(commitId) || [];
    return rels.filter(
      (r) => r.source.some((s) => s["@id"] === elementId) || r.target.some((t) => t["@id"] === elementId),
    );
  }

  /**
   * Executes a structured JSON query against a commit.
   */
  executeQuery(_projectId: string, commitId: string, querySpec: OmgQuerySpec): OmgElement[] {
    const elementMap = this.elements.get(commitId);
    if (!elementMap) return [];

    let list = Array.from(elementMap.values());

    if (querySpec.where) {
      const where = querySpec.where;
      list = list.filter((elem) => {
        for (const [k, v] of Object.entries(where)) {
          if (k === "@type" && elem["@type"].toLowerCase() !== String(v).toLowerCase()) {
            return false;
          }
          if (k === "name" && elem.name !== v) {
            return false;
          }
          if (k === "qualifiedName" && elem.qualifiedName !== v) {
            return false;
          }
          if (k === "isAbstract" && elem.isAbstract !== v) {
            return false;
          }
        }
        return true;
      });
    }

    return list;
  }

  /**
   * Export a project or specific commit to an SSP (System Structure and Parameterization) archive (.ssp).
   */
  async exportProjectToSsp(
    projectId: string,
    commitId?: string,
    options?: Sysml2ContainerExportOptions,
  ): Promise<{ filename: string; data: Buffer | Uint8Array; system: SspSystem }> {
    const project = this.getProject(projectId);
    if (!project) throw new Error(`Project '${projectId}' not found`);

    const projectCommits = this.commits.get(projectId) || [];
    const commit = commitId ? this.getCommit(projectId, commitId) : projectCommits[projectCommits.length - 1];
    if (!commit) throw new Error(`Commit not found for project '${projectId}'`);

    const sysmlSource = this.synthesizeSysmlSourceFromCommit(projectId, commit["@id"]);

    const exportOptions: Sysml2ContainerExportOptions = {
      ...options,
    };
    const desc = options?.description ?? project.description;
    if (desc !== undefined) {
      exportOptions.description = desc;
    }

    const result = await SysML2ContainerExporter.exportToSsp(sysmlSource, exportOptions);

    return {
      filename: `${project.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.ssp`,
      data: result.archive,
      system: result.system,
    };
  }

  /**
   * Export a project or specific commit to a monolithic FMI 3.0 FMU (.fmu) with Terminals & Icons.
   */
  async exportProjectToFmi3(
    projectId: string,
    commitId?: string,
    options?: Sysml2ContainerExportOptions,
  ): Promise<{ filename: string; data: Uint8Array; files: string[] }> {
    const project = this.getProject(projectId);
    if (!project) throw new Error(`Project '${projectId}' not found`);

    const projectCommits = this.commits.get(projectId) || [];
    const commit = commitId ? this.getCommit(projectId, commitId) : projectCommits[projectCommits.length - 1];
    if (!commit) throw new Error(`Commit not found for project '${projectId}'`);

    const sysmlSource = this.synthesizeSysmlSourceFromCommit(projectId, commit["@id"]);

    const exportOptions: Sysml2ContainerExportOptions = {
      ...options,
      fmiVersion: "3",
    };
    const desc = options?.description ?? project.description;
    if (desc !== undefined) {
      exportOptions.description = desc;
    }

    const result = await SysML2ContainerExporter.exportToFmi3(sysmlSource, exportOptions);

    return {
      filename: `${project.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.fmu`,
      data: result.archive,
      files: result.files,
    };
  }

  private synthesizeSysmlSourceFromCommit(_projectId: string, commitId: string): string {
    const elementMap = this.elements.get(commitId);
    const elements: OmgElement[] = elementMap ? Array.from(elementMap.values()) : [];
    // 1. Check if root element has stored sourceText
    for (const elem of elements) {
      if (elem.attributes?.["sourceText"]) {
        return elem.attributes["sourceText"] as string;
      }
    }

    // 2. Synthesize from elements
    const rootElem = elements.find((e: OmgElement) => !e.owner) || elements[0];
    const name = rootElem ? rootElem.name : "Model";
    const lines: string[] = [];
    lines.push(`package ${name}Package {`);
    lines.push(`  part def ${name} {`);

    for (const elem of elements) {
      if (elem === rootElem) continue;
      if (elem["@type"] === "AttributeUsage") {
        const val = elem.attributes?.["defaultValue"] ? ` = ${elem.attributes["defaultValue"]}` : "";
        lines.push(`    attribute ${elem.name} : Real${val};`);
      } else if (elem["@type"] === "PortUsage") {
        const conj = elem.attributes?.["isConjugated"] ? "~" : "";
        lines.push(`    port ${elem.name} : ${conj}${elem.attributes?.["type"] || "Port"};`);
      } else if (elem["@type"] === "ConnectionUsage") {
        if (elem.attributes?.["source"] && elem.attributes?.["target"]) {
          lines.push(`    connection connect ${elem.attributes["source"]} to ${elem.attributes["target"]};`);
        }
      }
    }

    lines.push(`  }`);
    lines.push(`}`);
    return lines.join("\n");
  }

  /**
   * Ingests SysML v2 source code text into a new commit on the project.
   */
  ingestSysML2(
    projectId: string,
    commitDescription: string,
    sysmlSource: string,
    sourceUri = "sysml2://workspace/model.sysml",
    branchIdOrName?: string,
  ): OmgCommit {
    const parsed = GenericModelicaBridge.parseSysML2(sysmlSource);
    const elements: OmgElement[] = [];
    const relationships: OmgRelationship[] = [];

    // Main Definition Element
    const rootId = `urn:uuid:${randomUUID()}`;
    const rootType = mapKindToOmgType(parsed.kind);
    const rootElement: OmgElement = {
      "@id": rootId,
      "@type": rootType,
      name: parsed.name,
      qualifiedName: parsed.name,
      isAbstract: parsed.isAbstract || false,
      ownedElement: [],
      sourceUri,
      attributes: {
        sourceText: sysmlSource,
      },
    };
    elements.push(rootElement);

    // Attributes
    for (const attr of parsed.attributes) {
      const attrId = `urn:uuid:${randomUUID()}`;
      const attrElem: OmgElement = {
        "@id": attrId,
        "@type": "AttributeUsage",
        name: attr.name,
        qualifiedName: `${parsed.name}::${attr.name}`,
        owner: { "@id": rootId },
        attributes: {
          type: attr.type,
          defaultValue: attr.defaultValue,
          isParameter: attr.isParameter,
        },
        sourceUri,
      };
      elements.push(attrElem);
      rootElement.ownedElement?.push({ "@id": attrId });
    }

    // Ports
    for (const port of parsed.ports) {
      const portId = `urn:uuid:${randomUUID()}`;
      const portElem: OmgElement = {
        "@id": portId,
        "@type": "PortUsage",
        name: port.name,
        qualifiedName: `${parsed.name}::${port.name}`,
        owner: { "@id": rootId },
        attributes: {
          type: port.type,
          direction: port.direction,
          isConjugated: port.isConjugated || false,
        },
        sourceUri,
      };
      elements.push(portElem);
      rootElement.ownedElement?.push({ "@id": portId });
    }

    // Connections
    for (const conn of parsed.connections) {
      const connId = `urn:uuid:${randomUUID()}`;
      const connElem: OmgElement = {
        "@id": connId,
        "@type": "ConnectionUsage",
        name: `conn_${conn.source}_${conn.target}`,
        qualifiedName: `${parsed.name}::conn_${conn.source}_${conn.target}`,
        owner: { "@id": rootId },
        attributes: {
          source: conn.source,
          target: conn.target,
          kind: conn.kind || "physical",
        },
        sourceUri,
      };
      elements.push(connElem);
      rootElement.ownedElement?.push({ "@id": connId });

      relationships.push({
        "@id": `urn:uuid:${randomUUID()}`,
        "@type": "Connector",
        relationshipType: "connection",
        source: [{ "@id": rootId }],
        target: [{ "@id": connId }],
      });
    }

    // Constraints
    if (parsed.constraints) {
      for (let i = 0; i < parsed.constraints.length; i++) {
        const cText = parsed.constraints[i];
        const cId = `urn:uuid:${randomUUID()}`;
        const cElem: OmgElement = {
          "@id": cId,
          "@type": "ConstraintUsage",
          name: `constraint_${i + 1}`,
          qualifiedName: `${parsed.name}::constraint_${i + 1}`,
          owner: { "@id": rootId },
          attributes: { expression: cText },
          sourceUri,
        };
        elements.push(cElem);
        rootElement.ownedElement?.push({ "@id": cId });
      }
    }

    return this.createCommit(projectId, commitDescription, elements, relationships, branchIdOrName);
  }

  /**
   * Pre-seeds the hydrated KerML standard library project with all 125 symbols.
   */
  private seedStandardLibraryProject(): void {
    const projectId = "urn:uuid:kerml-standard-library";
    if (this.projects.has(projectId)) return;
    const commitId = "urn:uuid:kerml-stdlib-commit-v1";
    const now = "2026-09-18T00:00:00.000Z";

    const project: OmgProject = {
      "@id": projectId,
      "@type": "Project",
      name: "KerML-Standard-Library",
      description: "Pre-compiled KerML / SysML v2 Standard Foundation Library (125 symbols)",
      created: now,
      defaultBranch: {
        "@id": "urn:uuid:branch-kerml-main",
        name: "main",
        headCommitId: commitId,
      },
    };

    const commit: OmgCommit = {
      "@id": commitId,
      "@type": "Commit",
      projectId,
      description: "Hydrated KerML 1.0 Normative Standard Library Snapshot",
      created: now,
      previousCommit: null,
    };

    this.projects.set(projectId, project);
    this.branches.set(projectId, [
      {
        "@id": "urn:uuid:branch-kerml-main",
        "@type": "Branch",
        projectId,
        name: "main",
        headCommitId: commitId,
        created: now,
      },
    ]);
    this.tags.set(projectId, []);
    this.commits.set(projectId, [commit]);

    const ws = createSysML2WorkspaceIndex();
    const uri = loadEmbeddedKerMLStdlib(ws);
    const unified = ws.toUnified();

    const elementMap = new Map<string, OmgElement>();
    for (const [symId, entry] of unified.symbols.entries()) {
      const elemId = `urn:uuid:kerml-sym-${symId}`;
      const elem: OmgElement = {
        "@id": elemId,
        "@type": mapKindToOmgType(entry.kind),
        name: entry.name,
        qualifiedName: entry.name,
        isAbstract: true,
        sourceUri: uri || undefined,
      };
      elementMap.set(elemId, elem);
    }

    this.elements.set(commitId, elementMap);
    this.relationships.set(commitId, []);
  }

  /**
   * Pre-seeds an autonomous drone SysML v2 architecture project.
   */
  private seedSampleDroneProject(): void {
    const DRONE_PROJECT_ID = "urn:uuid:autonomous-drone-sysml2";
    if (this.projects.has(DRONE_PROJECT_ID) && (this.commits.get(DRONE_PROJECT_ID)?.length ?? 0) >= 2) {
      return;
    }
    const project = this.createProject(
      "AutonomousDrone-SysML2",
      "Multi-physics Quadcopter System Architecture & Control",
      DRONE_PROJECT_ID,
    );

    const droneSysml = `
package DroneArchitecture {
  part def Motor {
    port powerIn : ElectricPower;
    port controlIn : ControlBus;
    port flange : MechanicalFlange;
  }
  part def Battery {
    port ~powerOut : ElectricPower;
  }
  part def FlightController {
    port controlOut : ControlBus;
    port telemetry : TelemetryPort;
  }

  part def AutonomousDrone {
    part battery : Battery;
    part motor1 : Motor;
    part motor2 : Motor;
    part fc : FlightController;

    port externalTelemetry : TelemetryPort;

    connection connect battery.powerOut to motor1.powerIn;
    connection connect battery.powerOut to motor2.powerIn;
    connection connect fc.controlOut to motor1.controlIn;
    connection connect fc.telemetry to externalTelemetry;
  }
}
`;

    this.ingestSysML2(
      project["@id"],
      "Autonomous quadcopter composite architecture with battery, motors, and flight controller",
      droneSysml,
      "sysml2://workspace/Drone.sysml",
    );
  }
}

/**
 * Maps ModelScript / SysML v2 symbol kinds to standard OMG Metaclass names.
 */
function mapKindToOmgType(kind: string): string {
  const k = kind.toLowerCase().trim();
  switch (k) {
    case "part def":
    case "partdefinition":
      return "PartDefinition";
    case "part":
    case "partusage":
      return "PartUsage";
    case "port def":
    case "portdefinition":
      return "PortDefinition";
    case "port":
    case "portusage":
      return "PortUsage";
    case "item def":
    case "itemdefinition":
      return "ItemDefinition";
    case "item":
    case "itemusage":
      return "ItemUsage";
    case "action def":
    case "actiondefinition":
      return "ActionDefinition";
    case "action":
    case "actionusage":
      return "ActionUsage";
    case "state def":
    case "statedefinition":
      return "StateDefinition";
    case "state":
    case "stateusage":
      return "StateUsage";
    case "constraint def":
    case "constraintdefinition":
      return "ConstraintDefinition";
    case "constraint":
    case "constraintusage":
      return "ConstraintUsage";
    case "requirement def":
    case "requirementdefinition":
      return "RequirementDefinition";
    case "requirement":
    case "requirementusage":
      return "RequirementUsage";
    case "attribute def":
    case "attributedefinition":
      return "AttributeDefinition";
    case "attribute":
    case "attributeusage":
      return "AttributeUsage";
    case "package":
      return "Package";
    case "connection":
    case "connectionusage":
      return "ConnectionUsage";
    case "interface def":
    case "interfacedefinition":
      return "InterfaceDefinition";
    case "interface":
    case "interfaceusage":
      return "InterfaceUsage";
    case "allocation":
    case "allocationusage":
      return "AllocationUsage";
    default:
      return k.charAt(0).toUpperCase() + k.slice(1).replace(/\s+/g, "");
  }
}
