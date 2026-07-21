import express from "express";
import { z } from "zod";
import { requireAuth } from "../auth/auth.middleware.js";

const quizStatus = z.enum(["DRAFT", "READY", "ARCHIVED"]);
const quizInput = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  categoryId: z.number().int().positive(),
  defaultTimeLimitSeconds: z.number().int().min(5).max(120),
  defaultPointsPerQuestion: z.number().int().min(100).max(5000),
  revealCorrectAnswer: z.boolean(),
});

function error(response, status, code, message, details = null) {
  return response.status(status).json({ error: { code, message, details } });
}

function summary(quiz) {
  return {
    id: quiz.id,
    title: quiz.title,
    status: quiz.status,
    category: quiz.category,
    questionCount: quiz._count?.questions ?? 0,
    defaultTimeLimitSeconds: quiz.defaultTimeLimitSeconds,
    defaultPointsPerQuestion: quiz.defaultPointsPerQuestion,
    revealCorrectAnswer: quiz.revealCorrectAnswer,
    createdAt: quiz.createdAt.toISOString(),
    updatedAt: quiz.updatedAt.toISOString(),
  };
}

const summaryInclude = { category: true, _count: { select: { questions: true } } };

export function createQuizRouter(prisma) {
  const router = express.Router();
  router.use(requireAuth(prisma));

  router.get("/", async (request, response, next) => {
    try {
      const status = request.query.status;
      if (status && !quizStatus.safeParse(status).success) return error(response, 400, "VALIDATION_ERROR", "Недопустимый статус квиза");
      const quizzes = await prisma.quiz.findMany({
        where: { ownerUserId: request.user.id, ...(status ? { status } : {}) },
        include: summaryInclude,
        orderBy: { updatedAt: "desc" },
      });
      return response.json({ data: { quizzes: quizzes.map(summary) } });
    } catch (requestError) { return next(requestError); }
  });

  router.post("/", async (request, response, next) => {
    const parsed = quizInput.safeParse(request.body);
    if (!parsed.success) return error(response, 400, "VALIDATION_ERROR", "Проверьте данные квиза", parsed.error.issues);
    try {
      const category = await prisma.category.findUnique({ where: { id: parsed.data.categoryId } });
      if (!category) return error(response, 404, "CATEGORY_NOT_FOUND", "Категория не найдена");
      const quiz = await prisma.quiz.create({
        data: { ...parsed.data, description: parsed.data.description ?? null, ownerUserId: request.user.id },
        include: summaryInclude,
      });
      return response.status(201).json({ data: { quiz: summary(quiz) } });
    } catch (requestError) { return next(requestError); }
  });

  router.get("/:quizId", async (request, response, next) => {
    const quizId = Number(request.params.quizId);
    if (!Number.isInteger(quizId)) return error(response, 400, "VALIDATION_ERROR", "Некорректный quizId");
    try {
      const quiz = await prisma.quiz.findFirst({
        where: { id: quizId, ownerUserId: request.user.id },
        include: { category: true, questions: { include: { options: true }, orderBy: { position: "asc" } }, _count: { select: { questions: true, sessions: true } } },
      });
      if (!quiz) return error(response, 404, "QUIZ_NOT_FOUND", "Квиз не найден");
      return response.json({ data: { quiz: { ...summary(quiz), description: quiz.description, categoryId: quiz.categoryId, isLocked: quiz._count.sessions > 0, questions: quiz.questions } } });
    } catch (requestError) { return next(requestError); }
  });

  router.put("/:quizId", async (request, response, next) => {
    const quizId = Number(request.params.quizId);
    const parsed = quizInput.safeParse(request.body);
    if (!Number.isInteger(quizId) || !parsed.success) return error(response, 400, "VALIDATION_ERROR", "Проверьте данные квиза", parsed.success ? null : parsed.error.issues);
    try {
      const existing = await prisma.quiz.findFirst({ where: { id: quizId, ownerUserId: request.user.id }, include: { _count: { select: { sessions: true } } } });
      if (!existing) return error(response, 404, "QUIZ_NOT_FOUND", "Квиз не найден");
      if (existing._count.sessions > 0) return error(response, 409, "QUIZ_ALREADY_USED", "Квиз уже использовался в игровой сессии");
      const category = await prisma.category.findUnique({ where: { id: parsed.data.categoryId } });
      if (!category) return error(response, 404, "CATEGORY_NOT_FOUND", "Категория не найдена");
      const quiz = await prisma.quiz.update({ where: { id: quizId }, data: { ...parsed.data, description: parsed.data.description ?? null }, include: summaryInclude });
      return response.json({ data: { quiz: summary(quiz) } });
    } catch (requestError) { return next(requestError); }
  });

  router.delete("/:quizId", async (request, response, next) => {
    const quizId = Number(request.params.quizId);
    if (!Number.isInteger(quizId)) return error(response, 400, "VALIDATION_ERROR", "Некорректный quizId");
    try {
      const quiz = await prisma.quiz.findFirst({ where: { id: quizId, ownerUserId: request.user.id }, include: { _count: { select: { sessions: true } } } });
      if (!quiz) return error(response, 404, "QUIZ_NOT_FOUND", "Квиз не найден");
      if (quiz._count.sessions > 0) return error(response, 409, "QUIZ_ALREADY_USED", "Квиз уже использовался в игровой сессии");
      await prisma.quiz.delete({ where: { id: quizId } });
      return response.json({ data: null });
    } catch (requestError) { return next(requestError); }
  });

  router.post("/:quizId/ready", async (request, response, next) => {
    const quizId = Number(request.params.quizId);
    try {
      const quiz = await prisma.quiz.findFirst({ where: { id: quizId, ownerUserId: request.user.id }, include: { questions: { include: { options: true } }, _count: { select: { sessions: true } } } });
      if (!quiz) return error(response, 404, "QUIZ_NOT_FOUND", "Квиз не найден");
      if (quiz._count.sessions > 0) return error(response, 409, "QUIZ_ALREADY_USED", "Квиз уже использовался в игровой сессии");
      const valid = quiz.questions.length > 0 && quiz.questions.every((question) => {
        const correct = question.options.filter((option) => option.isCorrect).length;
        return question.options.length >= 2 && question.options.length <= 6 && (question.type === "SINGLE_CHOICE" ? correct === 1 : correct >= 2 && correct < question.options.length);
      });
      if (!valid) return error(response, 400, "QUIZ_INVALID", "Квиз не соответствует требованиям готовности");
      const updated = await prisma.quiz.update({ where: { id: quizId }, data: { status: "READY" }, include: summaryInclude });
      return response.json({ data: { quiz: summary(updated) } });
    } catch (requestError) { return next(requestError); }
  });

  router.post("/:quizId/archive", async (request, response, next) => {
    const quizId = Number(request.params.quizId);
    try {
      const quiz = await prisma.quiz.findFirst({ where: { id: quizId, ownerUserId: request.user.id } });
      if (!quiz) return error(response, 404, "QUIZ_NOT_FOUND", "Квиз не найден");
      const updated = await prisma.quiz.update({ where: { id: quizId }, data: { status: "ARCHIVED" }, include: summaryInclude });
      return response.json({ data: { quiz: summary(updated) } });
    } catch (requestError) { return next(requestError); }
  });

  return router;
}
