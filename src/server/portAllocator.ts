import net from "node:net";

const defaultRandomPortMin = 4200;
const defaultRandomPortMax = 65000;

async function isPortAvailable(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

export function createRandomPortStart(random = Math.random): number {
  const size = defaultRandomPortMax - defaultRandomPortMin + 1;
  return defaultRandomPortMin + Math.floor(random() * size);
}

export async function choosePort(input: {
  preferredPort: number | null;
  startPort: number;
  excludedPorts?: Set<number>;
}): Promise<number> {
  if (
    input.preferredPort
    && !input.excludedPorts?.has(input.preferredPort)
    && await isPortAvailable(input.preferredPort)
  ) {
    return input.preferredPort;
  }

  let port = input.startPort;
  while (input.excludedPorts?.has(port) || !(await isPortAvailable(port))) {
    port += 1;
  }

  return port;
}
