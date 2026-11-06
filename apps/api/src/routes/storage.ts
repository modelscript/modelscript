// SPDX-License-Identifier: AGPL-3.0-or-later

import express, { Router as createRouter, type Request, type Response, type Router } from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { requireAuth } from "../middleware/auth-middleware.js";
import {
  pregenerateServerSvgThumbnail,
  type PreprocessOptions,
  preprocessPdfFile,
} from "../services/artifact-preprocessor.js";

const uploadDir =
  process.env["UPLOAD_DIR"] ||
  (process.env["DATA_DIR"]
    ? path.join(process.env["DATA_DIR"], "uploads")
    : path.join(process.cwd(), "data", "uploads"));

if (!fs.existsSync(uploadDir)) {
  try {
    fs.mkdirSync(uploadDir, { recursive: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
      console.warn(`[storage] Warning: could not create upload directory '${uploadDir}':`, err);
    }
  }
}

/** Only accept a plain (dotted) Modelica identifier path as a class hint; anything else is ignored. */
const CLASS_HINT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

function preprocessOptionsFromBody(body: unknown): PreprocessOptions {
  const raw = body && typeof body === "object" ? (body as Record<string, unknown>)["primary_class"] : undefined;
  if (typeof raw === "string" && raw.length <= 200 && CLASS_HINT_PATTERN.test(raw)) {
    return { primaryClass: raw };
  }
  return {};
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
   * Serve static uploaded files with sandboxed CSP to prevent same-origin Stored XSS.
   * Also lazily backfills .pdf.thumb.png and .pdf.meta.json for existing uploaded PDFs.
   */
  router.use(
    "/uploads",
    (req, res, next) => {
      res.setHeader("X-Content-Type-Options", "nosniff");

      const reqBase = path.basename(req.path || "");
      const lowerBase = reqBase.toLowerCase();

      if (lowerBase.endsWith(".pdf")) {
        // Chromium disables PDF plugins in sandboxed contexts.
        // For PDFs, serve inline without sandbox directive so the native PDF reader can load,
        // but restrict script and plugin execution via Content-Security-Policy.
        res.setHeader("Content-Disposition", "inline");
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'none'; script-src 'none'; object-src 'none'; style-src 'unsafe-inline'",
        );
      } else {
        res.setHeader("Content-Security-Policy", "sandbox");
      }
      if (lowerBase.endsWith(".pdf.thumb.png") || lowerBase.endsWith(".pdf.meta.json")) {
        const resolvedDir = path.resolve(uploadDir);
        const targetPath = path.resolve(resolvedDir, reqBase);
        if (targetPath.startsWith(resolvedDir + path.sep) && !fs.existsSync(targetPath)) {
          const suffixLen = lowerBase.endsWith(".pdf.thumb.png") ? ".thumb.png".length : ".meta.json".length;
          const pdfFilename = reqBase.slice(0, reqBase.length - suffixLen);
          const pdfPath = path.resolve(resolvedDir, path.basename(pdfFilename));
          if (pdfPath.startsWith(resolvedDir + path.sep) && fs.existsSync(pdfPath)) {
            try {
              preprocessPdfFile(pdfPath, pdfFilename, resolvedDir);
            } catch {
              // Ignore on-demand generation error
            }
          }
        }
      }

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

        // 1. Prohibit executable binaries
        const isPeExe = bytesRead >= 2 && buf[0] === 0x4d && buf[1] === 0x5a; // MZ
        const isElf = bytesRead >= 4 && buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46; // .ELF
        const isMachO =
          bytesRead >= 4 &&
          ((buf[0] === 0xfe && buf[1] === 0xed && buf[2] === 0xfa && (buf[3] === 0xce || buf[3] === 0xcf)) ||
            (buf[3] === 0xfe && buf[2] === 0xed && buf[1] === 0xfa && (buf[0] === 0xce || buf[0] === 0xcf)));
        if (isPeExe || isElf || isMachO) {
          try {
            fs.unlinkSync(safeFilePath);
          } catch {}
          res.status(400).json({ error: "Executable binaries (.exe, .elf, Mach-O) are strictly prohibited" });
          return;
        }

        // 2. Validate declared documents and images against known magic bytes
        if (originalExt === ".pdf" || mimeType === "application/pdf") {
          if (bytesRead < 4 || buf.toString("ascii", 0, 4) !== "%PDF") {
            try {
              fs.unlinkSync(safeFilePath);
            } catch {}
            res.status(400).json({ error: "Invalid PDF format: missing %PDF header" });
            return;
          }
        } else if (originalExt === ".png" || mimeType === "image/png") {
          if (
            bytesRead < 8 ||
            buf[0] !== 0x89 ||
            buf[1] !== 0x50 ||
            buf[2] !== 0x4e ||
            buf[3] !== 0x47 ||
            buf[4] !== 0x0d ||
            buf[5] !== 0x0a ||
            buf[6] !== 0x1a ||
            buf[7] !== 0x0a
          ) {
            try {
              fs.unlinkSync(safeFilePath);
            } catch {}
            res.status(400).json({ error: "Invalid PNG format: invalid magic header" });
            return;
          }
        } else if (
          originalExt === ".jpg" ||
          originalExt === ".jpeg" ||
          mimeType === "image/jpeg" ||
          mimeType === "image/jpg"
        ) {
          if (bytesRead < 3 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) {
            try {
              fs.unlinkSync(safeFilePath);
            } catch {}
            res.status(400).json({ error: "Invalid JPEG format: invalid magic header" });
            return;
          }
        }
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
    else if (checkExt([".qif", ".qif.xml"])) viewType = "qif";
    else if (checkExt([".oscal", ".oscal.json", ".oscal.yaml", ".oscal.yml", ".oscal.xml"])) viewType = "oscal";
    else if (checkExt([".aml", ".caex"])) viewType = "automationml";
    else if (checkExt([".xml"])) {
      if (/<REQ-IF\b/i.test(headerSnippet)) viewType = "reqif";
      else if (/<QIFDocument\b/i.test(headerSnippet)) viewType = "qif";
      else if (/<CAEXFile\b/i.test(headerSnippet)) viewType = "automationml";
      else if (
        /<(catalog|profile|system-security-plan|component-definition|assessment-plan|assessment-results|plan-of-action-and-milestones)\b/i.test(
          headerSnippet,
        )
      )
        viewType = "oscal";
      else if (/<AUTOSAR\b/i.test(headerSnippet)) viewType = "autosar";
      else if (/<OpenDRIVE\b/i.test(headerSnippet)) viewType = "opendrive";
      else if (/<OpenSCENARIO\b/i.test(headerSnippet)) viewType = "openscenario";
      else if (/<sbml\b/i.test(headerSnippet)) viewType = "sbml";
      else if (/<fdm_config\b/i.test(headerSnippet)) viewType = "jsbsim";
      else if (/<(robot|sdf)\b/i.test(headerSnippet)) viewType = "urdf";
      else if (/plcopen\.org/i.test(headerSnippet)) viewType = "plcopen";
      else if (/Simpack/i.test(headerSnippet)) viewType = "simpack";
      else viewType = "dataset-table";
    } else if (checkExt([".json"])) {
      viewType =
        /"(catalog|profile|system-security-plan|component-definition|assessment-plan|assessment-results|plan-of-action-and-milestones)"\s*:/i.test(
          headerSnippet,
        )
          ? "oscal"
          : "json-table";
    } else if (checkExt([".yaml", ".yml"])) {
      viewType =
        /^\s*(catalog|profile|system-security-plan|component-definition|assessment-plan|assessment-results|plan-of-action-and-milestones)\s*:/m.test(
          headerSnippet,
        )
          ? "oscal"
          : "dataset-table";
    } else if (checkExt([".h5", ".hdf5"])) {
      viewType = "dataset-table";
    }

    let preprocessed: {
      svg?: string;
      thumbnailUrl?: string;
      metadata?: Record<string, unknown>;
      viewConfigAdditions?: Record<string, unknown>;
    } = {};
    if (safeFilePath.startsWith(uploadDir + path.sep)) {
      try {
        preprocessed = await pregenerateServerSvgThumbnail(
          safeFilePath,
          viewType,
          req.file.originalname,
          uploadDir,
          preprocessOptionsFromBody(req.body),
        );
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
