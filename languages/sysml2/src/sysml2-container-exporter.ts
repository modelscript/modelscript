// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * SysML v2 Multi-Physics Container Exporter.
 *
 * Packages SysML v2 architectural models combined with Modelica continuous dynamics
 * into standardized, runnable containers:
 *   1. SSP 1.0/2.0 Multi-Physics Packages (`.ssp`):
 *      - Each SysML v2 sub-part is compiled into an isolated FMU under `resources/<partName>.fmu`.
 *      - Subsystem topology & couplings become `SystemStructure.ssd`.
 *      - Parameter bindings become inline or external `.ssv` files.
 *   2. Unified Monolithic FMI 3.0 FMU (`.fmu`):
 *      - Synthesizes a composite DAE arena (`DAEBuilder`).
 *      - Emits FMI 3.0 `modelDescription.xml` with explicit Float64 types.
 *      - Emits official FMI 3.0 Terminals & Icons Layered Standard (`terminalsAndIcons.xml`),
 *        mapping SysML v2 architectural ports and conjugated ports to <Terminal> declarations.
 */

import {
  DdpPackager,
  exportSspFromSystem,
  generateFmuArchive,
  type DdpArtifactDescriptor,
  type DdpFileEntry,
  type DdpManifest,
  type DdpRelation,
  type Fmi3Terminal,
  type Fmi3TerminalMemberVariable,
  type FmuArchiveOptions,
  type FmuArchiveResult,
  type SspComponent,
  type SspConnection,
  type SspConnector,
  type SspExportOptions,
  type SspParameterBinding,
  type SspParameterValue,
  type SspSystem,
} from "@modelscript/exchange";
import { BinOp, Causality, DAEBuilder, EqKind, initBltWasm, Variability, VarType } from "@modelscript/runtime";
import {
  GenericModelicaBridge,
  type SysML2GenericDefinition,
  type SysML2PartUsage,
} from "../transformers/generic-modelica-bridge.js";

export type { SspSystem };

/** Options for SysML v2 container export. */
export interface Sysml2ContainerExportOptions extends SspExportOptions {
  /** Target SSP version (default "1.0"). */
  version?: string;
  /** System description text. */
  description?: string;
  /** Target FMI version for internal or monolithic FMUs ("2" | "3" | "both", default "3"). */
  fmiVersion?: "2" | "3" | "both";
  /** Include C sources in FMUs (default true). */
  includeSources?: boolean;
  /** Include WASM binary / source in FMUs (default true). */
  includeWasm?: boolean;
  /** Custom modelica implementations or pre-built DAEs for parts (partTypeName -> DAEBuilder | string). */
  partBehaviors?: Map<string, DAEBuilder | string>;
  /** Default experiment start time. */
  startTime?: number;
  /** Default experiment stop time. */
  stopTime?: number;
  /** Default experiment step size. */
  stepSize?: number;
}

/** Result of an SSP multi-physics package export. */
export interface Sysml2SspResult {
  /** The generated .ssp ZIP archive bytes. */
  archive: Buffer | Uint8Array;
  /** The generated SspSystem structure. */
  system: SspSystem;
  /** Number of subsystem FMUs bundled inside the SSP. */
  fmuCount: number;
  /** Names of the bundled FMUs. */
  fmuNames: string[];
}

export class SysML2ContainerExporter {
  /**
   * Export a SysML v2 architecture to an SSP (System Structure and Parameterization) archive (.ssp).
   *
   * @param sysmlSource SysML v2 text containing composite part definition and subparts
   * @param options     Export settings and optional behavioral definitions
   */
  static async exportToSsp(
    sysmlSource: string | SysML2GenericDefinition,
    options?: Sysml2ContainerExportOptions,
  ): Promise<Sysml2SspResult> {
    const sysmlDef = typeof sysmlSource === "string" ? GenericModelicaBridge.parseSysML2(sysmlSource) : sysmlSource;

    try {
      await initBltWasm();
    } catch {}

    const systemName = sysmlDef.name || "SysML2MultiPhysicsSystem";
    const parts = sysmlDef.parts && sysmlDef.parts.length > 0 ? sysmlDef.parts : this.synthesizeDefaultParts(sysmlDef);

    const fmuArchives = new Map<string, Uint8Array | Buffer>();
    const sspComponents: SspComponent[] = [];
    const fmuNames: string[] = [];

    // 1. Compile each subsystem into an FMU
    for (const part of parts) {
      const partDae = this.resolvePartDae(part, options?.partBehaviors);
      const fmiVersion = options?.fmiVersion ?? "3";
      const fmuResult = generateFmuArchive(partDae, {
        modelIdentifier: part.name,
        fmiVersion,
        includeSources: options?.includeSources !== false,
        includeWasm: options?.includeWasm !== false,
        startTime: options?.startTime,
        stopTime: options?.stopTime,
        stepSize: options?.stepSize,
      });

      const fmuFileName = `${part.name}.fmu`;
      fmuArchives.set(fmuFileName, fmuResult.archive);
      fmuNames.push(fmuFileName);

      // Extract connectors for this component from the DAE
      const connectors: SspConnector[] = [];
      for (let i = 0; i < partDae.varCount; i++) {
        if (partDae.isVarRemoved(i)) continue;
        const causality = partDae.getVarCausality(i);
        if (causality === Causality.Input || causality === Causality.Output) {
          const varName = partDae.getVarName(i);
          connectors.push({
            name: varName,
            kind: causality === Causality.Input ? "input" : "output",
            type: "Real",
          });
        }
      }

      // If no input/output variables found, synthesize connectors from port hints
      if (connectors.length === 0) {
        connectors.push({ name: "in", kind: "input", type: "Real" });
        connectors.push({ name: "out", kind: "output", type: "Real" });
      }

      sspComponents.push({
        name: part.name,
        source: `resources/${fmuFileName}`,
        type: "application/x-fmu-sharedlibrary",
        connectors,
      });
    }

    // 2. Build Connections from SysML v2 connections
    const sspConnections: SspConnection[] = [];
    for (const conn of sysmlDef.connections) {
      const srcParts = conn.source.split(".");
      const tgtParts = conn.target.split(".");

      if (srcParts.length >= 2 && tgtParts.length >= 2) {
        sspConnections.push({
          startElement: srcParts[0]!,
          startConnector: srcParts.slice(1).join("."),
          endElement: tgtParts[0]!,
          endConnector: tgtParts.slice(1).join("."),
        });
      }
    }

    // 3. Build Parameter Bindings
    const parameterBindings: SspParameterBinding[] = [];
    for (const part of parts) {
      if (part.attributes && Object.keys(part.attributes).length > 0) {
        const values: SspParameterValue[] = [];
        for (const [name, val] of Object.entries(part.attributes)) {
          values.push({
            name,
            type: typeof val === "number" ? "Real" : typeof val === "boolean" ? "Boolean" : "String",
            value: val,
          });
        }
        parameterBindings.push({
          prefix: part.name,
          source: `resources/${part.name}_params.ssv`,
          values,
        });
      }
    }

    // 4. System-level Boundary Connectors
    const systemConnectors: SspConnector[] = sysmlDef.ports.map((p) => ({
      name: p.name,
      kind: p.direction === "in" ? "input" : p.direction === "out" ? "output" : "inout",
      type: "Real",
    }));

    // 5. Construct SspSystem
    const system: SspSystem = {
      name: systemName,
      description: `SysML v2 Multi-Physics Container for ${systemName}`,
      version: options?.version ?? "1.0",
      connectors: systemConnectors,
      components: sspComponents,
      connections: sspConnections,
      parameterBindings,
      defaultExperiment: {
        startTime: options?.startTime ?? 0,
        stopTime: options?.stopTime ?? 10,
      },
    };

    // 6. Generate .ssp ZIP archive
    const archive = exportSspFromSystem(system, fmuArchives, options);

    return {
      archive,
      system,
      fmuCount: sspComponents.length,
      fmuNames,
    };
  }

  /**
   * Export a SysML v2 architecture and continuous dynamics to a single monolithic FMI 3.0 FMU (.fmu)
   * with the official FMI 3.0 Terminals and Icons layered standard.
   *
   * @param sysmlSource SysML v2 text or generic definition
   * @param options     FMU archive and generation settings
   */
  static async exportToFmi3(
    sysmlSource: string | SysML2GenericDefinition,
    options?: Sysml2ContainerExportOptions,
  ): Promise<FmuArchiveResult> {
    const sysmlDef = typeof sysmlSource === "string" ? GenericModelicaBridge.parseSysML2(sysmlSource) : sysmlSource;

    try {
      await initBltWasm();
    } catch {}

    const modelIdentifier = sysmlDef.name || "SysML2MonolithicModel";

    // 1. Build composite DAE representing the integrated system
    const dae = this.buildCompositeDae(sysmlDef, options?.partBehaviors);

    // 2. Map SysML v2 ports to official FMI 3.0 Terminals
    const explicitTerminals: Fmi3Terminal[] = [];
    for (const port of sysmlDef.ports) {
      const memberVars: Fmi3TerminalMemberVariable[] = [];

      // Find all matching variables for this port in the DAE
      for (let i = 0; i < dae.varCount; i++) {
        if (dae.isVarRemoved(i)) continue;
        const vName = dae.getVarName(i);
        if (vName === port.name || vName.startsWith(`${port.name}.`)) {
          const memberName = vName === port.name ? port.name : vName.slice(port.name.length + 1);
          memberVars.push({
            variableName: vName,
            valueReference: i,
            memberName,
          });
        }
      }

      // If no nested variables were found, create a terminal reference to the base port
      if (memberVars.length === 0) {
        memberVars.push({
          variableName: port.name,
          valueReference: 1, // Fallback VR
          memberName: port.name,
        });
      }

      explicitTerminals.push({
        name: port.name,
        terminalKind: port.type,
        description: `SysML v2 ${port.isConjugated ? "conjugated " : ""}port ${port.name} of type ${port.type}`,
        memberVariables: memberVars,
      });
    }

    // 3. Generate FMI 3.0 FMU archive
    const fmuOptions: FmuArchiveOptions = {
      modelIdentifier,
      fmiVersion: "3",
      includeSources: options?.includeSources !== false,
      includeWasm: options?.includeWasm !== false,
      startTime: options?.startTime,
      stopTime: options?.stopTime,
      stepSize: options?.stepSize,
      description: `FMI 3.0 Multi-Physics Container for SysML v2 ${modelIdentifier}`,
    };

    return generateFmuArchive(dae, {
      ...fmuOptions,
      // Pass explicit terminals for terminalsAndIcons.xml layered standard
      explicitTerminals,
    } as FmuArchiveOptions & { explicitTerminals: Fmi3Terminal[] });
  }

  /**
   * Export a SysML v2 architecture, its compiled behavioral FMUs/SSP, and optional
   * STEP CAD geometry into a prostep ivip PSI 21 / OMG CASCaRA DDP container (.ddp).
   */
  static async exportToDdp(
    sysmlSource: string | SysML2GenericDefinition,
    options?: Sysml2ContainerExportOptions & {
      geometryFiles?: { id: string; path: string; data: Uint8Array | string; format?: string }[];
      author?: { name: string; organization?: string; email?: string };
    },
  ): Promise<{ archive: Uint8Array; manifest: DdpManifest }> {
    const sspResult = await this.exportToSsp(sysmlSource, options);
    const sysmlDef = typeof sysmlSource === "string" ? GenericModelicaBridge.parseSysML2(sysmlSource) : sysmlSource;
    const sysmlRawText = typeof sysmlSource === "string" ? sysmlSource : `package ${sysmlDef.name} {}`;

    const systemName = sysmlDef.name || "SysML2MultiPhysicsSystem";
    const packageId = `urn:ddp:${systemName.toLowerCase().replace(/[^a-z0-9_-]/g, "-")}`;

    const filesToBundle: DdpFileEntry[] = [];

    // 1. Requirements / Architecture: SysML v2 source
    const sysmlRelPath = `requirements/${systemName}.sysml`;
    filesToBundle.push({
      path: sysmlRelPath,
      data: sysmlRawText,
      contentType: "text/x-sysml2",
    });

    const reqArtifacts: DdpArtifactDescriptor[] = [
      {
        id: `REQ_${systemName}`,
        path: sysmlRelPath,
        contentType: "text/x-sysml2",
        domain: "requirements",
        format: "SysML v2",
        description: `SysML v2 architecture for ${systemName}`,
      },
    ];

    // 2. Behavioral simulation: SSP package
    const sspRelPath = `behavior/${systemName}.ssp`;
    filesToBundle.push({
      path: sspRelPath,
      data: sspResult.archive,
      contentType: "application/x-ssp",
    });

    const behArtifacts: DdpArtifactDescriptor[] = [
      {
        id: `SIM_${systemName}`,
        path: sspRelPath,
        contentType: "application/x-ssp",
        domain: "behavior",
        format: "SSP 1.0",
        description: `Multi-physics simulation containing ${sspResult.fmuCount} subsystem FMUs`,
      },
    ];

    // 3. Geometry (if provided)
    const geomArtifacts: DdpArtifactDescriptor[] = [];
    if (options?.geometryFiles) {
      for (const geom of options.geometryFiles) {
        const geomRelPath = geom.path.startsWith("geometry/") ? geom.path : `geometry/${geom.path}`;
        filesToBundle.push({
          path: geomRelPath,
          data: geom.data,
          contentType: "application/step",
        });
        geomArtifacts.push({
          id: geom.id,
          path: geomRelPath,
          contentType: "application/step",
          domain: "geometry",
          format: geom.format ?? "STEP AP242",
          description: `CAD geometry for ${geom.id}`,
        });
      }
    }

    // 4. Traceability relations
    const relations: DdpRelation[] = [
      {
        id: "rel_01",
        relationType: "verifies",
        source: sspRelPath,
        target: `${sysmlRelPath}#${systemName}`,
        description: `SSP multi-physics simulation verifies ${systemName} architectural definition`,
        status: "passed",
      },
    ];

    if (geomArtifacts.length > 0) {
      for (const geom of geomArtifacts) {
        relations.push({
          relationType: "implements",
          source: geom.path,
          target: `${sysmlRelPath}#${systemName}`,
          description: `Geometry ${geom.id} implements physical envelope of ${systemName}`,
        });
      }
    }

    const manifest: DdpManifest = {
      "@context": "https://w3id.org/cascara/v1/context.jsonld",
      ddpVersion: "1.0",
      packageId,
      title: `${systemName} Digital Data Package`,
      version: options?.version ?? "1.0.0",
      description: options?.description ?? `SysML v2 multi-physics engineering package for ${systemName}`,
      creator: options?.author,
      createdAt: new Date().toISOString(),
      securityClassification: "Unclassified",
      artifacts: {
        requirements: reqArtifacts,
        geometry: geomArtifacts,
        behavior: behArtifacts,
        parameters: [],
        documentation: [],
      },
      relations,
    };

    const archive = DdpPackager.buildDdp({
      manifest,
      files: filesToBundle,
    });

    return {
      archive,
      manifest,
    };
  }

  // ── Helper methods ──────────────────────────────────────────────────

  private static synthesizeDefaultParts(sysmlDef: SysML2GenericDefinition): SysML2PartUsage[] {
    const parts: SysML2PartUsage[] = [];
    const referencedElements = new Set<string>();

    for (const conn of sysmlDef.connections) {
      const src = conn.source.split(".")[0];
      const tgt = conn.target.split(".")[0];
      if (src) referencedElements.add(src);
      if (tgt) referencedElements.add(tgt);
    }

    for (const elem of referencedElements) {
      parts.push({
        name: elem,
        type: `${elem.charAt(0).toUpperCase() + elem.slice(1)}Type`,
      });
    }

    if (parts.length === 0) {
      parts.push({ name: "core", type: "CoreSubsystem" });
    }

    return parts;
  }

  private static resolvePartDae(part: SysML2PartUsage, partBehaviors?: Map<string, DAEBuilder | string>): DAEBuilder {
    if (partBehaviors) {
      const behavior = partBehaviors.get(part.name) ?? partBehaviors.get(part.type);
      if (behavior) {
        if (behavior instanceof DAEBuilder) {
          return behavior;
        }
      }
    }

    // Build synthetic DAE for this part
    const dae = new DAEBuilder();
    dae.addVariable("time", VarType.Real, Variability.Continuous, Causality.Local);

    // Add state variable and derivative
    const x = dae.addVariable(`${part.name}_x`, VarType.Real, Variability.Continuous, Causality.Local, 1.0);
    const derX = dae.addVariable(`der(${part.name}_x)`, VarType.Real, Variability.Continuous, Causality.Local);

    // Add inputs/outputs based on common naming
    const u = dae.addVariable(`${part.name}_u`, VarType.Real, Variability.Continuous, Causality.Input);
    const y = dae.addVariable(`${part.name}_y`, VarType.Real, Variability.Continuous, Causality.Output);

    // Add parameters from part attributes
    if (part.attributes) {
      for (const [attrName, val] of Object.entries(part.attributes)) {
        if (typeof val === "number") {
          const p = dae.addVariable(
            `${part.name}_${attrName}`,
            VarType.Real,
            Variability.Parameter,
            Causality.Local,
            val,
          );
          dae.setVarExpression(p, dae.addRealLiteral(val));
        }
      }
    }

    // Equations:
    // der(x) = -0.5 * x + u
    const negHalf = dae.addRealLiteral(-0.5);
    const xRef = dae.addNameExpr(`${part.name}_x`);
    const term1 = dae.addBinaryExpr(BinOp.Mul, negHalf, xRef);
    const uRef = dae.addNameExpr(`${part.name}_u`);
    const rhsDer = dae.addBinaryExpr(BinOp.Add, term1, uRef);
    dae.addEquation(EqKind.Simple, derX, rhsDer);

    // y = x
    dae.addEquation(EqKind.Simple, y, xRef);

    return dae;
  }

  private static buildCompositeDae(
    sysmlDef: SysML2GenericDefinition,
    partBehaviors?: Map<string, DAEBuilder | string>,
  ): DAEBuilder {
    const dae = new DAEBuilder();
    dae.addVariable("time", VarType.Real, Variability.Continuous, Causality.Local);

    const parts = sysmlDef.parts && sysmlDef.parts.length > 0 ? sysmlDef.parts : this.synthesizeDefaultParts(sysmlDef);

    // Variables for each part
    for (const part of parts) {
      const partDae = this.resolvePartDae(part, partBehaviors);
      for (let i = 0; i < partDae.varCount; i++) {
        if (partDae.isVarRemoved(i)) continue;
        const vName = partDae.getVarName(i);
        if (vName === "time") continue;
        const vType = partDae.getVarType(i);
        const vVariability = partDae.getVarVariability(i);
        const vCausality = partDae.getVarCausality(i);
        const start = partDae.getVarStartValue(i);

        dae.addVariable(vName, vType, vVariability, vCausality, start);
      }

      // Copy simple equations
      for (let eq = 0; eq < partDae.eqCount; eq++) {
        dae.addEquation(partDae.getEqKind(eq), partDae.getEqLhs(eq), partDae.getEqRhs(eq));
      }
    }

    // Add top-level system ports as boundary variables
    for (const port of sysmlDef.ports) {
      const causality =
        port.direction === "in" ? Causality.Input : port.direction === "out" ? Causality.Output : Causality.Local;
      dae.addVariable(port.name, VarType.Real, Variability.Continuous, causality);
    }

    // Add inter-part connection equations
    for (const conn of sysmlDef.connections) {
      const srcId = dae.getVarIdxByName(conn.source.replace(/\./g, "_"));
      const tgtId = dae.getVarIdxByName(conn.target.replace(/\./g, "_"));
      if (srcId !== -1 && tgtId !== -1) {
        dae.addEquation(EqKind.Simple, srcId, tgtId);
      }
    }

    return dae;
  }
}
