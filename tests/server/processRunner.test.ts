import { describe, expect, it } from "vitest";
import {
  buildProcessEnv,
  buildSpawnCommand,
  normalizeCommandFailure,
  startProcess
} from "../../src/server/processRunner";

describe("processRunner", () => {
  it("uses cmd.exe wrapper on Windows", () => {
    const npmCommand = buildSpawnCommand("npm", ["run", "dev"], "win32");
    const npxCommand = buildSpawnCommand("npx", ["localtunnel", "--port", "5173"], "win32");

    expect(npmCommand.command.toLowerCase()).toContain("cmd.exe");
    expect(npmCommand.args).toEqual(["/d", "/s", "/c", "npm.cmd run dev"]);
    expect(npxCommand.args).toEqual(["/d", "/s", "/c", "npx.cmd localtunnel --port 5173"]);
  });

  it("keeps other commands unchanged", () => {
    expect(buildSpawnCommand("node", ["server.js"], "win32")).toEqual({
      command: "node",
      args: ["server.js"]
    });
    expect(buildSpawnCommand("git", ["commit", "-m", "Update preview"], "win32")).toEqual({
      command: "git",
      args: ["commit", "-m", "Update preview"]
    });
    expect(buildSpawnCommand("npm", ["run", "dev"], "linux")).toEqual({
      command: "npm",
      args: ["run", "dev"]
    });
  });

  it("does not pass the desktop esbuild binary override to project commands", () => {
    const env = buildProcessEnv({
      PATH: "C:\\Windows\\System32",
      ESBUILD_BINARY_PATH: "C:\\Apps\\Local Live Share\\resources\\app.asar.unpacked\\node_modules\\@esbuild\\win32-x64\\esbuild.exe"
    });

    expect(env.ESBUILD_BINARY_PATH).toBeUndefined();
    expect(env.PATH).toContain("C:\\Windows\\System32");
    expect(env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS).toBe(".loca.lt");
  });

  it("preserves an explicitly configured Vite allowed host", () => {
    const env = buildProcessEnv({
      PATH: "C:\\Windows\\System32",
      __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: ".example.com"
    });

    expect(env.PATH).toContain("C:\\Windows\\System32");
    expect(env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS).toBe(".example.com");
  });

  it("removes invalid proxy environment values before running project commands", () => {
    const env = buildProcessEnv({
      HTTP_PROXY: "undefined",
      HTTPS_PROXY: "null",
      ALL_PROXY: "",
      http_proxy: "http://127.0.0.1:7890"
    });

    expect(env.HTTP_PROXY).toBeUndefined();
    expect(env.HTTPS_PROXY).toBeUndefined();
    expect(env.ALL_PROXY).toBeUndefined();
    expect(env.http_proxy).toBe("http://127.0.0.1:7890");
  });

  it("adds common Windows Node.js paths to child process PATH", () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "win32" });

    try {
      const env = buildProcessEnv({
        PATH: "C:\\Windows\\System32",
        ProgramFiles: "C:\\Program Files",
        LOCALAPPDATA: "C:\\Users\\Demo\\AppData\\Local",
        APPDATA: "C:\\Users\\Demo\\AppData\\Roaming"
      });

      expect(env.PATH).toContain("C:\\Program Files\\nodejs");
      expect(env.PATH).toContain("C:\\Users\\Demo\\AppData\\Roaming\\npm");
    } finally {
      if (originalPlatform) {
        Object.defineProperty(process, "platform", originalPlatform);
      }
    }
  });

  it("normalizes missing npm errors into actionable Chinese guidance", () => {
    const result = normalizeCommandFailure("npm", {
      code: 1,
      stdout: "",
      stderr: "'npm.cmd' 不是内部或外部命令，也不是可运行的程序"
    });

    expect(result.stderr).toBe("未检测到 npm。请先安装 Node.js LTS，或确认 npm 已加入系统 PATH 后再启动分享。");
  });

  it("does not hang when stopping an already exited process", async () => {
    const runningProcess = startProcess("node", ["--version"], process.cwd());
    await new Promise<void>((resolve) => runningProcess.child.once("close", () => resolve()));

    await expect(runningProcess.stop()).resolves.toBeUndefined();
  });
});
