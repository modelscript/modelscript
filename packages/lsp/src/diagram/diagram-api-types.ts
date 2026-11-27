// SPDX-License-Identifier: AGPL-3.0-or-later

import type { buildPolyglotDiagram } from "@modelscript/diagram/builder";
import type { FileSystemBridge } from "@modelscript/diagram/fs-bridge";
import type { SidecarLayoutStorage } from "@modelscript/diagram/layout-storage";
import type { SymbolIndex as RuntimeSymbolIndex } from "@modelscript/runtime";
import type { TextEdit } from "vscode-languageserver";
import type { ComponentPropertyData, DiagramBackend, DiagramPalette } from "../diagramProtocol.js";
import type { CstParserLike } from "../utils/ast-utils.js";

export interface GenericDiagramConfigLike {
  language?: string | undefined;
  name?: string | undefined;
  palette?: { categories?: DiagramPalette["categories"] | undefined } | undefined;
  placement?:
    | {
        persistence?: string | undefined;
        formatPlacement?:
          | ((
              x: number,
              y: number,
              width?: number | undefined,
              height?: number | undefined,
              rotation?: number | undefined,
            ) => string)
          | undefined;
        sidecar?: ConstructorParameters<typeof SidecarLayoutStorage>[0] | undefined;
        sidecarPath?: string | undefined;
        format?: string | undefined;
      }
    | undefined;
  mutations?:
    | {
        edgeTemplates?: Record<string, unknown> | undefined;
        edgeTemplate?: unknown;
        createEdge?: unknown;
        createNode?: ((className: string, name: string, x: number, y: number) => string) | undefined;
        nodeTemplate?: string | ((className: string, name: string) => string) | undefined;
        deleteEntity?: unknown;
        sections?: { edge?: string | undefined; node?: string | undefined } | undefined;
        insertionSection?: string | undefined;
        defaultSection?: string | undefined;
      }
    | undefined;
  properties?:
    | {
        inModelDiscovery?:
          | {
              extractSchema?:
                | ((rawAst: unknown, componentName: string, symIndex: unknown) => ComponentPropertyData["schema"])
                | undefined;
              extractValues?:
                ((rawAst: unknown, componentName: string, symIndex: unknown) => Record<string, unknown>) | undefined;
            }
          | undefined;
        entities?: Record<string, ComponentPropertyData["schema"]> | undefined;
        mutator?:
          | {
              updateProperty?: ((...args: unknown[]) => TextEdit[] | null | undefined) | undefined;
              updateModifier?:
                | ((
                    docText: string,
                    name: string,
                    paramName: string,
                    paramVal: unknown,
                  ) => TextEdit[] | null | undefined)
                | undefined;
            }
          | undefined;
      }
    | undefined;
  [key: string]: unknown;
}

export interface RawAstDataLike {
  nodes: unknown[];
  edges: unknown[];
}

export type DiagramSymbolIndexLike = RuntimeSymbolIndex;
export type DiagramScopeResolverLike = Parameters<typeof buildPolyglotDiagram>[3];

export interface GenericDSLBackendDeps {
  getDocumentText: (uri: string) => string | undefined;
  getDiagramConfig?: ((uri: string) => GenericDiagramConfigLike | undefined) | undefined;
  getSyntaxNames?: ((uri: string) => Record<number, string> | string[] | undefined) | undefined;
  getRawAstData?: ((uri: string) => RawAstDataLike | null) | undefined;
  getSymbolIndex?: ((uri: string) => DiagramSymbolIndexLike | undefined) | undefined;
  getUnifiedIndex?: (() => DiagramSymbolIndexLike | null | undefined) | undefined;
  getScopeResolver?: ((uri: string) => DiagramScopeResolverLike | undefined) | undefined;
  getParser?: ((langId: string) => CstParserLike | undefined) | undefined;
  layoutStorage?: SidecarLayoutStorage | undefined;
  fsBridge?: FileSystemBridge | undefined;
}

export interface BackendWithDepsLike {
  deps?:
    | {
        getUnifiedIndex?: (() => unknown) | undefined;
        getDocumentText?: ((uri: string) => string | undefined) | undefined;
        getDiagramConfig?: ((uri: string) => GenericDiagramConfigLike | undefined) | undefined;
      }
    | undefined;
  getLayoutStorage?: ((uri: string) => SidecarLayoutStorage | undefined) | undefined;
}

export interface DiagramDispatchDeps {
  modelica?: DiagramBackend | undefined;
  sysml2?: DiagramBackend | undefined;
  generic?: DiagramBackend | undefined;
  owl2?: DiagramBackend | undefined;
  simulink?: DiagramBackend | undefined;
  spice?: DiagramBackend | undefined;
  opendrive?: DiagramBackend | undefined;
  simpack?: DiagramBackend | undefined;
  gensys?: DiagramBackend | undefined;
  adams?: DiagramBackend | undefined;
  urdf?: DiagramBackend | undefined;
  getUnifiedIndex?: (() => unknown) | undefined;
  customBackends?: Map<string | RegExp, DiagramBackend> | undefined;
}
