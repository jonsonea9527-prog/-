import fs from "node:fs";
import path from "node:path";
import express from "express";
import { createServer as createViteServer } from "vite";
import { createApp } from "./app";
import { createConfig } from "./config";
import { createDatabase } from "./db";
import { createLiveShareSupervisor } from "./liveShareSupervisor";

export async function bootstrapServer(env: NodeJS.ProcessEnv = process.env) {
  const config = createConfig(env);
  const appRoot = env.APP_ROOT?.trim() || process.cwd();
  fs.mkdirSync(config.dataDir, { recursive: true });

  const db = createDatabase(path.join(config.dataDir, "app.db"));
  db.resetRuntimeState();
  const supervisor = createLiveShareSupervisor({ db });

  const app = createApp({
    db,
    supervisor
  });

  const isDev = env.NODE_ENV !== "production";
  if (isDev) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true
      },
      appType: "spa"
    });

    app.use(vite.middlewares);
  } else {
    const clientDist = path.resolve(appRoot, "dist", "client");
    if (fs.existsSync(clientDist)) {
      app.use(express.static(clientDist));
      app.get("*", (_req, res) => {
        res.sendFile(path.join(clientDist, "index.html"));
      });
    }
  }

  const server = app.listen(config.port, () => {
    console.log(`本地 Live Share 控制台已启动：http://localhost:${config.port}`);
  });

  return {
    config,
    db,
    supervisor,
    app,
    server,
    async close() {
      await supervisor.stopAll();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  };
}
