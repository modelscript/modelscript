// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CstDocumentSession,
  type CstIncrementalParser,
  type CstTextDelta,
  type CstTextEdit,
} from "@modelscript/dsl/unparser";
import { planModelicaEditsOnSession } from "@modelscript/modelica/diagram/edits";
import { planOpenDriveEditsOnSession } from "@modelscript/opendrive";
import { planOwl2EditsOnSession } from "@modelscript/owl2";
import { tryPlanPscadLocalEdits, type DiagramAction, type PscadForeignDropInfo } from "@modelscript/pscad";
import { planPsseOptimisticEditsOnSession, planPsseStructuralEditsOnSession } from "@modelscript/psse";
import { planSimulinkXmlEditsOnSession } from "@modelscript/simulink";
import { planSpiceEditsOnSession } from "@modelscript/spice";
import { applySspDiagramEditsOnSession } from "@modelscript/ssp";
import { planSysml2EditsOnSession } from "@modelscript/sysml2";

export type CstEditWorkerRequest =
  | {
      type: "open";
      uri: string;
      langId: string;
      text: string;
      version: number;
    }
  | {
      type: "delta";
      uri: string;
      langId: string;
      deltas: CstTextDelta[];
      version: number;
    }
  | {
      type: "syncText";
      uri: string;
      langId: string;
      text: string;
      version: number;
    }
  | {
      type: "close";
      uri: string;
    }
  | {
      type: "setForeignSymbols";
      symbols: Record<string, PscadForeignDropInfo>;
    }
  | {
      type: "applyActions";
      id: number;
      uri: string;
      langId: string;
      actions: DiagramAction[];
      version: number;
      /** Fallback snapshot if the session has not yet been opened in this worker. */
      fallbackText?: string | undefined;
      className?: string | undefined;
    };

export type CstEditWorkerResponse = {
  type: "applyActionsResult";
  id: number;
  uri: string;
  version: number;
  handled: boolean;
  edits: CstTextEdit[];
  renderHint: "none" | "immediate" | "debounced";
};

const XML_CST_LANGS = new Set(["pscad", "simulink", "opendrive", "ssp"]);
const RECORD_CST_LANGS = new Set(["psse", "spice"]);
const BLOCK_CST_LANGS = new Set(["modelica", "sysml2", "owl2"]);

export function isCstEditWorkerSupported(langId: string): boolean {
  const lower = langId.toLowerCase();
  return XML_CST_LANGS.has(lower) || RECORD_CST_LANGS.has(lower) || BLOCK_CST_LANGS.has(lower);
}

/**
 * Pure TypeScript core for the Dedicated CST Edit Worker.
 *
 * Maintains live incremental {@link CstDocumentSession} instances per open URI, applies
 * O(1) Monaco incremental deltas directly to the CST, and plans surgical diagram `TextEdit`s
 * in ~1–3 ms off the main thread without ever queuing behind heavy LSP validation/simulation.
 *
 * Runs identically inside a browser WebWorker (`cst-edit.worker.ts`) and in-process in Node tests.
 */
export class CstEditWorkerCore {
  private readonly sessions = new Map<string, { langId: string; session: CstDocumentSession }>();
  private readonly foreignSymbols = new Map<string, PscadForeignDropInfo>();
  private xmlParser: CstIncrementalParser | null = null;
  private readonly recordParsers = new Map<string, CstIncrementalParser>();

  /** Attaches the shared `xml/parser.wasm` GLR parser once lazy-loaded and upgrades open XML sessions. */
  public setXmlParser(parser: CstIncrementalParser | null): void {
    this.xmlParser = parser;
    for (const entry of this.sessions.values()) {
      if (XML_CST_LANGS.has(entry.langId)) {
        entry.session.setParser(parser);
      }
    }
  }

  /** Attaches a lazy-loaded non-XML language WASM parser (e.g. `psse`) and upgrades open sessions for that language. */
  public setLanguageParser(langId: string, parser: CstIncrementalParser | null): void {
    const norm = langId.toLowerCase();
    if (parser) {
      this.recordParsers.set(norm, parser);
    } else {
      this.recordParsers.delete(norm);
    }
    for (const entry of this.sessions.values()) {
      if (entry.langId === norm) {
        entry.session.setParser(parser);
      }
    }
  }

  public getSession(uri: string): CstDocumentSession | undefined {
    return this.sessions.get(uri)?.session;
  }

  public handleMessage(msg: CstEditWorkerRequest): CstEditWorkerResponse | null {
    switch (msg.type) {
      case "open": {
        this.openOrResetSession(msg.uri, msg.langId, msg.text, msg.version);
        return null;
      }

      case "delta": {
        const entry = this.sessions.get(msg.uri);
        if (entry) {
          entry.session.applyDeltas(msg.deltas, msg.version);
        }
        return null;
      }

      case "syncText": {
        const entry = this.sessions.get(msg.uri);
        if (entry && entry.langId === msg.langId.toLowerCase()) {
          entry.session.setText(msg.text, msg.version);
        } else {
          this.openOrResetSession(msg.uri, msg.langId, msg.text, msg.version);
        }
        return null;
      }

      case "close": {
        const existing = this.sessions.get(msg.uri);
        if (existing) {
          existing.session.dispose();
          this.sessions.delete(msg.uri);
        }
        return null;
      }

      case "setForeignSymbols": {
        for (const [k, info] of Object.entries(msg.symbols)) {
          this.foreignSymbols.set(k, info);
          this.foreignSymbols.set(k.toLowerCase(), info);
        }
        return null;
      }

      case "applyActions": {
        const lang = msg.langId.toLowerCase();
        if (!isCstEditWorkerSupported(lang)) {
          return {
            type: "applyActionsResult",
            id: msg.id,
            uri: msg.uri,
            version: msg.version,
            handled: false,
            edits: [],
            renderHint: "none",
          };
        }

        let entry = this.sessions.get(msg.uri);
        if (!entry || entry.langId !== lang) {
          if (typeof msg.fallbackText === "string") {
            entry = this.openOrResetSession(msg.uri, lang, msg.fallbackText, msg.version);
          } else {
            return {
              type: "applyActionsResult",
              id: msg.id,
              uri: msg.uri,
              version: msg.version,
              handled: false,
              edits: [],
              renderHint: "none",
            };
          }
        } else if (typeof msg.fallbackText === "string" && entry.session.version !== msg.version) {
          entry.session.setText(msg.fallbackText, msg.version);
        }

        if (lang === "modelica") {
          const planned = planModelicaEditsOnSession(entry.session, msg.actions as never, msg.className);
          if (!planned || planned.edits.length === 0) {
            return {
              type: "applyActionsResult",
              id: msg.id,
              uri: msg.uri,
              version: msg.version,
              handled: false,
              edits: [],
              renderHint: "none",
            };
          }
          return {
            type: "applyActionsResult",
            id: msg.id,
            uri: msg.uri,
            version: msg.version,
            handled: true,
            edits: planned.edits,
            renderHint: planned.hasStructural ? "immediate" : "none",
          };
        }

        if (lang === "sysml2") {
          const hasSidecarOnly = msg.actions.some(
            (a) => a.type === "move" || a.type === "resize" || a.type === "moveEdge",
          );
          if (hasSidecarOnly) {
            // SysML2 diagram layout positions live in the `.layout` sidecar managed by LSP
            return {
              type: "applyActionsResult",
              id: msg.id,
              uri: msg.uri,
              version: msg.version,
              handled: false,
              edits: [],
              renderHint: "none",
            };
          }
          const planned = planSysml2EditsOnSession(entry.session, msg.actions as never);
          return {
            type: "applyActionsResult",
            id: msg.id,
            uri: msg.uri,
            version: msg.version,
            handled: planned.edits.length > 0,
            edits: planned.edits,
            renderHint: planned.hasStructural ? "immediate" : "debounced",
          };
        }

        if (lang === "owl2") {
          const hasSidecarOnly = msg.actions.some(
            (a) => a.type === "move" || a.type === "resize" || a.type === "moveEdge",
          );
          if (hasSidecarOnly) {
            return {
              type: "applyActionsResult",
              id: msg.id,
              uri: msg.uri,
              version: msg.version,
              handled: false,
              edits: [],
              renderHint: "none",
            };
          }
          const planned = planOwl2EditsOnSession(entry.session, msg.actions as never);
          return {
            type: "applyActionsResult",
            id: msg.id,
            uri: msg.uri,
            version: msg.version,
            handled: planned.edits.length > 0,
            edits: planned.edits,
            renderHint: planned.hasStructural ? "immediate" : "none",
          };
        }

        if (lang === "simulink") {
          const txt = entry.session.text;
          const isCurlyOrBinary =
            txt.startsWith("PK") ||
            (!txt.includes("<Block") && !txt.includes("<System") && /^\s*Model\s*\{/m.test(txt));
          // Native Simulink XML drops run directly in the worker; unknown foreign drops fall back to LSP
          const hasUnresolvedForeignAdd = msg.actions.some((a) => {
            if (a.type !== "addComponent") return false;
            const cls = (a as { className?: string }).className ?? "";
            return cls.includes(".") && !cls.toLowerCase().startsWith("simulink.");
          });
          if (isCurlyOrBinary || hasUnresolvedForeignAdd) {
            return {
              type: "applyActionsResult",
              id: msg.id,
              uri: msg.uri,
              version: msg.version,
              handled: false,
              edits: [],
              renderHint: "none",
            };
          }
          const planned = planSimulinkXmlEditsOnSession(entry.session, msg.actions as never);
          return {
            type: "applyActionsResult",
            id: msg.id,
            uri: msg.uri,
            version: msg.version,
            handled: planned.edits.length > 0,
            edits: planned.edits,
            renderHint: planned.hasStructural ? "immediate" : "none",
          };
        }

        if (lang === "opendrive") {
          const planned = planOpenDriveEditsOnSession(entry.session, msg.actions as never);
          if (planned.spatialActions.length > 0 || planned.edits.length === 0) {
            return {
              type: "applyActionsResult",
              id: msg.id,
              uri: msg.uri,
              version: msg.version,
              handled: false,
              edits: [],
              renderHint: "none",
            };
          }
          return {
            type: "applyActionsResult",
            id: msg.id,
            uri: msg.uri,
            version: msg.version,
            handled: true,
            edits: planned.edits,
            renderHint: planned.hasStructural ? "immediate" : "none",
          };
        }

        if (lang === "ssp") {
          const cleanUri = msg.uri.split("?")[0]!.toLowerCase();
          if (cleanUri.endsWith(".ssp") && !entry.session.text.trimStart().startsWith("<")) {
            return {
              type: "applyActionsResult",
              id: msg.id,
              uri: msg.uri,
              version: msg.version,
              handled: false,
              edits: [],
              renderHint: "none",
            };
          }
          const edits = applySspDiagramEditsOnSession(entry.session, msg.actions as never);
          const hasStructural = msg.actions.some(
            (a) =>
              a.type === "connect" ||
              a.type === "disconnect" ||
              a.type === "addComponent" ||
              a.type === "deleteComponents" ||
              a.type === "updateName",
          );
          return {
            type: "applyActionsResult",
            id: msg.id,
            uri: msg.uri,
            version: msg.version,
            handled: edits.length > 0,
            edits,
            renderHint: hasStructural ? "immediate" : "none",
          };
        }

        if (lang === "spice") {
          const planned = planSpiceEditsOnSession(entry.session, msg.actions as never);
          return {
            type: "applyActionsResult",
            id: msg.id,
            uri: msg.uri,
            version: msg.version,
            handled: planned.edits.length > 0,
            edits: planned.edits,
            renderHint: planned.hasStructural ? "immediate" : "none",
          };
        }

        if (lang === "psse") {
          const isStructuralPsse =
            msg.actions.length > 0 &&
            msg.actions.every((a) => {
              const t = a.type;
              return (
                t === "deleteComponents" ||
                t === "connect" ||
                t === "disconnect" ||
                t === "reconnect" ||
                t === "addComponent"
              );
            });
          if (isStructuralPsse) {
            try {
              const enriched = msg.actions.map((a) => {
                if (a.type === "addComponent") {
                  const cls = (a as { className?: string }).className ?? "";
                  const info = this.foreignSymbols.get(cls) ?? this.foreignSymbols.get(cls.toLowerCase());
                  if (info) {
                    return { ...a, foreignLanguage: info.sourceLanguage };
                  }
                }
                return a;
              });
              const edits = planPsseStructuralEditsOnSession(
                entry.session,
                enriched as Parameters<typeof planPsseStructuralEditsOnSession>[1],
              );
              if (edits && edits.length > 0) {
                return {
                  type: "applyActionsResult",
                  id: msg.id,
                  uri: msg.uri,
                  version: msg.version,
                  handled: true,
                  edits,
                  renderHint: "immediate",
                };
              }
            } catch {
              // Fall back to LSP backend if PSSE structural CST edit cannot be planned locally
            }
            return {
              type: "applyActionsResult",
              id: msg.id,
              uri: msg.uri,
              version: msg.version,
              handled: false,
              edits: [],
              renderHint: "none",
            };
          }

          const isFastPsse = msg.actions.every((a) => {
            const t = a.type;
            return (
              t === "move" ||
              t === "resize" ||
              t === "rotate" ||
              t === "toggleDisable" ||
              t === "moveEdge" ||
              t === "updateParameter" ||
              t === "updateProperty" ||
              t === "updateName"
            );
          });
          if (!isFastPsse) {
            return {
              type: "applyActionsResult",
              id: msg.id,
              uri: msg.uri,
              version: msg.version,
              handled: false,
              edits: [],
              renderHint: "none",
            };
          }
          const fastChanges = new Map<string, Record<string, unknown>>();
          const fastEdges: Array<{ key: string; ptsStr: string }> = [];
          for (const rawAct of msg.actions) {
            const act = rawAct as Record<string, unknown>;
            if (act["type"] === "updateProperty" && act["key"] === "vertices" && Array.isArray(act["value"])) {
              const ptsStr = (act["value"] as Array<{ x: number; y: number }>)
                .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
                .map((p) => `${Math.round(p.x)},${Math.round(p.y)}`)
                .join(";");
              if (ptsStr.length > 0 && typeof act["name"] === "string") {
                fastEdges.push({ key: act["name"], ptsStr });
              }
            } else if (
              act["type"] === "updateProperty" &&
              typeof act["name"] === "string" &&
              typeof act["key"] === "string"
            ) {
              const bag = fastChanges.get(act["name"]) ?? {};
              bag[act["key"]] = act["value"];
              fastChanges.set(act["name"], bag);
            } else if (
              act["type"] === "updateParameter" &&
              typeof act["name"] === "string" &&
              typeof act["parameter"] === "string"
            ) {
              const bag = fastChanges.get(act["name"]) ?? {};
              bag[act["parameter"]] = act["value"];
              fastChanges.set(act["name"], bag);
            } else if (act["type"] === "updateName" && typeof act["oldName"] === "string") {
              const bag = fastChanges.get(act["oldName"]) ?? {};
              bag["name"] = act["newName"];
              fastChanges.set(act["oldName"], bag);
            } else if (act["type"] === "move" && Array.isArray(act["items"])) {
              for (const item of act["items"] as Array<{
                id?: string;
                name: string;
                x: number;
                y: number;
                width?: number;
                height?: number;
                connectedOnly?: boolean;
              }>) {
                if (item.connectedOnly) continue;
                const name = item.id || item.name;
                const defaultW = name.startsWith("gen_")
                  ? 48
                  : name.startsWith("load_")
                    ? 84
                    : name.startsWith("shunt_") || name.startsWith("swshunt_")
                      ? 64
                      : 156;
                const defaultH = name.startsWith("gen_")
                  ? 48
                  : name.startsWith("load_") || name.startsWith("shunt_") || name.startsWith("swshunt_")
                    ? 30
                    : 40;
                const bag = fastChanges.get(name) ?? {};
                bag["x"] = Math.round(item.x + (item.width ?? defaultW) / 2);
                bag["y"] = Math.round(item.y + (item.height ?? defaultH) / 2);
                fastChanges.set(name, bag);
              }
            } else if (act["type"] === "resize" && act["item"]) {
              const item = act["item"] as {
                id?: string;
                name: string;
                x: number;
                y: number;
                width?: number;
                height?: number;
              };
              const name = item.id || item.name;
              const bag = fastChanges.get(name) ?? {};
              bag["x"] = Math.round(item.x + (item.width ?? 156) / 2);
              bag["y"] = Math.round(item.y + (item.height ?? 40) / 2);
              fastChanges.set(name, bag);
            } else if (act["type"] === "rotate" && act["item"]) {
              const item = act["item"] as { id?: string; name: string; rotation?: number };
              const name = item.id || item.name;
              const deg = ((Math.round(item.rotation ?? 0) % 360) + 360) % 360;
              const bag = fastChanges.get(name) ?? {};
              bag["orientation"] = deg === 90 || deg === 270 ? 90 : 0;
              fastChanges.set(name, bag);
            } else if (act["type"] === "toggleDisable" && typeof act["name"] === "string") {
              const name = act["name"];
              const disabled = Boolean(act["disabled"]);
              const bag = fastChanges.get(name) ?? {};
              const inService = disabled ? 0 : 1;
              if (name.startsWith("bus_")) bag["ide"] = disabled ? 4 : 1;
              else {
                bag["stat"] = inService;
                bag["status"] = inService;
                bag["st"] = inService;
              }
              fastChanges.set(name, bag);
            } else if (act["type"] === "moveEdge" && Array.isArray(act["edges"])) {
              for (const edge of act["edges"] as Array<{
                id?: string;
                source: string;
                target: string;
                points?: Array<{ x: number; y: number }>;
              }>) {
                const srcBus = edge.source.split(".")[0] ?? edge.source;
                const tgtBus = edge.target.split(".")[0] ?? edge.target;
                const pts = (edge.points ?? []).length > 2 ? edge.points!.slice(1, -1) : (edge.points ?? []);
                const ptsStr = pts
                  .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
                  .map((p) => `${Math.round(p.x)},${Math.round(p.y)}`)
                  .join(";");
                if (ptsStr.length > 0) fastEdges.push({ key: edge.id || `${srcBus}__${tgtBus}`, ptsStr });
              }
            }
          }
          try {
            const edits = planPsseOptimisticEditsOnSession(entry.session, fastChanges, fastEdges);
            if (edits && edits.length > 0) {
              const hasRename = msg.actions.some((a) => a.type === "updateName");
              return {
                type: "applyActionsResult",
                id: msg.id,
                uri: msg.uri,
                version: msg.version,
                handled: true,
                edits,
                renderHint: hasRename ? "immediate" : "none",
              };
            }
          } catch {
            // Fall back to LSP backend if PSSE WASM parser is not yet initialized in worker
          }
          return {
            type: "applyActionsResult",
            id: msg.id,
            uri: msg.uri,
            version: msg.version,
            handled: false,
            edits: [],
            renderHint: "none",
          };
        }

        // Enrich foreign addComponent drops from the cached foreign symbol summary map (zero LSP lookup!)
        const enrichedActions = msg.actions.map((act) => {
          if (act.type === "addComponent") {
            const addAct = act as Extract<DiagramAction, { type: "addComponent" }>;
            if (!addAct.foreignInfo) {
              const info =
                this.foreignSymbols.get(addAct.className) ?? this.foreignSymbols.get(addAct.className.toLowerCase());
              if (info) {
                return { ...addAct, foreignInfo: info };
              }
            }
          }
          return act;
        });

        const result = tryPlanPscadLocalEdits(entry.session, enrichedActions, {
          uri: msg.uri,
          className: msg.className,
        });

        if (!result || result.edits.length === 0) {
          return {
            type: "applyActionsResult",
            id: msg.id,
            uri: msg.uri,
            version: msg.version,
            handled: false,
            edits: [],
            renderHint: "none",
          };
        }

        return {
          type: "applyActionsResult",
          id: msg.id,
          uri: msg.uri,
          version: msg.version,
          handled: true,
          edits: result.edits,
          renderHint: result.renderHint,
        };
      }
    }
  }

  public dispose(): void {
    for (const entry of this.sessions.values()) {
      entry.session.dispose();
    }
    this.sessions.clear();
    this.foreignSymbols.clear();
  }

  private openOrResetSession(
    uri: string,
    langId: string,
    text: string,
    version: number,
  ): { langId: string; session: CstDocumentSession } {
    const prev = this.sessions.get(uri);
    if (prev) prev.session.dispose();
    const normLang = langId.toLowerCase();
    const isXml = XML_CST_LANGS.has(normLang);
    const session = new CstDocumentSession({
      uri,
      text,
      version,
      parser: isXml ? this.xmlParser : (this.recordParsers.get(normLang) ?? null),
      xmlFallback: isXml,
    });
    const entry = { langId: normLang, session };
    this.sessions.set(uri, entry);
    return entry;
  }
}
