import { buildLeaderboard, resultForParticipant } from "./results.service.js";

export class GameError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const roomName = (sessionId) => `session:${sessionId}`;

function safeQuestion(question, questionEndsAt, totalQuestions) {
  return {
    id: question.id,
    text: question.text,
    imageUrl: question.imageUrl,
    type: question.type,
    position: question.position,
    totalQuestions,
    questionEndsAt: questionEndsAt?.toISOString() ?? null,
    options: question.options.map((option) => ({
      id: option.id,
      text: option.text,
      position: option.position,
    })),
  };
}

function sessionInclude() {
  return {
    quiz: {
      include: {
        questions: {
          orderBy: { position: "asc" },
          include: { options: { orderBy: { position: "asc" } } },
        },
      },
    },
    participants: { orderBy: { joinedAt: "asc" } },
  };
}

function resultForAnswer(answer, question, session) {
  const selectedOptionIds = answer?.selectedOptions.map((item) => item.answerOptionId) ?? [];
  const correctOptionIds = question.options.filter((option) => option.isCorrect).map((option) => option.id);
  return {
    questionId: question.id,
    selectedOptionIds,
    ...(session.revealCorrectAnswer ? { correctOptionIds } : {}),
    isCorrect: answer?.isCorrect ?? false,
    awardedPoints: answer?.awardedPoints ?? 0,
    totalScore: answer?.participant?.totalScore ?? 0,
  };
}

function finishedSnapshot(session, userId) {
  const leaderboard = buildLeaderboard(session.participants);
  const isHost = session.hostUserId === userId;
  const participant = session.participants.find((item) => item.userId === userId);
  return {
    status: "FINISHED",
    phase: null,
    leaderboard,
    myResult: isHost ? null : resultForParticipant(leaderboard, participant?.id),
  };
}

export function createGameService(prisma) {
  const timers = new Map();

  async function loadSession(sessionId) {
    return prisma.quizSession.findUnique({ where: { id: sessionId }, include: sessionInclude() });
  }

  async function getPhaseSnapshot(sessionId, userId) {
    const session = await loadSession(sessionId);
    if (!session) return null;
    if (session.status === "FINISHED") return finishedSnapshot(session, userId);
    if (!session.phase || !["QUESTION_ACTIVE", "QUESTION_REVIEW"].includes(session.phase)) return null;
    const question = session.quiz.questions[session.currentQuestionIndex];
    if (!question) return null;
    const isHost = session.hostUserId === userId;
    const participant = session.participants.find((item) => item.userId === userId);
    const base = {
      status: session.status,
      phase: session.phase,
      currentQuestion: safeQuestion(question, session.questionEndsAt, session.quiz.questions.length),
      myScore: participant?.totalScore ?? 0,
    };

    if (session.phase === "QUESTION_ACTIVE") {
      const answer = participant
        ? await prisma.participantAnswer.findUnique({
          where: { sessionParticipantId_questionId: { sessionParticipantId: participant.id, questionId: question.id } },
          include: { selectedOptions: true },
        })
        : null;
      const answeredCount = await prisma.participantAnswer.count({ where: { questionId: question.id, participant: { quizSessionId: session.id } } });
      return {
        ...base,
        hasAnswered: Boolean(answer),
        selectedOptionIds: answer?.selectedOptions.map((item) => item.answerOptionId) ?? [],
        ...(isHost ? { answeredCount } : {}),
      };
    }

    if (!isHost) {
      const answer = participant
        ? await prisma.participantAnswer.findUnique({
          where: { sessionParticipantId_questionId: { sessionParticipantId: participant.id, questionId: question.id } },
          include: { selectedOptions: true, participant: true },
        })
        : null;
      return { ...base, lastQuestionResult: resultForAnswer(answer, question, session) };
    }

    const answers = await prisma.participantAnswer.findMany({
      where: { questionId: question.id, participant: { quizSessionId: session.id } },
      include: { selectedOptions: true },
    });
    const optionStats = question.options.map((option) => ({
      optionId: option.id,
      selectedCount: answers.reduce((count, answer) => count + (answer.selectedOptions.some((item) => item.answerOptionId === option.id) ? 1 : 0), 0),
      isCorrect: option.isCorrect,
    }));
    return {
      ...base,
      reviewStats: {
        questionId: question.id,
        answeredCount: answers.length,
        correctCount: answers.filter((answer) => answer.isCorrect).length,
        optionStats,
        hasNextQuestion: session.currentQuestionIndex < session.quiz.questions.length - 1,
      },
    };
  }

  function clearTimer(sessionId) {
    const timer = timers.get(sessionId);
    if (timer) clearTimeout(timer);
    timers.delete(sessionId);
  }

  function scheduleClose(sessionId, io, deadline) {
    clearTimer(sessionId);
    const delay = Math.max(0, deadline.getTime() - Date.now());
    timers.set(sessionId, setTimeout(() => closeQuestion(sessionId, io), delay));
  }

  async function startQuestion(sessionId, userId, io) {
    const session = await loadSession(sessionId);
    if (!session) throw new GameError("SESSION_NOT_FOUND", "Сессия не найдена");
    if (session.hostUserId !== userId) throw new GameError("FORBIDDEN", "Только ведущий может запустить вопрос");
    if (session.status !== "WAITING" && session.status !== "RUNNING") throw new GameError("INVALID_SESSION_STATE", "Вопрос нельзя запустить в текущем состоянии");
    if (session.phase !== "READY_FOR_QUESTION" && session.phase !== "QUESTION_REVIEW") throw new GameError("INVALID_SESSION_STATE", "Вопрос уже запущен или закрыт");
    if (session.participants.length === 0) throw new GameError("NO_PARTICIPANTS", "Нужен хотя бы один участник");

    const nextIndex = session.currentQuestionIndex < 0 ? 0 : session.currentQuestionIndex + 1;
    const question = session.quiz.questions[nextIndex];
    if (!question) throw new GameError("NO_NEXT_QUESTION", "Следующий вопрос не найден");
    const startedAt = new Date();
    const endsAt = new Date(startedAt.getTime() + session.timeLimitSeconds * 1000);
    const updated = await prisma.quizSession.updateMany({
      where: { id: sessionId, hostUserId: userId, phase: session.phase, status: { in: ["WAITING", "RUNNING"] } },
      data: { status: "RUNNING", phase: "QUESTION_ACTIVE", currentQuestionIndex: nextIndex, questionStartedAt: startedAt, questionEndsAt: endsAt, startedAt: session.startedAt ?? startedAt },
    });
    if (updated.count !== 1) throw new GameError("INVALID_SESSION_STATE", "Вопрос уже запускается");

    scheduleClose(sessionId, io, endsAt);
    const event = { sessionId, status: "RUNNING", phase: "QUESTION_ACTIVE", currentQuestion: safeQuestion(question, endsAt, session.quiz.questions.length) };
    io.to(roomName(sessionId)).emit("question:started", event);
    return event;
  }

  async function submitAnswer({ sessionId, userId, questionId, optionIds }, io) {
    const session = await loadSession(sessionId);
    if (!session) throw new GameError("SESSION_NOT_FOUND", "Сессия не найдена");
    if (session.hostUserId === userId) throw new GameError("HOST_CANNOT_ANSWER", "Ведущий не может отвечать");
    const participant = session.participants.find((item) => item.userId === userId);
    if (!participant) throw new GameError("FORBIDDEN", "Нет доступа к сессии");
    if (session.status !== "RUNNING" || session.phase !== "QUESTION_ACTIVE") throw new GameError("INVALID_SESSION_STATE", "Ответ сейчас не принимается");
    if (!session.questionEndsAt || new Date() > session.questionEndsAt) throw new GameError("ANSWER_DEADLINE_PASSED", "Время ответа истекло");
    const question = session.quiz.questions.find((item) => item.id === questionId);
    if (!question || question.id !== session.quiz.questions[session.currentQuestionIndex]?.id) throw new GameError("QUESTION_MISMATCH", "Вопрос устарел");
    const uniqueOptionIds = [...new Set(optionIds)];
    if (uniqueOptionIds.length !== optionIds.length) throw new GameError("INVALID_OPTIONS", "Варианты ответа должны быть уникальными");
    if (question.type === "SINGLE_CHOICE" && uniqueOptionIds.length !== 1) throw new GameError("INVALID_OPTIONS", "Нужно выбрать один вариант");
    if (question.type === "MULTIPLE_CHOICE" && uniqueOptionIds.length < 1) throw new GameError("INVALID_OPTIONS", "Выберите хотя бы один вариант");
    const questionOptionIds = new Set(question.options.map((option) => option.id));
    if (uniqueOptionIds.some((optionId) => !questionOptionIds.has(optionId))) throw new GameError("INVALID_OPTIONS", "Вариант не относится к этому вопросу");

    const correctOptionIds = question.options.filter((option) => option.isCorrect).map((option) => option.id);
    const isCorrect = uniqueOptionIds.length === correctOptionIds.length && uniqueOptionIds.every((optionId) => correctOptionIds.includes(optionId));
    const now = new Date();
    const awardedPoints = isCorrect ? session.pointsPerQuestion : 0;
    try {
      await prisma.$transaction(async (tx) => {
        const existing = await tx.participantAnswer.findUnique({ where: { sessionParticipantId_questionId: { sessionParticipantId: participant.id, questionId } } });
        if (existing) throw new GameError("ANSWER_ALREADY_SUBMITTED", "Ответ уже отправлен");
        await tx.participantAnswer.create({
          data: {
            sessionParticipantId: participant.id,
            questionId,
            isCorrect,
            submittedAt: now,
            responseTimeMs: Math.max(0, now.getTime() - session.questionStartedAt.getTime()),
            awardedPoints,
            selectedOptions: { create: uniqueOptionIds.map((answerOptionId) => ({ answerOptionId })) },
          },
        });
        await tx.sessionParticipant.update({ where: { id: participant.id }, data: { totalScore: { increment: awardedPoints }, correctAnswersCount: { increment: isCorrect ? 1 : 0 } } });
      });
    } catch (error) {
      if (error instanceof GameError) throw error;
      if (error?.code === "P2002") throw new GameError("ANSWER_ALREADY_SUBMITTED", "Ответ уже отправлен");
      throw error;
    }

    const answeredCount = await prisma.participantAnswer.count({ where: { questionId, participant: { quizSessionId: sessionId } } });
    io.to(roomName(sessionId)).emit("question:progress", { answeredCount, participantCount: session.participants.length });
    return { accepted: true };
  }

  async function closeQuestion(sessionId, io) {
    const session = await loadSession(sessionId);
    if (!session || session.status !== "RUNNING" || session.phase !== "QUESTION_ACTIVE") return null;
    const question = session.quiz.questions[session.currentQuestionIndex];
    if (!question) return null;
    const closed = await prisma.quizSession.updateMany({ where: { id: sessionId, status: "RUNNING", phase: "QUESTION_ACTIVE" }, data: { phase: "QUESTION_REVIEW", questionEndsAt: null } });
    if (closed.count !== 1) return null;
    clearTimer(sessionId);
    const answers = await prisma.participantAnswer.findMany({ where: { questionId: question.id, participant: { quizSessionId: sessionId } }, include: { selectedOptions: true, participant: true } });
    const answerByUser = new Map(answers.map((answer) => [answer.participant.userId, answer]));
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.sessionId !== sessionId || socket.data.userId === session.hostUserId) continue;
      const participantAnswer = answerByUser.get(socket.data.userId);
      const participant = session.participants.find((item) => item.userId === socket.data.userId);
      const score = participantAnswer?.participant.totalScore ?? participant?.totalScore ?? 0;
      socket.emit("question:closed", { ...resultForAnswer(participantAnswer, question, session), totalScore: score });
    }
    const hostSnapshot = await getPhaseSnapshot(sessionId, session.hostUserId);
    io.sockets.sockets.forEach((socket) => {
      if (socket.data.sessionId === sessionId && socket.data.userId === session.hostUserId) socket.emit("question:review", hostSnapshot);
    });
    return hostSnapshot;
  }

  async function finishSession(sessionId, userId, io) {
    const session = await loadSession(sessionId);
    if (!session) throw new GameError("SESSION_NOT_FOUND", "Сессия не найдена");
    if (session.hostUserId !== userId) throw new GameError("FORBIDDEN", "Только ведущий может завершить игру");
    if (session.status !== "RUNNING" || session.phase !== "QUESTION_REVIEW") throw new GameError("INVALID_SESSION_STATE", "Игру можно завершить только после закрытия вопроса");
    if (session.currentQuestionIndex < session.quiz.questions.length - 1) throw new GameError("INVALID_SESSION_STATE", "Сначала завершите все вопросы");

    const finishedAt = new Date();
    const updated = await prisma.quizSession.updateMany({
      where: { id: sessionId, hostUserId: userId, status: "RUNNING", phase: "QUESTION_REVIEW" },
      data: { status: "FINISHED", phase: null, pin: null, questionStartedAt: null, questionEndsAt: null, finishedAt },
    });
    if (updated.count !== 1) throw new GameError("INVALID_SESSION_STATE", "Игра уже завершается");

    clearTimer(sessionId);
    const finishedSession = await loadSession(sessionId);
    const hostSnapshot = { sessionId, ...finishedSnapshot(finishedSession, userId) };
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.sessionId !== sessionId) continue;
      socket.emit("session:finished", { sessionId, ...finishedSnapshot(finishedSession, socket.data.userId) });
    }
    return hostSnapshot;
  }

  async function recover(io) {
    const sessions = await prisma.quizSession.findMany({ where: { status: "RUNNING", phase: "QUESTION_ACTIVE" } });
    for (const session of sessions) {
      if (session.questionEndsAt) scheduleClose(session.id, io, session.questionEndsAt);
    }
  }

  return { getPhaseSnapshot, startQuestion, submitAnswer, closeQuestion, finishSession, recover };
}
