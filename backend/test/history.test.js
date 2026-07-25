import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app from "../src/app.js";
import { registerUser } from "../src/auth/auth.service.js";
import { prisma } from "../src/lib/prisma.js";

let host;
let participant;
let otherHost;
let hostCookie;
let participantCookie;
let hostQuizId;
let otherQuizId;
let finishedSessionId;
let cancelledSessionId;
let otherSessionId;

async function login(user) {
  const response = await request(app).post("/api/auth/login").send({ email: user.email, password: "password123" });
  return response.headers["set-cookie"][0].split(";")[0];
}

function finishedSessionData(quizId, hostUserId, participants = []) {
  const finishedAt = new Date();
  return {
    quizId,
    hostUserId,
    pin: null,
    status: "FINISHED",
    phase: null,
    timeLimitSeconds: 30,
    pointsPerQuestion: 1000,
    revealCorrectAnswer: true,
    startedAt: new Date(finishedAt.getTime() - 60_000),
    finishedAt,
    participants: { create: participants },
  };
}

beforeAll(async () => {
  const suffix = Date.now();
  host = await registerUser(prisma, { email: `history-host-${suffix}@example.com`, password: "password123", displayName: "History Host" });
  participant = await registerUser(prisma, { email: `history-player-${suffix}@example.com`, password: "password123", displayName: "History Player" });
  otherHost = await registerUser(prisma, { email: `history-other-${suffix}@example.com`, password: "password123", displayName: "Other Host" });
  hostCookie = await login(host);
  participantCookie = await login(participant);
  const category = await prisma.category.findFirst();
  const hostQuiz = await prisma.quiz.create({ data: { ownerUserId: host.id, categoryId: category.id, title: "Исторический квиз", defaultTimeLimitSeconds: 30, defaultPointsPerQuestion: 1000, revealCorrectAnswer: true } });
  const otherQuiz = await prisma.quiz.create({ data: { ownerUserId: otherHost.id, categoryId: category.id, title: "Чужой квиз", defaultTimeLimitSeconds: 30, defaultPointsPerQuestion: 1000, revealCorrectAnswer: true } });
  hostQuizId = hostQuiz.id;
  otherQuizId = otherQuiz.id;
  const finished = await prisma.quizSession.create({ data: finishedSessionData(hostQuizId, host.id, [{ userId: participant.id, displayNameSnapshot: participant.displayName, totalScore: 2000, correctAnswersCount: 2 }]) });
  finishedSessionId = finished.id;
  const cancelled = await prisma.quizSession.create({ data: { quizId: hostQuizId, hostUserId: host.id, pin: null, status: "CANCELLED", phase: null, timeLimitSeconds: 30, pointsPerQuestion: 1000, revealCorrectAnswer: true, cancelledAt: new Date() } });
  cancelledSessionId = cancelled.id;
  const other = await prisma.quizSession.create({ data: finishedSessionData(otherQuizId, otherHost.id) });
  otherSessionId = other.id;
});

describe("session history", () => {
  it("requires authentication", async () => {
    expect((await request(app).get("/api/me/hosted-sessions")).status).toBe(401);
  });

  it("returns only finished sessions hosted by the current user", async () => {
    const response = await request(app).get("/api/me/hosted-sessions").set("Cookie", hostCookie);
    expect(response.status).toBe(200);
    expect(response.body.data.sessions).toHaveLength(1);
    expect(response.body.data.sessions[0]).toMatchObject({ id: finishedSessionId, quizTitle: "Исторический квиз", status: "FINISHED", participantCount: 1 });
  });

  it("returns participation with persisted rank and score", async () => {
    const response = await request(app).get("/api/me/participations").set("Cookie", participantCookie);
    expect(response.status).toBe(200);
    expect(response.body.data.sessions).toHaveLength(1);
    expect(response.body.data.sessions[0]).toMatchObject({ id: finishedSessionId, rank: 1, totalScore: 2000, correctAnswersCount: 2, participantCount: 1 });
  });
});

afterAll(async () => {
  for (const id of [finishedSessionId, cancelledSessionId, otherSessionId]) if (id) await prisma.quizSession.delete({ where: { id } });
  for (const id of [hostQuizId, otherQuizId]) if (id) await prisma.quiz.delete({ where: { id } });
  for (const user of [host, participant, otherHost]) if (user) await prisma.user.delete({ where: { id: user.id } });
  await prisma.$disconnect();
});
