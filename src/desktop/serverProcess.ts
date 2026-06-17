import { once } from "node:events";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  getDesktopEsbuildBinaryPath,
  getDesktopServerUrl,
  getDesktopTsxLoaderPath,
  getNextDesktopServerPort
} from "./runtimePaths.ts";
import { buildProcessEnv } from "../server/processRunner.ts";

export interface DesktopServerProcess {
  child: ChildProcessWithoutNullStreams;
  port: number;
  readyUrl: Promise<string>;
  stop(): Promise<void>;
}

export interface StartDesktopServerOptions {
  appRoot: string;
  cwd: string;
  dataDir: string;
  isPackaged: boolean;
  port: number;
  serverEntryPath: string;
}

export interface DesktopServerNodeArgsOptions {
  isPackaged: boolean;
  serverEntryPath: string;
  tsxLoaderPath: string;
}

export function buildDesktopServerNodeArgs(options: DesktopServerNodeArgsOptions): string[] {
  const tsxLoaderSpecifier = options.isPackaged
    ? pathToFileURL(options.tsxLoaderPath).toString()
    : options.tsxLoaderPath;

  return [
    "--import",
    tsxLoaderSpecifier,
    options.serverEntryPath
  ];
}

async function waitForServer(input: {
  child: ChildProcessWithoutNullStreams;
  timeoutMs?: number;
  url: string;
}): Promise<string> {
  const timeoutMs = input.timeoutMs ?? 30000;
  const deadline = Date.now() + timeoutMs;
  let lastStdout = "";
  let lastStderr = "";

  input.child.stdout.on("data", (chunk: Buffer) => {
    lastStdout += chunk.toString("utf8");
  });

  input.child.stderr.on("data", (chunk: Buffer) => {
    lastStderr += chunk.toString("utf8");
  });

  while (Date.now() < deadline) {
    if (input.child.exitCode !== null) {
      const combined = `${lastStdout}\n${lastStderr}`.trim();
      throw new Error(combined || `desktop server exited early with code ${input.child.exitCode}`);
    }

    try {
      const response = await fetch(input.url, { method: "GET" });
      if (response.ok) {
        return input.url;
      }
    } catch {
      // wait and retry
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const combined = `${lastStdout}\n${lastStderr}`.trim();
  throw new Error(combined || "desktop server did not become reachable in time");
}

function buildDesktopServerChild(options: StartDesktopServerOptions): ChildProcessWithoutNullStreams {
  const tsxLoaderPath = getDesktopTsxLoaderPath({
    isPackaged: options.isPackaged,
    appPath: options.appRoot
  });
  const esbuildBinaryPath = getDesktopEsbuildBinaryPath({
    isPackaged: options.isPackaged,
    appPath: options.appRoot
  });

  return spawn(
    process.execPath,
    buildDesktopServerNodeArgs({
      isPackaged: options.isPackaged,
      tsxLoaderPath,
      serverEntryPath: options.serverEntryPath
    }),
    {
      cwd: options.cwd,
      env: {
        ...buildProcessEnv(),
        ELECTRON_RUN_AS_NODE: "1",
        NODE_ENV: options.isPackaged ? "production" : "development",
        PORT: String(options.port),
        APP_ROOT: options.appRoot,
        DATA_DIR: options.dataDir,
        ...(esbuildBinaryPath ? { ESBUILD_BINARY_PATH: esbuildBinaryPath } : {})
      },
      stdio: "pipe"
    }
  );
}

export function startDesktopServer(options: StartDesktopServerOptions): DesktopServerProcess {
  const child = buildDesktopServerChild(options);
  let stopped = false;

  const stop = async () => {
    if (stopped || child.exitCode !== null || child.signalCode !== null) {
      stopped = true;
      return;
    }

    stopped = true;
    child.kill();
    await once(child, "close").catch(() => undefined);
  };

  const url = getDesktopServerUrl(options.port);
  const readyUrl = waitForServer({
    child,
    url
  }).catch(async (error) => {
    await stop();
    throw error;
  });

  return {
    child,
    port: options.port,
    readyUrl,
    stop
  };
}

export async function startDesktopServerWithFallback(
  options: StartDesktopServerOptions,
  maxAttempts = 3
): Promise<DesktopServerProcess> {
  let currentPort = options.port;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const process = startDesktopServer({
      ...options,
      port: currentPort
    });

    try {
      await process.readyUrl;
      return process;
    } catch (error) {
      lastError = error;
      await process.stop().catch(() => undefined);
      currentPort = getNextDesktopServerPort(currentPort);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
