// SPDX-License-Identifier: AGPL-3.0-or-later

/** Supported language dialects across ModelScript polyglot ecosystem */
export type EmbedDialect =
  | "modelica"
  | "sysml2"
  | "step"
  | "scad"
  | "pscad"
  | "olga"
  | "csv"
  | "owl2"
  | "gensys"
  | "simpack"
  | "spice"
  | "fmu"
  | "ssp"
  | "cfd"
  | "fea"
  | "simulink"
  | "urdf"
  | "plcopen"
  | "opendss"
  | "mermaid"
  | (string & {});

/** Visual artifact presentation mode */
export type EmbedViewMode = "diagram" | "cad" | "plot" | "code" | "split-columns" | "split-rows";

/** Wheel / Scroll zoom interaction policy for embedded viewers */
export type ZoomInterceptionMode = "ctrl-wheel" | "always" | "click-to-interact";

/** Targeted model element anchor for deep linking and visual focus */
export interface ModelElementAnchor {
  /** Identifier of the target node, component instance, or net (e.g. "R1", "motor.stator") */
  elementId: string;
  /** Highlighting categorization */
  kind?: "component" | "connection" | "line" | "cad-node" | undefined;
  /** Optional source code line number (1-indexed) */
  line?: number | undefined;
  /** Optional source code column (1-indexed) */
  column?: number | undefined;
}

/** Universal payload serialized into the URL hash (#m=...) */
export interface UniversalEmbedPayload {
  v: number;
  lang: EmbedDialect;
  code: string;
  title?: string | undefined;
  view?: EmbedViewMode | undefined;
  anchor?: ModelElementAnchor | undefined;
  zoomMode?: ZoomInterceptionMode | undefined;
  params?: Record<string, number> | undefined;
  sim?:
    | {
        stopTime?: number | undefined;
        stepSize?: number | undefined;
        tolerance?: number | undefined;
      }
    | undefined;
  camera?:
    | {
        position?: [number, number, number] | undefined;
        target?: [number, number, number] | undefined;
      }
    | undefined;
  dependencies?: Record<string, string> | undefined;
  /** Indicates if this payload is part of a multi-file package */
  isMultiFile?: boolean | undefined;
  artifactId?: string | number | undefined;
  morselId?: string | undefined;
  embedToken?: string | undefined;
}

/** Messages sent from Host -> Embed Iframe */
export type HostToEmbedMessage =
  | { type: "SET_CODE"; code: string }
  | { type: "SET_VIEW"; view: EmbedViewMode }
  | { type: "SET_THEME"; theme: "dark" | "light" }
  | { type: "SET_ANCHOR"; anchor: ModelElementAnchor }
  | { type: "SET_ZOOM_MODE"; zoomMode: ZoomInterceptionMode }
  | { type: "SET_PARAMETERS"; params: Record<string, number> }
  | { type: "TRIGGER_SIMULATE"; options?: { stopTime?: number; stepSize?: number } }
  | { type: "REQUEST_EXPORT_SVG" };

/** Messages sent from Embed Iframe -> Host */
export type EmbedToHostMessage =
  | { type: "EMBED_READY"; capabilities: string[] }
  | { type: "CODE_CHANGED"; code: string }
  | { type: "ANCHOR_CLICKED"; anchor: ModelElementAnchor }
  | { type: "SIMULATION_STATUS"; status: "running" | "completed" | "error"; error?: string }
  | { type: "SIMULATION_RESULTS"; variables: string[]; data: Record<string, number | string>[] }
  | { type: "EXPORTED_SVG"; svg: string }
  | { type: "OPEN_TARGET_REQUESTED"; target: "playground" | "ide"; url: string };
