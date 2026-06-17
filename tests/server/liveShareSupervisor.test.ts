import { describe, expect, it, vi } from "vitest";
import type { StartedShareServer } from "../../src/server/shareServerManager";
import { createLiveShareSupervisor } from "../../src/server/liveShareSupervisor";
import type { StartedTunnel } from "../../src/server/tunnelManager";

describe("liveShareSupervisor", () => {
  it("starts a project and publishes running urls", async () => {
    const db = {
      updateLocalProjectRuntime: vi.fn(),
      getLocalProject: vi.fn(() => ({
        id: "p1",
        name: "Demo",
        projectPath: "C:\\demo",
        preferredPort: null
      }))
    } as any;

    const supervisor = createLiveShareSupervisor({
      db,
      prepareProjectLaunchPath: vi.fn(async () => "C:\\demo"),
      choosePort: vi.fn(async () => 5173),
      startShareServer: vi.fn((): StartedShareServer => ({
        process: { stop: vi.fn(), child: {} as never },
        localUrl: Promise.resolve("http://localhost:5173/")
      })),
      startTunnel: vi.fn((): StartedTunnel => ({
        process: { stop: vi.fn(), child: {} as never },
        provider: "localtunnel",
        publicUrl: Promise.resolve("https://demo.loca.lt")
      })),
      checkUrlHealth: vi.fn(async () => ({ ok: true, message: "ok" }))
    });

    await supervisor.start("p1");

    expect(db.updateLocalProjectRuntime).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({
        runtimeStatus: "running",
        localUrl: "http://localhost:5173/",
        publicUrl: "https://demo.loca.lt",
        lastError: null,
        stepIndex: 4,
        stepTotal: 4,
        stepLabel: "Ready"
      })
    );
  });

  it("stops all running projects when the host app exits", async () => {
    const firstShareStop = vi.fn(async () => undefined);
    const secondShareStop = vi.fn(async () => undefined);
    const firstTunnelStop = vi.fn(async () => undefined);
    const secondTunnelStop = vi.fn(async () => undefined);
    const db = {
      updateLocalProjectRuntime: vi.fn(),
      getLocalProject: vi.fn((projectId: string) => ({
        id: projectId,
        name: `Demo-${projectId}`,
        projectPath: `C:\\${projectId}`,
        preferredPort: null
      }))
    } as any;

    let shareStartCount = 0;
    let tunnelStartCount = 0;
    const supervisor = createLiveShareSupervisor({
      db,
      prepareProjectLaunchPath: vi.fn(async (projectId: string) => `C:\\${projectId}`),
      choosePort: vi.fn(async () => shareStartCount + 4173),
      startShareServer: vi.fn((): StartedShareServer => {
        shareStartCount += 1;
        return {
          process: {
            child: {} as never,
            stop: shareStartCount === 1 ? firstShareStop : secondShareStop
          },
          localUrl: Promise.resolve(`http://localhost:${4172 + shareStartCount}/`)
        };
      }),
      startTunnel: vi.fn((): StartedTunnel => {
        tunnelStartCount += 1;
        return {
          process: {
            child: {} as never,
            stop: tunnelStartCount === 1 ? firstTunnelStop : secondTunnelStop
          },
          provider: "localtunnel",
          publicUrl: Promise.resolve(`https://demo-${tunnelStartCount}.loca.lt`)
        };
      }),
      checkUrlHealth: vi.fn(async () => ({ ok: true, message: "ok" }))
    });

    await supervisor.start("p1");
    await supervisor.start("p2");
    await supervisor.stopAll();

    expect(firstTunnelStop).toHaveBeenCalledTimes(1);
    expect(secondTunnelStop).toHaveBeenCalledTimes(1);
    expect(firstShareStop).toHaveBeenCalledTimes(1);
    expect(secondShareStop).toHaveBeenCalledTimes(1);
    expect(db.updateLocalProjectRuntime).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({
        runtimeStatus: "idle",
        stepIndex: 0,
        stepTotal: 0,
        stepLabel: null
      })
    );
    expect(db.updateLocalProjectRuntime).toHaveBeenCalledWith(
      "p2",
      expect.objectContaining({
        runtimeStatus: "idle",
        stepIndex: 0,
        stepTotal: 0,
        stepLabel: null
      })
    );
  });

  it("excludes ports reserved by already running projects", async () => {
    const db = {
      updateLocalProjectRuntime: vi.fn(),
      getLocalProject: vi.fn((projectId: string) => ({
        id: projectId,
        name: `Demo-${projectId}`,
        projectPath: `C:\\${projectId}`,
        preferredPort: null
      }))
    } as any;
    const choosePort = vi.fn(async ({ excludedPorts }: { excludedPorts?: Set<number> }) => (
      excludedPorts?.has(4173) ? 4174 : 4173
    ));

    const supervisor = createLiveShareSupervisor({
      db,
      prepareProjectLaunchPath: vi.fn(async (projectId: string) => `C:\\${projectId}`),
      choosePort,
      startShareServer: vi.fn((projectPath: string, port: number): StartedShareServer => ({
        process: { stop: vi.fn(), child: {} as never },
        localUrl: Promise.resolve(`http://localhost:${port}/`)
      })),
      startTunnel: vi.fn((port: number): StartedTunnel => ({
        process: { stop: vi.fn(), child: {} as never },
        provider: "localtunnel",
        publicUrl: Promise.resolve(`https://demo-${port}.loca.lt`)
      })),
      checkUrlHealth: vi.fn(async () => ({ ok: true, message: "ok" }))
    });

    await supervisor.start("p1");
    await supervisor.start("p2");

    expect(choosePort).toHaveBeenNthCalledWith(2, expect.objectContaining({
      excludedPorts: new Set([4173])
    }));
  });

  it("keeps failed public tunnel runtimes stoppable", async () => {
    const shareStop = vi.fn(async () => undefined);
    const tunnelStop = vi.fn(async () => undefined);
    const db = {
      updateLocalProjectRuntime: vi.fn(),
      getLocalProject: vi.fn(() => ({
        id: "p1",
        name: "Demo",
        projectPath: "C:\\demo",
        preferredPort: null
      }))
    } as any;

    const supervisor = createLiveShareSupervisor({
      db,
      prepareProjectLaunchPath: vi.fn(async () => "C:\\demo"),
      choosePort: vi.fn(async () => 4173),
      startShareServer: vi.fn((): StartedShareServer => ({
        process: { stop: shareStop, child: {} as never },
        localUrl: Promise.resolve("http://localhost:4173/")
      })),
      startTunnel: vi.fn((): StartedTunnel => ({
        process: { stop: tunnelStop, child: {} as never },
        provider: "localtunnel",
        publicUrl: Promise.resolve("https://demo.loca.lt")
      })),
      checkUrlHealth: vi.fn(async () => ({ ok: false, message: "connection failed" }))
    });

    await supervisor.start("p1");
    await supervisor.stop("p1");

    expect(tunnelStop).toHaveBeenCalledTimes(1);
    expect(shareStop).toHaveBeenCalledTimes(1);
  });

  it("keeps local preview running when public URL creation fails", async () => {
    const shareStop = vi.fn(async () => undefined);
    const tunnelStop = vi.fn(async () => undefined);
    const db = {
      updateLocalProjectRuntime: vi.fn(),
      getLocalProject: vi.fn(() => ({
        id: "p1",
        name: "Demo",
        projectPath: "C:\\demo",
        preferredPort: null
      }))
    } as any;

    const supervisor = createLiveShareSupervisor({
      db,
      prepareProjectLaunchPath: vi.fn(async () => "C:\\demo"),
      choosePort: vi.fn(async () => 4173),
      startShareServer: vi.fn((): StartedShareServer => ({
        process: { stop: shareStop, child: {} as never },
        localUrl: Promise.resolve("http://localhost:4173/")
      })),
      startTunnel: vi.fn((): StartedTunnel => ({
        process: { stop: tunnelStop, child: {} as never },
        provider: "localtunnel",
        publicUrl: Promise.reject(new Error("localtunnel did not report a public url in time"))
      })),
      checkUrlHealth: vi.fn(async () => ({ ok: true, message: "ok" }))
    });

    await supervisor.start("p1");

    expect(db.updateLocalProjectRuntime).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({
        runtimeStatus: "running",
        localUrl: "http://localhost:4173/",
        publicUrl: null,
        lastError: "localtunnel 没有及时返回公网地址，可能是当前网络无法连接 localtunnel 服务。",
        stepLabel: "Ready"
      })
    );

    await supervisor.stop("p1");
    expect(tunnelStop).toHaveBeenCalledTimes(1);
    expect(shareStop).toHaveBeenCalledTimes(1);
  });

  it("skips public tunnel creation during global rate-limit cooldown while keeping local preview running", async () => {
    const db = {
      updateLocalProjectRuntime: vi.fn(),
      getLocalProject: vi.fn((projectId: string) => ({
        id: projectId,
        name: `Demo-${projectId}`,
        projectPath: `C:\\${projectId}`,
        preferredPort: null,
        lastError: null,
        updatedAt: new Date().toISOString()
      }))
    } as any;
    const startTunnel = vi.fn((): StartedTunnel => ({
      process: { stop: vi.fn(), child: {} as never },
      provider: "localtunnel",
      publicUrl: Promise.reject(new Error("429 Too Many Requests"))
    }));

    const supervisor = createLiveShareSupervisor({
      db,
      prepareProjectLaunchPath: vi.fn(async (projectId: string) => `C:\\${projectId}`),
      choosePort: vi.fn(async (_options) => _options.excludedPorts?.has(4173) ? 4174 : 4173),
      startShareServer: vi.fn((_projectPath: string, port: number): StartedShareServer => ({
        process: { stop: vi.fn(), child: {} as never },
        localUrl: Promise.resolve(`http://localhost:${port}/`)
      })),
      startTunnel,
      checkUrlHealth: vi.fn(async () => ({ ok: true, message: "ok" }))
    });

    await supervisor.start("p1");
    await supervisor.start("p2");

    expect(startTunnel).toHaveBeenCalledTimes(1);
    expect(db.updateLocalProjectRuntime).toHaveBeenCalledWith(
      "p2",
      expect.objectContaining({
        runtimeStatus: "running",
        localUrl: "http://localhost:4174/",
        publicUrl: null,
        stepLabel: "Ready"
      })
    );
  });

  it("keeps the project running when public URL health check fails after URL creation", async () => {
    const db = {
      updateLocalProjectRuntime: vi.fn(),
      getLocalProject: vi.fn(() => ({
        id: "p1",
        name: "Demo",
        projectPath: "C:\\demo",
        preferredPort: null
      }))
    } as any;

    const supervisor = createLiveShareSupervisor({
      db,
      prepareProjectLaunchPath: vi.fn(async () => "C:\\demo"),
      choosePort: vi.fn(async () => 4173),
      startShareServer: vi.fn((): StartedShareServer => ({
        process: { stop: vi.fn(), child: {} as never },
        localUrl: Promise.resolve("http://localhost:4173/")
      })),
      startTunnel: vi.fn((): StartedTunnel => ({
        process: { stop: vi.fn(), child: {} as never },
        provider: "localtunnel",
        publicUrl: Promise.resolve("https://demo.loca.lt")
      })),
      checkUrlHealth: vi.fn(async () => ({ ok: false, message: "公网地址访问超时" }))
    });

    await supervisor.start("p1");

    expect(db.updateLocalProjectRuntime).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({
        runtimeStatus: "running",
        localUrl: "http://localhost:4173/",
        publicUrl: "https://demo.loca.lt",
        lastError: "公网地址访问超时",
        stepLabel: "Ready"
      })
    );
  });
});
