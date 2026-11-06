// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/igtl — PLUS Toolkit (.plus.xml) and OpenIGTLink (.igtl) Parser.
 *
 * Parses:
 * 1. PLUS Toolkit `<PlusConfiguration>` XML (devices, channels, `<CoordinateDefinitions>`,
 *    `<PlusOpenIGTLinkServer>`, `<PivotCalibration>`, `<FiducialRegistration>`)
 * 2. OpenIGTLink `.igtl` message streams (XML or declarative `IGTL_TRANSFORM` / `TRANSFORM` syntax)
 * 3. JSON serialized representation
 */

import { parseXmlSync, type XmlElement } from "@modelscript/dsl/xml";
import type {
  IgtlDataSource,
  IgtlDevice,
  IgtlDocument,
  IgtlFiducialConfig,
  IgtlMessageRecord,
  IgtlPivotPoseSample,
  IgtlServerConfig,
  IgtlSourceRange,
  IgtlTransformDefinition,
  Matrix4x4,
} from "../types.js";

export const IDENTITY_4X4: Matrix4x4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function computeLineOffsets(text: string): number[] {
  const offsets = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      offsets.push(i + 1);
    }
  }
  return offsets;
}

function offsetToLineCol(offset: number, lineOffsets: number[]): { line: number; column: number } {
  let low = 0;
  let high = lineOffsets.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const midVal = lineOffsets[mid]!;
    if (midVal <= offset) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const lineIndex = Math.max(0, low - 1);
  return {
    line: lineIndex + 1,
    column: offset - (lineOffsets[lineIndex] ?? 0) + 1,
  };
}

function makeRange(startOffset: number, endOffset: number, lineOffsets: number[]): IgtlSourceRange {
  const start = offsetToLineCol(startOffset, lineOffsets);
  const end = offsetToLineCol(endOffset, lineOffsets);
  return {
    startOffset,
    endOffset,
    startLine: start.line,
    startColumn: start.column,
    endLine: end.line,
    endColumn: end.column,
  };
}

function getLocalName(name: string): string {
  const idx = name.indexOf(":");
  return (idx >= 0 ? name.slice(idx + 1) : name).toLowerCase();
}

function getAttr(el: XmlElement, ...names: string[]): string | undefined {
  for (const name of names) {
    const lower = name.toLowerCase();
    for (const a of el.attributes) {
      const aName = a.name.toLowerCase();
      const aLocal = aName.includes(":") ? aName.slice(aName.indexOf(":") + 1) : aName;
      if (aName === lower || aLocal === lower) return a.value;
    }
  }
  return undefined;
}

function walkElements(node: XmlElement, visit: (el: XmlElement) => void): void {
  visit(node);
  for (const child of node.children) {
    walkElements(child, visit);
  }
}

function parseMatrix4x4(raw: string | undefined): Matrix4x4 {
  if (!raw) return [...IDENTITY_4X4] as Matrix4x4;
  const nums = raw
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (nums.length >= 16 && nums.slice(0, 16).every((n) => !Number.isNaN(n))) {
    return nums.slice(0, 16) as Matrix4x4;
  }
  return [...IDENTITY_4X4] as Matrix4x4;
}

function parseVec3(raw: string | undefined): [number, number, number] | undefined {
  if (!raw) return undefined;
  const nums = raw
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (nums.length >= 3 && nums.slice(0, 3).every((n) => !Number.isNaN(n))) {
    return [nums[0]!, nums[1]!, nums[2]!];
  }
  return undefined;
}

function splitPlusTransformName(rawName: string): { from: string; to: string; rawName: string } {
  const idx = rawName.indexOf("To");
  if (idx > 0 && idx < rawName.length - 2) {
    return {
      from: rawName.slice(0, idx),
      to: rawName.slice(idx + 2),
      rawName,
    };
  }
  return { from: rawName, to: "Reference", rawName };
}

export function parseIgtl(text: string, sourceUri?: string): IgtlDocument {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const parsed = JSON.parse(trimmed) as IgtlDocument;
    if (sourceUri !== undefined) {
      parsed.sourceUri = sourceUri;
    }
    return parsed;
  }

  const lineOffsets = computeLineOffsets(text);
  const docRange = makeRange(0, text.length, lineOffsets);

  let xmlDoc = parseXmlSync(text);
  let offsetShift = 0;
  if ((!xmlDoc.root && text.includes("<")) || (xmlDoc.root && text.slice(xmlDoc.root.end).includes("<"))) {
    const prefix = "<_root_>";
    xmlDoc = parseXmlSync(prefix + text + "</_root_>");
    offsetShift = prefix.length;
  }

  let version = "2.1";
  if (xmlDoc.root && getLocalName(xmlDoc.root.name) === "plusconfiguration") {
    version = getAttr(xmlDoc.root, "version") ?? "2.1";
  }

  const devices: IgtlDevice[] = [];
  const transforms: IgtlTransformDefinition[] = [];
  const servers: IgtlServerConfig[] = [];
  const pivotPoses: IgtlPivotPoseSample[] = [];
  let fiducialConfig: IgtlFiducialConfig | undefined;
  const messages: IgtlMessageRecord[] = [];

  if (xmlDoc.root) {
    walkElements(xmlDoc.root, (el) => {
      const tag = getLocalName(el.name);

      // 1. <Device ...>...</Device>
      if (tag === "device") {
        const id = getAttr(el, "Id", "id") ?? `Device_${devices.length + 1}`;
        const type = getAttr(el, "Type", "type") ?? "TrackerDevice";
        const acqRaw = getAttr(el, "AcquisitionRate", "acquisitionRate");
        const acqRate = acqRaw !== undefined ? Number(acqRaw) : undefined;
        const toolRef = getAttr(el, "ToolReferenceFrame", "toolReferenceFrame");

        const dataSources: IgtlDataSource[] = [];
        const outputChannelIds: string[] = [];
        const inputChannelIds: string[] = [];

        walkElements(el, (child) => {
          const cTag = getLocalName(child.name);
          if (cTag === "datasource") {
            const dsStart = Math.max(0, child.start - offsetShift);
            const dsEnd = Math.max(0, child.end - offsetShift);
            const bufRaw = getAttr(child, "BufferSize", "bufferSize");
            dataSources.push({
              id: getAttr(child, "Id", "id") ?? "",
              type: getAttr(child, "Type", "type") ?? "Tool",
              portName: getAttr(child, "PortName", "portName"),
              bufferSize: bufRaw !== undefined ? Number(bufRaw) : undefined,
              range: makeRange(dsStart, dsEnd, lineOffsets),
            });
          } else if (cTag === "outputchannel") {
            const ocId = getAttr(child, "Id", "id");
            if (ocId) outputChannelIds.push(ocId);
          } else if (cTag === "inputchannel") {
            const icId = getAttr(child, "Id", "id", "InputChannelId", "inputchannelid");
            if (icId) inputChannelIds.push(icId);
          }
        });

        const dStart = Math.max(0, el.start - offsetShift);
        const dEnd = Math.max(0, el.end - offsetShift);
        const dev: IgtlDevice = {
          id,
          type,
          dataSources,
          outputChannelIds,
          inputChannelIds,
          range: makeRange(dStart, dEnd, lineOffsets),
        };
        if (acqRate !== undefined) dev.acquisitionRate = acqRate;
        if (toolRef !== undefined) dev.toolReferenceFrame = toolRef;
        devices.push(dev);
      }

      // 2. <Transform From="..." To="..." Matrix="..." Error="..."/>
      else if (tag === "transform") {
        const from = getAttr(el, "From", "from");
        const to = getAttr(el, "To", "to");
        if (from && to) {
          const tStart = Math.max(0, el.start - offsetShift);
          const tEnd = Math.max(0, el.end - offsetShift);
          const matrix = parseMatrix4x4(getAttr(el, "Matrix", "matrix"));
          const errRaw = getAttr(el, "Error", "error");
          const errVal = errRaw !== undefined ? Number(errRaw) : undefined;
          const date = getAttr(el, "Date", "date");

          const tfDef: IgtlTransformDefinition = {
            from,
            to,
            matrix,
            range: makeRange(tStart, tEnd, lineOffsets),
          };
          if (errVal !== undefined) tfDef.errorMm = errVal;
          if (date) tfDef.date = date;
          transforms.push(tfDef);
        }
      }

      // 3. <PlusOpenIGTLinkServer ...>
      else if (tag === "plusopenigtlinkserver") {
        const sStart = Math.max(0, el.start - offsetShift);
        const sEnd = Math.max(0, el.end - offsetShift);

        const listeningPort = Number(getAttr(el, "ListeningPort", "listeningPort") ?? 18944);
        const outputChannelId = getAttr(el, "OutputChannelId", "outputChannelId");
        const deviceId = getAttr(el, "DeviceId", "deviceId");
        const maxMsgRaw = getAttr(el, "MaxNumberOfIgtlMessagesToSend", "maxNumberOfIgtlMessagesToSend");
        const maxMsg = maxMsgRaw !== undefined ? Number(maxMsgRaw) : undefined;

        const messageTypes: string[] = [];
        const transformNames: Array<{ from: string; to: string; rawName: string }> = [];

        walkElements(el, (child) => {
          const cTag = getLocalName(child.name);
          if (cTag === "message") {
            const mType = getAttr(child, "Type", "type");
            if (mType) messageTypes.push(mType);
          } else if (cTag === "transform") {
            const rawName = getAttr(child, "Name", "name");
            if (rawName) {
              transformNames.push(splitPlusTransformName(rawName));
            }
          }
        });

        const srv: IgtlServerConfig = {
          id: getAttr(el, "Id", "id") ?? `IGTLServer_${listeningPort}`,
          listeningPort,
          messageTypes,
          transformNames,
          range: makeRange(sStart, sEnd, lineOffsets),
        };
        if (outputChannelId !== undefined) srv.outputChannelId = outputChannelId;
        if (deviceId !== undefined) srv.deviceId = deviceId;
        if (maxMsg !== undefined) srv.maxMessagesToSend = maxMsg;
        servers.push(srv);
      }

      // 4. <PivotPose Matrix="..."/> or <Pose Matrix="..."/>
      else if (tag === "pivotpose" || tag === "pose") {
        const pStart = Math.max(0, el.start - offsetShift);
        const pEnd = Math.max(0, el.end - offsetShift);
        const mat = parseMatrix4x4(getAttr(el, "Matrix", "matrix"));
        pivotPoses.push({
          matrix: mat,
          range: makeRange(pStart, pEnd, lineOffsets),
        });
      }

      // 5. <FiducialRegistration ...>
      else if (tag === "fiducialregistration") {
        const fStart = Math.max(0, el.start - offsetShift);
        const fEnd = Math.max(0, el.end - offsetShift);
        const fleMm = Number(getAttr(el, "FLE", "fle") ?? 0.5);
        const freRaw = getAttr(el, "FRE", "fre");
        const freMm = freRaw !== undefined ? Number(freRaw) : undefined;
        const treRaw = getAttr(el, "TRE", "tre");
        const treMm = treRaw !== undefined ? Number(treRaw) : undefined;
        const targetPoint = parseVec3(getAttr(el, "Target", "target"));

        const fiducials: Array<[number, number, number]> = [];
        walkElements(el, (child) => {
          if (getLocalName(child.name) === "fiducial") {
            const pt = parseVec3(
              getAttr(child, "Position", "position") ??
                `${getAttr(child, "x") ?? 0} ${getAttr(child, "y") ?? 0} ${getAttr(child, "z") ?? 0}`,
            );
            if (pt) fiducials.push(pt);
          }
        });

        fiducialConfig = {
          fleMm,
          fiducials,
          range: makeRange(fStart, fEnd, lineOffsets),
        };
        if (freMm !== undefined) fiducialConfig.freMm = freMm;
        if (treMm !== undefined) fiducialConfig.treMm = treMm;
        if (targetPoint !== undefined) fiducialConfig.targetPoint = targetPoint;
      }

      // 6. <IgtlMessage .../>
      else if (tag === "igtlmessage") {
        const imStart = Math.max(0, el.start - offsetShift);
        const imEnd = Math.max(0, el.end - offsetShift);
        const imRange = makeRange(imStart, imEnd, lineOffsets);
        const msgType = (getAttr(el, "Type", "type") ?? "TRANSFORM") as IgtlMessageRecord["messageType"];
        const devName = getAttr(el, "DeviceName", "Name", "name") ?? "StylusTipToReference";
        const parsedName = splitPlusTransformName(devName);
        const fromFrame = getAttr(el, "From", "from") ?? parsedName.from;
        const toFrame = getAttr(el, "To", "to") ?? parsedName.to;
        const matRaw = getAttr(el, "Matrix", "matrix");
        const mat = matRaw ? parseMatrix4x4(matRaw) : undefined;

        const rec: IgtlMessageRecord = {
          deviceName: devName,
          messageType: msgType,
          fromFrame,
          toFrame,
          range: imRange,
        };
        if (mat) {
          rec.matrix = mat;
          const errRaw = getAttr(el, "Error", "error");
          transforms.push({
            from: fromFrame,
            to: toFrame,
            matrix: mat,
            errorMm: errRaw !== undefined ? Number(errRaw) : undefined,
            range: imRange,
          });
        }
        messages.push(rec);
      }
    });
  }

  const doc: IgtlDocument = {
    version,
    devices,
    transforms,
    servers,
    pivotPoses,
    messages,
    range: docRange,
  };
  if (fiducialConfig !== undefined) doc.fiducialConfig = fiducialConfig;
  if (sourceUri !== undefined) doc.sourceUri = sourceUri;
  return doc;
}
