// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/magicdraw — Workspace-Level Mounted `.mdzip` Module `href` Resolver.
 *
 * Resolves external `href` pointers (e.g., `SharedLibrary.mdzip#_19_0_12345`) against
 * other `.mdzip` / `.mdxml` / `.xmi` files already loaded in a workspace.
 */

import type { MagicDrawDocument } from "../types.js";

export interface MountedModuleResolution {
  name: string;
  id: string;
  unit?: string | undefined;
  isPrimitive?: boolean | undefined;
  moduleUri: string;
}

export class WorkspaceModuleResolver {
  private readonly modulesByFilename = new Map<string, { uri: string; doc: MagicDrawDocument }>();

  registerModule(uri: string, doc: MagicDrawDocument): void {
    const filename = uri.split(/[\\/]/).pop()?.toLowerCase();
    if (filename) {
      this.modulesByFilename.set(filename, { uri, doc });
    }
  }

  resolveHref(href: string): MountedModuleResolution | undefined {
    const hashIdx = href.indexOf("#");
    if (hashIdx < 0) return undefined;
    const filePart = href.slice(0, hashIdx).split(/[\\/]/).pop()?.toLowerCase();
    const fragmentId = href.slice(hashIdx + 1).trim();
    if (!filePart || !fragmentId) return undefined;

    const mod = this.modulesByFilename.get(filePart);
    if (!mod) return undefined;

    const el = mod.doc.elementsById.get(fragmentId);
    if (!el) return undefined;
    const cls = mod.doc.classifiers.get(fragmentId);
    return {
      name: el.name,
      id: el.id,
      unit: cls?.unit,
      isPrimitive: cls?.kind === "DataType",
      moduleUri: mod.uri,
    };
  }
}
