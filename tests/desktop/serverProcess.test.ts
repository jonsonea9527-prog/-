import { describe, expect, it } from "vitest";
import { getDesktopServerUrl, getNextDesktopServerPort } from "../../src/desktop/runtimePaths";
import { buildDesktopServerNodeArgs } from "../../src/desktop/serverProcess";

describe("desktop server process helpers", () => {
  it("builds a controller url for any allocated port", () => {
    expect(getDesktopServerUrl(3000)).toBe("http://127.0.0.1:3000");
    expect(getDesktopServerUrl(3001)).toBe("http://127.0.0.1:3001");
  });

  it("increments the next fallback desktop port", () => {
    expect(getNextDesktopServerPort(3000)).toBe(3001);
    expect(getNextDesktopServerPort(3001)).toBe(3002);
  });

  it("uses a file URL for the packaged ESM loader and a plain path for the server entry", () => {
    expect(
      buildDesktopServerNodeArgs({
        isPackaged: true,
        tsxLoaderPath: "D:\\Apps\\Local Live Share\\resources\\app.asar\\node_modules\\tsx\\dist\\loader.mjs",
        serverEntryPath: "D:\\Apps\\Local Live Share\\resources\\app.asar\\src\\server\\server.ts"
      })
    ).toEqual([
      "--import",
      "file:///D:/Apps/Local%20Live%20Share/resources/app.asar/node_modules/tsx/dist/loader.mjs",
      "D:\\Apps\\Local Live Share\\resources\\app.asar\\src\\server\\server.ts"
    ]);
  });
});
