import { describe, expect, it } from "vitest";
import { createPasswordHash, verifyPassword } from "../../src/server/auth";

describe("password helpers", () => {
  it("verifies a matching password", async () => {
    const hash = await createPasswordHash("secret123");
    await expect(verifyPassword("secret123", hash)).resolves.toBe(true);
  });

  it("rejects a different password", async () => {
    const hash = await createPasswordHash("secret123");
    await expect(verifyPassword("wrong", hash)).resolves.toBe(false);
  });

  it("rejects invalid hash formats", async () => {
    const hash = await createPasswordHash("secret123");
    await expect(verifyPassword("secret123", "bad-format")).resolves.toBe(false);
    await expect(verifyPassword("secret123", `${hash}:junk`)).resolves.toBe(false);
    await expect(verifyPassword("secret123", `${hash}zz`)).resolves.toBe(false);
  });
});
