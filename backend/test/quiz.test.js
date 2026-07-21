import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app from "../src/app.js";
import { registerUser } from "../src/auth/auth.service.js";
import { prisma } from "../src/lib/prisma.js";

let agent;
let user;
let otherUser;
let quizId;
let otherAgent;

beforeAll(async () => {
  user = await registerUser(prisma, { email: `quiz-${Date.now()}@example.com`, password: "password123", displayName: "Quiz Owner" });
  agent = request.agent(app);
  await agent.post("/api/auth/login").send({ email: user.email, password: "password123" });
  otherUser = await registerUser(prisma, { email: `other-quiz-${Date.now()}@example.com`, password: "password123", displayName: "Other Owner" });
  otherAgent = request.agent(app);
  await otherAgent.post("/api/auth/login").send({ email: otherUser.email, password: "password123" });
});

describe("quiz management", () => {
  it("lists categories and creates a draft quiz", async () => {
    const categories = await agent.get("/api/categories");
    expect(categories.status).toBe(200);
    expect(categories.body.data.categories.length).toBeGreaterThanOrEqual(7);

    const category = categories.body.data.categories[0];
    const response = await agent.post("/api/quizzes").send({
      title: "Основы тестирования",
      description: "Черновик",
      categoryId: category.id,
      defaultTimeLimitSeconds: 30,
      defaultPointsPerQuestion: 1000,
      revealCorrectAnswer: true,
    });
    expect(response.status).toBe(201);
    expect(response.body.data.quiz.status).toBe("DRAFT");
    quizId = response.body.data.quiz.id;
  });

  it("returns owner quizzes and blocks invalid ready transition", async () => {
    const list = await agent.get("/api/quizzes");
    expect(list.status).toBe(200);
    expect(list.body.data.quizzes.some((quiz) => quiz.id === quizId)).toBe(true);

    const ready = await agent.post(`/api/quizzes/${quizId}/ready`);
    expect(ready.status).toBe(400);
    expect(ready.body.error.code).toBe("QUIZ_INVALID");
  });

  it("supports archive and rejects unauthenticated access", async () => {
    const archive = await agent.post(`/api/quizzes/${quizId}/archive`);
    expect(archive.status).toBe(200);
    expect(archive.body.data.quiz.status).toBe("ARCHIVED");

    const unauthorized = await request(app).get("/api/quizzes");
    expect(unauthorized.status).toBe(401);
  });

  it("does not expose a quiz to another owner", async () => {
    const response = await otherAgent.get(`/api/quizzes/${quizId}`);
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("QUIZ_NOT_FOUND");
  });
});

afterAll(async () => {
  if (quizId) await prisma.quiz.delete({ where: { id: quizId } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.user.delete({ where: { id: otherUser.id } });
  await prisma.$disconnect();
});
