import { COOKIE_NAME, verifyToken } from "./auth.service.js";

export function requireAuth(prisma) {
  return async (request, response, next) => {
    try {
      const token = request.cookies[COOKIE_NAME];
      if (!token) {
        return response.status(401).json({ error: { code: "UNAUTHORIZED", message: "Требуется вход", details: null } });
      }
      const payload = verifyToken(token);
      const userId = Number(payload.sub);
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        return response.status(401).json({ error: { code: "UNAUTHORIZED", message: "Требуется вход", details: null } });
      }
      request.user = user;
      return next();
    } catch {
      return response.status(401).json({ error: { code: "UNAUTHORIZED", message: "Требуется вход", details: null } });
    }
  };
}
