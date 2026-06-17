import fs from "node:fs";
import path from "node:path";

export type ProjectInspectionResult =
  | { ok: true; name: string; projectPath: string; packageManager: "npm" }
  | { ok: false; error: "path not found" | "missing package.json" | "missing dev script" | "not a vite project" };

interface PackageJsonShape {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export async function inspectLocalProject(projectPath: string): Promise<ProjectInspectionResult> {
  if (!fs.existsSync(projectPath)) {
    return { ok: false, error: "path not found" };
  }

  const packageJsonPath = path.join(projectPath, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return { ok: false, error: "missing package.json" };
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as PackageJsonShape;
  const devScript = packageJson.scripts?.dev ?? "";
  if (!devScript) {
    return { ok: false, error: "missing dev script" };
  }

  const hasVite = devScript.includes("vite")
    || Boolean(packageJson.dependencies?.vite)
    || Boolean(packageJson.devDependencies?.vite);
  if (!hasVite) {
    return { ok: false, error: "not a vite project" };
  }

  return {
    ok: true,
    name: packageJson.name?.trim() || path.basename(projectPath),
    projectPath,
    packageManager: "npm"
  };
}
