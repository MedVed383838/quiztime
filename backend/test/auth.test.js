import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import app from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const email = `auth-${Date.now()}@example.com`;
const password = "password123";
let userId;

describe("auth endpoints", () => {
  it("registers a user and sets an HTTP-only cookie", async () => {
    const response = await request(app).post("/api/auth/register").send({
      email: email.toUpperCase(),
      password,
      displayName: "Тестовый пользователь",
    });

    expect(response.status).toBe(201);
    expect(response.body.data.user.email).toBe(email);
    expect(response.headers["set-cookie"][0]).toMatch(/quiztime_token=/);
    expect(response.headers["set-cookie"][0]).toMatch(/HttpOnly/i);
    userId = response.body.data.user.id;
  });

  it("rejects duplicate email and invalid credentials", async () => {
    const duplicate = await request(app).post("/api/auth/register").send({
      email,
      password,
      displayName: "Другой пользователь",
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("EMAIL_ALREADY_EXISTS");

    const invalid = await request(app).post("/api/auth/login").send({
      email,
      password: "wrong-password",
    });
    expect(invalid.status).toBe(401);
    expect(invalid.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("supports login, me and logout", async () => {
    const agent = request.agent(app);
    const login = await agent.post("/api/auth/login").send({ email, password });
    expect(login.status).toBe(200);

    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.data.user.id).toBe(userId);

    const logout = await agent.post("/api/auth/logout");
    expect(logout.status).toBe(200);

    const afterLogout = await agent.get("/api/auth/me");
    expect(afterLogout.status).toBe(401);
  });
});

afterAll(async () => {
  if (userId) await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});
