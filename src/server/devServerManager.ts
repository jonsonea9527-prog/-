import type { RunningProcess } from "./processRunner";
import { isCommandNotFoundOutput, startProcess } from "./processRunner";

const defaultStartupTimeoutMs = 30000;
const defaultProbeIntervalMs = 500;
const maxCapturedOutputLength = 6000;

export function parseViteLocalUrl(text: string): string | null {
  const match = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|[0-9]{1,3}(?:\.[0-9]{1,3}){3}):\d+\//);
  return match?.[0] ?? null;
}

async function probeLocalUrl(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1000);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal
    });
    return response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function waitForLocalDevServer(input: {
  port: number;
  timeoutMs?: number;
  probeIntervalMs?: number;
}): Promise<string> {
  const timeoutMs = input.timeoutMs ?? defaultStartupTimeoutMs;
  const probeIntervalMs = input.probeIntervalMs ?? defaultProbeIntervalMs;
  const url = `http://localhost:${input.port}/`;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await probeLocalUrl(url)) {
      return url;
    }
    await new Promise((resolve) => setTimeout(resolve, probeIntervalMs));
  }

  throw new Error("dev server started but local url was not reachable in time");
}

export interface StartedDevServer {
  process: RunningProcess;
  localUrl: Promise<string>;
}

export function createDevServerFailure(message: string, output: string[]): Error {
  const details = output
    .join("")
    .trim()
    .slice(-maxCapturedOutputLength);

  if (isCommandNotFoundOutput(details)) {
    return new Error("未检测到 npm。请先安装 Node.js LTS，或确认 npm 已加入系统 PATH 后再启动分享。");
  }

  if (!details) {
    return new Error(message);
  }

  return new Error(`${message}\n\nDev server output:\n${details}`);
}

export function buildDevServerArgs(port: number): string[] {
  return [
    "run",
    "dev",
    "--",
    "--host",
    "0.0.0.0",
    "--port",
    String(port),
    "--strictPort"
  ];
}

export function startDevServer(projectPath: string, port: number): StartedDevServer {
  const process = startProcess(
    "npm",
    buildDevServerArgs(port),
    projectPath
  );

  const localUrlFromOutput = new Promise<string>((resolve, reject) => {
    const output: string[] = [];
    const onOutput = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      output.push(text);
      const url = parseViteLocalUrl(text);
      if (url) {
        cleanup();
        resolve(url);
      }
    };

    const onExit = () => {
      cleanup();
      reject(createDevServerFailure("dev server exited before reporting a local url", output));
    };

    const onError = (error: Error) => {
      cleanup();
      reject(createDevServerFailure(error.message, output));
    };

    const timeout = setTimeout(() => {
      cleanup();
      reject(createDevServerFailure("dev server did not report a local url in time", output));
    }, defaultStartupTimeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      process.child.stdout.off("data", onOutput);
      process.child.stderr.off("data", onOutput);
      process.child.off("close", onExit);
      process.child.off("error", onError);
    };

    process.child.stdout.on("data", onOutput);
    process.child.stderr.on("data", onOutput);
    process.child.on("close", onExit);
    process.child.on("error", onError);

    if (process.child.exitCode !== null || process.child.signalCode !== null) {
      onExit();
    }
  });

  const localUrl = Promise.any([
    localUrlFromOutput,
    waitForLocalDevServer({ port })
  ]).catch((error: unknown) => {
    if (error instanceof AggregateError) {
      const messages = error.errors
        .map((item) => item instanceof Error ? item.message : String(item))
        .filter(Boolean);
      throw new Error(messages.at(-1) ?? "dev server did not become ready in time");
    }
    throw error;
  });

  return { process, localUrl };
}
