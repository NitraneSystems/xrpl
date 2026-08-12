import { VERSION } from "./app/config.js";
import { register, reportState } from "./app/handlers.js";
import { Server } from "./base/server.js";

async function main(): Promise<void> {
  const extPort = process.env.EXTENSION_PORT ?? "8080";
  const signPort = process.env.SIGN_PORT ?? "9090";
  const server = new Server(extPort, signPort, VERSION, register, reportState);

  const shutdown = (signal: string) => {
    console.log(`received ${signal}, shutting down`);
    server
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  await server.listenAndServe();
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
