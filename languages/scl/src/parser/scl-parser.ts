// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * IEC 61850 Substation Configuration Language (SCL) Parser.
 *
 * Ingests SCD, CID, ICD, and SSD substation automation exchange files.
 */

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

/** Helper to parse attributes on an XML tag */
function parseXmlAttrs(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([a-zA-Z0-9_:-]+)\s*=\s*["']([^"']*)["']/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(attrString)) !== null) {
    const key = match[1]!;
    attrs[key] = match[2]!;
  }
  return attrs;
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

  // 1. Header
  const headerMatch = /<Header\b([^>]*)>/i.exec(xmlText);
  if (headerMatch && headerMatch[1]) {
    const attrs = parseXmlAttrs(headerMatch[1]);
    doc.header = {
      id: attrs["id"] !== undefined ? attrs["id"] : "SCL_Project",
      version: attrs["version"] || "2.0",
      revision: attrs["revision"] || "1.0",
      toolId: attrs["toolID"],
    };
  } else {
    doc.header = {
      id: "",
      version: "2.0",
      revision: "1.0",
    };
  }

  // 2. Substation
  const substatMatch = /<Substation\b([^>]*)>([\s\S]*?)<\/Substation>/i.exec(xmlText);
  if (substatMatch && substatMatch[1]) {
    const sAttrs = parseXmlAttrs(substatMatch[1]);
    const sContent = substatMatch[2] || "";
    const substation: SclSubstation = {
      name: sAttrs["name"] || "Substation",
      desc: sAttrs["desc"],
      voltageLevels: [],
    };

    // VoltageLevel
    const vlRegex = /<VoltageLevel\b([^>]*)>([\s\S]*?)<\/VoltageLevel>/gi;
    let vlMatch: RegExpExecArray | null;
    while ((vlMatch = vlRegex.exec(sContent)) !== null) {
      const vlAttrs = parseXmlAttrs(vlMatch[1] || "");
      const vlContent = vlMatch[2] || "";

      let nomKv = 110.0;
      const vMatch = /<Voltage\b([^>]*)>([^<]*)<\/Voltage>/i.exec(vlContent);
      if (vMatch && vMatch[2]) {
        const vAttrs = parseXmlAttrs(vMatch[1] || "");
        const rawV = parseFloat(vMatch[2]);
        const mult = vAttrs["multiplier"] || "";
        nomKv = mult === "k" ? rawV : rawV / 1000;
      }

      const vl: SclVoltageLevel = {
        name: vlAttrs["name"] || "110kV",
        desc: vlAttrs["desc"],
        nominalVoltageKv: nomKv,
        bays: [],
      };

      // Bays
      const bayRegex = /<Bay\b([^>]*)>([\s\S]*?)<\/Bay>/gi;
      let bayMatch: RegExpExecArray | null;
      while ((bayMatch = bayRegex.exec(vlContent)) !== null) {
        const bayAttrs = parseXmlAttrs(bayMatch[1] || "");
        const bayContent = bayMatch[2] || "";

        const bay: SclBay = {
          name: bayAttrs["name"] || "Bay",
          desc: bayAttrs["desc"],
          conductingEquipment: [],
          connectivityNodes: [],
        };

        // ConductingEquipment
        const ceRegex = /<ConductingEquipment\b([^>]*?)(?:\/>|>([\s\S]*?)<\/ConductingEquipment>)/gi;
        let ceMatch: RegExpExecArray | null;
        while ((ceMatch = ceRegex.exec(bayContent)) !== null) {
          const ceAttrs = parseXmlAttrs(ceMatch[1] || "");
          const ceContent = ceMatch[2] || "";
          const ceType = (ceAttrs["type"] || "CBR") as SclConductingEquipmentType;

          const ce: SclConductingEquipment = {
            name: ceAttrs["name"] || "CE",
            type: ceType,
            desc: ceAttrs["desc"],
            terminals: [],
            lnReferences: [],
          };

          // Terminals
          const termRegex = /<Terminal\b([^>]*)\/?>/gi;
          let termMatch: RegExpExecArray | null;
          while ((termMatch = termRegex.exec(ceContent)) !== null) {
            const tAttrs = parseXmlAttrs(termMatch[1] || "");
            ce.terminals.push({
              name: tAttrs["name"] || `T${ce.terminals.length + 1}`,
              connectivityNode: tAttrs["connectivityNode"] || tAttrs["cNodeName"] || "",
              substationName: tAttrs["substationName"],
              voltageLevelName: tAttrs["voltageLevelName"],
              bayName: tAttrs["bayName"],
              cNodeName: tAttrs["cNodeName"],
            });
          }

          // LNodes
          const lnRegex = /<LNode\b([^>]*)\/?>/gi;
          let lnMatch: RegExpExecArray | null;
          while ((lnMatch = lnRegex.exec(ceContent)) !== null) {
            const lnAttrs = parseXmlAttrs(lnMatch[1] || "");
            const lnRef = `${lnAttrs["iedName"] || ""}/${lnAttrs["lnClass"] || ""}${lnAttrs["lnInst"] || ""}`;
            ce.lnReferences?.push(lnRef);
          }

          bay.conductingEquipment.push(ce);
        }

        // ConnectivityNodes
        const cnRegex = /<ConnectivityNode\b([^>]*)\/?>/gi;
        let cnMatch: RegExpExecArray | null;
        while ((cnMatch = cnRegex.exec(bayContent)) !== null) {
          const cnAttrs = parseXmlAttrs(cnMatch[1] || "");
          if (cnAttrs["name"]) {
            bay.connectivityNodes.push({
              name: cnAttrs["name"],
              pathName: cnAttrs["pathName"] || `${substation.name}/${vl.name}/${bay.name}/${cnAttrs["name"]}`,
              desc: cnAttrs["desc"],
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
  const commMatch = /<Communication\b[^>]*>([\s\S]*?)<\/Communication>/i.exec(xmlText);
  if (commMatch && commMatch[1]) {
    doc.communication = [];
    const snRegex = /<SubNetwork\b([^>]*)>([\s\S]*?)<\/SubNetwork>/gi;
    let snMatch: RegExpExecArray | null;
    while ((snMatch = snRegex.exec(commMatch[1])) !== null) {
      const snAttrs = parseXmlAttrs(snMatch[1] || "");
      const snContent = snMatch[2] || "";

      const subNetwork: SclCommunicationSubNetwork = {
        name: snAttrs["name"] || "SubNetwork",
        type: snAttrs["type"],
        connectedAps: [],
      };

      const capRegex = /<ConnectedAP\b([^>]*)>([\s\S]*?)<\/ConnectedAP>/gi;
      let capMatch: RegExpExecArray | null;
      while ((capMatch = capRegex.exec(snContent)) !== null) {
        const capAttrs = parseXmlAttrs(capMatch[1] || "");
        const capContent = capMatch[2] || "";

        const gseMap = new Map<
          string,
          { mac: string; appId: string; vlanId?: string | undefined; vlanPriority?: number | undefined }
        >();
        const gseRegex = /<GSE\b([^>]*)>([\s\S]*?)<\/GSE>/gi;
        let gseMatch: RegExpExecArray | null;
        while ((gseMatch = gseRegex.exec(capContent)) !== null) {
          const gAttrs = parseXmlAttrs(gseMatch[1] || "");
          const gContent = gseMatch[2] || "";
          const cbName = gAttrs["cbName"] || "GSE1";

          let mac = "01-0C-CD-01-00-01";
          let appId = "0001";
          let vlanId: string | undefined;
          let vlanPriority: number | undefined;

          const pRegex = /<P\b[^>]*type=["']([^"']*)["'][^>]*>([^<]*)<\/P>/gi;
          let pMatch: RegExpExecArray | null;
          while ((pMatch = pRegex.exec(gContent)) !== null) {
            const type = pMatch[1]!;
            const val = pMatch[2]!.trim();
            if (type === "MAC-Address") mac = val;
            else if (type === "APPID") appId = val;
            else if (type === "VLAN-ID") vlanId = val;
            else if (type === "VLAN-PRIORITY") vlanPriority = parseInt(val, 10);
          }

          gseMap.set(cbName, { mac, appId, vlanId, vlanPriority });
        }

        subNetwork.connectedAps.push({
          iedName: capAttrs["iedName"] || "IED",
          apName: capAttrs["apName"] || "AP1",
          gseAddresses: gseMap,
        });
      }

      doc.communication.push(subNetwork);
    }
  }

  // 4. IEDs
  const iedRegex = /<IED\b([^>]*)>([\s\S]*?)<\/IED>/gi;
  let iedMatch: RegExpExecArray | null;
  while ((iedMatch = iedRegex.exec(xmlText)) !== null) {
    const iedAttrs = parseXmlAttrs(iedMatch[1] || "");
    const iedContent = iedMatch[2] || "";
    const iedName = iedAttrs["name"] || "IED1";

    const ied: SclIED = {
      name: iedName,
      desc: iedAttrs["desc"],
      type: iedAttrs["type"],
      manufacturer: iedAttrs["manufacturer"],
      configVersion: iedAttrs["configVersion"],
      accessPoints: new Map<string, SclAccessPoint>(),
    };

    const apRegex = /<AccessPoint\b([^>]*)>([\s\S]*?)<\/AccessPoint>/gi;
    let apMatch: RegExpExecArray | null;
    while ((apMatch = apRegex.exec(iedContent)) !== null) {
      const apAttrs = parseXmlAttrs(apMatch[1] || "");
      const apContent = apMatch[2] || "";
      const apName = apAttrs["name"] || "AP1";

      const accessPoint: SclAccessPoint = {
        name: apName,
        desc: apAttrs["desc"],
        server: {
          logicalDevices: new Map<string, SclLogicalDevice>(),
        },
      };

      const ldRegex = /<LDevice\b([^>]*)>([\s\S]*?)<\/LDevice>/gi;
      let ldMatch: RegExpExecArray | null;
      while ((ldMatch = ldRegex.exec(apContent)) !== null) {
        const ldAttrs = parseXmlAttrs(ldMatch[1] || "");
        const ldContent = ldMatch[2] || "";
        const ldInst = ldAttrs["inst"] || "LD0";

        const lDevice: SclLogicalDevice = {
          inst: ldInst,
          desc: ldAttrs["desc"],
          logicalNodes: new Map<string, SclLogicalNode>(),
        };

        // LN0 and LN elements (supports both self-closing <LN .../> and <LN ...>...</LN>)
        const lnAllRegex = /<(LN0|LN)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/gi;
        let lnAllMatch: RegExpExecArray | null;
        while ((lnAllMatch = lnAllRegex.exec(ldContent)) !== null) {
          const lnTag = lnAllMatch[1]!;
          const lnAttrs = parseXmlAttrs(lnAllMatch[2] || "");
          const lnContent = lnAllMatch[3] || "";

          const lnClass = (lnTag === "LN0" ? "LLN0" : lnAttrs["lnClass"] || "LPHD") as LogicalNodeClass;
          const inst = lnTag === "LN0" ? "" : lnAttrs["inst"] || "1";
          const prefix = lnAttrs["prefix"];
          const lnKey = prefix ? `${prefix}${lnClass}${inst}` : `${lnClass}${inst}`;

          const logicalNode: SclLogicalNode = {
            lnClass,
            inst,
            prefix,
            lnType: lnAttrs["lnType"] || `${lnClass}_Type`,
            desc: lnAttrs["desc"],
            dataSets: new Map<string, SclDataSet>(),
            gseControls: new Map<string, SclGseControl>(),
            smvControls: new Map<string, SclSampledValueControl>(),
            inputs: [],
          };

          // DataSets
          const dsRegex = /<DataSet\b([^>]*)>([\s\S]*?)<\/DataSet>/gi;
          let dsMatch: RegExpExecArray | null;
          while ((dsMatch = dsRegex.exec(lnContent)) !== null) {
            const dsAttrs = parseXmlAttrs(dsMatch[1] || "");
            const dsContent = dsMatch[2] || "";
            const dsName = dsAttrs["name"] || "DataSet1";

            const fcdaList: SclFcda[] = [];
            const fcdaRegex = /<FCDA\b([^>]*)\/?>/gi;
            let fcdaMatch: RegExpExecArray | null;
            while ((fcdaMatch = fcdaRegex.exec(dsContent)) !== null) {
              const fAttrs = parseXmlAttrs(fcdaMatch[1] || "");
              fcdaList.push({
                ldInst: fAttrs["ldInst"] || ldInst,
                prefix: fAttrs["prefix"],
                lnClass: fAttrs["lnClass"] || "LLN0",
                lnInst: fAttrs["lnInst"],
                doName: fAttrs["doName"] || "Pos",
                daName: fAttrs["daName"],
                fc: fAttrs["fc"] || "ST",
              });
            }

            logicalNode.dataSets.set(dsName, {
              name: dsName,
              desc: dsAttrs["desc"],
              fcdaList,
            });
          }

          // GSEControls
          const gseCtrlRegex = /<GSEControl\b([^>]*)\/?>/gi;
          let gseCtrlMatch: RegExpExecArray | null;
          while ((gseCtrlMatch = gseCtrlRegex.exec(lnContent)) !== null) {
            const gcAttrs = parseXmlAttrs(gseCtrlMatch[1] || "");
            const gcName = gcAttrs["name"] || "GC1";
            logicalNode.gseControls.set(gcName, {
              name: gcName,
              appID: gcAttrs["appID"] || gcName,
              datSet: gcAttrs["datSet"] || "",
              confRev: parseInt(gcAttrs["confRev"] || "1", 10),
              type: gcAttrs["type"] === "GSSE" ? "GSSE" : "GOOSE",
              minTimeMs: gcAttrs["minTime"] ? parseFloat(gcAttrs["minTime"]) : undefined,
              maxTimeMs: gcAttrs["maxTime"] ? parseFloat(gcAttrs["maxTime"]) : undefined,
            });
          }

          // Inputs -> ExtRefs
          const inpMatch = /<Inputs\b[^>]*>([\s\S]*?)<\/Inputs>/i.exec(lnContent);
          if (inpMatch && inpMatch[1]) {
            const extRegex = /<ExtRef\b([^>]*)\/?>/gi;
            let extMatch: RegExpExecArray | null;
            while ((extMatch = extRegex.exec(inpMatch[1])) !== null) {
              const eAttrs = parseXmlAttrs(extMatch[1] || "");
              if (eAttrs["iedName"] && eAttrs["lnClass"] && eAttrs["doName"]) {
                logicalNode.inputs.push({
                  iedName: eAttrs["iedName"],
                  ldInst: eAttrs["ldInst"] || "",
                  prefix: eAttrs["prefix"],
                  lnClass: eAttrs["lnClass"],
                  lnInst: eAttrs["lnInst"],
                  doName: eAttrs["doName"],
                  daName: eAttrs["daName"],
                  intAddr: eAttrs["intAddr"],
                  serviceType: (eAttrs["serviceType"] as any) || "GOOSE",
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
