// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * MicroParquet - Lightweight browser-native Apache Parquet serializer
 * for scientific simulation and cyber-physical trajectory datasets.
 *
 * Implements Apache Parquet format 1.0/2.0 with Thrift Compact Protocol
 * metadata encoding for IEEE-754 double precision float64 columnar pages.
 */

class CompactProtocolWriter {
  #bytes: number[] = [];
  #lastFieldIdStack: number[] = [0];

  get bytes(): Uint8Array {
    return new Uint8Array(this.#bytes);
  }

  pushStruct(): void {
    this.#lastFieldIdStack.push(0);
  }

  popStruct(): void {
    this.#lastFieldIdStack.pop();
    this.#bytes.push(0); // STOP field (0x00)
  }

  writeFieldHeader(fieldId: number, typeCode: number): void {
    const lastId = this.#lastFieldIdStack[this.#lastFieldIdStack.length - 1];
    const delta = fieldId - lastId;
    if (delta > 0 && delta <= 15) {
      this.#bytes.push((delta << 4) | typeCode);
    } else {
      this.#bytes.push(typeCode);
      this.writeI32(fieldId);
    }
    this.#lastFieldIdStack[this.#lastFieldIdStack.length - 1] = fieldId;
  }

  writeI32(val: number): void {
    const zigzag = (val << 1) ^ (val >> 31);
    this.writeVarint(zigzag >>> 0);
  }

  writeI64(val: number | bigint): void {
    const b = BigInt(val);
    const zigzag = (b << 1n) ^ (b >> 63n);
    this.writeVarint64(zigzag);
  }

  writeVarint(val: number): void {
    let v = val >>> 0;
    while (v > 0x7f) {
      this.#bytes.push((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    this.#bytes.push(v & 0x7f);
  }

  writeVarint64(val: bigint): void {
    let v = val;
    while (v > 0x7fn) {
      this.#bytes.push(Number((v & 0x7fn) | 0x80n));
      v >>= 7n;
    }
    this.#bytes.push(Number(v & 0x7fn));
  }

  writeString(str: string): void {
    const encoder = new TextEncoder();
    const utf8 = encoder.encode(str);
    this.writeVarint(utf8.length);
    for (let i = 0; i < utf8.length; i++) {
      this.#bytes.push(utf8[i]);
    }
  }

  writeListHeader(size: number, elemType: number): void {
    if (size < 15) {
      this.#bytes.push((size << 4) | elemType);
    } else {
      this.#bytes.push(0xf0 | elemType);
      this.writeVarint(size);
    }
  }
}

// Thrift type constants
const T_I32 = 5;
const T_I64 = 6;
const T_BINARY = 8;
const T_LIST = 9;
const T_STRUCT = 12;

// Parquet constants
const PARQUET_TYPE_DOUBLE = 2;
const PARQUET_REPETITION_REQUIRED = 0;
const PARQUET_PAGE_DATA = 0;
const PARQUET_ENCODING_PLAIN = 0;
const PARQUET_CODEC_UNCOMPRESSED = 0;

export function generateParquetBuffer(records: Record<string, number | string>[], columns?: string[]): Uint8Array {
  if (!records || records.length === 0) {
    return new Uint8Array([0x50, 0x41, 0x52, 0x31, 0, 0, 0, 0, 0x50, 0x41, 0x52, 0x31]);
  }

  const colNames = columns || Object.keys(records[0]);
  const numRows = records.length;

  const chunks: Uint8Array[] = [];
  // 1. Magic PAR1 header
  chunks.push(new Uint8Array([0x50, 0x41, 0x52, 0x31]));
  let currentOffset = 4;

  interface ColMeta {
    name: string;
    numValues: number;
    totalSize: number;
    dataPageOffset: number;
  }

  const colMetas: ColMeta[] = [];

  for (const colName of colNames) {
    const values = new Float64Array(numRows);
    for (let i = 0; i < numRows; i++) {
      const val = records[i][colName];
      values[i] = typeof val === "number" ? val : parseFloat(String(val)) || 0;
    }

    const dataBytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);

    // PageHeader struct
    const pageHeaderWriter = new CompactProtocolWriter();
    pageHeaderWriter.pushStruct();

    // field 1: type = DATA_PAGE (0)
    pageHeaderWriter.writeFieldHeader(1, T_I32);
    pageHeaderWriter.writeI32(PARQUET_PAGE_DATA);

    // field 2: uncompressed_page_size
    pageHeaderWriter.writeFieldHeader(2, T_I32);
    pageHeaderWriter.writeI32(dataBytes.length);

    // field 3: compressed_page_size
    pageHeaderWriter.writeFieldHeader(3, T_I32);
    pageHeaderWriter.writeI32(dataBytes.length);

    // field 5: data_page_header (struct)
    pageHeaderWriter.writeFieldHeader(5, T_STRUCT);
    pageHeaderWriter.pushStruct();

    // data_page_header.field 1: num_values
    pageHeaderWriter.writeFieldHeader(1, T_I32);
    pageHeaderWriter.writeI32(numRows);

    // data_page_header.field 2: encoding = PLAIN (0)
    pageHeaderWriter.writeFieldHeader(2, T_I32);
    pageHeaderWriter.writeI32(PARQUET_ENCODING_PLAIN);

    // data_page_header.field 3: definition_level_encoding = PLAIN (0)
    pageHeaderWriter.writeFieldHeader(3, T_I32);
    pageHeaderWriter.writeI32(PARQUET_ENCODING_PLAIN);

    // data_page_header.field 4: repetition_level_encoding = PLAIN (0)
    pageHeaderWriter.writeFieldHeader(4, T_I32);
    pageHeaderWriter.writeI32(PARQUET_ENCODING_PLAIN);

    pageHeaderWriter.popStruct(); // end data_page_header
    pageHeaderWriter.popStruct(); // end page_header

    const pageHeaderBytes = pageHeaderWriter.bytes;
    const dataPageOffset = currentOffset;
    const totalSize = pageHeaderBytes.length + dataBytes.length;

    chunks.push(pageHeaderBytes);
    chunks.push(dataBytes);
    currentOffset += totalSize;

    colMetas.push({
      name: colName,
      numValues: numRows,
      totalSize,
      dataPageOffset,
    });
  }

  // FileMetaData struct
  const metaWriter = new CompactProtocolWriter();
  metaWriter.pushStruct();

  // field 1: version = 1
  metaWriter.writeFieldHeader(1, T_I32);
  metaWriter.writeI32(1);

  // field 2: schema (list of SchemaElement)
  metaWriter.writeFieldHeader(2, T_LIST);
  metaWriter.writeListHeader(colNames.length + 1, T_STRUCT);

  // Root SchemaElement
  metaWriter.pushStruct();
  // field 4: name = "schema"
  metaWriter.writeFieldHeader(4, T_BINARY);
  metaWriter.writeString("schema");
  // field 5: num_children = colNames.length
  metaWriter.writeFieldHeader(5, T_I32);
  metaWriter.writeI32(colNames.length);
  metaWriter.popStruct();

  // Column SchemaElements
  for (const col of colNames) {
    metaWriter.pushStruct();
    // field 1: type = DOUBLE (2)
    metaWriter.writeFieldHeader(1, T_I32);
    metaWriter.writeI32(PARQUET_TYPE_DOUBLE);
    // field 2: repetition_type = REQUIRED (0)
    metaWriter.writeFieldHeader(2, T_I32);
    metaWriter.writeI32(PARQUET_REPETITION_REQUIRED);
    // field 4: name
    metaWriter.writeFieldHeader(4, T_BINARY);
    metaWriter.writeString(col);
    metaWriter.popStruct();
  }

  // field 3: num_rows
  metaWriter.writeFieldHeader(3, T_I64);
  metaWriter.writeI64(numRows);

  // field 4: row_groups (list of RowGroup)
  metaWriter.writeFieldHeader(4, T_LIST);
  metaWriter.writeListHeader(1, T_STRUCT);

  // RowGroup 0
  metaWriter.pushStruct();

  // RowGroup.field 1: columns (list of ColumnChunk)
  metaWriter.writeFieldHeader(1, T_LIST);
  metaWriter.writeListHeader(colMetas.length, T_STRUCT);

  let totalByteSize = 0;
  for (const cm of colMetas) {
    totalByteSize += cm.totalSize;

    metaWriter.pushStruct(); // ColumnChunk

    // ColumnChunk.field 2: file_offset
    metaWriter.writeFieldHeader(2, T_I64);
    metaWriter.writeI64(cm.dataPageOffset);

    // ColumnChunk.field 3: meta_data (ColumnMetaData struct)
    metaWriter.writeFieldHeader(3, T_STRUCT);
    metaWriter.pushStruct();

    // ColumnMetaData.field 1: type = DOUBLE
    metaWriter.writeFieldHeader(1, T_I32);
    metaWriter.writeI32(PARQUET_TYPE_DOUBLE);

    // ColumnMetaData.field 2: encodings = [PLAIN]
    metaWriter.writeFieldHeader(2, T_LIST);
    metaWriter.writeListHeader(1, T_I32);
    metaWriter.writeI32(PARQUET_ENCODING_PLAIN);

    // ColumnMetaData.field 3: path_in_schema = [cm.name]
    metaWriter.writeFieldHeader(3, T_LIST);
    metaWriter.writeListHeader(1, T_BINARY);
    metaWriter.writeString(cm.name);

    // ColumnMetaData.field 4: codec = UNCOMPRESSED (0)
    metaWriter.writeFieldHeader(4, T_I32);
    metaWriter.writeI32(PARQUET_CODEC_UNCOMPRESSED);

    // ColumnMetaData.field 5: num_values
    metaWriter.writeFieldHeader(5, T_I64);
    metaWriter.writeI64(cm.numValues);

    // ColumnMetaData.field 6: total_uncompressed_size
    metaWriter.writeFieldHeader(6, T_I64);
    metaWriter.writeI64(cm.totalSize);

    // ColumnMetaData.field 7: total_compressed_size
    metaWriter.writeFieldHeader(7, T_I64);
    metaWriter.writeI64(cm.totalSize);

    // ColumnMetaData.field 9: data_page_offset
    metaWriter.writeFieldHeader(9, T_I64);
    metaWriter.writeI64(cm.dataPageOffset);

    metaWriter.popStruct(); // end ColumnMetaData
    metaWriter.popStruct(); // end ColumnChunk
  }

  // RowGroup.field 2: total_byte_size
  metaWriter.writeFieldHeader(2, T_I64);
  metaWriter.writeI64(totalByteSize);

  // RowGroup.field 3: num_rows
  metaWriter.writeFieldHeader(3, T_I64);
  metaWriter.writeI64(numRows);

  metaWriter.popStruct(); // end RowGroup

  // FileMetaData.field 6: created_by
  metaWriter.writeFieldHeader(6, T_BINARY);
  metaWriter.writeString("ModelScript Cyber-Physical Studio");

  metaWriter.popStruct(); // end FileMetaData

  const metaBytes = metaWriter.bytes;
  chunks.push(metaBytes);

  // Footer: 4-byte little-endian length of FileMetaData
  const footerLen = new Uint8Array(4);
  const view = new DataView(footerLen.buffer);
  view.setUint32(0, metaBytes.length, true);
  chunks.push(footerLen);

  // Magic PAR1 footer
  chunks.push(new Uint8Array([0x50, 0x41, 0x52, 0x31]));

  // Combine into single Uint8Array
  const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
  const result = new Uint8Array(totalLength);
  let pos = 0;
  for (const c of chunks) {
    result.set(c, pos);
    pos += c.length;
  }

  return result;
}

export function downloadParquetFile(
  records: Record<string, number | string>[],
  filename: string = `simulation_data_${Date.now()}.parquet`,
  columns?: string[],
): void {
  const buf = generateParquetBuffer(records, columns);
  const blob = new Blob([buf], { type: "application/vnd.apache.parquet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".parquet") ? filename : `${filename}.parquet`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
