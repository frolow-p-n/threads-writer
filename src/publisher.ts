import { getPost, getState, markPhotoUsed, markPublished, setState } from "./store.js";
import { publishPost, refreshToken } from "./threads.js";

const DAY = 86400_000;

/** Токен хранится в облаке (tw_state); при первом запуске берётся из переменных окружения. Продлевается автоматически. */
export async function getToken(): Promise<string> {
  let token = (await getState("threads_token")) ?? process.env.THREADS_ACCESS_TOKEN;
  if (!token) throw new Error("Нет THREADS_ACCESS_TOKEN");
  const exp = (await getState("threads_token_expires")) ?? process.env.THREADS_TOKEN_EXPIRES;
  const left = exp ? (new Date(exp).getTime() - Date.now()) / DAY : 0;
  if (!exp || left < 20) {
    try {
      const r = await refreshToken(token);
      token = r.access_token;
      await setState("threads_token", token);
      await setState("threads_token_expires", new Date(Date.now() + r.expires_in * 1000).toISOString());
      console.log(`Токен Threads продлён на ${Math.round(r.expires_in / DAY)} дн.`);
    } catch (e) {
      if (left < 3) throw e; // токен почти умер и не продлился: падаем громко
      console.warn("Не удалось продлить токен (пока ещё жив):", (e as Error).message);
    }
  } else if (!(await getState("threads_token"))) {
    await setState("threads_token", token);
    await setState("threads_token_expires", new Date(exp!).toISOString());
  }
  return token;
}

/** Публикует одобренный пост из БД. */
export async function publishApproved(id: number): Promise<string> {
  const post = await getPost(id);
  if (!post) throw new Error(`Пост ${id} не найден`);
  if (post.status !== "approved" && post.status !== "draft") throw new Error(`Пост ${id} в статусе ${post.status}, публиковать можно только approved/draft`);
  const userId = process.env.THREADS_USER_ID;
  if (!userId) throw new Error("Нет THREADS_USER_ID");
  const r = await publishPost({ userId, token: await getToken(), text: post.text, imageUrl: post.public_url ?? undefined });
  await markPublished(id, r.id);
  if (post.photo_id) await markPhotoUsed(post.photo_id);
  return r.permalink ?? r.id;
}
