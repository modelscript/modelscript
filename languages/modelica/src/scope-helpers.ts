import { type QueryDB, type SymbolEntry, type SymbolId } from "@modelscript/compiler";

export interface ScopeData {
  directByName: Record<string, SymbolId>;
  qualifiedImports: Record<string, string>;
  unqualifiedImportPkgs: string[];
  compoundImports: { pkg: string; names: string[] }[];
  isEncapsulated: boolean;
  parentId: SymbolId | null;
  id: SymbolId;
}

export function getScopeData(db: QueryDB, self: SymbolEntry): ScopeData {
  const baseId = db.baseOf(self.id);
  const sourceId = baseId ?? self.id;
  const children = db.childrenOf(sourceId);

  const directByName: Record<string, SymbolId> = {};
  const qualifiedImports: Record<string, string> = {};
  const unqualifiedImportPkgs: string[] = [];
  const compoundImports: { pkg: string; names: string[] }[] = [];

  for (const child of children) {
    if (child.kind === "Class" || child.kind === "Component" || child.kind === "EnumerationLiteral") {
      directByName[child.name] = child.id;
    }

    if (child.kind === "Import") {
      const meta = child.metadata as Record<string, unknown>;
      const importKind =
        (meta?.importKind as string | undefined) ??
        (child.ruleName === "UnqualifiedImportClause"
          ? "unqualified"
          : child.ruleName === "CompoundImportClause"
            ? "compound"
            : "simple");
      const pkgName = (meta?.packageName ?? child.name) as string;

      if (importKind === "simple") {
        const shortName = (meta?.shortName as string) ?? pkgName.split(".").pop() ?? pkgName;
        qualifiedImports[shortName] = pkgName;
      } else if (importKind === "unqualified") {
        unqualifiedImportPkgs.push(pkgName);
      } else if (importKind === "compound") {
        const importNames = db
          .childrenOfField(child.id, "importName")
          .map((c) => c.name)
          .filter(Boolean);
        compoundImports.push({ pkg: pkgName, names: importNames });
      }
    }
  }

  const isEncapsulated = !!(self.metadata as Record<string, unknown>)?.encapsulated;

  return {
    directByName,
    qualifiedImports,
    unqualifiedImportPkgs,
    compoundImports,
    isEncapsulated,
    parentId: self.parentId,
    id: self.id,
  };
}

export function mergeInto(target: Record<string, SymbolId>, source: Record<string, SymbolId>): void {
  for (const [key, value] of Object.entries(source)) {
    if (!(key in target)) {
      target[key] = value;
    }
  }
}

export function resolveSimpleNameHelper(
  db: QueryDB,
  classId: SymbolId,
  name: string,
  encapsulated = false,
  skipInherited = false,
): SymbolEntry | null {
  const unspecializedId = db.baseOf(classId) ?? classId;
  const scope = db.query<ScopeData | null>("scopeData", unspecializedId);
  if (!scope) return null;

  // 1. Direct elements
  const directId = scope.directByName[name];
  if (directId !== undefined) return db.symbol(directId);

  // 2. Inherited elements
  if (!skipInherited) {
    const inheritedMap = db.query<Record<string, SymbolId> | null>("inheritedSymbolsMap", unspecializedId);
    const inheritedId = inheritedMap?.[name];
    if (inheritedId !== undefined) return db.symbol(inheritedId);
  }

  // 2.5. Short class target
  if (!skipInherited) {
    const self = db.symbol(classId);
    const meta = self?.metadata as Record<string, unknown>;
    if (self && !meta?.isPredefined) {
      const cst = db.cstNode(classId) as {
        childForFieldName?: (fieldName: string) => {
          type?: string;
          childForFieldName?: (subFieldName: string) => { text?: string } | null;
        } | null;
      } | null;
      const classSpecifier = cst?.childForFieldName?.("classSpecifier");
      if (classSpecifier?.type === "ShortClassSpecifier") {
        const typeSpec = classSpecifier.childForFieldName?.("typeSpecifier");
        const typeName = typeSpec?.text;
        if (typeName && self.parentId !== null) {
          const parentResolver = db.query<(n: string) => { id: SymbolId } | null>("resolveName", self.parentId);
          if (parentResolver) {
            const resolved = parentResolver(typeName);
            if (resolved?.id && resolved.id !== classId) {
              const found = resolveSimpleNameHelper(db, resolved.id, name, encapsulated, skipInherited);
              if (found) return found;
            }
          }
        }
      }
    }
  }

  // 3. Qualified imports
  const qualPkg = scope.qualifiedImports[name];
  if (qualPkg) {
    return resolveQualified(db, qualPkg);
  }

  const resolveImportPath = (pathStr: string): SymbolEntry | null => {
    const parts = pathStr.split(".");
    const first = parts[0];
    const aliasTarget = first ? scope.qualifiedImports[first] : undefined;
    if (aliasTarget) {
      const fullPath = [aliasTarget, ...parts.slice(1)].join(".");
      return resolveQualified(db, fullPath);
    } else {
      return resolveQualified(db, pathStr);
    }
  };

  // 4. Compound imports
  for (const ci of scope.compoundImports) {
    if (ci.names.includes(name)) {
      const pkgEntry = resolveImportPath(ci.pkg);
      if (pkgEntry) {
        const foundEntry = db.childrenOf(pkgEntry.id).find((c) => c.name === name && c.kind !== "Reference");
        if (foundEntry) return foundEntry;
      }
    }
  }

  // 5. Unqualified imports
  for (const pkg of scope.unqualifiedImportPkgs) {
    const pkgEntry = resolveImportPath(pkg);
    if (pkgEntry) {
      for (const pkgChild of db.childrenOf(pkgEntry.id)) {
        if (pkgChild.name === name && pkgChild.kind !== "Reference") return pkgChild;
      }
    }
  }

  // 6. Parent scope walk (unless encapsulated)
  if (!encapsulated && !scope.isEncapsulated && scope.parentId !== null && scope.parentId !== unspecializedId) {
    const parentEntry = db.symbol(scope.parentId);
    if (parentEntry && (parentEntry.kind === "Class" || parentEntry.kind === "Package")) {
      const found = resolveSimpleNameHelper(db, parentEntry.id, name, false, skipInherited);
      if (found) return found;
    }
  }

  // 7. Predefined types fallback
  const predefined = db.byName(name);
  return (
    predefined?.find(
      (e) => e.kind === "Class" || e.kind === "Package" || e.kind === "Function" || e.kind === "Definition",
    ) ?? null
  );
}

export function resolveQualified(db: QueryDB, path: string): SymbolEntry | null {
  const parts = path.split(".");
  if (parts.length === 0) return null;

  const rootPart = parts[0];
  if (!rootPart) return null;
  const rootEntries = db.byName(rootPart);
  let current =
    rootEntries.find((e) => Boolean((e.metadata as Record<string, unknown> | undefined)?.isPredefined)) ??
    rootEntries.find((e) => e.parentId === null) ??
    rootEntries.find((e) => ["Class", "Package", "Function", "Definition", "Enumeration"].includes(e.kind)) ??
    rootEntries[0] ??
    null;

  if (!current) return null;

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    const children = db.childrenOf(current.id);
    current =
      children.find((c) => c.name === part && c.kind !== "Reference") || children.find((c) => c.name === part) || null;
    if (!current) return null;
  }

  return current;
}
