import { runCommand } from "./processRunner";

function encodePowerShellCommand(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

function looksLikeBase64(value: string): boolean {
  return /^[A-Za-z0-9+/=]+$/.test(value) && value.length % 4 === 0;
}

export function decodePickedFolder(encoded: string): string | null {
  const trimmed = encoded.trim();
  if (!trimmed) {
    return null;
  }

  if (!looksLikeBase64(trimmed)) {
    throw new Error("folder picker returned invalid output");
  }

  return Buffer.from(trimmed, "base64").toString("utf8");
}

export async function pickFolder(): Promise<string | null> {
  if (process.platform !== "win32") {
    throw new Error("folder picker is only supported on Windows");
  }

  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$dialog.ShowNewFolderButton = $false",
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "$utf8 = [System.Text.Encoding]::UTF8",
    'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
    '  $bytes = $utf8.GetBytes($dialog.SelectedPath)',
    '  [Convert]::ToBase64String($bytes)',
    "}"
  ].join("; ");

  const result = await runCommand(
    "powershell.exe",
    ["-NoProfile", "-STA", "-EncodedCommand", encodePowerShellCommand(script)],
    process.cwd()
  );
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "folder picker failed");
  }

  return decodePickedFolder(result.stdout);
}
