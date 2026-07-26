import express from "express";
import { z } from "zod";
import { requireAuth } from "../auth/auth.middleware.js";

const optionInput = z.object({ text: z.string().trim().min(1).max(300), isCorrect: z.boolean(), position: z.number().int().positive().optional() });
const questionInput = z.object({ text: z.string().trim().min(1).max(2000), imageUrl: z.string().trim().max(500).nullable().optional(), type: z.enum(["SINGLE_CHOICE", "MULTIPLE_CHOICE"]), timeLimitSeconds: z.number().int().min(5).max(120).optional(), position: z.number().int().positive().optional(), options: z.array(optionInput).min(2).max(6) });
const fail = (res, status, code, message, details = null) => res.status(status).json({ error: { code, message, details } });
const validOptions = (data) => { const correct = data.options.filter((option) => option.isCorrect).length; return data.type === "SINGLE_CHOICE" ? correct === 1 : correct >= 2 && correct < data.options.length; };
const dto = (question) => ({ id: question.id, text: question.text, imageUrl: question.imageUrl, type: question.type, timeLimitSeconds: question.timeLimitSeconds, position: question.position, options: question.options.map((option) => ({ id: option.id, text: option.text, isCorrect: option.isCorrect, position: option.position })) });

export function createQuestionRouter(prisma) {
  const router = express.Router();
  router.use(requireAuth(prisma));
  const ownedQuiz = (id, userId) => prisma.quiz.findFirst({ where: { id, ownerUserId: userId }, include: { sessions: { select: { id: true } }, _count: { select: { questions: true } } } });

  router.post("/quizzes/:quizId/questions", async (req, res, next) => {
    const quizId = Number(req.params.quizId); const parsed = questionInput.safeParse(req.body);
    if (!Number.isInteger(quizId) || !parsed.success || !validOptions(parsed.data)) return fail(res, 400, "VALIDATION_ERROR", "Проверьте вопрос и варианты ответов", parsed.success ? null : parsed.error.issues);
    try { const quiz = await ownedQuiz(quizId, req.user.id); if (!quiz) return fail(res, 404, "QUIZ_NOT_FOUND", "Квиз не найден"); if (quiz.sessions) return fail(res, 409, "QUIZ_ALREADY_USED", "Квиз уже использовался"); const question = await prisma.question.create({ data: { quizId, text: parsed.data.text, imageUrl: parsed.data.imageUrl ?? null, type: parsed.data.type, timeLimitSeconds: parsed.data.timeLimitSeconds ?? quiz.defaultTimeLimitSeconds, position: parsed.data.position ?? quiz._count.questions + 1, options: { create: parsed.data.options.map((option, index) => ({ text: option.text, isCorrect: option.isCorrect, position: index + 1 })) } }, include: { options: { orderBy: { position: "asc" } } } }); return res.status(201).json({ data: { question: dto(question) } }); } catch (error) { return next(error); }
  });

  router.put("/questions/:questionId", async (req, res, next) => {
    const questionId = Number(req.params.questionId); const parsed = questionInput.safeParse(req.body);
    if (!Number.isInteger(questionId) || !parsed.success || !validOptions(parsed.data)) return fail(res, 400, "VALIDATION_ERROR", "Проверьте вопрос и варианты ответов", parsed.success ? null : parsed.error.issues);
    try { const existing = await prisma.question.findUnique({ where: { id: questionId }, select: { quizId: true } }); if (!existing) return fail(res, 404, "QUESTION_NOT_FOUND", "Вопрос не найден"); const quiz = await ownedQuiz(existing.quizId, req.user.id); if (!quiz) return fail(res, 404, "QUESTION_NOT_FOUND", "Вопрос не найден"); if (quiz.sessions) return fail(res, 409, "QUIZ_ALREADY_USED", "Квиз уже использовался"); const question = await prisma.$transaction(async (tx) => { await tx.answerOption.deleteMany({ where: { questionId } }); return tx.question.update({ where: { id: questionId }, data: { text: parsed.data.text, imageUrl: parsed.data.imageUrl ?? null, type: parsed.data.type, timeLimitSeconds: parsed.data.timeLimitSeconds ?? quiz.defaultTimeLimitSeconds, position: parsed.data.position ?? 1, options: { create: parsed.data.options.map((option, index) => ({ text: option.text, isCorrect: option.isCorrect, position: index + 1 })) } }, include: { options: { orderBy: { position: "asc" } } } }); }); return res.json({ data: { question: dto(question) } }); } catch (error) { return next(error); }
  });

  router.delete("/questions/:questionId", async (req, res, next) => {
    const questionId = Number(req.params.questionId);
    try { const question = await prisma.question.findUnique({ where: { id: questionId }, select: { quizId: true } }); if (!question) return fail(res, 404, "QUESTION_NOT_FOUND", "Вопрос не найден"); const quiz = await ownedQuiz(question.quizId, req.user.id); if (!quiz) return fail(res, 404, "QUESTION_NOT_FOUND", "Вопрос не найден"); if (quiz.sessions) return fail(res, 409, "QUIZ_ALREADY_USED", "Квиз уже использовался"); await prisma.$transaction(async (tx) => { await tx.question.delete({ where: { id: questionId } }); const rest = await tx.question.findMany({ where: { quizId: question.quizId }, orderBy: { position: "asc" } }); for (const [index, item] of rest.entries()) await tx.question.update({ where: { id: item.id }, data: { position: index + 1 } }); }); return res.json({ data: null }); } catch (error) { return next(error); }
  });
  return router;
}
