import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getBundledCloudflaredPath,
  getTunnelProxyUrl,
  isTunnelProxyReachable,
  parseCloudflaredUrl,
  parseTunnelError,
  parseTunnelUrl,
  withTimeout
} from "../../src/server/tunnelManager";
import net from "node:net";

describe("tunnelManager", () => {
  it("extracts the public localtunnel url from stdout", () => {
    const chunk = "your url is: https://demo-name.loca.lt\n";
    expect(parseTunnelUrl(chunk)).toBe("https://demo-name.loca.lt");
  });

  it("reports tunnel rate limits clearly", () => {
    expect(parseTunnelError("exceeded retry limit, last status: 429 Too Many Requests")).toBe(
      "公网隧道触发了 429 限流，请等待 10 分钟后再重试。"
    );
  });

  it("reports localtunnel timeouts clearly", () => {
    expect(parseTunnelError("context deadline exceeded")).toBe(
      "公网隧道连接超时，请稍后再试。"
    );
  });

  it("reports public URL creation timeouts clearly", () => {
    expect(parseTunnelError("localtunnel did not report a public url in time")).toBe(
      "localtunnel 没有及时返回公网地址，可能是当前网络无法连接 localtunnel 服务。"
    );
  });

  it("reports localtunnel access blocks clearly", () => {
    expect(parseTunnelError("connectex: An attempt was made to access a socket in a way forbidden by its access permissions.")).toBe(
      "当前网络或系统策略阻止了公网隧道连接。"
    );
  });

  it("extracts the public cloudflared url from output", () => {
    const chunk = "INF |  https://abc-def-ghi.trycloudflare.com  |\n";
    expect(parseCloudflaredUrl(chunk)).toBe("https://abc-def-ghi.trycloudflare.com");
  });

  it("ignores cloudflared api endpoints", () => {
    expect(parseCloudflaredUrl("https://api.trycloudflare.com")).toBeNull();
  });

  it("finds a bundled cloudflared sidecar", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cloudflared-sidecar-"));
    const executable = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
    fs.mkdirSync(path.join(root, "bin"));
    fs.writeFileSync(path.join(root, "bin", executable), "");

    expect(getBundledCloudflaredPath(root)).toBe(path.join(root, "bin", executable));
  });

  it("prefers an explicit tunnel proxy", () => {
    expect(getTunnelProxyUrl({
      TUNNEL_PROXY_URL: "http://127.0.0.1:7890",
      HTTPS_PROXY: "http://127.0.0.1:8080"
    })).toBe("http://127.0.0.1:7890");
  });

  it("normalizes proxy hosts without a scheme", () => {
    expect(getTunnelProxyUrl({
      TUNNEL_PROXY_URL: "127.0.0.1:7890"
    })).toBe("http://127.0.0.1:7890");
  });

  it("detects whether a local proxy port is reachable", async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      await expect(isTunnelProxyReachable(`http://127.0.0.1:${port}`, 500)).resolves.toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it("times out public tunnel creation instead of hanging forever", async () => {
    await expect(withTimeout(
      new Promise(() => undefined),
      1,
      "localtunnel did not report a public url in time"
    )).rejects.toThrow("localtunnel did not report a public url in time");
  });
});
