// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BufferByteRangeSource,
  encodePackageIndex,
  getSymbolDomain,
  LanguageDomainId,
  makePolyglotSymbolId,
  mountPackageIndex,
  MSIDX_COMPILER_ABI_VERSION,
  MSIDX_FORMAT_VERSION,
  MSIDX_MAGIC,
  PackageIndexError,
  PackageIndexReader,
  parsePackageIndexHeader,
  type ByteRangeSource,
  type PackageSemanticSummary,
  type SymbolEntry,
  type SymbolIndex,
} from "../src/index.js";

function makeTestSymbolIndex(libRoot: string): SymbolIndex {
  const pkgId = makePolyglotSymbolId(LanguageDomainId.Modelica, 1);
  const resId = makePolyglotSymbolId(LanguageDomainId.Modelica, 2);
  const sysmlId = makePolyglotSymbolId(LanguageDomainId.SysML2, 3);
  const depId = makePolyglotSymbolId(LanguageDomainId.Modelica, 99);
  const builtinId = makePolyglotSymbolId(LanguageDomainId.Modelica, 100);

  const entries: SymbolEntry[] = [
    {
      id: pkgId,
      kind: "Package",
      name: "Electrical",
      ruleName: "class_definition",
      namePath: "name",
      startOffset: 0,
      endOffset: 500,
      parentId: null,
      exports: ["body"],
      inherits: [],
      metadata: { classPrefixes: "package", isEncapsulated: true },
      fieldName: null,
      resourceId: `${libRoot}/Electrical/package.mo`,
      language: "modelica",
      merkleLow: 0xdeadbeef,
      merkleHigh: 0xcafebabe,
    },
    {
      id: resId,
      kind: "Class",
      name: "Resistor",
      ruleName: "class_definition",
      namePath: "name",
      startOffset: 10,
      endOffset: 240,
      parentId: pkgId,
      exports: ["body"],
      inherits: ["extends_clause"],
      metadata: { classPrefixes: "model", isPartial: false },
      fieldRanges: {
        name: { startOffset: 16, endOffset: 24 },
        body: { startOffset: 25, endOffset: 230 },
      },
      fieldName: "body",
      resourceId: `${libRoot}/Electrical/Resistor.mo`,
      language: "modelica",
      merkleLow: 0x12345678,
      merkleHigh: 0x9abcdef0,
    },
    {
      id: sysmlId,
      kind: "PartDef",
      name: "Chassis",
      ruleName: "part_definition",
      namePath: "name",
      startOffset: 5,
      endOffset: 90,
      parentId: null,
      exports: [],
      inherits: [],
      metadata: { defKind: "part" },
      fieldName: null,
      resourceId: `${libRoot}/sysml/drone.sysml`,
      language: "sysml2",
    },
    // External dep symbol — must be excluded by encoder
    {
      id: depId,
      kind: "Class",
      name: "ExternalBase",
      ruleName: "class_definition",
      namePath: "name",
      startOffset: 0,
      endOffset: 50,
      parentId: null,
      exports: [],
      inherits: [],
      metadata: {},
      fieldName: null,
      resourceId: "dep-bundle:/FoundationLib/1.0.0/Base.mo",
      language: "modelica",
    },
    // Builtin stub — must be excluded by encoder
    {
      id: builtinId,
      kind: "Package",
      name: "CAS",
      ruleName: "class_definition",
      namePath: "name",
      startOffset: 0,
      endOffset: 10,
      parentId: null,
      exports: [],
      inherits: [],
      metadata: {},
      fieldName: null,
      resourceId: "/builtin/modelscript-cas.mo",
      language: "modelica",
    },
  ];

  const symbols = new Map<number, SymbolEntry>();
  const byName = new Map<string, number[]>();
  const childrenOf = new Map<number | null, number[]>();
  for (const e of entries) {
    symbols.set(e.id, e);
    byName.set(e.name, [...(byName.get(e.name) ?? []), e.id]);
    childrenOf.set(e.parentId, [...(childrenOf.get(e.parentId) ?? []), e.id]);
  }
  return { symbols, byName, childrenOf };
}

describe("Relocatable Package Index (.msidx v1)", () => {
  it("round-trips all SymbolEntry fields, excludes external deps, and normalizes paths", () => {
    const libRoot = "/var/data/libraries/MyPkg/1.0.0";
    const srcIndex = makeTestSymbolIndex(libRoot);

    const encoded = encodePackageIndex(srcIndex, { libraryPath: libRoot });
    const header = parsePackageIndexHeader(encoded);
    assert.strictEqual(header.magic, MSIDX_MAGIC);
    assert.strictEqual(header.formatVersion, MSIDX_FORMAT_VERSION);
    assert.strictEqual(header.compilerAbiVersion, MSIDX_COMPILER_ABI_VERSION);
    assert.strictEqual(header.symbolCount, 3, "Should exclude dep-bundle and modelscript-cas.mo");

    const mounted = mountPackageIndex(encoded, {
      resolveResourceUri: (rel) => `file:///vfs/MyPkg/1.0.0/${rel}`,
    });
    assert.strictEqual(mounted.symbolCount, 3);
    assert.strictEqual(mounted.index.symbols.size, 3);

    const resIds = mounted.index.byName.get("Resistor");
    assert.ok(resIds && resIds.length === 1);
    const resEntry = mounted.index.symbols.get(resIds[0]!)!;
    assert.strictEqual(getSymbolDomain(resEntry.id), LanguageDomainId.Modelica);
    assert.strictEqual(resEntry.resourceId, "file:///vfs/MyPkg/1.0.0/Electrical/Resistor.mo");
    assert.deepStrictEqual(resEntry.exports, ["body"]);
    assert.deepStrictEqual(resEntry.inherits, ["extends_clause"]);
    assert.deepStrictEqual(resEntry.fieldRanges, {
      name: { startOffset: 16, endOffset: 24 },
      body: { startOffset: 25, endOffset: 230 },
    });
    assert.deepStrictEqual(resEntry.metadata, { classPrefixes: "model", isPartial: false });
    assert.strictEqual(resEntry.merkleLow, 0x12345678);
    assert.strictEqual(resEntry.merkleHigh, 0x9abcdef0);

    // Parent/child linkage preserved after rebasing
    const pkgIds = mounted.index.byName.get("Electrical")!;
    assert.strictEqual(resEntry.parentId, pkgIds[0]);
    assert.deepStrictEqual(mounted.index.childrenOf.get(pkgIds[0]!), [resEntry.id]);

    // SysML domain preserved
    const sysmlIds = mounted.index.byName.get("Chassis")!;
    assert.strictEqual(getSymbolDomain(sysmlIds[0]!), LanguageDomainId.SysML2);

    // External deps excluded
    assert.strictEqual(mounted.index.byName.has("ExternalBase"), false);
    assert.strictEqual(mounted.index.byName.has("CAS"), false);
  });

  it("mounts multiple packages into one SymbolIndex with zero SymbolId collisions", () => {
    const pkgA = encodePackageIndex(makeTestSymbolIndex("/libA"), { libraryPath: "/libA" });
    const pkgB = encodePackageIndex(makeTestSymbolIndex("/libB"), { libraryPath: "/libB" });

    const first = mountPackageIndex(pkgA, { resolveResourceUri: (r) => `file:///a/${r}` });
    const second = mountPackageIndex(pkgB, {
      targetIndex: first.index,
      resolveResourceUri: (r) => `file:///b/${r}`,
    });

    assert.strictEqual(second.index.symbols.size, 6, "Both packages' 3 symbols must coexist without collision");
    assert.strictEqual(second.index.byName.get("Resistor")?.length, 2);
    assert.strictEqual(second.index.symbolsByResource?.get("file:///a/Electrical/Resistor.mo")?.length, 1);
    assert.strictEqual(second.index.symbolsByResource?.get("file:///b/Electrical/Resistor.mo")?.length, 1);

    // Verify each Resistor points to its own package's Electrical parent
    const [resA, resB] = second.index.byName.get("Resistor")!;
    const parentA = second.index.symbols.get(second.index.symbols.get(resA!)!.parentId!)!;
    const parentB = second.index.symbols.get(second.index.symbols.get(resB!)!.parentId!)!;
    assert.notStrictEqual(parentA.id, parentB.id);
    assert.strictEqual(parentA.resourceId, "file:///a/Electrical/package.mo");
    assert.strictEqual(parentB.resourceId, "file:///b/Electrical/package.mo");
  });

  it("supports lazy byte-range lookups and on-demand semantic summary chunks", async () => {
    const srcIndex = makeTestSymbolIndex("/lib");
    const summaries: PackageSemanticSummary[] = [
      {
        localId: 1,
        fqn: "Electrical.Resistor",
        classKind: "model",
        extendsFqns: ["Modelica.Electrical.Analog.Interfaces.OnePort"],
        docSummary: "Ideal linear electrical resistor",
      },
      {
        localId: 2,
        fqn: "Mechanics.Mass",
        classKind: "model",
        docSummary: "Sliding mass with inertia",
      },
    ];

    const encoded = encodePackageIndex(srcIndex, { libraryPath: "/lib", summaries });

    // Wrap BufferByteRangeSource to track which byte ranges are actually read
    const inner = new BufferByteRangeSource(encoded);
    const reads: Array<{ offset: number; length: number }> = [];
    const trackingSource: ByteRangeSource = {
      async readRange(offset, length) {
        reads.push({ offset, length });
        return inner.readRange(offset, length);
      },
    };

    const reader = await PackageIndexReader.open(trackingSource);
    const readsAfterOpen = reads.length;

    // Lookup by exact name, prefix, FQN, and children without any additional reads
    assert.strictEqual(reader.lookupByName("Resistor").length, 1);
    assert.strictEqual(reader.lookupPrefix("Res").length, 1);
    const resLocalId = reader.lookupByFqn("Electrical.Resistor");
    assert.notStrictEqual(resLocalId, null);
    const elecLocalId = reader.lookupByFqn("Electrical")!;
    assert.deepStrictEqual(reader.getChildren(elecLocalId), [resLocalId]);
    assert.strictEqual(reads.length, readsAfterOpen, "In-memory lookups should trigger zero extra byte-range reads");

    // Lazy-load only one summary chunk
    assert.deepStrictEqual(reader.getSummaryPrefixes().sort(), ["Electrical.Resistor", "Mechanics.Mass"]);
    const loaded = await reader.loadSummaryChunk("Electrical.Resistor");
    assert.strictEqual(loaded.length, 1);
    assert.strictEqual(loaded[0]!.docSummary, "Ideal linear electrical resistor");
    assert.strictEqual(reads.length, readsAfterOpen + 1, "Should issue exactly 1 byte-range read for requested chunk");

    // Second call hits in-memory cache
    await reader.loadSummaryChunk("Electrical.Resistor");
    assert.strictEqual(reads.length, readsAfterOpen + 1);
  });

  it("rejects invalid magic and mismatched compiler ABI version cleanly", () => {
    const badMagic = new Uint8Array(64);
    assert.throws(
      () => parsePackageIndexHeader(badMagic),
      (err: unknown) => err instanceof PackageIndexError && err.code === "INVALID_MAGIC",
    );

    const encoded = encodePackageIndex(makeTestSymbolIndex("/lib"), { libraryPath: "/lib" });
    const copy = new Uint8Array(encoded);
    const dv = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
    dv.setUint16(6, MSIDX_COMPILER_ABI_VERSION + 99, true);
    assert.throws(
      () => parsePackageIndexHeader(copy),
      (err: unknown) => err instanceof PackageIndexError && err.code === "ABI_MISMATCH",
    );
  });

  it("verifies contentHash when verifyHash=true and detects single-byte corruption", () => {
    const encoded = encodePackageIndex(makeTestSymbolIndex("/lib"), { libraryPath: "/lib" });
    const ok = mountPackageIndex(encoded, { verifyHash: true });
    assert.strictEqual(ok.symbolCount, 3);

    const corrupted = new Uint8Array(encoded);
    corrupted[corrupted.length - 1] = corrupted[corrupted.length - 1]! ^ 0xff;
    assert.throws(
      () => mountPackageIndex(corrupted, { verifyHash: true }),
      (err: unknown) => err instanceof PackageIndexError && err.code === "CORRUPT",
    );
  });

  it("extracts pure-data semantic summaries and inspects binary .msidx metadata", async () => {
    const { extractPackageSummaries, inspectPackageIndex } = await import("../src/index.js");
    const src = makeTestSymbolIndex("/lib");
    const summaries = extractPackageSummaries(src, "/lib");
    assert.ok(summaries.length >= 2, "Should extract summaries for symbols with metadata");
    assert.ok(summaries.some((s) => s.fqn === "Electrical.Resistor" && s.classKind === "model"));

    const encoded = encodePackageIndex(src, { libraryPath: "/lib", summaries });
    const info = inspectPackageIndex(encoded);
    assert.strictEqual(info.header.symbolCount, 3);
    assert.strictEqual(info.domainCounts[LanguageDomainId.Modelica], 2);
    assert.strictEqual(info.domainCounts[LanguageDomainId.SysML2], 1);
    assert.ok(info.summaryChunks.length > 0);
  });
});
