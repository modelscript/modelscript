// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Structural relational hypergraph types used by CadViewer and ZonotopeCadOverlay.
 * Decouples `@modelscript/cad-viewer` from `@modelscript/editor`'s LSP bridge types.
 */

export interface AnsatzRelationalTokenSpan {
  index: number;
  text: string;
  startOffset: number;
  endOffset: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  tokenId: number;
  groupId: number;
  relTypeId: number;
  relSign: number;
  symbolName?: string | undefined;
  symbolKind?: string | undefined;
  ontologyIri?: string | undefined;
}

export interface AnsatzGeneratorGroupSummary {
  groupId: number;
  label: string;
  primaryRelType: number;
  tokenCount: number;
  symbolName?: string | undefined;
  ontologyIri?: string | undefined;
  toleranceSpec?: { lower?: number | undefined; upper?: number | undefined; unit?: string | undefined } | undefined;
}

export interface AnsatzRelationalHypergraphRecord {
  exampleId: string;
  uri: string;
  dialect: string;
  mInit: number;
  tokenIds: number[];
  groupIds: number[];
  relTypeIds: number[];
  relSigns: number[];
  spans: AnsatzRelationalTokenSpan[];
  groups: AnsatzGeneratorGroupSummary[];
}

export type CadRelationalHypergraphRecord = AnsatzRelationalHypergraphRecord;
