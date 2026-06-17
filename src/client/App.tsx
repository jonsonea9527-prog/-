import { useEffect, useMemo, useState } from "react";
import type { LocalProjectSummary, RuntimeStatus } from "../shared/types";
import { buildAllAddressCopyText, canCopyAnyAddress } from "./addressCopy";
import {
  checkLocalProjectPublicUrl,
  createLocalProject,
  deleteLocalProject,
  getSystemStatus,
  installLocalProjectDependencies,
  listLocalProjects,
  pickLocalProjectFolder,
  publishLocalProjectToEdgeOne,
  publishLocalProjectToCloud,
  restartLocalProject,
  saveLocalProjectCloudSettings,
  startLocalProject,
  stopLocalProject
} from "./api";
import type { SystemStatus } from "./api";

const nodeDownloadUrl = "https://nodejs.org/en/download";

const statusLabels: Record<RuntimeStatus, string> = {
  idle: "未启动",
  starting: "启动中",
  running: "运行中",
  failed: "启动失败",
  stopping: "停止中"
};

const stepLabels: Record<string, string> = {
  "Checking project dependencies": "检查项目依赖",
  "Preparing launch directory": "准备启动目录",
  "Allocating an available port": "分配可用端口",
  "Starting local development server": "启动本地开发服务器",
  "Starting local preview server": "启动本地预览服务",
  "Creating public share URL": "创建公网分享地址",
  "Public tunnel cooldown": "公网隧道冷却中",
  "Public URL unavailable": "公网地址当前不可用",
  Ready: "已就绪",
  Stopping: "停止中",
  "Start failed": "启动失败"
};

function getProgressPercent(project: LocalProjectSummary): number {
  if (project.stepTotal <= 0) {
    return project.runtimeStatus === "running" ? 100 : 0;
  }

  return Math.max(0, Math.min(100, Math.round((project.stepIndex / project.stepTotal) * 100)));
}

function getProgressText(project: LocalProjectSummary): string {
  if (project.stepTotal <= 0) {
    return "未开始";
  }

  const currentStep = Math.min(project.stepIndex, project.stepTotal);
  return `第 ${currentStep} / ${project.stepTotal} 步`;
}

function getStepLabel(project: LocalProjectSummary): string {
  if (project.stepLabel) {
    return stepLabels[project.stepLabel] ?? project.stepLabel;
  }

  if (project.runtimeStatus === "running") {
    return "项目已启动，可以打开地址访问。";
  }

  if (project.runtimeStatus === "failed") {
    return project.localUrl
      ? "本地预览可继续使用，但公网分享没有成功建立。"
      : "启动失败。";
  }

  return "等待启动。";
}

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

interface ToastState {
  tone: "success" | "error";
  message: string;
}

type HelpTopic = "vercel" | "edgeone";

export default function App() {
  const [projects, setProjects] = useState<LocalProjectSummary[]>([]);
  const [projectPath, setProjectPath] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [busyProjectIds, setBusyProjectIds] = useState<string[]>([]);
  const [folderPickerAvailable, setFolderPickerAvailable] = useState(false);
  const [tunnelStatus, setTunnelStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<SystemStatus["runtime"] | null>(null);
  const [checkingSystemStatus, setCheckingSystemStatus] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [helpTopic, setHelpTopic] = useState<HelpTopic | null>(null);
  const [cloudForms, setCloudForms] = useState<Record<string, {
    repositoryUrl: string;
    cloudPreviewUrl: string;
    commitMessage: string;
    edgeOneApiToken: string;
    edgeOneProjectName: string;
  }>>({});

  const runningCount = useMemo(
    () => projects.filter((project) => project.runtimeStatus === "running").length,
    [projects]
  );

  async function refreshProjects(options?: { silent?: boolean }) {
    if (!options?.silent) {
      setLoadingProjects(true);
    }

    try {
      const nextProjects = await listLocalProjects();
      setProjects(nextProjects);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "加载项目失败。");
    } finally {
      if (!options?.silent) {
        setLoadingProjects(false);
      }
    }
  }

  function updateCloudForm(project: LocalProjectSummary, patch: Partial<{
    repositoryUrl: string;
    cloudPreviewUrl: string;
    commitMessage: string;
    edgeOneApiToken: string;
    edgeOneProjectName: string;
  }>) {
    setCloudForms((current) => ({
      ...current,
      [project.id]: {
        repositoryUrl: current[project.id]?.repositoryUrl ?? project.repositoryUrl ?? "",
        cloudPreviewUrl: current[project.id]?.cloudPreviewUrl ?? project.cloudPreviewUrl ?? "",
        commitMessage: current[project.id]?.commitMessage ?? "Update preview",
        edgeOneApiToken: current[project.id]?.edgeOneApiToken ?? "",
        edgeOneProjectName: current[project.id]?.edgeOneProjectName ?? project.name,
        ...patch
      }
    }));
  }

  async function refreshSystemStatus() {
    setCheckingSystemStatus(true);
    try {
      const status = await getSystemStatus();
      setFolderPickerAvailable(status.folderPickerAvailable);
      setRuntimeStatus(status.runtime ?? null);
      setTunnelStatus(status.tunnel ?? status.localtunnel ?? null);
    } finally {
      setCheckingSystemStatus(false);
    }
  }

  useEffect(() => {
    refreshProjects().catch((nextError: unknown) => {
      setError(nextError instanceof Error ? nextError.message : "加载项目失败。");
      setLoadingProjects(false);
    });

    refreshSystemStatus().catch(() => undefined);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshProjects({ silent: true });
    }, 3000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timer = window.setTimeout(() => {
      setToast(null);
    }, 1800);

    return () => window.clearTimeout(timer);
  }, [toast]);

  function showToast(message: string, tone: ToastState["tone"]) {
    setToast({ message, tone });
  }

  async function handleAddProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextPath = projectPath.trim();
    if (!nextPath) {
      setError("请输入本地项目路径。");
      return;
    }

    setError(null);
    setNotice(null);
    try {
      await createLocalProject(nextPath);
      setProjectPath("");
      await refreshProjects();
      setNotice("项目已添加。");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "添加项目失败。");
    }
  }

  async function handlePickFolder() {
    setError(null);
    try {
      const selectedPath = await pickLocalProjectFolder();
      if (selectedPath) {
        setProjectPath(selectedPath);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "选择文件夹失败。");
    }
  }

  async function runProjectAction(projectId: string, action: () => Promise<void>, successMessage: string) {
    setBusyProjectIds((current) => [...current, projectId]);
    setError(null);
    setNotice(null);

    try {
      await action();
      await refreshProjects();
      setNotice(successMessage);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "操作失败。");
    } finally {
      setBusyProjectIds((current) => current.filter((id) => id !== projectId));
    }
  }

  async function handleCopy(url: string) {
    setError(null);

    try {
      await copyText(url);
      showToast("链接已复制", "success");
    } catch {
      showToast("复制失败，请手动复制链接。", "error");
    }
  }

  async function handleCopyAllAddresses(project: LocalProjectSummary) {
    const text = buildAllAddressCopyText({
      localUrl: project.localUrl,
      publicUrl: project.publicUrl
    });

    if (!text) {
      showToast("当前没有可复制的地址。", "error");
      return;
    }

    try {
      await copyText(text);
      showToast("地址已复制", "success");
    } catch {
      showToast("复制失败，请手动复制地址。", "error");
    }
  }

  async function handleCheckPublicUrl(project: LocalProjectSummary) {
    setBusyProjectIds((current) => [...current, project.id]);
    setError(null);
    setNotice(null);

    try {
      const result = await checkLocalProjectPublicUrl(project.id);
      await refreshProjects();
      showToast(result.ok ? "公网地址检测通过" : result.message, result.ok ? "success" : "error");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "公网地址检测失败。");
    } finally {
      setBusyProjectIds((current) => current.filter((id) => id !== project.id));
    }
  }

  async function handleSaveCloudSettings(project: LocalProjectSummary) {
    const form = cloudForms[project.id] ?? {
      repositoryUrl: project.repositoryUrl ?? "",
      cloudPreviewUrl: project.cloudPreviewUrl ?? "",
      commitMessage: "Update preview",
      edgeOneApiToken: "",
      edgeOneProjectName: project.name
    };

    setBusyProjectIds((current) => [...current, project.id]);
    setError(null);
    setNotice(null);
    try {
      await saveLocalProjectCloudSettings(project.id, {
        repositoryUrl: form.repositoryUrl,
        cloudPreviewUrl: form.cloudPreviewUrl
      });
      await refreshProjects();
      showToast("云端发布信息已保存", "success");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "保存云端发布信息失败。");
    } finally {
      setBusyProjectIds((current) => current.filter((id) => id !== project.id));
    }
  }

  async function handlePublishCloud(project: LocalProjectSummary) {
    const form = cloudForms[project.id] ?? {
      repositoryUrl: project.repositoryUrl ?? "",
      cloudPreviewUrl: project.cloudPreviewUrl ?? "",
      commitMessage: "Update preview",
      edgeOneApiToken: "",
      edgeOneProjectName: project.name
    };

    setBusyProjectIds((current) => [...current, project.id]);
    setError(null);
    setNotice(null);
    try {
      await saveLocalProjectCloudSettings(project.id, {
        repositoryUrl: form.repositoryUrl,
        cloudPreviewUrl: form.cloudPreviewUrl
      });
      await publishLocalProjectToCloud(project.id, form.commitMessage);
      await refreshProjects();
      showToast("已推送到 GitHub", "success");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "推送到 GitHub 失败。");
      await refreshProjects({ silent: true });
    } finally {
      setBusyProjectIds((current) => current.filter((id) => id !== project.id));
    }
  }

  async function handlePublishEdgeOne(project: LocalProjectSummary) {
    const form = cloudForms[project.id] ?? {
      repositoryUrl: project.repositoryUrl ?? "",
      cloudPreviewUrl: project.cloudPreviewUrl ?? "",
      commitMessage: "Update preview",
      edgeOneApiToken: "",
      edgeOneProjectName: project.name
    };
    const apiToken = form.edgeOneApiToken.trim();

    if (!apiToken) {
      showToast("请先填写 EdgeOne API Token", "error");
      return;
    }

    setBusyProjectIds((current) => [...current, project.id]);
    setError(null);
    setNotice(null);
    try {
      await publishLocalProjectToEdgeOne(project.id, {
        apiToken,
        projectName: form.edgeOneProjectName.trim() || project.name
      });
      await refreshProjects();
      showToast("EdgeOne 临时预览已生成", "success");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "EdgeOne 临时预览生成失败。");
      await refreshProjects({ silent: true });
    } finally {
      setBusyProjectIds((current) => current.filter((id) => id !== project.id));
    }
  }

  const runtimeReady = runtimeStatus ? runtimeStatus.node.ok && runtimeStatus.npm.ok : true;
  const runtimeProblem = runtimeStatus && !runtimeReady
    ? [runtimeStatus.node.ok ? null : runtimeStatus.node.message, runtimeStatus.npm.ok ? null : runtimeStatus.npm.message]
      .filter(Boolean)
      .join(" ")
    : null;

  return (
    <main className="workspace">
      <header className="topbar">
        <div>
          <p className="eyebrow">本地项目实时预览与分享</p>
          <h1>Live Share 控制台</h1>
        </div>
        <div className="topbar__meta">
          项目 {projects.length} 个 / 运行中 {runningCount} 个
        </div>
      </header>

      {(error || notice) && (
        <div className={error ? "message message--error" : "message message--success"}>
          {error ?? notice}
        </div>
      )}

      {toast && (
        <div className={`toast toast--${toast.tone}`} role="status" aria-live="polite">
          {toast.message}
        </div>
      )}

      {helpTopic && (
        <div className="modal-backdrop" role="presentation" onClick={() => setHelpTopic(null)}>
          <div className="help-modal" role="dialog" aria-modal="true" aria-labelledby="cloud-help-title" onClick={(event) => event.stopPropagation()}>
            <div className="help-modal__head">
              <h2 id="cloud-help-title">{helpTopic === "vercel" ? "Vercel 发布帮助" : "EdgeOne 临时预览帮助"}</h2>
              <button type="button" className="icon-button" aria-label="关闭帮助" onClick={() => setHelpTopic(null)}>
                ×
              </button>
            </div>
            {helpTopic === "vercel" ? (
              <div className="help-modal__body">
                <p>适合生成长期可访问的预览地址，但在部分国内网络下可能需要代理才能访问。</p>
                <ol>
                  <li>先准备 GitHub 账号，并把本地项目创建成一个 GitHub 仓库。</li>
                  <li>打开 <a href="https://vercel.com" target="_blank" rel="noreferrer">vercel.com</a>，使用 GitHub 登录。</li>
                  <li>在 Vercel 中导入这个 GitHub 仓库，按默认配置部署。</li>
                  <li>把 GitHub 仓库地址填到这里的“GitHub 仓库地址”。</li>
                  <li>把 Vercel 生成的预览地址填到“Vercel 预览地址”。</li>
                  <li>以后点击“提交并推送 GitHub”，Vercel 会自动重新部署。</li>
                </ol>
              </div>
            ) : (
              <div className="help-modal__body">
                <p>适合生成国内网络更容易打开的临时预览地址。当前链接会自动过期，长期访问需要在 EdgeOne Pages 绑定正式域名。</p>
                <ol>
                  <li>打开 <a href="https://console.cloud.tencent.com/edgeone/pages" target="_blank" rel="noreferrer">腾讯云 EdgeOne Pages</a> 并登录账号。</li>
                  <li>在账号中创建或获取 EdgeOne Pages API Token。</li>
                  <li>把 Token 粘贴到这里的“EdgeOne API Token”。Token 只用于本次部署，软件不会保存。</li>
                  <li>填写一个项目名，通常用英文、数字和短横线，例如 attendance-preview。</li>
                  <li>点击“生成 EdgeOne 临时预览”，软件会自动构建项目并上传 dist 文件夹。</li>
                  <li>生成后复制或打开 EdgeOne 地址；如果过期，需要重新生成。</li>
                </ol>
              </div>
            )}
          </div>
        </div>
      )}

      <form className="create-form" onSubmit={handleAddProject}>
        <label htmlFor="project-path">添加本地 React + Vite 项目</label>
        <div className="inline-form">
          <input
            id="project-path"
            value={projectPath}
            onChange={(event) => setProjectPath(event.target.value)}
            placeholder="输入本地项目路径，例如 C:\\project\\demo"
          />
          {folderPickerAvailable && (
            <button type="button" className="ghost" onClick={handlePickFolder}>
              选择文件夹
            </button>
          )}
          <button type="submit">添加项目</button>
        </div>
      </form>

      {tunnelStatus && (
        <div className={tunnelStatus.ok ? "message message--success" : "message message--error"}>
          公网分享组件检测：{tunnelStatus.message}
        </div>
      )}

      {runtimeProblem ? (
        <div className="message message--warning system-warning">
          <div>
            <strong>运行环境未准备好：</strong>{runtimeProblem}
          </div>
          <div className="system-warning__actions">
            <a className="button-link" href={nodeDownloadUrl} target="_blank" rel="noreferrer">
              安装 Node.js LTS
            </a>
            <button
              type="button"
              className="ghost"
              onClick={() => refreshSystemStatus().catch(() => undefined)}
              disabled={checkingSystemStatus}
            >
              {checkingSystemStatus ? "检测中..." : "重新检测"}
            </button>
          </div>
        </div>
      ) : runtimeStatus ? (
        <div className="message message--success system-warning">
          <div>
            运行环境正常：Node {runtimeStatus.node.version ?? "已检测到"}，npm {runtimeStatus.npm.version ?? "已检测到"}
          </div>
          <button
            type="button"
            className="ghost"
            onClick={() => refreshSystemStatus().catch(() => undefined)}
            disabled={checkingSystemStatus}
          >
            {checkingSystemStatus ? "检测中..." : "重新检测"}
          </button>
        </div>
      ) : null}

      {loadingProjects ? (
        <p className="empty">正在加载项目...</p>
      ) : projects.length === 0 ? (
        <div className="empty-state">
          <h2>还没有项目</h2>
          <p>添加本地 React + Vite 项目后，可以启动本地预览，并尝试创建公网分享地址。</p>
        </div>
      ) : (
        <section className="project-grid">
          {projects.map((project) => {
            const busy = busyProjectIds.includes(project.id);
            const startingOrStopping = project.runtimeStatus === "starting" || project.runtimeStatus === "stopping";
            const hasWorkingPublicUrl = project.runtimeStatus === "running" && Boolean(project.publicUrl);
            const publicUrlNeedsCheck = project.runtimeStatus === "running"
              && Boolean(project.publicUrl)
              && Boolean(project.lastError);
            const hasAnyCopyableAddress = canCopyAnyAddress({
              localUrl: project.localUrl,
              publicUrl: project.publicUrl
            });
            const startDisabled = busy || startingOrStopping || project.runtimeStatus === "running" || !runtimeReady;
            const stopDisabled = busy || project.runtimeStatus === "idle" || project.runtimeStatus === "stopping";
            const restartDisabled = busy || startingOrStopping;
            const deleteDisabled = busy || startingOrStopping || project.runtimeStatus === "running";
            const cloudForm = cloudForms[project.id] ?? {
              repositoryUrl: project.repositoryUrl ?? "",
              cloudPreviewUrl: project.cloudPreviewUrl ?? "",
              commitMessage: "Update preview",
              edgeOneApiToken: "",
              edgeOneProjectName: project.name
            };
            const cloudReady = Boolean(cloudForm.repositoryUrl.trim());
            const edgeOneReady = Boolean(cloudForm.edgeOneApiToken.trim());

            return (
              <article key={project.id} className="project-card">
                <div className="detail-head">
                  <div>
                    <span className={`status status--${project.runtimeStatus}`}>
                      {statusLabels[project.runtimeStatus]}
                    </span>
                    <h2>{project.name}</h2>
                    <p className="muted">{project.projectPath}</p>
                  </div>
                </div>

                <div className="project-links">
                  <div className="progress-block">
                    <div className="progress-head">
                      <span>启动进度</span>
                      <strong>{getProgressText(project)}</strong>
                    </div>
                    <div className="progress-track" aria-hidden="true">
                      <div
                        className={`progress-fill progress-fill--${project.runtimeStatus}`}
                        style={{ width: `${getProgressPercent(project)}%` }}
                      />
                    </div>
                    <p className="progress-label">{getStepLabel(project)}</p>
                  </div>

                  <div className="latest-line">
                    <span>本地地址</span>
                    <div className="address-line">
                      {project.localUrl ? (
                        <>
                          <a href={project.localUrl} target="_blank" rel="noreferrer">
                            {project.localUrl}
                          </a>
                          <button
                            type="button"
                            className="ghost copy-button"
                            onClick={() => handleCopy(project.localUrl!)}
                            disabled={busy}
                          >
                            复制
                          </button>
                        </>
                      ) : (
                        <em>未生成</em>
                      )}
                    </div>
                  </div>

                  <div className="latest-line">
                    <span>公网地址</span>
                    <div className="address-line">
                      {hasWorkingPublicUrl ? (
                        <>
                          <a href={project.publicUrl!} target="_blank" rel="noreferrer">
                            {project.publicUrl}
                          </a>
                          <button
                            type="button"
                            className="ghost copy-button"
                            onClick={() => handleCopy(project.publicUrl!)}
                            disabled={busy}
                          >
                            复制
                          </button>
                        </>
                      ) : project.publicUrl ? (
                        <>
                          <em>{project.publicUrl}（当前不可用）</em>
                          <button
                            type="button"
                            className="ghost copy-button"
                            onClick={() => handleCopy(project.publicUrl!)}
                            disabled={busy}
                          >
                            复制
                          </button>
                        </>
                      ) : (
                        <em>未生成</em>
                      )}
                    </div>
                  </div>
                </div>

                <div className="cloud-panel">
                  <div className="cloud-panel__head">
                    <div>
                      <div className="cloud-title-row">
                        <h3>Vercel 长期预览</h3>
                        <button type="button" className="help-button" aria-label="查看 Vercel 帮助" onClick={() => setHelpTopic("vercel")}>
                          ?
                        </button>
                      </div>
                      <p className="muted">提交到 GitHub 后，Vercel 会自动生成长期预览地址。</p>
                    </div>
                    {project.lastPublishedAt && (
                      <span className="cloud-panel__time">上次推送 {new Date(project.lastPublishedAt).toLocaleString()}</span>
                    )}
                  </div>
                  <div className="cloud-fields">
                    <label>
                      GitHub 仓库地址
                      <input
                        value={cloudForm.repositoryUrl}
                        onChange={(event) => updateCloudForm(project, { repositoryUrl: event.target.value })}
                        placeholder="https://github.com/账号/仓库名"
                      />
                    </label>
                    <label>
                      Vercel 预览地址
                      <input
                        value={cloudForm.cloudPreviewUrl}
                        onChange={(event) => updateCloudForm(project, { cloudPreviewUrl: event.target.value })}
                        placeholder="https://项目名.vercel.app"
                      />
                    </label>
                    <label>
                      提交说明
                      <input
                        value={cloudForm.commitMessage}
                        onChange={(event) => updateCloudForm(project, { commitMessage: event.target.value })}
                        placeholder="例如：更新考勤页面"
                      />
                    </label>
                  </div>
                  <div className="version-actions cloud-actions">
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => handleSaveCloudSettings(project)}
                      disabled={busy}
                    >
                      保存云端信息
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePublishCloud(project)}
                      disabled={busy || !cloudReady}
                    >
                      提交并推送 GitHub
                    </button>
                    {project.repositoryUrl && (
                      <a href={project.repositoryUrl} target="_blank" rel="noreferrer">
                        打开 GitHub
                      </a>
                    )}
                    {project.cloudPreviewUrl && (
                      <>
                        <a href={project.cloudPreviewUrl} target="_blank" rel="noreferrer">
                          打开 Vercel
                        </a>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => handleCopy(project.cloudPreviewUrl!)}
                          disabled={busy}
                        >
                          复制云端地址
                        </button>
                      </>
                    )}
                  </div>
                  <div className="cloud-divider" />
                  <div className="cloud-panel__head">
                    <div>
                      <div className="cloud-title-row">
                        <h3>EdgeOne 临时预览</h3>
                        <button type="button" className="help-button" aria-label="查看 EdgeOne 帮助" onClick={() => setHelpTopic("edgeone")}>
                          ?
                        </button>
                      </div>
                      <p className="muted">生成 EdgeOne Pages 临时链接，适合国内网络快速查看，链接会自动过期。</p>
                    </div>
                    {project.edgeOneExpiresAt && (
                      <span className="cloud-panel__time">过期时间 {new Date(project.edgeOneExpiresAt).toLocaleString()}</span>
                    )}
                  </div>
                  <div className="cloud-fields cloud-fields--edgeone">
                    <label>
                      EdgeOne API Token
                      <input
                        type="password"
                        value={cloudForm.edgeOneApiToken}
                        onChange={(event) => updateCloudForm(project, { edgeOneApiToken: event.target.value })}
                        placeholder="仅本次部署使用，不会保存"
                        autoComplete="off"
                      />
                    </label>
                    <label>
                      EdgeOne 项目名
                      <input
                        value={cloudForm.edgeOneProjectName}
                        onChange={(event) => updateCloudForm(project, { edgeOneProjectName: event.target.value })}
                        placeholder={project.name}
                      />
                    </label>
                  </div>
                  <div className="version-actions cloud-actions">
                    <button
                      type="button"
                      onClick={() => handlePublishEdgeOne(project)}
                      disabled={busy || !edgeOneReady}
                    >
                      生成 EdgeOne 临时预览
                    </button>
                    {project.edgeOnePreviewUrl && (
                      <>
                        <a href={project.edgeOnePreviewUrl} target="_blank" rel="noreferrer">
                          打开 EdgeOne
                        </a>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => handleCopy(project.edgeOnePreviewUrl!)}
                          disabled={busy}
                        >
                          复制 EdgeOne 地址
                        </button>
                      </>
                    )}
                  </div>
                  {project.cloudLastError && (
                    <p className="row-error">{project.cloudLastError}</p>
                  )}
                </div>

                <div className="version-actions">
                  <button
                    type="button"
                    onClick={() => runProjectAction(project.id, () => startLocalProject(project.id), "已提交启动请求。")}
                    disabled={startDisabled}
                    title={!runtimeReady ? "请先安装 Node.js LTS 并重新检测" : undefined}
                  >
                    启动分享
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => runProjectAction(project.id, () => installLocalProjectDependencies(project.id), "项目依赖已安装。")}
                    disabled={busy || startingOrStopping || project.runtimeStatus === "running"}
                  >
                    安装依赖
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => runProjectAction(project.id, () => stopLocalProject(project.id), "项目已停止。")}
                    disabled={stopDisabled}
                  >
                    停止
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => runProjectAction(project.id, () => restartLocalProject(project.id), "已提交重启请求。")}
                    disabled={restartDisabled}
                  >
                    重启
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => runProjectAction(project.id, () => deleteLocalProject(project.id), "项目已删除。")}
                    disabled={deleteDisabled}
                  >
                    删除
                  </button>
                  {hasAnyCopyableAddress && (
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => handleCopyAllAddresses(project)}
                      disabled={busy}
                    >
                      复制全部地址
                    </button>
                  )}
                  {project.publicUrl && (
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => handleCheckPublicUrl(project)}
                      disabled={busy || startingOrStopping}
                    >
                      重新检测公网
                    </button>
                  )}
                </div>

                {project.lastError && (
                  <p className={publicUrlNeedsCheck ? "row-warning" : "row-error"}>
                    {publicUrlNeedsCheck
                      ? `公网地址已生成，但本机校验未通过：${project.lastError}`
                      : project.lastError}
                  </p>
                )}
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
