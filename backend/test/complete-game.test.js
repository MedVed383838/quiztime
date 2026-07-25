import { createServer } from "node:http";
import request from "supertest";
import { io as createClient } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app from "../src/app.js";
import { registerUser } from "../src/auth/auth.service.js";
import { prisma } from "../src/lib/prisma.js";
import { createSocketServer } from "../src/realtime/socket.js";
import { buildLeaderboard } from "../src/session/results.service.js";

let owner;
let firstPlayer;
let secondPlayer;
let latePlayer;
let quizId;
let sessionId;
let ownerCookie;
let firstPlayerCookie;
let secondPlayerCookie;
let latePlayerCookie;
let firstCorrectOptionId;
let secondCorrectOptionId;
let httpServer;
let ioServer;
let port;
let hostSocket;
let firstPlayerSocket;
let secondPlayerSocket;

function connect(cookie) {
  const socket = createClient(`http://localhost:${port}`, { extraHeaders: { Cookie: cookie } });
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

function waitFor(socket, event, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), timeout);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function login(user) {
  const response = await request(app).post("/api/auth/login").send({ email: user.email, password: "password123" });
  return response.headers["set-cookie"][0].split(";")[0];
}

beforeAll(async () => {
  const suffix = Date.now();
  owner = await registerUser(prisma, { email: `complete-owner-${suffix}@example.com`, password: "password123", displayName: "Complete Owner" });
  firstPlayer = await registerUser(prisma, { email: `complete-first-${suffix}@example.com`, password: "password123", displayName: "First Player" });
  secondPlayer = await registerUser(prisma, { email: `complete-second-${suffix}@example.com`, password: "password123", displayName: "Second Player" });
  latePlayer = await registerUser(prisma, { email: `complete-late-${suffix}@example.com`, password: "password123", displayName: "Late Player" });
  ownerCookie = await login(owner);
  firstPlayerCookie = await login(firstPlayer);
  secondPlayerCookie = await login(secondPlayer);
  latePlayerCookie = await login(latePlayer);

  const category = await prisma.category.findFirst();
  const quiz = await request(app).post("/api/quizzes").set("Cookie", ownerCookie).send({ title: "Complete game", categoryId: category.id, defaultTimeLimitSeconds: 5, defaultPointsPerQuestion: 1000, revealCorrectAnswer: true });
  quizId = quiz.body.data.quiz.id;
  const firstQuestion = await request(app).post(`/api/quizzes/${quizId}/questions`).set("Cookie", ownerCookie).send({ text: "Первый вопрос", type: "SINGLE_CHOICE", options: [{ text: "Первый правильный", isCorrect: true }, { text: "Первый неверный", isCorrect: false }] });
  const secondQuestion = await request(app).post(`/api/quizzes/${quizId}/questions`).set("Cookie", ownerCookie).send({ text: "Второй вопрос", type: "SINGLE_CHOICE", options: [{ text: "Второй правильный", isCorrect: true }, { text: "Второй неверный", isCorrect: false }] });
  firstCorrectOptionId = firstQuestion.body.data.question.options.find((option) => option.isCorrect).id;
  secondCorrectOptionId = secondQuestion.body.data.question.options.find((option) => option.isCorrect).id;
  await request(app).post(`/api/quizzes/${quizId}/ready`).set("Cookie", ownerCookie);
  const session = await request(app).post("/api/sessions").set("Cookie", ownerCookie).send({ quizId });
  sessionId = session.body.data.session.id;
  await request(app).post(`/api/sessions/${sessionId}/join`).set("Cookie", firstPlayerCookie);
  await request(app).post(`/api/sessions/${sessionId}/join`).set("Cookie", secondPlayerCookie);
  httpServer = createServer(app);
  ioServer = createSocketServer(httpServer, prisma);
  await new Promise((resolve) => httpServer.listen(0, resolve));
  port = httpServer.address().port;
});

describe("complete realtime game flow", () => {
  it("plays all questions, rejects late join, finishes and restores results", async () => {
    hostSocket = await connect(ownerCookie);
    firstPlayerSocket = await connect(firstPlayerCookie);
    secondPlayerSocket = await connect(secondPlayerCookie);
    const hostSnapshot = await emitAck(hostSocket, "session:subscribe", { sessionId });
    const firstSnapshot = await emitAck(firstPlayerSocket, "session:subscribe", { sessionId });
    const secondSnapshot = await emitAck(secondPlayerSocket, "session:subscribe", { sessionId });
    expect(hostSnapshot.ok).toBe(true);
    expect(firstSnapshot.data.participants).toHaveLength(2);
    expect(secondSnapshot.data.isHost).toBe(false);

    const startedFirst = await emitAck(hostSocket, "question:start", { sessionId });
    expect(startedFirst.ok).toBe(true);
    expect(startedFirst.data.currentQuestion.position).toBe(1);
    expect(startedFirst.data.currentQuestion.options[0]).not.toHaveProperty("isCorrect");
    const firstQuestionId = startedFirst.data.currentQuestion.id;
    const lateJoin = await request(app).post(`/api/sessions/${sessionId}/join`).set("Cookie", latePlayerCookie);
    expect(lateJoin.status).toBe(409);
    const firstReview = waitFor(hostSocket, "question:review");
    const firstClosed = waitFor(firstPlayerSocket, "question:closed");
    const secondClosed = waitFor(secondPlayerSocket, "question:closed");
    await emitAck(firstPlayerSocket, "answer:submit", { sessionId, questionId: firstQuestionId, optionIds: [firstCorrectOptionId] });
    await emitAck(secondPlayerSocket, "answer:submit", { sessionId, questionId: firstQuestionId, optionIds: [startedFirst.data.currentQuestion.options[1].id] });
    expect((await firstClosed).isCorrect).toBe(true);
    expect((await secondClosed).isCorrect).toBe(false);
    const firstReviewSnapshot = await firstReview;
    expect(firstReviewSnapshot.reviewStats.hasNextQuestion).toBe(true);
    expect(firstReviewSnapshot.reviewStats.optionStats.find((item) => item.optionId === firstCorrectOptionId).isCorrect).toBe(true);
    expect(firstReviewSnapshot.reviewStats.optionStats.find((item) => item.optionId !== firstCorrectOptionId).isCorrect).toBe(false);

    const startedSecond = await emitAck(hostSocket, "question:start", { sessionId });
    expect(startedSecond.ok).toBe(true);
    expect(startedSecond.data.currentQuestion.position).toBe(2);
    const secondQuestionId = startedSecond.data.currentQuestion.id;
    const secondReview = waitFor(hostSocket, "question:review");
    const secondFirstClosed = waitFor(firstPlayerSocket, "question:closed");
    const secondSecondClosed = waitFor(secondPlayerSocket, "question:closed");
    await emitAck(firstPlayerSocket, "answer:submit", { sessionId, questionId: secondQuestionId, optionIds: [startedSecond.data.currentQuestion.options[1].id] });
    await emitAck(secondPlayerSocket, "answer:submit", { sessionId, questionId: secondQuestionId, optionIds: [secondCorrectOptionId] });
    expect((await secondFirstClosed).isCorrect).toBe(false);
    expect((await secondSecondClosed).isCorrect).toBe(true);
    expect((await secondReview).reviewStats.hasNextQuestion).toBe(false);

    const hostFinished = waitFor(hostSocket, "session:finished");
    const firstFinished = waitFor(firstPlayerSocket, "session:finished");
    const secondFinished = waitFor(secondPlayerSocket, "session:finished");
    const finished = await emitAck(hostSocket, "session:finish", { sessionId });
    expect(finished).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ status: "FINISHED", phase: null }) }));
    expect((await hostFinished).myResult).toBeNull();
    expect((await firstFinished).myResult.rank).toBe(1);
    expect((await secondFinished).myResult.rank).toBe(1);

    const results = await request(app).get(`/api/sessions/${sessionId}/results`).set("Cookie", firstPlayerCookie);
    expect(results.status).toBe(200);
    expect(results.body.data.leaderboard.map((item) => item.rank)).toEqual([1, 1]);
    expect(results.body.data.myResult.totalScore).toBe(1000);

    const reconnected = await connect(firstPlayerCookie);
    const finishedSnapshot = await emitAck(reconnected, "session:subscribe", { sessionId });
    expect(finishedSnapshot.data.status).toBe("FINISHED");
    expect(finishedSnapshot.data.leaderboard).toHaveLength(2);
    reconnected.close();
  }, 25000);
});

describe("leaderboard ranking", () => {
  it("uses competition ranks for ties", () => {
    const joinedAt = new Date("2026-01-01T00:00:00.000Z");
    const participants = [
      { id: 1, displayNameSnapshot: "One", totalScore: 3000, correctAnswersCount: 3, joinedAt },
      { id: 2, displayNameSnapshot: "Two", totalScore: 2000, correctAnswersCount: 2, joinedAt },
      { id: 3, displayNameSnapshot: "Three", totalScore: 2000, correctAnswersCount: 2, joinedAt },
      { id: 4, displayNameSnapshot: "Four", totalScore: 1000, correctAnswersCount: 1, joinedAt },
    ];
    expect(buildLeaderboard(participants).map((item) => item.rank)).toEqual([1, 2, 2, 4]);
  });
});

afterAll(async () => {
  secondPlayerSocket?.close();
  firstPlayerSocket?.close();
  hostSocket?.close();
  ioServer?.close();
  if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
  if (sessionId) await prisma.quizSession.delete({ where: { id: sessionId } });
  if (quizId) await prisma.quiz.delete({ where: { id: quizId } });
  for (const user of [owner, firstPlayer, secondPlayer, latePlayer]) if (user) await prisma.user.delete({ where: { id: user.id } });
  await prisma.$disconnect();
});
