import express, { Router as createRouter, type Request, type Response, type Router } from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { requireAuth } from "../middleware/auth-middleware.js";

const uploadDir = path.join(process.cwd(), "data", "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
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
  router.post("/upload", requireAuth, upload.single("file"), (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    // Return the URL relative to the API
    const fileUrl = `/api/v1/storage/uploads/${req.file.filename}`;
    const mimeType = req.file.mimetype;

    // Basic heuristic to determine the artifact view type
    let viewType = "other";
    if (mimeType.startsWith("image/")) viewType = "picture";
    else if (mimeType.startsWith("video/")) viewType = "video";
    else if (mimeType.startsWith("audio/")) viewType = "audio";
    else if (mimeType === "application/pdf") viewType = "pdf";
    else if (req.file.filename.toLowerCase().endsWith(".step") || req.file.filename.toLowerCase().endsWith(".stp"))
      viewType = "cad-step";
    else if (req.file.filename.toLowerCase().endsWith(".csv")) viewType = "simulation-plot";
    else if (req.file.filename.toLowerCase().endsWith(".mo")) viewType = "modelica-code";

    res.json({
      url: fileUrl,
      view_type: viewType,
      filename: req.file.originalname,
      size: req.file.size,
      mimetype: mimeType,
    });
  });

  return router;
}
