import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { LocalProjectRecord } from "./types";

export interface AppDatabase {
  createLocalProject(input: {
    name: string;
    projectPath: string;
    preferredPort: number | null;
    createdBy: string;
  }): LocalProjectRecord;
  listLocalProjects(): LocalProjectRecord[];
  getLocalProject(id: string): LocalProjectRecord | null;
  getLocalProjectByPath(projectPath: string): LocalProjectRecord | null;
  deleteLocalProject(id: string): void;
  resetRuntimeState(): void;
  updateLocalProjectCloud(
    id: string,
    cloud: Pick<LocalProjectRecord, "repositoryUrl" | "cloudPreviewUrl" | "lastPublishedAt" | "cloudLastError"> & Partial<Pick<LocalProjectRecord, "edgeOnePreviewUrl" | "edgeOneExpiresAt">>
  ): void;
  updateLocalProjectRuntime(
    id: string,
    runtime: Pick<LocalProjectRecord, "runtimeStatus" | "localUrl" | "publicUrl" | "lastError" | "stepIndex" | "stepTotal" | "stepLabel">
  ): void;
}

interface LocalProjectRow {
  id: string;
  name: string;
  project_path: string;
  preferred_port: number | null;
  runtime_status: LocalProjectRecord["runtimeStatus"];
  local_url: string | null;
  public_url: string | null;
  last_error: string | null;
  repository_url: string | null;
  cloud_preview_url: string | null;
  last_published_at: string | null;
  cloud_last_error: string | null;
  edgeone_preview_url: string | null;
  edgeone_expires_at: string | null;
  step_index: number;
  step_total: number;
  step_label: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

function now() {
  return new Date().toISOString();
}

function mapLocalProject(row: LocalProjectRow): LocalProjectRecord {
  return {
    id: row.id,
    name: row.name,
    projectPath: row.project_path,
    preferredPort: row.preferred_port,
    runtimeStatus: row.runtime_status,
    localUrl: row.local_url,
    publicUrl: row.public_url,
    lastError: row.last_error,
    repositoryUrl: row.repository_url,
    cloudPreviewUrl: row.cloud_preview_url,
    lastPublishedAt: row.last_published_at,
    cloudLastError: row.cloud_last_error,
    edgeOnePreviewUrl: row.edgeone_preview_url,
    edgeOneExpiresAt: row.edgeone_expires_at,
    stepIndex: row.step_index,
    stepTotal: row.step_total,
    stepLabel: row.step_label,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function initializeDatabase(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      project_path TEXT NOT NULL UNIQUE,
      preferred_port INTEGER,
      runtime_status TEXT NOT NULL CHECK (runtime_status IN ('idle', 'starting', 'running', 'failed', 'stopping')),
      local_url TEXT,
      public_url TEXT,
      last_error TEXT,
      repository_url TEXT,
      cloud_preview_url TEXT,
      last_published_at TEXT,
      cloud_last_error TEXT,
      edgeone_preview_url TEXT,
      edgeone_expires_at TEXT,
      step_index INTEGER NOT NULL DEFAULT 0,
      step_total INTEGER NOT NULL DEFAULT 0,
      step_label TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_local_projects_created_at
      ON local_projects(created_at DESC);
  `);

  const columns = db.prepare("PRAGMA table_info(local_projects)").all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));
  if (!columnNames.has("step_index")) {
    db.exec("ALTER TABLE local_projects ADD COLUMN step_index INTEGER NOT NULL DEFAULT 0;");
  }
  if (!columnNames.has("step_total")) {
    db.exec("ALTER TABLE local_projects ADD COLUMN step_total INTEGER NOT NULL DEFAULT 0;");
  }
  if (!columnNames.has("step_label")) {
    db.exec("ALTER TABLE local_projects ADD COLUMN step_label TEXT;");
  }
  if (!columnNames.has("repository_url")) {
    db.exec("ALTER TABLE local_projects ADD COLUMN repository_url TEXT;");
  }
  if (!columnNames.has("cloud_preview_url")) {
    db.exec("ALTER TABLE local_projects ADD COLUMN cloud_preview_url TEXT;");
  }
  if (!columnNames.has("last_published_at")) {
    db.exec("ALTER TABLE local_projects ADD COLUMN last_published_at TEXT;");
  }
  if (!columnNames.has("cloud_last_error")) {
    db.exec("ALTER TABLE local_projects ADD COLUMN cloud_last_error TEXT;");
  }
  if (!columnNames.has("edgeone_preview_url")) {
    db.exec("ALTER TABLE local_projects ADD COLUMN edgeone_preview_url TEXT;");
  }
  if (!columnNames.has("edgeone_expires_at")) {
    db.exec("ALTER TABLE local_projects ADD COLUMN edgeone_expires_at TEXT;");
  }
}

export function createDatabase(dbPath: string): AppDatabase {
  const db = new DatabaseSync(dbPath);
  initializeDatabase(db);

  return {
    createLocalProject(input) {
      const timestamp = now();
      const project: LocalProjectRecord = {
        id: randomUUID(),
        name: input.name,
        projectPath: input.projectPath,
        preferredPort: input.preferredPort,
        runtimeStatus: "idle",
        localUrl: null,
        publicUrl: null,
        lastError: null,
        repositoryUrl: null,
        cloudPreviewUrl: null,
        lastPublishedAt: null,
        cloudLastError: null,
        edgeOnePreviewUrl: null,
        edgeOneExpiresAt: null,
        stepIndex: 0,
        stepTotal: 0,
        stepLabel: null,
        createdBy: input.createdBy,
        createdAt: timestamp,
        updatedAt: timestamp
      };

      db.prepare(`
        INSERT INTO local_projects (
          id,
          name,
          project_path,
          preferred_port,
          runtime_status,
          local_url,
          public_url,
          last_error,
          repository_url,
          cloud_preview_url,
          last_published_at,
          cloud_last_error,
          edgeone_preview_url,
          edgeone_expires_at,
          step_index,
          step_total,
          step_label,
          created_by,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        project.id,
        project.name,
        project.projectPath,
        project.preferredPort,
        project.runtimeStatus,
        project.localUrl,
        project.publicUrl,
        project.lastError,
        project.repositoryUrl,
        project.cloudPreviewUrl,
        project.lastPublishedAt,
        project.cloudLastError,
        project.edgeOnePreviewUrl,
        project.edgeOneExpiresAt,
        project.stepIndex,
        project.stepTotal,
        project.stepLabel,
        project.createdBy,
        project.createdAt,
        project.updatedAt
      );

      return project;
    },

    listLocalProjects() {
      return db.prepare(`
        SELECT *
        FROM local_projects
        ORDER BY created_at DESC
      `).all().map((row) => mapLocalProject(row as unknown as LocalProjectRow));
    },

    getLocalProject(id) {
      const row = db.prepare(`
        SELECT *
        FROM local_projects
        WHERE id = ?
      `).get(id) as LocalProjectRow | undefined;

      return row ? mapLocalProject(row) : null;
    },

    getLocalProjectByPath(projectPath) {
      const row = db.prepare(`
        SELECT *
        FROM local_projects
        WHERE project_path = ?
      `).get(projectPath) as LocalProjectRow | undefined;

      return row ? mapLocalProject(row) : null;
    },

    deleteLocalProject(id) {
      db.prepare(`
        DELETE FROM local_projects
        WHERE id = ?
      `).run(id);
    },

    resetRuntimeState() {
      db.prepare(`
        UPDATE local_projects
        SET runtime_status = 'idle',
            local_url = NULL,
            public_url = NULL,
            last_error = NULL,
            step_index = 0,
            step_total = 0,
            step_label = NULL,
            updated_at = ?
        WHERE runtime_status IN ('starting', 'running', 'stopping', 'failed')
      `).run(now());
    },

    updateLocalProjectCloud(id, cloud) {
      db.prepare(`
        UPDATE local_projects
        SET repository_url = ?,
            cloud_preview_url = ?,
            last_published_at = ?,
            cloud_last_error = ?,
            edgeone_preview_url = COALESCE(?, edgeone_preview_url),
            edgeone_expires_at = COALESCE(?, edgeone_expires_at),
            updated_at = ?
        WHERE id = ?
      `).run(
        cloud.repositoryUrl,
        cloud.cloudPreviewUrl,
        cloud.lastPublishedAt,
        cloud.cloudLastError,
        cloud.edgeOnePreviewUrl ?? null,
        cloud.edgeOneExpiresAt ?? null,
        now(),
        id
      );
    },

    updateLocalProjectRuntime(id, runtime) {
      db.prepare(`
        UPDATE local_projects
        SET runtime_status = ?,
            local_url = ?,
            public_url = ?,
            last_error = ?,
            step_index = ?,
            step_total = ?,
            step_label = ?,
            updated_at = ?
        WHERE id = ?
      `).run(
        runtime.runtimeStatus,
        runtime.localUrl,
        runtime.publicUrl,
        runtime.lastError,
        runtime.stepIndex,
        runtime.stepTotal,
        runtime.stepLabel,
        now(),
        id
      );
    }
  };
}
