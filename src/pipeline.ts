import { insertPost, pickPhoto, recentPostTexts, recentTopics } from "./store.js";
import { describePhoto } from "./agents/vision.js";
import { tightenPost, writePost, type Draft } from "./agents/writer.js";
import { reviewPost } from "./agents/critic.js";
import { ideate, type Idea } from "./agents/ideator.js";
import { chooseHoliday, whenText } from "./holidays.js";
import { DEVICES, FANTASY_WORLDS, GROUNDED_SITUATIONS, TWISTS, pickAvoiding } from "./ideas.js";
import { motifsIn, overusedMotifs } from "./motifs.js";
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
  holiday?: string;
  mode?: "fantasy" | "grounded";
  premise?: string;
  hook?: string;
}

export interface GenerateOpts {
  forceType?: "text" | "photo";
  dry?: boolean;
  holiday?: string; // принудительно тематический пост по id праздника (для проверки)
  mode?: "fantasy" | "grounded";
}

const pickWeighted = <T extends { weight: number }>(items: T[]): T => {
  let r = Math.random() * items.reduce((s, x) => s + x.weight, 0);
  for (const x of items) if ((r -= x.weight) <= 0) return x;
  return items[items.length - 1];
};
const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

/** Генерирует один пост: замысел -> writer -> critic -> (rewrite)* -> сохранение в БД. Ничего не публикует. */
export async function generatePost(cfg: Config, persona: string, opts: GenerateOpts = {}): Promise<Result> {
  const { forceType, dry = false } = opts;
  const photo = await pickPhoto();
  const type = forceType ?? (photo && Math.random() < cfg.photo_post_ratio ? "photo" : "text");
  const useCfgPhoto = type === "photo" && photo;
  const finalType: "text" | "photo" = useCfgPhoto ? "photo" : "text";

  const recent = await recentPostTexts(cfg.memory_size);
  const genre = finalType === "photo" ? pickWeighted(cfg.genres) : undefined;
  const topic = finalType === "text" ? pick(cfg.topics) : undefined;
  const photoDescription = useCfgPhoto ? await describePhoto(cfg, photo!) : undefined;

  // Праздничная неделя: тематика, остальное как обычно.
  const holiday = finalType === "photo" ? chooseHoliday(cfg, opts.holiday) : undefined;
  let avoid = overusedMotifs(recent);
  if (holiday) avoid = avoid.filter((m) => !m.startsWith("snacks")); // еда уместна в праздники

  // Замысел: фото лишь зацепка, сюжет придумывает отдельный шаг на «кубиках» разнообразия.
  let idea: Idea | undefined;
  let device = "";
  let setting = "";
  const mode = opts.mode ?? (Math.random() < cfg.fantasy_ratio ? "fantasy" : "grounded");
  if (finalType === "photo") {
    const topics = await recentTopics(24);
    setting = pickAvoiding(mode === "fantasy" ? FANTASY_WORLDS : GROUNDED_SITUATIONS, topics);
    device = pick(DEVICES);
    idea = await ideate(cfg, {
      persona,
      photoDescription: photoDescription!,
      setting,
      twist: pick(TWISTS),
      device,
      mode,
      tone: genre!.name,
      holiday: holiday ? { name: holiday.def.name, theme: holiday.def.theme, when: whenText(holiday) } : undefined,
      recentTopics: topics,
    });
  }
  const holidayNote = holiday ? `${holiday.def.name}: ${holiday.def.theme}` : undefined;

  let draft: Draft | undefined;
  let feedback: string[] | undefined;
  let score = 0;
  let issues: string[] = [];
  let verdict: "publish" | "revise" | "reject" = "revise";
  let revisions = 0;

  for (let attempt = 0; attempt <= cfg.max_revisions; attempt++) {
    draft = await writePost(cfg, {
      persona,
      recent,
      genre: genre?.name,
      photoDescription,
      topic,
      feedback,
      previous: draft?.text,
      avoid,
      idea: idea && { hook: idea.hook, premise: idea.premise, opening: idea.opening, device, holiday: holidayNote },
    });
    revisions = attempt;
    // Слишком длинно: сжимаем отдельным шагом (до 3 раз), а не просим писателя переписать с нуля.
    for (let t = 0; t < 3 && draft.text.length > cfg.max_post_chars; t++) {
      draft.text = await tightenPost(cfg, persona, draft.text, cfg.max_post_chars);
    }
    const review = await reviewPost(cfg, { persona, text: draft.text, recent, photoDescription, holiday: holidayNote });
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
    const repeated = motifsIn(draft.text, avoid);
    if (repeated.length) {
      issues.push(`Повтор надоевших образов: ${repeated.join("; ")}. Убери их, возьми свежую деталь.`);
      verdict = "revise";
      score = Math.min(score, cfg.critic_min_score - 1);
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
  // topic хранит «мир | замысел» (с меткой праздника): по нему подбираются непохожие сюжеты.
  const topicStored = idea
    ? `${holiday ? `[${holiday.def.id}] ` : ""}${setting} | ${idea.premise}`.slice(0, 400)
    : draft!.topic;
  const postId = await insertPost({
    status: ok ? (dry ? "draft" : "approved") : "rejected",
    type: finalType,
    text,
    genre: genre?.id ?? null,
    topic: topicStored,
    mood: draft!.mood,
    length: text.length,
    critic_score: score,
    revisions,
    photo_id: useCfgPhoto ? photo!.id : null,
  });

  return {
    status: ok ? "approved" : "rejected",
    type: finalType,
    text,
    genre: genre?.name,
    topic: topicStored,
    mood: draft!.mood,
    score,
    revisions,
    issues,
    photoPath: useCfgPhoto ? photo!.public_url ?? undefined : undefined,
    photoDescription,
    postId,
    holiday: holiday?.def.name,
    mode: finalType === "photo" ? mode : undefined,
    premise: idea?.premise,
    hook: idea?.hook,
  };
}
