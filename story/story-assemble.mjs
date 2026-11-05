// Assemble a story reel: one slot per beat = its voice-over length (+ a short breath).
// Visual per beat: clips/<id>.mp4 (meta.ai / Flow, own audio dropped) if present, else frames/<id>.jpg with a slow push-in.
// Captions follow each beat's own VO; a hook line on the first 3 s; "made with AI" label throughout; voice at -14 LUFS.
// Usage: node story-assemble.mjs <story dir> [hook text]   → <story dir>/story.mp4
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [dirArg, hook = ""] = process.argv.slice(2);
const dir = resolve(dirArg); // absolute: the concat list resolves paths from its own folder
const story = JSON.parse(readFileSync(join(dir, "story.json"), "utf8"));
const FPS = 24, GAP = 0.25, FONT = process.env.CAPTION_FONT ?? "Leelawadee UI";
const dur = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());
const t = (s) => `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${(s % 60).toFixed(2).padStart(5, "0")}`;

const inputs = [], chains = [], events = [], voList = [];
let at = 0, n = 0;
for (const b of story.beats) {
  const vo = join(dir, "vo", `${b.id}.wav`);
  if (!existsSync(vo)) throw new Error(`missing ${vo}`);
  const sec = dur(vo) + GAP, frames = Math.round(sec * FPS);
  // A beat is one or more shots. shot.take = [start, max seconds] = the part of the AI clip checked to be drift-free
  // (AI video drifts late in a clip, so only the first few seconds are used). The beat's slot is shared by the
  // shots in proportion to their max; if the shots are short, they are slowed up to 20 %, then the last frame is held.
  const shots = (b.shots ?? [{ id: b.id }]).map((s) => {
    const clip = join(dir, "clips", `${s.clip ?? s.id}.mp4`), still = join(dir, s.still ?? join("frames", `${s.id}.jpg`));
    const isClip = !s.still && existsSync(clip);
    if (!isClip && !existsSync(still)) throw new Error(`no clip or frame for ${s.id}`);
    const [start, max] = s.take ?? [0, isClip ? dur(clip) : sec];
    return { ...s, file: isClip ? clip : still, isClip, start, max };
  });
  const sum = shots.reduce((a, s) => a + s.max, 0);
  let used = 0;
  shots.forEach((s, i) => {
    const f = i === shots.length - 1 ? frames - used : Math.round((frames * s.max) / sum);
    used += f;
    const len = f / FPS, label = `[s${n}_${i}]`;
    if (s.isClip) {
      const slow = Math.min(Math.max(len / s.max, 1), 1.2);
      inputs.push("-ss", String(s.start), "-t", String(s.max), "-i", s.file);
      chains.push(`[${inputs.filter((x) => x === "-i").length - 1}:v]setpts=${slow.toFixed(4)}*(PTS-STARTPTS),scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,fps=${FPS},setsar=1,tpad=stop_mode=clone:stop_duration=${Math.max(0, len - s.max * slow + 0.1).toFixed(2)},trim=end_frame=${f},setpts=PTS-STARTPTS${label}`);
    } else {
      inputs.push("-loop", "1", "-framerate", String(FPS), "-t", len.toFixed(3), "-i", s.file);
      const k = inputs.filter((x) => x === "-i").length - 1;
      const push = `zoompan=z='min(1+on*${(0.08 / f).toFixed(6)},1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=720x1280:fps=${FPS}`;
      // fit: a square product photo shown whole on a blurred copy of itself (nothing cropped off)
      chains.push(s.fit
        ? `[${k}:v]split[pa${k}][pb${k}];[pa${k}]crop=iw:ih*0.7:0:0,scale=1440:2560:force_original_aspect_ratio=increase,crop=1440:2560,boxblur=40[bg${k}];[pb${k}]scale=1360:-2[fg${k}];[bg${k}][fg${k}]overlay=(W-w)/2:(H-h)/2,setsar=1,${push},trim=end_frame=${f},setpts=PTS-STARTPTS${label}`
        : `[${k}:v]scale=1440:2560:force_original_aspect_ratio=increase,crop=1440:2560,setsar=1,${push},trim=end_frame=${f},setpts=PTS-STARTPTS${label}`);
    }
  });
  chains.push(`${shots.map((_, i) => `[s${n}_${i}]`).join("")}concat=n=${shots.length}:v=1:a=0[v${n}]`);
  // captions: split the line into ≤ 22-character pieces, timed by character share
  const parts = b.vo.split(/(?<=[!?…]|\.\.\.|\s)/).reduce((acc, p) => {
    const last = acc[acc.length - 1]; if (last && [...last + p].length <= 22) acc[acc.length - 1] = last + p; else acc.push(p); return acc; }, []).map((s) => s.trim()).filter(Boolean);
  const chars = parts.reduce((a, l) => a + [...l].length, 0), speak = sec - GAP;
  let c = at;
  for (const p of parts) { const d = ([...p].length / chars) * speak; events.push(`Dialogue: 0,${t(c)},${t(c + d)},Cap,,0,0,0,,${p}`); c += d; }
  voList.push(`file '${vo.replace(/\\/g, "/")}'`, `duration ${dur(vo).toFixed(3)}`, `file 'gap.wav'`, `duration ${GAP}`);
  at += sec; n++;
}
const total = at;
writeFileSync(join(dir, "gap.wav"), Buffer.alloc(0)); // placeholder, replaced below
execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `anullsrc=r=48000:cl=mono`, "-t", String(GAP), join(dir, "gap.wav")]);
writeFileSync(join(dir, "vo-list.txt"), voList.join("\n") + "\n");
execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", join(dir, "vo-list.txt"), "-ar", "48000", "-ac", "1", join(dir, "vo-all.wav")]);

writeFileSync(join(dir, "subs.ass"), `[Script Info]
ScriptType: v4.00+
PlayResX: 720
PlayResY: 1280

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Hook,${FONT},70,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,3,6,0,8,40,40,150,222
Style: Cap,${FONT},46,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,1,2,50,50,230,222
Style: Tag,${FONT},24,&H90FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,9,20,24,40,222

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${hook ? `Dialogue: 1,0:00:00.00,0:00:03.00,Hook,,0,0,0,,{\\3c&H00D7FF&}${hook}\n` : ""}Dialogue: 1,0:00:00.00,${t(total)},Tag,,0,0,0,,ภาพและเสียงสร้างด้วย AI
${events.join("\n")}
`);
const graph = `${chains.join(";")};${[...Array(n).keys()].map((i) => `[v${i}]`).join("")}concat=n=${n}:v=1:a=0,ass=subs.ass,format=yuv420p[v];` +
  `[${inputs.filter((x) => x === "-i").length}:a]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,alimiter=limit=0.84:level=false,apad=whole_dur=${total.toFixed(3)}[a]`;
execFileSync("ffmpeg", ["-v", "error", "-y", ...inputs, "-i", "vo-all.wav", "-filter_complex", graph, "-map", "[v]", "-map", "[a]",
  "-t", total.toFixed(3), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "story.mp4"],
  { cwd: dir, stdio: ["ignore", "inherit", "inherit"] });
console.log("story.mp4", total.toFixed(1), "s,", n, "beats");
