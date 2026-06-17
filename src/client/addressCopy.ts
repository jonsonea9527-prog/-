export interface CopyableAddresses {
  localUrl: string | null;
  publicUrl: string | null;
}

export function buildAllAddressCopyText(addresses: CopyableAddresses): string {
  const lines: string[] = [];

  if (addresses.localUrl) {
    lines.push("本地地址", addresses.localUrl);
  }

  if (addresses.publicUrl) {
    lines.push("公网地址", addresses.publicUrl);
  }

  return lines.join("\n");
}

export function canCopyAnyAddress(addresses: CopyableAddresses): boolean {
  return Boolean(addresses.localUrl || addresses.publicUrl);
}
