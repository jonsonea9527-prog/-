import { isNpmUnavailableMessage, runCommand, startProcess } from "./processRunner";
import type { RunningProcess } from "./processRunner";
import { startDevServer } from "./devServerManager";

const defaultStartupTimeoutMs = 30000;
const defaultProbeIntervalMs = 500;

function isBuiltPreviewHtml(text: string): boolean {
  return !text.includes("/@vite/client")
    && !text.includes('src="/main.tsx"')
    && /\/assets\/.+\.(?:js|css)/.test(text);
}

export async function waitForShareServer(input: {
  port: number;
  timeoutMs?: number;
  probeIntervalMs?: number;
}): Promise<string> {
  const timeoutMs = input.timeoutMs ?? defaultStartupTimeoutMs;
  const probeIntervalMs = input.probeIntervalMs ?? defaultProbeIntervalMs;
  const url = `http://localhost:${input.port}/`;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);

    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal
      });

      const html = await response.text();
      if (response.ok && isBuiltPreviewHtml(html)) {
        return url;
      }
    } catch {
      // wait and retry
    } finally {
      clearTimeout(timeout);
    }

    await new Promise((resolve) => setTimeout(resolve, probeIntervalMs));
  }

  throw new Error("share preview server did not become reachable in time");
}

export interface StartedShareServer {
  process: RunningProcess;
  localUrl: Promise<string>;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createDevFallbackError(devError: unknown, buildError: unknown): Error {
  return new Error([
    "Dev server failed:",
    getErrorMessage(devError),
    "",
    "Production preview fallback also failed:",
    getErrorMessage(buildError)
  ].join("\n"));
}

export function createProductionFallbackError(buildError: unknown, devError: unknown): Error {
  return new Error([
    "Production preview failed:",
    getErrorMessage(buildError),
    "",
    "Dev server fallback also failed:",
    getErrorMessage(devError)
  ].join("\n"));
}

async function buildProject(projectPath: string): Promise<void> {
  const result = await runCommand("npm", ["run", "build"], projectPath);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "npm run build failed");
  }
}

export function startShareServer(projectPath: string, port: number): StartedShareServer {
  const localUrl = (async () => {
    try {
      await buildProject(projectPath);
      const process = startProcess(
        "npm",
        ["run", "preview", "--", "--host", "0.0.0.0", "--port", String(port), "--strictPort"],
        projectPath
      );

      const readyUrl = await waitForShareServer({ port }).catch(async (error) => {
        await process.stop().catch(() => undefined);
        throw error;
      });

      return { process, readyUrl };
    } catch (buildError) {
      if (isNpmUnavailableMessage(getErrorMessage(buildError))) {
        throw buildError;
      }

      try {
        const devServer = startDevServer(projectPath, port);
        const readyUrl = await devServer.localUrl;
        return { process: devServer.process, readyUrl };
      } catch (devError) {
        throw createProductionFallbackError(buildError, devError);
      }
    }
  })();

  let runningProcess: RunningProcess | null = null;

  return {
    process: {
      child: {} as RunningProcess["child"],
      async stop() {
        if (runningProcess) {
          await runningProcess.stop();
        }
      }
    },
    localUrl: localUrl.then(({ process, readyUrl }) => {
      runningProcess = process;
      return readyUrl;
    })
  };
}
