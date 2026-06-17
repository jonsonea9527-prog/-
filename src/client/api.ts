import type { LocalProjectSummary } from "../shared/types";

export interface SystemStatus {
  folderPickerAvailable: boolean;
  runtime?: {
    node: {
      ok: boolean;
      version?: string;
      message: string;
    };
    npm: {
      ok: boolean;
      version?: string;
      message: string;
    };
  };
  tunnel: {
    ok: boolean;
    message: string;
  };
  localtunnel?: {
    ok: boolean;
    message: string;
  };
}

async function parseError(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await response.json().catch(() => null) as { error?: unknown } | null;
    return typeof body?.error === "string" ? body.error : response.statusText;
  }

  const text = await response.text().catch(() => "");
  return text || response.statusText;
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Failed to fetch|fetch failed/i.test(message)) {
      throw new Error("控制台服务暂时不可达，请刷新页面或稍后重试。");
    }
    throw error;
  }

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return await response.json() as T;
}

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
  await requestJson<{ ok: true }>(`/api/local-projects/${projectId}/start`, { method: "POST" });
}

export async function installLocalProjectDependencies(projectId: string): Promise<void> {
  await requestJson<{ ok: true }>(`/api/local-projects/${projectId}/install-dependencies`, { method: "POST" });
}

export async function checkLocalProjectPublicUrl(projectId: string): Promise<{ ok: boolean; message: string }> {
  return await requestJson<{ ok: boolean; message: string }>(`/api/local-projects/${projectId}/check-public`, { method: "POST" });
}

export async function saveLocalProjectCloudSettings(
  projectId: string,
  input: { repositoryUrl: string; cloudPreviewUrl: string }
): Promise<LocalProjectSummary> {
  const body = await requestJson<{ project: LocalProjectSummary }>(`/api/local-projects/${projectId}/cloud`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  return body.project;
}

export async function publishLocalProjectToCloud(projectId: string, commitMessage: string): Promise<LocalProjectSummary> {
  const body = await requestJson<{ project: LocalProjectSummary }>(`/api/local-projects/${projectId}/cloud/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commitMessage })
  });
  return body.project;
}

export async function publishLocalProjectToEdgeOne(
  projectId: string,
  input: { apiToken: string; projectName: string }
): Promise<LocalProjectSummary> {
  const body = await requestJson<{ project: LocalProjectSummary }>(`/api/local-projects/${projectId}/cloud/edgeone`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  return body.project;
}

export async function stopLocalProject(projectId: string): Promise<void> {
  await requestJson<{ ok: true }>(`/api/local-projects/${projectId}/stop`, { method: "POST" });
}

export async function restartLocalProject(projectId: string): Promise<void> {
  await requestJson<{ ok: true }>(`/api/local-projects/${projectId}/restart`, { method: "POST" });
}

export async function deleteLocalProject(projectId: string): Promise<void> {
  const response = await fetch(`/api/local-projects/${projectId}`, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
}

export async function getSystemStatus(): Promise<SystemStatus> {
  return await requestJson<SystemStatus>("/api/system/status");
}

export async function pickLocalProjectFolder(): Promise<string | null> {
  const body = await requestJson<{ projectPath: string | null }>("/api/system/pick-folder", {
    method: "POST"
  });
  return body.projectPath;
}
