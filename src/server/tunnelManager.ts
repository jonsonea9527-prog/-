import { execFileSync } from "node:child_process";
import { lookup } from "node:dns/promises";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import localtunnel from "localtunnel";
import type { RunningProcess } from "./processRunner";
import { startProcess } from "./processRunner";

export type TunnelProvider = "cloudflared" | "localtunnel";

const tryCloudflareApiHost = "api.trycloudflare.com";

function isReservedBenchmarkIp(address: string): boolean {
  return /^198\.18\./.test(address) || /^198\.19\./.test(address);
}

export function parseTunnelUrl(text: string): string | null {
  const match = text.match(/https:\/\/[A-Za-z0-9-]+\.loca\.lt/);
  return match?.[0] ?? null;
}

export function parseCloudflaredUrl(text: string): string | null {
  const match = text.match(/https:\/\/[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+\.trycloudflare\.com/);
  return match?.[0] ?? null;
}

export function parseTunnelError(text: string): string | null {
  if (/429|too many requests|rate limit/i.test(text)) {
    return "公网隧道触发了 429 限流，请等待 10 分钟后再重试。";
  }

  if (/connection refused|ECONNREFUSED/i.test(text)) {
    return "本地服务尚未启动成功，公网地址创建失败。";
  }

  if (/context deadline exceeded|timeout|Client\.Timeout exceeded/i.test(text)) {
    return "公网隧道连接超时，请稍后再试。";
  }

  if (/did not report a public url in time|did not report a public url/i.test(text)) {
    return "localtunnel 没有及时返回公网地址，可能是当前网络无法连接 localtunnel 服务。";
  }

  if (/access permissions|forbidden by its access permissions|connectex/i.test(text)) {
    return "当前网络或系统策略阻止了公网隧道连接。";
  }

  if (/api\.trycloudflare\.com|failed to request quick Tunnel/i.test(text)) {
    if (/198\.18\.|198\.19\./i.test(text)) {
      return "当前网络把 Cloudflare Quick Tunnel 解析到了保留地址，无法生成可用的公网地址。";
    }

    return "Cloudflare Quick Tunnel 创建失败。";
  }

  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\r?\n/).at(-1) ?? null : null;
}

export interface StartedTunnel {
  process: RunningProcess;
  publicUrl: Promise<string>;
  provider: TunnelProvider;
}

interface LocalTunnelClient {
  url?: string;
  close(): void;
  on?(event: string, listener: (...args: unknown[]) => void): unknown;
}

function normalizeProxyUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  if (/^[a-z]+:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `http://${trimmed}`;
}

function parseWindowsProxyServer(value: string): string | null {
  const match = value.match(/ProxyServer\s+REG_\w+\s+(.+)/i);
  const proxyServer = match?.[1]?.trim();
  if (!proxyServer) {
    return null;
  }

  const httpProxy = proxyServer
    .split(";")
    .map((item) => item.trim())
    .find((item) => /^https?=/i.test(item));

  return normalizeProxyUrl(httpProxy ? httpProxy.replace(/^https?=/i, "") : proxyServer);
}

function getWindowsSystemProxyUrl(): string | null {
  if (process.platform !== "win32") {
    return null;
  }

  try {
    const enableOutput = execFileSync("reg", [
      "query",
      "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
      "/v",
      "ProxyEnable"
    ], { encoding: "utf8", timeout: 2000 });

    if (!/0x1\b/i.test(enableOutput)) {
      return null;
    }

    const serverOutput = execFileSync("reg", [
      "query",
      "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
      "/v",
      "ProxyServer"
    ], { encoding: "utf8", timeout: 2000 });

    return parseWindowsProxyServer(serverOutput);
  } catch {
    return null;
  }
}

export async function isTunnelProxyReachable(proxyUrl: string, timeoutMs = 1500): Promise<boolean> {
  try {
    const parsed = new URL(proxyUrl);
    const hostname = parsed.hostname;
    const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
    if (!hostname || !Number.isFinite(port)) {
      return false;
    }

    return await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host: hostname, port });
      const finish = (ok: boolean) => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(ok);
      };

      socket.setTimeout(timeoutMs);
      socket.once("connect", () => finish(true));
      socket.once("timeout", () => finish(false));
      socket.once("error", () => finish(false));
    });
  } catch {
    return false;
  }
}

export function getTunnelProxyUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const configuredProxy = env.TUNNEL_PROXY_URL
    ?? env.HTTPS_PROXY
    ?? env.HTTP_PROXY
    ?? env.ALL_PROXY
    ?? env.https_proxy
    ?? env.http_proxy
    ?? env.all_proxy
    ?? null;

  return normalizeProxyUrl(configuredProxy)
    ?? getWindowsSystemProxyUrl();
}

export async function getReachableTunnelProxyUrl(): Promise<string | null> {
  const proxyUrl = getTunnelProxyUrl();
  if (!proxyUrl) {
    return null;
  }

  return await isTunnelProxyReachable(proxyUrl) ? proxyUrl : null;
}

function buildTunnelEnv(proxyUrl = getTunnelProxyUrl()): NodeJS.ProcessEnv | undefined {
  if (!proxyUrl) {
    return undefined;
  }

  return {
    ...process.env,
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    ALL_PROXY: proxyUrl,
    http_proxy: proxyUrl,
    https_proxy: proxyUrl,
    all_proxy: proxyUrl
  };
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function formatTunnelError(provider: TunnelProvider, output: string, fallback: string): string {
  if (provider === "localtunnel") {
    const proxyUrl = getTunnelProxyUrl();
    if (proxyUrl) {
      return `${fallback} 当前系统还配置了代理：${proxyUrl}。如果公网地址仍然打不开，请检查系统代理设置。`;
    }

    return fallback;
  }

  if (!/api\.trycloudflare\.com|failed to request quick Tunnel/i.test(output)) {
    return fallback;
  }

  return `${fallback} 当前设备网络暂时无法访问 Cloudflare Quick Tunnel。`;
}

async function assertTryCloudflareApiReachability() {
  const { address } = await lookup(tryCloudflareApiHost, { family: 4 });
  if (isReservedBenchmarkIp(address)) {
    throw new Error(
      `当前设备将 ${tryCloudflareApiHost} 解析到了保留地址 ${address}，因此无法创建可用的公网地址。`
    );
  }
}

export function getBundledCloudflaredPath(rootDir = globalThis.process.cwd()): string | null {
  const executable = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
  const candidates = [
    path.join(rootDir, "bin", executable),
    path.join(rootDir, "resources", "bin", executable)
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function waitForTunnelUrl(input: {
  process: RunningProcess;
  provider: TunnelProvider;
  parseUrl: (text: string) => string | null;
  timeoutMs?: number;
}): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let lastOutput = "";
    const onOutput = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      lastOutput += text;
      const url = input.parseUrl(text);
      if (url) {
        cleanup();
        resolve(url);
      }
    };

    const onExit = () => {
      cleanup();
      reject(new Error(formatTunnelError(
        input.provider,
        lastOutput,
        parseTunnelError(lastOutput) ?? `${input.provider} exited before reporting a public url`
      )));
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(formatTunnelError(
        input.provider,
        lastOutput,
        parseTunnelError(lastOutput) ?? `${input.provider} did not report a public url in time`
      )));
    }, input.timeoutMs ?? 30000);

    const cleanup = () => {
      clearTimeout(timeout);
      input.process.child.stdout.off("data", onOutput);
      input.process.child.stderr.off("data", onOutput);
      input.process.child.off("close", onExit);
      input.process.child.off("error", onError);
    };

    input.process.child.stdout.on("data", onOutput);
    input.process.child.stderr.on("data", onOutput);
    input.process.child.on("close", onExit);
    input.process.child.on("error", onError);

    if (input.process.child.exitCode !== null || input.process.child.signalCode !== null) {
      onExit();
    }
  });
}

export function startCloudflaredTunnel(port: number, cloudflaredPath = getBundledCloudflaredPath() ?? "cloudflared"): StartedTunnel {
  const tunnelProcess = startProcess(
    cloudflaredPath,
    ["tunnel", "--protocol", "http2", "--url", `http://localhost:${port}`],
    globalThis.process.cwd(),
    { env: buildTunnelEnv() }
  );

  const publicUrl = (async () => {
    await assertTryCloudflareApiReachability();
    return await waitForTunnelUrl({
      process: tunnelProcess,
      provider: "cloudflared",
      parseUrl: parseCloudflaredUrl,
      timeoutMs: 45000
    });
  })();

  return {
    process: tunnelProcess,
    provider: "cloudflared",
    publicUrl
  };
}

export function startLocalTunnel(port: number): StartedTunnel {
  let client: LocalTunnelClient | null = null;
  let stopped = false;
  const publicUrl = (async () => {
    const previousHttpProxy = process.env.HTTP_PROXY;
    const previousHttpsProxy = process.env.HTTPS_PROXY;
    const previousAllProxy = process.env.ALL_PROXY;
    const previousHttpProxyLower = process.env.http_proxy;
    const previousHttpsProxyLower = process.env.https_proxy;
    const previousAllProxyLower = process.env.all_proxy;
    const proxyUrl = await getReachableTunnelProxyUrl();
    const proxyEnv = buildTunnelEnv(proxyUrl);

    try {
      if (proxyEnv) {
        process.env.HTTP_PROXY = proxyEnv.HTTP_PROXY;
        process.env.HTTPS_PROXY = proxyEnv.HTTPS_PROXY;
        process.env.ALL_PROXY = proxyEnv.ALL_PROXY;
        process.env.http_proxy = proxyEnv.http_proxy;
        process.env.https_proxy = proxyEnv.https_proxy;
        process.env.all_proxy = proxyEnv.all_proxy;
      }

      client = await withTimeout(
        localtunnel({
          port,
          local_host: "127.0.0.1",
          host: "https://localtunnel.me"
        }) as Promise<LocalTunnelClient>,
        45000,
        "localtunnel did not report a public url in time"
      );

      const tunnelUrl = client.url?.trim();
      if (!tunnelUrl) {
        throw new Error("localtunnel did not report a public url");
      }

      return tunnelUrl;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(parseTunnelError(message) ?? message);
    } finally {
      process.env.HTTP_PROXY = previousHttpProxy;
      process.env.HTTPS_PROXY = previousHttpsProxy;
      process.env.ALL_PROXY = previousAllProxy;
      process.env.http_proxy = previousHttpProxyLower;
      process.env.https_proxy = previousHttpsProxyLower;
      process.env.all_proxy = previousAllProxyLower;
    }
  })();

  return {
    provider: "localtunnel",
    publicUrl,
    process: {
      child: {} as RunningProcess["child"],
      async stop() {
        if (stopped) {
          return;
        }

        stopped = true;
        client?.close();
      }
    }
  };
}

export function startTunnel(port: number): StartedTunnel {
  return startLocalTunnel(port);
}
