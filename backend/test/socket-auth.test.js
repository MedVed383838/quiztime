import { createServer } from "node:http";
import request from "supertest";
import { io as createClient } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app from "../src/app.js";
import { registerUser } from "../src/auth/auth.service.js";
import { prisma } from "../src/lib/prisma.js";
import { createSocketServer } from "../src/realtime/socket.js";

let httpServer;
let port;
let user;
let cookie;
let ioServer;

beforeAll(async () => {
  user = await registerUser(prisma, {
    email: `socket-${Date.now()}@example.com`,
    password: "password123",
    displayName: "Socket Tester",
  });
  const response = await request(app).post("/api/auth/login").send({ email: user.email, password: "password123" });
  cookie = response.headers["set-cookie"][0].split(";")[0];
  httpServer = createServer(app);
  ioServer = createSocketServer(httpServer, prisma);
  await new Promise((resolve) => httpServer.listen(0, resolve));
  port = httpServer.address().port;
});

describe("Socket.IO authentication", () => {
  it("accepts a valid JWT cookie and rejects an unauthenticated socket", async () => {
    const authenticated = createClient(`http://localhost:${port}`, { extraHeaders: { Cookie: cookie } });
    const ready = new Promise((resolve) => authenticated.once("auth:ready", resolve));
    await expect(new Promise((resolve, reject) => {
      authenticated.once("connect", () => resolve(true));
      authenticated.once("connect_error", reject);
    })).resolves.toBeDefined();
    await expect(ready).resolves.toEqual({ userId: user.id });
    authenticated.close();

    const unauthenticated = createClient(`http://localhost:${port}`);
    await expect(new Promise((resolve, reject) => {
      unauthenticated.once("connect", () => resolve(true));
      unauthenticated.once("connect_error", (error) => reject(error.message));
    })).rejects.toBe("UNAUTHORIZED");
    unauthenticated.close();
  });
});

afterAll(async () => {
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.$disconnect();
  ioServer.close();
  await new Promise((resolve) => httpServer.close(resolve));
});
