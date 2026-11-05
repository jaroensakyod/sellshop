// sellshop — affiliate reel pipeline (product → script → voice → shots → reel → post package).
// Usage:  node pipeline.mjs <productId> <pageId> [plan|voice|shots|video|post]
//   GEMINI_API_KEY comes from the environment or a .env file next to this script (never commit it).
// Steps (each one is cached in out/<page>__<product>/, a re-run skips finished steps; FORCE=<step> redoes one):
//   1 plan    Gemini writes hook / voice-over / shot prompts / caption for THIS page's angle (pages.json)
//   2 voice   Gemini TTS in the katoey storyteller style (voice-style.txt) with the page's prebuilt voice
//   3 shots   one still per shot with Nano Banana; shot 1 is the reference image for the rest,
//             so the host and the room stay the same (stand-in when there are no video clips)
//   4 video   ffmpeg → reel.mp4: video clips from out/<..>/clips/1.mp4, 2.mp4 … (Flow, see docs/FLOW.md)
//             or Ken Burns on the stills, + hook (first 3 s) + captions + "made with AI" label + voice at -14 LUFS
//   5 post    DRY RUN: writes post.json = the Facebook Graph API calls a live run would make; nothing is sent
// Env: TEXT_MODEL, TTS_MODEL, IMG_MODEL override the models; CAPTION_FONT the Thai font (default Leelawadee UI).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
for (const envFile of [join(here, ".env"), ".env"]) if (existsSync(envFile)) for (const l of readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Za-z_]\w*)\s*=\s*(.*?)\s*$/); if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
}
const KEY = process.env.GEMINI_API_KEY;
const [productId, pageId, only] = process.argv.slice(2);
if (!KEY || !productId || !pageId) throw new Error("usage: node pipeline.mjs <productId> <pageId> [plan|voice|shots|video|post]");
const product = JSON.parse(readFileSync(join(here, "products.json"), "utf8")).find((p) => p.id === productId);
const page = JSON.parse(readFileSync(join(here, "pages.json"), "utf8")).find((p) => p.id === pageId);
if (!product || !page) throw new Error("unknown product or page");
const out = join(here, "out", `${page.id}__${product.id}`);
mkdirSync(join(out, "shots"), { recursive: true });
const { TEXT_MODEL = "gemini-3.8-flash", TTS_MODEL = "gemini-3.8-flash-tts", IMG_MODEL = "gemini-3.1-flash-image", CAPTION_FONT = "Leelawadee UI" } = process.env;
const run = (step) => (!only || only === step) && (process.env.FORCE === step || !done(step));
const lastShot = () => { try { return JSON.parse(readFileSync(join(out, "plan.json"), "utf8")).shots.length; } catch { return 5; } };
const done = (step) => existsSync(join(out, { plan: "plan.json", voice: "vo.wav", shots: `shots/${lastShot()}.jpg`, video: "reel.mp4", post: "post.json" }[step]));
const QUOTA_FILE = join(here, "tts-quota.json");
const sh = (args, cwd = out) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { cwd, stdio: ["ignore", "inherit", "inherit"] });
const dur = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());

async function gemini(model, body) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEY}`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json();
    if (j.error?.code === 429 && attempt < 5) { console.log("  rate limited, waiting 30 s"); await new Promise((r) => setTimeout(r, 30000)); continue; }
    if (j.error) throw new Error(`${model}: ${JSON.stringify(j.error).slice(0, 300)}`);
    return j;
  }
}
const bookTts = () => { // shared daily ledger with scripts/tts-gemini.mjs (100 requests/model/day)
  const f = QUOTA_FILE, day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
  const all = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {}; const t = (all[day] ??= {});
  t[TTS_MODEL] = (t[TTS_MODEL] ?? 0) + 1; writeFileSync(f, JSON.stringify({ [day]: t }, null, 1));
  if (t[TTS_MODEL] > 100) throw new Error("TTS daily quota used up");
  return t[TTS_MODEL];
};

// 1 ─ plan
if (run("plan")) {
  console.log("1 plan");
  const prompt = `คุณเป็นครีเอเตอร์คลิปสั้นแนวตั้งของเพจ "${page.name}" (มุมของเพจ: ${page.angle})
สินค้า: ${product.name} ราคา ${product.price} บาทต่อ${product.unit}
จุดเด่น (ใช้เฉพาะข้อมูลนี้ ห้ามแต่งสรรพคุณเพิ่ม): ${product.points.join(" / ")}
ฉาก: ${product.scene}. พิธีกรในภาพ: ${page.host}.

เขียนแผนรีล 9:16 ยาวราว 20 วินาที ตอบเป็น JSON เท่านั้น:
{"hook": "ข้อความใหญ่บนจอ 3 วิแรก ไม่เกิน 30 ตัวอักษร ช็อกหรือชวนสงสัย",
 "vo": "บทพากย์ภาษาไทย 230-280 ตัวอักษร โทนพี่กะเทยเม้าท์มอยสนุก เป็นกันเอง (ใช้ แม่/แก/ตายแล้ว/จ้า ได้) ห้ามคำหยาบ ห้าม กู/มึง เขียนตัวเลขเป็นคำไทย ประโยคแรกต้องเป็นฮุกแรง ปิดท้ายชวนกดตะกร้า/ลิงก์ ห้ามอ้างว่าใช้เองมาแล้วจริง",
 "shots": [5 รายการ {"sec": วินาที, "prompt": "English image prompt, photoreal vertical 9:16, natural daylight, handheld phone-video look, no text in image"}] — ช็อตแรกต้องเป็นภาพที่แรงที่สุด (เช่นผลลัพธ์หลังเปลี่ยนเทียบของเดิม) ทุกช็อตใช้พิธีกรคนเดิมและห้องเดิม,
 "caption": "แคปชันโพสต์ไม่เกิน 300 ตัวอักษร มีอีโมจิได้ ลงท้ายด้วย #ad",
 "hashtags": ["5 แฮชแท็ก"]}`;
  const j = await gemini(TEXT_MODEL, { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } });
  const plan = JSON.parse(j.candidates[0].content.parts.map((p) => p.text).join(""));
  writeFileSync(join(out, "plan.json"), JSON.stringify(plan, null, 2));
  console.log("  hook:", plan.hook, `(${[...plan.hook].length} ตัว)`);
}
const plan = JSON.parse(readFileSync(join(out, "plan.json"), "utf8"));

// 2 ─ voice
if (run("voice")) {
  console.log("2 voice", page.voice, `(quota ${bookTts()}/100)`);
  const style = readFileSync(join(here, "voice-style.txt"), "utf8").trim();
  const j = await gemini(TTS_MODEL, { contents: [{ parts: [{ text: `${style}\n\nTranscript:\n${plan.vo}` }] }],
    generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: page.voice } } } } });
  const part = j.candidates[0].content.parts.find((p) => p.inlineData);
  writeFileSync(join(out, "vo.raw"), Buffer.from(part.inlineData.data, "base64"));
  sh(["-f", "s16le", "-ar", "24000", "-ac", "1", "-i", "vo.raw", "-af",
    "silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse", "-ar", "48000", "vo.wav"]);
}

// 3 ─ shots (stand-in for Flow / Veo)
if (run("shots")) {
  console.log("3 shots");
  let ref;
  for (const [i, s] of plan.shots.entries()) {
    const file = join(out, "shots", `${i + 1}.jpg`);
    if (existsSync(file) && process.env.FORCE !== "shots") { ref ??= readFileSync(file).toString("base64"); continue; }
    const parts = [{ text: `${s.prompt}\nSetting: ${product.scene}. Person: ${page.host}. Photoreal, vertical 9:16, no text, no watermark.` +
      (ref ? "\nKeep the SAME person, clothes and room as the reference image." : "") }];
    if (ref) parts.unshift({ inlineData: { mimeType: "image/jpeg", data: ref } });
    const j = await gemini(IMG_MODEL, { contents: [{ parts }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "9:16" } } });
    const img = j.candidates[0].content.parts.find((p) => p.inlineData);
    writeFileSync(file + ".src", Buffer.from(img.inlineData.data, "base64"));
    sh(["-i", file + ".src", "-frames:v", "1", "-q:v", "3", file]);
    ref ??= readFileSync(file).toString("base64");
    console.log("  shot", i + 1, "✓");
  }
}

// 4 ─ video
if (run("video")) {
  console.log("4 video");
  const FPS = 30, total = dur(join(out, "vo.wav")) + 0.8;
  // Video clips (Flow/Veo) in clips/1.mp4 … win over stills: trimmed to their slot, own audio dropped.
  const clips = [];
  for (let i = 1; existsSync(join(out, "clips", `${i}.mp4`)); i++) clips.push(`clips/${i}.mp4`);
  const w = clips.length ? clips.map((c) => dur(join(out, c))) : plan.shots.map((s) => s.sec || 4), sum = w.reduce((a, b) => a + b, 0);
  const secs = w.map((x) => (x / sum) * total);
  const inputs = [], chains = [];
  if (clips.length) console.log(`  using ${clips.length} video clips`);
  secs.forEach((sec, i) => {
    const frames = Math.round(sec * FPS);
    if (clips.length) {
      // start a little in so the cut lands on motion, never past the clip's end
      const start = Math.max(0, Math.min(0.3, w[i] - sec));
      inputs.push("-ss", start.toFixed(2), "-t", sec.toFixed(3), "-i", clips[i]);
      chains.push(`[${i}:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,fps=${FPS},setsar=1,trim=end_frame=${frames},setpts=PTS-STARTPTS[v${i}]`);
      return;
    }
    inputs.push("-loop", "1", "-framerate", String(FPS), "-t", sec.toFixed(3), "-i", `shots/${i + 1}.jpg`);
    const z = i % 2 ? `max(1.12-on*${(0.12 / frames).toFixed(6)},1)` : `min(1+on*${(0.12 / frames).toFixed(6)},1.12)`;
    chains.push(`[${i}:v]scale=1440:2560:force_original_aspect_ratio=increase,crop=1440:2560,zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=720x1280:fps=${FPS},trim=end_frame=${frames},setpts=PTS-STARTPTS[v${i}]`);
  });
  // captions: VO split into short lines, timed by character share (production: word timing from Whisper/snap-words)
  const lines = plan.vo.split(/(?<=[!?…]|\.\.\.|\s)/).reduce((acc, p) => {
    const last = acc[acc.length - 1]; if (last && [...last + p].length <= 22) acc[acc.length - 1] = last + p; else acc.push(p); return acc; }, []).map((s) => s.trim()).filter(Boolean);
  const voLen = total - 0.8, chars = lines.reduce((a, l) => a + [...l].length, 0);
  const t = (s) => { const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return `${h}:${String(m).padStart(2, "0")}:${(s % 60).toFixed(2).padStart(5, "0")}`; };
  let at = 0;
  const ev = lines.map((l) => { const d = ([...l].length / chars) * voLen; const e = `Dialogue: 0,${t(at)},${t(at + d)},Cap,,0,0,0,,${l}`; at += d; return e; });
  writeFileSync(join(out, "subs.ass"), `[Script Info]
ScriptType: v4.00+
PlayResX: 720
PlayResY: 1280

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Hook,${CAPTION_FONT},76,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,3,6,0,8,40,40,150,222
Style: Cap,${CAPTION_FONT},46,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,1,2,50,50,230,222
Style: Tag,${CAPTION_FONT},24,&H90FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,9,20,24,40,222

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 1,0:00:00.00,0:00:03.00,Hook,,0,0,0,,{\\3c&H00D7FF&}${plan.hook}
Dialogue: 1,0:00:00.00,${t(total)},Tag,,0,0,0,,ภาพและเสียงสร้างด้วย AI
${ev.join("\n")}
`);
  const n = secs.length;
  const graph = `${chains.join(";")};${[...Array(n).keys()].map((i) => `[v${i}]`).join("")}concat=n=${n}:v=1:a=0,ass=subs.ass,format=yuv420p[v];` +
    `[${n}:a]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,alimiter=limit=0.84:level=false,apad=whole_dur=${total.toFixed(3)}[a]`;
  sh([...inputs, "-i", "vo.wav", "-filter_complex", graph, "-map", "[v]", "-map", "[a]", "-t", total.toFixed(3),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "reel.mp4"]);
  console.log("  reel.mp4", total.toFixed(1), "s");
}

// 5 ─ post (DRY RUN)
if (run("post")) {
  const caption = `${plan.caption}\n\n🛒 ${product.link}\n${plan.hashtags.map((h) => (h.startsWith("#") ? h : "#" + h)).join(" ")}\n(ภาพและเสียงในคลิปสร้างด้วย AI)`;
  const post = {
    dryRun: true,
    note: "Nothing was sent. These are the Graph API calls a live run would make for this page.",
    page: page.name,
    calls: [
      { step: "start upload", method: "POST", url: `https://graph.facebook.com/v23.0/${page.graphPageId}/video_reels`, body: { upload_phase: "start", access_token: "<PAGE_TOKEN from env>" } },
      { step: "upload file", method: "POST", url: "https://rupload.facebook.com/video-upload/v23.0/<video_id>", file: "reel.mp4" },
      { step: "publish", method: "POST", url: `https://graph.facebook.com/v23.0/${page.graphPageId}/video_reels`,
        body: { upload_phase: "finish", video_id: "<video_id>", video_state: "SCHEDULED", scheduled_publish_time: "<page's own time slot>", description: caption } },
    ],
    caption,
    captionChars: [...caption].length,
  };
  writeFileSync(join(out, "post.json"), JSON.stringify(post, null, 2));
  console.log("5 post (dry run) → post.json,", post.captionChars, "chars");
}
console.log("done:", out);
