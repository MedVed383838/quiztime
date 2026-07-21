import { z } from "zod";
import express from "express";
import {
  authenticateUser,
  clearAuthCookie,
  registerUser,
  setAuthCookie,
  toUserDto,
} from "./auth.service.js";
import { requireAuth } from "./auth.middleware.js";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  displayName: z.string().trim().min(2).max(40),
});
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128),
});

function validationError(response, error) {
  return response.status(400).json({
    error: { code: "VALIDATION_ERROR", message: "Проверьте введённые данные", details: error.issues },
  });
}

export function createAuthRouter(prisma) {
  const router = express.Router();

  router.post("/register", async (request, response, next) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) return validationError(response, parsed.error);
    try {
      const user = await registerUser(prisma, parsed.data);
      setAuthCookie(response, user.id);
      return response.status(201).json({ data: { user: toUserDto(user) } });
    } catch (error) {
      if (error.code === "EMAIL_ALREADY_EXISTS") {
        return response.status(409).json({ error: { code: error.code, message: "Email уже зарегистрирован", details: null } });
      }
      return next(error);
    }
  });

  router.post("/login", async (request, response, next) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return validationError(response, parsed.error);
    try {
      const user = await authenticateUser(prisma, parsed.data);
      setAuthCookie(response, user.id);
      return response.status(200).json({ data: { user: toUserDto(user) } });
    } catch (error) {
      if (error.code === "INVALID_CREDENTIALS") {
        return response.status(401).json({ error: { code: error.code, message: "Неверный email или пароль", details: null } });
      }
      return next(error);
    }
  });

  router.post("/logout", (_request, response) => {
    clearAuthCookie(response);
    return response.status(200).json({ data: null });
  });

  router.get("/me", requireAuth(prisma), (request, response) => {
    return response.status(200).json({ data: { user: toUserDto(request.user) } });
  });

  return router;
}
