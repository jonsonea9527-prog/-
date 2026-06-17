import path from "node:path";

export interface DesktopPathOptions {
  isPackaged: boolean;
  appPath?: string;
  cwd?: string;
  userDataPath?: string;
}

export function getDesktopServerUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export function getNextDesktopServerPort(port: number): number {
  return port + 1;
}

export function getDesktopUserDataDir(options: DesktopPathOptions): string {
  if (options.isPackaged) {
    if (!options.userDataPath) {
      throw new Error("userDataPath is required in packaged mode");
    }

    return options.userDataPath;
  }

  return path.join(options.cwd ?? process.cwd(), "data");
}

export function getDesktopServerEntryPath(options: DesktopPathOptions): string {
  const appPath = options.appPath ?? process.cwd();
  return path.join(appPath, "src", "server", "server.ts");
}

export function getDesktopProcessCwd(options: DesktopPathOptions): string {
  const appPath = options.appPath ?? process.cwd();
  return options.isPackaged ? path.dirname(appPath) : appPath;
}

export function getDesktopTsxLoaderPath(options: DesktopPathOptions): string {
  const appPath = options.appPath ?? process.cwd();
  if (!options.isPackaged) {
    return "tsx";
  }

  return path.join(appPath, "node_modules", "tsx", "dist", "loader.mjs");
}

export function getDesktopEsbuildBinaryPath(options: DesktopPathOptions): string | null {
  if (!options.isPackaged) {
    return null;
  }

  const appPath = options.appPath ?? process.cwd();
  return path.join(
    `${appPath}.unpacked`,
    "node_modules",
    "@esbuild",
    "win32-x64",
    "esbuild.exe"
  );
}
