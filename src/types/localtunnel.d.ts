declare module "localtunnel" {
  interface LocalTunnelClient {
    url?: string;
    close(): void;
    on?(event: string, listener: (...args: unknown[]) => void): unknown;
  }

  interface LocalTunnelOptions {
    port: number;
    local_host?: string;
    host?: string;
    subdomain?: string;
  }

  export default function localtunnel(options: LocalTunnelOptions): Promise<LocalTunnelClient>;
}
