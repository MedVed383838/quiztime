import http from "node:http";
import app from "./app.js";
import { prisma } from "./lib/prisma.js";
import { createSocketServer } from "./realtime/socket.js";

const port = Number(process.env.PORT ?? 3000);
const server = http.createServer(app);
createSocketServer(server, prisma);

server.listen(port, () => {
  console.log(`QuizTime backend listening on port ${port}`);
});
