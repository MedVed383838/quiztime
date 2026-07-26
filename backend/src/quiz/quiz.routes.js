import express from "express";
import { z } from "zod";
import { requireAuth } from "../auth/auth.middleware.js";

const quizStatus = z.enum(["DRAFT", "READY", "ARCHIVED"]);
const quizInput = z.object({ title: z.string().trim().min(1).max(120), description: z.string().trim().max(2000).nullable().optional(), categoryId: z.number().int().positive(), defaultTimeLimitSeconds: z.number().int().min(5).max(120), defaultPointsPerQuestion: z.number().int().min(100).max(5000), revealCorrectAnswer: z.boolean() });
const fail = (res, status, code, message, details = null) => res.status(status).json({ error: { code, message, details } });
const summaryInclude = { category: true, _count: { select: { questions: true } }, sessions: { select: { id: true, status: true } } };

function summary(quiz) {
  const activeSession = ["WAITING", "RUNNING"].includes(quiz.sessions?.status) ? quiz.sessions : null;
  return { id: quiz.id, title: quiz.title, status: quiz.status, category: quiz.category, questionCount: quiz._count?.questions ?? 0, defaultTimeLimitSeconds: quiz.defaultTimeLimitSeconds, defaultPointsPerQuestion: quiz.defaultPointsPerQuestion, revealCorrectAnswer: quiz.revealCorrectAnswer, activeSession: activeSession ? { id: activeSession.id, status: activeSession.status } : null, createdAt: quiz.createdAt.toISOString(), updatedAt: quiz.updatedAt.toISOString() };
}

export function createQuizRouter(prisma) {
  const router = express.Router();
  router.use(requireAuth(prisma));

  router.get("/", async (req, res, next) => {
    const status = req.query.status;
    if (status && !quizStatus.safeParse(status).success) return fail(res, 400, "VALIDATION_ERROR", "Недопустимый статус квиза");
    try { const quizzes = await prisma.quiz.findMany({ where: { ownerUserId: req.user.id, ...(status ? { status } : {}) }, include: summaryInclude, orderBy: { updatedAt: "desc" } }); return res.json({ data: { quizzes: quizzes.map(summary) } }); } catch (error) { return next(error); }
  });

  router.post("/", async (req, res, next) => {
    const parsed = quizInput.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "VALIDATION_ERROR", "Проверьте данные квиза", parsed.error.issues);
    try {
      const category = await prisma.category.findUnique({ where: { id: parsed.data.categoryId } });
      if (!category) return fail(res, 404, "CATEGORY_NOT_FOUND", "Категория не найдена");
      const quiz = await prisma.quiz.create({ data: { ...parsed.data, description: parsed.data.description ?? null, ownerUserId: req.user.id }, include: summaryInclude });
      return res.status(201).json({ data: { quiz: summary(quiz) } });
    } catch (error) { return next(error); }
  });

  router.get("/:quizId", async (req, res, next) => {
    const quizId = Number(req.params.quizId);
    if (!Number.isInteger(quizId)) return fail(res, 400, "VALIDATION_ERROR", "Некорректный quizId");
    try {
      const quiz = await prisma.quiz.findFirst({ where: { id: quizId, ownerUserId: req.user.id }, include: { category: true, questions: { include: { options: true }, orderBy: { position: "asc" } }, _count: { select: { questions: true } }, sessions: { select: { id: true, status: true } } } });
      if (!quiz) return fail(res, 404, "QUIZ_NOT_FOUND", "Квиз не найден");
      return res.json({ data: { quiz: { ...summary(quiz), description: quiz.description, categoryId: quiz.categoryId, isLocked: Boolean(quiz.sessions), questions: quiz.questions } } });
    } catch (error) { return next(error); }
  });

  router.put("/:quizId", async (req, res, next) => {
    const quizId = Number(req.params.quizId); const parsed = quizInput.safeParse(req.body);
    if (!Number.isInteger(quizId) || !parsed.success) return fail(res, 400, "VALIDATION_ERROR", "Проверьте данные квиза", parsed.success ? null : parsed.error.issues);
    try {
      const existing = await prisma.quiz.findFirst({ where: { id: quizId, ownerUserId: req.user.id }, include: { sessions: { select: { id: true } } } });
      if (!existing) return fail(res, 404, "QUIZ_NOT_FOUND", "Квиз не найден");
      if (existing.sessions) return fail(res, 409, "QUIZ_ALREADY_USED", "Квиз уже использовался в игровой сессии");
      const category = await prisma.category.findUnique({ where: { id: parsed.data.categoryId } });
      if (!category) return fail(res, 404, "CATEGORY_NOT_FOUND", "Категория не найдена");
      const quiz = await prisma.quiz.update({ where: { id: quizId }, data: { ...parsed.data, description: parsed.data.description ?? null }, include: summaryInclude });
      return res.json({ data: { quiz: summary(quiz) } });
    } catch (error) { return next(error); }
  });

  router.delete("/:quizId", async (req, res, next) => {
    const quizId = Number(req.params.quizId);
    if (!Number.isInteger(quizId)) return fail(res, 400, "VALIDATION_ERROR", "Некорректный quizId");
    try { const quiz = await prisma.quiz.findFirst({ where: { id: quizId, ownerUserId: req.user.id }, include: { sessions: { select: { id: true } } } }); if (!quiz) return fail(res, 404, "QUIZ_NOT_FOUND", "Квиз не найден"); if (quiz.sessions) return fail(res, 409, "QUIZ_ALREADY_USED", "Квиз уже использовался в игровой сессии"); await prisma.quiz.delete({ where: { id: quizId } }); return res.json({ data: null }); } catch (error) { return next(error); }
  });

  router.post("/:quizId/ready", async (req, res, next) => {
    const quizId = Number(req.params.quizId);
    try {
      const quiz = await prisma.quiz.findFirst({ where: { id: quizId, ownerUserId: req.user.id }, include: { questions: { include: { options: true } }, sessions: { select: { id: true } } } });
      if (!quiz) return fail(res, 404, "QUIZ_NOT_FOUND", "Квиз не найден");
      if (quiz.sessions) return fail(res, 409, "QUIZ_ALREADY_USED", "Квиз уже использовался в игровой сессии");
      const valid = quiz.questions.length > 0 && quiz.questions.every((question) => { const correct = question.options.filter((option) => option.isCorrect).length; return question.options.length >= 2 && question.options.length <= 6 && (question.type === "SINGLE_CHOICE" ? correct === 1 : correct >= 2 && correct < question.options.length); });
      if (!valid) return fail(res, 400, "QUIZ_INVALID", "Квиз не соответствует требованиям готовности");
      const updated = await prisma.quiz.update({ where: { id: quizId }, data: { status: "READY" }, include: summaryInclude });
      return res.json({ data: { quiz: summary(updated) } });
    } catch (error) { return next(error); }
  });

  router.post("/:quizId/archive", async (req, res, next) => {
    const quizId = Number(req.params.quizId);
    try { const quiz = await prisma.quiz.findFirst({ where: { id: quizId, ownerUserId: req.user.id } }); if (!quiz) return fail(res, 404, "QUIZ_NOT_FOUND", "Квиз не найден"); const updated = await prisma.quiz.update({ where: { id: quizId }, data: { status: "ARCHIVED" }, include: summaryInclude }); return res.json({ data: { quiz: summary(updated) } }); } catch (error) { return next(error); }
  });
  return router;
}
