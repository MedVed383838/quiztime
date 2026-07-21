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
let ownerAgent;
let playerAgent;
let quizId;
let sessionId;
let httpServer;
let ioServer;
let port;

async function connect(cookie) {
  const socket = createClient(`http://localhost:${port}`, { extraHeaders: { Cookie: cookie } });
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  return socket;
}

function subscribe(socket) {
  return new Promise((resolve, reject) => {
    socket.emit("session:subscribe", { sessionId }, (response) => {
      if (response.ok) resolve(response.data);
      else reject(new Error(response.error.code));
    });
  });
}

beforeAll(async () => {
  owner = await registerUser(prisma, { email: `socket-owner-${Date.now()}@example.com`, password: "password123", displayName: "Socket Owner" });
  player = await registerUser(prisma, { email: `socket-player-${Date.now()}@example.com`, password: "password123", displayName: "Socket Player" });
  ownerAgent = request.agent(app);
  playerAgent = request.agent(app);
  await ownerAgent.post("/api/auth/login").send({ email: owner.email, password: "password123" });
  await playerAgent.post("/api/auth/login").send({ email: player.email, password: "password123" });

  const category = await prisma.category.findFirst();
  const quiz = await ownerAgent.post("/api/quizzes").send({ title: "Socket replacement", categoryId: category.id, defaultTimeLimitSeconds: 30, defaultPointsPerQuestion: 1000, revealCorrectAnswer: true });
  quizId = quiz.body.data.quiz.id;
  await ownerAgent.post(`/api/quizzes/${quizId}/questions`).send({ text: "Question", type: "SINGLE_CHOICE", options: [{ text: "A", isCorrect: true }, { text: "B", isCorrect: false }] });
  await ownerAgent.post(`/api/quizzes/${quizId}/ready`);
  const session = await ownerAgent.post("/api/sessions").send({ quizId });
  sessionId = session.body.data.session.id;
  await playerAgent.post(`/api/sessions/${sessionId}/join`);

  httpServer = createServer(app);
  ioServer = createSocketServer(httpServer, prisma);
  await new Promise((resolve) => httpServer.listen(0, resolve));
  port = httpServer.address().port;
});

describe("session socket replacement", () => {
  it("disconnects the previous socket after a new subscribe", async () => {
    const login = await request(app).post("/api/auth/login").send({ email: player.email, password: "password123" });
    const cookie = login.headers["set-cookie"][0].split(";")[0];
    const first = await connect(cookie);
    await subscribe(first);
    const disconnected = new Promise((resolve) => first.once("disconnect", resolve));

    const second = await connect(cookie);
    const snapshot = await subscribe(second);

    await expect(disconnected).resolves.toBe("io server disconnect");
    expect(snapshot.participants).toHaveLength(1);
    second.close();
  });
});

afterAll(async () => {
  ioServer?.close();
  if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
  if (sessionId) await prisma.quizSession.delete({ where: { id: sessionId } });
  if (quizId) await prisma.quiz.delete({ where: { id: quizId } });
  if (owner) await prisma.user.delete({ where: { id: owner.id } });
  if (player) await prisma.user.delete({ where: { id: player.id } });
  await prisma.$disconnect();
});
