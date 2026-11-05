// Try a voice with the style in voice-style.txt: node scripts/voice-test.mjs <Puck|Leda|Fenrir|...> <out.wav> [text.txt]
// Reads GEMINI_API_KEY from the environment; books every attempt in tts-quota.json (100 requests/model/day).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
const [voice, out, textFile] = process.argv.slice(2);
const model = process.env.TTS_MODEL ?? "gemini-3.8-flash-tts";
const style = readFileSync(new URL("../voice-style.txt", import.meta.url), "utf8").trim();
const text = textFile ? readFileSync(textFile, "utf8").trim()
  : "ตายแล้วแม่! ดูพื้นบ้านนี้สิ กระเบื้องลายดอกฟ้า ยุคเก้าศูนย์มาก... แต่พอแปะแผ่นลายไม้นี่ลงไปนะแก แผ่นละสิบบาทเองค่ะ ไม่ต้องรื้อ ไม่ต้องจ้างช่าง แปะ แปะ แปะ เสร็จในบ่ายเดียว ห้องเปลี่ยนเป็นคาเฟ่เลยจ้า";
// book the attempt in the shared quota ledger
const qf = "tts-quota.json", day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
const all = existsSync(qf) ? JSON.parse(readFileSync(qf, "utf8")) : {}; const t = (all[day] ??= {});
t[model] = (t[model] ?? 0) + 1; writeFileSync(qf, JSON.stringify({ [day]: t }, null, 1));
const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ contents: [{ parts: [{ text: `${style}\n\nTranscript:\n${text}` }] }],
    generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } }) });
const j = await res.json();
const p = j.candidates?.[0]?.content?.parts?.find((x) => x.inlineData);
if (!p) { console.log(voice, "FAIL", JSON.stringify(j).slice(0, 400)); process.exitCode = 1; }
else {
  writeFileSync(out + ".raw", Buffer.from(p.inlineData.data, "base64"));
  const inp = p.inlineData.mimeType.includes("wav") ? ["-i", out + ".raw"] : ["-f", "s16le", "-ar", "24000", "-ac", "1", "-i", out + ".raw"];
  execFileSync("ffmpeg", ["-v", "error", "-y", ...inp, "-ar", "48000", out]);
  console.log(voice, "ok", `quota ${model}: ${t[model]}/100`);
}
