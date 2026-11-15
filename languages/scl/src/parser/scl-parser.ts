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
  SclFcda,
  SclGseControl,
  SclIED,
  SclLogicalDevice,
  SclLogicalNode,
  SclSampledValueControl,
  SclSubstation,
  SclVoltageLevel,
} from "../types.js";

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
  const localMatch = el.attributes.find((a) => localName(a.name) === targetLocal);
  if (localMatch) return localMatch.value;
  return undefined;
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
  if (!root) {
    doc.header = {
      id: "",
      version: "2.0",
      revision: "1.0",
    };
    return doc;
  }

  // 1. Header
  const headerEl = findFirst(root, "Header");
  if (headerEl && headerEl.attributes.length > 0) {
    const headerId = getAttr(headerEl, "id");
    doc.header = {
      id: headerId !== undefined ? headerId : "SCL_Project",
      version: getAttr(headerEl, "version") || "2.0",
      revision: getAttr(headerEl, "revision") || "1.0",
      toolId: getAttr(headerEl, "toolID"),
    };
  } else {
    doc.header = {
      id: "",
      version: "2.0",
      revision: "1.0",
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
        desc: getAttr(vlEl, "desc"),
        nominalVoltageKv: nomKv,
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
            terminals: [],
            lnReferences: [],
          };

          for (const termEl of findDescendants(ceEl, "Terminal")) {
            const cNodeName = getAttr(termEl, "cNodeName");
            ce.terminals.push({
              name: getAttr(termEl, "name") || `T${ce.terminals.length + 1}`,
              connectivityNode: getAttr(termEl, "connectivityNode") || cNodeName || "",
              substationName: getAttr(termEl, "substationName"),
              voltageLevelName: getAttr(termEl, "voltageLevelName"),
              bayName: getAttr(termEl, "bayName"),
              cNodeName,
            });
          }

          for (const lnEl of findDescendants(ceEl, "LNode")) {
            const lnRef = `${getAttr(lnEl, "iedName") || ""}/${getAttr(lnEl, "lnClass") || ""}${getAttr(lnEl, "lnInst") || ""}`;
            ce.lnReferences?.push(lnRef);
          }

          bay.conductingEquipment.push(ce);
        }

        for (const cnEl of findDescendants(bayEl, "ConnectivityNode")) {
          const cnName = getAttr(cnEl, "name");
          if (cnName) {
            bay.connectivityNodes.push({
              name: cnName,
              pathName: getAttr(cnEl, "pathName") || `${substation.name}/${vl.name}/${bay.name}/${cnName}`,
              desc: getAttr(cnEl, "desc"),
            });
          }
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
    doc.communication = [];
    for (const snEl of findDescendants(commEl, "SubNetwork")) {
      const subNetwork: SclCommunicationSubNetwork = {
        name: getAttr(snEl, "name") || "SubNetwork",
        type: getAttr(snEl, "type"),
        connectedAps: [],
      };

      for (const capEl of findDescendants(snEl, "ConnectedAP")) {
        const gseMap = new Map<
          string,
          { mac: string; appId: string; vlanId?: string | undefined; vlanPriority?: number | undefined }
        >();

        for (const gseEl of findDescendants(capEl, "GSE")) {
          const cbName = getAttr(gseEl, "cbName") || "GSE1";
          let mac = "01-0C-CD-01-00-01";
          let appId = "0001";
          let vlanId: string | undefined;
          let vlanPriority: number | undefined;

          for (const pEl of findDescendants(gseEl, "P")) {
            const pType = getAttr(pEl, "type");
            if (pType === undefined) continue;
            const val = pEl.text.trim();
            if (pType === "MAC-Address") mac = val;
            else if (pType === "APPID") appId = val;
            else if (pType === "VLAN-ID") vlanId = val;
            else if (pType === "VLAN-PRIORITY") vlanPriority = parseInt(val, 10);
          }

          gseMap.set(cbName, { mac, appId, vlanId, vlanPriority });
        }

        subNetwork.connectedAps.push({
          iedName: getAttr(capEl, "iedName") || "IED",
          apName: getAttr(capEl, "apName") || "AP1",
          gseAddresses: gseMap,
        });
      }

      doc.communication.push(subNetwork);
    }
  }

  // 4. IEDs
  for (const iedEl of findDescendants(root, "IED")) {
    const iedName = getAttr(iedEl, "name") || "IED1";

    const ied: SclIED = {
      name: iedName,
      desc: getAttr(iedEl, "desc"),
      type: getAttr(iedEl, "type"),
      manufacturer: getAttr(iedEl, "manufacturer"),
      configVersion: getAttr(iedEl, "configVersion"),
      accessPoints: new Map<string, SclAccessPoint>(),
    };

    for (const apEl of findDescendants(iedEl, "AccessPoint")) {
      const apName = getAttr(apEl, "name") || "AP1";
      const accessPoint: SclAccessPoint = {
        name: apName,
        desc: getAttr(apEl, "desc"),
        server: {
          logicalDevices: new Map<string, SclLogicalDevice>(),
        },
      };

      for (const ldEl of findDescendants(apEl, "LDevice")) {
        const ldInst = getAttr(ldEl, "inst") || "LD0";
        const lDevice: SclLogicalDevice = {
          inst: ldInst,
          desc: getAttr(ldEl, "desc"),
          logicalNodes: new Map<string, SclLogicalNode>(),
        };

        for (const lnEl of collectLnElements(ldEl)) {
          const isLn0 = localName(lnEl.name).toUpperCase() === "LN0";
          const lnClass = (isLn0 ? "LLN0" : getAttr(lnEl, "lnClass") || "LPHD") as LogicalNodeClass;
          const inst = isLn0 ? "" : getAttr(lnEl, "inst") || "1";
          const prefix = getAttr(lnEl, "prefix");
          const lnKey = prefix ? `${prefix}${lnClass}${inst}` : `${lnClass}${inst}`;

          const logicalNode: SclLogicalNode = {
            lnClass,
            inst,
            prefix,
            lnType: getAttr(lnEl, "lnType") || `${lnClass}_Type`,
            desc: getAttr(lnEl, "desc"),
            dataSets: new Map<string, SclDataSet>(),
            gseControls: new Map<string, SclGseControl>(),
            smvControls: new Map<string, SclSampledValueControl>(),
            inputs: [],
          };

          for (const dsEl of findDescendants(lnEl, "DataSet")) {
            const dsName = getAttr(dsEl, "name") || "DataSet1";
            const fcdaList: SclFcda[] = [];

            for (const fEl of findDescendants(dsEl, "FCDA")) {
              fcdaList.push({
                ldInst: getAttr(fEl, "ldInst") || ldInst,
                prefix: getAttr(fEl, "prefix"),
                lnClass: getAttr(fEl, "lnClass") || "LLN0",
                lnInst: getAttr(fEl, "lnInst"),
                doName: getAttr(fEl, "doName") || "Pos",
                daName: getAttr(fEl, "daName"),
                fc: getAttr(fEl, "fc") || "ST",
              });
            }

            logicalNode.dataSets.set(dsName, {
              name: dsName,
              desc: getAttr(dsEl, "desc"),
              fcdaList,
            });
          }

          for (const gcEl of findDescendants(lnEl, "GSEControl")) {
            const gcName = getAttr(gcEl, "name") || "GC1";
            const minTimeRaw = getAttr(gcEl, "minTime");
            const maxTimeRaw = getAttr(gcEl, "maxTime");
            logicalNode.gseControls.set(gcName, {
              name: gcName,
              appID: getAttr(gcEl, "appID") || gcName,
              datSet: getAttr(gcEl, "datSet") || "",
              confRev: parseInt(getAttr(gcEl, "confRev") || "1", 10),
              type: getAttr(gcEl, "type") === "GSSE" ? "GSSE" : "GOOSE",
              minTimeMs: minTimeRaw ? parseFloat(minTimeRaw) : undefined,
              maxTimeMs: maxTimeRaw ? parseFloat(maxTimeRaw) : undefined,
            });
          }

          for (const inputsEl of findDescendants(lnEl, "Inputs")) {
            for (const eEl of findDescendants(inputsEl, "ExtRef")) {
              const iedRef = getAttr(eEl, "iedName");
              const lnClassRef = getAttr(eEl, "lnClass");
              const doNameRef = getAttr(eEl, "doName");
              if (iedRef && lnClassRef && doNameRef) {
                logicalNode.inputs.push({
                  iedName: iedRef,
                  ldInst: getAttr(eEl, "ldInst") || "",
                  prefix: getAttr(eEl, "prefix"),
                  lnClass: lnClassRef,
                  lnInst: getAttr(eEl, "lnInst"),
                  doName: doNameRef,
                  daName: getAttr(eEl, "daName"),
                  intAddr: getAttr(eEl, "intAddr"),
                  serviceType: (getAttr(eEl, "serviceType") as "GOOSE" | "SMV" | "Report" | undefined) || "GOOSE",
                });
              }
            }
          }

          lDevice.logicalNodes.set(lnKey, logicalNode);
        }

        accessPoint.server?.logicalDevices.set(ldInst, lDevice);
      }

      ied.accessPoints.set(apName, accessPoint);
    }

    doc.ieds.set(iedName, ied);
  }

  return doc;
}
