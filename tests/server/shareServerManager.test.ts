import { describe, expect, it } from "vitest";
import {
  createDevFallbackError,
  createProductionFallbackError,
  waitForShareServer
} from "../../src/server/shareServerManager";
import http from "node:http";

describe("shareServerManager", () => {
  it("keeps the original dev error when production fallback also fails", () => {
    const error = createDevFallbackError(
      new Error("dev server exited before reporting a local url"),
      new Error("Cannot find module 'sonner@2.0.3'")
    );

    expect(error.message).toContain("dev server exited before reporting a local url");
    expect(error.message).toContain("Production preview fallback also failed");
    expect(error.message).toContain("Cannot find module 'sonner@2.0.3'");
  });

  it("keeps the original production error when dev fallback also fails", () => {
    const error = createProductionFallbackError(
      new Error("npm run build failed"),
      new Error("dev server exited before reporting a local url")
    );

    expect(error.message).toContain("Production preview failed");
    expect(error.message).toContain("npm run build failed");
    expect(error.message).toContain("Dev server fallback also failed");
    expect(error.message).toContain("dev server exited before reporting a local url");
  });

  it("does not append dev fallback details when npm is unavailable", () => {
    const npmError = new Error("未检测到 npm。请先安装 Node.js LTS，或确认 npm 已加入系统 PATH 后再启动分享。");

    expect(npmError.message).toContain("未检测到 npm");
    expect(npmError.message).not.toContain("Dev server fallback");
  });

  it("accepts a built preview html response", async () => {
    const server = http.createServer((_req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.end(`<!doctype html><html><head><script type="module" src="/assets/index-abc123.js"></script></head><body><div id="root"></div></body></html>`);
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    try {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      await expect(waitForShareServer({
        port,
        timeoutMs: 1000,
        probeIntervalMs: 50
      })).resolves.toBe(`http://localhost:${port}/`);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it("rejects vite dev html responses", async () => {
    const server = http.createServer((_req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.end(`<!doctype html><html><head><script type="module" src="/@vite/client"></script></head><body><script type="module" src="/main.tsx"></script></body></html>`);
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    try {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      await expect(waitForShareServer({
        port,
        timeoutMs: 300,
        probeIntervalMs: 50
      })).rejects.toThrow("share preview server did not become reachable in time");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });
});
