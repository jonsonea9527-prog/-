import { describe, expect, it } from "vitest";
import { decodePickedFolder } from "../../src/server/folderPicker";

describe("folderPicker", () => {
  it("decodes a utf8 base64 folder path with Chinese characters", () => {
    const original = "C:\\Users\\ZhuanZ（无密码）\\Desktop\\前端展示";
    const encoded = Buffer.from(original, "utf8").toString("base64");
    expect(decodePickedFolder(encoded)).toBe(original);
  });

  it("returns null for empty output", () => {
    expect(decodePickedFolder("")).toBeNull();
    expect(decodePickedFolder("   ")).toBeNull();
  });

  it("rejects invalid non-base64 output", () => {
    expect(() => decodePickedFolder("not-a-valid-picker-result")).toThrow("folder picker returned invalid output");
  });
});
