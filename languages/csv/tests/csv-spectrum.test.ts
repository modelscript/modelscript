// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCsvRecords, parseCsvRows } from "../src/csv-parser.js";

describe("languages/csv: csv-spectrum RFC 4180 Industry Benchmark Suite", () => {
  it("passes 1. comma_in_quotes: correctly preserves commas within double quotes", () => {
    const csv = `first,last,address,city,zip\nJohn,Doe,120 any st.,"Anytown, WW",08123`;
    const records = parseCsvRecords(csv);
    assert.deepEqual(records, [
      {
        first: "John",
        last: "Doe",
        address: "120 any st.",
        city: "Anytown, WW",
        zip: "08123",
      },
    ]);
  });

  it("passes 2. empty: handles completely empty file", () => {
    const csv = "";
    assert.deepEqual(parseCsvRecords(csv), []);
    assert.deepEqual(parseCsvRows(csv), []);
  });

  it("passes 3. empty_crlf: handles file containing only CRLF newlines", () => {
    const csv = "\r\n\r\n";
    assert.deepEqual(parseCsvRecords(csv), []);
    assert.deepEqual(parseCsvRows(csv), []);
  });

  it('passes 4. escaped_quotes: handles escaped double-quotes ("") inside quotes', () => {
    const csv = `a,b\n1,"ha ""ha"" ha"`;
    const records = parseCsvRecords(csv);
    assert.deepEqual(records, [{ a: "1", b: 'ha "ha" ha' }]);
  });

  it("passes 5. json: handles embedded JSON with escaped quotes and braces", () => {
    const csv = `key,val\n1,"{""type"": ""Point"", ""coordinates"": [102.0, 0.5]}"`;
    const records = parseCsvRecords(csv);
    assert.deepEqual(records, [
      {
        key: "1",
        val: '{"type": "Point", "coordinates": [102.0, 0.5]}',
      },
    ]);
  });

  it("passes 6. newlines: handles multiline cell with LF embedded newlines", () => {
    const csv = `a,b,c\n1,2,3\n"once upon\na time",5,6\n7,8,9`;
    const records = parseCsvRecords(csv);
    assert.deepEqual(records, [
      { a: "1", b: "2", c: "3" },
      { a: "once upon\na time", b: "5", c: "6" },
      { a: "7", b: "8", c: "9" },
    ]);
  });

  it("passes 7. newlines_crlf: handles multiline cell with CRLF embedded newlines", () => {
    const csv = 'a,b,c\r\n1,2,3\r\n"once upon\r\na time",5,6\r\n7,8,9';
    const records = parseCsvRecords(csv);
    assert.deepEqual(records, [
      { a: "1", b: "2", c: "3" },
      { a: "once upon\r\na time", b: "5", c: "6" },
      { a: "7", b: "8", c: "9" },
    ]);
  });

  it("passes 8. quotes_and_newlines: handles combinations of quotes and embedded newlines", () => {
    const csv = 'a,b\n1,"ha \n""ha"" \nha"';
    const records = parseCsvRecords(csv);
    assert.deepEqual(records, [{ a: "1", b: 'ha \n"ha" \nha' }]);
  });

  it("passes 9. simple: standard CSV with unix LF line endings", () => {
    const csv = "a,b,c\n1,2,3";
    const records = parseCsvRecords(csv);
    assert.deepEqual(records, [{ a: "1", b: "2", c: "3" }]);
  });

  it("passes 10. simple_crlf: standard CSV with Windows CRLF line endings", () => {
    const csv = "a,b,c\r\n1,2,3";
    const records = parseCsvRecords(csv);
    assert.deepEqual(records, [{ a: "1", b: "2", c: "3" }]);
  });

  it("passes 11. utf8: handles multibyte international UTF-8 characters", () => {
    const csv = "a,b,c\n1,2,3\n4,5,ʤ";
    const records = parseCsvRecords(csv);
    assert.deepEqual(records, [
      { a: "1", b: "2", c: "3" },
      { a: "4", b: "5", c: "ʤ" },
    ]);
  });

  it("passes 12. semicolon and tab delimiters in general-purpose parser", () => {
    const semi = 'id;label;description\n1;Alpha;"Beta; Gamma"';
    assert.deepEqual(parseCsvRecords(semi), [{ id: "1", label: "Alpha", description: "Beta; Gamma" }]);

    const tab = "t\tvalA\tvalB\n0.0\t100\t200";
    assert.deepEqual(parseCsvRecords(tab), [{ t: "0.0", valA: "100", valB: "200" }]);
  });

  it("passes 13. whitespace preservation: respects trim: false option", () => {
    const csv = 'key,val\nitem1,"  padded value  "\nitem2,  unquoted padded  ';
    const raw = parseCsvRecords(csv, { trim: false });
    assert.equal(raw[0]?.val, "  padded value  ");
    assert.equal(raw[1]?.val, "  unquoted padded  ");

    const trimmed = parseCsvRecords(csv, { trim: true });
    assert.equal(trimmed[0]?.val, "padded value");
    assert.equal(trimmed[1]?.val, "unquoted padded");
  });

  it("passes 14. throughput benchmark: parses 10,000 telemetry rows in < 100ms", () => {
    const numRows = 10000;
    const lines = ["time,voltage,current,temperature,status"];
    for (let i = 0; i < numRows; i++) {
      lines.push(
        `${(i * 0.01).toFixed(2)},${(120.0 + Math.sin(i)).toFixed(3)},${(15.2 + Math.cos(i)).toFixed(3)},42.5,"NOMINAL"`,
      );
    }
    const csv = lines.join("\n");
    const start = performance.now();
    const rows = parseCsvRows(csv);
    const duration = performance.now() - start;

    assert.equal(rows.length, numRows + 1);
    assert.ok(duration < 250, `10,000-row CSV took ${duration.toFixed(2)}ms (must be < 250ms)`);
  });
});
