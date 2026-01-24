import "dotenv/config";
import { createApp } from "./app";
import { env } from "./env";

const app = createApp();

app.listen(env.PORT, () => {
  process.stdout.write(`API listening on http://localhost:${env.PORT}\n`);
});

