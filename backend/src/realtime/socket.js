import { Server } from "socket.io";
import { z } from "zod";
import { COOKIE_NAME, verifyToken } from "../auth/auth.service.js";
import { createGameService, GameError } from "../session/game.service.js";

export let realtimeIo = null;

function readCookie(header, name) {
  const item = header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
}

function socketKey(sessionId, userId) {
  return `${sessionId}:${userId}`;
}

function participantDto(participant, activeSockets, sessionId) {
  return {
    id: participant.id,
    displayName: participant.displayNameSnapshot,
    isConnected: activeSockets.has(socketKey(sessionId, participant.userId)),
    joinedAt: participant.joinedAt.toISOString(),
  };
}

export function createSocketServer(httpServer, prisma) {
  const io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
  });
  const activeSockets = new Map();
  const gameService = createGameService(prisma);
  const sessionPayload = z.object({ sessionId: z.number().int().positive() });
  const answerPayload = sessionPayload.extend({ questionId: z.number().int().positive(), optionIds: z.array(z.number().int().positive()).max(6) });
  const errorAck = (error) => ({ ok: false, error: { code: error instanceof GameError ? error.code : "INTERNAL_ERROR", message: error.message ?? "Ошибка сессии" } });

  io.use(async (socket, next) => {
    try {
      const token = readCookie(socket.handshake.headers.cookie, COOKIE_NAME);
      if (!token) return next(new Error("UNAUTHORIZED"));
      const payload = verifyToken(token);
      const userId = Number(payload.sub);
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) return next(new Error("UNAUTHORIZED"));
      socket.data.userId = user.id;
      return next();
    } catch {
      return next(new Error("UNAUTHORIZED"));
    }
  });

  io.on("connection", (socket) => {
    socket.emit("auth:ready", { userId: socket.data.userId });

    socket.on("session:subscribe", async (payload, ack = () => {}) => {
      try {
        const sessionId = Number(payload?.sessionId);
        const session = await prisma.quizSession.findUnique({
          where: { id: sessionId },
          include: { quiz: true, host: true, participants: { orderBy: { joinedAt: "asc" } } },
        });
        if (!session) return ack({ ok: false, error: { code: "SESSION_NOT_FOUND", message: "Сессия не найдена" } });

        const isHost = session.hostUserId === socket.data.userId;
        const participant = session.participants.find((item) => item.userId === socket.data.userId);
        if (!isHost && !participant) return ack({ ok: false, error: { code: "FORBIDDEN", message: "Нет доступа к сессии" } });

        const key = socketKey(session.id, socket.data.userId);
        if (socket.data.socketKey && socket.data.socketKey !== key && activeSockets.get(socket.data.socketKey) === socket) {
          activeSockets.delete(socket.data.socketKey);
        }
        const previousSocket = activeSockets.get(key);
        if (previousSocket && previousSocket !== socket) {
          previousSocket.data.replaced = true;
          previousSocket.disconnect(true);
        }

        if (participant) {
          await prisma.sessionParticipant.update({
            where: { id: participant.id },
            data: { disconnectedAt: null },
          });
        }

        activeSockets.set(key, socket);
        socket.data.socketKey = key;
        socket.data.sessionId = session.id;
        socket.join(`session:${session.id}`);

        const snapshot = {
          sessionId: session.id,
          status: session.status,
          phase: session.phase,
          isHost,
          pin: isHost ? session.pin : undefined,
          quizTitle: session.quiz.title,
          participantCount: session.participants.length,
          participants: session.participants.map((item) => participantDto(item, activeSockets, session.id)),
          hostDisplayName: isHost ? undefined : session.host.displayName,
          myScore: participant?.totalScore ?? 0,
        };
        const phaseSnapshot = await gameService.getPhaseSnapshot(session.id, socket.data.userId);
        return ack({ ok: true, data: { ...snapshot, ...(phaseSnapshot ?? {}) } });
      } catch {
        return ack({ ok: false, error: { code: "INTERNAL_ERROR", message: "Ошибка сессии" } });
      }
    });

    socket.on("question:start", async (payload, ack = () => {}) => {
      const parsed = sessionPayload.safeParse(payload);
      if (!parsed.success) return ack({ ok: false, error: { code: "VALIDATION_ERROR", message: "Некорректный sessionId" } });
      try {
        const data = await gameService.startQuestion(parsed.data.sessionId, socket.data.userId, io);
        return ack({ ok: true, data });
      } catch (error) {
        return ack(errorAck(error));
      }
    });

    socket.on("answer:submit", async (payload, ack = () => {}) => {
      const parsed = answerPayload.safeParse(payload);
      if (!parsed.success) return ack({ ok: false, error: { code: "VALIDATION_ERROR", message: "Некорректный ответ" } });
      try {
        const data = await gameService.submitAnswer({ ...parsed.data, userId: socket.data.userId }, io);
        return ack({ ok: true, data });
      } catch (error) {
        return ack(errorAck(error));
      }
    });

    socket.on("disconnect", async () => {
      const key = socket.data.socketKey;
      if (!key || activeSockets.get(key) !== socket) return;
      activeSockets.delete(key);
      if (!socket.data.sessionId || socket.data.replaced) return;

      await prisma.sessionParticipant.updateMany({
        where: { quizSessionId: socket.data.sessionId, userId: socket.data.userId },
        data: { disconnectedAt: new Date() },
      }).catch(() => {});
      const participants = await prisma.sessionParticipant.findMany({
        where: { quizSessionId: socket.data.sessionId },
        orderBy: { joinedAt: "asc" },
      }).catch(() => []);
      io.to(`session:${socket.data.sessionId}`).emit("participant:list", {
        participants: participants.map((item) => participantDto(item, activeSockets, socket.data.sessionId)),
      });
    });
  });
  realtimeIo = io;
  void gameService.recover(io).catch(() => {});

  return io;
}
