import express from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import { buildLeaderboard, resultForParticipant } from "../session/results.service.js";

function sessionSummary(session) {
  return {
    id: session.id,
    quizId: session.quizId,
    quizTitle: session.quiz.title,
    status: session.status,
    participantCount: session.participants.length,
    startedAt: session.startedAt?.toISOString() ?? null,
    finishedAt: session.finishedAt?.toISOString() ?? null,
  };
}

export function createHistoryRouter(prisma) {
  const router = express.Router();
  router.use(requireAuth(prisma));

  router.get("/hosted-sessions", async (request, response, next) => {
    try {
      const sessions = await prisma.quizSession.findMany({
        where: { hostUserId: request.user.id, status: "FINISHED" },
        include: { quiz: true, participants: true },
        orderBy: { finishedAt: "desc" },
      });
      return response.json({ data: { sessions: sessions.map(sessionSummary) } });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/participations", async (request, response, next) => {
    try {
      const participations = await prisma.sessionParticipant.findMany({
        where: { userId: request.user.id, session: { status: "FINISHED" } },
        include: { session: { include: { quiz: true, participants: true } } },
        orderBy: { session: { finishedAt: "desc" } },
      });
      const sessions = participations.map((participation) => {
        const leaderboard = buildLeaderboard(participation.session.participants);
        const result = resultForParticipant(leaderboard, participation.id);
        return {
          ...sessionSummary(participation.session),
          rank: result.rank,
          totalScore: result.totalScore,
          correctAnswersCount: result.correctAnswersCount,
        };
      });
      return response.json({ data: { sessions } });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
