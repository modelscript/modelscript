// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * FMU (Functional Mock-up Interface) entity support.
 *
 * When an FMI 2.0 `.fmu` archive is found in the workspace, it is
 * represented as a `ModelicaFmuEntity` — a specialization of
 * `ModelicaClassInstance` that exposes FMU scalar variables as synthetic
 * Modelica component instances.  This lets other Modelica models reference
 * FMU participants seamlessly via normal name resolution and `connect`
 * equations.
 *
 * The entity reads `modelDescription.xml` directly from the `.fmu` ZIP
 * archive, so no separate XML file is needed.
 */

import { ModelicaCausality, ModelicaClassKind, type ModelicaIdentifierSyntaxNode } from "@modelscript/modelica-ast";
import { inflateRaw } from "pako";
import type { Scope } from "../scope.js";
import type { IModelicaModelVisitor } from "./model.js";
import {
  ModelicaClassInstance,
  ModelicaComponentInstance,
  type ModelicaElement,
  type ModelicaNamedElement,
} from "./model.js";

// ── FMU model description types ──

interface FmuScalarVariable {
  name: string;
  causality: "input" | "output" | "local" | "parameter" | "calculatedParameter" | "independent";
  variability: "continuous" | "discrete" | "fixed" | "tunable" | "constant";
  description: string;
  type: "Real" | "Integer" | "Boolean" | "String" | "Enumeration";
  start?: number | boolean | string;
}

// ── XML parsing ──

/**
 * Parse scalar variables from an FMI 2.0 `modelDescription.xml` string.
 * Uses lightweight regex matching — no DOM parser required.
 */
function parseFmuModelDescription(xml: string): {
  modelName: string;
  description: string;
  variables: FmuScalarVariable[];
} {
  // Extract modelName
  const nameMatch = xml.match(/modelName\s*=\s*"([^"]*)"/);
  const modelName = nameMatch?.[1] ?? "FMU";

  // Extract top-level description
  const descMatch = xml.match(/<fmiModelDescription[^>]*\bdescription\s*=\s*"([^"]*)"/);
  const description = descMatch?.[1] ?? "";

  // Extract scalar variables
  const variables: FmuScalarVariable[] = [];
  const scalarRegex =
    /<ScalarVariable\b([^>]*)\/?>[\s\S]*?(?:<\/ScalarVariable>|(?=<ScalarVariable|<\/ModelVariables))/g;
  let match: RegExpExecArray | null;

  while ((match = scalarRegex.exec(xml)) !== null) {
    const attrs = match[0] ?? "";
    const headerAttrs = match[1] ?? "";

    const varName = headerAttrs.match(/\bname\s*=\s*"([^"]*)"/)?.[1];
    if (!varName) continue;

    const causality = (headerAttrs.match(/\bcausality\s*=\s*"([^"]*)"/)?.[1] ??
      "local") as FmuScalarVariable["causality"];
    const variability = (headerAttrs.match(/\bvariability\s*=\s*"([^"]*)"/)?.[1] ??
      "continuous") as FmuScalarVariable["variability"];
    const varDesc = headerAttrs.match(/\bdescription\s*=\s*"([^"]*)"/)?.[1] ?? "";

    // Extract type based on inner tags
    let type: FmuScalarVariable["type"] = "Real";
    if (attrs.includes("<Integer")) type = "Integer";
    else if (attrs.includes("<Boolean")) type = "Boolean";
    else if (attrs.includes("<String")) type = "String";
    else if (attrs.includes("<Enumeration")) type = "Enumeration";

    // Extract start value from nested tags
    const startMatch = attrs.match(/\bstart\s*=\s*"([^"]*)"/);
    const start = startMatch ? parseFloat(startMatch[1] ?? "") : undefined;

    variables.push({
      name: varName,
      causality,
      variability,
      description: varDesc,
      type,
      ...(Number.isFinite(start) ? { start: start as number } : {}),
    });
  }

  return { modelName, description, variables };
}

// ── Lightweight ZIP reader (browser-safe, uses pako) ──

/**
 * Extract a file from a ZIP archive by name.
 * Supports STORED (method 0) and DEFLATED (method 8) entries.
 */
function extractFromZip(zipData: Uint8Array, targetName: string): Uint8Array | null {
  // Find End of Central Directory
  let eocdOffset = -1;
  for (let i = zipData.length - 22; i >= 0; i--) {
    if (zipData[i] === 0x50 && zipData[i + 1] === 0x4b && zipData[i + 2] === 0x05 && zipData[i + 3] === 0x06) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) return null;

  const view = new DataView(zipData.buffer, zipData.byteOffset, zipData.byteLength);
  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const cdSize = view.getUint32(eocdOffset + 12, true);
  const cdEnd = cdOffset + cdSize;

  // Scan central directory
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
      // Read from local file header
      if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) return null;
      const localFileNameLen = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + localFileNameLen + localExtraLen;

      if (compressionMethod === 0) {
        return zipData.subarray(dataStart, dataStart + compressedSize);
      } else if (compressionMethod === 8) {
        try {
          return inflateRaw(zipData.subarray(dataStart, dataStart + compressedSize));
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

// ── Synthetic connector factory ──

/**
 * Create a lightweight `ModelicaClassInstance` with `classKind = CONNECTOR`
 * and a triangular `Icon` annotation.  Used for FMU input/output ports so
 * that diagram renderers (which filter for `CONNECTOR`) display them.
 *
 * Input connectors: solid‐filled blue triangle (matches MSL `RealInput`).
 * Output connectors: unfilled blue triangle (matches MSL `RealOutput`).
 */
function createSyntheticConnector(
  parent: ModelicaClassInstance,
  isInput: boolean,
  baseType: ModelicaClassInstance | null,
  typeName = "Real",
): ModelicaClassInstance {
  // If we have the predefined Real type, clone it and set classKind to CONNECTOR.
  // This makes the synthetic connector structurally identical to MSL's
  // `connector RealInput = input Real`, ensuring proper plug-compatibility.
  if (baseType) {
    const connector = baseType.clone();
    connector.classKind = ModelicaClassKind.CONNECTOR;
    // Keep the original Real name — isTypeCompatibleWith matches predefined types by name.
    // classKind=CONNECTOR is what makes diagram renderers recognize this as a port.
    connector.declaredElements = [];
    return connector;
  }
  // Fallback when base type is not available (no MSL loaded)
  const connector = new ModelicaClassInstance(parent);
  connector.classKind = ModelicaClassKind.CONNECTOR;
  connector.name = isInput ? `${typeName}Input` : `${typeName}Output`;
  connector.instantiated = true;
  connector.declaredElements = [];

  // Triangle polygon points (Modelica coordinate system, -100..100)
  // Input:  filled blue triangle pointing right
  // Output: unfilled blue triangle pointing right
  const trianglePoints: [number, number][] = isInput
    ? [
        [-100, 100],
        [100, 0],
        [-100, -100],
        [-100, 100],
      ]
    : [
        [-100, 100],
        [100, 0],
        [-100, -100],
        [-100, 100],
      ];

  const iconData = {
    "@type": "Icon" as const,
    coordinateSystem: {
      extent: [
        [-100, -100],
        [100, 100],
      ] as [[number, number], [number, number]],
      preserveAspectRatio: true,
      initialScale: 0.2,
      "@type": "CoordinateSystem" as const,
    },
    graphics: [
      {
        visible: true,
        origin: [0, 0] as [number, number],
        rotation: 0,
        lineColor: [0, 0, 255] as [number, number, number],
        fillColor: isInput
          ? ([0, 0, 255] as [number, number, number]) // filled for input
          : ([255, 255, 255] as [number, number, number]), // unfilled for output
        pattern: "Solid",
        fillPattern: isInput ? "Solid" : "Solid",
        lineThickness: 0.25,
        points: trianglePoints,
        smooth: "None",
        "@type": "Polygon" as const,
      },
    ],
  };

  // Override annotation() to return the synthetic Icon
  connector.annotation = function <T>(name: string, annotations?: ModelicaNamedElement[] | null): T | null {
    if (name === "Icon" && (!annotations || annotations === this.annotations)) {
      return iconData as unknown as T;
    }
    return ModelicaClassInstance.prototype.annotation.call(this, name, annotations) as T | null;
  };

  return connector;
}

// ── ModelicaFmuEntity ──

/**
 * A Modelica class instance backed by an FMI 2.0 `.fmu` archive.
 *
 * Acts as a `block` with input/output connectors derived from the FMU's
 * scalar variables.  The instantiation algorithm creates synthetic
 * `ModelicaComponentInstance` objects for each variable, so that other
 * Modelica models can reference them via normal name resolution.
 */
export class ModelicaFmuEntity extends ModelicaClassInstance {
  /** Absolute path to the FMU archive. */
  path: string;
  /** Parsed FMU scalar variables. */
  fmuVariables: FmuScalarVariable[] = [];
  /** Synthetic component instances created during instantiation. */
  #syntheticComponents: ModelicaComponentInstance[] = [];
  #loaded = false;
  /** Raw XML content (extracted from the FMU archive or pre-supplied). */
  #xmlContent: string | null = null;

  constructor(parent: Scope, path: string, xmlContent?: string) {
    super(parent);
    this.path = path;
    this.classKind = ModelicaClassKind.BLOCK;
    this.#xmlContent = xmlContent ?? null;
  }

  /** Create from raw FMU archive bytes (extracts modelDescription.xml from ZIP). */
  static fromFmu(parent: Scope, name: string, fmuBytes: Uint8Array): ModelicaFmuEntity {
    const xmlData = extractFromZip(fmuBytes, "modelDescription.xml");
    if (!xmlData) {
      throw new Error(`Invalid FMU archive: modelDescription.xml not found in '${name}.fmu'`);
    }
    const xmlContent = new TextDecoder().decode(xmlData);
    const entity = new ModelicaFmuEntity(parent, `__fmu__:${name}`, xmlContent);
    entity.name = name;
    return entity;
  }

  /** Create from pre-parsed XML content (legacy/testing). */
  static fromXml(parent: Scope, name: string, xmlContent: string): ModelicaFmuEntity {
    const entity = new ModelicaFmuEntity(parent, `__fmu__:${name}`, xmlContent);
    entity.name = name;
    return entity;
  }

  override accept<R, A>(visitor: IModelicaModelVisitor<R, A>, argument?: A): R {
    return visitor.visitClassInstance(this, argument);
  }

  override clone(modification?: import("./model.js").ModelicaModification | null): ModelicaClassInstance {
    if (!this.#loaded) this.load();
    const cloned = new ModelicaFmuEntity(this.parent ?? this, this.path, this.#xmlContent ?? undefined);
    cloned.name = this.name;
    cloned.fmuVariables = this.fmuVariables;
    cloned.#loaded = true;
    if (modification) {
      // FMU entities don't use Modelica modifications, but pass through for compatibility
    }
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

    // Check synthetic components
    for (const comp of this.#syntheticComponents) {
      if (comp.name === simpleName) return comp;
    }

    return super.resolveSimpleName(identifier, global, encapsulated);
  }

  /** Build the graphics array for Icon/Diagram annotations (rectangle + name + port labels). */
  #buildFmuGraphics(): unknown[] {
    const graphics: unknown[] = [
      {
        visible: true,
        origin: [0, 0],
        rotation: 0,
        lineColor: [0, 0, 255],
        fillColor: [255, 255, 255],
        pattern: "Solid",
        lineThickness: 0.25,
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

    // Add port name labels inside the block
    const inputs = this.fmuVariables.filter((v) => v.causality === "input");
    const outputs = this.fmuVariables.filter((v) => v.causality === "output");

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
        graphics: this.#buildFmuGraphics(),
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

      // Resolve the predefined types for non-port and port component class instances
      const types = {
        Real: this.root?.resolveSimpleName("Real") as ModelicaClassInstance | null,
        Integer: this.root?.resolveSimpleName("Integer") as ModelicaClassInstance | null,
        Boolean: this.root?.resolveSimpleName("Boolean") as ModelicaClassInstance | null,
        String: this.root?.resolveSimpleName("String") as ModelicaClassInstance | null,
      };

      // Segregate by causality to calculate port spacing
      const inputs = this.fmuVariables.filter((v) => v.causality === "input");
      const outputs = this.fmuVariables.filter((v) => v.causality === "output");
      const others = this.fmuVariables.filter((v) => v.causality !== "input" && v.causality !== "output");

      let inputCount = 0;
      let outputCount = 0;

      for (const v of [...inputs, ...outputs, ...others]) {
        // Create a synthetic component instance with null AST node
        const comp = new ModelicaComponentInstance(this, null);
        comp.name = v.name;
        comp.description = v.description || null;

        // Set causality from FMU variable
        const isInput = v.causality === "input";
        const isOutput = v.causality === "output";
        if (isInput) {
          comp.causality = ModelicaCausality.INPUT;
        } else if (isOutput) {
          comp.causality = ModelicaCausality.OUTPUT;
        }

        // Find the right base type for this FMU variable
        const typeName = v.type === "Enumeration" ? "Integer" : v.type;
        const baseType = types[typeName as keyof typeof types];

        if (isInput || isOutput) {
          // Create a synthetic CONNECTOR class instance so diagram renderers
          // recognise this component as a port (they filter for classKind === CONNECTOR).
          comp.classInstance = createSyntheticConnector(this, isInput, baseType, typeName);

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

          comp.annotation = function <T>(name: string, annotations?: ModelicaNamedElement[] | null): T | null {
            if (name === "Placement" && (!annotations || annotations === this.annotations)) {
              return {
                "@type": "Placement",
                visible: true,
                transformation: {
                  extent: extent,
                  rotation: 0,
                  origin: [0, 0],
                  "@type": "Transformation",
                },
                iconTransformation: {
                  extent: extent,
                  rotation: 0,
                  origin: [0, 0],
                  "@type": "Transformation",
                },
              } as unknown as T;
            }
            return ModelicaComponentInstance.prototype.annotation.call(this, name, annotations) as T | null;
          };
        } else {
          // Non-port variables: use base type
          if (baseType) {
            comp.classInstance = baseType.clone();
          }
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

  /** Read and parse the model description XML. */
  load(): void {
    if (this.#loaded) return;
    this.#loaded = true;

    let xmlContent = this.#xmlContent;

    // Try reading from filesystem if no pre-supplied content
    if (!xmlContent) {
      const context = this.context;
      if (context) {
        try {
          xmlContent = context.fs.read(this.path);
          this.#xmlContent = xmlContent;
        } catch {
          console.warn(`[ModelicaFmuEntity] Failed to read FMU XML: ${this.path}`);
          return;
        }
      }
    }

    if (!xmlContent) return;

    const parsed = parseFmuModelDescription(xmlContent);
    if (!this.name) {
      this.name = parsed.modelName;
    }
    this.description = parsed.description || this.description;
    this.fmuVariables = parsed.variables;
  }
}
