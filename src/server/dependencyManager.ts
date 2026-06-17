import fs from "node:fs";
import path from "node:path";
import { buildWindowsProjectCommandLine } from "./projectLaunchPath";
import { runCommand, runCommandLine } from "./processRunner";

function hasInstalledDependencies(projectPath: string): boolean {
  const nodeModulesDir = path.join(projectPath, "node_modules");
  const viteBinary = path.join(nodeModulesDir, ".bin", process.platform === "win32" ? "vite.cmd" : "vite");
  return fs.existsSync(nodeModulesDir) && fs.existsSync(viteBinary);
}

export async function ensureProjectDependencies(projectPath: string, driveLetter?: string): Promise<void> {
  if (hasInstalledDependencies(projectPath)) {
    return;
  }

  const result = process.platform === "win32" && driveLetter
    ? await runCommandLine(buildWindowsProjectCommandLine(projectPath, driveLetter, "npm", ["install"]), process.cwd())
    : await runCommand("npm", ["install"], projectPath);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "npm install failed");
  }
}
