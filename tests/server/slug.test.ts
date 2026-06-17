import { describe, expect, it } from "vitest";
import { makeSlug } from "../../src/server/slug";

describe("makeSlug", () => {
  it("converts mixed project names into stable slugs", () => {
    expect(makeSlug("Demo React \u9875\u9762 01")).toBe("demo-react-01");
  });

  it("falls back when all characters are removed", () => {
    const firstSlug = makeSlug("\u9875\u9762");

    expect(firstSlug).toMatch(/^project-[a-z0-9]{6}$/);
    expect(makeSlug("\u9875\u9762")).toBe(firstSlug);
  });

  it("does not leave a trailing dash after truncating long slugs", () => {
    expect(makeSlug(`${"a".repeat(63)} \u9875\u9762 b`)).toBe("a".repeat(63));
  });
});
