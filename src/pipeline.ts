import { insertPost, pickPhoto, recentPostTexts } from "./store.js";
import { describePhoto } from "./agents/vision.js";
import { writePost, type Draft } from "./agents/writer.js";
import { reviewPost } from "./agents/critic.js";
import type { Config } from "./config.js";

export interface Result {
  status: "approved" | "rejected";
  type: "text" | "photo";
  text: string;
  genre?: string;
  topic?: string;
  mood?: string;
  score: number;
  revisions: number;
  issues: string[];
  photoPath?: string;
  photoDescription?: string;
  postId: number;
}

const pickWeighted = <T extends { weight: number }>(items: T[]): T => {
  let r = Math.random() * items.reduce((s, x) => s + x.weight, 0);
  for (const x of items) if ((r -= x.weight) <= 0) return x;
  return items[items.length - 1];
};
const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

/** Генерирует один пост: writer -> critic -> (rewrite)* -> сохранение в БД. Ничего не публикует. */
export async function generatePost(cfg: Config, persona: string, forceType?: "text" | "photo", dry = false): Promise<Result> {
  const photo = await pickPhoto();
  const type = forceType ?? (photo && Math.random() < cfg.photo_post_ratio ? "photo" : "text");
  const useCfgPhoto = type === "photo" && photo;
  const finalType: "text" | "photo" = useCfgPhoto ? "photo" : "text";

  const recent = await recentPostTexts(cfg.memory_size);
  const genre = finalType === "photo" ? pickWeighted(cfg.genres) : undefined;
  const topic = finalType === "text" ? pick(cfg.topics) : undefined;
  const photoDescription = useCfgPhoto ? await describePhoto(cfg, photo!) : undefined;

  let draft: Draft | undefined;
  let feedback: string[] | undefined;
  let score = 0;
  let issues: string[] = [];
  let verdict: "publish" | "revise" | "reject" = "revise";
  let revisions = 0;

  for (let attempt = 0; attempt <= cfg.max_revisions; attempt++) {
    draft = await writePost(cfg, {
      persona, recent, genre: genre?.name, photoDescription, topic, feedback, previous: draft?.text,
    });
    revisions = attempt;
    const review = await reviewPost(cfg, { persona, text: draft.text, recent, photoDescription });
    score = review.score;
    issues = [...review.issues];
    verdict = review.verdict;
    if (finalType === "photo") {
      const emoji = (draft.text.match(/\p{Extended_Pictographic}/gu) ?? []).length;
      if (emoji < 4) {
        issues.push(`Мало эмодзи: ${emoji}. Нужно 5-8, разбросанных по тексту (в конце абзацев и после ключевых моментов).`);
        verdict = "revise";
        score = Math.min(score, cfg.critic_min_score - 1);
      }
    }
    if (draft.text.length < cfg.min_post_chars) {
      issues.push(`Слишком коротко: ${draft.text.length} < ${cfg.min_post_chars}. Развей историю: завязка, развитие, поворот.`);
      verdict = "revise";
      score = Math.min(score, cfg.critic_min_score - 1);
    }
    if (draft.text.length > cfg.max_post_chars) {
      issues.push(`Текст длиннее лимита: ${draft.text.length} > ${cfg.max_post_chars}. Сократи.`);
      verdict = "revise";
      score = Math.min(score, cfg.critic_min_score - 1);
    }
    if (verdict === "publish" && score >= cfg.critic_min_score) break;
    if (verdict === "reject") break;
    feedback = issues;
  }

  const ok = verdict === "publish" && score >= cfg.critic_min_score;
  const text = draft!.text;
  const postId = await insertPost({
    status: ok ? (dry ? "draft" : "approved") : "rejected", type: finalType, text, genre: genre?.id ?? null, topic: draft!.topic,
    mood: draft!.mood, length: text.length, critic_score: score, revisions, photo_id: useCfgPhoto ? photo!.id : null,
  });

  return {
    status: ok ? "approved" : "rejected", type: finalType, text, genre: genre?.name, topic: draft!.topic,
    mood: draft!.mood, score, revisions, issues, photoPath: useCfgPhoto ? photo!.public_url ?? undefined : undefined,
    photoDescription, postId,
  };
}
