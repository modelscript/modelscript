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
    const ext = path.extname(file.originalname);
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + "-" + uniqueSuffix + ext);
  },
});

const upload = multer({ storage });

export function storageRouter(): Router {
  const router = createRouter();

  /**
   * Serve static uploaded files
   */
  router.use("/uploads", express.static(uploadDir));

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

    if (mimeType.startsWith("image/")) viewType = "picture";
    else if (mimeType.startsWith("video/")) viewType = "video";
    else if (mimeType.startsWith("audio/")) viewType = "audio";
    else if (mimeType === "application/pdf") viewType = "pdf";
    else if (checkExt([".step", ".stp", ".p21"])) viewType = "cad-step";
    else if (checkExt([".usdz", ".usd", ".usda", ".gltf", ".glb"])) viewType = "3d-model";
    else if (checkExt([".csv", ".tsv"])) viewType = "simulation-plot";
    else if (checkExt([".mo", ".mos", ".msim"])) viewType = "modelica-code";
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
    else if (checkExt([".inp", ".inpt", ".bdf"])) viewType = "fea-deck";
    else if (checkExt([".cfg", ".cfgt", ".su2"])) viewType = "cfd-config";
    else if (checkExt([".fmu"])) viewType = "fmu";
    else if (checkExt([".ssp", ".ssd"])) viewType = "ssp";
    else if (checkExt([".gcode", ".nc"])) viewType = "gcode";
    else if (checkExt([".owl", ".owl2", ".ofn", ".ttl"])) viewType = "owl2";

    let preprocessed: {
      svg?: string;
      thumbnailUrl?: string;
      metadata?: Record<string, unknown>;
      viewConfigAdditions?: Record<string, unknown>;
    } = {};
    try {
      preprocessed = await pregenerateServerSvgThumbnail(req.file.path, viewType, req.file.originalname, uploadDir);
    } catch (err) {
      console.warn("[Storage] Server SVG thumbnail pre-generation skipped:", err);
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
