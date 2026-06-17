import { getReachableTunnelProxyUrl, getTunnelProxyUrl } from "./tunnelManager";

export interface TunnelAvailability {
  ok: boolean;
  message: string;
}

export async function checkLocalTunnelAvailability(): Promise<TunnelAvailability> {
  const proxyUrl = getTunnelProxyUrl();
  if (!proxyUrl) {
    return {
      ok: true,
      message: "当前默认使用 localtunnel 免费公网通道来创建分享链接。"
    };
  }

  const reachableProxyUrl = await getReachableTunnelProxyUrl();
  if (!reachableProxyUrl) {
    return {
      ok: true,
      message: `当前默认使用 localtunnel 免费公网通道。检测到系统代理 ${proxyUrl}，但该代理端口当前不可连接，创建公网地址时会自动绕过它。`
    };
  }

  return {
    ok: true,
    message: `当前默认使用 localtunnel 免费公网通道。系统里还配置了可用代理：${reachableProxyUrl}。如果生成的公网地址打不开，请先检查系统代理设置。`
  };
}
