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

import {
  GenericModelicaBridge,
  SysML2ContainerExporter,
  createSysML2WorkspaceIndex,
  loadEmbeddedKerMLStdlib,
  type SspSystem,
  type Sysml2ContainerExportOptions,
} from "@modelscript/sysml2";
import { randomUUID } from "node:crypto";

export const OMG_SYSML2_CONTEXT = "https://www.omg.org/spec/SysML/20240201/context.jsonld";

export interface OmgIdentified {
  "@id": string;
  "@type": string;
}

export interface OmgProject extends OmgIdentified {
  "@type": "Project";
  name: string;
  description?: string;
  created: string;
  defaultBranch: {
    "@id": string;
    name: string;
    headCommitId?: string;
  };
}

export interface OmgCommit extends OmgIdentified {
  "@type": "Commit";
  projectId: string;
  description: string;
  created: string;
  previousCommit?: { "@id": string } | null;
}

export interface OmgElement extends OmgIdentified {
  name: string;
  qualifiedName: string;
  owner?: { "@id": string } | null;
  ownedElement?: { "@id": string }[];
  documentation?: string[];
  isAbstract?: boolean;
  attributes?: Record<string, unknown>;
  sourceUri?: string | undefined;
}

export interface OmgRelationship extends OmgIdentified {
  source: { "@id": string }[];
  target: { "@id": string }[];
  relationshipType: string;
}

export interface OmgQuerySpec {
  select?: string[];
  where?: {
    "@type"?: string;
    name?: string;
    qualifiedName?: string;
    isAbstract?: boolean;
    [key: string]: unknown;
  };
}

export interface QueryOptions {
  type?: string | undefined;
  name?: string | undefined;
  pageSize?: number | undefined;
  pageAfter?: string | undefined; // element ID cursor
}

export class SysML2OmgService {
  private projects = new Map<string, OmgProject>();
  private commits = new Map<string, OmgCommit[]>(); // projectId -> commits
  private elements = new Map<string, Map<string, OmgElement>>(); // commitId -> (elementId -> element)
  private relationships = new Map<string, OmgRelationship[]>(); // commitId -> relationships

  constructor() {
    this.seedStandardLibraryProject();
    this.seedSampleDroneProject();
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
  createProject(name: string, description?: string): OmgProject {
    const projectId = randomUUID();
    const branchId = randomUUID();
    const initialCommitId = randomUUID();
    const now = new Date().toISOString();

    const initialCommit: OmgCommit = {
      "@id": initialCommitId,
      "@type": "Commit",
      projectId,
      description: "Initial empty commit",
      created: now,
      previousCommit: null,
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
    this.commits.set(projectId, [initialCommit]);
    this.elements.set(initialCommitId, new Map());
    this.relationships.set(initialCommitId, []);

    return project;
  }

  /**
   * Deletes a project and its associated commits and elements.
   */
  deleteProject(projectId: string): boolean {
    if (!this.projects.has(projectId)) return false;
    const projectCommits = this.commits.get(projectId) || [];
    for (const c of projectCommits) {
      this.elements.delete(c["@id"]);
      this.relationships.delete(c["@id"]);
    }
    this.commits.delete(projectId);
    this.projects.delete(projectId);
    return true;
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
   * Creates a new commit in a project with elements and relationships.
   */
  createCommit(
    projectId: string,
    description: string,
    elements: OmgElement[],
    relationships: OmgRelationship[] = [],
  ): OmgCommit {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    const commitId = randomUUID();
    const now = new Date().toISOString();
    const projectCommits = this.commits.get(projectId) || [];
    const previousCommit = projectCommits[projectCommits.length - 1];

    const commit: OmgCommit = {
      "@id": commitId,
      "@type": "Commit",
      projectId,
      description,
      created: now,
      previousCommit: previousCommit ? { "@id": previousCommit["@id"] } : null,
    };

    projectCommits.push(commit);
    project.defaultBranch.headCommitId = commitId;

    const elementMap = new Map<string, OmgElement>();
    for (const elem of elements) {
      elementMap.set(elem["@id"], elem);
    }

    this.elements.set(commitId, elementMap);
    this.relationships.set(commitId, relationships);

    return commit;
  }

  /**
   * Queries elements within a specific commit with pagination and filtering.
   */
  getElements(
    projectId: string,
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
  getElementById(projectId: string, commitId: string, elementId: string): OmgElement | undefined {
    const elementMap = this.elements.get(commitId);
    return elementMap?.get(elementId);
  }

  /**
   * Retrieves all relationships where the element is source or target.
   */
  getElementRelationships(projectId: string, commitId: string, elementId: string): OmgRelationship[] {
    const rels = this.relationships.get(commitId) || [];
    return rels.filter(
      (r) => r.source.some((s) => s["@id"] === elementId) || r.target.some((t) => t["@id"] === elementId),
    );
  }

  /**
   * Executes a structured JSON query against a commit.
   */
  executeQuery(projectId: string, commitId: string, querySpec: OmgQuerySpec): OmgElement[] {
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

    return this.createCommit(projectId, commitDescription, elements, relationships);
  }

  /**
   * Pre-seeds the hydrated KerML standard library project with all 125 symbols.
   */
  private seedStandardLibraryProject(): void {
    const projectId = "urn:uuid:kerml-standard-library";
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
    const project = this.createProject(
      "AutonomousDrone-SysML2",
      "Multi-physics Quadcopter System Architecture & Control",
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
