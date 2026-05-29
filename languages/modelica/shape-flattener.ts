/* eslint-disable @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-explicit-any */
import type { Assembly, Mat4, PartEntry, Solid } from "@modelscript/cad";
import {
  IDENTITY,
  SolidKind,
  assembly,
  box,
  cylinder,
  mat4Multiply,
  part,
  rotationMatrix,
  sphere,
  torus,
  translationMatrix,
} from "@modelscript/cad";
import type { QueryDB, SymbolEntry, SymbolId } from "@modelscript/compiler";
import { isBroken, mergeModArgs, subModification, type ModelicaModArgs } from "./modification-args.js";

type ModificationStack = { mods: ModelicaModArgs; evaluationScopeId: SymbolId | null }[];

export class ShapeFlattener {
  constructor(private db: QueryDB) {}

  flatten(classId: SymbolId): Assembly {
    const rootEntry = this.db.symbol(classId);
    const asmName = rootEntry?.name ?? "Assembly";
    const parts: PartEntry[] = [];

    // Start with an empty modification stack and identity transform
    this.walkClass(classId, [], IDENTITY, parts);

    return assembly(asmName, parts);
  }

  private walkClass(classId: SymbolId, modStack: ModificationStack, currentTransform: Mat4, parts: PartEntry[]) {
    const children = this.db.childrenOf(classId);

    // Process extends first
    for (const child of children) {
      if (child.kind === "Extends") {
        const topMod = modStack.length > 0 ? modStack[modStack.length - 1]!.mods : null;
        if (isBroken(topMod, child.name)) continue;

        const baseEntry = this.db.query<SymbolEntry | null>("resolvedBaseClass", child.id);
        if (!baseEntry) continue;

        const localMod = this.db.query<ModelicaModArgs | null>("extendsModificationParsed", child.id);
        const mergedMod = mergeModArgs(topMod, localMod);

        const childStack =
          mergedMod && mergedMod.args.length > 0
            ? [...modStack, { mods: mergedMod, evaluationScopeId: child.parentId }]
            : modStack;

        this.walkClass(baseEntry.id, childStack, currentTransform, parts);
      }
    }

    // Process components
    for (const child of children) {
      if (child.kind === "Component") {
        this.processComponent(child, modStack, currentTransform, parts);
      }
    }
  }

  private processComponent(entry: SymbolEntry, modStack: ModificationStack, parentTransform: Mat4, parts: PartEntry[]) {
    // 1. Compute effective modification
    let topMod: ModelicaModArgs | null = null;
    for (let i = modStack.length - 1; i >= 0; i--) {
      const sub = subModification(modStack[i]!.mods, entry.name);
      if (sub) {
        topMod = sub;
        break;
      }
    }
    const inlineMod = this.db.query<ModelicaModArgs | null>("effectiveModification", entry.id);
    const effectiveMod = mergeModArgs(topMod, inlineMod);

    // 2. Resolve class instance
    const classInstId = this.db.query<SymbolId | null>("classInstance", entry.id);
    if (!classInstId) return;
    const classEntry = this.db.symbol(classInstId);
    if (!classEntry) return;

    // 3. Build child modification stack
    const childStack =
      effectiveMod && effectiveMod.args.length > 0
        ? [...modStack, { mods: effectiveMod, evaluationScopeId: entry.parentId }]
        : modStack;

    // 4. Determine placement and global transform
    const localTransform = this.evaluatePlacement(entry);
    const globalTransform = localTransform ? mat4Multiply(parentTransform, localTransform) : parentTransform;

    const classPrefixes = (classEntry.metadata as Record<string, unknown>)?.classPrefixes as string | undefined;

    // 5. Evaluate material if present
    const material = this.evaluateMaterial(entry);

    // 6. Generate geometry primitives
    if (classPrefixes === "shape") {
      let solid: Solid | null = null;

      if (classEntry.name === "Box") {
        solid = box({
          width: (this.evalParam("width", classInstId, childStack) as number) ?? 1,
          height: (this.evalParam("height", classInstId, childStack) as number) ?? 1,
          depth: (this.evalParam("depth", classInstId, childStack) as number) ?? 1,
          name: entry.name,
        });
      } else if (classEntry.name === "Cylinder") {
        solid = cylinder({
          radius: (this.evalParam("radius", classInstId, childStack) as number) ?? 0.5,
          height: (this.evalParam("height", classInstId, childStack) as number) ?? 1,
          name: entry.name,
        });
      } else if (classEntry.name === "Sphere") {
        solid = sphere({
          radius: (this.evalParam("radius", classInstId, childStack) as number) ?? 0.5,
          name: entry.name,
        });
      } else if (classEntry.name === "Torus") {
        solid = torus({
          major: (this.evalParam("major", classInstId, childStack) as number) ?? 1,
          minor: (this.evalParam("minor", classInstId, childStack) as number) ?? 0.2,
          name: entry.name,
        });
      } else {
        // Nested shape assembly — recurse!
        this.walkClass(classInstId, childStack, globalTransform, parts);
      }

      if (solid) {
        // If we generated a leaf primitive, wrap it in a TransformSolid and add to parts
        // But the modelscript/cad translate() expects a Solid and a Vec3. We have a 4x4 matrix.
        // We can just construct the TransformSolid directly.
        parts.push(
          part(
            {
              kind: SolidKind.Transform,
              name: entry.name + "_placement",
              child: solid,
              matrix: globalTransform,
            },
            { material },
          ),
        );
      }
    }
  }

  private evalParam(name: string, classId: SymbolId, modStack: ModificationStack): unknown {
    // Look up in modification stack first
    for (let i = modStack.length - 1; i >= 0; i--) {
      const args = modStack[i]!.mods.args;
      for (const a of args) {
        if (a.name === name && a.value) {
          return this.db.evaluate(a.value, modStack[i]!.evaluationScopeId);
        }
      }
    }

    // Fallback to default in the class
    for (const child of this.db.childrenOf(classId)) {
      if (child.kind === "Component" && child.name === name) {
        const inlineMod = this.db.query<ModelicaModArgs | null>("effectiveModification", child.id);
        if (inlineMod && inlineMod.args.length > 0) {
          const a = inlineMod.args[0]!;
          if (a.value) return this.db.evaluate(a.value, child.parentId);
        }
      }
    }
    return null;
  }

  private evaluatePlacement(entry: SymbolEntry): Mat4 | null {
    const cstNode = this.db.cstNode(entry.id) as any;
    if (!cstNode) return null;

    const text = cstNode.text as string;
    if (!text || !text.includes("Placement")) return null;

    let origin: [number, number, number] | null = null;
    let rotation: [number, number, number] | null = null;

    // A lightweight parser for the Placement annotation
    const oMatch = text.match(/origin\s*=\s*\{\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\}/);
    if (oMatch) {
      origin = [Number(oMatch[1]), Number(oMatch[2]), Number(oMatch[3])];
    }
    const rMatch = text.match(/rotation\s*=\s*\{\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\}/);
    if (rMatch) {
      rotation = [Number(rMatch[1]), Number(rMatch[2]), Number(rMatch[3])];
    }

    if (!origin && !rotation) return null;

    let mat = IDENTITY;

    // Apply rotation
    if (rotation) {
      const rx = (rotation[0] * Math.PI) / 180;
      const ry = (rotation[1] * Math.PI) / 180;
      const rz = (rotation[2] * Math.PI) / 180;

      if (rx) mat = mat4Multiply(mat, rotationMatrix([1, 0, 0], rx));
      if (ry) mat = mat4Multiply(mat, rotationMatrix([0, 1, 0], ry));
      if (rz) mat = mat4Multiply(mat, rotationMatrix([0, 0, 1], rz));
    }

    // Apply translation
    if (origin) {
      mat = mat4Multiply(translationMatrix(origin), mat);
    }

    return mat;
  }

  private evaluateMaterial(entry: SymbolEntry): string | undefined {
    const cstNode = this.db.cstNode(entry.id) as any;
    if (!cstNode) return undefined;

    const text = cstNode.text as string;
    if (!text || !text.includes("material")) return undefined;

    const match = text.match(/material\s*=\s*([a-zA-Z0-9_]+)/);
    if (match) {
      return match[1];
    }
    return undefined;
  }
}
