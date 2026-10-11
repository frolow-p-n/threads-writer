import { readFileSync, writeFileSync } from "node:fs";

const BASE = "https://graph.threads.net";

async function api<T>(path: string, params: Record<string, string>, method: "GET" | "POST" = "GET"): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(method === "GET" ? `${BASE}${path}?${qs}` : `${BASE}${path}`, {
    method,
    headers: method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : undefined,
    body: method === "POST" ? qs : undefined,
  });
  const json = (await res.json()) as T & { error?: { message: string; code: number } };
  if (!res.ok || json.error) throw new Error(`Threads API ${path}: ${json.error?.message ?? res.status} (code ${json.error?.code ?? "?"})`);
  return json;
}

export const getMe = (token: string) =>
  api<{ id: string; username: string }>("/v1.0/me", { fields: "id,username", access_token: token });

/** Короткий токен (1 час) -> долгоживущий (60 дней). */
export const exchangeToken = (shortToken: string, appSecret: string) =>
  api<{ access_token: string; expires_in: number }>("/access_token", {
    grant_type: "th_exchange_token", client_secret: appSecret, access_token: shortToken,
  });

/** Продление долгоживущего токена (можно после 24 ч жизни). */
export const refreshToken = (token: string) =>
  api<{ access_token: string; expires_in: number }>("/refresh_access_token", {
    grant_type: "th_refresh_token", access_token: token,
  });

/** Обновляет значение переменной в .env, не выводя секреты в консоль. */
export function setEnv(key: string, value: string, file = ".env") {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const i = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (i >= 0) lines[i] = `${key}=${value}`; else lines.push(`${key}=${value}`);
  writeFileSync(file, lines.join("\n"));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Публикация поста: контейнер -> ожидание обработки -> threads_publish. Возвращает {id, permalink}. */
export async function publishPost(opts: { userId: string; token: string; text: string; imageUrl?: string; replyToId?: string }) {
  const { userId, token, text, imageUrl, replyToId } = opts;
  const container = await api<{ id: string }>(`/v1.0/${userId}/threads`, {
    media_type: imageUrl ? "IMAGE" : "TEXT", text, ...(imageUrl ? { image_url: imageUrl } : {}), ...(replyToId ? { reply_to_id: replyToId } : {}), access_token: token,
  }, "POST");
  // Meta рекомендует подождать перед публикацией; проверяем статус контейнера.
  for (let i = 0; i < 12; i++) {
    await sleep(5000);
    const s = await api<{ status: string; error_message?: string }>(`/v1.0/${container.id}`, { fields: "status,error_message", access_token: token });
    if (s.status === "FINISHED") break;
    if (s.status === "ERROR" || s.status === "EXPIRED") throw new Error(`Контейнер ${s.status}: ${s.error_message ?? ""}`);
  }
  const pub = await api<{ id: string }>(`/v1.0/${userId}/threads_publish`, { creation_id: container.id, access_token: token }, "POST");
  const info = await api<{ permalink?: string }>(`/v1.0/${pub.id}`, { fields: "permalink", access_token: token });
  return { id: pub.id, permalink: info.permalink };
}

export interface ThreadsComment {
  id: string; text?: string; username?: string; timestamp?: string;
  replied_to?: { id: string }; is_reply_owned_by_me?: boolean; hide_status?: string;
}

/** Все комментарии под постом (включая вложенные), до 3 страниц. */
export async function getConversation(mediaId: string, token: string): Promise<ThreadsComment[]> {
  const out: ThreadsComment[] = [];
  let after: string | undefined;
  for (let page = 0; page < 3; page++) {
    const r = await api<{ data: ThreadsComment[]; paging?: { cursors?: { after?: string }; next?: string } }>(
      `/v1.0/${mediaId}/conversation`,
      { fields: "id,text,username,timestamp,replied_to,is_reply_owned_by_me,hide_status", access_token: token, ...(after ? { after } : {}) },
    );
    out.push(...r.data);
    after = r.paging?.next ? r.paging.cursors?.after : undefined;
    if (!after) break;
  }
  return out;
}
