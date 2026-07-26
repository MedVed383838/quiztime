import { createServer } from "node:http";
import request from "supertest";
import { io as createClient } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app from "../src/app.js";
import { registerUser } from "../src/auth/auth.service.js";
import { prisma } from "../src/lib/prisma.js";
import { createSocketServer } from "../src/realtime/socket.js";

let owner;
let player;
let quizId;
let sessionId;
let questionId;
let correctOptionId;
let ownerCookie;
let playerCookie;
let httpServer;
let ioServer;
let port;
let hostSocket;
let playerSocket;

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

beforeAll(async () => {
  owner = await registerUser(prisma, { email: `game-owner-${Date.now()}@example.com`, password: "password123", displayName: "Game Owner" });
  player = await registerUser(prisma, { email: `game-player-${Date.now()}@example.com`, password: "password123", displayName: "Game Player" });
  const ownerLogin = await request(app).post("/api/auth/login").send({ email: owner.email, password: "password123" });
  const playerLogin = await request(app).post("/api/auth/login").send({ email: player.email, password: "password123" });
  ownerCookie = ownerLogin.headers["set-cookie"][0].split(";")[0];
  playerCookie = playerLogin.headers["set-cookie"][0].split(";")[0];

  const category = await prisma.category.findFirst();
  const quiz = await request(app).post("/api/quizzes").set("Cookie", ownerCookie).send({ title: "Realtime game", categoryId: category.id, defaultTimeLimitSeconds: 5, defaultPointsPerQuestion: 1000, revealCorrectAnswer: true });
  quizId = quiz.body.data.quiz.id;
  const question = await request(app).post(`/api/quizzes/${quizId}/questions`).set("Cookie", ownerCookie).send({ text: "Какой вариант правильный?", type: "SINGLE_CHOICE", timeLimitSeconds: 5, options: [{ text: "Правильный", isCorrect: true }, { text: "Другой", isCorrect: false }] });
  questionId = question.body.data.question.id;
  correctOptionId = question.body.data.question.options.find((option) => option.isCorrect).id;
  await request(app).post(`/api/quizzes/${quizId}/ready`).set("Cookie", ownerCookie);
  const session = await request(app).post("/api/sessions").set("Cookie", ownerCookie).send({ quizId });
  sessionId = session.body.data.session.id;
  await request(app).post(`/api/sessions/${sessionId}/join`).set("Cookie", playerCookie);

  httpServer = createServer(app);
  ioServer = createSocketServer(httpServer, prisma);
  await new Promise((resolve) => httpServer.listen(0, resolve));
  port = httpServer.address().port;
});

describe("realtime question flow", () => {
  it("starts a safe question, accepts one answer and closes on deadline", async () => {
    hostSocket = await connect(ownerCookie);
    playerSocket = await connect(playerCookie);
    const hostSnapshot = await emitAck(hostSocket, "session:subscribe", { sessionId });
    const playerSnapshot = await emitAck(playerSocket, "session:subscribe", { sessionId });
    expect(hostSnapshot.ok).toBe(true);
    expect(playerSnapshot.ok).toBe(true);

    const playerClosed = waitFor(playerSocket, "question:closed");
    const hostReview = waitFor(hostSocket, "question:review");
    const started = await emitAck(hostSocket, "question:start", { sessionId });
    expect(started.ok).toBe(true);
    expect(started.data.currentQuestion.timeLimitSeconds).toBe(5);
    expect(started.data.currentQuestion.options[0]).not.toHaveProperty("isCorrect");

    const answer = await emitAck(playerSocket, "answer:submit", { sessionId, questionId, optionIds: [correctOptionId] });
    expect(answer).toEqual({ ok: true, data: { accepted: true } });
    const duplicate = await emitAck(playerSocket, "answer:submit", { sessionId, questionId, optionIds: [correctOptionId] });
    expect(duplicate.ok).toBe(false);
    expect(duplicate.error.code).toBe("ANSWER_ALREADY_SUBMITTED");

    const closed = await playerClosed;
    const review = await hostReview;
    expect(closed.isCorrect).toBe(true);
    expect(closed.awardedPoints).toBe(1000);
    expect(review.phase).toBe("QUESTION_REVIEW");
    expect(review.reviewStats.correctCount).toBe(1);
  }, 15000);
});

afterAll(async () => {
  playerSocket?.close();
  hostSocket?.close();
  ioServer?.close();
  if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
  if (sessionId) await prisma.quizSession.delete({ where: { id: sessionId } });
  if (quizId) await prisma.quiz.delete({ where: { id: quizId } });
  if (owner) await prisma.user.delete({ where: { id: owner.id } });
  if (player) await prisma.user.delete({ where: { id: player.id } });
  await prisma.$disconnect();
});
