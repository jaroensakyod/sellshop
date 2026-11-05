// Start frame per beat with Nano Banana + reference images, so every clip begins with the SAME people,
// place and product. A video tool (meta.ai / Flow) then animates each frame (image-to-video).
// Usage: node story-frames.mjs <story dir>      (GEMINI_API_KEY in the environment)
//
// story.json, new style (tile01):
//   refs:  { key: { file, role } }            reference images (file relative to the story dir)
//   setup: { key: { use: [keys], prompt } }   images made first and saved as refs/<key>.jpg (e.g. the room before/after)
//   beats: [{ id, use: [keys], frame }]       each start frame uses only the refs it names → frames/<id>.jpg
// Old style (chair01): refs/host.jpg + refs/gang.jpg + product.refImages for every beat, b01 skipped.
// Existing files are kept unless FORCE=1; ONLY=b02,b05 (or a setup key) limits the run.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [dir] = process.argv.slice(2);
const KEY = process.env.GEMINI_API_KEY;
if (!dir || !KEY) throw new Error("usage: node story-frames.mjs <story dir>");
const MODEL = process.env.IMG_MODEL ?? "gemini-3.1-flash-image";
const story = JSON.parse(readFileSync(join(dir, "story.json"), "utf8"));
const only = process.env.ONLY?.split(",");
const want = (id) => (only ? only.includes(id) : true);
mkdirSync(join(dir, "frames"), { recursive: true });
const STYLE = "Photoreal vertical 9:16 smartphone video frame, natural light, no text, no captions, no watermark.";

async function make(out, refList, text) {
  const parts = [];
  refList.forEach((r, i) => parts.push({ inlineData: { mimeType: "image/jpeg", data: readFileSync(r.file).toString("base64") } }));
  const roles = refList.map((r, i) => `IMAGE ${i + 1} = ${r.role}.`).join("\n");
  const keep = refList.length ? "\nKeep every person's face, hair and clothes, the room and the product identical to the reference images." : "";
  parts.push({ text: `${roles}${keep}\n${STYLE}\n\n${text}` });
  let j;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "9:16" } } }) });
    j = await res.json();
    if (j.error?.code !== 429) break;
    console.log("  rate limited, waiting 30 s"); await new Promise((r) => setTimeout(r, 30000));
  }
  const p = j.candidates?.[0]?.content?.parts?.find((x) => x.inlineData);
  if (!p) { console.log("  FAILED", JSON.stringify(j).slice(0, 300)); return false; }
  writeFileSync(out + ".src", Buffer.from(p.inlineData.data, "base64"));
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", out + ".src", "-frames:v", "1", "-q:v", "2", out]);
  rmSync(out + ".src");
  return true;
}

if (story.refs) {
  const ref = (k) => {
    const r = story.refs[k];
    if (!r) throw new Error(`unknown ref "${k}"`);
    const file = resolve(dir, r.file);
    if (!existsSync(file)) throw new Error(`ref "${k}" not made yet: ${file}`);
    return { file, role: r.role };
  };
  for (const [k, s] of Object.entries(story.setup ?? {})) {
    const out = resolve(dir, story.refs[k]?.file ?? `refs/${k}.jpg`);
    if (!want(k) || (existsSync(out) && !process.env.FORCE)) continue;
    console.log("setup", k, (await make(out, s.use.map(ref), s.prompt)) ? "✓" : "");
  }
  // a beat may have several shots (b01a, b01b …): short shots stop AI video drifting late in a clip
  for (const s of story.beats.flatMap((b) => b.shots ?? [b])) {
    const out = join(dir, "frames", `${s.id}.jpg`);
    if (!want(s.id) || (existsSync(out) && !process.env.FORCE && !only)) continue;
    console.log(s.id, (await make(out, (s.use ?? []).map(ref), `FIRST FRAME OF THIS SHOT: ${s.frame ?? s.shot}`)) ? "✓" : "");
  }
} else {
  const refs = [
    { file: join(dir, "refs", "host.jpg"), role: "the main character: this exact Thai katoey woman (face, long wavy dark hair, pink satin shirt, white shorts)" },
    { file: join(dir, "refs", "gang.jpg"), role: "her three friends and the place: the girl in the yellow t-shirt with a ponytail, the young man in the blue t-shirt, the girl in the pink top with long reddish hair, at this lakeside campsite at golden hour with tents and trees" },
    ...(story.product.refImages ?? []).map((f) => ({ file: resolve(dir, f), role: "the product: this exact khaki high-back padded folding camping chair with the headrest pillow (same shape, colour, fabric, black X-frame legs)" })),
  ].filter((r) => existsSync(r.file));
  for (const b of story.beats) {
    if (only ? !only.includes(b.id) : b.id === "b01") continue; // b01 is the source clip itself
    const out = join(dir, "frames", `${b.id}.jpg`);
    if (existsSync(out) && !process.env.FORCE && !only) { console.log(b.id, "(exists)"); continue; }
    console.log(b.id, (await make(out, refs, `FIRST FRAME OF THIS SHOT: ${b.frame ?? b.shot}`)) ? "✓" : "");
  }
}
