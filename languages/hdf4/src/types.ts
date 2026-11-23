// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * 4-byte NCSA HDF4 binary magic number: `0x0e 0x03 0x13 0x01` (^N^C^S^A).
 */
export const HDF4_MAGIC = 0x0e031301;

/**
 * Standard NCSA HDF4 Data Descriptor Tags (`DFTAG_*`).
 */
export const Hdf4Tag = {
  DFTAG_NULL: 1,
  DFTAG_RLE: 11,
  DFTAG_IMC: 12,
  DFTAG_FID: 100,
  DFTAG_FD: 101,
  DFTAG_TID: 102,
  DFTAG_TD: 103,
  DFTAG_DIL: 104,
  DFTAG_DIA: 105,
  DFTAG_NT: 106,
  DFTAG_MT: 107,
  DFTAG_ID8: 200,
  DFTAG_IP8: 201,
  DFTAG_RI8: 202,
  DFTAG_CI8: 203,
  DFTAG_ID: 300,
  DFTAG_LUT: 301,
  DFTAG_RI: 302,
  DFTAG_RIG: 306,
  DFTAG_SDG: 700,
  DFTAG_SDD: 701,
  DFTAG_SD: 702,
  DFTAG_SDS: 703,
  DFTAG_SDL: 704,
  DFTAG_SDU: 705,
  DFTAG_SDF: 706,
  DFTAG_SDM: 707,
  DFTAG_SDC: 708,
  DFTAG_SDT: 709,
  DFTAG_SDLNK: 710,
  DFTAG_NDG: 720,
  DFTAG_CAL: 731,
  DFTAG_FV: 732,
  DFTAG_VH: 1962,
  DFTAG_VS: 1963,
  DFTAG_VG: 1965,
} as const;

export type Hdf4TagValue = (typeof Hdf4Tag)[keyof typeof Hdf4Tag];

/**
 * Standard NCSA HDF4 Number Type codes (`DFNT_*`).
 */
export const Hdf4DataType = {
  DFNT_UCHAR8: 3,
  DFNT_CHAR8: 4,
  DFNT_FLOAT32: 5,
  DFNT_FLOAT64: 6,
  DFNT_INT8: 20,
  DFNT_UINT8: 21,
  DFNT_INT16: 22,
  DFNT_UINT16: 23,
  DFNT_INT32: 24,
  DFNT_UINT32: 25,
  DFNT_INT64: 26,
  DFNT_UINT64: 27,
} as const;

export type Hdf4DataTypeCode = (typeof Hdf4DataType)[keyof typeof Hdf4DataType];

export const VALID_HDF4_DATA_TYPE_CODES = new Set<number>(Object.values(Hdf4DataType));

export const HDF4_DATA_TYPE_NAMES: Record<number, string> = {
  [Hdf4DataType.DFNT_UCHAR8]: "UCHAR8",
  [Hdf4DataType.DFNT_CHAR8]: "CHAR8",
  [Hdf4DataType.DFNT_FLOAT32]: "FLOAT32",
  [Hdf4DataType.DFNT_FLOAT64]: "FLOAT64",
  [Hdf4DataType.DFNT_INT8]: "INT8",
  [Hdf4DataType.DFNT_UINT8]: "UINT8",
  [Hdf4DataType.DFNT_INT16]: "INT16",
  [Hdf4DataType.DFNT_UINT16]: "UINT16",
  [Hdf4DataType.DFNT_INT32]: "INT32",
  [Hdf4DataType.DFNT_UINT32]: "UINT32",
  [Hdf4DataType.DFNT_INT64]: "INT64",
  [Hdf4DataType.DFNT_UINT64]: "UINT64",
};

export function hdf4DataTypeByteWidth(code: number): number {
  switch (code) {
    case Hdf4DataType.DFNT_UCHAR8:
    case Hdf4DataType.DFNT_CHAR8:
    case Hdf4DataType.DFNT_INT8:
    case Hdf4DataType.DFNT_UINT8:
      return 1;
    case Hdf4DataType.DFNT_INT16:
    case Hdf4DataType.DFNT_UINT16:
      return 2;
    case Hdf4DataType.DFNT_FLOAT32:
    case Hdf4DataType.DFNT_INT32:
    case Hdf4DataType.DFNT_UINT32:
      return 4;
    case Hdf4DataType.DFNT_FLOAT64:
    case Hdf4DataType.DFNT_INT64:
    case Hdf4DataType.DFNT_UINT64:
      return 8;
    default:
      return 0;
  }
}

export function resolveHdf4DataTypeCode(nameOrCode: string | number): number {
  if (typeof nameOrCode === "number") return nameOrCode;
  const normalized = nameOrCode
    .trim()
    .toUpperCase()
    .replace(/^DFNT_/, "");
  switch (normalized) {
    case "UCHAR8":
    case "UCHAR":
      return Hdf4DataType.DFNT_UCHAR8;
    case "CHAR8":
    case "CHAR":
      return Hdf4DataType.DFNT_CHAR8;
    case "FLOAT32":
    case "FLOAT":
    case "F32":
      return Hdf4DataType.DFNT_FLOAT32;
    case "FLOAT64":
    case "DOUBLE":
    case "F64":
      return Hdf4DataType.DFNT_FLOAT64;
    case "INT8":
    case "I8":
      return Hdf4DataType.DFNT_INT8;
    case "UINT8":
    case "U8":
    case "BYTE":
      return Hdf4DataType.DFNT_UINT8;
    case "INT16":
    case "I16":
    case "SHORT":
      return Hdf4DataType.DFNT_INT16;
    case "UINT16":
    case "U16":
      return Hdf4DataType.DFNT_UINT16;
    case "INT32":
    case "I32":
    case "INT":
      return Hdf4DataType.DFNT_INT32;
    case "UINT32":
    case "U32":
      return Hdf4DataType.DFNT_UINT32;
    case "INT64":
    case "I64":
      return Hdf4DataType.DFNT_INT64;
    case "UINT64":
    case "U64":
      return Hdf4DataType.DFNT_UINT64;
    default: {
      const parsed = Number(nameOrCode);
      return Number.isInteger(parsed) ? parsed : -1;
    }
  }
}

export interface Hdf4SourceLocation {
  line: number;
  column: number;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
}

export interface Hdf4Attribute {
  name: string;
  value: string | number | number[];
  dataType?: number | undefined;
  location?: Hdf4SourceLocation | undefined;
}

export interface Hdf4Dimension {
  name: string;
  size: number;
  scale?: number[] | undefined;
  unit?: string | undefined;
  location?: Hdf4SourceLocation | undefined;
}

export interface Hdf4TagRef {
  tag: number;
  ref: number;
}

export interface Hdf4DataDescriptor {
  tag: number;
  ref: number;
  offset: number;
  length: number;
}

export interface Hdf4DdhBlock {
  offset: number;
  ddCount: number;
  nextDdhOffset: number;
  descriptors: Hdf4DataDescriptor[];
}

export interface Hdf4Sds {
  name: string;
  ref: number;
  dataType: number;
  dims: Hdf4Dimension[];
  attributes: Hdf4Attribute[];
  data: number[];
  unit?: string | undefined;
  fillValue?: number | undefined;
  scaleFactor?: number | undefined;
  addOffset?: number | undefined;
  location?: Hdf4SourceLocation | undefined;
}

export interface Hdf4VgroupMember {
  kind: "SDS" | "VGROUP" | "VDATA" | "RASTER8" | "PALETTE" | "TAGREF";
  name: string;
  tag?: number | undefined;
  ref?: number | undefined;
  location?: Hdf4SourceLocation | undefined;
}

export interface Hdf4Vgroup {
  name: string;
  vgroupClass?: string | undefined;
  ref: number;
  members: Hdf4VgroupMember[];
  attributes: Hdf4Attribute[];
  location?: Hdf4SourceLocation | undefined;
}

export interface Hdf4VdataField {
  name: string;
  dataType: number;
  order: number;
}

export interface Hdf4Vdata {
  name: string;
  vdataClass?: string | undefined;
  ref: number;
  fields: Hdf4VdataField[];
  records: Array<Array<number | string>>;
  attributes: Hdf4Attribute[];
  location?: Hdf4SourceLocation | undefined;
}

export interface Hdf4Raster8 {
  name: string;
  ref: number;
  width: number;
  height: number;
  paletteRef?: number | undefined;
  pixels: number[];
  attributes: Hdf4Attribute[];
  location?: Hdf4SourceLocation | undefined;
}

export interface Hdf4Palette {
  name: string;
  ref: number;
  entries: number[];
  location?: Hdf4SourceLocation | undefined;
}

export interface Hdf4ParseError {
  code: string;
  message: string;
  line: number;
  column: number;
}

export interface Hdf4Document {
  name: string;
  version: string;
  attributes: Hdf4Attribute[];
  sdsList: Hdf4Sds[];
  vgroups: Hdf4Vgroup[];
  vdatas: Hdf4Vdata[];
  rasters: Hdf4Raster8[];
  palettes: Hdf4Palette[];
  descriptors: Hdf4DataDescriptor[];
  ddhBlocks: Hdf4DdhBlock[];
  parseErrors: Hdf4ParseError[];
}
