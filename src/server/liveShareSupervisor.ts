import type { AppDatabase } from "./db";
import { choosePort as defaultChoosePort, createRandomPortStart } from "./portAllocator";
import { startShareServer as defaultStartShareServer } from "./shareServerManager";
import { parseTunnelError, startTunnel as defaultStartTunnel } from "./tunnelManager";
import { prepareProjectLaunchPath as defaultPrepareProjectLaunchPath } from "./projectLaunchPath";
import { checkUrlHealth as defaultCheckUrlHealth } from "./urlHealth";
import type { LocalProjectRecord } from "./types";

type ChoosePort = typeof defaultChoosePort;
type StartShareServer = typeof defaultStartShareServer;
type StartTunnel = typeof defaultStartTunnel;
type PrepareProjectLaunchPath = typeof defaultPrepareProjectLaunchPath;
type CheckUrlHealth = typeof defaultCheckUrlHealth;

interface ProjectRuntime {
  port: number;
  stopped: boolean;
  stopAll: () => Promise<void>;
}

export interface LiveShareSupervisor {
  start(projectId: string): Promise<void>;
  stop(projectId: string): Promise<void>;
  restart(projectId: string): Promise<void>;
  stopAll(): Promise<void>;
}

export function createLiveShareSupervisor(deps: {
  db: AppDatabase;
  choosePort?: ChoosePort;
  startShareServer?: StartShareServer;
  startTunnel?: StartTunnel;
  prepareProjectLaunchPath?: PrepareProjectLaunchPath;
  checkUrlHealth?: CheckUrlHealth;
}): LiveShareSupervisor {
  const runtimes = new Map<string, ProjectRuntime>();
  const startPromises = new Map<string, Promise<void>>();
  const stopRequests = new Set<string>();
  const reservedPorts = new Set<number>();
  const rateLimitCooldowns = new Map<string, number>();
  let globalRateLimitCooldownUntil = 0;
  const choosePort = deps.choosePort ?? defaultChoosePort;
  const startShareServer = deps.startShareServer ?? defaultStartShareServer;
  const startTunnel = deps.startTunnel ?? defaultStartTunnel;
  const prepareProjectLaunchPath = deps.prepareProjectLaunchPath ?? defaultPrepareProjectLaunchPath;
  const checkUrlHealth = deps.checkUrlHealth ?? defaultCheckUrlHealth;
  const startStepTotal = 4;
  const tunnelRateLimitCooldownMs = 10 * 60 * 1000;

  function isRateLimitMessage(message: string) {
    return /429|too many requests|rate limit/i.test(message);
  }

  function isRateLimitError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return isRateLimitMessage(message);
  }

  function getPublicTunnelErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return parseTunnelError(message) ?? message;
  }

  function getRateLimitCooldownMessage(project: LocalProjectRecord): string | null {
    const inMemoryCooldownUntil = rateLimitCooldowns.get(project.id);
    const persistedCooldownUntil = project.lastError && isRateLimitMessage(project.lastError)
      ? Date.parse(project.updatedAt) + tunnelRateLimitCooldownMs
      : 0;
    const cooldownUntil = Math.max(
      globalRateLimitCooldownUntil,
      inMemoryCooldownUntil ?? 0,
      Number.isFinite(persistedCooldownUntil) ? persistedCooldownUntil : 0
    );

    if (!cooldownUntil) {
      return null;
    }

    const remainingMs = cooldownUntil - Date.now();
    if (remainingMs <= 0) {
      rateLimitCooldowns.delete(project.id);
      globalRateLimitCooldownUntil = 0;
      return null;
    }

    const remainingMinutes = Math.ceil(remainingMs / 60000);
    return `公网隧道限流仍在生效，请大约等待 ${remainingMinutes} 分钟后再重试。`;
  }

  function setRateLimitCooldown(projectId: string) {
    const cooldownUntil = Date.now() + tunnelRateLimitCooldownMs;
    rateLimitCooldowns.set(projectId, cooldownUntil);
    globalRateLimitCooldownUntil = cooldownUntil;
  }

  function updateStep(
    projectId: string,
    runtimeStatus: "starting" | "running" | "failed" | "idle" | "stopping",
    stepIndex: number,
    stepLabel: string | null,
    options?: {
      localUrl?: string | null;
      publicUrl?: string | null;
      lastError?: string | null;
      stepTotal?: number;
    }
  ) {
    deps.db.updateLocalProjectRuntime(projectId, {
      runtimeStatus,
      localUrl: options?.localUrl ?? null,
      publicUrl: options?.publicUrl ?? null,
      lastError: options?.lastError ?? null,
      stepIndex,
      stepTotal: options?.stepTotal ?? startStepTotal,
      stepLabel
    });
  }

  async function startProject(projectId: string) {
    stopRequests.delete(projectId);
    const project = deps.db.getLocalProject(projectId);
    if (!project) {
      throw new Error("project not found");
    }

    const existingRuntime = runtimes.get(projectId);
    if (existingRuntime) {
      await existingRuntime.stopAll();
      runtimes.delete(projectId);
    }

    let reservedPort: number | null = null;
    let shareServerProcess: Awaited<ReturnType<StartShareServer>> | null = null;
    let tunnelProcess: Awaited<ReturnType<StartTunnel>> | null = null;

    try {
      updateStep(projectId, "starting", 1, "Preparing launch directory");
      const launchPath = await prepareProjectLaunchPath(project.id, project.projectPath);

      updateStep(projectId, "starting", 2, "Allocating an available port");
      const port = await choosePort({
        preferredPort: project.preferredPort,
        startPort: createRandomPortStart(),
        excludedPorts: reservedPorts
      });
      reservedPorts.add(port);
      reservedPort = port;

      updateStep(projectId, "starting", 3, "Starting local preview server");
      shareServerProcess = startShareServer(launchPath, port);
      const localUrl = await shareServerProcess.localUrl;
      if (stopRequests.has(projectId)) {
        await shareServerProcess.process.stop().catch(() => undefined);
        reservedPorts.delete(port);
        updateStep(projectId, "idle", 0, null, { stepTotal: 0 });
        return;
      }

      updateStep(projectId, "starting", 4, "Creating public share URL", { localUrl });
      const cooldownMessage = getRateLimitCooldownMessage(project);
      if (cooldownMessage) {
        const runtime: ProjectRuntime = {
          port,
          stopped: false,
          stopAll: async () => {
            runtime.stopped = true;
            if (shareServerProcess) {
              await shareServerProcess.process.stop();
            }
            reservedPorts.delete(port);
          }
        };
        runtimes.set(projectId, runtime);

        updateStep(projectId, "running", startStepTotal, "Ready", {
          localUrl,
          publicUrl: null,
          lastError: cooldownMessage
        });
        return;
      }

      tunnelProcess = startTunnel(port);
      let publicUrl: string | null = null;
      try {
        publicUrl = await tunnelProcess.publicUrl;
      } catch (error) {
        if (isRateLimitError(error)) {
          setRateLimitCooldown(projectId);
        }

        const runtime: ProjectRuntime = {
          port,
          stopped: false,
          stopAll: async () => {
            runtime.stopped = true;
            if (tunnelProcess) {
              await tunnelProcess.process.stop();
            }
            if (shareServerProcess) {
              await shareServerProcess.process.stop();
            }
            reservedPorts.delete(port);
          }
        };
        runtimes.set(projectId, runtime);

        updateStep(projectId, "running", startStepTotal, "Ready", {
          localUrl,
          publicUrl: null,
          lastError: getPublicTunnelErrorMessage(error)
        });
        return;
      }

      const runtime: ProjectRuntime = {
        port,
        stopped: false,
        stopAll: async () => {
          runtime.stopped = true;
          if (tunnelProcess) {
            await tunnelProcess.process.stop();
          }
          if (shareServerProcess) {
            await shareServerProcess.process.stop();
          }
          reservedPorts.delete(port);
        }
      };
      runtimes.set(projectId, runtime);

      const publicHealth = await checkUrlHealth(publicUrl, {
        timeoutMs: 90000,
        attemptTimeoutMs: 8000,
        retryDelayMs: 1500
      });
      if (runtime.stopped || stopRequests.has(projectId)) {
        return;
      }

      if (!publicHealth.ok) {
        updateStep(projectId, "running", startStepTotal, "Ready", {
          localUrl,
          publicUrl,
          lastError: publicHealth.message
        });
        return;
      }

      updateStep(projectId, "running", startStepTotal, "Ready", {
        localUrl,
        publicUrl,
        lastError: null
      });
    } catch (error) {
      if (isRateLimitError(error)) {
        setRateLimitCooldown(projectId);
      }

      if (tunnelProcess) {
        await tunnelProcess.process.stop().catch(() => undefined);
      }
      if (shareServerProcess) {
        await shareServerProcess.process.stop().catch(() => undefined);
      }
      if (reservedPort !== null) {
        reservedPorts.delete(reservedPort);
      }

      const currentProject = deps.db.getLocalProject(projectId);
      updateStep(projectId, "failed", currentProject?.stepIndex ?? 0, currentProject?.stepLabel ?? "Start failed", {
        localUrl: currentProject?.localUrl ?? null,
        publicUrl: currentProject?.publicUrl ?? null,
        lastError: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  return {
    async start(projectId: string) {
      const activeStart = startPromises.get(projectId);
      if (activeStart) {
        return activeStart;
      }

      const startPromise = startProject(projectId);
      startPromises.set(projectId, startPromise);
      try {
        await startPromise;
      } finally {
        startPromises.delete(projectId);
        stopRequests.delete(projectId);
      }
    },

    async stop(projectId: string) {
      stopRequests.add(projectId);
      const runtime = runtimes.get(projectId);
      updateStep(projectId, "stopping", 0, "Stopping", {
        stepTotal: 0
      });

      if (runtime) {
        await runtime.stopAll();
        runtimes.delete(projectId);
      }

      updateStep(projectId, "idle", 0, null, {
        stepTotal: 0
      });
    },

    async restart(projectId: string) {
      await this.stop(projectId);
      await this.start(projectId);
    },

    async stopAll() {
      const projectIds = Array.from(runtimes.keys());
      for (const projectId of projectIds) {
        await this.stop(projectId);
      }
    }
  };
}
