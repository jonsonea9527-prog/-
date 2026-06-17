import { describe, expect, it } from "vitest";
import { parsePort, parsePublicBaseUrl } from "../../src/server/config";

describe("parsePort", () => {
  it("defaults to 3000 when the value is undefined", () => {
    expect(parsePort(undefined)).toBe(3000);
  });

  it("uses a valid integer port", () => {
    expect(parsePort("5173")).toBe(5173);
  });

  it("falls back to 3000 for invalid ports", () => {
    expect(parsePort("not-a-port")).toBe(3000);
  });

  it("falls back to 3000 for out-of-range ports", () => {
    expect(parsePort("0")).toBe(3000);
    expect(parsePort("70000")).toBe(3000);
  });
});

describe("parsePublicBaseUrl", () => {
  it("returns null when the value is empty", () => {
    expect(parsePublicBaseUrl(undefined)).toBeNull();
    expect(parsePublicBaseUrl("")).toBeNull();
    expect(parsePublicBaseUrl("   ")).toBeNull();
  });

  it("keeps a non-empty url", () => {
    expect(parsePublicBaseUrl("https://demo.example.com")).toBe("https://demo.example.com");
  });
});
