// Облачное хранилище состояния: Supabase PostgREST (только fetch, без драйверов).
const base = () => process.env.SUPABASE_URL ?? (() => { throw new Error("Нужен SUPABASE_URL в .env"); })();
const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? (() => { throw new Error("Нужен SUPABASE_SERVICE_ROLE_KEY в .env"); })();

async function sb<T = unknown>(method: string, path: string, body?: unknown, prefer?: string): Promise<T> {
  const res = await fetch(`${base()}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key(), Authorization: `Bearer ${key()}`, "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase ${method} ${path}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export interface PhotoRow { id: number; public_url: string | null; description: string | null; used_at: string | null }
export interface PostRow {
  id: number; threads_id: string | null; status: string; type: string; text: string;
  genre: string | null; photo_id: number | null; critic_score: number | null; published_at: string | null;
}
export interface SlotRow { id: number; day: string; slot_at: string; post_id: number | null; done_at: string | null; skipped: boolean }

// ---- photos ----
export async function addPhoto(p: { path: string; public_url?: string; description?: string }): Promise<number> {
  const r = await sb<{ id: number }[]>("POST", "tw_photos?on_conflict=path", p, "resolution=ignore-duplicates,return=representation");
  if (r?.length) return r[0].id;
  return (await sb<{ id: number }[]>("GET", `tw_photos?select=id&path=eq.${encodeURIComponent(p.path)}`))[0].id;
}
export const photosToUpload = () =>
  sb<{ id: number; path: string }[]>("GET", "tw_photos?select=id,path&public_url=is.null&path=not.is.null");
export const setPhotoUrl = (id: number, url: string) => sb("PATCH", `tw_photos?id=eq.${id}`, { public_url: url });
export const setPhotoDescription = (id: number, d: string) => sb("PATCH", `tw_photos?id=eq.${id}`, { description: d });
export const markPhotoUsed = (id: number) => sb("PATCH", `tw_photos?id=eq.${id}`, { used_at: new Date().toISOString() });

/** Случайное неиспользованное фото; когда все использованы, самое давно использованное. */
export async function pickPhoto(): Promise<PhotoRow | undefined> {
  const sel = "select=id,public_url,description,used_at&public_url=not.is.null";
  const unused = await sb<PhotoRow[]>("GET", `tw_photos?${sel}&used_at=is.null&limit=2000`);
  if (unused.length) return unused[Math.floor(Math.random() * unused.length)];
  return (await sb<PhotoRow[]>("GET", `tw_photos?${sel}&order=used_at.asc&limit=1`))[0];
}

// ---- posts ----
export async function insertPost(p: Record<string, unknown>): Promise<number> {
  return (await sb<{ id: number }[]>("POST", "tw_posts", p, "return=representation"))[0].id;
}
export async function getPost(id: number): Promise<(PostRow & { public_url: string | null }) | undefined> {
  const r = await sb<(PostRow & { tw_photos: { public_url: string | null } | null })[]>(
    "GET", `tw_posts?select=*,tw_photos(public_url)&id=eq.${id}`);
  return r[0] && { ...r[0], public_url: r[0].tw_photos?.public_url ?? null };
}
export const markPublished = (id: number, threadsId: string) =>
  sb("PATCH", `tw_posts?id=eq.${id}`, { status: "published", threads_id: threadsId, published_at: new Date().toISOString() });
export async function recentPostTexts(n: number): Promise<string[]> {
  const r = await sb<{ text: string }[]>("GET", `tw_posts?select=text&status=in.(approved,published)&order=id.desc&limit=${n}`);
  return r.map((x) => x.text);
}

// ---- state ----
export async function getState(k: string): Promise<string | undefined> {
  return (await sb<{ value: string }[]>("GET", `tw_state?select=value&key=eq.${encodeURIComponent(k)}`))[0]?.value;
}
export const setState = (k: string, value: string) =>
  sb("POST", "tw_state?on_conflict=key", { key: k, value }, "resolution=merge-duplicates");

// ---- schedule ----
export const slotsForDay = (day: string) =>
  sb<SlotRow[]>("GET", `tw_schedule?select=*&day=eq.${day}&order=slot_at.asc`);
export const addSlots = (day: string, times: Date[]) =>
  sb("POST", "tw_schedule?on_conflict=day,slot_at", times.map((t) => ({ day, slot_at: t.toISOString() })), "resolution=ignore-duplicates");
export const updateSlot = (id: number, patch: Partial<Pick<SlotRow, "post_id" | "done_at" | "skipped">>) =>
  sb("PATCH", `tw_schedule?id=eq.${id}`, patch);

// ---- comments / replies ----
export const publishedPostsSince = (days: number) =>
  sb<{ id: number; threads_id: string; text: string }[]>(
    "GET", `tw_posts?select=id,threads_id,text&status=eq.published&threads_id=not.is.null&published_at=gte.${new Date(Date.now() - days * 86400_000).toISOString()}&order=id.desc`);

export async function knownCommentIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const r = await sb<{ id: string }[]>("GET", `tw_comments?select=id&id=in.(${ids.join(",")})`);
  return new Set(r.map((x) => x.id));
}
export const saveComment = (c: {
  id: string; post_id: number; username?: string; text?: string; commented_at?: string;
  class: string; reply_text?: string; reply_id?: string; replied_at?: string;
}) => sb("POST", "tw_comments?on_conflict=id", c, "resolution=ignore-duplicates");

export async function repliesSentSince(sinceIso: string): Promise<number> {
  const r = await sb<{ id: string }[]>("GET", `tw_comments?select=id&replied_at=gte.${encodeURIComponent(sinceIso)}`);
  return r.length;
}
/** Наши прошлые ответы этому человеку под этим постом (для истории диалога и лимита). */
export const repliesToUser = (postId: number, username: string) =>
  sb<{ text: string | null; reply_text: string }[]>(
    "GET", `tw_comments?select=text,reply_text&post_id=eq.${postId}&username=eq.${encodeURIComponent(username)}&reply_text=not.is.null&order=commented_at.asc`);

/** Темы/замыслы прошлых постов (новые первыми): для разнообразия сюжетов. */
export async function recentTopics(n: number): Promise<string[]> {
  const r = await sb<{ topic: string | null }[]>("GET", `tw_posts?select=topic&status=in.(approved,published)&topic=not.is.null&order=id.desc&limit=${n}`);
  return r.map((x) => x.topic!).filter(Boolean);
}
