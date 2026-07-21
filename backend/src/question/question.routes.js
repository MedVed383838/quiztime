import express from "express";
import { z } from "zod";
import { requireAuth } from "../auth/auth.middleware.js";

const optionInput = z.object({ text: z.string().trim().min(1).max(300), isCorrect: z.boolean(), position: z.number().int().positive().optional() });
const questionInput = z.object({ text: z.string().trim().min(1).max(2000), imageUrl: z.string().trim().max(500).nullable().optional(), type: z.enum(["SINGLE_CHOICE", "MULTIPLE_CHOICE"]), position: z.number().int().positive().optional(), options: z.array(optionInput).min(2).max(6) });

const fail = (res, status, code, message, details = null) => res.status(status).json({ error: { code, message, details } });
const validateOptions = (data) => { const correct = data.options.filter((o) => o.isCorrect).length; return data.type === "SINGLE_CHOICE" ? correct === 1 : correct >= 2 && correct < data.options.length; };
const dto = (q) => ({ id: q.id, text: q.text, imageUrl: q.imageUrl, type: q.type, position: q.position, options: q.options.map((o) => ({ id: o.id, text: o.text, isCorrect: o.isCorrect, position: o.position })) });

export function createQuestionRouter(prisma) {
  const router = express.Router(); router.use(requireAuth(prisma));
  async function owned(id, userId) { return prisma.quiz.findFirst({ where: { id, ownerUserId: userId }, include: { _count: { select: { sessions: true, questions: true } } } }); }
  router.post("/quizzes/:quizId/questions", async (req, res, next) => {
    const quizId = Number(req.params.quizId); const parsed = questionInput.safeParse(req.body);
    if (!Number.isInteger(quizId) || !parsed.success || !validateOptions(parsed.data)) return fail(res, 400, "VALIDATION_ERROR", "Проверьте вопрос и варианты ответов", parsed.success ? null : parsed.error.issues);
    try { const quiz = await owned(quizId, req.user.id); if (!quiz) return fail(res, 404, "QUIZ_NOT_FOUND", "Квиз не найден"); if (quiz._count.sessions) return fail(res, 409, "QUIZ_ALREADY_USED", "Квиз уже использовался"); const position = parsed.data.position ?? quiz._count.questions + 1; const q = await prisma.$transaction(async (tx) => tx.question.create({ data: { quizId, text: parsed.data.text, imageUrl: parsed.data.imageUrl ?? null, type: parsed.data.type, position, options: { create: parsed.data.options.map((o, i) => ({ text: o.text, isCorrect: o.isCorrect, position: i + 1 })) } }, include: { options: { orderBy: { position: "asc" } } } })); return res.status(201).json({ data: { question: dto(q) } }); } catch (e) { return next(e); }
  });
  router.put("/questions/:questionId", async (req, res, next) => {
    const questionId = Number(req.params.questionId); const parsed = questionInput.safeParse(req.body);
    if (!Number.isInteger(questionId) || !parsed.success || !validateOptions(parsed.data)) return fail(res, 400, "VALIDATION_ERROR", "Проверьте вопрос и варианты ответов", parsed.success ? null : parsed.error.issues);
    try { const existing = await prisma.question.findUnique({ where: { id: questionId }, select: { quizId: true } }); if (!existing) return fail(res, 404, "QUESTION_NOT_FOUND", "Вопрос не найден"); const quiz = await owned(existing.quizId, req.user.id); if (!quiz) return fail(res, 404, "QUESTION_NOT_FOUND", "Вопрос не найден"); if (quiz._count.sessions) return fail(res, 409, "QUIZ_ALREADY_USED", "Квиз уже использовался"); const q = await prisma.$transaction(async (tx) => { await tx.answerOption.deleteMany({ where: { questionId } }); return tx.question.update({ where: { id: questionId }, data: { text: parsed.data.text, imageUrl: parsed.data.imageUrl ?? null, type: parsed.data.type, position: parsed.data.position ?? 1, options: { create: parsed.data.options.map((o, i) => ({ text: o.text, isCorrect: o.isCorrect, position: i + 1 })) } }, include: { options: { orderBy: { position: "asc" } } } }); }); return res.json({ data: { question: dto(q) } }); } catch (e) { return next(e); }
  });
  router.delete("/questions/:questionId", async (req, res, next) => { const id = Number(req.params.questionId); try { const q = await prisma.question.findUnique({ where: { id }, select: { quizId: true } }); if (!q) return fail(res, 404, "QUESTION_NOT_FOUND", "Вопрос не найден"); const quiz = await owned(q.quizId, req.user.id); if (!quiz) return fail(res, 404, "QUESTION_NOT_FOUND", "Вопрос не найден"); if (quiz._count.sessions) return fail(res, 409, "QUIZ_ALREADY_USED", "Квиз уже использовался"); await prisma.$transaction(async (tx) => { await tx.question.delete({ where: { id } }); const rest = await tx.question.findMany({ where: { quizId: q.quizId }, orderBy: { position: "asc" } }); for (const [i, item] of rest.entries()) await tx.question.update({ where: { id: item.id }, data: { position: i + 1 } }); }); return res.json({ data: null }); } catch (e) { return next(e); } });
  return router;
}
