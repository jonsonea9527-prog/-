# Local Multi-Project Live Share Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local multi-project live sharing tool for React + Vite projects that can start `npm run dev`, start `localtunnel`, and expose live preview links for multiple projects at the same time.

**Architecture:** Reuse the existing `src/server` and `src/client` app shell, but replace the current zip-upload publishing workflow with a local project registry plus runtime managers. The backend will own project persistence, project validation, process supervision, port allocation, and tunnel lifecycle; the frontend will become a local control panel for adding local paths and starting/stopping live share sessions.

**Tech Stack:** Node.js, TypeScript, Express, React, Vite, `node:sqlite`, child processes, `npx localtunnel`

---

## Planned File Structure

### Files to Create

- `src/server/localProjects.ts`
  - Local project metadata model and validation helpers for persisted records.
- `src/server/localProjectDb.ts`
  - SQLite-backed CRUD for local projects and runtime status snapshots.
- `src/server/projectInspector.ts`
  - Validates a local filesystem path as a React + Vite project.
- `src/server/portAllocator.ts`
  - Finds available ports, with optional preferred port handling.
- `src/server/processRunner.ts`
  - Shared child-process wrapper for long-running dev/tunnel processes.
- `src/server/devServerManager.ts`
  - Starts/stops `npm run dev`, parses local URL from Vite output.
- `src/server/tunnelManager.ts`
  - Starts/stops `npx localtunnel --port <port>`, parses public URL.
- `src/server/liveShareSupervisor.ts`
  - Coordinates runtime state, start/stop/restart flows, and log aggregation.
- `tests/server/localProjectDb.test.ts`
- `tests/server/projectInspector.test.ts`
- `tests/server/portAllocator.test.ts`
- `tests/server/devServerManager.test.ts`
- `tests/server/tunnelManager.test.ts`
- `tests/server/liveShareSupervisor.test.ts`

### Files to Modify

- `src/shared/types.ts`
  - Replace upload/build-centric shared types with local project and runtime types.
- `src/server/types.ts`
  - Replace `ProjectRecord` / `VersionRecord` with local project runtime records.
- `src/server/db.ts`
  - Remove or retire old zip/version database path and export the new local project database entrypoint, or keep this file as the database facade by swapping internals.
- `src/server/routes.ts`
  - Replace upload/version routes with local project CRUD and runtime action routes.
- `src/server/app.ts`
  - Wire the new route dependencies and supervisor.
- `src/server/server.ts`
  - Initialize the new database and supervisor dependencies.
- `src/server/config.ts`
  - Add local runtime defaults such as base port range if needed.
- `src/client/api.ts`
  - Replace upload/version API calls with local project and runtime API calls.
- `src/client/App.tsx`
  - Replace the zip upload UI with a multi-project live share control panel.
- `tests/server/routes.test.ts`
  - Replace upload/version route tests with local project/runtime route tests.

### Files Likely Safe to Delete Later

- `src/server/builder.ts`
- `src/server/buildQueue.ts`
- `src/server/fileStore.ts`
- `tests/server/builder.test.ts`
- `tests/server/buildQueue.test.ts`
- `tests/server/fileStore.test.ts`

Do not delete these until the new runtime flow is passing. First make the new path work, then remove dead code in a cleanup task.

## Task 1: Define the new shared data model

**Files:**
- Create: `tests/server/localProjectDb.test.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/server/types.ts`
- Modify: `src/server/db.ts`

- [ ] **Step 1: Write the failing database-shape test**

Add `tests/server/localProjectDb.test.ts` with the first contract test for the new local project record:

```ts
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createDatabase } from "../../src/server/db";

describe("local project database", () => {
  it("creates and lists local projects with idle runtime state", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "live-share-db-"));
    const db = createDatabase(path.join(root, "app.sqlite"));

    const project = db.createLocalProject({
      name: "Attendance PC",
      projectPath: "C:\\\\demo\\\\attendance-pc",
      preferredPort: null,
      createdBy: "local"
    });

    expect(project).toMatchObject({
      name: "Attendance PC",
      projectPath: "C:\\\\demo\\\\attendance-pc",
      preferredPort: null,
      runtimeStatus: "idle",
      localUrl: null,
      publicUrl: null,
      lastError: null
    });

    expect(db.listLocalProjects()).toEqual([project]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd test -- tests\server\localProjectDb.test.ts`

Expected: FAIL with TypeScript/runtime errors such as `createLocalProject is not a function`.

- [ ] **Step 3: Replace shared upload/version types with local project/runtime types**

Update `src/shared/types.ts` to define the new runtime vocabulary:

```ts
export type RuntimeStatus = "idle" | "starting" | "running" | "failed" | "stopping";

export interface LocalProjectSummary {
  id: string;
  name: string;
  projectPath: string;
  preferredPort: number | null;
  runtimeStatus: RuntimeStatus;
  localUrl: string | null;
  publicUrl: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LocalProjectLogEntry {
  at: string;
  stream: "system" | "stdout" | "stderr";
  message: string;
}
```

Update `src/server/types.ts` to mirror persisted records:

```ts
import type { RuntimeStatus } from "../shared/types";

export interface LocalProjectRecord {
  id: string;
  name: string;
  projectPath: string;
  preferredPort: number | null;
  runtimeStatus: RuntimeStatus;
  localUrl: string | null;
  publicUrl: string | null;
  lastError: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 4: Implement the new database facade in `src/server/db.ts`**

Replace the old project/version schema with a local-project schema and methods:

```ts
export interface AppDatabase {
  createLocalProject(input: {
    name: string;
    projectPath: string;
    preferredPort: number | null;
    createdBy: string;
  }): LocalProjectRecord;
  listLocalProjects(): LocalProjectRecord[];
  getLocalProject(id: string): LocalProjectRecord | null;
  deleteLocalProject(id: string): void;
  updateLocalProjectRuntime(
    id: string,
    runtime: Pick<LocalProjectRecord, "runtimeStatus" | "localUrl" | "publicUrl" | "lastError">
  ): void;
}
```

The SQLite table should look like:

```sql
CREATE TABLE IF NOT EXISTS local_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  project_path TEXT NOT NULL UNIQUE,
  preferred_port INTEGER,
  runtime_status TEXT NOT NULL,
  local_url TEXT,
  public_url TEXT,
  last_error TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm.cmd test -- tests\server\localProjectDb.test.ts`

Expected: PASS with 1 passing test.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/server/types.ts src/server/db.ts tests/server/localProjectDb.test.ts
git commit -m "feat: add local project persistence model"
```

## Task 2: Validate local React + Vite project paths

**Files:**
- Create: `src/server/projectInspector.ts`
- Create: `tests/server/projectInspector.test.ts`

- [ ] **Step 1: Write the failing inspector tests**

Create `tests/server/projectInspector.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inspectLocalProject } from "../../src/server/projectInspector";

describe("projectInspector", () => {
  it("accepts a React + Vite project", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vite-project-"));
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
      scripts: { dev: "vite --host" },
      dependencies: { react: "^19.0.0" },
      devDependencies: { vite: "^7.0.0" }
    }));

    const result = await inspectLocalProject(root);
    expect(result).toMatchObject({ ok: true, name: path.basename(root) });
  });

  it("rejects a directory without package.json", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "plain-folder-"));
    const result = await inspectLocalProject(root);
    expect(result).toMatchObject({ ok: false, error: "missing package.json" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd test -- tests\server\projectInspector.test.ts`

Expected: FAIL because `inspectLocalProject` does not exist.

- [ ] **Step 3: Implement `inspectLocalProject`**

Create `src/server/projectInspector.ts`:

```ts
import fs from "node:fs";
import path from "node:path";

export type ProjectInspectionResult =
  | { ok: true; name: string; projectPath: string; packageManager: "npm" }
  | { ok: false; error: "path not found" | "missing package.json" | "missing dev script" | "not a vite project" };

export async function inspectLocalProject(projectPath: string): Promise<ProjectInspectionResult> {
  if (!fs.existsSync(projectPath)) {
    return { ok: false, error: "path not found" };
  }

  const packageJsonPath = path.join(projectPath, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return { ok: false, error: "missing package.json" };
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
    name?: string;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  const devScript = packageJson.scripts?.dev ?? "";
  if (!devScript) {
    return { ok: false, error: "missing dev script" };
  }

  const hasVite = devScript.includes("vite")
    || Boolean(packageJson.dependencies?.vite)
    || Boolean(packageJson.devDependencies?.vite);

  if (!hasVite) {
    return { ok: false, error: "not a vite project" };
  }

  return {
    ok: true,
    name: packageJson.name?.trim() || path.basename(projectPath),
    projectPath,
    packageManager: "npm"
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm.cmd test -- tests\server\projectInspector.test.ts`

Expected: PASS with both tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/server/projectInspector.ts tests/server/projectInspector.test.ts
git commit -m "feat: add local project inspector"
```

## Task 3: Add port allocation and process wrappers

**Files:**
- Create: `src/server/portAllocator.ts`
- Create: `src/server/processRunner.ts`
- Create: `tests/server/portAllocator.test.ts`

- [ ] **Step 1: Write the failing port allocator test**

Create `tests/server/portAllocator.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { choosePort } from "../../src/server/portAllocator";

describe("portAllocator", () => {
  it("prefers the requested port when it is available", async () => {
    const port = await choosePort({ preferredPort: 5174, startPort: 5173 });
    expect(port).toBe(5174);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd test -- tests\server\portAllocator.test.ts`

Expected: FAIL because `choosePort` does not exist.

- [ ] **Step 3: Implement `choosePort` and a reusable process runner**

Create `src/server/portAllocator.ts`:

```ts
import net from "node:net";

async function isPortAvailable(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

export async function choosePort(input: { preferredPort: number | null; startPort: number }): Promise<number> {
  if (input.preferredPort && await isPortAvailable(input.preferredPort)) {
    return input.preferredPort;
  }

  let port = input.startPort;
  while (!(await isPortAvailable(port))) {
    port += 1;
  }

  return port;
}
```

Create `src/server/processRunner.ts`:

```ts
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export interface RunningProcess {
  child: ChildProcessWithoutNullStreams;
  stop(): Promise<void>;
}

export function startProcess(command: string, args: string[], cwd: string): RunningProcess {
  const child = spawn(command, args, {
    cwd,
    shell: true
  });

  return {
    child,
    async stop() {
      if (!child.killed) {
        child.kill();
      }
      await new Promise((resolve) => child.once("close", resolve));
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm.cmd test -- tests\server\portAllocator.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/portAllocator.ts src/server/processRunner.ts tests/server/portAllocator.test.ts
git commit -m "feat: add port allocation and process runner"
```

## Task 4: Start and parse Vite dev servers

**Files:**
- Create: `src/server/devServerManager.ts`
- Create: `tests/server/devServerManager.test.ts`

- [ ] **Step 1: Write the failing dev server parser test**

Create `tests/server/devServerManager.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseViteLocalUrl } from "../../src/server/devServerManager";

describe("devServerManager", () => {
  it("extracts the local Vite url from stdout", () => {
    const chunk = "  Local:   http://localhost:5173/\\n";
    expect(parseViteLocalUrl(chunk)).toBe("http://localhost:5173/");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd test -- tests\server\devServerManager.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement Vite startup/parsing logic**

Create `src/server/devServerManager.ts`:

```ts
import type { RunningProcess } from "./processRunner";
import { startProcess } from "./processRunner";

export function parseViteLocalUrl(text: string): string | null {
  const match = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1):\d+\//);
  return match?.[0] ?? null;
}

export interface StartedDevServer {
  process: RunningProcess;
  localUrl: Promise<string>;
}

export function startDevServer(projectPath: string, port: number): StartedDevServer {
  const process = startProcess("npm", ["run", "dev", "--", "--host", "0.0.0.0", "--port", String(port)], projectPath);

  const localUrl = new Promise<string>((resolve, reject) => {
    const onStdout = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      const url = parseViteLocalUrl(text);
      if (url) {
        cleanup();
        resolve(url);
      }
    };

    const onExit = () => {
      cleanup();
      reject(new Error("dev server exited before reporting a local url"));
    };

    const cleanup = () => {
      process.child.stdout.off("data", onStdout);
      process.child.off("close", onExit);
    };

    process.child.stdout.on("data", onStdout);
    process.child.on("close", onExit);
  });

  return { process, localUrl };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm.cmd test -- tests\server\devServerManager.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/devServerManager.ts tests/server/devServerManager.test.ts
git commit -m "feat: add vite dev server manager"
```

## Task 5: Start and parse localtunnel public URLs

**Files:**
- Create: `src/server/tunnelManager.ts`
- Create: `tests/server/tunnelManager.test.ts`

- [ ] **Step 1: Write the failing tunnel parser test**

Create `tests/server/tunnelManager.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseTunnelUrl } from "../../src/server/tunnelManager";

describe("tunnelManager", () => {
  it("extracts the public localtunnel url from stdout", () => {
    const chunk = "your url is: https://demo-name.loca.lt\\n";
    expect(parseTunnelUrl(chunk)).toBe("https://demo-name.loca.lt");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd test -- tests\server\tunnelManager.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement localtunnel startup/parsing**

Create `src/server/tunnelManager.ts`:

```ts
import type { RunningProcess } from "./processRunner";
import { startProcess } from "./processRunner";

export function parseTunnelUrl(text: string): string | null {
  const match = text.match(/https:\/\/[A-Za-z0-9-]+\.loca\.lt/);
  return match?.[0] ?? null;
}

export interface StartedTunnel {
  process: RunningProcess;
  publicUrl: Promise<string>;
}

export function startTunnel(port: number): StartedTunnel {
  const process = startProcess("npx", ["localtunnel", "--port", String(port)], process.cwd());

  const publicUrl = new Promise<string>((resolve, reject) => {
    const onOutput = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      const url = parseTunnelUrl(text);
      if (url) {
        cleanup();
        resolve(url);
      }
    };

    const onExit = () => {
      cleanup();
      reject(new Error("localtunnel exited before reporting a public url"));
    };

    const cleanup = () => {
      process.child.stdout.off("data", onOutput);
      process.child.stderr.off("data", onOutput);
      process.child.off("close", onExit);
    };

    process.child.stdout.on("data", onOutput);
    process.child.stderr.on("data", onOutput);
    process.child.on("close", onExit);
  });

  return { process, publicUrl };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm.cmd test -- tests\server\tunnelManager.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/tunnelManager.ts tests/server/tunnelManager.test.ts
git commit -m "feat: add localtunnel manager"
```

## Task 6: Coordinate runtime state for multiple projects

**Files:**
- Create: `src/server/liveShareSupervisor.ts`
- Create: `tests/server/liveShareSupervisor.test.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/server.ts`

- [ ] **Step 1: Write the failing supervisor state test**

Create `tests/server/liveShareSupervisor.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createLiveShareSupervisor } from "../../src/server/liveShareSupervisor";

describe("liveShareSupervisor", () => {
  it("starts a project and publishes running urls", async () => {
    const db = {
      updateLocalProjectRuntime: vi.fn(),
      getLocalProject: vi.fn(() => ({
        id: "p1",
        name: "Demo",
        projectPath: "C:\\\\demo",
        preferredPort: null
      }))
    } as any;

    const supervisor = createLiveShareSupervisor({
      db,
      choosePort: vi.fn(async () => 5173),
      startDevServer: vi.fn(() => ({
        process: { stop: vi.fn(), child: {} },
        localUrl: Promise.resolve("http://localhost:5173/")
      })),
      startTunnel: vi.fn(() => ({
        process: { stop: vi.fn(), child: {} },
        publicUrl: Promise.resolve("https://demo.loca.lt")
      }))
    });

    await supervisor.start("p1");

    expect(db.updateLocalProjectRuntime).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({
        runtimeStatus: "running",
        localUrl: "http://localhost:5173/",
        publicUrl: "https://demo.loca.lt",
        lastError: null
      })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd test -- tests\server\liveShareSupervisor.test.ts`

Expected: FAIL because the supervisor does not exist.

- [ ] **Step 3: Implement the supervisor**

Create `src/server/liveShareSupervisor.ts`:

```ts
import type { AppDatabase } from "./db";
import { choosePort as defaultChoosePort } from "./portAllocator";
import { startDevServer as defaultStartDevServer } from "./devServerManager";
import { startTunnel as defaultStartTunnel } from "./tunnelManager";

export function createLiveShareSupervisor(deps: {
  db: AppDatabase;
  choosePort?: typeof defaultChoosePort;
  startDevServer?: typeof defaultStartDevServer;
  startTunnel?: typeof defaultStartTunnel;
}) {
  const runtimes = new Map<string, {
    port: number;
    stopAll: () => Promise<void>;
  }>();

  const choosePort = deps.choosePort ?? defaultChoosePort;
  const startDevServer = deps.startDevServer ?? defaultStartDevServer;
  const startTunnel = deps.startTunnel ?? defaultStartTunnel;

  return {
    async start(projectId: string) {
      const project = deps.db.getLocalProject(projectId);
      if (!project) {
        throw new Error("project not found");
      }

      deps.db.updateLocalProjectRuntime(projectId, {
        runtimeStatus: "starting",
        localUrl: null,
        publicUrl: null,
        lastError: null
      });

      try {
        const port = await choosePort({ preferredPort: project.preferredPort, startPort: 5173 });
        const dev = startDevServer(project.projectPath, port);
        const localUrl = await dev.localUrl;
        const tunnel = startTunnel(port);
        const publicUrl = await tunnel.publicUrl;

        runtimes.set(projectId, {
          port,
          stopAll: async () => {
            await tunnel.process.stop();
            await dev.process.stop();
          }
        });

        deps.db.updateLocalProjectRuntime(projectId, {
          runtimeStatus: "running",
          localUrl,
          publicUrl,
          lastError: null
        });
      } catch (error) {
        deps.db.updateLocalProjectRuntime(projectId, {
          runtimeStatus: "failed",
          localUrl: null,
          publicUrl: null,
          lastError: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    },

    async stop(projectId: string) {
      const runtime = runtimes.get(projectId);
      deps.db.updateLocalProjectRuntime(projectId, {
        runtimeStatus: "stopping",
        localUrl: null,
        publicUrl: null,
        lastError: null
      });

      if (runtime) {
        await runtime.stopAll();
        runtimes.delete(projectId);
      }

      deps.db.updateLocalProjectRuntime(projectId, {
        runtimeStatus: "idle",
        localUrl: null,
        publicUrl: null,
        lastError: null
      });
    },

    async restart(projectId: string) {
      await this.stop(projectId);
      await this.start(projectId);
    }
  };
}
```

- [ ] **Step 4: Wire the supervisor into app startup**

Update `src/server/app.ts`:

```ts
import type { LiveShareSupervisor } from "./liveShareSupervisor";

export interface AppDependencies {
  db: AppDatabase;
  supervisor: LiveShareSupervisor;
}
```

Update `src/server/server.ts`:

```ts
import { createLiveShareSupervisor } from "./liveShareSupervisor";

const supervisor = createLiveShareSupervisor({ db });

const app = createApp({
  db,
  supervisor
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm.cmd test -- tests\server\liveShareSupervisor.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/liveShareSupervisor.ts src/server/app.ts src/server/server.ts tests/server/liveShareSupervisor.test.ts
git commit -m "feat: add live share supervisor"
```

## Task 7: Replace the HTTP API with local project/runtime endpoints

**Files:**
- Modify: `src/server/routes.ts`
- Modify: `tests/server/routes.test.ts`

- [ ] **Step 1: Write the failing route tests for local projects**

Add a new block to `tests/server/routes.test.ts`:

```ts
it("creates and lists local projects", async () => {
  const response = await request(context.app)
    .post("/api/local-projects")
    .send({ projectPath: "C:\\\\demo\\\\attendance-pc" })
    .expect(201);

  expect(response.body.project).toMatchObject({
    projectPath: "C:\\\\demo\\\\attendance-pc",
    runtimeStatus: "idle"
  });

  const listResponse = await request(context.app)
    .get("/api/local-projects")
    .expect(200);

  expect(listResponse.body.projects).toHaveLength(1);
});

it("starts a local project runtime", async () => {
  const project = context.db.createLocalProject({
    name: "Demo",
    projectPath: "C:\\\\demo",
    preferredPort: null,
    createdBy: "local"
  });

  await request(context.app)
    .post(`/api/local-projects/${project.id}/start`)
    .expect(202);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd test -- tests\server\routes.test.ts`

Expected: FAIL because the new routes do not exist.

- [ ] **Step 3: Replace route handlers with local project/runtime actions**

Implement these endpoints in `src/server/routes.ts`:

```ts
router.get("/api/local-projects", (_req, res) => {
  res.json({ projects: deps.db.listLocalProjects() });
});

router.post("/api/local-projects", async (req, res) => {
  const projectPath = typeof req.body?.projectPath === "string" ? req.body.projectPath.trim() : "";
  const inspection = await inspectLocalProject(projectPath);
  if (!inspection.ok) {
    res.status(400).json({ error: inspection.error });
    return;
  }

  const project = deps.db.createLocalProject({
    name: inspection.name,
    projectPath: inspection.projectPath,
    preferredPort: null,
    createdBy: "local"
  });

  res.status(201).json({ project });
});

router.post("/api/local-projects/:projectId/start", async (req, res) => {
  await deps.supervisor.start(req.params.projectId);
  res.status(202).json({ ok: true });
});

router.post("/api/local-projects/:projectId/stop", async (req, res) => {
  await deps.supervisor.stop(req.params.projectId);
  res.status(202).json({ ok: true });
});

router.post("/api/local-projects/:projectId/restart", async (req, res) => {
  await deps.supervisor.restart(req.params.projectId);
  res.status(202).json({ ok: true });
});

router.delete("/api/local-projects/:projectId", (req, res) => {
  deps.db.deleteLocalProject(req.params.projectId);
  res.sendStatus(204);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm.cmd test -- tests\server\routes.test.ts`

Expected: PASS with route coverage updated to the new API.

- [ ] **Step 5: Commit**

```bash
git add src/server/routes.ts tests/server/routes.test.ts
git commit -m "feat: add local project runtime api"
```

## Task 8: Replace the client UI with a multi-project live share panel

**Files:**
- Modify: `src/client/api.ts`
- Modify: `src/client/App.tsx`

- [ ] **Step 1: Replace client API bindings**

Update `src/client/api.ts`:

```ts
import type { LocalProjectSummary } from "../shared/types";

export async function listLocalProjects(): Promise<LocalProjectSummary[]> {
  const body = await requestJson<{ projects: LocalProjectSummary[] }>("/api/local-projects");
  return body.projects;
}

export async function createLocalProject(projectPath: string): Promise<LocalProjectSummary> {
  const body = await requestJson<{ project: LocalProjectSummary }>("/api/local-projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectPath })
  });
  return body.project;
}

export async function startLocalProject(projectId: string): Promise<void> {
  await requestJson(`/api/local-projects/${projectId}/start`, { method: "POST" });
}

export async function stopLocalProject(projectId: string): Promise<void> {
  await requestJson(`/api/local-projects/${projectId}/stop`, { method: "POST" });
}

export async function restartLocalProject(projectId: string): Promise<void> {
  await requestJson(`/api/local-projects/${projectId}/restart`, { method: "POST" });
}
```

- [ ] **Step 2: Replace `App.tsx` state with local-project runtime state**

The top-level state should become:

```ts
const [projects, setProjects] = useState<LocalProjectSummary[]>([]);
const [projectPath, setProjectPath] = useState("");
const [loadingProjects, setLoadingProjects] = useState(true);
const [busyProjectIds, setBusyProjectIds] = useState<string[]>([]);
const [error, setError] = useState<string | null>(null);
const [notice, setNotice] = useState<string | null>(null);
```

The primary actions should be:

```ts
async function handleAddProject(event: React.FormEvent<HTMLFormElement>) { ... }
async function handleStart(projectId: string) { ... }
async function handleStop(projectId: string) { ... }
async function handleRestart(projectId: string) { ... }
```

- [ ] **Step 3: Replace the UI layout**

Replace the upload/version layout with a multi-card project list:

```tsx
<main className="workspace">
  <header className="topbar">
    <div>
      <p className="eyebrow">本地多项目实时分享</p>
      <h1>Live Share 控制台</h1>
    </div>
  </header>

  <form className="create-form" onSubmit={handleAddProject}>
    <label htmlFor="project-path">添加本地 React + Vite 项目</label>
    <div className="inline-form">
      <input
        id="project-path"
        value={projectPath}
        onChange={(event) => setProjectPath(event.target.value)}
        placeholder="输入本地项目路径，例如 C:\\project\\demo"
      />
      <button type="submit">添加项目</button>
    </div>
  </form>

  <section className="project-grid">
    {projects.map((project) => (
      <article key={project.id} className="project-card">
        <h2>{project.name}</h2>
        <p>{project.projectPath}</p>
        <p>状态：{project.runtimeStatus}</p>
        <p>本地地址：{project.localUrl ?? "-"}</p>
        <p>公网地址：{project.publicUrl ?? "-"}</p>
        <div className="version-actions">
          <button onClick={() => handleStart(project.id)}>启动分享</button>
          <button onClick={() => handleStop(project.id)}>停止</button>
          <button onClick={() => handleRestart(project.id)}>重启</button>
          {project.publicUrl && <button onClick={() => handleCopy(project.publicUrl!, "公网链接已复制")}>复制链接</button>}
        </div>
        {project.lastError && <p className="row-error">{project.lastError}</p>}
      </article>
    ))}
  </section>
</main>
```

- [ ] **Step 4: Run the UI build verification**

Run: `npm.cmd run build`

Expected: Vite client build passes without type errors.

- [ ] **Step 5: Commit**

```bash
git add src/client/api.ts src/client/App.tsx
git commit -m "feat: add local multi-project live share ui"
```

## Task 9: Remove obsolete zip publish code and update docs

**Files:**
- Modify: `README.md`
- Delete: `src/server/builder.ts`
- Delete: `src/server/buildQueue.ts`
- Delete: `src/server/fileStore.ts`
- Delete: `tests/server/builder.test.ts`
- Delete: `tests/server/buildQueue.test.ts`
- Delete: `tests/server/fileStore.test.ts`

- [ ] **Step 1: Update README to the new workflow**

Replace the README usage section with:

```md
## 启动

```bash
npm install
npm run dev
```

打开本地管理台后：

1. 添加本地 React + Vite 项目路径
2. 点击“启动分享”
3. 工具会自动启动 Vite 和 localtunnel
4. 使用显示的公网地址给同事预览

## 要求

- 本机已安装 Node.js 与 npm
- 项目为 React + Vite
- 网络允许 `npx localtunnel --port <port>` 正常运行
```
```

- [ ] **Step 2: Delete dead upload/build files after the new tests are green**

Delete:

```text
src/server/builder.ts
src/server/buildQueue.ts
src/server/fileStore.ts
tests/server/builder.test.ts
tests/server/buildQueue.test.ts
tests/server/fileStore.test.ts
```

- [ ] **Step 3: Run the full verification suite**

Run:

```bash
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Expected:

- `typecheck` passes
- `test` passes
- `build` passes

- [ ] **Step 4: Commit**

```bash
git add README.md src/server src/client src/shared tests/server
git commit -m "refactor: replace zip publishing with local live share workflow"
```

## Self-Review

### Spec coverage

- 多项目并行：Task 6 + Task 8
- 本地路径校验：Task 2
- 启动 `npm run dev`：Task 4
- 启动 `localtunnel`：Task 5
- 一键启动/停止/重启：Task 6 + Task 7 + Task 8
- 保留项目列表：Task 1
- 不再走 zip 上传链路：Task 7 + Task 9

无明显缺口。

### Placeholder scan

- 未保留 `TODO` / `TBD`
- 每个任务都包含文件、测试、命令和预期结果

### Type consistency

- 统一使用 `LocalProjectSummary` / `LocalProjectRecord`
- 统一使用 `runtimeStatus`
- 统一使用 `localUrl` / `publicUrl` / `lastError`

Plan is internally consistent.
