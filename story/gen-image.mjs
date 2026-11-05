// One Nano Banana image from reference images + a prompt (page profile picture, cover, thumbnails).
// Usage: node gen-image.mjs <out.jpg> <aspect e.g. 1:1|16:9|9:16> "<prompt>" [ref.jpg ...]   (GEMINI_API_KEY in the environment)
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";

const [out, aspect, prompt, ...refs] = process.argv.slice(2);
const KEY = process.env.GEMINI_API_KEY;
if (!out || !aspect || !prompt || !KEY) throw new Error('usage: node gen-image.mjs <out.jpg> <aspect> "<prompt>" [ref.jpg ...]');
const MODEL = process.env.IMG_MODEL ?? "gemini-3.1-flash-image";
const parts = refs.map((f) => ({ inlineData: { mimeType: "image/jpeg", data: readFileSync(f).toString("base64") } }));
parts.push({ text: prompt });
const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: aspect } } }) });
const j = await res.json();
const p = j.candidates?.[0]?.content?.parts?.find((x) => x.inlineData);
if (!p) throw new Error(JSON.stringify(j).slice(0, 300));
writeFileSync(out + ".src", Buffer.from(p.inlineData.data, "base64"));
execFileSync("ffmpeg", ["-v", "error", "-y", "-i", out + ".src", "-frames:v", "1", "-q:v", "2", out]);
rmSync(out + ".src");
console.log(out);
