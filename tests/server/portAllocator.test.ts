import { describe, expect, it } from "vitest";
import { choosePort, createRandomPortStart } from "../../src/server/portAllocator";

describe("portAllocator", () => {
  it("prefers the requested port when it is available", async () => {
    const port = await choosePort({ preferredPort: 5174, startPort: 5173 });
    expect(port).toBe(5174);
  });

  it("skips ports already reserved by other project starts", async () => {
    const port = await choosePort({
      preferredPort: null,
      startPort: 5173,
      excludedPorts: new Set([5173, 5174])
    });

    expect(port).toBe(5175);
  });

  it("creates a random start port inside the configured share range", () => {
    expect(createRandomPortStart(() => 0)).toBe(4200);
    expect(createRandomPortStart(() => 0.99999)).toBeLessThanOrEqual(65000);
    expect(createRandomPortStart(() => 0.5)).toBeGreaterThan(4200);
  });
});
