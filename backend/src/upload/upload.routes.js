import express from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { requireAuth } from "../auth/auth.middleware.js";

const uploadDir = path.resolve("uploads/questions"); fs.mkdirSync(uploadDir, { recursive: true });
const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
const upload = multer({ storage: multer.diskStorage({ destination: uploadDir, filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`) }), limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (_req, file, cb) => cb(null, allowed.has(file.mimetype)) });

export function createUploadRouter(prisma) { const router = express.Router(); router.use(requireAuth(prisma)); router.post("/questions", (req, res) => upload.single("image")(req, res, (error) => { if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: { code: "UPLOAD_TOO_LARGE", message: "Файл слишком большой", details: null } }); if (error || !req.file) return res.status(400).json({ error: { code: "UPLOAD_INVALID_TYPE", message: "Поддерживаются JPG, PNG и WebP", details: null } }); return res.status(201).json({ data: { imageUrl: `/uploads/questions/${req.file.filename}` } }); })); return router; }
