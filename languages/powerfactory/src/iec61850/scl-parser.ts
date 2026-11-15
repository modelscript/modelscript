// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * IEC 61850 Substation Configuration Language (SCL) Parser.
 *
 * Ingests SCD, CID, ICD, and SSD substation automation exchange files.
 */

import { parseXml, type XmlElement } from "@modelscript/dsl/xml";
import type {
  LogicalNodeClass,
  SclAccessPoint,
  SclBay,
  SclCommunicationSubNetwork,
  SclConductingEquipment,
  SclConductingEquipmentType,
  SclDataSet,
  SclDocument,
  SclIED,
  SclLogicalDevice,
  SclLogicalNode,
  SclSubstation,
  SclVoltageLevel,
} from "./scl-types.js";

function localName(name: string): string {
  const idx = name.indexOf(":");
  return idx >= 0 ? name.slice(idx + 1) : name;
}

function matchTag(el: XmlElement, target: string): boolean {
  const local = localName(el.name);
  return local === target || local.toLowerCase() === target.toLowerCase();
}

function getAttr(el: XmlElement, name: string): string | undefined {
  const exact = el.attributes.find((a) => a.name === name);
  if (exact) return exact.value;
  const targetLocal = localName(name);
  return el.attributes.find((a) => localName(a.name) === targetLocal)?.value;
}

function findFirst(root: XmlElement, tagName: string): XmlElement | undefined {
  if (matchTag(root, tagName)) return root;
  for (const child of root.children) {
    const found = findFirst(child, tagName);
    if (found) return found;
  }
  return undefined;
}

function findDescendants(root: XmlElement, tagName: string): XmlElement[] {
  const out: XmlElement[] = [];
  for (const child of root.children) {
    if (matchTag(child, tagName)) {
      out.push(child);
    } else {
      out.push(...findDescendants(child, tagName));
    }
  }
  return out;
}

function collectLnElements(ldEl: XmlElement): XmlElement[] {
  const out: XmlElement[] = [];
  for (const child of ldEl.children) {
    const upper = localName(child.name).toUpperCase();
    if (upper === "LN0" || upper === "LN") {
      out.push(child);
    } else {
      out.push(...collectLnElements(child));
    }
  }
  return out;
}

/**
 * Parses an SCL XML string into an in-memory SclDocument.
 */
export function parseSclXml(xmlText: string): SclDocument {
  const doc: SclDocument = {
    header: {
      id: "SCL_Project",
      version: "2.0",
      revision: "1.0",
    },
    ieds: new Map<string, SclIED>(),
  };

  const xmlDoc = parseXml(xmlText);
  const root = xmlDoc.root;
  if (!root) return doc;

  // 1. Header
  const headerEl = findFirst(root, "Header");
  if (headerEl && headerEl.attributes.length > 0) {
    doc.header = {
      id: getAttr(headerEl, "id") || "SCL_Project",
      version: getAttr(headerEl, "version") || "2.0",
      revision: getAttr(headerEl, "revision") || "1.0",
      toolId: getAttr(headerEl, "toolID"),
    };
  }

  // 2. Substation
  const substatEl = findFirst(root, "Substation");
  if (substatEl) {
    const substation: SclSubstation = {
      name: getAttr(substatEl, "name") || "Substation",
      desc: getAttr(substatEl, "desc"),
      voltageLevels: [],
    };

    for (const vlEl of findDescendants(substatEl, "VoltageLevel")) {
      let nomKv = 110.0;
      const voltageEl = findFirst(vlEl, "Voltage");
      if (voltageEl) {
        const vText = voltageEl.text.trim();
        if (vText) {
          const rawV = parseFloat(vText);
          const mult = getAttr(voltageEl, "multiplier") || "";
          nomKv = mult === "k" ? rawV : rawV / 1000;
        }
      }

      const vl: SclVoltageLevel = {
        name: getAttr(vlEl, "name") || "110kV",
        nomVoltageKv: nomKv,
        nomFreqHz: parseFloat(getAttr(vlEl, "nomFreq") || "50"),
        bays: [],
      };

      for (const bayEl of findDescendants(vlEl, "Bay")) {
        const bay: SclBay = {
          name: getAttr(bayEl, "name") || "Bay",
          desc: getAttr(bayEl, "desc"),
          conductingEquipment: [],
          connectivityNodes: [],
        };

        for (const ceEl of findDescendants(bayEl, "ConductingEquipment")) {
          const ceType = (getAttr(ceEl, "type") || "CBR") as SclConductingEquipmentType;
          const ce: SclConductingEquipment = {
            name: getAttr(ceEl, "name") || "CE",
            type: ceType,
            desc: getAttr(ceEl, "desc"),
            lNodes: [],
          };

          for (const lnEl of findDescendants(ceEl, "LNode")) {
            const iedName = getAttr(lnEl, "iedName");
            const lnClass = getAttr(lnEl, "lnClass");
            if (iedName && lnClass) {
              ce.lNodes.push({
                iedName,
                lnClass,
                lnInst: getAttr(lnEl, "lnInst") || "",
                prefix: getAttr(lnEl, "prefix"),
              });
            }
          }

          bay.conductingEquipment.push(ce);
        }

        for (const cnEl of findDescendants(bayEl, "ConnectivityNode")) {
          const cnName = getAttr(cnEl, "name");
          if (cnName) bay.connectivityNodes.push(cnName);
        }

        vl.bays.push(bay);
      }

      substation.voltageLevels.push(vl);
    }

    doc.substation = substation;
  }

  // 3. Communication
  const commEl = findFirst(root, "Communication");
  if (commEl && !commEl.selfClosing && (commEl.children.length > 0 || commEl.text.length > 0)) {
    const subnets: SclCommunicationSubNetwork[] = [];

    for (const snEl of findDescendants(commEl, "SubNetwork")) {
      const subNet: SclCommunicationSubNetwork = {
        name: getAttr(snEl, "name") || "SubNet",
        type: getAttr(snEl, "type") || "8-MMS",
        connectedAPs: [],
      };

      for (const apEl of findDescendants(snEl, "ConnectedAP")) {
        let ipAddress: string | undefined;
        let subnetMask: string | undefined;

        for (const pEl of findDescendants(apEl, "P")) {
          const pType = getAttr(pEl, "type") || "";
          const pVal = pEl.text.trim();
          if (pType === "IP") ipAddress = pVal;
          if (pType === "IP-SUBNET") subnetMask = pVal;
        }

        const iedName = getAttr(apEl, "iedName");
        const apName = getAttr(apEl, "apName");
        if (iedName && apName) {
          subNet.connectedAPs.push({
            iedName,
            apName,
            ipAddress,
            subnetMask,
          });
        }
      }

      subnets.push(subNet);
    }

    doc.communication = { subNetworks: subnets };
  }

  // 4. IEDs
  for (const iedEl of findDescendants(root, "IED")) {
    const iedName = getAttr(iedEl, "name");
    if (!iedName) continue;

    const ied: SclIED = {
      name: iedName,
      type: getAttr(iedEl, "type"),
      manufacturer: getAttr(iedEl, "manufacturer"),
      configVersion: getAttr(iedEl, "configVersion"),
      desc: getAttr(iedEl, "desc"),
      accessPoints: [],
    };

    for (const apEl of findDescendants(iedEl, "AccessPoint")) {
      const ap: SclAccessPoint = {
        name: getAttr(apEl, "name") || "P1",
        router: getAttr(apEl, "router") === "true",
      };

      const serverEl = findFirst(apEl, "Server");
      if (serverEl && !serverEl.selfClosing && (serverEl.children.length > 0 || serverEl.text.length > 0)) {
        const lDevices: SclLogicalDevice[] = [];

        for (const ldEl of findDescendants(serverEl, "LDevice")) {
          const ld: SclLogicalDevice = {
            inst: getAttr(ldEl, "inst") || "LD0",
            desc: getAttr(ldEl, "desc"),
            logicalNodes: [],
          };

          for (const lnEl of collectLnElements(ldEl)) {
            const isLn0 = localName(lnEl.name).toUpperCase() === "LN0";
            const lnClass = (isLn0 ? "LLN0" : getAttr(lnEl, "lnClass") || "XCBR") as LogicalNodeClass;
            const lnInst = getAttr(lnEl, "inst") || "";

            const ln: SclLogicalNode = {
              lnClass,
              inst: lnInst,
              prefix: getAttr(lnEl, "prefix"),
              lnType: getAttr(lnEl, "lnType"),
              desc: getAttr(lnEl, "desc"),
              dataSets: [],
              gseControls: [],
              smvControls: [],
              inputs: [],
            };

            for (const dsEl of findDescendants(lnEl, "DataSet")) {
              const ds: SclDataSet = {
                name: getAttr(dsEl, "name") || "ds1",
                desc: getAttr(dsEl, "desc"),
                fcdaList: [],
              };

              for (const fEl of findDescendants(dsEl, "FCDA")) {
                const ldInst = getAttr(fEl, "ldInst");
                const fLnClass = getAttr(fEl, "lnClass");
                const doName = getAttr(fEl, "doName");
                const fc = getAttr(fEl, "fc");
                if (ldInst && fLnClass && doName && fc) {
                  ds.fcdaList.push({
                    ldInst,
                    prefix: getAttr(fEl, "prefix"),
                    lnClass: fLnClass,
                    lnInst: getAttr(fEl, "lnInst"),
                    doName,
                    daName: getAttr(fEl, "daName"),
                    fc,
                  });
                }
              }

              ln.dataSets.push(ds);
            }

            for (const gEl of findDescendants(lnEl, "GSEControl")) {
              const gName = getAttr(gEl, "name");
              const appID = getAttr(gEl, "appID");
              if (gName && appID) {
                ln.gseControls.push({
                  name: gName,
                  appID,
                  datSet: getAttr(gEl, "datSet") || "",
                  confRev: parseInt(getAttr(gEl, "confRev") || "1", 10),
                  type: (getAttr(gEl, "type") || "GOOSE") as "GOOSE" | "GSSE",
                });
              }
            }

            for (const sEl of findDescendants(lnEl, "SampledValueControl")) {
              const sName = getAttr(sEl, "name");
              const smvID = getAttr(sEl, "smvID");
              if (sName && smvID) {
                ln.smvControls.push({
                  name: sName,
                  smvID,
                  datSet: getAttr(sEl, "datSet") || "",
                  confRev: parseInt(getAttr(sEl, "confRev") || "1", 10),
                  smpRate: parseInt(getAttr(sEl, "smpRate") || "4800", 10),
                });
              }
            }

            for (const eEl of findDescendants(lnEl, "ExtRef")) {
              const refIedName = getAttr(eEl, "iedName");
              if (refIedName) {
                ln.inputs.push({
                  iedName: refIedName,
                  ldInst: getAttr(eEl, "ldInst"),
                  prefix: getAttr(eEl, "prefix"),
                  lnClass: getAttr(eEl, "lnClass"),
                  lnInst: getAttr(eEl, "lnInst"),
                  doName: getAttr(eEl, "doName"),
                  daName: getAttr(eEl, "daName"),
                  serviceType: (getAttr(eEl, "serviceType") || "GOOSE") as "GOOSE" | "SMV" | "Report",
                });
              }
            }

            if (isLn0) {
              ld.ln0 = ln;
            } else {
              ld.logicalNodes.push(ln);
            }
          }

          lDevices.push(ld);
        }

        ap.server = { logicalDevices: lDevices };
      }

      ied.accessPoints.push(ap);
    }

    doc.ieds.set(iedName, ied);
  }

  return doc;
}
