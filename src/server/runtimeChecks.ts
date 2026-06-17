import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildProcessEnv } from "./processRunner";

const execFileAsync = promisify(execFile);

export interface RuntimeToolStatus {
  ok: boolean;
  version?: string;
  message: string;
}

export interface RuntimeAvailability {
  node: RuntimeToolStatus;
  npm: RuntimeToolStatus;
}

const missingNodeMessage = "未检测到 Node.js。请先安装 Node.js LTS，安装完成后重新打开软件或点击重新检测。";
const missingNpmMessage = "未检测到 npm。请先安装 Node.js LTS，安装完成后重新打开软件或点击重新检测。";

export function resolveRuntimeCommand(command: string, platform = process.platform): string {
  if (platform === "win32" && (command === "npm" || command === "npx")) {
    return `${command}.cmd`;
  }

  return command;
}

async function checkCommandVersion(command: string, args: string[], missingMessage: string): Promise<RuntimeToolStatus> {
  try {
    const result = await execFileAsync(resolveRuntimeCommand(command), args, {
      env: buildProcessEnv(),
      windowsHide: true,
      timeout: 5000
    });
    const version = (result.stdout || result.stderr).trim().split(/\s+/)[0] ?? "";
    return {
      ok: true,
      version,
      message: `${command} ${version}`.trim()
    };
  } catch {
    return {
      ok: false,
      message: missingMessage
    };
  }
}

export async function checkRuntimeAvailability(): Promise<RuntimeAvailability> {
  const [node, npm] = await Promise.all([
    checkCommandVersion("node", ["--version"], missingNodeMessage),
    checkCommandVersion("npm", ["--version"], missingNpmMessage)
  ]);

  return { node, npm };
}
