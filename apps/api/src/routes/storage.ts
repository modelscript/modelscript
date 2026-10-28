// SPDX-License-Identifier: AGPL-3.0-or-later

import express, { Router as createRouter, type Request, type Response, type Router } from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { requireAuth } from "../middleware/auth-middleware.js";
import { pregenerateServerSvgThumbnail } from "../services/artifact-preprocessor.js";

const uploadDir = path.join(process.cwd(), "data", "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const rawExt = path.extname(file.originalname || "").toLowerCase();
    const ext = /^\.[a-z0-9]{1,16}$/.test(rawExt) ? rawExt : "";
    const safeField = (file.fieldname || "file").replace(/[^a-zA-Z0-9_-]/g, "_");
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, safeField + "-" + uniqueSuffix + ext);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB max upload size
  },
});

export function storageRouter(): Router {
  const router = createRouter();

  /**
   * Serve static uploaded files with sandboxed CSP to prevent same-origin Stored XSS
   */
  router.use(
    "/uploads",
    (_req, res, next) => {
      res.setHeader("Content-Security-Policy", "sandbox");
      res.setHeader("X-Content-Type-Options", "nosniff");
      next();
    },
    express.static(uploadDir),
  );

  /**
   * POST /api/v1/storage/upload
   */
  router.post("/upload", requireAuth, upload.single("file"), async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    // Return the URL relative to the API
    const fileUrl = `/api/v1/storage/uploads/${req.file.filename}`;
    const mimeType = req.file.mimetype;

    const lowerFilename = req.file.filename.toLowerCase();
    const originalExt = path.extname(req.file.originalname).toLowerCase();
    const checkExt = (exts: string[]) => exts.some((e) => lowerFilename.endsWith(e) || originalExt === e);
    let viewType = "other";

    const safeFilename = path.basename(req.file.path);
    const safeFilePath = path.resolve(uploadDir, safeFilename);
    let headerSnippet = "";
    if (safeFilePath.startsWith(uploadDir + path.sep)) {
      try {
        const fd = fs.openSync(safeFilePath, "r");
        const buf = Buffer.alloc(4096);
        const bytesRead = fs.readSync(fd, buf, 0, 4096, 0);
        fs.closeSync(fd);
        headerSnippet = buf.toString("utf8", 0, bytesRead);
      } catch {
        // Ignore read error for header snippet
      }
    }

    if (mimeType.startsWith("image/")) viewType = "picture";
    else if (mimeType.startsWith("video/")) viewType = "video";
    else if (mimeType.startsWith("audio/")) viewType = "audio";
    else if (mimeType === "application/pdf") viewType = "pdf";
    else if (checkExt([".step", ".stp", ".p21"])) viewType = "cad-step";
    else if (checkExt([".scad", ".csg"])) viewType = "scad";
    else if (checkExt([".usdz", ".usd", ".usda", ".gltf", ".glb"])) viewType = "3d-model";
    else if (checkExt([".csv", ".tsv"])) viewType = "csv";
    else if (checkExt([".mo", ".mos", ".msim"])) viewType = "modelica-diagram";
    else if (checkExt([".msx"])) viewType = "modelscript";
    else if (checkExt([".sysml", ".sysml2", ".kerml"])) viewType = "sysml";
    else if (checkExt([".pscx", ".pslx", ".pswx", ".psmx"])) viewType = "pscad";
    else if (checkExt([".psout"])) viewType = "psout";
    else if (checkExt([".raw", ".con", ".inl", ".seq"])) viewType = "psse";
    else if (checkExt([".opi", ".key", ".genkey", ".tpl", ".ppl", ".olga"])) viewType = "olga";
    else if (checkExt([".ez5", ".ezm", ".ezd", ".eas"])) viewType = "easy5";
    else if (checkExt([".roc", ".deck"])) viewType = "rocets";
    else if (checkExt([".lps", ".tgx", ".tlx", ".tgn", ".tln", ".psg", ".psl"])) viewType = "lps";
    else if (checkExt([".sima", ".sys", ".hyd"])) viewType = "sima";
    else if (checkExt([".gtm", ".gtd", ".gtx", ".gt"])) viewType = "gtsuite";
    else if (checkExt([".tsimf", ".runf", ".gpf", ".fresf", ".gendyn", ".calc", ".sub", ".run"])) viewType = "gensys";
    else if (checkExt([".spck", ".sbr", ".spckx", ".fbi", ".mbs"])) viewType = "simpack";
    else if (checkExt([".sim"])) {
      viewType = /\b(coupl|wheelset|kpf|func)\b/i.test(headerSnippet) ? "gensys" : "simpack";
    } else if (checkExt([".adm", ".acf", ".cmd"])) viewType = "adams";
    else if (checkExt([".arxml"])) viewType = "autosar";
    else if (checkExt([".oem", ".omm", ".opm", ".ocm", ".tdm", ".cdm"])) viewType = "ccsds";
    else if (checkExt([".idf", ".epjson"])) viewType = "energyplus";
    else if (checkExt([".epanet", ".net"])) viewType = "epanet";
    else if (checkExt([".xodr"])) viewType = "opendrive";
    else if (checkExt([".plcopen", ".st", ".iec", ".pou"])) viewType = "plcopen";
    else if (checkExt([".reqif", ".reqifz"])) viewType = "reqif";
    else if (checkExt([".slx", ".mdl"])) viewType = "simulink";
    else if (checkExt([".sp", ".cir", ".spice", ".lib"])) viewType = "spice";
    else if (checkExt([".urdf", ".sdf", ".xacro"])) viewType = "urdf";
    else if (checkExt([".va", ".vams"])) viewType = "verilog-a";
    else if (checkExt([".c", ".h"])) viewType = "c";
    else if (checkExt([".f90", ".f", ".for", ".f77", ".f95"])) viewType = "fortran";
    else if (checkExt([".inp"])) {
      if (/\[(SUBCATCHMENTS|RAINGAGES|CONDUITS|OUTFALLS)\]/i.test(headerSnippet)) {
        viewType = "swmm";
      } else if (/\[(JUNCTIONS|PIPES|RESERVOIRS|TANKS|PUMPS)\]/i.test(headerSnippet)) {
        viewType = "epanet";
      } else if (/\*(HEADING|NODE|ELEMENT|MATERIAL|STEP|BOUNDARY)/i.test(headerSnippet)) {
        viewType = "fea-deck";
      } else if (/\b(IN-UNITS|FLOWSHEET|BLOCKS|DEF-STREAMS)\b/i.test(headerSnippet)) {
        viewType = "aspen";
      } else if (/\b(CHAMBER|TURBOPUMP|NOZZLE|PROPELLANT)\b/i.test(headerSnippet)) {
        viewType = "rocets";
      } else {
        viewType = "fea-deck";
      }
    } else if (checkExt([".inpt", ".bdf"])) viewType = "fea-deck";
    else if (checkExt([".cfg", ".cfgt", ".su2"])) viewType = "cfd-config";
    else if (checkExt([".fmu"])) viewType = "fmu";
    else if (checkExt([".ssp", ".ssd"])) viewType = "ssp";
    else if (checkExt([".gcode", ".nc"])) viewType = "gcode";
    else if (checkExt([".owl", ".owl2", ".ofn", ".ttl"])) viewType = "owl2";
    else if (checkExt([".aspen", ".bkp", ".in"])) viewType = "aspen";
    else if (checkExt([".swmm"])) viewType = "swmm";
    else if (checkExt([".s1p", ".s2p", ".s3p", ".s4p", ".s5p", ".s6p", ".s8p", ".s12p", ".s16p", ".ts"]))
      viewType = "touchstone";
    else if (checkExt([".ibs", ".ibis"])) viewType = "ibis";
    else if (checkExt([".dss", ".opendss"])) viewType = "opendss";
    else if (checkExt([".xosc", ".osc"])) viewType = "openscenario";
    else if (checkExt([".r5", ".relap5"])) viewType = "relap5";
    else if (checkExt([".data", ".eclipse", ".inc"])) viewType = "eclipse";
    else if (checkExt([".sbml"])) viewType = "sbml";
    else if (checkExt([".jsbsim"])) viewType = "jsbsim";
    else if (checkExt([".xml"])) {
      if (/<REQ-IF\b/i.test(headerSnippet)) viewType = "reqif";
      else if (/<AUTOSAR\b/i.test(headerSnippet)) viewType = "autosar";
      else if (/<OpenDRIVE\b/i.test(headerSnippet)) viewType = "opendrive";
      else if (/<OpenSCENARIO\b/i.test(headerSnippet)) viewType = "openscenario";
      else if (/<sbml\b/i.test(headerSnippet)) viewType = "sbml";
      else if (/<fdm_config\b/i.test(headerSnippet)) viewType = "jsbsim";
      else if (/<(robot|sdf)\b/i.test(headerSnippet)) viewType = "urdf";
      else if (/plcopen\.org/i.test(headerSnippet)) viewType = "plcopen";
      else if (/Simpack/i.test(headerSnippet)) viewType = "simpack";
    }

    let preprocessed: {
      svg?: string;
      thumbnailUrl?: string;
      metadata?: Record<string, unknown>;
      viewConfigAdditions?: Record<string, unknown>;
    } = {};
    if (safeFilePath.startsWith(uploadDir + path.sep)) {
      try {
        preprocessed = await pregenerateServerSvgThumbnail(safeFilePath, viewType, req.file.originalname, uploadDir);
      } catch (err) {
        console.warn("[Storage] Server SVG thumbnail pre-generation skipped:", err);
      }
    }

    res.json({
      url: fileUrl,
      view_type: viewType,
      filename: req.file.originalname,
      size: req.file.size,
      mimetype: mimeType,
      thumbnail_url: preprocessed.thumbnailUrl || null,
      svg: preprocessed.svg || null,
      metadata: preprocessed.metadata || null,
      view_config_additions: preprocessed.viewConfigAdditions || null,
    });
  });

  return router;
}
