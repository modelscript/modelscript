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
  SclIED,
  SclLogicalDevice,
  SclLogicalNode,
  SclSubstation,
  SclVoltageLevel,
} from "./scl-types.js";

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
      id: attrs["id"] || "SCL_Project",
      version: attrs["version"] || "2.0",
      revision: attrs["revision"] || "1.0",
      toolId: attrs["toolID"],
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

      // Voltage value
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
        nomVoltageKv: nomKv,
        nomFreqHz: parseFloat(vlAttrs["nomFreq"] || "50"),
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

        // ConductingEquipment (supports self-closing <ConductingEquipment .../> and <ConductingEquipment ...>...</ConductingEquipment>)
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
            lNodes: [],
          };

          // LNodes attached to conducting equipment
          const lnRegex = /<LNode\b([^>]*)\/?>/gi;
          let lnMatch: RegExpExecArray | null;
          while ((lnMatch = lnRegex.exec(ceContent)) !== null) {
            const lnAttrs = parseXmlAttrs(lnMatch[1] || "");
            if (lnAttrs["iedName"] && lnAttrs["lnClass"]) {
              ce.lNodes.push({
                iedName: lnAttrs["iedName"],
                lnClass: lnAttrs["lnClass"],
                lnInst: lnAttrs["lnInst"] || "",
                prefix: lnAttrs["prefix"],
              });
            }
          }

          bay.conductingEquipment.push(ce);
        }

        // ConnectivityNodes
        const cnRegex = /<ConnectivityNode\b([^>]*)\/?>/gi;
        let cnMatch: RegExpExecArray | null;
        while ((cnMatch = cnRegex.exec(bayContent)) !== null) {
          const cnAttrs = parseXmlAttrs(cnMatch[1] || "");
          if (cnAttrs["name"]) bay.connectivityNodes.push(cnAttrs["name"]);
        }

        vl.bays.push(bay);
      }

      substation.voltageLevels.push(vl);
    }

    doc.substation = substation;
  }

  // 3. Communication
  const commMatch = /<Communication\b([^>]*)>([\s\S]*?)<\/Communication>/i.exec(xmlText);
  if (commMatch && commMatch[2]) {
    const cContent = commMatch[2];
    const subnets: SclCommunicationSubNetwork[] = [];

    const snRegex = /<SubNetwork\b([^>]*)>([\s\S]*?)<\/SubNetwork>/gi;
    let snMatch: RegExpExecArray | null;
    while ((snMatch = snRegex.exec(cContent)) !== null) {
      const snAttrs = parseXmlAttrs(snMatch[1] || "");
      const snContent = snMatch[2] || "";

      const subNet: SclCommunicationSubNetwork = {
        name: snAttrs["name"] || "SubNet",
        type: snAttrs["type"] || "8-MMS",
        connectedAPs: [],
      };

      const apRegex = /<ConnectedAP\b([^>]*)>([\s\S]*?)<\/ConnectedAP>/gi;
      let apMatch: RegExpExecArray | null;
      while ((apMatch = apRegex.exec(snContent)) !== null) {
        const apAttrs = parseXmlAttrs(apMatch[1] || "");
        const apContent = apMatch[2] || "";

        let ipAddress: string | undefined;
        let subnetMask: string | undefined;

        const pRegex = /<P\b([^>]*)>([^<]*)<\/P>/gi;
        let pMatch: RegExpExecArray | null;
        while ((pMatch = pRegex.exec(apContent)) !== null) {
          const pAttrs = parseXmlAttrs(pMatch[1] || "");
          const pType = pAttrs["type"] || "";
          const pVal = pMatch[2]?.trim();
          if (pType === "IP") ipAddress = pVal;
          if (pType === "IP-SUBNET") subnetMask = pVal;
        }

        if (apAttrs["iedName"] && apAttrs["apName"]) {
          subNet.connectedAPs.push({
            iedName: apAttrs["iedName"],
            apName: apAttrs["apName"],
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
  const iedRegex = /<IED\b([^>]*)>([\s\S]*?)<\/IED>/gi;
  let iedMatch: RegExpExecArray | null;
  while ((iedMatch = iedRegex.exec(xmlText)) !== null) {
    const iedAttrs = parseXmlAttrs(iedMatch[1] || "");
    const iedContent = iedMatch[2] || "";
    const iedName = iedAttrs["name"];
    if (!iedName) continue;

    const ied: SclIED = {
      name: iedName,
      type: iedAttrs["type"],
      manufacturer: iedAttrs["manufacturer"],
      configVersion: iedAttrs["configVersion"],
      desc: iedAttrs["desc"],
      accessPoints: [],
    };

    // AccessPoint
    const apRegex = /<AccessPoint\b([^>]*)>([\s\S]*?)<\/AccessPoint>/gi;
    let apMatch: RegExpExecArray | null;
    while ((apMatch = apRegex.exec(iedContent)) !== null) {
      const apAttrs = parseXmlAttrs(apMatch[1] || "");
      const apContent = apMatch[2] || "";

      const ap: SclAccessPoint = {
        name: apAttrs["name"] || "P1",
        router: apAttrs["router"] === "true",
      };

      // Server
      const serverMatch = /<Server\b([^>]*)>([\s\S]*?)<\/Server>/i.exec(apContent);
      if (serverMatch && serverMatch[2]) {
        const srvContent = serverMatch[2];
        const lDevices: SclLogicalDevice[] = [];

        // LDevice
        const ldRegex = /<LDevice\b([^>]*)>([\s\S]*?)<\/LDevice>/gi;
        let ldMatch: RegExpExecArray | null;
        while ((ldMatch = ldRegex.exec(srvContent)) !== null) {
          const ldAttrs = parseXmlAttrs(ldMatch[1] || "");
          const ldContent = ldMatch[2] || "";

          const ld: SclLogicalDevice = {
            inst: ldAttrs["inst"] || "LD0",
            desc: ldAttrs["desc"],
            logicalNodes: [],
          };

          // Parse LN0 and LN
          const anyLnRegex = /<(LN0|LN)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
          let lnMatch: RegExpExecArray | null;
          while ((lnMatch = anyLnRegex.exec(ldContent)) !== null) {
            const lnTag = lnMatch[1]!;
            const lnAttrs = parseXmlAttrs(lnMatch[2] || "");
            const lnInner = lnMatch[3] || "";

            const lnClass = (lnTag === "LN0" ? "LLN0" : lnAttrs["lnClass"] || "XCBR") as LogicalNodeClass;
            const lnInst = lnAttrs["inst"] || "";

            const ln: SclLogicalNode = {
              lnClass,
              inst: lnInst,
              prefix: lnAttrs["prefix"],
              lnType: lnAttrs["lnType"],
              desc: lnAttrs["desc"],
              dataSets: [],
              gseControls: [],
              smvControls: [],
              inputs: [],
            };

            // DataSets
            const dsRegex = /<DataSet\b([^>]*)>([\s\S]*?)<\/DataSet>/gi;
            let dsMatch: RegExpExecArray | null;
            while ((dsMatch = dsRegex.exec(lnInner)) !== null) {
              const dsAttrs = parseXmlAttrs(dsMatch[1] || "");
              const dsContent = dsMatch[2] || "";

              const ds: SclDataSet = {
                name: dsAttrs["name"] || "ds1",
                desc: dsAttrs["desc"],
                fcdaList: [],
              };

              // FCDA
              const fcdaRegex = /<FCDA\b([^>]*)\/?>/gi;
              let fcdaMatch: RegExpExecArray | null;
              while ((fcdaMatch = fcdaRegex.exec(dsContent)) !== null) {
                const fa = parseXmlAttrs(fcdaMatch[1] || "");
                if (fa["ldInst"] && fa["lnClass"] && fa["doName"] && fa["fc"]) {
                  ds.fcdaList.push({
                    ldInst: fa["ldInst"],
                    prefix: fa["prefix"],
                    lnClass: fa["lnClass"],
                    lnInst: fa["lnInst"],
                    doName: fa["doName"],
                    daName: fa["daName"],
                    fc: fa["fc"],
                  });
                }
              }

              ln.dataSets.push(ds);
            }

            // GSEControl
            const gseRegex = /<GSEControl\b([^>]*)\/?>/gi;
            let gseMatch: RegExpExecArray | null;
            while ((gseMatch = gseRegex.exec(lnInner)) !== null) {
              const ga = parseXmlAttrs(gseMatch[1] || "");
              if (ga["name"] && ga["appID"]) {
                ln.gseControls.push({
                  name: ga["name"],
                  appID: ga["appID"],
                  datSet: ga["datSet"] || "",
                  confRev: parseInt(ga["confRev"] || "1", 10),
                  type: (ga["type"] || "GOOSE") as "GOOSE" | "GSSE",
                });
              }
            }

            // SampledValueControl
            const smvRegex = /<SampledValueControl\b([^>]*)\/?>/gi;
            let smvMatch: RegExpExecArray | null;
            while ((smvMatch = smvRegex.exec(lnInner)) !== null) {
              const sa = parseXmlAttrs(smvMatch[1] || "");
              if (sa["name"] && sa["smvID"]) {
                ln.smvControls.push({
                  name: sa["name"],
                  smvID: sa["smvID"],
                  datSet: sa["datSet"] || "",
                  confRev: parseInt(sa["confRev"] || "1", 10),
                  smpRate: parseInt(sa["smpRate"] || "4800", 10),
                });
              }
            }

            // Inputs -> ExtRef
            const extRegex = /<ExtRef\b([^>]*)\/?>/gi;
            let extMatch: RegExpExecArray | null;
            while ((extMatch = extRegex.exec(lnInner)) !== null) {
              const ea = parseXmlAttrs(extMatch[1] || "");
              if (ea["iedName"]) {
                ln.inputs.push({
                  iedName: ea["iedName"],
                  ldInst: ea["ldInst"],
                  prefix: ea["prefix"],
                  lnClass: ea["lnClass"],
                  lnInst: ea["lnInst"],
                  doName: ea["doName"],
                  daName: ea["daName"],
                  serviceType: (ea["serviceType"] || "GOOSE") as "GOOSE" | "SMV" | "Report",
                });
              }
            }

            if (lnTag === "LN0") {
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
