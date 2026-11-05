// Voice-over for a story reel: one Gemini TTS request per beat (same voice + style prefix), trimmed WAVs.
// Usage (from a folder whose .env / environment has GEMINI_API_KEY):
//   node story-voice.mjs <story dir> [voice=Puck]      → <story dir>/vo/b01.wav … + vo/timing.json
// Existing beat files are kept unless FORCE=1 (or ONLY=b03,b07). Books attempts in ./tts-quota.json.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Gemini TTS answers with a WAV file (RIFF header + data chunk + ~6 KB of trailing chunks), not bare PCM.
// Decoding the whole file as s16le turns the header and the trailing bytes into loud static at both ends of every line.
const pcmOf = (buf) => {
  if (buf.toString("ascii", 0, 4) !== "RIFF") return { pcm: buf, rate: 24000 };
  let o = 12, rate = 24000;
  while (o + 8 <= buf.length) {
    const id = buf.toString("ascii", o, o + 4), n = buf.readUInt32LE(o + 4);
    if (id === "fmt ") rate = buf.readUInt32LE(o + 12);
    if (id === "data") return { pcm: buf.subarray(o + 8, Math.min(buf.length, o + 8 + n)), rate };
    o += 8 + n + (n & 1);
  }
  throw new Error("TTS WAV without a data chunk");
};

const here = dirname(fileURLToPath(import.meta.url));
const [dir, voice = "Puck"] = process.argv.slice(2);
const KEY = process.env.GEMINI_API_KEY;
if (!dir || !KEY) throw new Error("usage: node story-voice.mjs <story dir> [voice]");
const MODEL = process.env.TTS_MODEL ?? "gemini-3.8-flash-tts";
const story = JSON.parse(readFileSync(join(dir, "story.json"), "utf8"));
const styleFile = [join(dir, "voice-style.txt"), join(here, "..", "voice-style.txt")].find(existsSync);
const style = readFileSync(styleFile, "utf8").trim();
const out = join(dir, "vo");
mkdirSync(out, { recursive: true });
const only = process.env.ONLY?.split(",");
const dur = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());

const qf = "tts-quota.json", day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
const book = () => { const a = existsSync(qf) ? JSON.parse(readFileSync(qf, "utf8")) : {}; const t = (a[day] ??= {}); t[MODEL] = (t[MODEL] ?? 0) + 1; writeFileSync(qf, JSON.stringify({ [day]: t }, null, 1)); return t[MODEL]; };

for (const b of story.beats) {
  const wav = join(out, `${b.id}.wav`);
  if (only && !only.includes(b.id)) continue;
  if (existsSync(wav) && !process.env.FORCE && !only) continue;
  for (let attempt = 1; ; attempt++) {
    const n = book();
    if (n > 100) throw new Error("TTS daily quota used up");
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: `${style}\n\nTranscript:\n${b.vo}` }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } }) });
    const j = await res.json();
    const p = j.candidates?.[0]?.content?.parts?.find((x) => x.inlineData);
    if (p) {
      const { pcm, rate } = pcmOf(Buffer.from(p.inlineData.data, "base64"));
      writeFileSync(wav + ".raw", pcm);
      execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "s16le", "-ar", String(rate), "-ac", "1", "-i", wav + ".raw", "-af",
        "silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse", "-ar", "48000", wav]);
      rmSync(wav + ".raw");
      // Thai TTS speaks ~9–11 characters a second; far slower means it read the line twice (seen on 2 of 13 beats).
      const cps = [...b.vo.replace(/\s/g, "")].length / dur(wav);
      console.log(b.id, dur(wav).toFixed(2) + "s", `${cps.toFixed(1)} ch/s`, `(quota ${n}/100)`, cps < 7 ? "⚠ probably read twice — cut at the first long pause or ONLY=" + b.id : "");
      break;
    }
    if (j.error?.code === 429 && attempt < 4) { console.log(b.id, "rate limited, waiting 40 s"); await new Promise((r) => setTimeout(r, 40000)); continue; }
    throw new Error(`${b.id}: ${JSON.stringify(j).slice(0, 300)}`);
  }
  await new Promise((r) => setTimeout(r, 7000)); // stay under 10 requests/minute
}
const timing = story.beats.map((b) => ({ id: b.id, sec: existsSync(join(out, `${b.id}.wav`)) ? dur(join(out, `${b.id}.wav`)) : null, vo: b.vo }));
writeFileSync(join(out, "timing.json"), JSON.stringify(timing, null, 1));
console.log("total", timing.reduce((a, t) => a + (t.sec ?? 0), 0).toFixed(1), "s");
