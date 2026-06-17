import path from "node:path";

const rootDir = process.cwd();
const defaultPort = 3000;

export function parsePort(value: string | undefined): number {
  if (value === undefined || !/^\d+$/.test(value)) {
    return defaultPort;
  }

  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : defaultPort;
}

export function parsePublicBaseUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function createConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    port: parsePort(env.PORT),
    dataDir: env.DATA_DIR ?? path.join(rootDir, "data"),
    publicBaseUrl: parsePublicBaseUrl(env.PUBLIC_BASE_URL),
    sessionCookieName: "preview_session",
    uploadMaxBytes: 100 * 1024 * 1024,
    extractedMaxBytes: 500 * 1024 * 1024,
    buildTimeoutMs: 10 * 60 * 1000,
    adminUsername: env.ADMIN_USERNAME ?? "admin",
    adminPassword: env.ADMIN_PASSWORD ?? "admin123"
  };
}

export const config = createConfig();
