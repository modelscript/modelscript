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
import {
  BinOp,
  Causality,
  DAEBuilder,
  EqKind,
  ExprKind,
  initBltWasm,
  Variability,
  VarType,
} from "@modelscript/runtime";
import {
  GenericModelicaBridge,
  type SysML2GenericDefinition,
  type SysML2PartUsage,
} from "../transformers/generic-modelica-bridge.js";
import { collectCstLeaves, parseSysmlSource, type CstLeaf } from "./cst-utils.js";
import { parseSysML2Expression, type SysML2ExprAst } from "./evaluator.js";

export type { SspSystem };

/** Options for SysML v2 container export. */
export interface Sysml2ContainerExportOptions extends SspExportOptions {
  /** Target SSP version (default "1.0"). */
  version?: string | undefined;
  /** System description text. */
  description?: string | undefined;
  /** Target FMI version for internal or monolithic FMUs ("2" | "3" | "both", default "3"). */
  fmiVersion?: "2" | "3" | "both" | undefined;
  /** Include C sources in FMUs (default true). */
  includeSources?: boolean | undefined;
  /** Include WASM binary / source in FMUs (default true). */
  includeWasm?: boolean | undefined;
  /** Custom modelica implementations or pre-built DAEs for parts (partTypeName -> DAEBuilder | string). */
  partBehaviors?: Map<string, DAEBuilder | string> | undefined;
  /** Default experiment start time. */
  startTime?: number | undefined;
  /** Default experiment stop time. */
  stopTime?: number | undefined;
  /** Default experiment step size. */
  stepSize?: number | undefined;
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
        const portVarIdx = dae.getVarIdxByName(port.name);
        memberVars.push({
          variableName: port.name,
          valueReference: portVarIdx >= 0 ? portVarIdx : 0,
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
      geometryFiles?:
        | { id: string; path: string; data: Uint8Array | string; format?: string | undefined }[]
        | undefined;
      author?: { name: string; organization?: string | undefined; email?: string | undefined } | undefined;
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

  private static parseBehaviorStringToDae(part: SysML2PartUsage, behaviorText: string): DAEBuilder {
    const dae = new DAEBuilder();
    dae.addVariable("time", VarType.Real, Variability.Continuous, Causality.Local);

    const ensureVar = (
      rawName: string,
      variability: Variability = Variability.Continuous,
      causality: Causality = Causality.Local,
      startVal?: number,
    ): number => {
      const existing = dae.getVarIdxByName(rawName);
      if (existing !== -1) return existing;
      return dae.addVariable(rawName, VarType.Real, variability, causality, startVal);
    };

    if (part.attributes) {
      for (const [attrName, val] of Object.entries(part.attributes)) {
        if (typeof val === "number") {
          const p = ensureVar(`${part.name}_${attrName}`, Variability.Parameter, Causality.Local, val);
          dae.setVarExpression(p, dae.addRealLiteral(val));
        }
      }
    }

    const inputSuffixes = new Set(["u", "in", "input", "cmd"]);
    const outputSuffixes = new Set(["y", "out", "output"]);
    const hasSignalSuffix = (varName: string, suffixes: ReadonlySet<string>): boolean => {
      const lower = varName.toLowerCase();
      if (suffixes.has(lower)) return true;
      const usIdx = lower.lastIndexOf("_");
      return usIdx !== -1 && suffixes.has(lower.slice(usIdx + 1));
    };

    const lowerExprAst = (node: SysML2ExprAst): number => {
      switch (node.kind) {
        case "NumberLiteral":
          return dae.addRealLiteral(node.value);
        case "BooleanLiteral":
          return dae.addRealLiteral(node.value ? 1.0 : 0.0);
        case "UnaryExpr":
          return node.op === "-"
            ? dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), lowerExprAst(node.operand))
            : lowerExprAst(node.operand);
        case "BinaryExpr": {
          const left = lowerExprAst(node.left);
          const right = lowerExprAst(node.right);
          const binOp =
            node.op === "+"
              ? BinOp.Add
              : node.op === "-"
                ? BinOp.Sub
                : node.op === "*"
                  ? BinOp.Mul
                  : node.op === "/"
                    ? BinOp.Div
                    : node.op === "^"
                      ? BinOp.Pow
                      : undefined;
          return binOp !== undefined ? dae.addBinaryExpr(binOp, left, right) : dae.addRealLiteral(0);
        }
        case "CallExpr":
          if (node.callee === "der" && node.args[0]?.kind === "Identifier") {
            const rawArg = node.args[0].name;
            const base = rawArg.includes(part.name) ? rawArg : `${part.name}_${rawArg}`;
            ensureVar(base, Variability.Continuous, Causality.Local, 1.0);
            ensureVar(`der(${base})`, Variability.Continuous, Causality.Local);
            return dae.addNameExpr(`der(${base})`);
          }
          return dae.addRealLiteral(0);
        case "Identifier": {
          const s = node.name;
          const varName = s === "time" || s.startsWith(`${part.name}_`) ? s : `${part.name}_${s}`;
          const isInput = hasSignalSuffix(varName, inputSuffixes);
          const isOutput = hasSignalSuffix(varName, outputSuffixes);
          ensureVar(
            varName,
            Variability.Continuous,
            isInput ? Causality.Input : isOutput ? Causality.Output : Causality.Local,
          );
          return dae.addNameExpr(varName);
        }
        default:
          return dae.addRealLiteral(0);
      }
    };

    const parseSimpleExpr = (exprStr: string): number => {
      const s = exprStr.trim();
      if (!s) return dae.addRealLiteral(0);
      return lowerExprAst(parseSysML2Expression(s));
    };

    const root = parseSysmlSource(behaviorText);
    const leaves = root ? collectCstLeaves(root) : [];
    const stmts: CstLeaf[][] = [];
    let curStmt: CstLeaf[] = [];
    let parenDepth = 0;
    let braceDepth = 0;
    for (let i = 0; i < leaves.length; i++) {
      const lf = leaves[i]!;
      const prev = i > 0 ? leaves[i - 1]! : undefined;
      if (parenDepth === 0 && braceDepth === 0 && prev && behaviorText.slice(prev.end, lf.start).includes("\n")) {
        if (curStmt.length > 0) {
          stmts.push(curStmt);
          curStmt = [];
        }
      }
      if (lf.text === "(") parenDepth++;
      else if (lf.text === ")") parenDepth = Math.max(0, parenDepth - 1);
      else if (lf.text === "{") braceDepth++;
      else if (lf.text === "}") braceDepth = Math.max(0, braceDepth - 1);

      if (lf.text === ";" && parenDepth === 0 && braceDepth === 0) {
        if (curStmt.length > 0) {
          stmts.push(curStmt);
          curStmt = [];
        }
        continue;
      }
      curStmt.push(lf);
    }
    if (curStmt.length > 0) stmts.push(curStmt);

    for (const stmtLeaves of stmts) {
      if (stmtLeaves.length === 0) continue;
      const kw = stmtLeaves[0]!.text.toLowerCase();

      if ((kw === "parameter" || kw === "attribute" || kw === "const") && stmtLeaves.length >= 4) {
        let nameIdx = 1;
        if (stmtLeaves[nameIdx]?.text === "Real" && stmtLeaves.length >= 5) nameIdx++;
        if (stmtLeaves[nameIdx + 1]?.text === "=") {
          const rawName = stmtLeaves[nameIdx]!.text;
          const rhsStr = behaviorText.slice(stmtLeaves[nameIdx + 2]!.start, stmtLeaves[stmtLeaves.length - 1]!.end);
          const rhsAst = parseSysML2Expression(rhsStr);
          const val =
            rhsAst.kind === "NumberLiteral"
              ? rhsAst.value
              : rhsAst.kind === "UnaryExpr" && rhsAst.operand.kind === "NumberLiteral"
                ? rhsAst.op === "-"
                  ? -rhsAst.operand.value
                  : rhsAst.operand.value
                : parseFloat(rhsStr);
          if (Number.isFinite(val)) {
            const pName = rawName.startsWith(`${part.name}_`) ? rawName : `${part.name}_${rawName}`;
            const pIdx = ensureVar(pName, Variability.Parameter, Causality.Local, val);
            dae.setVarExpression(pIdx, dae.addRealLiteral(val));
            continue;
          }
        }
      }

      if (
        (kw === "input" || kw === "output") &&
        (stmtLeaves.length === 2 || (stmtLeaves.length === 3 && stmtLeaves[1]?.text === "Real"))
      ) {
        const causality = kw === "input" ? Causality.Input : Causality.Output;
        const rawVar = stmtLeaves[stmtLeaves.length - 1]!.text;
        const vName = rawVar.startsWith(`${part.name}_`) ? rawVar : `${part.name}_${rawVar}`;
        ensureVar(vName, Variability.Continuous, causality);
        continue;
      }

      let eqLeafIdx = -1;
      for (let i = 1; i + 1 < stmtLeaves.length; i++) {
        const lf = stmtLeaves[i]!;
        if (lf.text !== "=") continue;
        const prev = stmtLeaves[i - 1]!;
        const next = stmtLeaves[i + 1]!;
        const gluedPrev =
          prev.end === lf.start &&
          (prev.text === "<" || prev.text === ">" || prev.text === ":" || prev.text === "!" || prev.text === "=");
        const gluedNext = lf.end === next.start && next.text === "=";
        if (!gluedPrev && !gluedNext) {
          eqLeafIdx = i;
          break;
        }
      }
      if (eqLeafIdx > 0) {
        const lhsStr = behaviorText.slice(stmtLeaves[0]!.start, stmtLeaves[eqLeafIdx - 1]!.end).trim();
        const rhsStr = behaviorText
          .slice(stmtLeaves[eqLeafIdx + 1]!.start, stmtLeaves[stmtLeaves.length - 1]!.end)
          .trim();
        const lhsExpr = parseSimpleExpr(lhsStr);
        const rhsExpr = parseSimpleExpr(rhsStr);
        dae.addEquation(EqKind.Simple, lhsExpr, rhsExpr);
      }
    }

    return dae;
  }

  private static resolvePartDae(part: SysML2PartUsage, partBehaviors?: Map<string, DAEBuilder | string>): DAEBuilder {
    if (partBehaviors) {
      const behavior = partBehaviors.get(part.name) ?? partBehaviors.get(part.type);
      if (behavior) {
        if (behavior instanceof DAEBuilder) {
          return behavior;
        }
        if (typeof behavior === "string" && behavior.trim().length > 0) {
          return this.parseBehaviorStringToDae(part, behavior);
        }
      }
    }

    // Build default 1st-order DAE for this part
    const dae = new DAEBuilder();
    dae.addVariable("time", VarType.Real, Variability.Continuous, Causality.Local);

    // Add state variable and derivative
    dae.addVariable(`${part.name}_x`, VarType.Real, Variability.Continuous, Causality.Local, 1.0);
    dae.addVariable(`der(${part.name}_x)`, VarType.Real, Variability.Continuous, Causality.Local);

    // Add inputs/outputs based on common naming
    dae.addVariable(`${part.name}_u`, VarType.Real, Variability.Continuous, Causality.Input);
    dae.addVariable(`${part.name}_y`, VarType.Real, Variability.Continuous, Causality.Output);

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
    dae.addEquation(EqKind.Simple, dae.addNameExpr(`der(${part.name}_x)`), rhsDer);

    // y = x
    dae.addEquation(EqKind.Simple, dae.addNameExpr(`${part.name}_y`), xRef);

    return dae;
  }

  private static cloneExprIntoDae(srcDae: DAEBuilder, dstDae: DAEBuilder, exprId: number, prefix: string): number {
    const kind = srcDae.getExprKind(exprId);
    const d1 = srcDae.getExprData1(exprId);
    const left = srcDae.getExprLeft(exprId);
    const right = srcDae.getExprRight(exprId);

    switch (kind) {
      case ExprKind.RealLiteral:
        return dstDae.addRealLiteral(srcDae.getExprRealValue(exprId));
      case ExprKind.IntLiteral:
        return dstDae.addIntLiteral(d1);
      case ExprKind.BoolLiteral:
        return dstDae.addBoolLiteral(d1 !== 0);
      case ExprKind.Name: {
        const rawName = srcDae.interner.resolve(d1) || "";
        const qualified =
          rawName === "time" || rawName.startsWith(`${prefix}_`) || rawName.startsWith(`der(${prefix}_`)
            ? rawName
            : rawName.startsWith("der(") && rawName.endsWith(")")
              ? `der(${prefix}_${rawName.slice(4, -1)})`
              : `${prefix}_${rawName}`;
        return dstDae.addNameExpr(qualified);
      }
      case ExprKind.Der: {
        const innerId = this.cloneExprIntoDae(srcDae, dstDae, d1, prefix);
        return dstDae.addDerExpr(innerId);
      }
      case ExprKind.Negate:
      case ExprKind.Unary: {
        const innerId = this.cloneExprIntoDae(srcDae, dstDae, d1, prefix);
        return dstDae.addUnaryExpr(1, innerId);
      }
      case ExprKind.Binary: {
        const lId = this.cloneExprIntoDae(srcDae, dstDae, left, prefix);
        const rId = this.cloneExprIntoDae(srcDae, dstDae, right, prefix);
        return dstDae.addBinaryExpr((d1 as BinOp) ?? BinOp.Add, lId, rId);
      }
      default:
        return dstDae.addRealLiteral(0);
    }
  }

  private static buildCompositeDae(
    sysmlDef: SysML2GenericDefinition,
    partBehaviors?: Map<string, DAEBuilder | string>,
  ): DAEBuilder {
    const dae = new DAEBuilder();
    dae.addVariable("time", VarType.Real, Variability.Continuous, Causality.Local);

    const parts = sysmlDef.parts && sysmlDef.parts.length > 0 ? sysmlDef.parts : this.synthesizeDefaultParts(sysmlDef);

    // Build variables and equations for each part in composite DAE, honoring partBehaviors when provided
    for (const part of parts) {
      const partDae = this.resolvePartDae(part, partBehaviors);

      for (let vIdx = 0; vIdx < partDae.varCount; vIdx++) {
        const rawName = partDae.getVarName(vIdx);
        if (rawName === "time") continue;
        const qualifiedName =
          rawName.startsWith(`${part.name}_`) || rawName.startsWith(`der(${part.name}_`)
            ? rawName
            : rawName.startsWith("der(") && rawName.endsWith(")")
              ? `der(${part.name}_${rawName.slice(4, -1)})`
              : `${part.name}_${rawName}`;

        if (dae.getVarIdxByName(qualifiedName) === -1) {
          const vType = partDae.getVarType(vIdx);
          const variability = partDae.getVarVariability(vIdx);
          const causality = partDae.getVarCausality(vIdx);
          const startVal = partDae.getVarStartValue(vIdx);
          const newVarIdx = dae.addVariable(
            qualifiedName,
            vType,
            variability,
            causality,
            Number.isFinite(startVal) ? startVal : undefined,
          );
          const bindingExpr = partDae.getVarExpression(vIdx);
          if (bindingExpr !== undefined && bindingExpr !== -1) {
            const clonedBinding = this.cloneExprIntoDae(partDae, dae, bindingExpr, part.name);
            dae.setVarExpression(newVarIdx, clonedBinding);
          }
        }
      }

      for (let eqIdx = 0; eqIdx < partDae.eqCount; eqIdx++) {
        const eqKind = partDae.getEqKind(eqIdx);
        const lhs = this.cloneExprIntoDae(partDae, dae, partDae.getEqLhs(eqIdx), part.name);
        const rhs = this.cloneExprIntoDae(partDae, dae, partDae.getEqRhs(eqIdx), part.name);
        dae.addEquation(eqKind, lhs, rhs);
      }
    }

    // Add top-level system ports as boundary variables
    for (const port of sysmlDef.ports) {
      const causality =
        port.direction === "in" ? Causality.Input : port.direction === "out" ? Causality.Output : Causality.Local;
      if (dae.getVarIdxByName(port.name) === -1) {
        dae.addVariable(port.name, VarType.Real, Variability.Continuous, causality);
      }
    }

    // Add inter-part connection equations
    for (const conn of sysmlDef.connections) {
      const srcName = conn.source.replaceAll(".", "_");
      const tgtName = conn.target.replaceAll(".", "_");
      const srcId = dae.getVarIdxByName(srcName);
      const tgtId = dae.getVarIdxByName(tgtName);
      if (srcId !== -1 && tgtId !== -1) {
        dae.addEquation(EqKind.Simple, dae.addNameExpr(srcName), dae.addNameExpr(tgtName));
      }
    }

    return dae;
  }
}
