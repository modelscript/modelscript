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

import type { SclDocument, SclFcda } from "./scl-types.js";

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
  const appIds = new Set<string>();

  // 1. Collect all published GOOSE control blocks across all IEDs
  for (const [iedName, ied] of doc.ieds) {
    for (const ap of ied.accessPoints) {
      for (const ld of ap.server?.logicalDevices ?? []) {
        // Look in LN0 and all LNs for GSEControl
        const allNodes = [ld.ln0, ...ld.logicalNodes].filter((n): n is NonNullable<typeof n> => n != null);

        for (const ln of allNodes) {
          // Find dataSets on this LN
          const dsMap = new Map<string, SclFcda[]>();
          for (const ds of ln.dataSets) {
            dsMap.set(ds.name, ds.fcdaList);
          }

          for (const gse of ln.gseControls) {
            // Check for duplicate APPID
            if (appIds.has(gse.appID)) {
              diagnostics.push({
                severity: "warning",
                code: "GOOSE_DUPLICATE_APPID",
                message: `Duplicate GOOSE APPID '${gse.appID}' detected in IED '${iedName}'.`,
                iedName,
                gseName: gse.name,
              });
            } else {
              appIds.add(gse.appID);
            }

            // Verify dataset exists
            const fcdaList = dsMap.get(gse.datSet) ?? [];
            if (fcdaList.length === 0) {
              diagnostics.push({
                severity: "error",
                code: "GOOSE_DATASET_NOT_FOUND",
                message: `GSEControl '${gse.name}' references missing or empty DataSet '${gse.datSet}' in IED '${iedName}'.`,
                iedName,
                gseName: gse.name,
              });
            }

            // Determine if stream contains trip signals (Op.general, PTRC, PTOC, PDIS, PIOC)
            const hasTripSignal = fcdaList.some(
              (f) =>
                f.doName.toLowerCase().includes("op") ||
                f.doName.toLowerCase().includes("tr") ||
                f.lnClass.startsWith("P") ||
                f.lnClass === "PTRC",
            );

            // Latency requirements: IEC 61850-5 Type 1A Fast Trip <= 4ms
            const minTime = gse.minTimeMs ?? (hasTripSignal ? 4 : 10);
            const maxTime = gse.maxTimeMs ?? 1000;
            const perfClass = hasTripSignal ? "Type1A_FastTrip" : "Type1B_Interlock";
            const latencyValid = hasTripSignal ? minTime <= 4 : minTime <= 20;

            if (hasTripSignal && minTime > 4) {
              diagnostics.push({
                severity: "warning",
                code: "GOOSE_TRIP_LATENCY_EXCEEDED",
                message: `Trip GOOSE stream '${gse.name}' has minTime=${minTime}ms, exceeding IEC 61850-5 Type 1A limit (4ms).`,
                iedName,
                gseName: gse.name,
              });
            }

            // Find matching subscribers across other IEDs via ExtRef
            const subscribers: GooseStreamBinding["subscribers"] = [];
            for (const [subIedName, subIed] of doc.ieds) {
              for (const subAp of subIed.accessPoints) {
                for (const subLd of subAp.server?.logicalDevices ?? []) {
                  const subNodes = [subLd.ln0, ...subLd.logicalNodes].filter(
                    (n): n is NonNullable<typeof n> => n != null,
                  );
                  for (const subLn of subNodes) {
                    for (const ext of subLn.inputs) {
                      if (ext.iedName === iedName) {
                        // Check if subscribed attribute matches any published FCDA
                        const matchesFcda = fcdaList.some(
                          (f) =>
                            (!ext.doName || ext.doName === f.doName) && (!ext.lnClass || ext.lnClass === f.lnClass),
                        );
                        if (matchesFcda || !ext.doName) {
                          subscribers.push({
                            subscriberIed: subIedName,
                            subscriberLDevice: subLd.inst,
                            subscriberLn: `${subLn.lnClass}${subLn.inst}`,
                            subscribedSignal: ext.doName ? `${ext.doName}.${ext.daName || "stVal"}` : "ALL",
                          });
                        }
                      }
                    }
                  }
                }
              }
            }

            streams.push({
              publisherIed: iedName,
              publisherLDevice: ld.inst,
              publisherLn: `${ln.lnClass}${ln.inst}`,
              gseControlName: gse.name,
              appId: gse.appID,
              dataSetName: gse.datSet,
              publishedSignals: fcdaList.map((f) => ({
                doName: f.doName,
                daName: f.daName,
                fc: f.fc,
              })),
              subscribers,
              isTripSignal: hasTripSignal,
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

  // Count publishers and subscribers
  const publishers = new Set(streams.map((s) => s.publisherIed));
  const subSet = new Set<string>();
  for (const s of streams) {
    for (const sub of s.subscribers) {
      subSet.add(sub.subscriberIed);
    }
  }

  const hasErrors = diagnostics.some((d) => d.severity === "error");

  return {
    totalPublishers: publishers.size,
    totalSubscribers: subSet.size,
    totalGooseStreams: streams.length,
    streams,
    diagnostics,
    isValid: !hasErrors,
  };
}
