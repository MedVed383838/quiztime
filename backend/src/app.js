import "dotenv/config";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { createAuthRouter } from "./auth/auth.routes.js";
import { prisma } from "./lib/prisma.js";

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get("/api/health", (_request, response) => {
  response.status(200).json({ data: { status: "ok" } });
});

app.use("/api/auth", createAuthRouter(prisma));

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "Внутренняя ошибка сервера",
      details: null,
    },
  });
});

export default app;
