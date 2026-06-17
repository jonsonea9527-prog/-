import { lookup } from "node:dns/promises";

export interface UrlHealthResult {
  ok: boolean;
  message: string;
}

interface UrlHealthOptions {
  attemptTimeoutMs?: number;
  diagnoseHost?: (url: string) => Promise<string | null>;
  fetchImpl?: typeof fetch;
  retryDelayMs?: number;
  timeoutMs?: number;
}

function isReservedBenchmarkIp(address: string): boolean {
  return /^198\.18\./.test(address) || /^198\.19\./.test(address);
}

async function diagnoseUrlHost(url: string): Promise<string | null> {
  try {
    const hostname = new URL(url).hostname;
    const { address } = await lookup(hostname, { family: 4 });
    if (isReservedBenchmarkIp(address)) {
      return `this machine resolves ${hostname} to ${address}, which suggests the local proxy or TUN DNS is intercepting the public URL`;
    }
  } catch {
    return null;
  }

  return null;
}

function normalizeOptions(input?: number | UrlHealthOptions): Required<UrlHealthOptions> {
  const options = typeof input === "number" ? { timeoutMs: input } : input ?? {};
  return {
    attemptTimeoutMs: options.attemptTimeoutMs ?? 5000,
    diagnoseHost: options.diagnoseHost ?? diagnoseUrlHost,
    fetchImpl: options.fetchImpl ?? fetch,
    retryDelayMs: options.retryDelayMs ?? 1000,
    timeoutMs: options.timeoutMs ?? 8000
  };
}

function describeHttpFailure(status: number): string {
  if (status === 502 || status === 504) {
    return "公网地址已生成，但 localtunnel 暂时无法转发到本机预览服务。请先确认本地地址能打开，然后点击重新检测公网；如果仍然失败，请停止后重新启动分享。";
  }

  if (status === 404) {
    return "公网地址可以访问，但目标页面返回 404。请确认项目构建后的首页路径是否正确。";
  }

  return `returned HTTP ${status}`;
}

export async function checkUrlHealth(url: string, input?: number | UrlHealthOptions): Promise<UrlHealthResult> {
  const options = normalizeOptions(input);
  const deadline = Date.now() + options.timeoutMs;
  let lastMessage = "connection failed; the public tunnel may still be starting or this machine cannot reach the public URL";

  while (Date.now() < deadline) {
    const remainingMs = Math.max(1, deadline - Date.now());
    const result = await checkUrlOnce(url, {
      attemptTimeoutMs: Math.min(options.attemptTimeoutMs, remainingMs),
      diagnoseHost: options.diagnoseHost,
      fetchImpl: options.fetchImpl
    });

    if (result.ok) {
      return result;
    }

    lastMessage = result.message;
    const delayMs = Math.min(options.retryDelayMs, Math.max(0, deadline - Date.now()));
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return {
    ok: false,
    message: lastMessage
  };
}

async function checkUrlOnce(url: string, options: {
  attemptTimeoutMs: number;
  diagnoseHost: (url: string) => Promise<string | null>;
  fetchImpl: typeof fetch;
}): Promise<UrlHealthResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.attemptTimeoutMs);

  try {
    const response = await options.fetchImpl(url, {
      method: "GET",
      signal: controller.signal
    });

    if (response.ok) {
      return { ok: true, message: "reachable" };
    }

    return {
      ok: false,
      message: describeHttpFailure(response.status)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const hostDiagnosis = await options.diagnoseHost(url);
    if (error instanceof DOMException && error.name === "AbortError") {
      return {
        ok: false,
        message: "公网地址访问超时，可能仍在启动，或当前网络无法访问 loca.lt。"
      };
    }

    return {
      ok: false,
      message: hostDiagnosis
        ?? (/fetch failed|aborted|abort/i.test(message)
          ? "connection failed; the public tunnel may still be starting or this machine cannot reach the public URL"
          : message)
    };
  } finally {
    clearTimeout(timeout);
  }
}
