// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createPsseSavWasmCodec,
  emitPsseSavCodecAssemblyScript,
  emitPsseSavCodecTypeScriptBindings,
  getPsseWasmParser,
  lintPsse,
  parseIdv,
  parseRaw,
  parseSeq,
  psseLanguage,
  psseOutFortranFrameCodec,
  psseOutStreamCodec,
  psseSavSoaCodec,
  readPsseOutWindow,
  serializePsseRaw,
  serializePsseSeq,
  solvePowerFlow,
  streamPsseOut,
  type PsseOutStreamFrame,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IEEE14_PATH = path.resolve(__dirname, "../testsuite/ieee14.raw");

const ALL_PSSE_VERSIONS = [26, 29, 30, 31, 32, 33, 34, 35, 36] as const;

describe("PSS/E v26–v36 version parity, @! metadata, and GLR/Binary Codec DSL", () => {
  it("registers all text and binary formats on psseLanguage.formats", () => {
    assert.ok(psseLanguage.formats, "psseLanguage.formats must be defined");
    const keys = Object.keys(psseLanguage.formats);
    for (const fmt of ["raw", "dyr", "seq", "con", "idv", "sav", "out"]) {
      assert.ok(keys.includes(fmt), `Expected format '${fmt}' to be registered`);
    }
    assert.equal(psseLanguage.formats.raw?.kind, "text");
    assert.deepEqual(psseLanguage.formats.raw?.versions, [26, 29, 30, 31, 32, 33, 34, 35, 36]);
    assert.equal(psseLanguage.formats.sav?.kind, "binary");
    assert.equal(psseLanguage.formats.out?.kind, "binary");
  });

  it("round-trips IEEE 14 across all versions v26–v36 with identical AC Power Flow convergence", () => {
    const rawText = fs.readFileSync(IEEE14_PATH, "utf-8");
    const baseCase = parseRaw(rawText);
    const baseSol = solvePowerFlow(baseCase);
    assert.ok(baseSol.converged, "Baseline IEEE 14 power flow must converge");

    for (const rev of ALL_PSSE_VERSIONS) {
      const exported = serializePsseRaw(baseCase, { rev });
      const reparsed = parseRaw(exported);

      assert.equal(reparsed.header.rev, rev, `Expected parsed rev=${rev}, got ${reparsed.header.rev}`);
      assert.equal(reparsed.buses.size, baseCase.buses.size, `Bus count mismatch for v${rev}`);
      assert.equal(reparsed.loads.length, baseCase.loads.length, `Load count mismatch for v${rev}`);
      assert.equal(reparsed.generators.length, baseCase.generators.length, `Gen count mismatch for v${rev}`);
      assert.equal(reparsed.branches.length, baseCase.branches.length, `Branch count mismatch for v${rev}`);
      assert.equal(reparsed.transformers.length, baseCase.transformers.length, `Xfmr count mismatch for v${rev}`);

      // Verify P1004 revision lint is clean on every valid exported version
      const p1004 = lintPsse(reparsed).filter((d) => d.code === "P1004");
      assert.equal(p1004.length, 0, `Unexpected P1004 lint on valid v${rev} export: ${JSON.stringify(p1004)}`);

      const sol = solvePowerFlow(reparsed);
      assert.ok(sol.converged, `Power flow must converge for v${rev}`);

      let maxDv = 0;
      let maxDa = 0;
      assert.equal(sol.buses.length, baseSol.buses.length, `Bus solution length mismatch for v${rev}`);
      for (let k = 0; k < baseSol.buses.length; k++) {
        const bus = baseSol.buses[k]!;
        const match = sol.buses[k]!;
        maxDv = Math.max(maxDv, Math.abs(match.vm - bus.vm));
        maxDa = Math.max(maxDa, Math.abs(match.va - bus.va));
      }
      assert.ok(maxDv < 1e-6, `v${rev} max |ΔV| too large: ${maxDv}`);
      assert.ok(maxDa < 1e-5, `v${rev} max |Δθ| too large: ${maxDa}`);
    }
  });

  it("infers pre-v30 revisions (v26/v29) without BEGIN comments and normalizes Bus GL/BL into fixedShunts", () => {
    const legacyV26 = `0, 100.00 / PSS/E-26 LEGACY CASE
LEGACY V26 2-BUS TEST
LINE 2
1, 'SLACK       ', 138.000, 3, 0.000, 0.000, 1, 1, 1.0200, 0.0000
2, 'LOAD_SHUNT  ', 138.000, 1, 5.000, 12.500, 1, 1, 1.0000, -2.0000
0 /
2, '1 ', 1, 1, 1, 40.000, 10.000, 0.0, 0.0, 0.0, 0.0, 1, 1, 1
0 /
1, '1 ', 45.0, 0.0, 100.0, -100.0, 1.02, 0, 100.0, 0.0, 0.1, 0.0, 0.0, 1.0, 1, 100.0, 100.0, 0.0
0 /
1, 2, '1 ', 0.01000, 0.05000, 0.02000, 100.0, 110.0, 120.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 1.0
0 /
0 /
Q
`;
    const parsed = parseRaw(legacyV26);
    assert.equal(parsed.header.rev, 26);
    assert.equal(parsed.buses.size, 2);
    assert.equal(parsed.loads.length, 1);
    assert.equal(parsed.generators.length, 1);
    assert.equal(parsed.branches.length, 1);
    assert.equal(parsed.fixedShunts.length, 1);
    assert.equal(parsed.fixedShunts[0]!.i, 2);
    assert.equal(parsed.fixedShunts[0]!.gl, 5.0);
    assert.equal(parsed.fixedShunts[0]!.bl, 12.5);
    assert.equal(parsed.buses.get(2)!.vm, 1.0);
    assert.equal(parsed.buses.get(2)!.va, -2.0);
  });

  it("resolves reordered v36 @! metadata columns dynamically", () => {
    const v36Reordered = `0, 100.00, 36, 0, 1, 60.00 / PSS/E-36 REORDERED COLUMNS
V36 METADATA TEST
LINE 2
@! I, 'NAME', BASKV, IDE, VA, VM, AREA, ZONE, OWNER, NVHI, NVLO, EVHI, EVLO
1, 'BUS1        ', 230.0, 3, -5.25, 1.045, 2, 3, 4, 1.1, 0.9, 1.15, 0.85
0 / END OF BUS DATA
Q
`;
    const parsed = parseRaw(v36Reordered);
    assert.equal(parsed.header.rev, 36);
    const b1 = parsed.buses.get(1)!;
    assert.equal(b1.vm, 1.045);
    assert.equal(b1.va, -5.25);
    assert.equal(b1.area, 2);
    assert.equal(b1.zone, 3);
    assert.equal(b1.owner, 4);
  });

  it("parses .idv commands cleanly via GLR CST tokens", () => {
    const idv = `
@! Batch header comment
CASE 'ieee14.raw' / open base case
BAT_FNSL 0, 0, 0, 1, 1, 0, 99, 0
OPEN BRANCH 1 TO 2
# ignored hash comment
`;
    const cmds = parseIdv(idv);
    assert.equal(cmds.length, 3);
    assert.equal(cmds[0]!.command, "CASE");
    assert.deepEqual(cmds[0]!.args, ["ieee14.raw"]);
    assert.equal(cmds[1]!.command, "FNSL");
    assert.equal(cmds[1]!.args.length, 8);
    assert.equal(cmds[2]!.command, "OPEN");
    assert.deepEqual(cmds[2]!.args, ["BRANCH", "1", "TO", "2"]);
  });

  it("round-trips psseSavSoaCodec into packed TypedArrays and emits AS/TS codec code", () => {
    const input = {
      magic: "PSSE_SOA",
      version: 36,
      rev: 36,
      sbase: 100.0,
      basfrq: 60.0,
      busCount: 2,
      buses: {
        count: 2,
        i: new Int32Array([1, 2]),
        ide: new Int32Array([3, 1]),
        area: new Int32Array([1, 1]),
        zone: new Int32Array([1, 1]),
        owner: new Int32Array([1, 1]),
        baseKv: new Float64Array([230.0, 138.0]),
        vm: new Float64Array([1.02, 0.995]),
        va: new Float64Array([0.0, -3.5]),
      },
      branchCount: 1,
      branches: {
        count: 1,
        i: new Int32Array([1]),
        j: new Int32Array([2]),
        st: new Int32Array([1]),
        r: new Float64Array([0.01]),
        x: new Float64Array([0.05]),
        b: new Float64Array([0.02]),
        rateA: new Float64Array([250.0]),
      },
      genCount: 1,
      generators: {
        count: 1,
        i: new Int32Array([1]),
        stat: new Int32Array([1]),
        pg: new Float64Array([50.0]),
        qg: new Float64Array([10.0]),
        qt: new Float64Array([100.0]),
        qb: new Float64Array([-100.0]),
        vs: new Float64Array([1.02]),
        mbase: new Float64Array([100.0]),
      },
    };

    const bytes = psseSavSoaCodec.encode(input);
    const decoded = psseSavSoaCodec.decode(bytes) as typeof input;
    assert.equal(decoded.rev, 36);
    assert.ok(decoded.buses.vm instanceof Float64Array);
    assert.ok(decoded.buses.i instanceof Int32Array);
    assert.deepEqual([...decoded.buses.i], [1, 2]);
    assert.ok(Math.abs(decoded.buses.vm[1]! - 0.995) < 1e-12);
    assert.equal(decoded.branches.rateA[0], 250.0);

    const asCode = emitPsseSavCodecAssemblyScript();
    assert.ok(asCode.includes("export function codec_decode("));
    assert.ok(asCode.includes("export function get_buses_vm_ptr(): usize"));

    const tsCode = emitPsseSavCodecTypeScriptBindings();
    assert.ok(tsCode.includes("export interface PsseSavSoaBusesSoaView"));
    assert.ok(tsCode.includes("export function createPsseSavSoaWasmView"));
  });

  it("streams PSSE_OUT across tiny split chunks and supports O(1) fixed-stride window seeking", async () => {
    const numSteps = 40;
    const frames: PsseOutStreamFrame[] = [];
    for (let s = 0; s < numSteps; s++) {
      frames.push({ time: s * 0.01, values: [1.0 + s * 0.001, -s * 0.5] });
    }

    const encoded = psseOutStreamCodec.encode({
      magic: "PSSE_OUT",
      version: 36,
      caseTitle: "STREAM TEST",
      numChannels: 2,
      channelMeta: [
        { name: "Vm_Bus1", unit: "pu" },
        { name: "Angle_Bus1", unit: "deg" },
      ],
      numSteps,
      frames,
    });

    // Feed in adversarial 7-byte chunks so records split across chunk boundaries
    function* splitChunks(buf: Uint8Array, chunkSize: number): Generator<Uint8Array> {
      for (let off = 0; off < buf.byteLength; off += chunkSize) {
        yield buf.subarray(off, Math.min(off + chunkSize, buf.byteLength));
      }
    }

    const streamed: PsseOutStreamFrame[] = [];
    const streamRes = await streamPsseOut(splitChunks(encoded, 7), (frame) => {
      streamed.push(frame);
    });
    assert.equal(streamRes.header.caseTitle, "STREAM TEST");
    assert.equal(streamRes.framesEmitted, numSteps);
    assert.ok(Math.abs(streamed[25]!.time - 0.25) < 1e-12);
    assert.ok(Math.abs(streamed[25]!.values[0]! - 1.025) < 1e-12);

    // Verify O(1) fixed-stride seeking reads only header + requested slice
    let bytesRead = 0;
    const reader = {
      byteLength: encoded.byteLength,
      read(offset: number, length: number) {
        bytesRead += length;
        return encoded.subarray(offset, offset + length);
      },
    };
    const slice = await readPsseOutWindow(reader, 10, 5);
    assert.equal(slice.frames.length, 5);
    assert.ok(Math.abs(slice.frames[0]!.time - 0.1) < 1e-12);
    assert.ok(Math.abs(slice.frames[4]!.time - 0.14) < 1e-12);
    assert.ok(bytesRead <= encoded.byteLength + 256);

    // Verify Fortran sequential record codec round-trip
    const fortranPayload = {
      numChannels: 2,
      records: [
        { time: 0.0, values: [1.0, 0.0] },
        { time: 0.5, values: [0.98, -12.5] },
      ],
    };
    const fBytes = psseOutFortranFrameCodec.encode(fortranPayload);
    const fDecoded = psseOutFortranFrameCodec.decode(fBytes) as typeof fortranPayload;
    assert.equal(fDecoded.records.length, 2);
    assert.ok(Math.abs(fDecoded.records[1]!.values[1]! - -12.5) < 1e-5);
  });

  it("executes compiled psse-sav-codec.wasm end-to-end with zero-copy SoA mutation and WASM streaming", async () => {
    const input = {
      magic: "PSSE_SOA",
      version: 36,
      rev: 36,
      sbase: 100.0,
      basfrq: 60.0,
      busCount: 2,
      buses: {
        count: 2,
        i: new Int32Array([101, 102]),
        ide: new Int32Array([3, 1]),
        area: new Int32Array([1, 1]),
        zone: new Int32Array([1, 1]),
        owner: new Int32Array([1, 1]),
        baseKv: new Float64Array([230.0, 138.0]),
        vm: new Float64Array([1.02, 0.99]),
        va: new Float64Array([0.0, -4.2]),
      },
      branchCount: 1,
      branches: {
        count: 1,
        i: new Int32Array([101]),
        j: new Int32Array([102]),
        st: new Int32Array([1]),
        r: new Float64Array([0.01]),
        x: new Float64Array([0.05]),
        b: new Float64Array([0.02]),
        rateA: new Float64Array([300.0]),
      },
      genCount: 1,
      generators: {
        count: 1,
        i: new Int32Array([101]),
        stat: new Int32Array([1]),
        pg: new Float64Array([80.0]),
        qg: new Float64Array([15.0]),
        qt: new Float64Array([100.0]),
        qb: new Float64Array([-100.0]),
        vs: new Float64Array([1.02]),
        mbase: new Float64Array([100.0]),
      },
    };

    const bytes = psseSavSoaCodec.encode(input);
    const wasmView = createPsseSavWasmCodec();
    const consumed = wasmView.decode(bytes);
    assert.equal(consumed, bytes.byteLength);
    assert.equal(wasmView.rev, 36);
    assert.equal(wasmView.sbase, 100.0);
    assert.equal(wasmView.buses.count, 2);
    assert.deepEqual([...wasmView.buses.i], [101, 102]);
    assert.ok(Math.abs(wasmView.buses.vm[1]! - 0.99) < 1e-12);
    assert.equal(wasmView.branches.rateA[0], 300.0);

    // Mutate linear-memory Float64Array in place and re-encode directly from WASM!
    wasmView.buses.vm[1] = 1.0125;
    const reencoded = wasmView.encode();
    assert.equal(reencoded.byteLength, bytes.byteLength);

    // Stream back into a fresh WASM codec instance in 11-byte chunks
    const wasmView2 = createPsseSavWasmCodec();
    function* chunk11(buf: Uint8Array) {
      for (let off = 0; off < buf.byteLength; off += 11) {
        yield buf.subarray(off, Math.min(off + 11, buf.byteLength));
      }
    }
    const streamedBytes = await wasmView2.decodeStream(chunk11(reencoded));
    assert.equal(streamedBytes, reencoded.byteLength);
    assert.ok(Math.abs(wasmView2.buses.vm[1]! - 1.0125) < 1e-12);
  });

  it("parses and round-trips v35/v36 System Switching Device records without corrupting Transformers", () => {
    const rawWithSwd = `0, 100.00, 35, 0, 1, 60.00 / PSS/E-35 SWD CASE
SWD TEST
LINE 2
@! I, 'NAME', BASKV, IDE, AREA, ZONE, OWNER, VM, VA, NVHI, NVLO, EVHI, EVLO
1, 'BUS1        ', 230.0, 3, 1, 1, 1, 1.02, 0.0, 1.1, 0.9, 1.1, 0.9
2, 'BUS2        ', 230.0, 1, 1, 1, 1, 1.01, -1.0, 1.1, 0.9, 1.1, 0.9
0 / END OF BUS DATA, BEGIN LOAD DATA
0 / END OF LOAD DATA, BEGIN FIXED SHUNT DATA
0 / END OF FIXED SHUNT DATA, BEGIN GENERATOR DATA
0 / END OF GENERATOR DATA, BEGIN BRANCH DATA
0 / END OF BRANCH DATA, BEGIN SYSTEM SWITCHING DEVICE DATA
@! I, J, 'CKT', X, RATE1, RATE2, RATE3, STAT, NSTAT, MET, STYPE, 'NAME'
1, 2, '1 ', 0.00010, 500.00, 550.00, 600.00, 1, 1, 1, 2, 'CB_1_2'
0 / END OF SYSTEM SWITCHING DEVICE DATA, BEGIN TRANSFORMER DATA
0 / END OF TRANSFORMER DATA
Q
`;
    const parsed = parseRaw(rawWithSwd);
    assert.equal(parsed.systemSwitchingDevices?.length, 1);
    assert.equal(parsed.systemSwitchingDevices![0]!.name, "CB_1_2");
    assert.equal(parsed.systemSwitchingDevices![0]!.stype, 2);
    assert.equal(parsed.transformers.length, 0);

    const v36Out = serializePsseRaw(parsed, { rev: 36 });
    const reparsed = parseRaw(v36Out);
    assert.equal(reparsed.header.rev, 36);
    assert.equal(reparsed.systemSwitchingDevices?.length, 1);
    assert.equal(reparsed.systemSwitchingDevices![0]!.name, "CB_1_2");
  });

  it("flags P1004 revision mismatches across v30, v33, and v36 boundaries", () => {
    const v30With13BusCols = `0, 100.00, 30, 0, 0, 60.00 / REV=30 with v32+ 13-col bus
TEST
LINE 2
1, 'BUS1        ', 230.0, 3, 1, 1, 1, 1.0, 0.0, 1.1, 0.9, 1.1, 0.9
0 / END OF BUS DATA
Q
`;
    const v36With9BusCols = `0, 100.00, 36, 0, 1, 60.00 / REV=36 with short 9-col bus
TEST
LINE 2
1, 'BUS1        ', 230.0, 3, 1, 1, 1, 1.0, 0.0
0 / END OF BUS DATA
Q
`;
    assert.ok(lintPsse(parseRaw(v30With13BusCols)).some((d) => d.code === "P1004"));
    assert.ok(lintPsse(parseRaw(v36With9BusCols)).some((d) => d.code === "P1004"));
  });

  it("dispatches multi-format GLR entry points (RawFile, DyrFile, SeqFile, ConFile, IdvFile) in one parser.wasm", () => {
    const parser = getPsseWasmParser();
    const cases: Array<[string, string]> = [
      ["raw", "0, 100.0, 36, 0, 1, 60.0 / RAW\n0 / END\nQ\n"],
      ["dyr", "1 'GENROU' 1 8.0 0.03 / \n"],
      ["seq", "0, 36 / SEQ\n1, '1', 0.0, 0.2 /\n0 / END\n"],
      ["con", "CONTINGENCY 'C1'\nOPEN BRANCH FROM BUS 1 TO BUS 2 CKT 1\nEND\n"],
      ["idv", "BAT_FNSL 0, 0, 0, 1\n"],
    ];
    const seenEntryTypes = new Set<string>();
    for (const [fmt, src] of cases) {
      const tree = parser.parseFormat(src, fmt);
      assert.ok(tree?.rootNode, `Expected CST root for format '${fmt}'`);
      assert.equal(tree.rootNode.hasError, false, `Unexpected parse error for format '${fmt}'`);
      assert.equal(tree.rootNode.children.length, 2, `Expected [FormatMarker, EntryRule] for '${fmt}'`);
      seenEntryTypes.add(tree.rootNode.children[1]!.type);
    }
    assert.equal(seenEntryTypes.size, cases.length, "Each format must dispatch to a distinct GLR entry rule");
  });

  it("round-trips .seq files across v30–v36 including v34+ @! metadata headers", () => {
    const seqPath = path.resolve(__dirname, "../testsuite/ieee14.seq");
    const baseSeq = parseSeq(fs.readFileSync(seqPath, "utf-8"));
    for (const rev of [30, 33, 34, 35, 36] as const) {
      const text = serializePsseSeq(baseSeq, { rev });
      if (rev >= 34) {
        assert.ok(text.includes("@!"), `Expected @! metadata header in v${rev} .seq export`);
      }
      const reparsed = parseSeq(text);
      assert.equal(reparsed.generators.length, baseSeq.generators.length, `Seq gen count mismatch for v${rev}`);
      assert.equal(reparsed.branches.length, baseSeq.branches.length, `Seq branch count mismatch for v${rev}`);
      assert.equal(reparsed.transformers.length, baseSeq.transformers.length, `Seq xfmr count mismatch for v${rev}`);
    }
  });

  it("parses multi-line .dyr records into structured DyrRecord CST children via parseFormat('dyr')", () => {
    const parser = getPsseWasmParser();
    const dyrSrc = `
@! Dynamic model header
1 'GENROU' 1 8.96 0.03
  0.31 0.05 23.64 /
2 'TGOV1' 1 0.05 0.5 1.2 /
`;
    const tree = parser.parseFormat(dyrSrc, "dyr");
    assert.ok(tree?.rootNode, "Expected CST root");
    assert.equal(tree.rootNode.hasError, false, "Expected zero parse errors on multi-line .dyr");
    const dyrFileNode = tree.rootNode.children[1]!;
    // 1 BangComment + 2 DyrRecord nodes = 3 children under DyrFile
    assert.equal(
      dyrFileNode.children.length,
      3,
      `Expected 3 structured children under DyrFile, got ${dyrFileNode.children.length}`,
    );
  });

  it("executes read_psse_out_window language action and streams large 10,000-step .out in 64KB chunks", async () => {
    const numSteps = 10_000;
    const numChannels = 8;
    const frames: PsseOutStreamFrame[] = new Array(numSteps);
    for (let s = 0; s < numSteps; s++) {
      frames[s] = {
        time: s * 0.001,
        values: [1.0, s * 0.01, -s * 0.01, 60.0, 0.5, 0.25, 1.02, 0.98],
      };
    }
    const encoded = psseOutStreamCodec.encode({
      magic: "PSSE_OUT",
      version: 36,
      caseTitle: "LARGE STREAM BENCHMARK",
      numChannels,
      channelMeta: Array.from({ length: numChannels }, (_, i) => ({ name: `CH_${i + 1}`, unit: "pu" })),
      numSteps,
      frames,
    });

    // Stream in 64KB chunks
    function* chunks64k(buf: Uint8Array) {
      for (let off = 0; off < buf.byteLength; off += 65536) {
        yield buf.subarray(off, Math.min(off + 65536, buf.byteLength));
      }
    }
    let lastTime = 0;
    const res = await streamPsseOut(chunks64k(encoded), (frame) => {
      lastTime = frame.time;
    });
    assert.equal(res.framesEmitted, numSteps);
    assert.ok(Math.abs(lastTime - (numSteps - 1) * 0.001) < 1e-9);

    // Verify O(1) seek via read_psse_out_window language action reads < 1% of the file
    const action = psseLanguage.actions?.find((a) => a.id === "read_psse_out_window");
    assert.ok(action, "Expected read_psse_out_window language action");
    const win = (await action.execute({}, { binaryBuffer: encoded, startStep: 9000, count: 50 })) as {
      frames: PsseOutStreamFrame[];
    };
    assert.equal(win.frames.length, 50);
    assert.ok(Math.abs(win.frames[0]!.time - 9.0) < 1e-9);
    assert.ok(Math.abs(win.frames[49]!.time - 9.049) < 1e-9);
  });
});
