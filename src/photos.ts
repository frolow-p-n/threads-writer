import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { addPhoto } from "./store.js";

const EXT = /\.(jpe?g|png|webp)$/i;

/** Регистрирует файлы локальной папки в облачной таблице (загрузка отдельно: upload-photos). */
export async function syncPhotos(dir = "photos"): Promise<number> {
  let n = 0;
  for (const f of readdirSync(dir)) {
    if (!EXT.test(f)) continue;
    await addPhoto({ path: resolve(join(dir, f)) });
    n++;
  }
  return n;
}
