import { describe, expect, it } from "vitest";
import { resolveRuntimeCommand } from "../../src/server/runtimeChecks";

describe("runtimeChecks", () => {
  it("uses npm.cmd on Windows for runtime detection", () => {
    expect(resolveRuntimeCommand("npm", "win32")).toBe("npm.cmd");
    expect(resolveRuntimeCommand("npx", "win32")).toBe("npx.cmd");
    expect(resolveRuntimeCommand("node", "win32")).toBe("node");
  });

  it("keeps commands unchanged outside Windows", () => {
    expect(resolveRuntimeCommand("npm", "linux")).toBe("npm");
    expect(resolveRuntimeCommand("node", "linux")).toBe("node");
  });
});
