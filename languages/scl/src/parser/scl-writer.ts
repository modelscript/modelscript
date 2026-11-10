// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * IEC 61850 Substation Configuration Language (SCL) XML Serializer.
 */

import type { SclDocument } from "../types.js";

/**
 * Serializes an SclDocument into standard IEC 61850 SCL XML.
 */
export function writeSclXml(doc: SclDocument): string {
  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<SCL xmlns="http://www.iec.ch/61850/2003/SCL" version="2007" revision="B">`);

  // Header
  lines.push(
    `  <Header id="${doc.header.id}" version="${doc.header.version}" revision="${doc.header.revision}" toolID="${doc.header.toolId ?? "ModelScript"}"/>`,
  );

  // Substation
  if (doc.substation) {
    const s = doc.substation;
    lines.push(`  <Substation name="${s.name}"${s.desc ? ` desc="${s.desc}"` : ""}>`);
    for (const vl of s.voltageLevels) {
      lines.push(`    <VoltageLevel name="${vl.name}"${vl.desc ? ` desc="${vl.desc}"` : ""}>`);
      if (vl.nominalVoltageKv !== undefined) {
        lines.push(`      <Voltage unit="V" multiplier="k">${vl.nominalVoltageKv}</Voltage>`);
      }
      for (const bay of vl.bays) {
        lines.push(`      <Bay name="${bay.name}"${bay.desc ? ` desc="${bay.desc}"` : ""}>`);
        for (const ce of bay.conductingEquipment) {
          lines.push(
            `        <ConductingEquipment name="${ce.name}" type="${ce.type}"${ce.desc ? ` desc="${ce.desc}"` : ""}>`,
          );
          for (const t of ce.terminals) {
            lines.push(`          <Terminal name="${t.name}" connectivityNode="${t.connectivityNode}"/>`);
          }
          if (ce.lnReferences) {
            for (const ref of ce.lnReferences) {
              const parts = ref.split("/");
              lines.push(`          <LNode iedName="${parts[0] || ""}" lnClass="${parts[1] || ""}"/>`);
            }
          }
          lines.push(`        </ConductingEquipment>`);
        }
        for (const cn of bay.connectivityNodes) {
          lines.push(`        <ConnectivityNode name="${cn.name}" pathName="${cn.pathName}"/>`);
        }
        lines.push(`      </Bay>`);
      }
      lines.push(`    </VoltageLevel>`);
    }
    lines.push(`  </Substation>`);
  }

  // Communication
  if (doc.communication && doc.communication.length > 0) {
    lines.push(`  <Communication>`);
    for (const sn of doc.communication) {
      lines.push(`    <SubNetwork name="${sn.name}"${sn.type ? ` type="${sn.type}"` : ""}>`);
      for (const cap of sn.connectedAps) {
        lines.push(`      <ConnectedAP iedName="${cap.iedName}" apName="${cap.apName}">`);
        if (cap.gseAddresses) {
          for (const [cbName, addr] of cap.gseAddresses) {
            lines.push(`        <GSE ldInst="LD0" cbName="${cbName}">`);
            lines.push(`          <Address>`);
            lines.push(`            <P type="MAC-Address">${addr.mac}</P>`);
            lines.push(`            <P type="APPID">${addr.appId}</P>`);
            if (addr.vlanId) lines.push(`            <P type="VLAN-ID">${addr.vlanId}</P>`);
            if (addr.vlanPriority !== undefined)
              lines.push(`            <P type="VLAN-PRIORITY">${addr.vlanPriority}</P>`);
            lines.push(`          </Address>`);
            lines.push(`        </GSE>`);
          }
        }
        lines.push(`      </ConnectedAP>`);
      }
      lines.push(`    </SubNetwork>`);
    }
    lines.push(`  </Communication>`);
  }

  // IEDs
  for (const [iedName, ied] of doc.ieds) {
    lines.push(
      `  <IED name="${iedName}"${ied.desc ? ` desc="${ied.desc}"` : ""}${ied.type ? ` type="${ied.type}"` : ""}>`,
    );
    for (const [apName, ap] of ied.accessPoints) {
      lines.push(`    <AccessPoint name="${apName}">`);
      if (ap.server) {
        lines.push(`      <Server>`);
        for (const [ldInst, ld] of ap.server.logicalDevices) {
          lines.push(`        <LDevice inst="${ldInst}">`);
          for (const [, ln] of ld.logicalNodes) {
            const isLn0 = ln.lnClass === "LLN0";
            const tag = isLn0 ? "LN0" : "LN";
            const instAttr = isLn0 ? "" : ` inst="${ln.inst}"`;
            const prefixAttr = ln.prefix ? ` prefix="${ln.prefix}"` : "";
            const lnClassAttr = isLn0 ? "" : ` lnClass="${ln.lnClass}"`;
            lines.push(`          <${tag} lnType="${ln.lnType}"${lnClassAttr}${instAttr}${prefixAttr}>`);

            for (const [dsName, ds] of ln.dataSets) {
              lines.push(`            <DataSet name="${dsName}">`);
              for (const f of ds.fcdaList) {
                const p = f.prefix ? ` prefix="${f.prefix}"` : "";
                const li = f.lnInst ? ` lnInst="${f.lnInst}"` : "";
                const da = f.daName ? ` daName="${f.daName}"` : "";
                lines.push(
                  `              <FCDA ldInst="${f.ldInst}"${p} lnClass="${f.lnClass}"${li} doName="${f.doName}"${da} fc="${f.fc}"/>`,
                );
              }
              lines.push(`            </DataSet>`);
            }

            for (const [gcName, gc] of ln.gseControls) {
              const minT = gc.minTimeMs ? ` minTime="${gc.minTimeMs}"` : "";
              const maxT = gc.maxTimeMs ? ` maxTime="${gc.maxTimeMs}"` : "";
              lines.push(
                `            <GSEControl name="${gcName}" appID="${gc.appID}" datSet="${gc.datSet}" confRev="${gc.confRev}" type="${gc.type ?? "GOOSE"}"${minT}${maxT}/>`,
              );
            }

            if (ln.inputs.length > 0) {
              lines.push(`            <Inputs>`);
              for (const ext of ln.inputs) {
                const da = ext.daName ? ` daName="${ext.daName}"` : "";
                lines.push(
                  `              <ExtRef iedName="${ext.iedName}" ldInst="${ext.ldInst}" lnClass="${ext.lnClass}" doName="${ext.doName}"${da}/>`,
                );
              }
              lines.push(`            </Inputs>`);
            }

            lines.push(`          </${tag}>`);
          }
          lines.push(`        </LDevice>`);
        }
        lines.push(`      </Server>`);
      }
      lines.push(`    </AccessPoint>`);
    }
    lines.push(`  </IED>`);
  }

  lines.push(`</SCL>`);
  return lines.join("\n") + "\n";
}
