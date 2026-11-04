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

function parseAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([A-Za-z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = attrRegex.exec(attrString)) !== null) {
    const key = m[1]!;
    const val = m[2] ?? m[3] ?? "";
    attrs[key] = val;
  }
  return attrs;
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

  let version = "2.1";
  const plusMatch = /<PlusConfiguration\b([^>]*)>/i.exec(text);
  if (plusMatch) {
    const attrs = parseAttributes(plusMatch[1]!);
    if (attrs["version"]) version = attrs["version"];
  }

  const devices: IgtlDevice[] = [];
  const transforms: IgtlTransformDefinition[] = [];
  const servers: IgtlServerConfig[] = [];
  const pivotPoses: IgtlPivotPoseSample[] = [];
  let fiducialConfig: IgtlFiducialConfig | undefined;
  const messages: IgtlMessageRecord[] = [];

  // 1. Parse <Device ...>...</Device> or self-closing <Device .../>
  const devRegex = /<Device\b([^>]*)(?:\/>|>([\s\S]*?)<\/Device>)/gi;
  let devMatch: RegExpExecArray | null;
  while ((devMatch = devRegex.exec(text)) !== null) {
    const dAttrs = parseAttributes(devMatch[1]!);
    const dBody = devMatch[2] ?? "";
    const dStart = devMatch.index;
    const dRange = makeRange(dStart, dStart + devMatch[0].length, lineOffsets);

    const id = dAttrs["Id"] ?? dAttrs["id"] ?? `Device_${devices.length + 1}`;
    const type = dAttrs["Type"] ?? dAttrs["type"] ?? "TrackerDevice";
    const acqRate =
      dAttrs["AcquisitionRate"] !== undefined
        ? Number(dAttrs["AcquisitionRate"])
        : dAttrs["acquisitionRate"] !== undefined
          ? Number(dAttrs["acquisitionRate"])
          : undefined;
    const toolRef = dAttrs["ToolReferenceFrame"] ?? dAttrs["toolReferenceFrame"];

    const dataSources: IgtlDataSource[] = [];
    const dsRegex = /<DataSource\b([^>]*)\/?>/gi;
    let dsMatch: RegExpExecArray | null;
    while ((dsMatch = dsRegex.exec(dBody)) !== null) {
      const dsAttrs = parseAttributes(dsMatch[1]!);
      const dsStart = dStart + dsMatch.index;
      dataSources.push({
        id: dsAttrs["Id"] ?? dsAttrs["id"] ?? "",
        type: dsAttrs["Type"] ?? dsAttrs["type"] ?? "Tool",
        portName: dsAttrs["PortName"],
        bufferSize: dsAttrs["BufferSize"] !== undefined ? Number(dsAttrs["BufferSize"]) : undefined,
        range: makeRange(dsStart, dsStart + dsMatch[0].length, lineOffsets),
      });
    }

    const outputChannelIds: string[] = [];
    const outChRegex = /<OutputChannel\b([^>]*)\/?>/gi;
    let outChMatch: RegExpExecArray | null;
    while ((outChMatch = outChRegex.exec(dBody)) !== null) {
      const ocAttrs = parseAttributes(outChMatch[1]!);
      const ocId = ocAttrs["Id"] ?? ocAttrs["id"];
      if (ocId) outputChannelIds.push(ocId);
    }

    const inputChannelIds: string[] = [];
    const inChRegex = /<InputChannel\b([^>]*)\/?>/gi;
    let inChMatch: RegExpExecArray | null;
    while ((inChMatch = inChRegex.exec(dBody)) !== null) {
      const icAttrs = parseAttributes(inChMatch[1]!);
      const icId = icAttrs["Id"] ?? icAttrs["id"] ?? icAttrs["InputChannelId"];
      if (icId) inputChannelIds.push(icId);
    }

    const dev: IgtlDevice = {
      id,
      type,
      dataSources,
      outputChannelIds,
      inputChannelIds,
      range: dRange,
    };
    if (acqRate !== undefined) dev.acquisitionRate = acqRate;
    if (toolRef !== undefined) dev.toolReferenceFrame = toolRef;
    devices.push(dev);
  }

  // 2. Parse <Transform From="..." To="..." Matrix="..." Error="..."/> inside CoordinateDefinitions or top-level
  const tfRegex = /<Transform\b([^>]*)\/?>/gi;
  let tfMatch: RegExpExecArray | null;
  while ((tfMatch = tfRegex.exec(text)) !== null) {
    const tAttrs = parseAttributes(tfMatch[1]!);
    const from = tAttrs["From"] ?? tAttrs["from"];
    const to = tAttrs["To"] ?? tAttrs["to"];
    if (!from || !to) continue; // skip <Transform Name="..."/> inside DefaultClientInfo

    const tStart = tfMatch.index;
    const matrix = parseMatrix4x4(tAttrs["Matrix"] ?? tAttrs["matrix"]);
    const errVal =
      tAttrs["Error"] !== undefined
        ? Number(tAttrs["Error"])
        : tAttrs["error"] !== undefined
          ? Number(tAttrs["error"])
          : undefined;

    const tfDef: IgtlTransformDefinition = {
      from,
      to,
      matrix,
      range: makeRange(tStart, tStart + tfMatch[0].length, lineOffsets),
    };
    if (errVal !== undefined) tfDef.errorMm = errVal;
    if (tAttrs["Date"]) tfDef.date = tAttrs["Date"];
    transforms.push(tfDef);
  }

  // 3. Parse <PlusOpenIGTLinkServer ...>...</PlusOpenIGTLinkServer>
  const srvRegex = /<PlusOpenIGTLinkServer\b([^>]*)(?:\/>|>([\s\S]*?)<\/PlusOpenIGTLinkServer>)/gi;
  let srvMatch: RegExpExecArray | null;
  while ((srvMatch = srvRegex.exec(text)) !== null) {
    const sAttrs = parseAttributes(srvMatch[1]!);
    const sBody = srvMatch[2] ?? "";
    const sStart = srvMatch.index;
    const sRange = makeRange(sStart, sStart + srvMatch[0].length, lineOffsets);

    const listeningPort = Number(sAttrs["ListeningPort"] ?? sAttrs["listeningPort"] ?? 18944);
    const outputChannelId = sAttrs["OutputChannelId"] ?? sAttrs["outputChannelId"];
    const deviceId = sAttrs["DeviceId"] ?? sAttrs["deviceId"];
    const maxMsg =
      sAttrs["MaxNumberOfIgtlMessagesToSend"] !== undefined
        ? Number(sAttrs["MaxNumberOfIgtlMessagesToSend"])
        : undefined;

    const messageTypes: string[] = [];
    const msgRegex = /<Message\b([^>]*)\/?>/gi;
    let mMatch: RegExpExecArray | null;
    while ((mMatch = msgRegex.exec(sBody)) !== null) {
      const mAttrs = parseAttributes(mMatch[1]!);
      if (mAttrs["Type"]) messageTypes.push(mAttrs["Type"]);
    }

    const transformNames: Array<{ from: string; to: string; rawName: string }> = [];
    const tnRegex = /<Transform\b([^>]*)\/?>/gi;
    let tnMatch: RegExpExecArray | null;
    while ((tnMatch = tnRegex.exec(sBody)) !== null) {
      const tnAttrs = parseAttributes(tnMatch[1]!);
      const rawName = tnAttrs["Name"] ?? tnAttrs["name"];
      if (rawName) {
        transformNames.push(splitPlusTransformName(rawName));
      }
    }

    const srv: IgtlServerConfig = {
      id: sAttrs["Id"] ?? `IGTLServer_${listeningPort}`,
      listeningPort,
      messageTypes,
      transformNames,
      range: sRange,
    };
    if (outputChannelId !== undefined) srv.outputChannelId = outputChannelId;
    if (deviceId !== undefined) srv.deviceId = deviceId;
    if (maxMsg !== undefined) srv.maxMessagesToSend = maxMsg;
    servers.push(srv);
  }

  // 4. Parse <PivotCalibration> / <PivotPose Matrix="..."/>
  const poseRegex = /<(?:PivotPose|Pose)\b([^>]*)\/?>/gi;
  let poseMatch: RegExpExecArray | null;
  while ((poseMatch = poseRegex.exec(text)) !== null) {
    const pAttrs = parseAttributes(poseMatch[1]!);
    const pStart = poseMatch.index;
    const mat = parseMatrix4x4(pAttrs["Matrix"] ?? pAttrs["matrix"]);
    pivotPoses.push({
      matrix: mat,
      range: makeRange(pStart, pStart + poseMatch[0].length, lineOffsets),
    });
  }

  // 5. Parse <FiducialRegistration ...>
  const fidRegMatch = /<FiducialRegistration\b([^>]*)(?:\/>|>([\s\S]*?)<\/FiducialRegistration>)/i.exec(text);
  if (fidRegMatch) {
    const fAttrs = parseAttributes(fidRegMatch[1]!);
    const fBody = fidRegMatch[2] ?? "";
    const fStart = fidRegMatch.index;
    const fleMm = Number(fAttrs["FLE"] ?? fAttrs["fle"] ?? 0.5);
    const freMm =
      fAttrs["FRE"] !== undefined
        ? Number(fAttrs["FRE"])
        : fAttrs["fre"] !== undefined
          ? Number(fAttrs["fre"])
          : undefined;
    const treMm =
      fAttrs["TRE"] !== undefined
        ? Number(fAttrs["TRE"])
        : fAttrs["tre"] !== undefined
          ? Number(fAttrs["tre"])
          : undefined;
    const targetPoint = parseVec3(fAttrs["Target"] ?? fAttrs["target"]);

    const fiducials: Array<[number, number, number]> = [];
    const fidPtRegex = /<Fiducial\b([^>]*)\/?>/gi;
    let fpMatch: RegExpExecArray | null;
    while ((fpMatch = fidPtRegex.exec(fBody)) !== null) {
      const fpAttrs = parseAttributes(fpMatch[1]!);
      const pt = parseVec3(
        fpAttrs["Position"] ?? fpAttrs["position"] ?? `${fpAttrs["x"] ?? 0} ${fpAttrs["y"] ?? 0} ${fpAttrs["z"] ?? 0}`,
      );
      if (pt) fiducials.push(pt);
    }

    fiducialConfig = {
      fleMm,
      fiducials,
      range: makeRange(fStart, fStart + fidRegMatch[0].length, lineOffsets),
    };
    if (freMm !== undefined) fiducialConfig.freMm = freMm;
    if (treMm !== undefined) fiducialConfig.treMm = treMm;
    if (targetPoint !== undefined) fiducialConfig.targetPoint = targetPoint;
  }

  // 6. Parse <IgtlMessage .../> or line-based OpenIGTLink `.igtl` stream records
  const igtlMsgRegex = /<IgtlMessage\b([^>]*)\/?>/gi;
  let imMatch: RegExpExecArray | null;
  while ((imMatch = igtlMsgRegex.exec(text)) !== null) {
    const imAttrs = parseAttributes(imMatch[1]!);
    const imStart = imMatch.index;
    const imRange = makeRange(imStart, imStart + imMatch[0].length, lineOffsets);
    const msgType = (imAttrs["Type"] ?? imAttrs["type"] ?? "TRANSFORM") as IgtlMessageRecord["messageType"];
    const devName = imAttrs["DeviceName"] ?? imAttrs["Name"] ?? "StylusTipToReference";
    const parsedName = splitPlusTransformName(devName);
    const fromFrame = imAttrs["From"] ?? parsedName.from;
    const toFrame = imAttrs["To"] ?? parsedName.to;
    const mat = imAttrs["Matrix"] ? parseMatrix4x4(imAttrs["Matrix"]) : undefined;

    const rec: IgtlMessageRecord = {
      deviceName: devName,
      messageType: msgType,
      fromFrame,
      toFrame,
      range: imRange,
    };
    if (mat) {
      rec.matrix = mat;
      transforms.push({
        from: fromFrame,
        to: toFrame,
        matrix: mat,
        errorMm: imAttrs["Error"] !== undefined ? Number(imAttrs["Error"]) : undefined,
        range: imRange,
      });
    }
    messages.push(rec);
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
