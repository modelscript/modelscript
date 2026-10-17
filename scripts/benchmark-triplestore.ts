// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript Triplestore & Semantic Storage Scalability Benchmark Suite
 *
 * Benchmarks all 6 architectural layers of ModelScript's WebAssembly semantic
 * triplestore across increasing scale tiers (N = 1,000 to 100,000+ triples)
 * AND compares head-to-head against external triplestores and reasoners:
 *
 *  1. 64-Bit FNV-1a IRI Hashing & WASM EntityDictionary Interning
 *  2. HDT Front-Coded Dictionary Compression & Zero-Copy Extraction
 *  3. Pure-WASM Zero-GC Columnar Ingestion & Linear Memory Footprint
 *  4. Multi-Index Query Latency (SPO/POS/OSP Hash-Chains vs. RoaringBitmap AND Intersections)
 *  5. Ontology Reasoning, O(1) Interval Subsumption, Property Paths, BGP Joins & DRed Retraction
 *  6. Paged 4KB Slotted B+Tree & Clock Buffer Pool Scaling
 *  7. Head-to-Head Triplestore Comparison (ModelScript WASM vs. Paged B+Tree vs. Apache Jena TDB2 vs. SQLite3 C B-Tree vs. N3.Store vs. Comunica SPARQL)
 *  8. Head-to-Head Ontology Reasoner Comparison (ModelScript WASM vs. ModelScript TS vs. Apache Jena TDB2 RDFS/ARQ vs. SQLite3 Recursive CTE Datalog vs. N3.js vs. Comunica SPARQL 1.1)
 *
 * Usage:
 *   npx tsx scripts/benchmark-triplestore.ts
 *   npx tsx scripts/benchmark-triplestore.ts --quick
 *   npx tsx scripts/benchmark-triplestore.ts --scales=1000,10000,50000,100000
 *   npx tsx scripts/benchmark-triplestore.ts --json=reports/triplestore-benchmark.json
 */

import { QueryEngine as ComunicaQueryEngine } from "@comunica/query-sparql-rdfjs";
import Database from "better-sqlite3";
import { DataFactory, Store as N3Store } from "n3";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import {
  WasmOntologyReasoner,
  WasmOntologyStore,
  hashIri64,
  type OWL2Axiom,
  type WasmOntologyInstance,
} from "../packages/runtime/src/ontology/wasm_ontology.js";
import { PagedStorageEngine, type PagedWasmExports } from "../packages/runtime/src/storage/paged_store.js";

const { namedNode, quad } = DataFactory;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

// WASM numeric constants matching packages/runtime/src/wasm/ontology_module/ontology.ts
const AXIOM_SUBCLASS_OF = 2;
const AXIOM_OBJ_PROP_ASSERT = 7;
const AXIOM_CLASS_ASSERT = 11;
const AXIOM_OBJECT_SOME_VALUES_FROM = 12;

const LANG_OWL2 = 0;
const LANG_SYSML2 = 2;

const PATH_OP_PLUS = 2;

export interface HashInternTierResult {
  scale: number;
  hashThroughputOpsPerSec: number;
  internThroughputOpsPerSec: number;
  uniqueEntities: number;
  collisions: number;
  elapsedMs: number;
}

export interface HdtCompressionTierResult {
  scale: number;
  rawBytes: number;
  compressedBytes: number;
  compressionRatio: number;
  savingsPercent: number;
  internThroughputPerSec: number;
  extractLatencyUs: number;
  verifiedSamples: number;
}

export interface ColumnarIngestionTierResult {
  scale: number;
  ingestMs: number;
  throughputTriplesPerSec: number;
  latencyUsPerTriple: number;
  wasmMemoryDeltaBytes: number;
  wasmBytesPerTriple: number;
  jsHeapDeltaBytes: number;
  axiomCount: number;
  entityCount: number;
}

export interface QueryScalingTierResult {
  scale: number;
  spoPointQueryUs: number;
  posHashChainQueryMs: number;
  posBitmapQueryMs: number;
  multiBoundHashChainScanMs: number;
  multiBoundRoaringAndMs: number;
  roaringSpeedupFactor: number;
  posRoaringCardinality: number;
  ospRoaringCardinality: number;
  containerRegime: "Array (<4096)" | "Bitmap (>=4096)";
  matchedCount: number;
}

export interface ReasoningScalingTierResult {
  hierarchySize: number;
  intervalIndexBuildMs: number;
  intervalSubsumptionQueryNs: number;
  elSaturationMs: number;
  inferredAxioms: number;
  propertyPathPlusUs: number;
  propertyPathReachableCount: number;
  bgpThreePatternJoinMs: number;
  bgpMatchCount: number;
  dredRetractionMs: number;
}

export interface PagedBTreeTierResult {
  scale: number;
  bufferPoolFrames: number;
  bufferPoolSizeKb: number;
  insertThroughputPerSec: number;
  insertMs: number;
  totalPages: number;
  storageSizeKb: number;
  boundSubjectLookupUs: number;
  predicateFilterScanMs: number;
  bufferPoolHitRatePercent: number;
  flushedDirtyPages: number;
}

export interface ExternalTriplestoreComparisonRow {
  engine: string;
  scale: number;
  ingestMs: number;
  ingestTriplesPerSec: number;
  pointLookupUs: number;
  multiBoundQueryMs: number;
  matchedCount: number;
  ingestSpeedupVsEngine: number;
  querySpeedupVsEngine: number;
}

export interface ExternalReasonerComparisonRow {
  engine: string;
  hierarchyClasses: number;
  classifyOrIndexMs: number;
  subsumptionQueryUs: number;
  transitivePathPlusUs: number;
  threePatternBgpMs: number;
  elMaterializeMs: number;
  incrementalRetractMs: number;
  verifiedParity: boolean;
}

export interface JenaTdb2BenchmarkOutput {
  triplestoreRows: {
    engine: string;
    scale: number;
    ingestMs: number;
    ingestTriplesPerSec: number;
    pointLookupUs: number;
    multiBoundQueryMs: number;
    matchedCount: number;
  }[];
  reasonerRow: ExternalReasonerComparisonRow;
}

export interface TriplestoreBenchmarkReport {
  timestamp: string;
  wasmBinary: string;
  scales: number[];
  hashAndIntern: HashInternTierResult[];
  hdtCompression: HdtCompressionTierResult[];
  columnarIngestion: ColumnarIngestionTierResult[];
  queryScaling: QueryScalingTierResult[];
  reasoningScaling: ReasoningScalingTierResult[];
  pagedBTree: PagedBTreeTierResult[];
  externalTriplestoreComparison: ExternalTriplestoreComparisonRow[];
  externalReasonerComparison: ExternalReasonerComparisonRow[];
}

const JENA_BENCHMARK_JAVA_SOURCE = `
import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import org.apache.jena.graph.Graph;
import org.apache.jena.graph.Node;
import org.apache.jena.graph.NodeFactory;
import org.apache.jena.graph.Triple;
import org.apache.jena.query.Dataset;
import org.apache.jena.query.Query;
import org.apache.jena.query.QueryExecution;
import org.apache.jena.query.QueryExecutionFactory;
import org.apache.jena.query.QueryFactory;
import org.apache.jena.query.ResultSet;
import org.apache.jena.rdf.model.InfModel;
import org.apache.jena.rdf.model.Model;
import org.apache.jena.rdf.model.ModelFactory;
import org.apache.jena.rdf.model.Property;
import org.apache.jena.rdf.model.Resource;
import org.apache.jena.reasoner.Reasoner;
import org.apache.jena.reasoner.ReasonerRegistry;
import org.apache.jena.system.Txn;
import org.apache.jena.tdb2.TDB2Factory;
import org.apache.jena.util.iterator.ExtendedIterator;
import org.apache.jena.vocabulary.RDFS;

public class JenaTdb2Benchmark {
  private static void deleteDir(Path dir) {
    try {
      if (Files.exists(dir)) {
        Files.walk(dir)
            .sorted(Comparator.reverseOrder())
            .map(Path::toFile)
            .forEach(File::delete);
      }
    } catch (Exception ignored) {}
  }

  private static String runScaleTier(int scale, boolean diskBacked) throws Exception {
    Path tempDir = diskBacked ? Files.createTempDirectory("jena-tdb2-bench-") : null;
    Dataset ds = diskBacked
        ? TDB2Factory.connectDataset(tempDir.toString())
        : TDB2Factory.createDataset();

    try {
      Node rdfType = NodeFactory.createURI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
      Node targetClass = NodeFactory.createURI("http://modelscript.org/bench#TargetSensorBlock");
      Node otherClass = NodeFactory.createURI("http://modelscript.org/bench#StandardActuatorBlock");
      Node[] subjects = new Node[scale];
      for (int i = 0; i < scale; i++) {
        subjects[i] = NodeFactory.createURI("http://modelscript.org/bench#Node_" + i);
      }
      Node midSubj = subjects[scale / 2];

      long tIngest0 = System.nanoTime();
      Txn.executeWrite(ds, () -> {
        Graph g = ds.asDatasetGraph().getDefaultGraph();
        for (int i = 0; i < scale; i++) {
          Node obj = ((i & 3) == 0) ? targetClass : otherClass;
          g.add(Triple.create(subjects[i], rdfType, obj));
        }
      });
      double ingestMs = Math.max(0.001, (System.nanoTime() - tIngest0) / 1_000_000.0);
      long throughput = Math.round((scale / ingestMs) * 1000.0);

      int pointIters = 200;
      long tPoint0 = System.nanoTime();
      Txn.executeRead(ds, () -> {
        Graph g = ds.asDatasetGraph().getDefaultGraph();
        for (int it = 0; it < pointIters; it++) {
          ExtendedIterator<Triple> iter = g.find(midSubj, rdfType, Node.ANY);
          while (iter.hasNext()) iter.next();
          iter.close();
        }
      });
      double pointUs = ((System.nanoTime() - tPoint0) / 1_000.0) / pointIters;

      int multiIters = 20;
      final int[] matchedHolder = new int[1];
      long tMulti0 = System.nanoTime();
      Txn.executeRead(ds, () -> {
        Graph g = ds.asDatasetGraph().getDefaultGraph();
        for (int it = 0; it < multiIters; it++) {
          int count = 0;
          ExtendedIterator<Triple> iter = g.find(Node.ANY, rdfType, targetClass);
          while (iter.hasNext()) {
            iter.next();
            count++;
          }
          iter.close();
          matchedHolder[0] = count;
        }
      });
      double multiMs = ((System.nanoTime() - tMulti0) / 1_000_000.0) / multiIters;

      String engineName = diskBacked
          ? "Apache Jena TDB2 (MVCC B+Tree, Disk)"
          : "Apache Jena TDB2 (MVCC B+Tree, In-Mem)";

      return String.format(
          "{\\"engine\\":\\"%s\\",\\"scale\\":%d,\\"ingestMs\\":%.3f,\\"ingestTriplesPerSec\\":%d,\\"pointLookupUs\\":%.2f,\\"multiBoundQueryMs\\":%.3f,\\"matchedCount\\":%d}",
          engineName, scale, ingestMs, throughput, pointUs, multiMs, matchedHolder[0]);
    } finally {
      ds.close();
      if (tempDir != null) deleteDir(tempDir);
    }
  }

  private static String runReasonerBenchmark() throws Exception {
    int hierarchyClasses = 2000;
    int chainHops = 64;
    int bgpFanout = 200;

    String subClassIri = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
    String partOfIri = "http://modelscript.org/bench#partOf";
    String hasSubsystemIri = "http://modelscript.org/bench#hasSubsystem";
    String verifiesIri = "http://modelscript.org/bench#verifies";
    String rootClassIri = "http://modelscript.org/bench#Class_0";
    String child1ClassIri = "http://modelscript.org/bench#Class_1";
    String leafClassIri = "http://modelscript.org/bench#Class_" + (hierarchyClasses - 1);
    String part0Iri = "http://modelscript.org/bench#Part_0";

    Dataset ds = TDB2Factory.createDataset();
    try {
      Txn.executeWrite(ds, () -> {
        Graph g = ds.asDatasetGraph().getDefaultGraph();
        Node subPred = NodeFactory.createURI(subClassIri);
        Node partPred = NodeFactory.createURI(partOfIri);
        Node hasSubPred = NodeFactory.createURI(hasSubsystemIri);
        Node verPred = NodeFactory.createURI(verifiesIri);
        Node child1Node = NodeFactory.createURI(child1ClassIri);

        for (int i = 1; i < hierarchyClasses; i++) {
          int parentIdx = (i - 1) >> 3;
          g.add(Triple.create(
              NodeFactory.createURI("http://modelscript.org/bench#Class_" + i),
              subPred,
              NodeFactory.createURI("http://modelscript.org/bench#Class_" + parentIdx)));
        }
        for (int i = 0; i < chainHops; i++) {
          g.add(Triple.create(
              NodeFactory.createURI("http://modelscript.org/bench#Part_" + i),
              partPred,
              NodeFactory.createURI("http://modelscript.org/bench#Part_" + (i + 1))));
        }
        for (int i = 0; i < bgpFanout; i++) {
          Node subNode = NodeFactory.createURI("http://modelscript.org/bench#Subsys_" + i);
          g.add(Triple.create(
              NodeFactory.createURI("http://modelscript.org/bench#System_" + (i >> 2)),
              hasSubPred,
              subNode));
          g.add(Triple.create(subNode, verPred, child1Node));
        }
      });

      final double[] classifyMsHolder = new double[1];
      final double[] subUsHolder = new double[1];
      final double[] pathUsHolder = new double[1];
      final double[] bgpMsHolder = new double[1];
      final double[] retractMsHolder = new double[1];
      final boolean[] parityHolder = new boolean[1];

      Txn.executeWrite(ds, () -> {
        Model baseModel = ds.getDefaultModel();
        Reasoner reasoner = ReasonerRegistry.getRDFSReasoner();

        long tClassify0 = System.nanoTime();
        InfModel infModel = ModelFactory.createInfModel(reasoner, baseModel);
        infModel.prepare();
        classifyMsHolder[0] = (System.nanoTime() - tClassify0) / 1_000_000.0;

        Resource leafRes = infModel.getResource(leafClassIri);
        Resource rootRes = infModel.getResource(rootClassIri);
        Resource child1Res = infModel.getResource(child1ClassIri);

        int subIters = 500;
        boolean subOk = false;
        long tSub0 = System.nanoTime();
        for (int it = 0; it < subIters; it++) {
          subOk = infModel.contains(leafRes, RDFS.subClassOf, rootRes);
        }
        subUsHolder[0] = ((System.nanoTime() - tSub0) / 1_000.0) / subIters;

        Query pathQuery = QueryFactory.create(
            "SELECT ?target WHERE { <" + part0Iri + "> <" + partOfIri + ">+ ?target }");
        int pathIters = 50;
        int pathCount = 0;
        long tPath0 = System.nanoTime();
        for (int it = 0; it < pathIters; it++) {
          pathCount = 0;
          try (QueryExecution qexec = QueryExecutionFactory.create(pathQuery, baseModel)) {
            ResultSet rs = qexec.execSelect();
            while (rs.hasNext()) {
              rs.next();
              pathCount++;
            }
          }
        }
        pathUsHolder[0] = ((System.nanoTime() - tPath0) / 1_000.0) / pathIters;

        Query bgpQuery = QueryFactory.create(
            "SELECT ?sys ?sub ?req WHERE { "
            + "?sys <" + hasSubsystemIri + "> ?sub . "
            + "?sub <" + verifiesIri + "> ?req . "
            + "?req <" + subClassIri + "> <" + rootClassIri + "> . }");
        int bgpCount = 0;
        long tBgp0 = System.nanoTime();
        try (QueryExecution qexec = QueryExecutionFactory.create(bgpQuery, baseModel)) {
          ResultSet rs = qexec.execSelect();
          while (rs.hasNext()) {
            rs.next();
            bgpCount++;
          }
        }
        bgpMsHolder[0] = (System.nanoTime() - tBgp0) / 1_000_000.0;

        long tRetract0 = System.nanoTime();
        Property subProp = baseModel.getProperty(subClassIri);
        Resource descOfChild1 = infModel.getResource("http://modelscript.org/bench#Class_9");
        baseModel.remove(child1Res, subProp, rootRes);
        infModel.rebind();
        boolean afterRetract = infModel.contains(descOfChild1, RDFS.subClassOf, rootRes);
        retractMsHolder[0] = (System.nanoTime() - tRetract0) / 1_000_000.0;

        parityHolder[0] = subOk && !afterRetract && (pathCount == chainHops) && (bgpCount == bgpFanout);
      });

      return String.format(
          "{\\"engine\\":\\"Apache Jena TDB2 + RDFS Reasoner + ARQ\\",\\"hierarchyClasses\\":%d,\\"classifyOrIndexMs\\":%.3f,\\"subsumptionQueryUs\\":%.3f,\\"transitivePathPlusUs\\":%.2f,\\"threePatternBgpMs\\":%.3f,\\"elMaterializeMs\\":%.3f,\\"incrementalRetractMs\\":%.3f,\\"verifiedParity\\":%s}",
          hierarchyClasses,
          classifyMsHolder[0],
          subUsHolder[0],
          pathUsHolder[0],
          bgpMsHolder[0],
          classifyMsHolder[0],
          retractMsHolder[0],
          parityHolder[0] ? "true" : "false");
    } finally {
      ds.close();
    }
  }

  public static void main(String[] args) throws Exception {
    String scalesArg = args.length > 0 ? args[0] : "1000,10000,50000";
    String[] parts = scalesArg.split(",");

    // JIT warmup (in-memory & disk-backed TDB2 + RDFS reasoner + ARQ)
    runScaleTier(500, false);
    runScaleTier(500, true);
    runReasonerBenchmark();

    List<String> rows = new ArrayList<>();
    for (String p : parts) {
      int scale = Integer.parseInt(p.trim());
      rows.add(runScaleTier(scale, false));
      rows.add(runScaleTier(scale, true));
    }
    String reasonerJson = runReasonerBenchmark();

    System.out.println("{\\"triplestoreRows\\":[" + String.join(",", rows) + "],\\"reasonerRow\\":" + reasonerJson + "}");
  }
}
`;

export function runJenaTdb2Benchmark(scales: number[]): JenaTdb2BenchmarkOutput | null {
  const jenaCacheDir = path.resolve(REPO_ROOT, ".cache/jena");
  const jarPath = path.resolve(jenaCacheDir, "jena-fuseki-server-5.2.0.jar");
  const javaFilePath = path.resolve(jenaCacheDir, "JenaTdb2Benchmark.java");
  const classFilePath = path.resolve(jenaCacheDir, "JenaTdb2Benchmark.class");

  try {
    fs.mkdirSync(jenaCacheDir, { recursive: true });
    if (!fs.existsSync(jarPath)) {
      execFileSync(
        "curl",
        [
          "-sSL",
          "-o",
          jarPath,
          "https://repo1.maven.org/maven2/org/apache/jena/jena-fuseki-server/5.2.0/jena-fuseki-server-5.2.0.jar",
        ],
        { stdio: "ignore", timeout: 45_000 },
      );
    }

    const needsCompile =
      !fs.existsSync(classFilePath) ||
      !fs.existsSync(javaFilePath) ||
      fs.readFileSync(javaFilePath, "utf-8") !== JENA_BENCHMARK_JAVA_SOURCE;

    if (needsCompile) {
      fs.writeFileSync(javaFilePath, JENA_BENCHMARK_JAVA_SOURCE, "utf-8");
      execFileSync("javac", ["-cp", jarPath, javaFilePath], {
        cwd: jenaCacheDir,
        stdio: "pipe",
        timeout: 30_000,
      });
    }

    const stdout = execFileSync(
      "java",
      ["-Xmx2g", "-cp", `${jenaCacheDir}${path.delimiter}${jarPath}`, "JenaTdb2Benchmark", scales.join(",")],
      {
        cwd: jenaCacheDir,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 60_000,
      },
    );

    const lines = stdout
      .trim()
      .split(/\r?\n/)
      .filter((line) => line.startsWith("{"));
    const jsonLine = lines[lines.length - 1];
    if (!jsonLine) return null;
    return JSON.parse(jsonLine) as JenaTdb2BenchmarkOutput;
  } catch {
    return null;
  }
}

function resolveWasmBinaryPath(): string {
  const releasePath = path.resolve(REPO_ROOT, "packages/runtime/build/release.wasm");
  const debugPath = path.resolve(REPO_ROOT, "packages/runtime/build/debug.wasm");
  if (fs.existsSync(releasePath)) return releasePath;
  if (fs.existsSync(debugPath)) return debugPath;
  throw new Error(
    "WASM binary not found at packages/runtime/build/{release,debug}.wasm. Run 'npm run asbuild --workspace=@modelscript/runtime'.",
  );
}

async function instantiateWasm(wasmBytes: Buffer): Promise<{
  exports: Record<string, unknown>;
  wasm: WasmOntologyInstance;
  memory: WebAssembly.Memory;
}> {
  const wasmModule = await WebAssembly.instantiate(wasmBytes, {
    env: {
      abort: (msgPtr: number, filePtr: number, line: number, col: number) => {
        throw new Error(`WASM abort at ${msgPtr}:${filePtr} (${line}:${col})`);
      },
      trace: () => {
        /* no-op */
      },
      seed: () => 42,
    },
  });
  const instance = "instance" in wasmModule ? wasmModule.instance : (wasmModule as unknown as WebAssembly.Instance);
  const exports = instance.exports as Record<string, unknown>;
  const memory = exports.memory as WebAssembly.Memory;
  const wasm = exports as unknown as WasmOntologyInstance;
  wasm.ontology_clear?.();
  return { exports, wasm, memory };
}

/**
 * Tier 1: 64-Bit FNV-1a IRI Hashing & EntityDictionary Interning
 */
async function benchmarkHashAndIntern(wasmBytes: Buffer, scales: number[]): Promise<HashInternTierResult[]> {
  const results: HashInternTierResult[] = [];
  const namespaces = [
    "http://modelscript.org/sysml2/aerospace/",
    "http://modelscript.org/modelica/thermal/",
    "http://modelscript.org/owl2/avionics/",
    "http://modelscript.org/step/ap242/assembly/",
  ];

  for (const scale of scales) {
    const { wasm } = await instantiateWasm(wasmBytes);

    const iris = new Array<string>(scale);
    for (let i = 0; i < scale; i++) {
      const ns = namespaces[i % namespaces.length]!;
      iris[i] = `${ns}Subsystem_${i >> 6}/Component_${i}#port_${i & 63}`;
    }

    const loArr = new Uint32Array(scale);
    const hiArr = new Uint32Array(scale);
    const tHash0 = performance.now();
    for (let i = 0; i < scale; i++) {
      const { lo, hi } = hashIri64(iris[i]!);
      loArr[i] = lo;
      hiArr[i] = hi;
    }
    const hashMs = Math.max(0.001, performance.now() - tHash0);

    const seenIds = new Set<number>();
    const tIntern0 = performance.now();
    for (let i = 0; i < scale; i++) {
      const id = wasm.ontology_getOrCreateEntity!(loArr[i]!, hiArr[i]!);
      seenIds.add(id);
    }
    const internMs = Math.max(0.001, performance.now() - tIntern0);

    const uniqueEntities = wasm.ontology_getEntityCount!();
    const collisions = scale - seenIds.size;

    results.push({
      scale,
      hashThroughputOpsPerSec: Math.round((scale / hashMs) * 1000),
      internThroughputOpsPerSec: Math.round((scale / internMs) * 1000),
      uniqueEntities,
      collisions,
      elapsedMs: Number((hashMs + internMs).toFixed(2)),
    });
  }

  return results;
}

/**
 * Tier 2: HDT Front-Coded Dictionary Compression & Decompression
 */
async function benchmarkHdtCompression(wasmBytes: Buffer, scales: number[]): Promise<HdtCompressionTierResult[]> {
  const results: HdtCompressionTierResult[] = [];

  for (const scale of scales) {
    const { wasm } = await instantiateWasm(wasmBytes);
    const store = new WasmOntologyStore(wasm);
    store.queryTriplesBitmap({});

    const uris = new Array<string>(scale);
    for (let i = 0; i < scale; i++) {
      const domainId = String(Math.floor(i / 256)).padStart(4, "0");
      const compId = String(i % 256).padStart(4, "0");
      uris[i] =
        `http://modelscript.org/enterprise/digital-twin/aircraft-program/domain_${domainId}/component_${compId}/telemetry_signal`;
    }

    const tIntern0 = performance.now();
    const ids = new Uint32Array(scale);
    for (let i = 0; i < scale; i++) {
      ids[i] = store.internStringWasm(uris[i]!);
    }
    const internMs = Math.max(0.001, performance.now() - tIntern0);

    const sampleCount = Math.min(scale, 1000);
    const stride = Math.max(1, Math.floor(scale / sampleCount));
    let verifiedSamples = 0;
    const tExtract0 = performance.now();
    for (let idx = 0; idx < scale && verifiedSamples < sampleCount; idx += stride) {
      const str = store.extractStringWasm(ids[idx]!);
      if (str === uris[idx]) {
        verifiedSamples++;
      }
    }
    const extractMs = Math.max(0.001, performance.now() - tExtract0);

    const rawBytes = wasm.ontology_getRawStringBytes
      ? wasm.ontology_getRawStringBytes()
      : uris.reduce((acc, s) => acc + s.length, 0);
    const compressedBytes = wasm.ontology_getCompressedStringBytes
      ? wasm.ontology_getCompressedStringBytes()
      : Math.round(rawBytes * store.getStringCompressionRatio());
    const ratio = store.getStringCompressionRatio();

    results.push({
      scale,
      rawBytes,
      compressedBytes,
      compressionRatio: Number(ratio.toFixed(4)),
      savingsPercent: Number(((1 - ratio) * 100).toFixed(1)),
      internThroughputPerSec: Math.round((scale / internMs) * 1000),
      extractLatencyUs: Number(((extractMs * 1000) / verifiedSamples).toFixed(2)),
      verifiedSamples,
    });
  }

  return results;
}

/**
 * Tier 3: Pure-WASM Zero-GC Columnar Ingestion & Memory Footprint
 */
async function benchmarkColumnarIngestion(wasmBytes: Buffer, scales: number[]): Promise<ColumnarIngestionTierResult[]> {
  const results: ColumnarIngestionTierResult[] = [];

  for (const scale of scales) {
    const { wasm, memory } = await instantiateWasm(wasmBytes);
    const store = new WasmOntologyStore(wasm);
    store.setPureWasmMode(true);

    const predHash = hashIri64("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
    const classLo = new Uint32Array(32);
    const classHi = new Uint32Array(32);
    for (let c = 0; c < 32; c++) {
      const h = hashIri64(`http://modelscript.org/bench#EngineeringClass_${c}`);
      classLo[c] = h.lo;
      classHi[c] = h.hi;
    }

    const subjLo = new Uint32Array(scale);
    const subjHi = new Uint32Array(scale);
    for (let i = 0; i < scale; i++) {
      const h = hashIri64(`http://modelscript.org/bench#Individual_${i}`);
      subjLo[i] = h.lo;
      subjHi[i] = h.hi;
    }

    const wasmBytesBefore = memory.buffer.byteLength;
    const jsHeapBefore = process.memoryUsage().heapUsed;

    const t0 = performance.now();
    for (let i = 0; i < scale; i++) {
      const cIdx = i & 31;
      wasm.ontology_addAxiom64!(
        AXIOM_CLASS_ASSERT,
        LANG_OWL2,
        subjLo[i]!,
        subjHi[i]!,
        predHash.lo,
        predHash.hi,
        classLo[cIdx]!,
        classHi[cIdx]!,
        0,
        0,
      );
    }
    const ingestMs = Math.max(0.001, performance.now() - t0);

    const wasmBytesAfter = memory.buffer.byteLength;
    const jsHeapAfter = process.memoryUsage().heapUsed;
    const wasmDelta = Math.max(0, wasmBytesAfter - wasmBytesBefore);

    results.push({
      scale,
      ingestMs: Number(ingestMs.toFixed(2)),
      throughputTriplesPerSec: Math.round((scale / ingestMs) * 1000),
      latencyUsPerTriple: Number(((ingestMs * 1000) / scale).toFixed(3)),
      wasmMemoryDeltaBytes: wasmDelta,
      wasmBytesPerTriple: Number((wasmDelta / scale).toFixed(1)),
      jsHeapDeltaBytes: Math.max(0, jsHeapAfter - jsHeapBefore),
      axiomCount: store.size,
      entityCount: wasm.ontology_getEntityCount!(),
    });
  }

  return results;
}

/**
 * Tier 4: Multi-Index Query Latency (Hash-Chains vs. RoaringBitmap Intersections)
 */
async function benchmarkQueryScaling(wasmBytes: Buffer, scales: number[]): Promise<QueryScalingTierResult[]> {
  const results: QueryScalingTierResult[] = [];

  for (const scale of scales) {
    const { wasm } = await instantiateWasm(wasmBytes);
    const store = new WasmOntologyStore(wasm);
    store.setPureWasmMode(true);

    const rdfTypeIri = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
    const targetClassIri = "http://modelscript.org/bench#TargetSensorBlock";
    const otherClassIri = "http://modelscript.org/bench#StandardActuatorBlock";

    const rdfTypeHash = hashIri64(rdfTypeIri);
    const targetClassHash = hashIri64(targetClassIri);
    const otherClassHash = hashIri64(otherClassIri);

    const rdfTypeEntityId = store.internIri(rdfTypeIri);
    const targetClassEntityId = store.internIri(targetClassIri);
    store.internIri(otherClassIri);

    let sampleSubjectEntityId = 0;
    const midIdx = Math.floor(scale / 2);
    for (let i = 0; i < scale; i++) {
      const subjIri = `http://modelscript.org/bench#Node_${i}`;
      const sHash = hashIri64(subjIri);
      const isTarget = (i & 3) === 0;
      const oHash = isTarget ? targetClassHash : otherClassHash;

      if (i === midIdx) {
        sampleSubjectEntityId = store.internIri(subjIri);
      }

      wasm.ontology_addAxiom64!(
        AXIOM_CLASS_ASSERT,
        LANG_OWL2,
        sHash.lo,
        sHash.hi,
        rdfTypeHash.lo,
        rdfTypeHash.hi,
        oHash.lo,
        oHash.hi,
        0,
        0,
      );
    }

    const pointIterations = 200;
    const tPoint0 = performance.now();
    for (let it = 0; it < pointIterations; it++) {
      wasm.ontology_queryTriples!(sampleSubjectEntityId, rdfTypeEntityId, 0);
    }
    const spoPointQueryUs = Number((((performance.now() - tPoint0) * 1000) / pointIterations).toFixed(2));

    const tPosHash0 = performance.now();
    wasm.ontology_queryTriples!(0, rdfTypeEntityId, 0);
    const posHashChainQueryMs = Number((performance.now() - tPosHash0).toFixed(3));

    const tPosBm0 = performance.now();
    wasm.ontology_queryTriplesBitmap!(0, rdfTypeEntityId, 0);
    const posBitmapQueryMs = Number((performance.now() - tPosBm0).toFixed(3));

    const multiIterations = 25;
    let hashMatched = 0;
    const tMultiHash0 = performance.now();
    for (let it = 0; it < multiIterations; it++) {
      hashMatched = wasm.ontology_queryTriples!(0, rdfTypeEntityId, targetClassEntityId);
    }
    const multiBoundHashChainScanMs = Number(((performance.now() - tMultiHash0) / multiIterations).toFixed(3));

    let bmMatched = 0;
    const tMultiBm0 = performance.now();
    for (let it = 0; it < multiIterations; it++) {
      bmMatched = wasm.ontology_queryTriplesBitmap!(0, rdfTypeEntityId, targetClassEntityId);
    }
    const multiBoundRoaringAndMs = Number(((performance.now() - tMultiBm0) / multiIterations).toFixed(3));

    if (hashMatched !== bmMatched) {
      throw new Error(`Query parity mismatch at scale=${scale}: hashMatched=${hashMatched} vs bmMatched=${bmMatched}`);
    }

    const posCard = store.getRoaringCardinality(2, rdfTypeIri);
    const ospCard = store.getRoaringCardinality(3, targetClassIri);
    const speedup =
      multiBoundRoaringAndMs > 0 ? Number((multiBoundHashChainScanMs / multiBoundRoaringAndMs).toFixed(2)) : 1.0;

    results.push({
      scale,
      spoPointQueryUs,
      posHashChainQueryMs,
      posBitmapQueryMs,
      multiBoundHashChainScanMs,
      multiBoundRoaringAndMs,
      roaringSpeedupFactor: speedup,
      posRoaringCardinality: posCard,
      ospRoaringCardinality: ospCard,
      containerRegime: ospCard >= 4096 ? "Bitmap (>=4096)" : "Array (<4096)",
      matchedCount: bmMatched,
    });
  }

  return results;
}

/**
 * Tier 5: Ontology Reasoning, O(1) Interval Subsumption, Property Paths, BGP Joins & DRed
 */
async function benchmarkReasoningScaling(
  wasmBytes: Buffer,
  hierarchySizes: number[],
): Promise<ReasoningScalingTierResult[]> {
  const results: ReasoningScalingTierResult[] = [];

  for (const size of hierarchySizes) {
    const { wasm } = await instantiateWasm(wasmBytes);
    const store = new WasmOntologyStore(wasm);
    const reasoner = new WasmOntologyReasoner(wasm);

    const subClassIri = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
    const partOfIri = "http://modelscript.org/bench#partOf";
    const hasSubsystemIri = "http://modelscript.org/bench#hasSubsystem";
    const verifiesIri = "http://modelscript.org/bench#verifies";

    for (let i = 1; i < size; i++) {
      const parentIdx = (i - 1) >> 3;
      store.addAxiomDirect64(
        AXIOM_SUBCLASS_OF,
        LANG_OWL2,
        `http://modelscript.org/bench#Class_${i}`,
        subClassIri,
        `http://modelscript.org/bench#Class_${parentIdx}`,
      );
    }

    const tIdx0 = performance.now();
    wasm.ontology_computeIntervalIndex!();
    const intervalIndexBuildMs = Number((performance.now() - tIdx0).toFixed(3));

    const rootEntity = store.internIri("http://modelscript.org/bench#Class_0");
    const deepLeafEntity = store.internIri(`http://modelscript.org/bench#Class_${size - 1}`);
    const subIterations = 5000;
    const tSub0 = performance.now();
    let subCheck = 0;
    for (let it = 0; it < subIterations; it++) {
      subCheck += wasm.ontology_isSubClassOf!(deepLeafEntity, rootEntity);
    }
    const intervalSubsumptionQueryNs = Math.round(((performance.now() - tSub0) * 1_000_000) / subIterations);
    if (subCheck !== subIterations) {
      throw new Error(`Expected O(1) interval subsumption to return 1 for all iterations`);
    }

    const chainLen = Math.min(128, Math.max(16, Math.floor(size / 10)));
    for (let i = 0; i < chainLen; i++) {
      store.addAxiomDirect64(
        AXIOM_OBJ_PROP_ASSERT,
        LANG_SYSML2,
        `http://modelscript.org/bench#Part_${i}`,
        partOfIri,
        `http://modelscript.org/bench#Part_${i + 1}`,
      );
    }

    const partOfEntity = store.internIri(partOfIri);
    const part0Entity = store.internIri("http://modelscript.org/bench#Part_0");
    const tPath0 = performance.now();
    const reachableCount = wasm.ontology_evaluatePropertyPath!(partOfEntity, PATH_OP_PLUS, 0, part0Entity);
    const propertyPathPlusUs = Number(((performance.now() - tPath0) * 1000).toFixed(2));

    const bgpFanout = Math.min(250, Math.max(25, Math.floor(size / 10)));
    const bgpAxioms: OWL2Axiom[] = [
      {
        type: "SubClassOf",
        subClassIri: "http://modelscript.org/bench#Class_1",
        superClassIri: "http://modelscript.org/bench#Class_0",
      },
    ];
    for (let i = 0; i < bgpFanout; i++) {
      bgpAxioms.push({
        type: "ObjectPropertyAssertion",
        subjectIri: `http://modelscript.org/bench#System_${i >> 2}`,
        propertyIri: hasSubsystemIri,
        objectIri: `http://modelscript.org/bench#Subsys_${i}`,
      });
      bgpAxioms.push({
        type: "ObjectPropertyAssertion",
        subjectIri: `http://modelscript.org/bench#Subsys_${i}`,
        propertyIri: verifiesIri,
        objectIri: "http://modelscript.org/bench#Class_1",
      });
    }
    reasoner.loadOntology(bgpAxioms);
    reasoner.classify();

    const tBgp0 = performance.now();
    const bgpResult = reasoner.queryBgp({
      patterns: [
        { subject: "?sys", predicate: hasSubsystemIri, object: "?sub" },
        { subject: "?sub", predicate: verifiesIri, object: "?req" },
        {
          subject: "?req",
          predicate: "rdfs:subClassOf",
          object: "http://modelscript.org/bench#Class_0",
        },
      ],
    });
    const bgpThreePatternJoinMs = Number((performance.now() - tBgp0).toFixed(3));

    const { wasm: satWasm } = await instantiateWasm(wasmBytes);
    const satStore = new WasmOntologyStore(satWasm);
    const tboxSize = Math.min(size, 400);
    let retractTargetAxiomId = 0;
    for (let i = 1; i < tboxSize; i++) {
      const parentIdx = (i - 1) >> 3;
      const axId = satStore.addAxiomDirect64(
        AXIOM_SUBCLASS_OF,
        LANG_OWL2,
        `http://modelscript.org/bench#TBox_${i}`,
        subClassIri,
        `http://modelscript.org/bench#TBox_${parentIdx}`,
      );
      if (i === 1) retractTargetAxiomId = axId;
    }

    const tSat0 = performance.now();
    const inferredAxioms = satWasm.ontology_saturateELRules!();
    const elSaturationMs = Number((performance.now() - tSat0).toFixed(2));

    const tDred0 = performance.now();
    satWasm.ontology_retractAxiom!(retractTargetAxiomId);
    const dredRetractionMs = Number((performance.now() - tDred0).toFixed(2));

    results.push({
      hierarchySize: size,
      intervalIndexBuildMs,
      intervalSubsumptionQueryNs,
      elSaturationMs,
      inferredAxioms,
      propertyPathPlusUs,
      propertyPathReachableCount: reachableCount,
      bgpThreePatternJoinMs,
      bgpMatchCount: bgpResult.bindings.length,
      dredRetractionMs,
    });
  }

  return results;
}

/**
 * Tier 6: Paged 4KB Slotted B+Tree & Clock Buffer Pool Scaling
 */
async function benchmarkPagedBTree(wasmBytes: Buffer, scales: number[]): Promise<PagedBTreeTierResult[]> {
  const results: PagedBTreeTierResult[] = [];

  const configs: { scale: number; frames: number }[] = scales.map((scale) => ({
    scale,
    frames: 256,
  }));

  const maxScale = scales[scales.length - 1] ?? 10000;
  if (maxScale >= 10000) {
    configs.push({ scale: maxScale, frames: 32 });
    configs.push({ scale: maxScale, frames: 1024 });
  }

  for (const { scale, frames } of configs) {
    const { exports } = await instantiateWasm(wasmBytes);
    const engine = new PagedStorageEngine(exports as unknown as PagedWasmExports, frames);

    const predicateId = hashIri64("http://modelscript.org/paged#connectsTo").lo;
    const altPredicateId = hashIri64("http://modelscript.org/paged#monitors").lo;

    const tIns0 = performance.now();
    for (let i = 1; i <= scale; i++) {
      const sKey = ((i * 2654435761) >>> 16) + 1;
      const pKey = (i & 7) === 0 ? altPredicateId : predicateId;
      engine.insertTriple(sKey, pKey, i + 1000, AXIOM_OBJ_PROP_ASSERT, 0);
    }
    const insertMs = Math.max(0.001, performance.now() - tIns0);

    const lookupIterations = 200;
    const tLookup0 = performance.now();
    for (let q = 1; q <= lookupIterations; q++) {
      const targetS = ((q * 2654435761) >>> 16) + 1;
      engine.findTriples({ subject: targetS });
    }
    const boundSubjectLookupUs = Number((((performance.now() - tLookup0) * 1000) / lookupIterations).toFixed(2));

    const tScan0 = performance.now();
    engine.findTriples({ predicate: altPredicateId });
    const predicateFilterScanMs = Number((performance.now() - tScan0).toFixed(2));

    const metricsBeforeFlush = engine.getMetrics();
    const flushedDirtyPages = engine.flush();

    results.push({
      scale,
      bufferPoolFrames: frames,
      bufferPoolSizeKb: frames * 4,
      insertThroughputPerSec: Math.round((scale / insertMs) * 1000),
      insertMs: Number(insertMs.toFixed(2)),
      totalPages: metricsBeforeFlush.pageCount,
      storageSizeKb: metricsBeforeFlush.allocatedMemoryBytes / 1024,
      boundSubjectLookupUs,
      predicateFilterScanMs,
      bufferPoolHitRatePercent: Number((metricsBeforeFlush.bufferPoolHitRate * 100).toFixed(2)),
      flushedDirtyPages,
    });
  }

  return results;
}

/**
 * Tier 7: Head-to-Head Triplestore Comparison
 * Compares ModelScript WASM Columnar Store + RoaringBitmaps, ModelScript Paged B+Tree,
 * Apache Jena TDB2 (MVCC B+Tree In-Memory & Disk-Backed), SQLite3 C B-Tree, N3.js Store,
 * and Comunica SPARQL 1.1 Engine.
 */
async function benchmarkExternalTriplestores(
  wasmBytes: Buffer,
  scales: number[],
  jenaOutput: JenaTdb2BenchmarkOutput | null,
): Promise<ExternalTriplestoreComparisonRow[]> {
  const rows: ExternalTriplestoreComparisonRow[] = [];

  const comparisonScales = scales.filter((s) => s <= 50_000);
  if (comparisonScales.length === 0) comparisonScales.push(10_000);

  const rdfTypeIri = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
  const targetClassIri = "http://modelscript.org/bench#TargetSensorBlock";
  const otherClassIri = "http://modelscript.org/bench#StandardActuatorBlock";

  for (const scale of comparisonScales) {
    const subjIris = new Array<string>(scale);
    const subjLo = new Uint32Array(scale);
    const subjHi = new Uint32Array(scale);
    for (let i = 0; i < scale; i++) {
      const iri = `http://modelscript.org/bench#Node_${i}`;
      subjIris[i] = iri;
      const h = hashIri64(iri);
      subjLo[i] = h.lo;
      subjHi[i] = h.hi;
    }
    const rdfTypeHash = hashIri64(rdfTypeIri);
    const targetHash = hashIri64(targetClassIri);
    const otherHash = hashIri64(otherClassIri);
    const midIdx = Math.floor(scale / 2);
    const midSubjIri = subjIris[midIdx]!;

    // -------------------------------------------------------------------------
    // 1. ModelScript WASM Columnar Store + RoaringBitmap
    // -------------------------------------------------------------------------
    const { wasm } = await instantiateWasm(wasmBytes);
    const msStore = new WasmOntologyStore(wasm);
    msStore.setPureWasmMode(true);
    const rdfTypeId = msStore.internIri(rdfTypeIri);
    const targetClassId = msStore.internIri(targetClassIri);
    msStore.internIri(otherClassIri);
    const midSubjId = msStore.internIri(midSubjIri);

    const tMsIngest0 = performance.now();
    for (let i = 0; i < scale; i++) {
      const isTarget = (i & 3) === 0;
      const oH = isTarget ? targetHash : otherHash;
      wasm.ontology_addAxiom64!(
        AXIOM_CLASS_ASSERT,
        LANG_OWL2,
        subjLo[i]!,
        subjHi[i]!,
        rdfTypeHash.lo,
        rdfTypeHash.hi,
        oH.lo,
        oH.hi,
        0,
        0,
      );
    }
    const msIngestMs = Math.max(0.001, performance.now() - tMsIngest0);

    const pointIters = 200;
    const tMsPoint0 = performance.now();
    for (let it = 0; it < pointIters; it++) {
      wasm.ontology_queryTriples!(midSubjId, rdfTypeId, 0);
    }
    const msPointUs = ((performance.now() - tMsPoint0) * 1000) / pointIters;

    const multiIters = 20;
    let msMatched = 0;
    const tMsMulti0 = performance.now();
    for (let it = 0; it < multiIters; it++) {
      msMatched = wasm.ontology_queryTriplesBitmap!(0, rdfTypeId, targetClassId);
    }
    const msMultiMs = (performance.now() - tMsMulti0) / multiIters;

    rows.push({
      engine: "ModelScript WASM (Columnar + Roaring)",
      scale,
      ingestMs: Number(msIngestMs.toFixed(2)),
      ingestTriplesPerSec: Math.round((scale / msIngestMs) * 1000),
      pointLookupUs: Number(msPointUs.toFixed(2)),
      multiBoundQueryMs: Number(msMultiMs.toFixed(3)),
      matchedCount: msMatched,
      ingestSpeedupVsEngine: 1.0,
      querySpeedupVsEngine: 1.0,
    });

    // -------------------------------------------------------------------------
    // 2. ModelScript Paged 4KB Slotted B+Tree (3-Index SPO/POS/OSP + CoW MVCC)
    // -------------------------------------------------------------------------
    const { exports: pagedExports } = await instantiateWasm(wasmBytes);
    const pagedEngine = new PagedStorageEngine(pagedExports as unknown as PagedWasmExports, 512);
    const tPgIngest0 = performance.now();
    pagedEngine.beginTransaction();
    for (let i = 0; i < scale; i++) {
      const isTarget = (i & 3) === 0;
      pagedEngine.insertTriple(i + 1, 10, isTarget ? 100 : 200, AXIOM_CLASS_ASSERT, 0);
    }
    pagedEngine.commit();
    const pgIngestMs = Math.max(0.001, performance.now() - tPgIngest0);

    const tPgPoint0 = performance.now();
    for (let it = 0; it < pointIters; it++) {
      pagedEngine.findTriples({ subject: midIdx + 1, predicate: 10 });
    }
    const pgPointUs = ((performance.now() - tPgPoint0) * 1000) / pointIters;

    const tPgMulti0 = performance.now();
    const pgMatches = pagedEngine.findTriples({ predicate: 10, object: 100 });
    const pgMultiMs = performance.now() - tPgMulti0;

    rows.push({
      engine: "ModelScript Paged B+Tree (SPO/POS/OSP CoW)",
      scale,
      ingestMs: Number(pgIngestMs.toFixed(2)),
      ingestTriplesPerSec: Math.round((scale / pgIngestMs) * 1000),
      pointLookupUs: Number(pgPointUs.toFixed(2)),
      multiBoundQueryMs: Number(pgMultiMs.toFixed(3)),
      matchedCount: pgMatches.length,
      ingestSpeedupVsEngine: Number((pgIngestMs / msIngestMs).toFixed(2)),
      querySpeedupVsEngine: Number((pgMultiMs / Math.max(0.001, msMultiMs)).toFixed(2)),
    });

    // -------------------------------------------------------------------------
    // 3. Apache Jena TDB2 (MVCC B+Tree In-Memory & Disk-Backed)
    // -------------------------------------------------------------------------
    if (jenaOutput) {
      const jenaRowsForScale = jenaOutput.triplestoreRows.filter((r) => r.scale === scale);
      for (const jr of jenaRowsForScale) {
        rows.push({
          engine: jr.engine,
          scale: jr.scale,
          ingestMs: Number(jr.ingestMs.toFixed(2)),
          ingestTriplesPerSec: jr.ingestTriplesPerSec,
          pointLookupUs: Number(jr.pointLookupUs.toFixed(2)),
          multiBoundQueryMs: Number(jr.multiBoundQueryMs.toFixed(3)),
          matchedCount: jr.matchedCount,
          ingestSpeedupVsEngine: Number((jr.ingestMs / msIngestMs).toFixed(2)),
          querySpeedupVsEngine: Number((jr.multiBoundQueryMs / Math.max(0.001, msMultiMs)).toFixed(2)),
        });
      }
    }

    // -------------------------------------------------------------------------
    // 4. SQLite3 Native C B-Tree (SPO / POS / OSP Covering Indexes)
    // -------------------------------------------------------------------------
    const sqliteDb = new Database(":memory:");
    sqliteDb.exec(`
      CREATE TABLE triples (s TEXT NOT NULL, p TEXT NOT NULL, o TEXT NOT NULL);
      CREATE INDEX idx_spo ON triples (s, p, o);
      CREATE INDEX idx_pos ON triples (p, o, s);
      CREATE INDEX idx_osp ON triples (o, s, p);
    `);
    const insertStmt = sqliteDb.prepare("INSERT INTO triples (s, p, o) VALUES (?, ?, ?)");
    const bulkInsertTx = sqliteDb.transaction((n: number) => {
      for (let i = 0; i < n; i++) {
        const isTarget = (i & 3) === 0;
        insertStmt.run(subjIris[i]!, rdfTypeIri, isTarget ? targetClassIri : otherClassIri);
      }
    });

    const tSqlIngest0 = performance.now();
    bulkInsertTx(scale);
    const sqlIngestMs = Math.max(0.001, performance.now() - tSqlIngest0);

    const sqlPointStmt = sqliteDb.prepare("SELECT o FROM triples WHERE s = ? AND p = ?");
    const tSqlPoint0 = performance.now();
    for (let it = 0; it < pointIters; it++) {
      sqlPointStmt.all(midSubjIri, rdfTypeIri);
    }
    const sqlPointUs = ((performance.now() - tSqlPoint0) * 1000) / pointIters;

    const sqlMultiStmt = sqliteDb.prepare("SELECT s FROM triples WHERE p = ? AND o = ?");
    let sqlMatches: unknown[] = [];
    const tSqlMulti0 = performance.now();
    for (let it = 0; it < multiIters; it++) {
      sqlMatches = sqlMultiStmt.all(rdfTypeIri, targetClassIri);
    }
    const sqlMultiMs = (performance.now() - tSqlMulti0) / multiIters;
    sqliteDb.close();

    rows.push({
      engine: "SQLite3 Native C B-Tree (SPO/POS/OSP)",
      scale,
      ingestMs: Number(sqlIngestMs.toFixed(2)),
      ingestTriplesPerSec: Math.round((scale / sqlIngestMs) * 1000),
      pointLookupUs: Number(sqlPointUs.toFixed(2)),
      multiBoundQueryMs: Number(sqlMultiMs.toFixed(3)),
      matchedCount: sqlMatches.length,
      ingestSpeedupVsEngine: Number((sqlIngestMs / msIngestMs).toFixed(2)),
      querySpeedupVsEngine: Number((sqlMultiMs / Math.max(0.001, msMultiMs)).toFixed(2)),
    });

    // -------------------------------------------------------------------------
    // 5. N3.js In-Memory RDF/JS Store (N3.Store)
    // -------------------------------------------------------------------------
    const n3Store = new N3Store();
    const pNode = namedNode(rdfTypeIri);
    const targetNode = namedNode(targetClassIri);
    const otherNode = namedNode(otherClassIri);
    const midSubjNode = namedNode(midSubjIri);

    const tN3Ingest0 = performance.now();
    for (let i = 0; i < scale; i++) {
      const isTarget = (i & 3) === 0;
      n3Store.addQuad(namedNode(subjIris[i]!), pNode, isTarget ? targetNode : otherNode);
    }
    const n3IngestMs = Math.max(0.001, performance.now() - tN3Ingest0);

    const tN3Point0 = performance.now();
    for (let it = 0; it < pointIters; it++) {
      n3Store.getQuads(midSubjNode, pNode, null, null);
    }
    const n3PointUs = ((performance.now() - tN3Point0) * 1000) / pointIters;

    let n3Matches = 0;
    const tN3Multi0 = performance.now();
    for (let it = 0; it < multiIters; it++) {
      n3Matches = n3Store.getQuads(null, pNode, targetNode, null).length;
    }
    const n3MultiMs = (performance.now() - tN3Multi0) / multiIters;

    rows.push({
      engine: "N3.js Store (RDF/JS In-Memory)",
      scale,
      ingestMs: Number(n3IngestMs.toFixed(2)),
      ingestTriplesPerSec: Math.round((scale / n3IngestMs) * 1000),
      pointLookupUs: Number(n3PointUs.toFixed(2)),
      multiBoundQueryMs: Number(n3MultiMs.toFixed(3)),
      matchedCount: n3Matches,
      ingestSpeedupVsEngine: Number((n3IngestMs / msIngestMs).toFixed(2)),
      querySpeedupVsEngine: Number((n3MultiMs / Math.max(0.001, msMultiMs)).toFixed(2)),
    });

    // -------------------------------------------------------------------------
    // 6. Comunica SPARQL 1.1 Engine (@comunica/query-sparql-rdfjs over N3.Store)
    // -------------------------------------------------------------------------
    if (scale <= 10_000) {
      const comunica = new ComunicaQueryEngine();
      const tComPoint0 = performance.now();
      const pointStream = await comunica.queryBindings(`SELECT ?o WHERE { <${midSubjIri}> <${rdfTypeIri}> ?o }`, {
        sources: [n3Store],
      });
      await pointStream.toArray();
      const comPointUs = (performance.now() - tComPoint0) * 1000;

      const tComMulti0 = performance.now();
      const multiStream = await comunica.queryBindings(`SELECT ?s WHERE { ?s <${rdfTypeIri}> <${targetClassIri}> }`, {
        sources: [n3Store],
      });
      const comBindings = await multiStream.toArray();
      const comMultiMs = performance.now() - tComMulti0;

      rows.push({
        engine: "Comunica SPARQL 1.1 (over N3.Store)",
        scale,
        ingestMs: Number(n3IngestMs.toFixed(2)),
        ingestTriplesPerSec: Math.round((scale / n3IngestMs) * 1000),
        pointLookupUs: Number(comPointUs.toFixed(2)),
        multiBoundQueryMs: Number(comMultiMs.toFixed(3)),
        matchedCount: comBindings.length,
        ingestSpeedupVsEngine: Number((n3IngestMs / msIngestMs).toFixed(2)),
        querySpeedupVsEngine: Number((comMultiMs / Math.max(0.001, msMultiMs)).toFixed(2)),
      });
    }
  }

  return rows;
}

/**
 * Tier 8: Head-to-Head Ontology Reasoner & Graph Query Comparison
 * Compares ModelScript WASM Reasoner vs. ModelScript TS Fallback vs. Apache Jena TDB2 RDFS/ARQ
 * vs. SQLite3 Recursive CTE Datalog vs. N3.Store + Forward-Chaining/BFS vs. Comunica SPARQL 1.1.
 */
async function benchmarkExternalReasoners(
  wasmBytes: Buffer,
  jenaOutput: JenaTdb2BenchmarkOutput | null,
): Promise<ExternalReasonerComparisonRow[]> {
  const rows: ExternalReasonerComparisonRow[] = [];

  const hierarchyClasses = 2_000;
  const chainHops = 64;
  const bgpFanout = 200;

  const subClassIri = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
  const partOfIri = "http://modelscript.org/bench#partOf";
  const hasSubsystemIri = "http://modelscript.org/bench#hasSubsystem";
  const verifiesIri = "http://modelscript.org/bench#verifies";
  const rootClassIri = "http://modelscript.org/bench#Class_0";
  const child1ClassIri = "http://modelscript.org/bench#Class_1";
  const leafClassIri = `http://modelscript.org/bench#Class_${hierarchyClasses - 1}`;
  const part0Iri = "http://modelscript.org/bench#Part_0";

  // ---------------------------------------------------------------------------
  // 1. ModelScript WASM Reasoner (O(1) Pre-order Interval Index + EL++ + DRed)
  // ---------------------------------------------------------------------------
  {
    const { wasm } = await instantiateWasm(wasmBytes);
    const store = new WasmOntologyStore(wasm);
    const reasoner = new WasmOntologyReasoner(wasm);

    for (let i = 1; i < hierarchyClasses; i++) {
      const parentIdx = (i - 1) >> 3;
      store.addAxiomDirect64(
        AXIOM_SUBCLASS_OF,
        LANG_OWL2,
        `http://modelscript.org/bench#Class_${i}`,
        subClassIri,
        `http://modelscript.org/bench#Class_${parentIdx}`,
      );
    }
    for (let i = 0; i < chainHops; i++) {
      store.addAxiomDirect64(
        AXIOM_OBJ_PROP_ASSERT,
        LANG_SYSML2,
        `http://modelscript.org/bench#Part_${i}`,
        partOfIri,
        `http://modelscript.org/bench#Part_${i + 1}`,
      );
    }

    const tIdx0 = performance.now();
    wasm.ontology_computeIntervalIndex!();
    const classifyMs = performance.now() - tIdx0;

    const rootId = store.internIri(rootClassIri);
    const leafId = store.internIri(leafClassIri);
    const subIters = 2000;
    const tSub0 = performance.now();
    let subOk = 0;
    for (let it = 0; it < subIters; it++) {
      subOk += wasm.ontology_isSubClassOf!(leafId, rootId);
    }
    const subUs = ((performance.now() - tSub0) * 1000) / subIters;

    const partOfId = store.internIri(partOfIri);
    const part0Id = store.internIri(part0Iri);
    const pathIters = 100;
    let pathCount = 0;
    const tPath0 = performance.now();
    for (let it = 0; it < pathIters; it++) {
      pathCount = wasm.ontology_evaluatePropertyPath!(partOfId, PATH_OP_PLUS, 0, part0Id);
    }
    const pathUs = ((performance.now() - tPath0) * 1000) / pathIters;

    const bgpAxioms: OWL2Axiom[] = [{ type: "SubClassOf", subClassIri: child1ClassIri, superClassIri: rootClassIri }];
    for (let i = 0; i < bgpFanout; i++) {
      bgpAxioms.push({
        type: "ObjectPropertyAssertion",
        subjectIri: `http://modelscript.org/bench#System_${i >> 2}`,
        propertyIri: hasSubsystemIri,
        objectIri: `http://modelscript.org/bench#Subsys_${i}`,
      });
      bgpAxioms.push({
        type: "ObjectPropertyAssertion",
        subjectIri: `http://modelscript.org/bench#Subsys_${i}`,
        propertyIri: verifiesIri,
        objectIri: child1ClassIri,
      });
    }
    reasoner.loadOntology(bgpAxioms);
    reasoner.classify();
    const tBgp0 = performance.now();
    const bgpRes = reasoner.queryBgp({
      patterns: [
        { subject: "?sys", predicate: hasSubsystemIri, object: "?sub" },
        { subject: "?sub", predicate: verifiesIri, object: "?req" },
        { subject: "?req", predicate: "rdfs:subClassOf", object: rootClassIri },
      ],
    });
    const bgpMs = performance.now() - tBgp0;

    const { wasm: elWasm } = await instantiateWasm(wasmBytes);
    const elStore = new WasmOntologyStore(elWasm);
    let elRetractId = 0;
    for (let i = 1; i < 256; i++) {
      const pIdx = (i - 1) >> 3;
      const id = elStore.addAxiomDirect64(
        AXIOM_SUBCLASS_OF,
        LANG_OWL2,
        `http://modelscript.org/bench#EL_${i}`,
        subClassIri,
        `http://modelscript.org/bench#EL_${pIdx}`,
      );
      if (i === 1) elRetractId = id;
    }
    elStore.addAxiomDirect64(
      AXIOM_OBJECT_SOME_VALUES_FROM,
      LANG_OWL2,
      "http://modelscript.org/bench#SensorSys",
      partOfIri,
      "http://modelscript.org/bench#EL_200",
    );
    const tEl0 = performance.now();
    elWasm.ontology_saturateELRules!();
    const elMs = performance.now() - tEl0;

    const tDred0 = performance.now();
    elWasm.ontology_retractAxiom!(elRetractId);
    const dredMs = performance.now() - tDred0;

    rows.push({
      engine: "ModelScript WASM Reasoner (Interval + EL++ + DRed)",
      hierarchyClasses,
      classifyOrIndexMs: Number(classifyMs.toFixed(3)),
      subsumptionQueryUs: Number(subUs.toFixed(3)),
      transitivePathPlusUs: Number(pathUs.toFixed(2)),
      threePatternBgpMs: Number(bgpMs.toFixed(3)),
      elMaterializeMs: Number(elMs.toFixed(3)),
      incrementalRetractMs: Number(dredMs.toFixed(3)),
      verifiedParity: subOk === subIters && pathCount === chainHops && bgpRes.bindings.length === bgpFanout,
    });
  }

  // ---------------------------------------------------------------------------
  // 2. ModelScript Pure-TS Reasoner Fallback (V8 Map/Set Graph Closure)
  // ---------------------------------------------------------------------------
  {
    const tsReasoner = new WasmOntologyReasoner(null);
    const axioms: OWL2Axiom[] = [];
    for (let i = 1; i < hierarchyClasses; i++) {
      const parentIdx = (i - 1) >> 3;
      axioms.push({
        type: "SubClassOf",
        subClassIri: `http://modelscript.org/bench#Class_${i}`,
        superClassIri: `http://modelscript.org/bench#Class_${parentIdx}`,
      });
    }
    for (let i = 0; i < chainHops; i++) {
      axioms.push({
        type: "ObjectPropertyAssertion",
        subjectIri: `http://modelscript.org/bench#Part_${i}`,
        propertyIri: partOfIri,
        objectIri: `http://modelscript.org/bench#Part_${i + 1}`,
      });
    }
    for (let i = 0; i < bgpFanout; i++) {
      axioms.push({
        type: "ObjectPropertyAssertion",
        subjectIri: `http://modelscript.org/bench#System_${i >> 2}`,
        propertyIri: hasSubsystemIri,
        objectIri: `http://modelscript.org/bench#Subsys_${i}`,
      });
      axioms.push({
        type: "ObjectPropertyAssertion",
        subjectIri: `http://modelscript.org/bench#Subsys_${i}`,
        propertyIri: verifiesIri,
        objectIri: child1ClassIri,
      });
    }

    tsReasoner.loadOntology(axioms);
    const tClassify0 = performance.now();
    tsReasoner.classify();
    const classifyMs = performance.now() - tClassify0;

    const subIters = 1000;
    let subOk = false;
    const tSub0 = performance.now();
    for (let it = 0; it < subIters; it++) {
      subOk = tsReasoner.isSubClassOf(leafClassIri, rootClassIri);
    }
    const subUs = ((performance.now() - tSub0) * 1000) / subIters;

    const pathIters = 50;
    let pathRes: readonly string[] = [];
    const tPath0 = performance.now();
    for (let it = 0; it < pathIters; it++) {
      pathRes = tsReasoner.evaluatePropertyPath(partOfIri, "plus", part0Iri);
    }
    const pathUs = ((performance.now() - tPath0) * 1000) / pathIters;

    const tBgp0 = performance.now();
    const bgpRes = tsReasoner.queryBgp({
      patterns: [
        { subject: "?sys", predicate: hasSubsystemIri, object: "?sub" },
        { subject: "?sub", predicate: verifiesIri, object: "?req" },
        { subject: "?req", predicate: "rdfs:subClassOf", object: rootClassIri },
      ],
    });
    const bgpMs = performance.now() - tBgp0;

    const tRetract0 = performance.now();
    tsReasoner.applyDelta({
      retractions: [axioms[0]!],
      assertions: [],
    });
    tsReasoner.classify();
    const retractMs = performance.now() - tRetract0;

    rows.push({
      engine: "ModelScript TS Graph Fallback (Map/Set Closure)",
      hierarchyClasses,
      classifyOrIndexMs: Number(classifyMs.toFixed(3)),
      subsumptionQueryUs: Number(subUs.toFixed(3)),
      transitivePathPlusUs: Number(pathUs.toFixed(2)),
      threePatternBgpMs: Number(bgpMs.toFixed(3)),
      elMaterializeMs: Number(classifyMs.toFixed(3)),
      incrementalRetractMs: Number(retractMs.toFixed(3)),
      verifiedParity: subOk && pathRes.length === chainHops && bgpRes.bindings.length === bgpFanout,
    });
  }

  // ---------------------------------------------------------------------------
  // 3. Apache Jena TDB2 + RDFS Reasoner + ARQ SPARQL 1.1
  // ---------------------------------------------------------------------------
  if (jenaOutput?.reasonerRow) {
    rows.push(jenaOutput.reasonerRow);
  }

  // ---------------------------------------------------------------------------
  // 4. SQLite3 Recursive CTE Datalog & Relational Join Engine (better-sqlite3)
  // ---------------------------------------------------------------------------
  {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE triples (s TEXT NOT NULL, p TEXT NOT NULL, o TEXT NOT NULL);
      CREATE INDEX idx_spo ON triples (s, p, o);
      CREATE INDEX idx_pos ON triples (p, o, s);
      CREATE INDEX idx_osp ON triples (o, s, p);
      CREATE TABLE inferred_subclass (sub TEXT NOT NULL, sup TEXT NOT NULL, PRIMARY KEY (sub, sup));
      CREATE INDEX idx_inf_sub ON inferred_subclass (sub, sup);
    `);
    const ins = db.prepare("INSERT INTO triples (s, p, o) VALUES (?, ?, ?)");
    const loadTx = db.transaction(() => {
      for (let i = 1; i < hierarchyClasses; i++) {
        const parentIdx = (i - 1) >> 3;
        ins.run(
          `http://modelscript.org/bench#Class_${i}`,
          subClassIri,
          `http://modelscript.org/bench#Class_${parentIdx}`,
        );
      }
      for (let i = 0; i < chainHops; i++) {
        ins.run(`http://modelscript.org/bench#Part_${i}`, partOfIri, `http://modelscript.org/bench#Part_${i + 1}`);
      }
      for (let i = 0; i < bgpFanout; i++) {
        ins.run(
          `http://modelscript.org/bench#System_${i >> 2}`,
          hasSubsystemIri,
          `http://modelscript.org/bench#Subsys_${i}`,
        );
        ins.run(`http://modelscript.org/bench#Subsys_${i}`, verifiesIri, child1ClassIri);
      }
    });
    loadTx();

    const materializeStmt = db.prepare(`
      INSERT OR IGNORE INTO inferred_subclass (sub, sup)
      WITH RECURSIVE tc(sub, sup) AS (
        SELECT s, o FROM triples WHERE p = ?
        UNION
        SELECT tc.sub, t.o FROM tc JOIN triples t ON tc.sup = t.s WHERE t.p = ?
      )
      SELECT sub, sup FROM tc
    `);
    const tMat0 = performance.now();
    materializeStmt.run(subClassIri, subClassIri);
    const classifyMs = performance.now() - tMat0;

    const subCteStmt = db.prepare(`
      WITH RECURSIVE anc(c) AS (
        SELECT o FROM triples WHERE s = ? AND p = ?
        UNION
        SELECT t.o FROM anc JOIN triples t ON anc.c = t.s WHERE t.p = ?
      )
      SELECT 1 AS found FROM anc WHERE c = ? LIMIT 1
    `);
    const subIters = 200;
    let subFound = false;
    const tSub0 = performance.now();
    for (let it = 0; it < subIters; it++) {
      const row = subCteStmt.get(leafClassIri, subClassIri, subClassIri, rootClassIri) as { found: number } | undefined;
      subFound = row?.found === 1;
    }
    const subUs = ((performance.now() - tSub0) * 1000) / subIters;

    const pathCteStmt = db.prepare(`
      WITH RECURSIVE reach(node) AS (
        SELECT o FROM triples WHERE s = ? AND p = ?
        UNION
        SELECT t.o FROM reach JOIN triples t ON reach.node = t.s WHERE t.p = ?
      )
      SELECT node FROM reach
    `);
    const pathIters = 50;
    let pathRows: unknown[] = [];
    const tPath0 = performance.now();
    for (let it = 0; it < pathIters; it++) {
      pathRows = pathCteStmt.all(part0Iri, partOfIri, partOfIri);
    }
    const pathUs = ((performance.now() - tPath0) * 1000) / pathIters;

    const bgpStmt = db.prepare(`
      SELECT t1.s AS sys, t1.o AS sub, t2.o AS req
      FROM triples t1
      JOIN triples t2 ON t1.o = t2.s
      JOIN triples t3 ON t2.o = t3.s
      WHERE t1.p = ? AND t2.p = ? AND t3.p = ? AND t3.o = ?
    `);
    const tBgp0 = performance.now();
    const bgpRows = bgpStmt.all(hasSubsystemIri, verifiesIri, subClassIri, rootClassIri);
    const bgpMs = performance.now() - tBgp0;

    const tRetract0 = performance.now();
    db.prepare("DELETE FROM triples WHERE s = ? AND p = ? AND o = ?").run(child1ClassIri, subClassIri, rootClassIri);
    db.prepare("DELETE FROM inferred_subclass").run();
    materializeStmt.run(subClassIri, subClassIri);
    const retractMs = performance.now() - tRetract0;
    db.close();

    rows.push({
      engine: "SQLite3 Recursive CTE Datalog + SQL Joins",
      hierarchyClasses,
      classifyOrIndexMs: Number(classifyMs.toFixed(3)),
      subsumptionQueryUs: Number(subUs.toFixed(3)),
      transitivePathPlusUs: Number(pathUs.toFixed(2)),
      threePatternBgpMs: Number(bgpMs.toFixed(3)),
      elMaterializeMs: Number(classifyMs.toFixed(3)),
      incrementalRetractMs: Number(retractMs.toFixed(3)),
      verifiedParity: subFound && pathRows.length === chainHops && bgpRows.length === bgpFanout,
    });
  }

  // ---------------------------------------------------------------------------
  // 5. N3.js Store + Forward-Chaining / BFS Graph Reasoner
  // ---------------------------------------------------------------------------
  const n3Store = new N3Store();
  for (let i = 1; i < hierarchyClasses; i++) {
    const parentIdx = (i - 1) >> 3;
    n3Store.addQuad(
      namedNode(`http://modelscript.org/bench#Class_${i}`),
      namedNode(subClassIri),
      namedNode(`http://modelscript.org/bench#Class_${parentIdx}`),
    );
  }
  for (let i = 0; i < chainHops; i++) {
    n3Store.addQuad(
      namedNode(`http://modelscript.org/bench#Part_${i}`),
      namedNode(partOfIri),
      namedNode(`http://modelscript.org/bench#Part_${i + 1}`),
    );
  }
  for (let i = 0; i < bgpFanout; i++) {
    n3Store.addQuad(
      namedNode(`http://modelscript.org/bench#System_${i >> 2}`),
      namedNode(hasSubsystemIri),
      namedNode(`http://modelscript.org/bench#Subsys_${i}`),
    );
    n3Store.addQuad(
      namedNode(`http://modelscript.org/bench#Subsys_${i}`),
      namedNode(verifiesIri),
      namedNode(child1ClassIri),
    );
  }

  {
    const subPredNode = namedNode(subClassIri);
    const partOfNode = namedNode(partOfIri);

    const buildN3Closure = (): Map<string, Set<string>> => {
      const closure = new Map<string, Set<string>>();
      const directQuads = n3Store.getQuads(null, subPredNode, null, null);
      for (const q of directQuads) {
        let set = closure.get(q.subject.value);
        if (!set) {
          set = new Set();
          closure.set(q.subject.value, set);
        }
        set.add(q.object.value);
      }
      let changed = true;
      while (changed) {
        changed = false;
        for (const [, supers] of closure) {
          for (const sup of Array.from(supers)) {
            const grandSupers = closure.get(sup);
            if (grandSupers) {
              for (const gs of grandSupers) {
                if (!supers.has(gs)) {
                  supers.add(gs);
                  changed = true;
                }
              }
            }
          }
        }
      }
      return closure;
    };

    const tMat0 = performance.now();
    const n3Closure = buildN3Closure();
    const classifyMs = performance.now() - tMat0;
    void n3Closure;

    const subIters = 200;
    let n3SubOk = false;
    const tSub0 = performance.now();
    for (let it = 0; it < subIters; it++) {
      const queue: string[] = [leafClassIri];
      const visited = new Set<string>([leafClassIri]);
      let found = false;
      while (queue.length > 0) {
        const curr = queue.shift()!;
        if (curr === rootClassIri) {
          found = true;
          break;
        }
        const quads = n3Store.getQuads(namedNode(curr), subPredNode, null, null);
        for (const q of quads) {
          if (!visited.has(q.object.value)) {
            visited.add(q.object.value);
            queue.push(q.object.value);
          }
        }
      }
      n3SubOk = found;
    }
    const subUs = ((performance.now() - tSub0) * 1000) / subIters;

    const pathIters = 50;
    let n3ReachCount = 0;
    const tPath0 = performance.now();
    for (let it = 0; it < pathIters; it++) {
      const queue: string[] = [part0Iri];
      const reachable = new Set<string>();
      while (queue.length > 0) {
        const curr = queue.shift()!;
        const quads = n3Store.getQuads(namedNode(curr), partOfNode, null, null);
        for (const q of quads) {
          if (!reachable.has(q.object.value)) {
            reachable.add(q.object.value);
            queue.push(q.object.value);
          }
        }
      }
      n3ReachCount = reachable.size;
    }
    const pathUs = ((performance.now() - tPath0) * 1000) / pathIters;

    const tBgp0 = performance.now();
    const n3BgpMatches: { sys: string; sub: string; req: string }[] = [];
    const reqQuads = n3Store.getQuads(null, subPredNode, namedNode(rootClassIri), null);
    for (const rq of reqQuads) {
      const reqIri = rq.subject.value;
      const verQuads = n3Store.getQuads(null, namedNode(verifiesIri), namedNode(reqIri), null);
      for (const vq of verQuads) {
        const subIri = vq.subject.value;
        const sysQuads = n3Store.getQuads(null, namedNode(hasSubsystemIri), namedNode(subIri), null);
        for (const sq of sysQuads) {
          n3BgpMatches.push({ sys: sq.subject.value, sub: subIri, req: reqIri });
        }
      }
    }
    const bgpMs = performance.now() - tBgp0;

    const tRetract0 = performance.now();
    const retractedQuad = quad(namedNode(child1ClassIri), subPredNode, namedNode(rootClassIri));
    n3Store.removeQuad(retractedQuad);
    buildN3Closure();
    n3Store.addQuad(retractedQuad);
    const retractMs = performance.now() - tRetract0;

    rows.push({
      engine: "N3.js Store + Forward-Chaining / BFS",
      hierarchyClasses,
      classifyOrIndexMs: Number(classifyMs.toFixed(3)),
      subsumptionQueryUs: Number(subUs.toFixed(3)),
      transitivePathPlusUs: Number(pathUs.toFixed(2)),
      threePatternBgpMs: Number(bgpMs.toFixed(3)),
      elMaterializeMs: Number(classifyMs.toFixed(3)),
      incrementalRetractMs: Number(retractMs.toFixed(3)),
      verifiedParity: n3SubOk && n3ReachCount === chainHops && n3BgpMatches.length === bgpFanout,
    });
  }

  // ---------------------------------------------------------------------------
  // 6. Comunica W3C SPARQL 1.1 Engine (Property Paths + & 3-Pattern BGP)
  // ---------------------------------------------------------------------------
  {
    const comunica = new ComunicaQueryEngine();

    const tSub0 = performance.now();
    const subBool = await comunica.queryBoolean(`ASK { <${leafClassIri}> <${subClassIri}>+ <${rootClassIri}> }`, {
      sources: [n3Store],
    });
    const subUs = (performance.now() - tSub0) * 1000;

    const tPath0 = performance.now();
    const pathStream = await comunica.queryBindings(`SELECT ?target WHERE { <${part0Iri}> <${partOfIri}>+ ?target }`, {
      sources: [n3Store],
    });
    const pathBindings = await pathStream.toArray();
    const pathUs = (performance.now() - tPath0) * 1000;

    const tBgp0 = performance.now();
    const bgpStream = await comunica.queryBindings(
      `SELECT ?sys ?sub ?req WHERE {
        ?sys <${hasSubsystemIri}> ?sub .
        ?sub <${verifiesIri}> ?req .
        ?req <${subClassIri}> <${rootClassIri}> .
      }`,
      { sources: [n3Store] },
    );
    const bgpBindings = await bgpStream.toArray();
    const bgpMs = performance.now() - tBgp0;

    const tMat0 = performance.now();
    const matStream = await comunica.queryBindings(`SELECT ?sub WHERE { ?sub <${subClassIri}>+ <${rootClassIri}> }`, {
      sources: [n3Store],
    });
    await matStream.toArray();
    const matMs = performance.now() - tMat0;

    rows.push({
      engine: "Comunica W3C SPARQL 1.1 Engine",
      hierarchyClasses,
      classifyOrIndexMs: Number(matMs.toFixed(3)),
      subsumptionQueryUs: Number(subUs.toFixed(3)),
      transitivePathPlusUs: Number(pathUs.toFixed(2)),
      threePatternBgpMs: Number(bgpMs.toFixed(3)),
      elMaterializeMs: Number(matMs.toFixed(3)),
      incrementalRetractMs: Number(matMs.toFixed(3)),
      verifiedParity: subBool && pathBindings.length === chainHops && bgpBindings.length === bgpFanout,
    });
  }

  return rows;
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function printMarkdownReport(report: TriplestoreBenchmarkReport): void {
  console.log("\n================================================================================");
  console.log("  MODELSCRIPT TRIPLESTORE & SEMANTIC STORAGE SCALABILITY BENCHMARK SUITE");
  console.log("================================================================================");
  console.log(`  WASM Kernel : ${path.relative(REPO_ROOT, report.wasmBinary)}`);
  console.log(`  Scale Tiers : ${report.scales.map(formatNumber).join(", ")} triples`);
  console.log("================================================================================\n");

  // Table 1: 64-Bit Hashing & Entity Interning
  console.log("### 1. 64-Bit FNV-1a IRI Hashing & Entity Dictionary Interning");
  console.log(
    "| Scale (IRIs) | 64-Bit Hash (ops/s) | WASM Intern (ops/s) | Unique Entities | Collisions | Total Time (ms) |",
  );
  console.log(
    "| -----------: | ------------------: | ------------------: | --------------: | ---------: | --------------: |",
  );
  for (const r of report.hashAndIntern) {
    console.log(
      `| ${formatNumber(r.scale).padStart(12)} | ${formatNumber(r.hashThroughputOpsPerSec).padStart(19)} | ${formatNumber(r.internThroughputOpsPerSec).padStart(19)} | ${formatNumber(r.uniqueEntities).padStart(15)} | ${String(r.collisions).padStart(10)} | ${r.elapsedMs.toFixed(2).padStart(15)} |`,
    );
  }
  console.log("");

  // Table 2: HDT Front-Coded Dictionary Compression
  console.log("### 2. HDT Front-Coded Dictionary Compression & Decompression");
  console.log(
    "| Scale (URIs) | Raw UTF-8 (KB) | Front-Coded (KB) | Compression Ratio | Space Saved | Intern (ops/s) | Extract (us/op) |",
  );
  console.log(
    "| -----------: | -------------: | ---------------: | ----------------: | ----------: | -------------: | --------------: |",
  );
  for (const r of report.hdtCompression) {
    console.log(
      `| ${formatNumber(r.scale).padStart(12)} | ${(r.rawBytes / 1024).toFixed(1).padStart(14)} | ${(r.compressedBytes / 1024).toFixed(1).padStart(16)} | ${r.compressionRatio.toFixed(3).padStart(17)} | ${(r.savingsPercent.toFixed(1) + "%").padStart(11)} | ${formatNumber(r.internThroughputPerSec).padStart(14)} | ${r.extractLatencyUs.toFixed(2).padStart(15)} |`,
    );
  }
  console.log("");

  // Table 3: Pure-WASM Zero-GC Columnar Ingestion
  console.log("### 3. Pure-WASM Zero-GC Columnar Ingestion & Linear Memory Scaling");
  console.log(
    "| Scale (Triples) | Ingest Time (ms) | Throughput (triples/s) | Latency (us/triple) | WASM Mem Delta (MB) | WASM Bytes/Triple |",
  );
  console.log(
    "| --------------: | ---------------: | ---------------------: | ------------------: | ------------------: | ----------------: |",
  );
  for (const r of report.columnarIngestion) {
    console.log(
      `| ${formatNumber(r.scale).padStart(15)} | ${r.ingestMs.toFixed(2).padStart(16)} | ${formatNumber(r.throughputTriplesPerSec).padStart(22)} | ${r.latencyUsPerTriple.toFixed(3).padStart(19)} | ${(r.wasmMemoryDeltaBytes / (1024 * 1024)).toFixed(2).padStart(19)} | ${r.wasmBytesPerTriple.toFixed(1).padStart(17)} |`,
    );
  }
  console.log("");

  // Table 4: Query Latency Scaling
  console.log("### 4. Multi-Index Query Latency (Hash-Chains vs. RoaringBitmap Intersections)");
  console.log(
    "| Scale (Triples) | SPO Point (us) | (?,P,O) Hash Scan (ms) | (?,P,O) Roaring AND (ms) | Roaring Speedup | Container Regime | Matches |",
  );
  console.log(
    "| --------------: | -------------: | ---------------------: | -----------------------: | --------------: | :--------------- | ------: |",
  );
  for (const r of report.queryScaling) {
    console.log(
      `| ${formatNumber(r.scale).padStart(15)} | ${r.spoPointQueryUs.toFixed(2).padStart(14)} | ${r.multiBoundHashChainScanMs.toFixed(3).padStart(22)} | ${r.multiBoundRoaringAndMs.toFixed(3).padStart(24)} | ${(r.roaringSpeedupFactor.toFixed(2) + "x").padStart(15)} | ${r.containerRegime.padEnd(16)} | ${formatNumber(r.matchedCount).padStart(7)} |`,
    );
  }
  console.log("");

  // Table 5: Ontology Reasoning & Graph Queries
  console.log("### 5. Ontology Reasoning, O(1) Interval Subsumption, Property Paths, BGP & DRed");
  console.log(
    "| Classes | Interval Idx (ms) | O(1) Subsumption (ns) | Path+ Closure (us) | 3-Pattern BGP (ms) | EL++ Sat (ms) | DRed Retract (ms) |",
  );
  console.log(
    "| ------: | ----------------: | --------------------: | -----------------: | -----------------: | ------------: | ----------------: |",
  );
  for (const r of report.reasoningScaling) {
    console.log(
      `| ${formatNumber(r.hierarchySize).padStart(7)} | ${r.intervalIndexBuildMs.toFixed(3).padStart(17)} | ${formatNumber(r.intervalSubsumptionQueryNs).padStart(21)} | ${r.propertyPathPlusUs.toFixed(2).padStart(18)} | ${r.bgpThreePatternJoinMs.toFixed(3).padStart(18)} | ${r.elSaturationMs.toFixed(2).padStart(13)} | ${r.dredRetractionMs.toFixed(2).padStart(17)} |`,
    );
  }
  console.log("");

  // Table 6: Paged 4KB Slotted B+Tree & Clock Buffer Pool
  console.log("### 6. Paged 4KB Slotted B+Tree & Clock Buffer Pool Scaling");
  console.log(
    "| Scale (Triples) | Pool Frames (KB) | Insert (triples/s) | Pages (4KB) | Storage (KB) | Bound-S Query (us) | Clock Hit Rate |",
  );
  console.log(
    "| --------------: | ---------------: | -----------------: | ----------: | -----------: | -----------------: | -------------: |",
  );
  for (const r of report.pagedBTree) {
    const poolLabel = `${r.bufferPoolFrames} (${r.bufferPoolSizeKb} KB)`;
    console.log(
      `| ${formatNumber(r.scale).padStart(15)} | ${poolLabel.padStart(16)} | ${formatNumber(r.insertThroughputPerSec).padStart(18)} | ${formatNumber(r.totalPages).padStart(11)} | ${formatNumber(r.storageSizeKb).padStart(12)} | ${r.boundSubjectLookupUs.toFixed(2).padStart(18)} | ${(r.bufferPoolHitRatePercent.toFixed(2) + "%").padStart(14)} |`,
    );
  }
  console.log("");

  // Table 7: Head-to-Head Triplestore Comparison
  console.log(
    "### 7. Head-to-Head Triplestore Comparison (ModelScript vs. Apache Jena TDB2 vs. SQLite3 vs. N3.js vs. Comunica)",
  );
  console.log(
    "| Engine                                   | Scale  | Ingest (ms) | Throughput (t/s) | Point (us) | (?,P,O) (ms) | WASM Ingest Speedup | WASM Query Speedup |",
  );
  console.log(
    "| :--------------------------------------- | -----: | ----------: | ---------------: | ---------: | -----------: | ------------------: | -----------------: |",
  );
  for (const r of report.externalTriplestoreComparison) {
    console.log(
      `| ${r.engine.padEnd(40)} | ${formatNumber(r.scale).padStart(6)} | ${r.ingestMs.toFixed(2).padStart(11)} | ${formatNumber(r.ingestTriplesPerSec).padStart(16)} | ${r.pointLookupUs.toFixed(2).padStart(10)} | ${r.multiBoundQueryMs.toFixed(3).padStart(12)} | ${(r.ingestSpeedupVsEngine.toFixed(2) + "x").padStart(19)} | ${(r.querySpeedupVsEngine.toFixed(2) + "x").padStart(18)} |`,
    );
  }
  console.log("");

  // Table 8: Head-to-Head Ontology Reasoner Comparison
  console.log(
    "### 8. Head-to-Head Reasoner & Graph Query Comparison (2,000 Classes, 64-Hop Path+, 200-Match 3-Pattern BGP)",
  );
  console.log(
    "| Engine                                             | Classify/Idx (ms) | Subsumption (us) | Path+ (us) | 3-BGP (ms) | Retract/DRed (ms) | Parity |",
  );
  console.log(
    "| :------------------------------------------------- | ----------------: | ---------------: | ---------: | ---------: | ----------------: | :----: |",
  );
  for (const r of report.externalReasonerComparison) {
    console.log(
      `| ${r.engine.padEnd(50)} | ${r.classifyOrIndexMs.toFixed(3).padStart(17)} | ${r.subsumptionQueryUs.toFixed(3).padStart(16)} | ${r.transitivePathPlusUs.toFixed(2).padStart(10)} | ${r.threePatternBgpMs.toFixed(3).padStart(10)} | ${r.incrementalRetractMs.toFixed(3).padStart(17)} | ${(r.verifiedParity ? "PASS" : "FAIL").padStart(6)} |`,
    );
  }
  console.log("");
}

export async function runTriplestoreBenchmark(options?: {
  scales?: number[];
  reasoningScales?: number[];
  silent?: boolean;
  jsonOutPath?: string;
}): Promise<TriplestoreBenchmarkReport> {
  const wasmBinary = resolveWasmBinaryPath();
  const wasmBytes = fs.readFileSync(wasmBinary);

  const scales = options?.scales ?? [1_000, 10_000, 50_000, 100_000];
  const reasoningScales = options?.reasoningScales ?? [200, 1_000, 2_500, 5_000];
  const comparisonScales = scales.filter((s) => s <= 50_000);
  if (comparisonScales.length === 0) comparisonScales.push(10_000);

  const jenaOutput = runJenaTdb2Benchmark(comparisonScales);

  const hashAndIntern = await benchmarkHashAndIntern(wasmBytes, scales);
  const hdtCompression = await benchmarkHdtCompression(wasmBytes, scales);
  const columnarIngestion = await benchmarkColumnarIngestion(wasmBytes, scales);
  const queryScaling = await benchmarkQueryScaling(wasmBytes, scales);
  const reasoningScaling = await benchmarkReasoningScaling(wasmBytes, reasoningScales);
  const pagedBTree = await benchmarkPagedBTree(wasmBytes, scales);
  const externalTriplestoreComparison = await benchmarkExternalTriplestores(wasmBytes, scales, jenaOutput);
  const externalReasonerComparison = await benchmarkExternalReasoners(wasmBytes, jenaOutput);

  const report: TriplestoreBenchmarkReport = {
    timestamp: new Date().toISOString(),
    wasmBinary,
    scales,
    hashAndIntern,
    hdtCompression,
    columnarIngestion,
    queryScaling,
    reasoningScaling,
    pagedBTree,
    externalTriplestoreComparison,
    externalReasonerComparison,
  };

  if (!options?.silent) {
    printMarkdownReport(report);
  }

  if (options?.jsonOutPath) {
    const absOut = path.resolve(REPO_ROOT, options.jsonOutPath);
    fs.mkdirSync(path.dirname(absOut), { recursive: true });
    fs.writeFileSync(absOut, JSON.stringify(report, null, 2), "utf-8");
    if (!options?.silent) {
      console.log(`Saved JSON benchmark report to ${absOut}`);
    }
  }

  return report;
}

// CLI Entrypoint
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const args = process.argv.slice(2);
  const isQuick = args.includes("--quick");
  const scalesArg = args.find((a) => a.startsWith("--scales="));
  const jsonArg = args.find((a) => a.startsWith("--json="));

  let scales = isQuick ? [1_000, 5_000, 25_000] : [1_000, 10_000, 50_000, 100_000];
  if (scalesArg) {
    scales = scalesArg
      .split("=")[1]!
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
  }
  const reasoningScales = isQuick ? [200, 1_000, 2_500] : [250, 1_000, 2_500, 5_000];

  runTriplestoreBenchmark({
    scales,
    reasoningScales,
    jsonOutPath: jsonArg ? jsonArg.split("=")[1] : undefined,
  }).catch((err: unknown) => {
    console.error("Triplestore benchmark failed:", err);
    process.exit(1);
  });
}
