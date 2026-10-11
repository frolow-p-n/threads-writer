// Разовый перенос данных из локальной SQLite (data/threads.db) в Supabase.
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";

const base = process.env.SUPABASE_URL!, key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const hdr = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" };
async function post<T>(table: string, body: unknown): Promise<T[]> {
  const r = await fetch(`${base}/rest/v1/${table}`, { method: "POST", headers: hdr, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${table}: ${r.status} ${await r.text()}`);
  return r.json() as Promise<T[]>;
}

if (!existsSync("data/threads.db")) { console.log("Локальной базы нет, переносить нечего"); process.exit(0); }
const db = new DatabaseSync("data/threads.db");
const photos = db.prepare("SELECT * FROM photos").all() as { id: number; path: string; public_url: string | null; description: string | null; used_at: string | null }[];
const idMap = new Map<number, number>();
for (const p of photos) {
  const [row] = await post<{ id: number }>("tw_photos", { path: p.path, public_url: p.public_url, description: p.description, used_at: p.used_at ? p.used_at.replace(" ", "T") + "Z" : null });
  idMap.set(p.id, row.id);
}
console.log(`Фото перенесено: ${photos.length}`);
const posts = db.prepare("SELECT * FROM posts WHERE status IN ('approved','published')").all() as Record<string, any>[];
for (const p of posts) {
  await post("tw_posts", {
    threads_id: p.threads_id, status: p.status, type: p.type, text: p.text, genre: p.genre, topic: p.topic, mood: p.mood,
    length: p.length, critic_score: p.critic_score, revisions: p.revisions, photo_id: p.photo_id ? idMap.get(p.photo_id) : null,
    created_at: p.created_at.replace(" ", "T") + "Z", published_at: p.published_at ? p.published_at.replace(" ", "T") + "Z" : null,
  });
}
console.log(`Постов перенесено: ${posts.length}`);
