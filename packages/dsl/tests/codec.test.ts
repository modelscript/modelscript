// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildParser,
  codec,
  compileRegexToDFA,
  createRuntimeBinaryCodec,
  defineBinaryCodec,
  emitAssemblyScriptCodec,
  emitTypeScriptCodecBindings,
  encodeFormatSource,
  language,
  seq,
  type RandomAccessReader,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Binary Codec DSL & Emitters (@modelscript/dsl)", () => {
  it("round-trips all 10 scalar types in both LE and BE", () => {
    for (const endian of ["le", "be"] as const) {
      const def = defineBinaryCodec({
        name: `all_scalars_${endian}`,
        endian,
        root: codec.struct({
          u8: codec.u8(),
          i8: codec.i8(),
          u16: codec.u16(),
          i16: codec.i16(),
          u32: codec.u32(),
          i32: codec.i32(),
          u64: codec.u64(),
          i64: codec.i64(),
          f32: codec.f32(),
          f64: codec.f64(),
        }),
      });
      const rt = createRuntimeBinaryCodec(def);
      const input = {
        u8: 250,
        i8: -120,
        u16: 65000,
        i16: -32000,
        u32: 4000000000,
        i32: -2000000000,
        u64: 12345678901234567890n,
        i64: -987654321098765432n,
        f32: 1.5,
        f64: Math.PI,
      };
      const bytes = rt.encode(input);
      assert.equal(bytes.byteLength, 1 + 1 + 2 + 2 + 4 + 4 + 8 + 8 + 4 + 8);
      const decoded = rt.decode(bytes);
      assert.deepEqual(decoded, input);
    }
  });

  it("handles fixedStr with custom padChar, align validation, endian override, and fortranRecord (LE & BE)", () => {
    const def = defineBinaryCodec({
      name: "mixed_primitives",
      endian: "be",
      root: codec.struct({
        magic: codec.magic("TEST"),
        tag: codec.fixedStr(8, "_", true),
        pad: codec.align(8),
        leVal: codec.endian("le", codec.u32()),
        rec: codec.fortranRecord(
          codec.struct({
            a: codec.u16(),
            b: codec.f64(),
          }),
          8,
        ),
      }),
    });
    const rt = createRuntimeBinaryCodec(def);
    const bytes = rt.encode({
      magic: "TEST",
      tag: "ABC",
      pad: undefined,
      leVal: 0x11223344,
      rec: { a: 42, b: 2.718281828 },
    });
    const decoded = rt.decode(bytes);
    assert.equal(decoded["tag"], "ABC");
    assert.equal(decoded["leVal"], 0x11223344);
    assert.deepEqual(decoded["rec"], { a: 42, b: 2.718281828 });

    // align(0) must throw RangeError on both encode and decode
    const badAlign = createRuntimeBinaryCodec(
      defineBinaryCodec({
        name: "bad_align",
        endian: "le",
        root: codec.struct({ a: codec.u8(), p: codec.align(0) }),
      }),
    );
    assert.throws(() => badAlign.encode({ a: 1, p: undefined }), RangeError);
    assert.throws(() => badAlign.decode(new Uint8Array([1, 0])), RangeError);
  });

  it("evaluates bigint predicates in when() and infers soaTable count from countField on encode", () => {
    const def = defineBinaryCodec({
      name: "bigint_when_and_soa",
      endian: "le",
      root: codec.struct({
        flags: codec.u64(),
        extra: codec.when("flags", "==", 0, codec.u32()),
        n: codec.u32(),
        rows: codec.soaTable(
          "rows",
          {
            id: codec.i32(),
            val: codec.f64(),
          },
          { countField: "n" },
        ),
      }),
    });
    const rt = createRuntimeBinaryCodec(def);
    const encoded = rt.encode({
      flags: 0n,
      extra: 99,
      n: 2,
      // Intentionally omit `count` on rows to verify countField fallback
      rows: {
        id: new Int32Array([10, 20]),
        val: new Float64Array([1.25, 2.5]),
      },
    });
    const decoded = rt.decode(encoded) as {
      flags: bigint;
      extra: number | undefined;
      n: number;
      rows: { count: number; id: Int32Array; val: Float64Array };
    };
    assert.equal(decoded.flags, 0n);
    assert.equal(decoded.extra, 99);
    assert.equal(decoded.rows.count, 2);
    assert.deepEqual(Array.from(decoded.rows.id), [10, 20]);
    assert.deepEqual(Array.from(decoded.rows.val), [1.25, 2.5]);
  });

  it("streams chunks cleanly, rejects truncated EOF streams, and guards against 0-byte infinite loops", async () => {
    const streamDef = defineBinaryCodec({
      name: "frame_stream",
      endian: "le",
      root: codec.struct({
        count: codec.u32(),
        frames: codec.repeat("count", codec.struct({ t: codec.f64(), v: codec.i32() })),
      }),
    });
    const rt = createRuntimeBinaryCodec(streamDef);
    const full = rt.encode({
      count: 3,
      frames: [
        { t: 0.0, v: 1 },
        { t: 0.5, v: 2 },
        { t: 1.0, v: 3 },
      ],
    });

    // Split into tiny 5-byte chunks
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < full.byteLength; i += 5) {
      chunks.push(full.subarray(i, Math.min(i + 5, full.byteLength)));
    }
    const received: unknown[] = [];
    const res = await rt.decodeStream(chunks, (frame) => {
      received.push(frame);
    });
    assert.equal(res.framesEmitted, 3);
    assert.deepEqual(received, [
      { t: 0.0, v: 1 },
      { t: 0.5, v: 2 },
      { t: 1.0, v: 3 },
    ]);

    // Truncated trailing bytes at EOF must reject with RangeError
    const truncated = full.subarray(0, full.byteLength - 3);
    await assert.rejects(() => rt.decodeStream([truncated], () => {}), RangeError);

    // 0-byte itemCodec must not hang in an infinite loop
    const zeroByteDef = defineBinaryCodec({
      name: "zero_byte_item",
      endian: "le",
      root: codec.struct({
        flag: codec.u8(),
        items: codec.repeatUntilEof(codec.when("flag", "==", 99, codec.u8())),
      }),
    });
    const zeroRt = createRuntimeBinaryCodec(zeroByteDef);
    await assert.rejects(() => zeroRt.decodeStream([new Uint8Array([1, 2, 3])], () => {}), /consumed 0 bytes/);
  });

  it("validates readSlice startIndex and clamps availableRecords to declared countField", async () => {
    const def = defineBinaryCodec({
      name: "slice_test",
      endian: "le",
      root: codec.struct({
        count: codec.u32(),
        frames: codec.repeat("count", codec.struct({ x: codec.i32() })),
      }),
    });
    const rt = createRuntimeBinaryCodec(def);
    const base = rt.encode({ count: 2, frames: [{ x: 10 }, { x: 20 }] });
    // Append 8 trailing garbage bytes after the 2 declared frames
    const withTrailing = new Uint8Array(base.byteLength + 8);
    withTrailing.set(base);

    const reader: RandomAccessReader = {
      byteLength: withTrailing.byteLength,
      read: (offset, length) => withTrailing.subarray(offset, offset + length),
    };

    await assert.rejects(() => rt.readSlice(reader, -1, 1), RangeError);
    const slice = await rt.readSlice<{ x: number }>(reader, 1, 10);
    assert.deepEqual(slice.frames, [{ x: 20 }]);
  });

  it("emits complete LE/BE helpers, bounds checks, BE fortranRecord bswap, quoted when predicates, and throws on unsupported AS nodes", () => {
    const beDef = defineBinaryCodec({
      name: "be_soa_test",
      endian: "be",
      root: codec.struct({
        magic: codec.magic("BE01"),
        ver: codec.u16(),
        pad: codec.align(4),
        optVal: codec.when("ver", ">=", 2, codec.u64()),
        recVal: codec.fortranRecord(codec.i16(), 8),
        leFlag: codec.endian("le", codec.u32()),
        n: codec.u32(),
        items: codec.soaTable(
          "items",
          {
            id: codec.u16(),
            ts: codec.u64(),
          },
          { countField: "n" },
        ),
      }),
    });

    const asSrc = emitAssemblyScriptCodec(beDef);
    // All BE helpers present
    for (const helper of [
      "read_U8_BE",
      "read_I8_BE",
      "read_U16_BE",
      "read_I16_BE",
      "read_U64_BE",
      "read_I64_BE",
      "write_U8_BE",
      "write_I8_BE",
      "write_U16_BE",
      "write_I16_BE",
      "write_U64_BE",
      "write_I64_BE",
    ]) {
      assert.ok(asSrc.includes(`function ${helper}(`), `Missing AS helper ${helper}`);
    }
    // Bounds checking present
    assert.ok(asSrc.includes("inPos + 8 > inLen"));
    assert.ok(asSrc.includes("i64(n) * 10 > i64(inLen - inPos)"));
    // Nested scalars inside when/endian/fortranRecord get hdr_* globals
    assert.ok(asSrc.includes("let hdr_optVal: u64 = 0;"));
    assert.ok(asSrc.includes("let hdr_recVal: i16 = 0;"));
    assert.ok(asSrc.includes("let hdr_leFlag: u32 = 0;"));
    // BE fortranRecord patches leading length marker with bswap
    assert.ok(asSrc.includes("store<u64>(outBuf.dataStart + startPos, bswap<u64>(u64(payloadLen)));"));
    // Scoped endian override emits LE read/write
    assert.ok(asSrc.includes("hdr_leFlag = read_U32_LE();"));
    assert.ok(asSrc.includes("write_U32_LE(hdr_leFlag);"));

    // TypeScript bindings include stream export parity and nested header getters/setters
    const tsSrc = emitTypeScriptCodecBindings(beDef);
    assert.ok(tsSrc.includes("codec_streamGetBufferedBytes(): number;"));
    assert.ok(tsSrc.includes("codec_streamGetFramesEmitted(): number;"));
    assert.ok(tsSrc.includes("get_optVal(): bigint;"));
    assert.ok(tsSrc.includes("get_recVal(): number;"));

    // Unsupported node kinds throw explicitly instead of silently generating broken WASM
    const unsupportedDef = defineBinaryCodec({
      name: "unsupported_as",
      endian: "le",
      root: codec.struct({
        title: codec.lenPrefixedStr("u32"),
      }),
    });
    assert.throws(() => emitAssemblyScriptCodec(unsupportedDef), /unsupported codec node kind 'lenPrefixedStr'/);

    const unsupportedColDef = defineBinaryCodec({
      name: "unsupported_soa_col",
      endian: "le",
      root: codec.struct({
        rows: codec.soaTable("rows", { label: codec.fixedStr(8) }),
      }),
    });
    assert.throws(() => emitAssemblyScriptCodec(unsupportedColDef), /unsupported non-scalar column 'label'/);
  });

  it("throws an explicit error in buildParser if a production exceeds 255 RHS symbols", () => {
    const tokens = Array.from({ length: 260 }, () => "a");
    const lang = language({
      name: "too_long_rhs",
      rules: {
        start: () => seq(...tokens),
      },
    });
    assert.throws(() => buildParser(lang), /exceeding the maximum of 255/);
  });

  it("unifies multi-format text GLR dispatch and binary codecs automatically inside buildParser()", async () => {
    const soaCodec = defineBinaryCodec({
      name: "demo_soa",
      endian: "le",
      root: codec.struct({
        magic: codec.magic("DEMO"),
        count: codec.u32(),
        rows: codec.soaTable("rows", { x: codec.f64() }, { countField: "count" }),
      }),
    });
    const streamCodec = defineBinaryCodec({
      name: "demo_stream",
      endian: "le",
      root: codec.struct({
        title: codec.lenPrefixedStr("u32"),
        n: codec.u32(),
        frames: codec.repeat("n", codec.f64()),
      }),
    });

    const multiLang = language({
      name: "UnifiedDemo",
      extras: () => [/[ \t\r\n]+/],
      formats: {
        alpha: { kind: "text", fileExtensions: [".alpha"], startRule: "AlphaDoc" },
        beta: { kind: "text", fileExtensions: [".beta"], startRule: "BetaDoc" },
        soa: { kind: "binary", fileExtensions: [".soa"], codec: soaCodec },
        stream: { kind: "binary", fileExtensions: [".strm"], codec: streamCodec },
      },
      rules: {
        SourceFile: ($) => seq("default", $["Ident"]!),
        AlphaDoc: ($) => seq("alpha", $["Num"]!),
        BetaDoc: ($) => seq("beta", $["Ident"]!),
        Num: () => /[0-9]+/,
        Ident: () => /[a-z]+/,
      },
    });

    const built = buildParser(multiLang);

    // 1. Secondary format startRules are reachable (no unreachable-rule warning) and conflict-free
    const unreachable = (built.grammarDiagnostics ?? []).filter((d) => d.code === "unreachable-rule");
    assert.equal(unreachable.length, 0, `Unexpected unreachable rules: ${JSON.stringify(unreachable)}`);
    assert.equal(built.conflicts?.length ?? 0, 0, `Unexpected conflicts: ${JSON.stringify(built.conflicts)}`);

    // 2. Binary codecs are automatically emitted on BuildResult.binaryCodecs
    assert.ok(built.binaryCodecs && built.binaryCodecs.length === 2);
    const soaOut = built.binaryCodecs.find((c) => c.formatKey === "soa");
    const streamOut = built.binaryCodecs.find((c) => c.formatKey === "stream");
    assert.ok(soaOut?.assemblyScript?.includes("export function codec_decode"));
    assert.ok(soaOut?.typeScriptBindings.includes("export interface DemoSoaData"));
    assert.equal(soaOut?.assemblyScriptError, undefined);
    assert.equal(streamOut?.assemblyScript, undefined);
    assert.ok(streamOut?.assemblyScriptError?.includes("lenPrefixedStr"));
    assert.ok(streamOut?.typeScriptBindings.includes("export interface DemoStreamData"));

    // 3. Compile synthesized multi-format GLR parser to WASM and verify default + sentinel dispatch
    const tmpDir = path.join(__dirname, "scratch_build_unified_formats");
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      for (const file of built.assemblyScriptFiles) {
        const destPath = path.join(tmpDir, file.filename);
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.writeFileSync(destPath, file.content);
      }

      const ascPath = path.resolve(__dirname, "../../../node_modules/.bin/asc");
      const parserTs = path.join(tmpDir, "parser.ts");
      const outWasm = path.join(tmpDir, "parser.wasm");
      childProcess.execFileSync(
        ascPath,
        [parserTs, "-o", outWasm, "--exportRuntime", "--enable", "threads", "-O0", "--runtime", "stub"],
        { stdio: "pipe" },
      );

      const wasmModule = await WebAssembly.compile(fs.readFileSync(outWasm));
      const memory = new WebAssembly.Memory({ initial: 128, maximum: 1024, shared: true });
      const instance = await WebAssembly.instantiate(wasmModule, {
        env: {
          memory,
          abort: () => {
            throw new Error("WASM abort");
          },
          logNode: () => {},
          debugLog: () => {},
        },
        JavaScript: { debugLog: () => {}, logNode: () => {} },
        engine: { debugLog: () => {} },
        parser: { logInt: () => {} },
        recovery: {},
        host: { runHostQuery: () => {} },
      });
      const wasmMem = (instance.exports.memory as WebAssembly.Memory) || memory;
      const wrapperSrc =
        built.javascriptWrapper.js.replace(/export default /g, "").replace(/export /g, "") +
        `\nreturn { LspFacade, Tree, TreeSitterParser };`;
      const { LspFacade: LspFacadeGen, TreeSitterParser: TreeSitterParserGen } = new Function(wrapperSrc)();
      const facade = new LspFacadeGen(wasmMem, instance.exports);
      const treeParser = new TreeSitterParserGen();
      treeParser.setLanguage(() => facade);

      const tDefault = treeParser.parse("default hello");
      assert.ok(tDefault && !tDefault.rootNode.hasError, "default parse should succeed without errors");

      const tAlpha = treeParser.parseFormat("alpha 42", "alpha");
      assert.ok(tAlpha && !tAlpha.rootNode.hasError, "alpha format parse should succeed without errors");
      assert.ok(
        tAlpha.rootNode.namedChildren.some((c: { type: string }) => c.type === "AlphaDoc"),
        `Expected AlphaDoc child, got ${tAlpha.rootNode.namedChildren.map((c: { type: string }) => c.type).join(",")}`,
      );

      const tBeta = treeParser.parseFormat("beta world", "beta");
      assert.ok(tBeta && !tBeta.rootNode.hasError, "beta format parse should succeed without errors");
      assert.ok(
        tBeta.rootNode.namedChildren.some((c: { type: string }) => c.type === "BetaDoc"),
        `Expected BetaDoc child, got ${tBeta.rootNode.namedChildren.map((c: { type: string }) => c.type).join(",")}`,
      );
      assert.equal(encodeFormatSource("beta world", "beta"), "\uE000beta\uE001beta world");
    } finally {
      if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("reports undefined-rule diagnostic when a text format references a non-existent startRule", () => {
    const badLang = language({
      name: "BadFormatRef",
      formats: {
        broken: { kind: "text", fileExtensions: [".brk"], startRule: "DoesNotExist" as never },
      },
      rules: {
        Start: () => "ok",
      },
    });
    const built = buildParser(badLang);
    assert.ok(
      (built.grammarDiagnostics ?? []).some((d) => d.code === "undefined-rule" && d.message.includes("DoesNotExist")),
    );
  });

  it("supports dotted field paths and BinaryExpr arithmetic/bitwise expressions in repeat, bytes, when, and readSlice", async () => {
    const def = defineBinaryCodec({
      name: "expr_and_dotted",
      endian: "le",
      root: codec.struct({
        header: codec.struct({
          flags: codec.u8(),
          totalBytes: codec.u16(),
          nChannels: codec.u16(),
          nSteps: codec.u16(),
        }),
        optMeta: codec.when(codec.expr.bitAnd("header.flags", 0x04), "!=", 0, codec.u32()),
        payload: codec.bytes(codec.expr.sub("header.totalBytes", 2)),
        frames: codec.repeat(
          "header.nSteps",
          codec.struct({
            time: codec.f64(),
            values: codec.repeat("header.nChannels", codec.f32()),
          }),
        ),
      }),
    });
    const rt = createRuntimeBinaryCodec(def);
    const input = {
      header: { flags: 0x05, totalBytes: 6, nChannels: 2, nSteps: 3 },
      optMeta: 0xdeadbeef,
      payload: new Uint8Array([1, 2, 3, 4]),
      frames: [
        { time: 0.0, values: [1.0, 2.0] },
        { time: 0.5, values: [3.0, 4.0] },
        { time: 1.0, values: [5.0, 6.0] },
      ],
    };
    const bytes = rt.encode(input);
    const decoded = rt.decode(bytes);
    assert.deepEqual(decoded, input);

    // O(1) readSlice works seamlessly with dotted `header.nChannels` and `header.nSteps`
    const reader: RandomAccessReader = {
      byteLength: bytes.byteLength,
      read: (offset, length) => bytes.subarray(offset, offset + length),
    };
    const slice = await rt.readSlice(reader, 1, 2);
    assert.deepEqual(slice.frames, input.frames.slice(1, 3));
  });

  it("round-trips bitfield (BE & LE), cstr, varint (uleb128/sleb128/zigzag), sized, and tlv combinators", () => {
    // Bitfield validation
    assert.throws(() => codec.bitfield({ a: 3, b: 2 }), RangeError);

    const def = defineBinaryCodec({
      name: "phase4_combinators",
      endian: "be",
      root: codec.struct({
        ipHdr: codec.bitfield({ version: 4, ihl: 4, dscp: 6, ecn: 2 }, "be"),
        leBits: codec.bitfield({ flagA: 1, flagB: 1, mode: 3, reserved: 3 }, "le"),
        label: codec.cstr("utf-8"),
        asciiTag: codec.cstr("ascii"),
        uVar: codec.varint("uleb128"),
        sVarNeg: codec.varint("sleb128"),
        zzNeg: codec.varint("zigzag"),
        zzPos: codec.varint("zigzag"),
        box: codec.sized(8, codec.struct({ id: codec.u16(), val: codec.u16() })),
        chunks: codec.repeat(
          3,
          codec.tlv(codec.fixedStr(4, " ", false), "u16", {
            "NUM ": codec.f64(),
            "STR ": codec.cstr("utf-8"),
          }),
        ),
        kind: codec.u8(),
        variant: codec.switchOn("kind", {
          "1": codec.u32(),
          "2": codec.cstr("utf-8"),
        }),
      }),
    });

    const rt = createRuntimeBinaryCodec(def);
    const input = {
      ipHdr: { version: 4, ihl: 5, dscp: 46, ecn: 2 },
      leBits: { flagA: 1, flagB: 0, mode: 5, reserved: 3 },
      label: "hello-λ",
      asciiTag: "NODE_1",
      uVar: 300000,
      sVarNeg: -123456,
      zzNeg: -42,
      zzPos: 100000,
      box: { id: 7, val: 99 },
      chunks: [
        { tag: "NUM ", value: 3.141592653589793 },
        { tag: "STR ", value: "tlv-payload" },
        { tag: "RAW ", value: new Uint8Array([0xaa, 0xbb, 0xcc]) },
      ],
      kind: 2,
      variant: "switched-str",
    };

    const bytes = rt.encode(input);
    const decoded = rt.decode(bytes);
    assert.deepEqual(decoded, input);

    // cstr without NUL must throw RangeError
    const cstrOnly = createRuntimeBinaryCodec(
      defineBinaryCodec({ name: "cstr_only", endian: "le", root: codec.struct({ s: codec.cstr() }) }),
    );
    assert.throws(() => cstrOnly.decode(new Uint8Array([65, 66, 67])), RangeError);

    // TypeScript bindings emit proper union for switchOn and tlv, plus bitfield shape
    const tsSrc = emitTypeScriptCodecBindings(def);
    assert.ok(tsSrc.includes("ipHdr: { version: number; ihl: number; dscp: number; ecn: number };"));
    assert.ok(tsSrc.includes("variant: number | string | undefined;"));
    assert.ok(tsSrc.includes("tag: string; value: number | string | Uint8Array"));

    // AssemblyScript codegen supports BinaryExpr in when() and sized(), and auto-syncs countField
    const asExprDef = defineBinaryCodec({
      name: "as_expr_sized",
      endian: "le",
      root: codec.struct({
        flags: codec.u32(),
        boxLen: codec.u32(),
        optVal: codec.when(codec.expr.bitAnd("flags", 2), "!=", 0, codec.u32()),
        boxed: codec.sized("boxLen", codec.u32()),
        rowCount: codec.u32(),
        rows: codec.soaTable("rows", { x: codec.f64() }, { countField: "rowCount" }),
      }),
    });
    const asSrc = emitAssemblyScriptCodec(asExprDef);
    assert.ok(asSrc.includes("if ((hdr_flags & 2) != 0)"));
    assert.ok(asSrc.includes("const sLen: i32 = i32(hdr_boxLen);"));
    assert.ok(asSrc.includes("hdr_rowCount = u32(tbl_rows_count);"));
  });

  it("handles regex /i and /s flags, empty groups/alternations, and rejects malformed regexes cleanly", () => {
    const runDfa = (dfa: ReturnType<typeof compileRegexToDFA>, input: string): string[] | null => {
      const getClass = (cp: number) => {
        for (const r of dfa.classRanges) {
          if (cp >= r.s && cp <= r.e) return r.c;
        }
        return -1;
      };
      let state = 0;
      for (let i = 0; i < input.length; i++) {
        const cls = getClass(input.charCodeAt(i));
        if (cls < 0) return null;
        const next = dfa.table[state * dfa.numClasses + cls];
        if (next === undefined || next < 0) return null;
        state = next;
      }
      return dfa.accepts[state] ?? null;
    };

    const ciDfa = compileRegexToDFA([{ pattern: "model", tokenName: "KW_MODEL", flags: "i" }]);
    assert.deepEqual(runDfa(ciDfa, "MODEL"), ["KW_MODEL"]);
    assert.deepEqual(runDfa(ciDfa, "MoDeL"), ["KW_MODEL"]);
    assert.equal(runDfa(ciDfa, "other"), null);

    const dotAllDfa = compileRegexToDFA([{ pattern: "a.b", tokenName: "DOTALL", flags: "s" }]);
    assert.deepEqual(runDfa(dotAllDfa, "a\nb"), ["DOTALL"]);

    // Empty group & empty alternation must not throw
    const emptyAltDfa = compileRegexToDFA([{ pattern: "a(|b)", tokenName: "OPT_B" }]);
    assert.deepEqual(runDfa(emptyAltDfa, "a"), ["OPT_B"]);
    assert.deepEqual(runDfa(emptyAltDfa, "ab"), ["OPT_B"]);

    // Malformed patterns must throw SyntaxError instead of hanging or truncating
    assert.throws(() => compileRegexToDFA([{ pattern: "\\u{1234", tokenName: "BAD_U" }]), SyntaxError);
    assert.throws(() => compileRegexToDFA([{ pattern: "foo)bar", tokenName: "BAD_PAREN" }]), SyntaxError);
    assert.throws(() => compileRegexToDFA([{ pattern: "foo\\", tokenName: "BAD_BS" }]), SyntaxError);
  });
});
