/** 去掉设置 JSON 里粘贴时可能带上的首尾引号和空白 */
export function sanitizeApiKey(raw: string | undefined | null): string {
  let key = (raw ?? "").trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1).trim();
  }
  return key;
}

/** 服务器地址和 API Key 都已填写 */
export function isConfigured(address: string | undefined | null, apiKey: string | undefined | null): boolean {
  return (address ?? "").trim().length > 0 && sanitizeApiKey(apiKey).length > 0;
}
