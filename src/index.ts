import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { createApp } from "./app";
import { env } from "./env";

const execFileAsync = promisify(execFile);

async function runDatabaseInit() {
  if (env.NODE_ENV !== "production") return;
  const projectRoot = path.resolve(__dirname, "..");
  const prismaBin = process.platform === "win32" ? "prisma.cmd" : "prisma";
  const prismaPath = path.join(projectRoot, "node_modules", ".bin", prismaBin);
  await execFileAsync(prismaPath, ["migrate", "deploy"], {
    cwd: projectRoot,
    env: process.env,
  });
  const seedPath = path.join(projectRoot, "dist", "seed.js");
  await execFileAsync(process.execPath, [seedPath], {
    cwd: projectRoot,
    env: process.env,
  });
}

async function start() {
  await runDatabaseInit();
  const app = createApp();
  app.listen(env.PORT, "0.0.0.0", () => {
    process.stdout.write(`API listening on 0.0.0.0:${env.PORT}\n`);
  });
}

start().catch((err) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`${msg}\n`);
  process.exit(1);
});
