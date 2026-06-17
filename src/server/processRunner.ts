import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { TextDecoder } from "node:util";

export interface RunningProcess {
  child: ChildProcessWithoutNullStreams;
  stop(): Promise<void>;
}

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface ProcessOptions {
  env?: NodeJS.ProcessEnv;
}

const localTunnelViteAllowedHost = ".loca.lt";
const outputDecoder = new TextDecoder("gb18030");
const npmUnavailableMessage = "未检测到 npm。请先安装 Node.js LTS，或确认 npm 已加入系统 PATH 后再启动分享。";

const proxyEnvKeys = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"];

function getPathKey(env: NodeJS.ProcessEnv): string {
  return Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
}

function appendUniquePathEntries(currentPath: string | undefined, entries: Array<string | undefined>): string | undefined {
  const separator = process.platform === "win32" ? ";" : ":";
  const existingEntries = (currentPath ?? "").split(separator).filter(Boolean);
  const seen = new Set(existingEntries.map((entry) => process.platform === "win32" ? entry.toLowerCase() : entry));

  for (const entry of entries) {
    if (!entry) {
      continue;
    }
    const normalized = process.platform === "win32" ? entry.toLowerCase() : entry;
    if (!seen.has(normalized)) {
      existingEntries.push(entry);
      seen.add(normalized);
    }
  }

  return existingEntries.length > 0 ? existingEntries.join(separator) : currentPath;
}

function getWindowsNodePathEntries(env: NodeJS.ProcessEnv): string[] {
  return [
    env.ProgramFiles ? `${env.ProgramFiles}\\nodejs` : "C:\\Program Files\\nodejs",
    env["ProgramFiles(x86)"] ? `${env["ProgramFiles(x86)"]}\\nodejs` : "C:\\Program Files (x86)\\nodejs",
    env.LOCALAPPDATA ? `${env.LOCALAPPDATA}\\Programs\\nodejs` : undefined,
    env.APPDATA ? `${env.APPDATA}\\npm` : undefined
  ].filter((entry): entry is string => Boolean(entry));
}

export function buildProcessEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const nextEnv = { ...env };
  delete nextEnv.ESBUILD_BINARY_PATH;

  for (const key of proxyEnvKeys) {
    const value = nextEnv[key]?.trim();
    if (!value || value.toLowerCase() === "undefined" || value.toLowerCase() === "null") {
      delete nextEnv[key];
    }
  }

  if (process.platform === "win32") {
    const pathKey = getPathKey(nextEnv);
    nextEnv[pathKey] = appendUniquePathEntries(nextEnv[pathKey], getWindowsNodePathEntries(nextEnv));
  }

  if (!nextEnv.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS) {
    nextEnv.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS = localTunnelViteAllowedHost;
  }

  return nextEnv;
}

function createStopper(child: ChildProcessWithoutNullStreams) {
  let closed = false;
  const closePromise = new Promise<void>((resolve) => {
    child.once("close", () => {
      closed = true;
      resolve();
    });
  });

  child.once("error", () => {
    closed = true;
  });

  return async () => {
    if (closed || child.exitCode !== null || child.signalCode !== null) {
      return;
    }

    if (process.platform === "win32" && child.pid) {
      await new Promise<void>((resolve) => {
        const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          windowsHide: true
        });
        killer.once("close", () => resolve());
        killer.once("error", () => resolve());
      });
    } else if (!child.killed) {
      child.kill();
    }

    await closePromise;
  };
}

function getShellProgram(platform = process.platform): { command: string; args: string[] } {
  if (platform === "win32") {
    return {
      command: process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c"]
    };
  }

  return {
    command: "sh",
    args: ["-lc"]
  };
}

function resolveCommand(command: string, platform = process.platform): string {
  if (platform !== "win32") {
    return command;
  }

  if (command === "npm" || command === "npx") {
    return `${command}.cmd`;
  }

  return command;
}

function needsWindowsCommandShell(command: string, platform = process.platform): boolean {
  return platform === "win32" && (command === "npm" || command === "npx");
}

export function isCommandNotFoundOutput(text: string): boolean {
  return /not recognized as an internal or external command/i.test(text)
    || /is not recognized as an internal or external command/i.test(text)
    || /不是内部或外部命令/.test(text)
    || /找不到指定的文件/.test(text)
    || /command not found/i.test(text);
}

export function normalizeCommandFailure(command: string, result: CommandResult): CommandResult {
  const output = `${result.stderr}\n${result.stdout}`;
  if ((command === "npm" || command === "npx") && isCommandNotFoundOutput(output)) {
    return {
      ...result,
      stderr: npmUnavailableMessage,
      stdout: ""
    };
  }

  return result;
}

export function isNpmUnavailableMessage(text: string): boolean {
  return text.includes("未检测到 npm") && text.includes("Node.js LTS");
}

function decodeOutput(chunk: Buffer): string {
  return outputDecoder.decode(chunk);
}

function quoteWindowsArg(value: string): string {
  if (!/[ \t"&()^<>|]/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '\\"')}"`;
}

export function buildSpawnCommand(
  command: string,
  args: string[],
  platform = process.platform
): { command: string; args: string[] } {
  const resolvedCommand = resolveCommand(command, platform);
  if (platform !== "win32") {
    return { command: resolvedCommand, args };
  }

  if (!needsWindowsCommandShell(command, platform)) {
    return { command: resolvedCommand, args };
  }

  const cmdPath = process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe";
  const joined = [resolvedCommand, ...args.map(quoteWindowsArg)].join(" ");
  return {
    command: cmdPath,
    args: ["/d", "/s", "/c", joined]
  };
}

export function startProcess(command: string, args: string[], cwd: string, options?: ProcessOptions): RunningProcess {
  const spawnCommand = buildSpawnCommand(command, args);
  const child = spawn(spawnCommand.command, spawnCommand.args, {
    cwd,
    shell: false,
    env: buildProcessEnv(options?.env)
  });

  return {
    child,
    stop: createStopper(child)
  };
}

export function startCommandLine(commandLine: string, cwd: string): RunningProcess {
  const shellProgram = getShellProgram();
  const child = spawn(shellProgram.command, [...shellProgram.args, commandLine], {
    cwd,
    shell: false,
    env: buildProcessEnv()
  });

  return {
    child,
    stop: createStopper(child)
  };
}

export async function runCommand(command: string, args: string[], cwd: string, options?: ProcessOptions): Promise<CommandResult> {
  const spawnCommand = buildSpawnCommand(command, args);
  const child = spawn(spawnCommand.command, spawnCommand.args, {
    cwd,
    shell: false,
    env: buildProcessEnv(options?.env)
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk: Buffer) => {
    stdout += decodeOutput(chunk);
  });

  child.stderr.on("data", (chunk: Buffer) => {
    stderr += decodeOutput(chunk);
  });

  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });

  return normalizeCommandFailure(command, { code, stdout, stderr });
}

export async function runCommandLine(commandLine: string, cwd: string): Promise<CommandResult> {
  const shellProgram = getShellProgram();
  const child = spawn(shellProgram.command, [...shellProgram.args, commandLine], {
    cwd,
    shell: false,
    env: buildProcessEnv()
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk: Buffer) => {
    stdout += decodeOutput(chunk);
  });

  child.stderr.on("data", (chunk: Buffer) => {
    stderr += decodeOutput(chunk);
  });

  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });

  return { code, stdout, stderr };
}
