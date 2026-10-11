import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { photosToUpload, setPhotoUrl } from "./store.js";

const BUCKET = process.env.SUPABASE_BUCKET ?? "photos";

/** Сжимает фото до JPEG ~1440px, заливает в публичный бакет Supabase, возвращает публичный URL. */
export async function uploadPhoto(path: string): Promise<string> {
  const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error("Нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в .env");
  const jpg = await sharp(path).rotate().resize({ width: 1440, height: 1440, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  // Имя из хэша содержимого: одинаковые фото не дублируются, разные не перетирают друг друга.
  const name = `p_${createHash("sha1").update(readFileSync(path)).digest("hex").slice(0, 16)}.jpg`;
  const res = await fetch(`${base}/storage/v1/object/${BUCKET}/${name}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "image/jpeg", "x-upsert": "true" },
    body: new Uint8Array(jpg),
  });
  if (!res.ok) throw new Error(`Supabase upload ${name}: ${res.status} ${await res.text()}`);
  return `${base}/storage/v1/object/public/${BUCKET}/${name}`;
}

export async function uploadPending(): Promise<number> {
  const rows = await photosToUpload();
  let n = 0;
  for (const r of rows) {
    await setPhotoUrl(r.id, await uploadPhoto(r.path));
    n++;
    process.stdout.write(`\rзагружено ${n}/${rows.length}`);
  }
  if (rows.length) console.log();
  return n;
}
