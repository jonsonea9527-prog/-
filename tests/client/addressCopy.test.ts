import { describe, expect, it } from "vitest";
import {
  buildAllAddressCopyText,
  canCopyAnyAddress
} from "../../src/client/addressCopy";

describe("addressCopy", () => {
  it("formats both addresses for bulk copy", () => {
    expect(buildAllAddressCopyText({
      localUrl: "http://localhost:4173/",
      publicUrl: "https://rare-wings-itch.loca.lt"
    })).toBe([
      "本地地址",
      "http://localhost:4173/",
      "公网地址",
      "https://rare-wings-itch.loca.lt"
    ].join("\n"));
  });

  it("omits missing address sections", () => {
    expect(buildAllAddressCopyText({
      localUrl: "http://localhost:4173/",
      publicUrl: null
    })).toBe([
      "本地地址",
      "http://localhost:4173/"
    ].join("\n"));

    expect(buildAllAddressCopyText({
      localUrl: null,
      publicUrl: "https://rare-wings-itch.loca.lt"
    })).toBe([
      "公网地址",
      "https://rare-wings-itch.loca.lt"
    ].join("\n"));
  });

  it("reports whether any address is available to copy", () => {
    expect(canCopyAnyAddress({
      localUrl: "http://localhost:4173/",
      publicUrl: null
    })).toBe(true);

    expect(canCopyAnyAddress({
      localUrl: null,
      publicUrl: "https://rare-wings-itch.loca.lt"
    })).toBe(true);

    expect(canCopyAnyAddress({
      localUrl: null,
      publicUrl: null
    })).toBe(false);
  });
});
