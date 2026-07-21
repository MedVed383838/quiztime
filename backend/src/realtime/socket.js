import { Server } from "socket.io";
import { COOKIE_NAME, verifyToken } from "../auth/auth.service.js";

function readCookie(header, name) {
  const item = header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
}

export function createSocketServer(httpServer, prisma) {
  const io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
  });

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
  });

  return io;
}
