# 本地 React 预览发布平台 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个运行在本地电脑上的团队内部 React/TSX 项目预览发布平台，支持上传 zip、自动构建、查看日志并生成预览链接。

**Architecture:** 使用一个 Vite React 前端管理台和一个 Node.js API/静态预览服务。后端通过 SQLite 记录项目和版本，通过本地文件系统保存上传包、构建产物和日志，通过构建队列串行执行项目构建。

**Tech Stack:** React、Vite、TypeScript、Node.js、Express、SQLite、Vitest、Supertest、本地文件系统，构建阶段优先设计为 Docker 可替换执行器。

---

## 文件结构

```text
package.json
tsconfig.json
vite.config.ts
vitest.config.ts
index.html
src/
  client/
    App.tsx
    api.ts
    main.tsx
    styles.css
  server/
    app.ts
    auth.ts
    buildQueue.ts
    builder.ts
    config.ts
    db.ts
    fileStore.ts
    routes.ts
    server.ts
    slug.ts
    types.ts
  shared/
    types.ts
tests/
  server/
    auth.test.ts
    buildQueue.test.ts
    builder.test.ts
    fileStore.test.ts
    routes.test.ts
    slug.test.ts
data/
  .gitkeep
```

职责说明：

- `src/client/*`：浏览器端管理界面。
- `src/server/app.ts`：创建 Express 应用并挂载中间件。
- `src/server/routes.ts`：项目、版本、上传、日志、预览路由。
- `src/server/db.ts`：SQLite 初始化和数据访问。
- `src/server/fileStore.ts`：上传文件、构建产物、日志路径管理。
- `src/server/builder.ts`：构建流程和输出目录检测。
- `src/server/buildQueue.ts`：串行构建队列。
- `src/server/auth.ts`：MVP 基础登录和会话校验。
- `src/server/config.ts`：端口、数据目录、上传限制、构建限制。
- `src/server/slug.ts`：项目 slug 生成。
- `src/shared/types.ts`：前后端共享类型。

## Task 1: 项目脚手架和测试基础

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `index.html`
- Create: `data/.gitkeep`
- Create: `src/shared/types.ts`

- [ ] **Step 1: 创建基础项目配置**

`package.json` 写入：

```json
{
  "name": "local-react-preview-mvp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx src/server/server.ts",
    "dev:client": "vite --host 0.0.0.0",
    "build": "vite build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --passWithNoTests",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@vitejs/plugin-react": "^5.0.0",
    "adm-zip": "^0.5.16",
    "cors": "^2.8.5",
    "express": "^4.19.2",
    "multer": "^1.4.5-lts.1",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "sirv": "^3.0.0",
    "tsx": "^4.19.2",
    "vite": "^7.0.0"
  },
  "devDependencies": {
    "@types/adm-zip": "^0.5.7",
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/multer": "^1.4.12",
    "@types/node": "^24.0.0",
    "@types/react": "^19.0.1",
    "@types/react-dom": "^19.0.2",
    "@types/supertest": "^6.0.3",
    "jsdom": "^25.0.1",
    "supertest": "^7.0.0",
    "typescript": "^5.7.2",
    "vitest": "^3.0.0"
  }
}
```

`tsconfig.json` 写入：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "types": ["node", "vitest/globals"]
  },
  "include": ["src", "tests", "vite.config.ts", "vitest.config.ts"]
}
```

`vite.config.ts` 写入：

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  root: ".",
  build: {
    outDir: "dist/client",
    emptyOutDir: true
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/p": "http://localhost:3000"
    }
  }
});
```

`vitest.config.ts` 写入：

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"]
  }
});
```

`index.html` 写入：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>本地 React 预览发布平台</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/client/main.tsx"></script>
  </body>
</html>
```

`src/shared/types.ts` 写入：

```ts
export type BuildStatus = "queued" | "building" | "success" | "failed";

export interface ProjectSummary {
  id: string;
  name: string;
  slug: string;
  latestSuccessfulVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VersionSummary {
  id: string;
  projectId: string;
  status: BuildStatus;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}
```

- [ ] **Step 2: 安装依赖**

Run:

```bash
npm install
```

Expected:

```text
package-lock.json is created
node_modules is installed
```

- [ ] **Step 3: 运行基础校验**

Run:

```bash
npm run typecheck
npm test
```

Expected:

```text
typecheck passes
vitest exits successfully with no test files or zero tests
```

## Task 2: 配置、slug 和基础认证

**Files:**
- Create: `src/server/config.ts`
- Create: `src/server/slug.ts`
- Create: `src/server/auth.ts`
- Test: `tests/server/slug.test.ts`
- Test: `tests/server/auth.test.ts`

- [ ] **Step 1: 编写 slug 测试**

`tests/server/slug.test.ts` 写入：

```ts
import { describe, expect, it } from "vitest";
import { makeSlug } from "../../src/server/slug";

describe("makeSlug", () => {
  it("converts mixed project names into stable slugs", () => {
    expect(makeSlug("Demo React 页面 01")).toBe("demo-react-01");
  });

  it("falls back when all characters are removed", () => {
    expect(makeSlug("页面")).toMatch(/^project-[a-z0-9]{6}$/);
  });
});
```

- [ ] **Step 2: 编写认证测试**

`tests/server/auth.test.ts` 写入：

```ts
import { describe, expect, it } from "vitest";
import { createPasswordHash, verifyPassword } from "../../src/server/auth";

describe("password helpers", () => {
  it("verifies a matching password", async () => {
    const hash = await createPasswordHash("secret123");
    await expect(verifyPassword("secret123", hash)).resolves.toBe(true);
  });

  it("rejects a different password", async () => {
    const hash = await createPasswordHash("secret123");
    await expect(verifyPassword("wrong", hash)).resolves.toBe(false);
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run:

```bash
npm test -- tests/server/slug.test.ts tests/server/auth.test.ts
```

Expected:

```text
FAIL because src/server/slug and src/server/auth do not exist
```

- [ ] **Step 4: 实现配置、slug 和认证**

`src/server/config.ts` 写入：

```ts
import path from "node:path";

const rootDir = process.cwd();

export const config = {
  port: Number(process.env.PORT ?? 3000),
  dataDir: process.env.DATA_DIR ?? path.join(rootDir, "data"),
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "http://localhost:3000",
  sessionCookieName: "preview_session",
  uploadMaxBytes: 100 * 1024 * 1024,
  extractedMaxBytes: 500 * 1024 * 1024,
  buildTimeoutMs: 10 * 60 * 1000,
  adminUsername: process.env.ADMIN_USERNAME ?? "admin",
  adminPassword: process.env.ADMIN_PASSWORD ?? "admin123"
};
```

`src/server/slug.ts` 写入：

```ts
import crypto from "node:crypto";

export function makeSlug(input: string): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  if (slug.length > 0) {
    return slug.slice(0, 64);
  }

  return `project-${crypto.randomBytes(3).toString("hex")}`;
}
```

`src/server/auth.ts` 写入：

```ts
import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);

export async function createPasswordHash(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, expectedHex] = storedHash.split(":");
  if (!salt || !expectedHex) {
    return false;
  }

  const actual = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(expectedHex, "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
}
```

- [ ] **Step 5: 运行测试确认通过**

Run:

```bash
npm test -- tests/server/slug.test.ts tests/server/auth.test.ts
```

Expected:

```text
PASS tests/server/slug.test.ts
PASS tests/server/auth.test.ts
```

## Task 3: SQLite 数据库和数据访问

**Files:**
- Create: `src/server/types.ts`
- Create: `src/server/db.ts`
- Test: `tests/server/db.test.ts`

- [ ] **Step 1: 编写数据库测试**

`tests/server/db.test.ts` 写入：

```ts
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createDatabase } from "../../src/server/db";

describe("database", () => {
  it("creates projects and versions", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "preview-db-"));
    const db = createDatabase(path.join(dir, "app.db"));

    const project = db.createProject("Demo App", "demo-app", "user-1");
    const version = db.createVersion(project.id, "zip-path", "user-1");

    expect(db.listProjects()).toHaveLength(1);
    expect(db.listVersions(project.id)[0]?.id).toBe(version.id);
    expect(db.getProjectBySlug("demo-app")?.id).toBe(project.id);
  });

  it("updates version status and latest successful project version", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "preview-db-"));
    const db = createDatabase(path.join(dir, "app.db"));

    const project = db.createProject("Demo App", "demo-app", "user-1");
    const version = db.createVersion(project.id, "zip-path", "user-1");

    db.markVersionBuilding(version.id);
    db.markVersionSuccess(version.id, "output-path", "log-path");

    expect(db.getVersion(version.id)?.status).toBe("success");
    expect(db.getProject(project.id)?.latestSuccessfulVersionId).toBe(version.id);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm test -- tests/server/db.test.ts
```

Expected:

```text
FAIL because src/server/db does not exist
```

- [ ] **Step 3: 实现数据库模块**

`src/server/types.ts` 写入：

```ts
import type { BuildStatus } from "../shared/types";

export interface ProjectRecord {
  id: string;
  name: string;
  slug: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  latestSuccessfulVersionId: string | null;
}

export interface VersionRecord {
  id: string;
  projectId: string;
  status: BuildStatus;
  sourceZipPath: string;
  outputPath: string | null;
  buildLogPath: string | null;
  errorMessage: string | null;
  createdBy: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}
```

`src/server/db.ts` 写入数据库初始化、项目 CRUD、版本 CRUD 和状态更新方法。实现时使用 Node 24 内置 `node:sqlite` 的 `DatabaseSync`，字段名在数据库中使用 snake_case，返回给 TypeScript 时转换成 camelCase。

关键接口必须包含：

```ts
export interface AppDatabase {
  createProject(name: string, slug: string, createdBy: string): ProjectRecord;
  listProjects(): ProjectRecord[];
  getProject(id: string): ProjectRecord | null;
  getProjectBySlug(slug: string): ProjectRecord | null;
  createVersion(projectId: string, sourceZipPath: string, createdBy: string): VersionRecord;
  listVersions(projectId: string): VersionRecord[];
  getVersion(id: string): VersionRecord | null;
  markVersionBuilding(id: string): void;
  markVersionSuccess(id: string, outputPath: string, buildLogPath: string): void;
  markVersionFailed(id: string, errorMessage: string, buildLogPath: string): void;
}

export function createDatabase(dbPath: string): AppDatabase;
```

- [ ] **Step 4: 运行数据库测试确认通过**

Run:

```bash
npm test -- tests/server/db.test.ts
```

Expected:

```text
PASS tests/server/db.test.ts
```

## Task 4: 文件存储和上传约束

**Files:**
- Create: `src/server/fileStore.ts`
- Test: `tests/server/fileStore.test.ts`

- [ ] **Step 1: 编写文件存储测试**

`tests/server/fileStore.test.ts` 写入：

```ts
import os from "node:os";
import path from "node:path";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createFileStore } from "../../src/server/fileStore";

describe("fileStore", () => {
  it("creates stable paths for uploads, builds, logs and workspaces", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "preview-store-"));
    const store = createFileStore(root);

    expect(store.uploadZipPath("p1", "v1")).toContain(path.join("uploads", "p1", "v1.zip"));
    expect(store.buildOutputDir("p1", "v1")).toContain(path.join("builds", "p1", "v1"));
    expect(store.logPath("p1", "v1")).toContain(path.join("logs", "p1", "v1.log"));
    expect(store.workspaceDir("v1")).toContain(path.join("workspaces", "v1"));
  });

  it("copies build output recursively", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "preview-store-"));
    const source = path.join(root, "source-dist");
    const store = createFileStore(root);

    store.ensureDir(source);
    writeFileSync(path.join(source, "index.html"), "<div>demo</div>");

    await store.publishBuildOutput(source, "p1", "v1");

    expect(existsSync(path.join(root, "builds", "p1", "v1", "index.html"))).toBe(true);
  });
});
```

- [ ] **Step 2: 实现文件存储模块**

`src/server/fileStore.ts` 写入：

```ts
import fs from "node:fs";
import path from "node:path";

export interface FileStore {
  rootDir: string;
  ensureDir(dir: string): void;
  uploadZipPath(projectId: string, versionId: string): string;
  buildOutputDir(projectId: string, versionId: string): string;
  logPath(projectId: string, versionId: string): string;
  workspaceDir(versionId: string): string;
  publishBuildOutput(sourceDir: string, projectId: string, versionId: string): Promise<string>;
}

export function createFileStore(rootDir: string): FileStore {
  function ensureDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
  }

  async function publishBuildOutput(sourceDir: string, projectId: string, versionId: string): Promise<string> {
    const target = path.join(rootDir, "builds", projectId, versionId);
    fs.rmSync(target, { recursive: true, force: true });
    ensureDir(path.dirname(target));
    fs.cpSync(sourceDir, target, { recursive: true });
    return target;
  }

  return {
    rootDir,
    ensureDir,
    uploadZipPath: (projectId, versionId) => path.join(rootDir, "uploads", projectId, `${versionId}.zip`),
    buildOutputDir: (projectId, versionId) => path.join(rootDir, "builds", projectId, versionId),
    logPath: (projectId, versionId) => path.join(rootDir, "logs", projectId, `${versionId}.log`),
    workspaceDir: (versionId) => path.join(rootDir, "workspaces", versionId),
    publishBuildOutput
  };
}
```

- [ ] **Step 3: 运行文件存储测试**

Run:

```bash
npm test -- tests/server/fileStore.test.ts
```

Expected:

```text
PASS tests/server/fileStore.test.ts
```

## Task 5: 构建器和构建队列

**Files:**
- Create: `src/server/builder.ts`
- Create: `src/server/buildQueue.ts`
- Test: `tests/server/builder.test.ts`
- Test: `tests/server/buildQueue.test.ts`

- [ ] **Step 1: 编写构建器测试**

`tests/server/builder.test.ts` 写入：

```ts
import os from "node:os";
import path from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectBuildOutputDir, detectPackageManager } from "../../src/server/builder";

describe("builder helpers", () => {
  it("detects package manager from lockfiles", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "preview-build-"));
    writeFileSync(path.join(dir, "pnpm-lock.yaml"), "");
    expect(detectPackageManager(dir)).toBe("pnpm");
  });

  it("prefers dist over build output", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "preview-build-"));
    mkdirSync(path.join(dir, "dist"));
    mkdirSync(path.join(dir, "build"));
    expect(detectBuildOutputDir(dir)).toBe(path.join(dir, "dist"));
  });

  it("throws when no build output exists", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "preview-build-"));
    expect(() => detectBuildOutputDir(dir)).toThrow("找不到构建输出目录");
  });
});
```

- [ ] **Step 2: 编写构建队列测试**

`tests/server/buildQueue.test.ts` 写入：

```ts
import { describe, expect, it } from "vitest";
import { createBuildQueue } from "../../src/server/buildQueue";

describe("buildQueue", () => {
  it("runs jobs one at a time in insertion order", async () => {
    const queue = createBuildQueue();
    const events: string[] = [];

    const first = queue.enqueue(async () => {
      events.push("first-start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      events.push("first-end");
    });

    const second = queue.enqueue(async () => {
      events.push("second-start");
      events.push("second-end");
    });

    await Promise.all([first, second]);

    expect(events).toEqual(["first-start", "first-end", "second-start", "second-end"]);
  });
});
```

- [ ] **Step 3: 实现构建器辅助函数**

`src/server/builder.ts` 先写入辅助函数和构建接口：

```ts
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export type PackageManager = "npm" | "pnpm" | "yarn";

export interface BuildOptions {
  projectDir: string;
  logFile: string;
  timeoutMs: number;
}

export function detectPackageManager(projectDir: string): PackageManager {
  if (fs.existsSync(path.join(projectDir, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(projectDir, "yarn.lock"))) return "yarn";
  return "npm";
}

export function detectBuildOutputDir(projectDir: string): string {
  const dist = path.join(projectDir, "dist");
  const build = path.join(projectDir, "build");
  if (fs.existsSync(dist)) return dist;
  if (fs.existsSync(build)) return build;
  throw new Error("找不到构建输出目录 dist 或 build");
}

export async function runCommand(command: string, args: string[], cwd: string, logFile: string, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const log = fs.createWriteStream(logFile, { flags: "a" });
    const child = spawn(command, args, { cwd, shell: process.platform === "win32" });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`命令超时：${command} ${args.join(" ")}`));
    }, timeoutMs);

    child.stdout.pipe(log);
    child.stderr.pipe(log);

    child.on("error", (error) => {
      clearTimeout(timer);
      log.end();
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      log.end();
      if (code === 0) resolve();
      else reject(new Error(`命令失败：${command} ${args.join(" ")}，退出码 ${code}`));
    });
  });
}

export async function buildReactProject(options: BuildOptions): Promise<string> {
  if (!fs.existsSync(path.join(options.projectDir, "package.json"))) {
    throw new Error("缺少 package.json");
  }

  const packageManager = detectPackageManager(options.projectDir);
  const installArgs = packageManager === "npm" ? ["install"] : ["install"];
  await runCommand(packageManager, installArgs, options.projectDir, options.logFile, options.timeoutMs);
  await runCommand(packageManager, ["run", "build"], options.projectDir, options.logFile, options.timeoutMs);
  return detectBuildOutputDir(options.projectDir);
}
```

- [ ] **Step 4: 实现串行构建队列**

`src/server/buildQueue.ts` 写入：

```ts
export interface BuildQueue {
  enqueue<T>(job: () => Promise<T>): Promise<T>;
}

export function createBuildQueue(): BuildQueue {
  let tail = Promise.resolve();

  return {
    enqueue<T>(job: () => Promise<T>): Promise<T> {
      const run = tail.then(job, job);
      tail = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    }
  };
}
```

- [ ] **Step 5: 运行构建相关测试**

Run:

```bash
npm test -- tests/server/builder.test.ts tests/server/buildQueue.test.ts
```

Expected:

```text
PASS tests/server/builder.test.ts
PASS tests/server/buildQueue.test.ts
```

## Task 6: API、上传和静态预览路由

**Files:**
- Create: `src/server/app.ts`
- Create: `src/server/routes.ts`
- Test: `tests/server/routes.test.ts`

- [ ] **Step 1: 编写路由测试**

`tests/server/routes.test.ts` 写入：

```ts
import os from "node:os";
import path from "node:path";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app";
import { createDatabase } from "../../src/server/db";
import { createFileStore } from "../../src/server/fileStore";
import { createBuildQueue } from "../../src/server/buildQueue";

describe("routes", () => {
  it("creates a project and lists it", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "preview-app-"));
    const app = createApp({
      db: createDatabase(path.join(root, "app.db")),
      store: createFileStore(root),
      queue: createBuildQueue(),
      publicBaseUrl: "http://localhost:3000",
      buildTimeoutMs: 1000
    });

    await request(app).post("/api/projects").send({ name: "Demo App" }).expect(201);
    const response = await request(app).get("/api/projects").expect(200);

    expect(response.body.projects[0].slug).toBe("demo-app");
  });

  it("serves a version preview with SPA fallback", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "preview-app-"));
    const db = createDatabase(path.join(root, "app.db"));
    const store = createFileStore(root);
    const project = db.createProject("Demo App", "demo-app", "user-1");
    const version = db.createVersion(project.id, "zip-path", "user-1");
    const output = store.buildOutputDir(project.id, version.id);
    mkdirSync(output, { recursive: true });
    writeFileSync(path.join(output, "index.html"), "<h1>Demo</h1>");
    db.markVersionSuccess(version.id, output, store.logPath(project.id, version.id));

    const app = createApp({
      db,
      store,
      queue: createBuildQueue(),
      publicBaseUrl: "http://localhost:3000",
      buildTimeoutMs: 1000
    });

    const response = await request(app).get(`/p/demo-app/v/${version.id}/deep/path`).expect(200);
    expect(response.text).toContain("Demo");
  });
});
```

- [ ] **Step 2: 实现 Express app 和路由**

`src/server/app.ts` 写入：

```ts
import express from "express";
import cors from "cors";
import type { AppDatabase } from "./db";
import type { FileStore } from "./fileStore";
import type { BuildQueue } from "./buildQueue";
import { createRoutes } from "./routes";

export interface AppDependencies {
  db: AppDatabase;
  store: FileStore;
  queue: BuildQueue;
  publicBaseUrl: string;
  buildTimeoutMs: number;
}

export function createApp(deps: AppDependencies): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(createRoutes(deps));
  return app;
}
```

`src/server/routes.ts` 实现：

```ts
import fs from "node:fs";
import path from "node:path";
import express from "express";
import multer from "multer";
import AdmZip from "adm-zip";
import type { AppDependencies } from "./app";
import { makeSlug } from "./slug";
import { buildReactProject } from "./builder";

export function createRoutes(deps: AppDependencies): express.Router {
  const router = express.Router();
  const upload = multer({ dest: path.join(deps.store.rootDir, "tmp") });

  router.get("/api/projects", (_req, res) => {
    res.json({ projects: deps.db.listProjects() });
  });

  router.post("/api/projects", (req, res) => {
    const name = String(req.body.name ?? "").trim();
    if (!name) return res.status(400).json({ error: "项目名称不能为空" });

    const baseSlug = makeSlug(name);
    let slug = baseSlug;
    let index = 2;
    while (deps.db.getProjectBySlug(slug)) {
      slug = `${baseSlug}-${index}`;
      index += 1;
    }

    const project = deps.db.createProject(name, slug, "local-user");
    res.status(201).json({ project });
  });

  router.get("/api/projects/:projectId/versions", (req, res) => {
    res.json({ versions: deps.db.listVersions(req.params.projectId) });
  });

  router.post("/api/projects/:projectId/upload", upload.single("file"), (req, res) => {
    const project = deps.db.getProject(req.params.projectId);
    if (!project) return res.status(404).json({ error: "项目不存在" });
    if (!req.file) return res.status(400).json({ error: "缺少上传文件" });

    const version = deps.db.createVersion(project.id, "", "local-user");
    const zipPath = deps.store.uploadZipPath(project.id, version.id);
    deps.store.ensureDir(path.dirname(zipPath));
    fs.renameSync(req.file.path, zipPath);

    deps.queue.enqueue(async () => {
      const logPath = deps.store.logPath(project.id, version.id);
      deps.store.ensureDir(path.dirname(logPath));
      deps.db.markVersionBuilding(version.id);

      try {
        const workspace = deps.store.workspaceDir(version.id);
        fs.rmSync(workspace, { recursive: true, force: true });
        deps.store.ensureDir(workspace);
        new AdmZip(zipPath).extractAllTo(workspace, true);
        const outputDir = await buildReactProject({
          projectDir: workspace,
          logFile: logPath,
          timeoutMs: deps.buildTimeoutMs
        });
        const publishedPath = await deps.store.publishBuildOutput(outputDir, project.id, version.id);
        deps.db.markVersionSuccess(version.id, publishedPath, logPath);
        fs.rmSync(workspace, { recursive: true, force: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : "未知构建错误";
        deps.db.markVersionFailed(version.id, message, logPath);
      }
    });

    res.status(202).json({
      version,
      latestUrl: `${deps.publicBaseUrl}/p/${project.slug}`,
      versionUrl: `${deps.publicBaseUrl}/p/${project.slug}/v/${version.id}`
    });
  });

  router.get("/api/versions/:versionId/log", (req, res) => {
    const version = deps.db.getVersion(req.params.versionId);
    if (!version?.buildLogPath || !fs.existsSync(version.buildLogPath)) {
      return res.type("text/plain").send("");
    }
    res.type("text/plain").send(fs.readFileSync(version.buildLogPath, "utf8"));
  });

  router.use("/p/:projectSlug/v/:versionId", (req, res) => {
    const version = deps.db.getVersion(req.params.versionId);
    if (!version?.outputPath) return res.status(404).send("版本不存在");
    return servePreviewFile(version.outputPath, req.path, res);
  });

  router.use("/p/:projectSlug", (req, res) => {
    const project = deps.db.getProjectBySlug(req.params.projectSlug);
    if (!project?.latestSuccessfulVersionId) return res.status(404).send("项目暂无成功构建版本");
    const version = deps.db.getVersion(project.latestSuccessfulVersionId);
    if (!version?.outputPath) return res.status(404).send("项目暂无成功构建版本");
    return servePreviewFile(version.outputPath, req.path, res);
  });

  return router;
}

function servePreviewFile(outputPath: string, requestPath: string, res: express.Response): void {
  const relativePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const candidate = path.join(outputPath, relativePath);
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    res.sendFile(candidate);
    return;
  }
  res.sendFile(path.join(outputPath, "index.html"));
}
```

- [ ] **Step 3: 运行路由测试**

Run:

```bash
npm test -- tests/server/routes.test.ts
```

Expected:

```text
PASS tests/server/routes.test.ts
```

## Task 7: 服务入口和前端管理界面

**Files:**
- Create: `src/server/server.ts`
- Create: `src/client/api.ts`
- Create: `src/client/main.tsx`
- Create: `src/client/App.tsx`
- Create: `src/client/styles.css`

- [ ] **Step 1: 创建服务入口**

`src/server/server.ts` 写入：

```ts
import fs from "node:fs";
import path from "node:path";
import { config } from "./config";
import { createApp } from "./app";
import { createBuildQueue } from "./buildQueue";
import { createDatabase } from "./db";
import { createFileStore } from "./fileStore";

fs.mkdirSync(config.dataDir, { recursive: true });

const store = createFileStore(config.dataDir);
const db = createDatabase(path.join(config.dataDir, "app.db"));
const app = createApp({
  db,
  store,
  queue: createBuildQueue(),
  publicBaseUrl: config.publicBaseUrl,
  buildTimeoutMs: config.buildTimeoutMs
});

app.listen(config.port, () => {
  console.log(`Preview server listening on ${config.publicBaseUrl}`);
});
```

- [ ] **Step 2: 创建前端 API 客户端**

`src/client/api.ts` 写入：

```ts
import type { ProjectSummary, VersionSummary } from "../shared/types";

export async function listProjects(): Promise<ProjectSummary[]> {
  const response = await fetch("/api/projects");
  const data = await response.json();
  return data.projects;
}

export async function createProject(name: string): Promise<ProjectSummary> {
  const response = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
  if (!response.ok) throw new Error("创建项目失败");
  const data = await response.json();
  return data.project;
}

export async function listVersions(projectId: string): Promise<VersionSummary[]> {
  const response = await fetch(`/api/projects/${projectId}/versions`);
  const data = await response.json();
  return data.versions;
}

export async function uploadVersion(projectId: string, file: File): Promise<void> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`/api/projects/${projectId}/upload`, {
    method: "POST",
    body: form
  });
  if (!response.ok) throw new Error("上传失败");
}

export async function getBuildLog(versionId: string): Promise<string> {
  const response = await fetch(`/api/versions/${versionId}/log`);
  return response.text();
}
```

- [ ] **Step 3: 创建 React 入口和界面**

`src/client/main.tsx` 写入：

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

`src/client/App.tsx` 写入：

```tsx
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { ProjectSummary, VersionSummary } from "../shared/types";
import { createProject, getBuildLog, listProjects, listVersions, uploadVersion } from "./api";

function versionUrl(project: ProjectSummary, version: VersionSummary): string {
  return `${window.location.origin}/p/${project.slug}/v/${version.id}`;
}

function latestUrl(project: ProjectSummary): string {
  return `${window.location.origin}/p/${project.slug}`;
}

export function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [projectName, setProjectName] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [logText, setLogText] = useState("");
  const [busyMessage, setBusyMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  );

  async function refreshProjects() {
    const nextProjects = await listProjects();
    setProjects(nextProjects);
    if (!selectedProjectId && nextProjects[0]) {
      setSelectedProjectId(nextProjects[0].id);
    }
  }

  async function refreshVersions(projectId = selectedProjectId) {
    if (!projectId) {
      setVersions([]);
      return;
    }
    setVersions(await listVersions(projectId));
  }

  useEffect(() => {
    refreshProjects().catch((error) => setErrorMessage(error.message));
  }, []);

  useEffect(() => {
    refreshVersions().catch((error) => setErrorMessage(error.message));
  }, [selectedProjectId]);

  async function handleCreateProject(event: FormEvent) {
    event.preventDefault();
    if (!projectName.trim()) return;
    setBusyMessage("正在创建项目...");
    setErrorMessage("");
    try {
      const project = await createProject(projectName.trim());
      setProjectName("");
      await refreshProjects();
      setSelectedProjectId(project.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "创建项目失败");
    } finally {
      setBusyMessage("");
    }
  }

  async function handleUpload(event: FormEvent) {
    event.preventDefault();
    if (!selectedProject || !uploadFile) return;
    setBusyMessage("已上传，构建任务正在排队...");
    setErrorMessage("");
    try {
      await uploadVersion(selectedProject.id, uploadFile);
      setUploadFile(null);
      await refreshVersions(selectedProject.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "上传失败");
    } finally {
      setBusyMessage("");
    }
  }

  async function handleViewLog(versionId: string) {
    setBusyMessage("正在读取构建日志...");
    setErrorMessage("");
    try {
      setLogText(await getBuildLog(versionId));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "读取日志失败");
    } finally {
      setBusyMessage("");
    }
  }

  async function copyText(text: string) {
    await navigator.clipboard.writeText(text);
    setBusyMessage("链接已复制");
    window.setTimeout(() => setBusyMessage(""), 1200);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <h1>本地 React 预览发布平台</h1>
          <p>上传项目压缩包，自动构建并生成预览链接。</p>
        </div>
        <button className="secondary" onClick={() => refreshProjects()}>
          刷新项目
        </button>
      </header>

      {busyMessage && <div className="notice">{busyMessage}</div>}
      {errorMessage && <div className="notice error">{errorMessage}</div>}

      <section className="workspace">
        <aside className="panel sidebar">
          <form onSubmit={handleCreateProject} className="form">
            <label htmlFor="projectName">新项目名称</label>
            <div className="inline">
              <input
                id="projectName"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                aria-label="项目名称，例如运营页预览"
              />
              <button type="submit">创建</button>
            </div>
          </form>

          <div className="projectList">
            {projects.map((project) => (
              <button
                className={project.id === selectedProjectId ? "project active" : "project"}
                key={project.id}
                onClick={() => setSelectedProjectId(project.id)}
              >
                <span>{project.name}</span>
                <small>{project.slug}</small>
              </button>
            ))}
            {projects.length === 0 && <p className="empty">还没有项目。</p>}
          </div>
        </aside>

        <section className="panel detail">
          {selectedProject ? (
            <>
              <div className="sectionHeader">
                <div>
                  <h2>{selectedProject.name}</h2>
                  <p>{selectedProject.slug}</p>
                </div>
                <button className="secondary" onClick={() => copyText(latestUrl(selectedProject))}>
                  复制最新链接
                </button>
              </div>

              <form onSubmit={handleUpload} className="uploadBox">
                <label htmlFor="zipFile">上传 React 项目 zip</label>
                <input
                  id="zipFile"
                  type="file"
                  accept=".zip"
                  onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
                />
                <button type="submit" disabled={!uploadFile}>
                  上传并构建
                </button>
              </form>

              <div className="versionHeader">
                <h3>版本记录</h3>
                <button className="secondary" onClick={() => refreshVersions()}>
                  刷新版本
                </button>
              </div>

              <div className="versions">
                {versions.map((version) => (
                  <article key={version.id} className="version">
                    <div>
                      <strong>{version.status}</strong>
                      <span>{new Date(version.createdAt).toLocaleString()}</span>
                      {version.errorMessage && <p className="failure">{version.errorMessage}</p>}
                    </div>
                    <div className="actions">
                      {version.status === "success" && (
                        <button className="secondary" onClick={() => copyText(versionUrl(selectedProject, version))}>
                          复制版本链接
                        </button>
                      )}
                      <button className="secondary" onClick={() => handleViewLog(version.id)}>
                        查看日志
                      </button>
                    </div>
                  </article>
                ))}
                {versions.length === 0 && <p className="empty">还没有上传版本。</p>}
              </div>

              <pre className="log">{logText || "选择一个版本查看构建日志。"}</pre>
            </>
          ) : (
            <p className="empty">请先创建或选择一个项目。</p>
          )}
        </section>
      </section>
    </main>
  );
}
```

`src/client/styles.css` 写入：

```css
:root {
  font-family: Inter, "Microsoft YaHei", system-ui, sans-serif;
  color: #18202f;
  background: #f4f7fb;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
}

button,
input {
  font: inherit;
}

button {
  border: 0;
  border-radius: 6px;
  background: #1f6feb;
  color: #ffffff;
  padding: 10px 14px;
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

button.secondary {
  background: #e8edf5;
  color: #25324a;
}

input {
  width: 100%;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 10px 12px;
  background: #ffffff;
}

.shell {
  min-height: 100vh;
  padding: 24px;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.topbar h1,
.topbar p,
.sectionHeader h2,
.sectionHeader p,
.versionHeader h3 {
  margin: 0;
}

.topbar p,
.sectionHeader p,
.empty,
.version span {
  color: #64748b;
}

.notice {
  margin-bottom: 12px;
  border-radius: 6px;
  background: #e0f2fe;
  color: #075985;
  padding: 10px 12px;
}

.notice.error {
  background: #fee2e2;
  color: #991b1b;
}

.workspace {
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 16px;
}

.panel {
  border: 1px solid #dbe3ef;
  border-radius: 8px;
  background: #ffffff;
  padding: 16px;
}

.form {
  display: grid;
  gap: 8px;
}

.inline {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
}

.projectList,
.versions {
  display: grid;
  gap: 8px;
  margin-top: 16px;
}

.project {
  display: grid;
  gap: 4px;
  width: 100%;
  background: #f8fafc;
  color: #18202f;
  text-align: left;
}

.project.active {
  background: #dbeafe;
}

.project small {
  color: #64748b;
}

.detail {
  min-width: 0;
}

.sectionHeader,
.versionHeader,
.version,
.actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.uploadBox {
  display: grid;
  gap: 10px;
  margin: 20px 0;
  padding: 14px;
  border: 1px dashed #94a3b8;
  border-radius: 8px;
  background: #f8fafc;
}

.version {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 12px;
}

.version div:first-child {
  display: grid;
  gap: 4px;
}

.failure {
  margin: 0;
  color: #b91c1c;
}

.log {
  min-height: 220px;
  max-height: 420px;
  overflow: auto;
  margin-top: 16px;
  border-radius: 8px;
  background: #111827;
  color: #d1d5db;
  padding: 14px;
  white-space: pre-wrap;
}

@media (max-width: 860px) {
  .shell {
    padding: 14px;
  }

  .topbar,
  .sectionHeader,
  .version,
  .actions {
    align-items: stretch;
    flex-direction: column;
  }

  .workspace {
    grid-template-columns: 1fr;
  }

  .inline {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 4: 运行前端构建和类型检查**

Run:

```bash
npm run typecheck
npm run build
```

Expected:

```text
typecheck passes
vite build completes
```

## Task 8: 本地运行说明和端到端验证

**Files:**
- Create: `README.md`

- [ ] **Step 1: 编写 README**

`README.md` 写入：

```md
# 本地 React 预览发布平台 MVP

这是一个运行在本地电脑上的团队内部 React 项目预览发布工具。

## 功能

- 创建项目
- 上传 React/Vite 项目 zip
- 自动安装依赖并执行构建
- 查看构建状态和日志
- 访问最新预览链接
- 访问指定版本预览链接

## 本地启动

```bash
npm install
npm run dev
```

默认访问：

```text
http://localhost:3000
```

## 可选环境变量

```text
PORT=3000
DATA_DIR=./data
PUBLIC_BASE_URL=http://localhost:3000
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
```

## 公网隧道

如果需要让其他网络的人访问预览链接，可以使用 Cloudflare Tunnel、ngrok、frp 或类似工具将 `http://localhost:3000` 暴露为公网地址。

本地电脑必须保持开机、联网，并避免进入睡眠状态。

## 上传项目要求

- zip 根目录应包含 `package.json`
- 项目应包含 `build` 脚本
- 构建输出目录应为 `dist` 或 `build`
```

- [ ] **Step 2: 运行完整测试**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Expected:

```text
all tests pass
typecheck passes
vite build completes
```

- [ ] **Step 3: 本地手动验证**

Run:

```bash
npm run dev
```

Manual checks:

```text
Open http://localhost:3000
Create a project
Upload a small Vite React project zip
Wait for status to become success
Open /p/<project-slug>
Open /p/<project-slug>/v/<version-id>
Open a nested route under the preview URL and confirm SPA fallback works
```

## 自查结果

### 规格覆盖

- 上传 zip：Task 6 和 Task 7 覆盖。
- 自动构建：Task 5 和 Task 6 覆盖。
- 构建日志：Task 6 和 Task 7 覆盖。
- 最新链接和版本链接：Task 6 覆盖。
- 本地文件存储：Task 4 覆盖。
- SQLite 数据记录：Task 3 覆盖。
- 本地运行和公网隧道说明：Task 8 覆盖。
- 后续 Docker 构建隔离：设计中保留为构建器边界，MVP 第一版先使用可替换的本机命令执行器，后续可将 `builder.ts` 替换为 Docker 执行器。

### 占位检查

计划中没有待定占位内容。Task 7 已包含 `App.tsx` 和 `styles.css` 的完整文件内容，验收通过 `typecheck`、`build` 和手动验证完成。

### 类型一致性

共享类型使用 `ProjectSummary`、`VersionSummary`、`BuildStatus`。数据库内部类型使用 `ProjectRecord`、`VersionRecord`。路由返回字段与前端 API 客户端保持一致。
