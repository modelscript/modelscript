// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * SSP (System Structure and Parameterization) archive support for @modelscript/core.
 *
 * Provides utilities for parsing SSP archives to extract system boundary
 * information (inputs, outputs, parameters) that can be used to synthetically
 * generate Modelica variable declarations when an SSP system is instantiated
 * as a block in a Modelica model.
 *
 * An SSP system appears in Modelica source as:
 *   model MySystem
 *     annotation(external="SSP", file="system.ssp");
 *   end MySystem;
 *
 * The SspArchive class extracts the boundary connectors from the top-level
 * system and exposes them as typed variable descriptors for flattener use.
 */

import type { IModelicaModelVisitor, Scope } from "@modelscript/core";
import {
  ModelicaClassInstance,
  ModelicaComponentInstance,
  type ModelicaElement,
  type ModelicaNamedElement,
} from "@modelscript/core";
import { ModelicaCausality, ModelicaClassKind, type ModelicaIdentifierSyntaxNode } from "@modelscript/modelica-ast";
import { inflateRaw } from "pako";

/** Connector descriptor extracted from an SSP system boundary. */
export interface SspBoundaryVariable {
  /** Variable name (from the connector name). */
  name: string;
  /** FMI-style causality. */
  causality: "input" | "output" | "parameter";
  /** Data type. */
  type: "Real" | "Integer" | "Boolean" | "String";
  /** Start value (if defined in parameter bindings). */
  start?: number | string | boolean | undefined;
  /** Unit string (if defined). */
  unit?: string | undefined;
}

/** Parsed SSP archive metadata for compiler use. */
export interface SspArchiveMetadata {
  /** System name from SystemStructure.ssd. */
  systemName: string;
  /** System description. */
  description?: string | undefined;
  /** SSP version. */
  version: string;
  /** Boundary variables (inputs, outputs, parameters). */
  variables: SspBoundaryVariable[];
  /** Component names within the system. */
  componentNames: string[];
  /** Default experiment start time. */
  startTime?: number | undefined;
  /** Default experiment stop time. */
  stopTime?: number | undefined;
}

/**
 * Parse an SSP archive to extract system boundary metadata.
 *
 * This is a lightweight parser for compiler use — it extracts only the
 * top-level system boundary (connectors at the system level, not within
 * individual components).
 *
 * @param data Raw SSP archive bytes (Uint8Array, works in both browser and Node)
 * @returns Parsed SSP metadata, or null if the archive is invalid
 */
export function parseSspArchive(data: Uint8Array): SspArchiveMetadata | null {
  const ssdXml = extractFileFromZip(data, "SystemStructure.ssd");
  if (!ssdXml) return null;

  // Parse system name and version
  const version = extractAttr(ssdXml, "ssd:SystemStructureDescription", "version") ?? "1.0";

  // Extract the <ssd:System> element
  const systemMatch = ssdXml.match(/<ssd:System\s+([^>]*)>([\s\S]*?)<\/ssd:System>/);
  if (!systemMatch) return null;

  const systemAttrs = systemMatch[1] ?? "";
  const systemBody = systemMatch[2] ?? "";
  const systemName = extractAttrStr(systemAttrs, "name") ?? "System";
  const description = extractAttrStr(systemAttrs, "description");

  // Extract system-level connectors (boundary variables)
  const variables = extractSystemConnectors(systemBody);

  // Extract component names
  const componentNames: string[] = [];
  const compRegex = /<ssd:Component\s+([^>]*)/g;
  let compMatch: RegExpExecArray | null;
  while ((compMatch = compRegex.exec(systemBody)) !== null) {
    const name = extractAttrStr(compMatch[1] ?? "", "name");
    if (name) componentNames.push(name);
  }

  // Default experiment
  let startTime: number | undefined;
  let stopTime: number | undefined;
  const expMatch = ssdXml.match(/<ssd:DefaultExperiment\s+([^>]*)\/?>/);
  if (expMatch) {
    const startStr = extractAttrStr(expMatch[1] ?? "", "startTime");
    const stopStr = extractAttrStr(expMatch[1] ?? "", "stopTime");
    if (startStr) startTime = parseFloat(startStr);
    if (stopStr) stopTime = parseFloat(stopStr);
  }

  return {
    systemName,
    description,
    version,
    variables,
    componentNames,
    startTime,
    stopTime,
  };
}

/**
 * Generate a Modelica-compatible model description XML fragment
 * for an SSP system (for use as an FMI-like wrapper).
 */
export function generateSspModelDescriptionXml(metadata: SspArchiveMetadata): string {
  const lines: string[] = [];

  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<fmiModelDescription`);
  lines.push(`  fmiVersion="2.0"`);
  lines.push(`  modelName="${escapeXml(metadata.systemName)}"`);
  lines.push(`  guid="ssp-${escapeXml(metadata.systemName)}"`);
  lines.push(`  generationTool="ModelScript SSP"`);
  if (metadata.description) {
    lines.push(`  description="${escapeXml(metadata.description)}"`);
  }
  lines.push(`>`);
  lines.push(`  <CoSimulation modelIdentifier="${escapeXml(metadata.systemName)}" />`);

  if (metadata.startTime !== undefined || metadata.stopTime !== undefined) {
    const parts = [`  <DefaultExperiment`];
    if (metadata.startTime !== undefined) parts.push(` startTime="${metadata.startTime}"`);
    if (metadata.stopTime !== undefined) parts.push(` stopTime="${metadata.stopTime}"`);
    parts.push(` />`);
    lines.push(parts.join(""));
  }

  lines.push(`  <ModelVariables>`);
  let vr = 0;
  for (const v of metadata.variables) {
    lines.push(
      `    <ScalarVariable name="${escapeXml(v.name)}" valueReference="${vr}" causality="${v.causality}" variability="continuous">`,
    );
    const typeTag =
      v.type === "Real" ? "Real" : v.type === "Integer" ? "Integer" : v.type === "Boolean" ? "Boolean" : "String";
    const attrs: string[] = [];
    if (v.start !== undefined) attrs.push(`start="${v.start}"`);
    if (v.unit) attrs.push(`unit="${escapeXml(v.unit)}"`);
    lines.push(`      <${typeTag}${attrs.length > 0 ? " " + attrs.join(" ") : ""} />`);
    lines.push(`    </ScalarVariable>`);
    vr++;
  }
  lines.push(`  </ModelVariables>`);

  lines.push(`  <ModelStructure>`);
  const outputIndices = metadata.variables.map((v, i) => (v.causality === "output" ? i + 1 : -1)).filter((i) => i >= 0);
  if (outputIndices.length > 0) {
    lines.push(`    <Outputs>`);
    for (const idx of outputIndices) {
      lines.push(`      <Unknown index="${idx}" />`);
    }
    lines.push(`    </Outputs>`);
  }
  lines.push(`  </ModelStructure>`);

  lines.push(`</fmiModelDescription>`);
  return lines.join("\n") + "\n";
}

// ── Internal helpers ────────────────────────────────────────────────

function extractSystemConnectors(systemBody: string): SspBoundaryVariable[] {
  const variables: SspBoundaryVariable[] = [];

  // System-level connectors are directly under <ssd:System>, not within <ssd:Elements>
  // Look for <ssd:Connectors> block that is NOT inside a <ssd:Component>
  // Simple approach: find connectors before <ssd:Elements>
  const elementsIdx = systemBody.indexOf("<ssd:Elements>");
  const connectorsBlock = elementsIdx >= 0 ? systemBody.substring(0, elementsIdx) : systemBody;

  const connectorsMatch = connectorsBlock.match(/<ssd:Connectors>([\s\S]*?)<\/ssd:Connectors>/);
  if (!connectorsMatch) return variables;

  const connectorsBody = connectorsMatch[1] ?? "";
  const connRegex = /<ssd:Connector\s+([^>]*)>([\s\S]*?)<\/ssd:Connector>|<ssd:Connector\s+([^>]*)\/?>/g;
  let match: RegExpExecArray | null;

  while ((match = connRegex.exec(connectorsBody)) !== null) {
    const attrs = match[1] ?? match[3] ?? "";
    const body = match[2] ?? "";

    const name = extractAttrStr(attrs, "name") ?? "";
    const kind = extractAttrStr(attrs, "kind") ?? "input";

    let type: SspBoundaryVariable["type"] = "Real";
    let unit: string | undefined;

    if (body.match(/<ssc:Real/)) {
      type = "Real";
      const realMatch = body.match(/<ssc:Real\s+([^>]*)\/?>/);
      if (realMatch) unit = extractAttrStr(realMatch[1] ?? "", "unit");
    } else if (body.match(/<ssc:Integer/)) {
      type = "Integer";
    } else if (body.match(/<ssc:Boolean/)) {
      type = "Boolean";
    } else if (body.match(/<ssc:String/)) {
      type = "String";
    }

    const causality = kind === "output" ? "output" : kind === "parameter" ? "parameter" : "input";
    const variable: SspBoundaryVariable = { name, causality, type };
    if (unit) variable.unit = unit;
    variables.push(variable);
  }

  return variables;
}

/** Extract a text file from a ZIP archive (browser/Node compatible via Uint8Array). */
function extractFileFromZip(zipData: Uint8Array, targetName: string): string | null {
  const view = new DataView(zipData.buffer, zipData.byteOffset, zipData.byteLength);

  // Find EOCD
  let eocdOffset = -1;
  for (let i = zipData.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) return null;

  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const cdSize = view.getUint32(eocdOffset + 12, true);
  const cdEnd = cdOffset + cdSize;

  let pos = cdOffset;
  while (pos < cdEnd) {
    if (view.getUint32(pos, true) !== 0x02014b50) break;

    const compressionMethod = view.getUint16(pos + 10, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const fileNameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    const localHeaderOffset = view.getUint32(pos + 42, true);
    const fileName = new TextDecoder().decode(zipData.subarray(pos + 46, pos + 46 + fileNameLength));

    if (fileName === targetName) {
      const localPos = localHeaderOffset;
      if (view.getUint32(localPos, true) !== 0x04034b50) return null;

      const localFileNameLen = view.getUint16(localPos + 26, true);
      const localExtraLen = view.getUint16(localPos + 28, true);
      const dataStart = localPos + 30 + localFileNameLen + localExtraLen;
      const compressed = zipData.subarray(dataStart, dataStart + compressedSize);

      if (compressionMethod === 0) {
        return new TextDecoder().decode(compressed);
      } else if (compressionMethod === 8) {
        try {
          const inflated = inflateRaw(compressed);
          return new TextDecoder().decode(inflated);
        } catch {
          return null;
        }
      }
      return null;
    }

    pos += 46 + fileNameLength + extraLength + commentLength;
  }

  return null;
}

function extractAttr(xml: string, element: string, attr: string): string | undefined {
  const escapedElement = element.replace(/\./g, "\\.");
  const elemMatch = xml.match(new RegExp(`<${escapedElement}\\s+([^>]*)>`, "s"));
  if (!elemMatch) return undefined;
  return extractAttrStr(elemMatch[1] ?? "", attr);
}

function extractAttrStr(attrs: string, attr: string): string | undefined {
  const match = attrs.match(new RegExp(`${attr}\\s*=\\s*"([^"]*)"`, "s"));
  return match ? (match[1] ?? undefined) : undefined;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ── ModelicaSspEntity ──

/**
 * A Modelica class instance backed by an SSP archive.
 *
 * Acts as a `block` with input/output connectors derived from the SSP
 * system's boundary connectors. The instantiation creates synthetic
 * `ModelicaComponentInstance` objects for each boundary variable, so that
 * other Modelica models can reference them via normal name resolution.
 *
 * Analogous to `ModelicaFmuEntity` in `fmu.ts`.
 */
export class ModelicaSspEntity extends ModelicaClassInstance {
  /** Path to the SSP archive or identifier. */
  sspPath: string;
  /** Parsed SSP metadata. */
  metadata: SspArchiveMetadata | null = null;
  /** Synthetic component instances created during instantiation. */
  #syntheticComponents: ModelicaComponentInstance[] = [];
  #loaded = false;

  constructor(parent: Scope, path: string, metadata?: SspArchiveMetadata) {
    super(parent);
    this.sspPath = path;
    this.classKind = ModelicaClassKind.BLOCK;
    if (metadata) {
      this.metadata = metadata;
      this.#loaded = true;
    }
  }

  /** Create from raw SSP archive bytes. */
  static fromSsp(parent: Scope, name: string, sspBytes: Uint8Array): ModelicaSspEntity {
    const metadata = parseSspArchive(sspBytes);
    if (!metadata) {
      throw new Error(`Invalid SSP archive: SystemStructure.ssd not found in '${name}.ssp'`);
    }
    const entity = new ModelicaSspEntity(parent, `__ssp__:${name}`, metadata);
    entity.name = name;
    return entity;
  }

  /** Create from pre-parsed metadata (testing/programmatic use). */
  static fromMetadata(parent: Scope, name: string, metadata: SspArchiveMetadata): ModelicaSspEntity {
    const entity = new ModelicaSspEntity(parent, `__ssp__:${name}`, metadata);
    entity.name = name;
    return entity;
  }

  override accept<R, A>(visitor: IModelicaModelVisitor<R, A>, argument?: A): R {
    return visitor.visitClassInstance(this, argument);
  }

  override clone(): ModelicaClassInstance {
    if (!this.#loaded) this.load();
    const cloned = new ModelicaSspEntity(this.parent ?? this, this.sspPath, this.metadata ?? undefined);
    cloned.name = this.name;
    cloned.#loaded = true;
    cloned.instantiate();
    return cloned;
  }

  override get elements(): IterableIterator<ModelicaElement> {
    if (!this.instantiated && !this.instantiating) this.instantiate();
    const components = this.#syntheticComponents;
    return (function* () {
      yield* components;
    })();
  }

  override resolveSimpleName(
    identifier: ModelicaIdentifierSyntaxNode | string | null | undefined,
    global = false,
    encapsulated = false,
  ): ModelicaNamedElement | null {
    const simpleName = typeof identifier === "string" ? identifier : identifier?.text;
    if (!simpleName) return null;
    if (!this.instantiated && !this.instantiating) this.instantiate();

    for (const comp of this.#syntheticComponents) {
      if (comp.name === simpleName) return comp;
    }

    return super.resolveSimpleName(identifier, global, encapsulated);
  }

  override annotation<T>(name: string, annotations?: ModelicaNamedElement[] | null): T | null {
    if ((name === "Icon" || name === "Diagram") && (!annotations || annotations === this.annotations)) {
      if (!this.#loaded) this.load();
      return {
        "@type": name,
        coordinateSystem: {
          extent: [
            [-100, -100],
            [100, 100],
          ],
          preserveAspectRatio: true,
          initialScale: 0.1,
          "@type": "CoordinateSystem",
        },
        graphics: this.#buildSspGraphics(),
      } as unknown as T;
    }
    return super.annotation(name, annotations);
  }

  override instantiate(): void {
    if (this.instantiated) return;
    if (this.instantiating) return;
    this.instantiating = true;
    try {
      if (!this.#loaded) this.load();
      this.declaredElements = [];
      this.#syntheticComponents = [];

      if (!this.metadata) return;

      const types = {
        Real: this.root?.resolveSimpleName("Real") as ModelicaClassInstance | null,
        Integer: this.root?.resolveSimpleName("Integer") as ModelicaClassInstance | null,
        Boolean: this.root?.resolveSimpleName("Boolean") as ModelicaClassInstance | null,
        String: this.root?.resolveSimpleName("String") as ModelicaClassInstance | null,
      };

      const inputs = this.metadata.variables.filter((v) => v.causality === "input");
      const outputs = this.metadata.variables.filter((v) => v.causality === "output");
      const params = this.metadata.variables.filter((v) => v.causality === "parameter");

      let inputCount = 0;
      let outputCount = 0;

      for (const v of [...inputs, ...outputs, ...params]) {
        const comp = new ModelicaComponentInstance(this, null);
        comp.name = v.name;
        comp.description = null;

        const isInput = v.causality === "input";
        const isOutput = v.causality === "output";
        if (isInput) comp.causality = ModelicaCausality.INPUT;
        else if (isOutput) comp.causality = ModelicaCausality.OUTPUT;

        const baseType = types[v.type as keyof typeof types];

        if (isInput || isOutput) {
          // Create synthetic CONNECTOR type for diagram rendering
          if (baseType) {
            const connector = baseType.clone();
            connector.classKind = ModelicaClassKind.CONNECTOR;
            connector.declaredElements = [];
            comp.classInstance = connector;
          } else {
            const connector = new ModelicaClassInstance(this);
            connector.classKind = ModelicaClassKind.CONNECTOR;
            connector.name = isInput ? `${v.type}Input` : `${v.type}Output`;
            connector.instantiated = true;
            connector.declaredElements = [];
            comp.classInstance = connector;
          }

          // Calculate port placement
          let y = 0;
          if (isInput) {
            y = 100 - ((inputCount + 1) * 200) / (inputs.length + 1);
            inputCount++;
          } else {
            y = 100 - ((outputCount + 1) * 200) / (outputs.length + 1);
            outputCount++;
          }

          const extent: [[number, number], [number, number]] = isInput
            ? [
                [-120, y - 10],
                [-100, y + 10],
              ]
            : [
                [100, y - 10],
                [120, y + 10],
              ];

          comp.annotation = function <T2>(aName: string, anns?: ModelicaNamedElement[] | null): T2 | null {
            if (aName === "Placement" && (!anns || anns === this.annotations)) {
              return {
                "@type": "Placement",
                visible: true,
                transformation: { extent, rotation: 0, origin: [0, 0], "@type": "Transformation" },
                iconTransformation: { extent, rotation: 0, origin: [0, 0], "@type": "Transformation" },
              } as unknown as T2;
            }
            return ModelicaComponentInstance.prototype.annotation.call(this, aName, anns) as T2 | null;
          };
        } else if (baseType) {
          comp.classInstance = baseType.clone();
        }

        comp.instantiated = true;
        this.#syntheticComponents.push(comp);
        this.declaredElements.push(comp);
      }

      this.instantiated = true;
    } finally {
      this.instantiating = false;
    }
  }

  /** Read and parse the SSP archive from filesystem. */
  load(): void {
    if (this.#loaded) return;
    this.#loaded = true;

    if (this.metadata) return;

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let node: Scope | undefined | null = this;
    while (node && !("context" in node)) {
      node = node.parent;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const context: any = node && "context" in node ? (node as unknown as { context: unknown }).context : null;
    if (context) {
      try {
        const data = context.fs.readBinary(this.sspPath);
        this.metadata = parseSspArchive(data);
        if (this.metadata && !this.name) {
          this.name = this.metadata.systemName;
        }
      } catch {
        console.warn(`[ModelicaSspEntity] Failed to read SSP archive: ${this.sspPath}`);
      }
    }
  }

  /** Build the graphics array for Icon/Diagram annotations. */
  #buildSspGraphics(): unknown[] {
    const graphics: unknown[] = [
      {
        visible: true,
        origin: [0, 0],
        rotation: 0,
        lineColor: [0, 128, 0],
        fillColor: [255, 255, 255],
        pattern: "Solid",
        lineThickness: 0.5,
        borderPattern: "None",
        extent: [
          [-100, -100],
          [100, 100],
        ],
        radius: 0,
        "@type": "Rectangle",
      },
      {
        visible: true,
        origin: [0, 0],
        rotation: 0,
        extent: [
          [-80, 80],
          [80, 60],
        ],
        textString: "SSP",
        fontSize: 14,
        textStyle: ["Bold"],
        textColor: [0, 128, 0],
        horizontalAlignment: "Center",
        "@type": "Text",
      },
      {
        visible: true,
        origin: [0, 0],
        rotation: 0,
        extent: [
          [-100, 20],
          [100, -20],
        ],
        textString: "%name",
        fontSize: 0,
        textStyle: [],
        textColor: [0, 0, 0],
        horizontalAlignment: "Center",
        "@type": "Text",
      },
    ];

    if (!this.metadata) return graphics;

    const inputs = this.metadata.variables.filter((v) => v.causality === "input");
    const outputs = this.metadata.variables.filter((v) => v.causality === "output");

    for (let i = 0; i < inputs.length; i++) {
      const y = 100 - ((i + 1) * 200) / (inputs.length + 1);
      graphics.push({
        visible: true,
        origin: [0, 0],
        rotation: 0,
        extent: [
          [-98, y - 8],
          [-30, y + 8],
        ],
        textString: inputs[i]?.name ?? "",
        fontSize: 0,
        textStyle: [],
        textColor: [0, 0, 0],
        horizontalAlignment: "Left",
        "@type": "Text",
      });
    }

    for (let i = 0; i < outputs.length; i++) {
      const y = 100 - ((i + 1) * 200) / (outputs.length + 1);
      graphics.push({
        visible: true,
        origin: [0, 0],
        rotation: 0,
        extent: [
          [30, y - 8],
          [98, y + 8],
        ],
        textString: outputs[i]?.name ?? "",
        fontSize: 0,
        textStyle: [],
        textColor: [0, 0, 0],
        horizontalAlignment: "Right",
        "@type": "Text",
      });
    }

    return graphics;
  }
}
