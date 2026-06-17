import { describe, expect, it } from "vitest";
import { checkUrlHealth } from "../../src/server/urlHealth";

describe("urlHealth", () => {
  it("retries transient public URL failures before reporting success", async () => {
    let attempts = 0;

    const result = await checkUrlHealth("https://demo.loca.lt", {
      timeoutMs: 1000,
      attemptTimeoutMs: 50,
      retryDelayMs: 1,
      diagnoseHost: async () => null,
      fetchImpl: async () => {
        attempts += 1;
        return new Response("ok", {
          status: attempts === 1 ? 502 : 200
        });
      }
    });

    expect(result).toEqual({ ok: true, message: "reachable" });
    expect(attempts).toBe(2);
  });

  it("reports aborted public URL checks as timeout messages", async () => {
    const result = await checkUrlHealth("https://demo.loca.lt", {
      timeoutMs: 10,
      attemptTimeoutMs: 5,
      retryDelayMs: 1,
      diagnoseHost: async () => null,
      fetchImpl: async () => {
        throw new DOMException("This operation was aborted", "AbortError");
      }
    });

    expect(result).toEqual({
      ok: false,
      message: "公网地址访问超时，可能仍在启动，或当前网络无法访问 loca.lt。"
    });
  });

  it("turns localtunnel bad gateway responses into actionable guidance", async () => {
    const result = await checkUrlHealth("https://demo.loca.lt", {
      timeoutMs: 10,
      attemptTimeoutMs: 5,
      retryDelayMs: 1,
      diagnoseHost: async () => null,
      fetchImpl: async () => new Response("Bad Gateway", { status: 502 })
    });

    expect(result).toEqual({
      ok: false,
      message: "公网地址已生成，但 localtunnel 暂时无法转发到本机预览服务。请先确认本地地址能打开，然后点击重新检测公网；如果仍然失败，请停止后重新启动分享。"
    });
  });
});
