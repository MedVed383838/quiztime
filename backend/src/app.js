import "dotenv/config";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { createAuthRouter } from "./auth/auth.routes.js";
import { requireAuth } from "./auth/auth.middleware.js";
import { prisma } from "./lib/prisma.js";
import { createQuizRouter } from "./quiz/quiz.routes.js";

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get("/api/health", (_request, response) => {
  response.status(200).json({ data: { status: "ok" } });
});

app.use("/api/auth", createAuthRouter(prisma));
app.get("/api/categories", requireAuth(prisma), async (_request, response, next) => {
  try {
    const categories = await prisma.category.findMany({ orderBy: { name: "asc" } });
    return response.json({ data: { categories } });
  } catch (error) {
    return next(error);
  }
});
app.use("/api/quizzes", createQuizRouter(prisma));

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
