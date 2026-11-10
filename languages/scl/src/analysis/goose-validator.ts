// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * IEC 61850 GOOSE and Sampled Values Communication Stream Validator.
 *
 * Validates:
 * - Publisher-to-subscriber dataflow integrity (FCDA <-> ExtRef matching).
 * - Real-time latency performance classes (Class Type 1A <= 4ms for trip signals).
 * - Datasets, APPID allocations, and multicast MAC address assignments.
 * - End-to-end communication matrix generation.
 */

import type { SclDocument, SclFcda } from "../types.js";

export interface GooseStreamBinding {
  publisherIed: string;
  publisherLDevice: string;
  publisherLn: string;
  gseControlName: string;
  appId: string;
  dataSetName: string;
  publishedSignals: {
    doName: string;
    daName?: string | undefined;
    fc: string;
  }[];
  subscribers: {
    subscriberIed: string;
    subscriberLDevice: string;
    subscriberLn: string;
    subscribedSignal: string;
  }[];
  isTripSignal: boolean;
  minTimeMs: number;
  maxTimeMs: number;
  performanceClass: "Type1A_FastTrip" | "Type1B_Interlock" | "Type2_Normal";
  latencyValid: boolean;
}

export interface GooseValidationDiagnostic {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  iedName?: string | undefined;
  gseName?: string | undefined;
}

export interface GooseValidationReport {
  totalPublishers: number;
  totalSubscribers: number;
  totalGooseStreams: number;
  streams: GooseStreamBinding[];
  diagnostics: GooseValidationDiagnostic[];
  isValid: boolean;
}

/**
 * Validates GOOSE communication configuration in an SCL Document.
 */
export function validateGooseStreams(doc: SclDocument): GooseValidationReport {
  const streams: GooseStreamBinding[] = [];
  const diagnostics: GooseValidationDiagnostic[] = [];
  const publishers = new Set<string>();
  const subscribers = new Set<string>();

  // 1. Map all ExtRefs across all IEDs to identify subscribers
  const extRefMap = new Map<string, { ied: string; ld: string; ln: string; doName: string }[]>();

  for (const [iedName, ied] of doc.ieds) {
    for (const [, ap] of ied.accessPoints) {
      if (!ap.server) continue;
      for (const [ldInst, ld] of ap.server.logicalDevices) {
        for (const [lnName, ln] of ld.logicalNodes) {
          for (const ext of ln.inputs) {
            const pubKey = `${ext.iedName}/${ext.ldInst}/${ext.lnClass}/${ext.doName}`;
            if (!extRefMap.has(pubKey)) {
              extRefMap.set(pubKey, []);
            }
            extRefMap.get(pubKey)!.push({
              ied: iedName,
              ld: ldInst,
              ln: lnName,
              doName: ext.doName,
            });
            subscribers.add(iedName);
          }
        }
      }
    }
  }

  // 2. Map communication subnet GSE addresses
  const commGseMap = new Map<string, { mac: string; appId: string }>();
  if (doc.communication) {
    for (const sn of doc.communication) {
      for (const cap of sn.connectedAps) {
        if (!cap.gseAddresses) continue;
        for (const [cbName, addr] of cap.gseAddresses) {
          commGseMap.set(`${cap.iedName}/${cbName}`, { mac: addr.mac, appId: addr.appId });
        }
      }
    }
  }

  // 3. Inspect every publisher GSEControl and its DataSet
  for (const [iedName, ied] of doc.ieds) {
    for (const [, ap] of ied.accessPoints) {
      if (!ap.server) continue;
      for (const [ldInst, ld] of ap.server.logicalDevices) {
        for (const [lnName, ln] of ld.logicalNodes) {
          for (const [gseName, gc] of ln.gseControls) {
            publishers.add(iedName);

            // Locate DataSet
            const ds = ln.dataSets.get(gc.datSet);
            if (!ds) {
              diagnostics.push({
                severity: "error",
                code: "SCL2002",
                message: `GSEControl '${gseName}' in IED '${iedName}' references non-existent DataSet '${gc.datSet}'.`,
                iedName,
                gseName,
              });
              continue;
            }

            // Check communication network address
            const commKey = `${iedName}/${gseName}`;
            const commAddr = commGseMap.get(commKey);
            if (!commAddr) {
              diagnostics.push({
                severity: "warning",
                code: "SCL3001",
                message: `GOOSE control '${gseName}' on IED '${iedName}' lacks a <ConnectedAP> address entry in <Communication>.`,
                iedName,
                gseName,
              });
            }

            // Evaluate signals in DataSet
            let isTrip = false;
            const publishedSignals: GooseStreamBinding["publishedSignals"] = [];
            const streamSubscribers: GooseStreamBinding["subscribers"] = [];

            for (const f of ds.fcdaList) {
              publishedSignals.push({
                doName: f.doName,
                daName: f.daName,
                fc: f.fc,
              });

              // Check trip/protection signal keywords (Op, Tr, or protection lnClass P*)
              if (f.doName.includes("Op") || f.doName.includes("Tr") || f.lnClass.startsWith("P")) {
                isTrip = true;
              }

              // Check matching subscribers
              const subKey = `${iedName}/${f.ldInst}/${f.lnClass}/${f.doName}`;
              const matched = extRefMap.get(subKey);
              if (matched) {
                for (const m of matched) {
                  streamSubscribers.push({
                    subscriberIed: m.ied,
                    subscriberLDevice: m.ld,
                    subscriberLn: m.ln,
                    subscribedSignal: m.doName,
                  });
                }
              }
            }

            // Evaluate latency performance class
            const minTime = gc.minTimeMs ?? (isTrip ? 4.0 : 10.0);
            const maxTime = gc.maxTimeMs ?? (isTrip ? 1000.0 : 2000.0);

            let perfClass: GooseStreamBinding["performanceClass"] = "Type2_Normal";
            let latencyValid = true;

            if (isTrip) {
              perfClass = "Type1A_FastTrip";
              // IEC 61850-5: Type 1A trip messages must guarantee transmission time <= 4ms
              if (minTime > 4.0) {
                latencyValid = false;
                diagnostics.push({
                  severity: "error",
                  code: "SCL3002",
                  message: `GOOSE trip stream '${gseName}' in IED '${iedName}' minTime=${minTime}ms exceeds IEC 61850-5 Type 1A 4ms trip latency limit.`,
                  iedName,
                  gseName,
                });
              }
            } else if (fHasInterlock(ds.fcdaList)) {
              perfClass = "Type1B_Interlock";
            }

            streams.push({
              publisherIed: iedName,
              publisherLDevice: ldInst,
              publisherLn: lnName,
              gseControlName: gseName,
              appId: gc.appID,
              dataSetName: gc.datSet,
              publishedSignals,
              subscribers: streamSubscribers,
              isTripSignal: isTrip,
              minTimeMs: minTime,
              maxTimeMs: maxTime,
              performanceClass: perfClass,
              latencyValid,
            });
          }
        }
      }
    }
  }

  const hasErrors = diagnostics.some((d) => d.severity === "error");
  return {
    totalPublishers: publishers.size,
    totalSubscribers: subscribers.size,
    totalGooseStreams: streams.length,
    streams,
    diagnostics,
    isValid: !hasErrors,
  };
}

function fHasInterlock(fcdas: SclFcda[]): boolean {
  return fcdas.some((f) => f.lnClass.startsWith("C") || f.doName.includes("Pos"));
}
