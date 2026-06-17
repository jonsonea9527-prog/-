import http from "node:http";
import { describe, expect, it } from "vitest";
import {
  buildDevServerArgs,
  createDevServerFailure,
  parseViteLocalUrl,
  waitForLocalDevServer
} from "../../src/server/devServerManager";

describe("devServerManager", () => {
  it("extracts the local Vite url from stdout", () => {
    const chunk = "  Local:   http://localhost:5173/\n";
    expect(parseViteLocalUrl(chunk)).toBe("http://localhost:5173/");
  });

  it("extracts the local Vite url even when terminal output contains ansi wrappers", () => {
    const chunk = "\u001b[32m➜\u001b[39m  \u001b[1mLocal\u001b[22m:   http://127.0.0.1:5199/\n";
    expect(parseViteLocalUrl(chunk)).toBe("http://127.0.0.1:5199/");
  });
  it("starts Vite on the allocated port only", () => {
    expect(buildDevServerArgs(4174)).toEqual([
      "run",
      "dev",
      "--",
      "--host",
      "0.0.0.0",
      "--port",
      "4174",
      "--strictPort"
    ]);
  });

  it("includes captured dev server output in startup failures", () => {
    const error = createDevServerFailure("dev server did not report a local url in time", [
      "Missing script: dev",
      "npm ERR! command failed"
    ]);

    expect(error.message).toContain("dev server did not report a local url in time");
    expect(error.message).toContain("Missing script: dev");
    expect(error.message).toContain("npm ERR! command failed");
  });

  it("turns missing npm output into actionable Chinese guidance", () => {
    const error = createDevServerFailure("dev server did not report a local url in time", [
      "'npm.cmd' 不是内部或外部命令，也不是可运行的程序"
    ]);

    expect(error.message).toBe("未检测到 npm。请先安装 Node.js LTS，或确认 npm 已加入系统 PATH 后再启动分享。");
  });

  it("detects a running dev server even without parsing stdout", async () => {
    const server = http.createServer((_req, res) => {
      res.end("ok");
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    try {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      await expect(waitForLocalDevServer({
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
});
