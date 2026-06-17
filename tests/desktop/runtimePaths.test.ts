import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getDesktopProcessCwd,
  getDesktopEsbuildBinaryPath,
  getDesktopTsxLoaderPath,
  getDesktopServerEntryPath,
  getDesktopServerUrl,
  getDesktopUserDataDir
} from "../../src/desktop/runtimePaths";

describe("desktop runtime paths", () => {
  it("builds the controller url from the configured port", () => {
    expect(getDesktopServerUrl(3000)).toBe("http://127.0.0.1:3000");
  });

  it("uses the app data path in packaged mode", () => {
    expect(getDesktopUserDataDir({
      isPackaged: true,
      userDataPath: "C:\\Users\\demo\\AppData\\Roaming\\Live Share"
    })).toBe("C:\\Users\\demo\\AppData\\Roaming\\Live Share");
  });

  it("keeps workspace data inside the project during local development", () => {
    expect(getDesktopUserDataDir({
      isPackaged: false,
      cwd: "C:\\workspace\\live-share"
    })).toBe(path.join("C:\\workspace\\live-share", "data"));
  });

  it("points packaged builds at the source server entry", () => {
    expect(getDesktopServerEntryPath({
      isPackaged: true,
      appPath: "C:\\Apps\\Live Share\\resources\\app.asar"
    })).toBe(path.join("C:\\Apps\\Live Share\\resources\\app.asar", "src", "server", "server.ts"));
  });

  it("points local development at the source server entry", () => {
    expect(getDesktopServerEntryPath({
      isPackaged: false,
      appPath: "C:\\workspace\\live-share"
    })).toBe(path.join("C:\\workspace\\live-share", "src", "server", "server.ts"));
  });

  it("uses the packaged app path as cwd so bundled client assets remain resolvable", () => {
    const packagedAppPath = "C:\\Apps\\Local Live Share\\resources\\app.asar";

    expect(path.join(packagedAppPath, "dist", "client")).toBe(
      "C:\\Apps\\Local Live Share\\resources\\app.asar\\dist\\client"
    );
  });

  it("uses a real directory as packaged process cwd", () => {
    expect(getDesktopProcessCwd({
      isPackaged: true,
      appPath: "C:\\Apps\\Local Live Share\\resources\\app.asar"
    })).toBe(path.dirname("C:\\Apps\\Local Live Share\\resources\\app.asar"));
  });

  it("keeps the workspace root as dev process cwd", () => {
    expect(getDesktopProcessCwd({
      isPackaged: false,
      appPath: "C:\\workspace\\live-share"
    })).toBe("C:\\workspace\\live-share");
  });

  it("resolves the packaged tsx loader from bundled node_modules", () => {
    expect(getDesktopTsxLoaderPath({
      isPackaged: true,
      appPath: "C:\\Apps\\Local Live Share\\resources\\app.asar"
    })).toBe(path.join(
      "C:\\Apps\\Local Live Share\\resources\\app.asar",
      "node_modules",
      "tsx",
      "dist",
      "loader.mjs"
    ));
  });

  it("uses the package name tsx in development", () => {
    expect(getDesktopTsxLoaderPath({
      isPackaged: false,
      appPath: "C:\\workspace\\live-share"
    })).toBe("tsx");
  });

  it("points packaged esbuild at the unpacked binary", () => {
    expect(getDesktopEsbuildBinaryPath({
      isPackaged: true,
      appPath: "C:\\Apps\\Local Live Share\\resources\\app.asar"
    })).toBe(path.join(
      "C:\\Apps\\Local Live Share\\resources\\app.asar.unpacked",
      "node_modules",
      "@esbuild",
      "win32-x64",
      "esbuild.exe"
    ));
  });

  it("does not force an esbuild binary path during development", () => {
    expect(getDesktopEsbuildBinaryPath({
      isPackaged: false,
      appPath: "C:\\workspace\\live-share"
    })).toBeNull();
  });
});
