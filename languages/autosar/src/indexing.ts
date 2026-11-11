// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { UnifiedWorkspace } from "@modelscript/runtime";
import { parseArxml } from "./parser/index.js";
import type { AutosarModel, AutosarPackage, AutosarSwComponent } from "./types.js";

/**
 * Declarative per-file indexer for AUTOSAR Classic and Adaptive ARXML architectures.
 * Indexes packages, software component types, port prototypes, interfaces, and PDUs.
 */
export function indexAutosarDocument(ctx: DslIndexFileContext): void {
  const record = (
    name: string,
    kind: string,
    parentId: number | null,
    namePath: string[],
    metadata: Record<string, unknown> = {},
  ): number => {
    return ctx.addSymbol(name, kind, parentId, 0, 0, metadata, {
      ruleName: kind,
      namePath: namePath.join("."),
    });
  };

  try {
    const model = parseArxml(ctx.text);
    ctx.setParsedModel<AutosarModel>(model);

    const indexPackage = (pkg: AutosarPackage, parentId: number | null, pathPrefix: string[]) => {
      const currentPath = [...pathPrefix, pkg.shortName];
      const pkgId = record(pkg.shortName, "Package", parentId, currentPath);

      for (const [elName, el] of pkg.elements) {
        if ("kind" in el && typeof el.kind === "string" && el.kind.includes("SW-COMPONENT")) {
          const swc = el as AutosarSwComponent;
          const swcPath = [...currentPath, elName];
          const swcId = record(elName, "Class", pkgId, swcPath, { swcKind: swc.kind });

          for (const [portName, port] of swc.ports) {
            record(portName, "Component", swcId, [...swcPath, portName], {
              direction: port.direction,
              interfaceRef: port.interfaceRef,
            });
          }
        } else {
          record(elName, "Interface", pkgId, [...currentPath, elName]);
        }
      }

      for (const sub of pkg.subPackages.values()) {
        indexPackage(sub, pkgId, currentPath);
      }
    };

    for (const pkg of model.packages.values()) {
      indexPackage(pkg, null, []);
    }
  } catch {
    // Return empty index on failure
  }
}

/**
 * Retrieves a parsed `AutosarModel` from `UnifiedWorkspace` for `uri`.
 */
export function getAutosarModel(workspace: UnifiedWorkspace, uri: string): AutosarModel | undefined {
  return workspace.getParsedModel<AutosarModel>(uri);
}
