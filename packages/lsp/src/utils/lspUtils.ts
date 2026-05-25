/* eslint-disable @typescript-eslint/no-explicit-any */
import { LSPBridge, PositionIndex } from "@modelscript/compiler";

/** Helper to convert a SymbolEntry to a cross-file LSP Location */
export function symbolEntryToLocation(
  entry: any,
  documentLSPBridges: Map<string, LSPBridge>,
  documentTrees: Map<string, any>,
): { uri: string; range: any } | null {
  const uri = entry.resourceId;
  if (!uri) return null;

  // If the file is open, we already have a PositionIndex in its LSPBridge
  const bridge = documentLSPBridges.get(uri);
  if (bridge) {
    const range = (bridge as any).positions.rangeFromBytes(entry.startByte, entry.endByte);
    return { uri, range };
  }

  // File is not open and we don't have text. Fallback to line 1 to avoid sync IO.
  // In the future, we could resolve positions asynchronously from VFS.
  const text = documentTrees.get(uri)?.text;
  if (!text) {
    return {
      uri,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      },
    };
  }

  const positions = new PositionIndex(text);
  return { uri, range: positions.rangeFromBytes(entry.startByte, entry.endByte) };
}
