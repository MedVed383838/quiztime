import http from "node:http";
import app from "./app.js";

const port = Number(process.env.PORT ?? 3000);
const server = http.createServer(app);

server.listen(port, () => {
  console.log(`QuizTime backend listening on port ${port}`);
});
