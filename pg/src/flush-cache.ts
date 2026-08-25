import { createConnection } from "net";
import dotenv from "dotenv";

dotenv.config();

const url = new URL(process.env.REDIS_URL || "redis://localhost:6379");

const sock = createConnection({ host: url.hostname, port: parseInt(url.port) || 6379 }, () => {
  if (url.password) sock.write(`AUTH ${url.password}\r\n`);
  sock.write("FLUSHALL\r\n");
  sock.write("QUIT\r\n");
});

sock.on("data", (d) => process.stdout.write(d));
sock.on("end", () => {
  console.log("Redis cache flushed");
  process.exit(0);
});
sock.on("error", (e) => {
  console.error("Redis flush failed:", e.message);
  process.exit(1);
});
