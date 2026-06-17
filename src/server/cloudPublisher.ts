import { runCommand } from "./processRunner";

export interface PublishCloudProjectInput {
  projectPath: string;
  repositoryUrl: string | null;
  commitMessage: string;
}

export interface PublishCloudProjectResult {
  repositoryUrl: string | null;
  lastPublishedAt: string;
}

function firstNonEmptyLine(text: string): string | null {
  return text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
}

function commandError(action: string, stdout: string, stderr: string): Error {
  return new Error(`${action}失败：${firstNonEmptyLine(stderr) ?? firstNonEmptyLine(stdout) ?? "请确认 GitHub 登录状态和网络连接。"}`);
}

async function runGit(projectPath: string, args: string[], action: string) {
  const result = await runCommand("git", args, projectPath);
  if (result.code !== 0) {
    throw commandError(action, result.stdout, result.stderr);
  }

  return result;
}

async function ensureGitRepository(projectPath: string) {
  const result = await runCommand("git", ["rev-parse", "--is-inside-work-tree"], projectPath);
  if (result.code !== 0 || !result.stdout.includes("true")) {
    await runGit(projectPath, ["init"], "初始化 Git 仓库");
  }
}

async function ensureRemote(projectPath: string, repositoryUrl: string | null): Promise<string | null> {
  const existingRemote = await runCommand("git", ["remote", "get-url", "origin"], projectPath);
  if (existingRemote.code === 0 && existingRemote.stdout.trim()) {
    return existingRemote.stdout.trim();
  }

  if (!repositoryUrl?.trim()) {
    throw new Error("请先填写 GitHub 仓库地址。");
  }

  await runGit(projectPath, ["remote", "add", "origin", repositoryUrl.trim()], "配置 GitHub 仓库地址");
  return repositoryUrl.trim();
}

async function ensureCommitIdentity(projectPath: string) {
  const [name, email] = await Promise.all([
    runCommand("git", ["config", "--get", "user.name"], projectPath),
    runCommand("git", ["config", "--get", "user.email"], projectPath)
  ]);

  if (name.code !== 0 || !name.stdout.trim()) {
    await runGit(projectPath, ["config", "user.name", "Local Live Share"], "配置 Git 提交作者");
  }

  if (email.code !== 0 || !email.stdout.trim()) {
    await runGit(projectPath, ["config", "user.email", "local-live-share@example.local"], "配置 Git 提交邮箱");
  }
}

async function hasStagedOrUnstagedChanges(projectPath: string): Promise<boolean> {
  const result = await runGit(projectPath, ["status", "--porcelain"], "检查 Git 改动");
  return result.stdout.trim().length > 0;
}

async function currentBranch(projectPath: string): Promise<string> {
  const result = await runCommand("git", ["branch", "--show-current"], projectPath);
  const branch = result.stdout.trim();
  if (result.code === 0 && branch) {
    return branch;
  }

  await runGit(projectPath, ["branch", "-M", "main"], "设置 Git 分支");
  return "main";
}

export async function publishCloudProject(input: PublishCloudProjectInput): Promise<PublishCloudProjectResult> {
  const commitMessage = input.commitMessage.trim() || "Update preview";

  await ensureGitRepository(input.projectPath);
  const repositoryUrl = await ensureRemote(input.projectPath, input.repositoryUrl);

  if (await hasStagedOrUnstagedChanges(input.projectPath)) {
    await ensureCommitIdentity(input.projectPath);
    await runGit(input.projectPath, ["add", "."], "暂存代码改动");
    await runGit(input.projectPath, ["commit", "-m", commitMessage], "提交代码");
  }

  const branch = await currentBranch(input.projectPath);
  await runGit(input.projectPath, ["push", "-u", "origin", branch], "推送到 GitHub");

  return {
    repositoryUrl,
    lastPublishedAt: new Date().toISOString()
  };
}
