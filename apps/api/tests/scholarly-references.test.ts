// SPDX-License-Identifier: AGPL-3.0-or-later

import jwt from "jsonwebtoken";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";
import request from "supertest";

process.env["NODE_ENV"] = "test";
process.env["OPENALEX_LIVE_FETCH"] = "0";

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { JWT_SECRET } from "../src/middleware/auth-middleware.js";

test("OpenAlex Dedicated SQLite + FTS5 Engine, S3 Partition Manager, URN Source Resolution & Citations", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scholarly-references-test-"));
  const db = new LibraryDatabase(tmpDir);
  const app = createApp({ database: db });

  t.after(() => {
    try {
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  const user = db.createUser("researcher", "researcher@modelscript.test", "hash_pw", {
    accountType: "admin",
  });
  assert.ok(user);
  db.updateProfile(user.id, { display_name: "Dr. Ada Lovelace" });
  const sessionToken = jwt.sign(
    { id: user.id, username: user.username, email: user.email, accountType: "admin", role: "admin" },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
  const nonAdminUser = db.createUser("student", "student@modelscript.test", "hash_pw");
  const nonAdminToken = jwt.sign(
    { id: nonAdminUser.id, username: nonAdminUser.username, email: nonAdminUser.email, accountType: "user" },
    JWT_SECRET,
    { expiresIn: "1h" },
  );

  await t.test(
    "Dedicated openalex.db starts with 0 works and 0 loaded partitions by default (no preseeded works)",
    async () => {
      assert.ok(db.openalexDbPath.endsWith("openalex.db"), "openalex.db should be a separate database file");
      assert.notEqual(db.openalexDbPath, path.join(tmpDir, "modelscript.db"));
      assert.ok(fs.existsSync(db.openalexDbPath), "openalex.db file should exist on disk");

      const statusRes = await request(app).get("/api/v1/references/s3-sync/status");
      assert.equal(statusRes.status, 200);
      assert.equal(statusRes.body.mode, "self-hosted-s3-sqlite-fts5");
      assert.equal(statusRes.body.fts5Enabled, true);
      assert.equal(statusRes.body.paidRestApiForwarded, false);
      assert.equal(statusRes.body.catalogStats.totalWorks, 0, "openalex.db must default to 0 works at startup");
      assert.equal(statusRes.body.catalogStats.loadedPartitionsCount, 0, "0 partitions loaded at startup");
      assert.equal(statusRes.body.ftsIndexedCount, 0, "FTS5 index starts empty");

      const emptySearch = await request(app).get("/api/v1/references/search").query({ q: "Pantelides" });
      assert.equal(emptySearch.status, 200);
      assert.equal(emptySearch.body.works.length, 0);
    },
  );

  await t.test(
    "Admin S3 Partition Manager syncs manifest (unloaded by default) and selectively loads partitions into openalex.db + FTS5",
    async () => {
      const { parseOpenAlexS3Manifest, s3UriToHttpsUrl } = await import("../src/services/openalex.js");

      assert.equal(
        s3UriToHttpsUrl("s3://openalex/data/works/updated_date=2025-01-15/part_000.gz"),
        "https://openalex.s3.amazonaws.com/data/works/updated_date=2025-01-15/part_000.gz",
      );

      const parsedManifest = parseOpenAlexS3Manifest({
        entries: [
          {
            url: "s3://openalex/data/works/updated_date=2025-01-15/part_000.gz",
            meta: { content_length: 1048576, record_count: 2500 },
          },
        ],
        meta: { content_length: 1048576, record_count: 2500 },
      });
      assert.equal(parsedManifest.totalPartitions, 1);
      assert.equal(parsedManifest.totalRecordCount, 2500);

      // 1. Sync S3 manifest into openalex_s3_partitions (all partitions remain 'unloaded')
      const syncRes = await request(app)
        .post("/api/v1/references/s3-sync/manifest/sync")
        .set("Authorization", `Bearer ${sessionToken}`)
        .send({ entity: "works", limit: 10 });
      assert.equal(syncRes.status, 200);
      assert.ok(syncRes.body.syncedCount >= 1);
      assert.ok(Array.isArray(syncRes.body.partitions));
      assert.ok(
        syncRes.body.partitions.every((p: any) => p.status === "unloaded"),
        "Newly synced S3 partitions must default to status='unloaded'",
      );

      // 2. Build a gzipped OpenAlex S3 partition file containing foundational works and load it via /s3-sync/partitions/load
      const partitionWorks = [
        {
          id: "https://openalex.org/W2108598243",
          doi: "https://doi.org/10.1137/0909014",
          title: "The Consistent Initialization of Differential-Algebraic Systems",
          publication_year: 1988,
          publication_date: "1988-03-01",
          type: "article",
          cited_by_count: 1420,
          open_access: {
            is_oa: true,
            oa_status: "green",
            oa_url: "https://epubs.siam.org/doi/pdf/10.1137/0909014",
          },
          primary_location: {
            is_oa: true,
            landing_page_url: "https://doi.org/10.1137/0909014",
            pdf_url: "https://epubs.siam.org/doi/pdf/10.1137/0909014",
            source: { display_name: "SIAM Journal on Scientific and Statistical Computing", type: "journal" },
          },
          authorships: [
            {
              author: { display_name: "Constantinos C. Pantelides", id: "https://openalex.org/A5012345678" },
              institutions: [{ display_name: "Imperial College London", country_code: "GB" }],
            },
          ],
          topics: [
            { display_name: "Differential-algebraic system of equations", score: 0.99 },
            { display_name: "Index reduction", score: 0.97 },
          ],
          abstract_inverted_index: {
            Consistent: [0],
            initialization: [1],
            of: [2],
            differential: [3],
            algebraic: [4],
            equation: [5],
            systems: [6],
            via: [7],
            structural: [8],
            graph: [9],
            differentiation: [10],
          },
        },
        {
          id: "https://openalex.org/W2153579005",
          doi: "https://doi.org/10.2172/5882821",
          title: "A Description of DASSL: A Differential/Algebraic System Solver",
          publication_year: 1982,
          publication_date: "1982-09-01",
          type: "report",
          cited_by_count: 2890,
          open_access: {
            is_oa: true,
            oa_status: "green",
            oa_url: "https://www.osti.gov/servlets/purl/5882821",
          },
          primary_location: {
            is_oa: true,
            landing_page_url: "https://doi.org/10.2172/5882821",
            pdf_url: "https://www.osti.gov/servlets/purl/5882821",
            source: { display_name: "Sandia National Laboratories", type: "repository" },
          },
          authorships: [
            {
              author: { display_name: "Linda R. Petzold", id: "https://openalex.org/A5023456789" },
              institutions: [{ display_name: "Sandia National Laboratories", country_code: "US" }],
            },
          ],
        },
        {
          id: "https://openalex.org/W2963403868",
          doi: "https://doi.org/10.48550/arXiv.1706.03762",
          ids: {
            openalex: "https://openalex.org/W2963403868",
            doi: "https://doi.org/10.48550/arXiv.1706.03762",
            arxiv: "https://arxiv.org/abs/1706.03762",
          },
          title: "Attention Is All You Need",
          publication_year: 2017,
          publication_date: "2017-06-12",
          type: "article",
          cited_by_count: 118500,
          open_access: {
            is_oa: true,
            oa_status: "green",
            oa_url: "https://arxiv.org/pdf/1706.03762.pdf",
          },
          primary_location: {
            is_oa: true,
            landing_page_url: "https://arxiv.org/abs/1706.03762",
            pdf_url: "https://arxiv.org/pdf/1706.03762.pdf",
            source: { display_name: "Advances in Neural Information Processing Systems (NeurIPS)", type: "conference" },
          },
          authorships: [
            {
              author: { display_name: "Ashish Vaswani", id: "https://openalex.org/A5034567890" },
              institutions: [{ display_name: "Google Brain", country_code: "US" }],
            },
          ],
        },
        {
          id: "https://openalex.org/W9988776655",
          doi: "https://doi.org/10.1137/24M123456",
          title: "Symplectic Partitioned Runge-Kutta Integrators for Multibody DAE Systems",
          publication_year: 2024,
          publication_date: "2024-06-15",
          type: "article",
          cited_by_count: 48,
          open_access: { is_oa: true, oa_status: "gold", oa_url: "https://epubs.siam.org/pdf/10.1137/24M123456" },
          primary_location: {
            is_oa: true,
            landing_page_url: "https://doi.org/10.1137/24M123456",
            pdf_url: "https://epubs.siam.org/pdf/10.1137/24M123456",
            source: { display_name: "SIAM Journal on Numerical Analysis", type: "journal" },
          },
          authorships: [
            {
              author: { display_name: "Ernst Hairer", id: "https://openalex.org/A5000000001" },
              institutions: [{ display_name: "University of Geneva", country_code: "CH" }],
            },
            {
              author: { display_name: "Gerhard Wanner", id: "https://openalex.org/A5000000002" },
              institutions: [{ display_name: "University of Geneva", country_code: "CH" }],
            },
          ],
          abstract_inverted_index: {
            Symplectic: [0],
            integration: [1],
            of: [2],
            constrained: [3],
            mechanical: [4],
            systems: [5],
          },
        },
        {
          id: "https://openalex.org/W1122334455",
          title: "Uncited Draft Note",
          publication_year: 2024,
          type: "article",
          cited_by_count: 0,
        },
      ];

      const gzPath = path.join(tmpDir, "part_000.gz");
      const jsonlPayload = partitionWorks.map((w) => JSON.stringify(w)).join("\n") + "\n";
      fs.writeFileSync(gzPath, zlib.gzipSync(jsonlPayload));

      const targetS3Url = "s3://openalex/data/works/updated_date=2026-03-15/part_000.gz";
      const loadRes = await request(app)
        .post("/api/v1/references/s3-sync/partitions/load")
        .set("Authorization", `Bearer ${sessionToken}`)
        .send({
          s3Urls: [targetS3Url],
          localFilePath: gzPath,
          minCitedByCount: 10,
        });
      assert.equal(loadRes.status, 201);
      assert.equal(loadRes.body.loadedPartitions, 1);
      assert.equal(loadRes.body.totalImportedWorks, 4);
      assert.equal(loadRes.body.results[0].scannedCount, 5);
      assert.equal(loadRes.body.results[0].importedCount, 4);
      assert.equal(loadRes.body.results[0].skippedCount, 1);

      // Verify status reflects 1 loaded partition and 4 FTS5-indexed works
      const statusAfterLoad = await request(app).get("/api/v1/references/s3-sync/status");
      assert.equal(statusAfterLoad.status, 200);
      assert.equal(statusAfterLoad.body.catalogStats.totalWorks, 4);
      assert.equal(statusAfterLoad.body.catalogStats.loadedPartitionsCount, 1);
      assert.equal(statusAfterLoad.body.ftsIndexedCount, 4);
    },
  );

  await t.test(
    "GET /api/v1/references/search and /facets support FTS5 BM25 ranking and browsing by Topic, Author, Venue & Year",
    async () => {
      const res = await request(app).get("/api/v1/references/search").query({ q: "Pantelides initialization" });
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.works));
      assert.ok(res.body.works.length >= 1);
      const pantelides = res.body.works.find((w: any) => w.urn === "urn:openalex:W2108598243");
      assert.ok(pantelides, "Pantelides (1988) DAE initialization paper should be matched via FTS5");
      assert.equal(pantelides.publicationYear, 1988);
      assert.equal(pantelides.doi, "10.1137/0909014");
      assert.ok(Array.isArray(pantelides.pdfLocations) && pantelides.pdfLocations.length >= 1);

      // Filter by author
      const byAuthor = await request(app).get("/api/v1/references/search").query({ author: "Ernst Hairer" });
      assert.equal(byAuthor.status, 200);
      assert.equal(byAuthor.body.works.length, 1);
      assert.equal(byAuthor.body.works[0].urn, "urn:openalex:W9988776655");

      // Filter by topic
      const byTopic = await request(app).get("/api/v1/references/search").query({ topic: "Index reduction" });
      assert.equal(byTopic.status, 200);
      assert.equal(byTopic.body.works.length, 1);
      assert.equal(byTopic.body.works[0].urn, "urn:openalex:W2108598243");

      // Filter by venue
      const byVenue = await request(app).get("/api/v1/references/search").query({ venue: "NeurIPS" });
      assert.equal(byVenue.status, 200);
      assert.equal(byVenue.body.works.length, 1);
      assert.equal(byVenue.body.works[0].urn, "urn:openalex:W2963403868");

      // Fetch aggregated facets (Topics, Authors, Venues, Years)
      const facetsRes = await request(app).get("/api/v1/references/facets");
      assert.equal(facetsRes.status, 200);
      assert.ok(Array.isArray(facetsRes.body.topics));
      assert.ok(facetsRes.body.topics.some((t: any) => t.name === "Index reduction"));
      assert.ok(Array.isArray(facetsRes.body.authors));
      assert.ok(facetsRes.body.authors.some((a: any) => a.name === "Constantinos C. Pantelides"));
      assert.ok(Array.isArray(facetsRes.body.venues));
      assert.ok(facetsRes.body.venues.length >= 3);
      assert.ok(Array.isArray(facetsRes.body.years));
      assert.ok(facetsRes.body.years.some((y: any) => y.year === 1988));
    },
  );

  await t.test(
    "GET /api/v1/sources/resolve resolves OpenAlex URN, DOI URN, and ArXiv URN with full formatted citations and exports",
    async () => {
      // 1. Resolve by OpenAlex URN
      const resOpenAlex = await request(app).get("/api/v1/sources/resolve").query({ urn: "urn:openalex:W2108598243" });
      assert.equal(resOpenAlex.status, 200);
      assert.equal(resOpenAlex.body.work.urn, "urn:openalex:W2108598243");
      assert.ok(resOpenAlex.body.citations.apa.includes("1988"));
      assert.ok(resOpenAlex.body.citations.mla.includes("Pantelides"));
      assert.ok(resOpenAlex.body.citations.ieee.includes("[1]"));
      assert.ok(resOpenAlex.body.exports.bibtex.includes("@article{"));
      assert.ok(resOpenAlex.body.exports.ris.includes("TY  - "));
      assert.ok(resOpenAlex.body.exports.cff.includes("cff-version: 1.2.0"));
      assert.ok(resOpenAlex.body.exports.enw.includes("%0 "));

      // 2. Resolve by DOI URN
      const resDoi = await request(app).get("/api/v1/sources/resolve").query({ urn: "urn:doi:10.1137/0909014" });
      assert.equal(resDoi.status, 200);
      assert.equal(resDoi.body.work.urn, "urn:openalex:W2108598243");

      // 3. Resolve by ArXiv URN (Attention Is All You Need)
      const resArxiv = await request(app).get("/api/v1/sources/resolve").query({ urn: "urn:arxiv:1706.03762" });
      assert.equal(resArxiv.status, 200);
      assert.equal(resArxiv.body.work.urn, "urn:openalex:W2963403868");
      assert.ok(resArxiv.body.work.title.includes("Attention Is All You Need"));
      assert.ok(resArxiv.body.work.pdfLocations.some((loc: any) => loc.url.includes("arxiv.org/pdf/1706.03762")));
    },
  );

  await t.test(
    "POST /api/v1/references/local-pdf attaches a local instance PDF to a source in openalex.db",
    async () => {
      const res = await request(app)
        .post("/api/v1/references/local-pdf")
        .set("Authorization", `Bearer ${sessionToken}`)
        .send({
          urn: "urn:openalex:W2153579005",
          localPdfUrl: "/api/v1/references/local-pdf/dassl-petzold-1982.pdf",
        });
      assert.equal(res.status, 200);
      assert.equal(res.body.work.localPdfUrl, "/api/v1/references/local-pdf/dassl-petzold-1982.pdf");
      assert.ok(
        res.body.work.pdfLocations.some(
          (loc: any) => loc.isLocal === true && loc.url === "/api/v1/references/local-pdf/dassl-petzold-1982.pdf",
        ),
      );
    },
  );

  await t.test(
    "Personal Reference Library, Collections CRUD, BibTeX/RIS import, and multi-format export across modelscript.db and openalex.db",
    async () => {
      // 1. Create a collection
      const colRes = await request(app)
        .post("/api/v1/references/collections")
        .set("Authorization", `Bearer ${sessionToken}`)
        .send({
          name: "DAE Solvers & Co-Simulation",
          description: "Core numerical integration and FMI papers",
          color: "#06b6d4",
        });
      assert.equal(colRes.status, 201);
      const collectionId = colRes.body.collection.id;
      assert.ok(collectionId);

      // 2. Save a work to library inside the collection
      const saveRes = await request(app)
        .post("/api/v1/references/library")
        .set("Authorization", `Bearer ${sessionToken}`)
        .send({
          urn: "urn:openalex:W2108598243",
          collectionId,
          readingStatus: "reading",
          rating: 5,
          notes: "Essential algorithm for structural index reduction in ModelScript.",
          isFavorite: true,
        });
      assert.equal(saveRes.status, 201);
      const itemId = saveRes.body.item.id;
      assert.ok(itemId);

      // 3. List library items
      const listRes = await request(app)
        .get("/api/v1/references/library")
        .set("Authorization", `Bearer ${sessionToken}`)
        .query({ collectionId });
      assert.equal(listRes.status, 200);
      assert.equal(listRes.body.items.length, 1);
      assert.equal(listRes.body.items[0].readingStatus, "reading");
      assert.equal(listRes.body.items[0].rating, 5);
      assert.equal(listRes.body.items[0].isFavorite, true);

      // 4. Import BibTeX entry
      const sampleBibtex = `
@article{cellier1991continuous,
  title = {Continuous System Modeling},
  author = {Francois E. Cellier},
  year = {1991},
  journal = {Springer-Verlag},
  doi = {10.1007/978-1-4757-3922-0},
  url = {https://doi.org/10.1007/978-1-4757-3922-0}
}
`;
      const importRes = await request(app)
        .post("/api/v1/references/import")
        .set("Authorization", `Bearer ${sessionToken}`)
        .send({
          content: sampleBibtex,
          format: "bibtex",
          addToLibrary: true,
          collectionId,
        });
      assert.equal(importRes.status, 201);
      assert.equal(importRes.body.importedCount, 1);
      assert.equal(importRes.body.works[0].title, "Continuous System Modeling");

      // 5. Batch export in BibTeX & RIS
      const exportBibRes = await request(app)
        .get("/api/v1/citations/export")
        .query({ urns: "urn:openalex:W2108598243,urn:doi:10.1007/978-1-4757-3922-0", format: "bibtex" });
      assert.equal(exportBibRes.status, 200);
      assert.ok(exportBibRes.text.includes("Pantelides"));
      assert.ok(exportBibRes.text.includes("Continuous System Modeling"));
    },
  );

  await t.test(
    "Posts containing textual citations automatically index into post_citations and resolve backlinks + Ansatz post URN",
    async () => {
      const postRes = await request(app)
        .post("/api/v1/social/posts")
        .set("Authorization", `Bearer ${sessionToken}`)
        .send({
          content:
            "Implementing Pantelides index reduction [@urn:openalex:W2108598243] alongside FMI 2.0 co-simulation [@doi:10.3384/ecp12076173]!",
        });
      assert.equal(postRes.status, 201);
      const postId = postRes.body.post?.id ?? postRes.body.id;
      assert.ok(postId);

      // Verify backlink on the cited OpenAlex work's source resolution payload
      const sourceRes = await request(app).get("/api/v1/sources/resolve").query({ urn: "urn:openalex:W2108598243" });
      assert.equal(sourceRes.status, 200);
      assert.ok(Array.isArray(sourceRes.body.citedByPosts));
      assert.ok(
        sourceRes.body.citedByPosts.some((p: any) => Number(p.postId) === Number(postId)),
        "Resolved source page payload should list the Ansatz post that cited it",
      );

      // Verify resolving the Ansatz post itself as a citation URN (urn:ansatz:post:<id>)
      const postUrnRes = await request(app)
        .get("/api/v1/sources/resolve")
        .query({ urn: `urn:ansatz:post:${postId}` });
      assert.equal(postUrnRes.status, 200);
      assert.equal(postUrnRes.body.work.urn, `urn:ansatz:post:${postId}`);
      assert.ok(
        postUrnRes.body.citations.apa.includes("Lovelace") || postUrnRes.body.citations.apa.includes("researcher"),
      );

      // Verify resolving the Ansatz post does NOT insert it into openalex.db (scholarly_works)
      const openalexPostCheck = (db as any).openalexDb
        .prepare("SELECT count(*) as cnt FROM scholarly_works WHERE urn LIKE 'urn:ansatz:%'")
        .get() as { cnt: number };
      assert.equal(openalexPostCheck.cnt, 0, "Ansatz entities must never be inserted into openalex.db");
    },
  );

  await t.test(
    "POST /api/v1/references/s3-sync/fts-optimize and /s3-sync/partitions/unload evicts partition works cleanly",
    async () => {
      const optRes = await request(app)
        .post("/api/v1/references/s3-sync/fts-optimize")
        .set("Authorization", `Bearer ${sessionToken}`)
        .send({});
      assert.equal(optRes.status, 200);
      assert.equal(optRes.body.ok, true);
      assert.ok(optRes.body.ftsIndexedCount >= 4);

      // Non-admin user must be rejected with 403
      const forbiddenUnload = await request(app)
        .post("/api/v1/references/s3-sync/partitions/unload")
        .set("Authorization", `Bearer ${nonAdminToken}`)
        .send({ unloadAll: true });
      assert.equal(forbiddenUnload.status, 403);

      const targetS3Url = "s3://openalex/data/works/updated_date=2026-03-15/part_000.gz";
      const unloadRes = await request(app)
        .post("/api/v1/references/s3-sync/partitions/unload")
        .set("Authorization", `Bearer ${sessionToken}`)
        .send({ s3Urls: [targetS3Url] });
      assert.equal(unloadRes.status, 200);
      assert.equal(unloadRes.body.removedWorks, 4);

      const partAfter = unloadRes.body.partitions.find((p: any) => p.s3Url === targetS3Url);
      assert.ok(partAfter);
      assert.equal(partAfter.status, "unloaded");
      assert.equal(partAfter.importedCount, 0);
    },
  );

  await t.test(
    "Flagship Dev Mode: downloads, caches locally, and preloads OpenAlex S3 first slice into openalex.db",
    async () => {
      const { preloadOpenAlexS3Slice, getOpenAlexCacheDirectory } = await import("../src/services/openalex.js");

      // Verify status includes cache metadata
      const statusRes = await request(app).get("/api/v1/references/s3-sync/status");
      assert.equal(statusRes.status, 200);
      assert.ok(typeof statusRes.body.openalexCacheDir === "string");
      assert.ok(typeof statusRes.body.cachedPartitionsCount === "number");

      // Unload all previous works to test fresh preload
      await request(app)
        .post("/api/v1/references/s3-sync/partitions/unload")
        .set("Authorization", `Bearer ${sessionToken}`)
        .send({ unloadAll: true });

      // 1. Preload first slice via endpoint
      const preloadRes = await request(app)
        .post("/api/v1/references/s3-sync/preload-first-slice")
        .set("Authorization", `Bearer ${sessionToken}`)
        .send({ maxRecords: 50 });

      assert.equal(preloadRes.status, 200);
      assert.ok(
        preloadRes.body.status === "preloaded" || preloadRes.body.status === "fallback_loaded",
        `Expected preloaded or fallback_loaded status, got ${preloadRes.body.status}`,
      );
      assert.ok(preloadRes.body.importedCount > 0, "Should have imported works");
      assert.ok(preloadRes.body.totalWorks > 0, "Database should contain works");
      assert.ok(preloadRes.body.cachedFilePath, "Should record local cached file path");
      assert.ok(fs.existsSync(preloadRes.body.cachedFilePath), "Local cache file must exist on disk");

      // 2. Second call without force should skip (already_loaded)
      const secondCall = await request(app)
        .post("/api/v1/references/s3-sync/preload-first-slice")
        .set("Authorization", `Bearer ${sessionToken}`)
        .send({});

      assert.equal(secondCall.status, 200);
      assert.equal(secondCall.body.status, "already_loaded");
      assert.equal(secondCall.body.importedCount, 0);

      // 3. Status endpoint now reflects cached partitions and works in openalex.db
      const updatedStatus = await request(app).get("/api/v1/references/s3-sync/status");
      assert.equal(updatedStatus.status, 200);
      assert.ok(updatedStatus.body.catalogStats.totalWorks > 0);
      assert.ok(updatedStatus.body.cachedPartitionsCount >= 1);
      assert.ok(updatedStatus.body.cachedPartitionsSizeBytes > 0);

      // 4. Force reload should read directly from the cached file (fromCache = true)
      const forceReload = await preloadOpenAlexS3Slice(db, {
        force: true,
        maxRecords: 50,
      });
      assert.ok(forceReload.status === "preloaded" || forceReload.status === "fallback_loaded");
      assert.equal(forceReload.fromCache, true, "Should load from local disk cache without re-downloading");
    },
  );
});
