import { mkdirSync, writeFileSync } from "node:fs";
import { loadConfig, loadPersona } from "./config.js";
import { syncPhotos } from "./photos.js";
import { generatePost } from "./pipeline.js";
import { usage } from "./llm.js";

const [cmd, ...rest] = process.argv.slice(2);
const arg = (name: string, def?: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : def;
};
const flag = (name: string) => rest.includes(`--${name}`);

async function dryRun() {
  const n = Number(arg("n", "5"));
  const only = arg("type") as "text" | "photo" | undefined;
  const cfg = loadConfig();
  const persona = loadPersona();
  const lines: string[] = [`# Dry-run ${new Date().toISOString()}`, ""];
  for (let k = 1; k <= n; k++) {
    process.stdout.write(`[${k}/${n}] генерирую… `);
    const r = await generatePost(cfg, persona, {
      forceType: only, dry: true, holiday: arg("holiday"), mode: arg("mode") as "fantasy" | "grounded" | undefined,
    });
    console.log(`${r.status} id=${r.postId} score=${r.score} ревизий=${r.revisions} режим=${r.mode ?? "-"}${r.holiday ? " праздник=" + r.holiday : ""}`);
    lines.push(
      `## ${k}. ${r.status !== "rejected" ? "✅" : "❌"} id ${r.postId} · ${r.type}${r.genre ? " · " + r.genre : ""} · ${r.mode ?? ""}${r.holiday ? " · 🎉 " + r.holiday : ""} · score ${r.score} · ревизий ${r.revisions}`,
      "",
      r.photoPath ? `Фото: ${r.photoPath}\n\nОписание фото: ${r.photoDescription}\n\nЗацепка: ${r.hook}\nЗамысел: ${r.premise}\n` : "",
      "```", r.text, "```", "",
      r.issues.length ? "Замечания критика:\n" + r.issues.map((x) => `- ${x}`).join("\n") + "\n" : "",
    );
  }
  mkdirSync("out", { recursive: true });
  writeFileSync("out/review.md", lines.join("\n"));
  console.log(`\nТокены: вход ${usage.input}, выход ${usage.output}`);
  console.log("Отчёт: out/review.md (черновики сохранены как draft; опубликовать: publish --id N)");
}

async function uploadPhotos() {
  const { uploadPending } = await import("./storage.js");
  console.log("Файлов в папке: " + (await syncPhotos()));
  console.log("Загружено: " + (await uploadPending()));
}

async function threadsCheck() {
  const { getMe } = await import("./threads.js");
  const { getToken } = await import("./publisher.js");
  const me = await getMe(await getToken());
  console.log("Токен рабочий. Аккаунт: @" + me.username + " (id " + me.id + ")");
}

async function publishCmd() {
  const { publishApproved } = await import("./publisher.js");
  console.log("Опубликовано: " + (await publishApproved(Number(arg("id")))));
}

async function tickCmd() {
  const { tick } = await import("./scheduler.js");
  await tick(loadConfig(), loadPersona(), { dry: flag("dry") });
}

async function pauseCmd() {
  const { setState } = await import("./store.js");
  const on = arg("on", "1") ?? "1";
  await setState("paused", on);
  console.log(on === "1" ? "Агент поставлен на паузу" : "Пауза снята");
}

async function planCmd() {
  const { planDay, dayIn } = await import("./scheduler.js");
  const cfg = loadConfig();
  console.log("Пример слотов на сегодня (" + dayIn(cfg.timezone) + "):");
  for (const d of planDay(cfg, dayIn(cfg.timezone))) {
    console.log("  " + d.toISOString() + "  =  " + d.toLocaleString("en-US", { timeZone: cfg.timezone }) + " (NY)");
  }
}

async function notifyTest() {
  const { notify } = await import("./notify.js");
  await notify("🔔 Тест: уведомления ThreadsWriter работают");
  console.log("Тестовое сообщение отправлено");
}

async function repliesCmd() {
  const { replyRound } = await import("./replier.js");
  await replyRound(loadConfig(), loadPersona(), { dry: flag("dry") });
}

const commands: Record<string, () => Promise<void>> = {
  replies: repliesCmd, "notify-test": notifyTest,
  "dry-run": dryRun, "upload-photos": uploadPhotos, "threads-check": threadsCheck,
  publish: publishCmd, tick: tickCmd, pause: pauseCmd, "plan-day": planCmd,
};
if (!cmd || !commands[cmd]) {
  console.log([
    "Команды:",
    "  dry-run [--n 5] [--holiday id] [--mode fantasy|grounded]  сгенерировать черновики (draft), ничего не публикуя -> out/review.md",
    "  upload-photos            сжать и загрузить новые фото из photos/ в Supabase",
    "  threads-check            проверить токен Threads",
    "  publish --id N           опубликовать черновик/одобренный пост",
    "  tick [--dry]             один тик планировщика (то, что запускает GitHub Actions)",
    "  replies [--dry]          обработать новые комментарии (--dry: показать ответы, не отправляя)",
    "  pause [--on 0|1]         поставить агента на паузу / снять",
    "  notify-test              отправить тестовое уведомление в Telegram",
    "  plan-day                 показать пример случайных слотов на сегодня",
  ].join("\n"));
  process.exit(cmd ? 1 : 0);
}
commands[cmd]().catch((e) => { console.error(e); process.exit(1); });
