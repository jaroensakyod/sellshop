// Helpers for Google Flow (flow.google.com) — paste into the DevTools console of your Flow project page,
// or run through an automated browser (Claude's built-in browser / Playwright) with the same JS.
// Flow has no public API, so the pipeline drives the web page. Nothing here clicks "generate" for you:
// a JS click does not submit, the real button must be clicked (by you or by the browser tool).
//
//   flow.type("prompt")    put text into the prompt box (React-safe insertText)
//   flow.attached()        ids of the image(s) attached as start frame / ingredient — check BEFORE you generate
//   flow.images()          signed URLs of generated stills, newest first (curl-able for ~6 h)
//   flow.watchVideos()     start capturing signed video URLs; then open each video once (or reload + open)
//   flow.videos()          captured video URLs + ready-to-run curl lines
//   flow.progress()        "% done" labels of running generations
(() => {
  const box = () => document.querySelector('div[contenteditable="true"]');
  const vids = (window.__flowVids ??= new Set());
  const grab = (t) => {
    t = String(t).replace(/\\+u003d/g, "=").replace(/\\+u0026/g, "&");
    for (const m of t.match(/https:\/\/flow-content\.google\/video\/[^"\\\s]+Signature=[^"\\\s&]+/g) ?? []) vids.add(m);
  };
  window.flow = {
    type(text) { const el = box(); el.focus(); document.execCommand("insertText", false, text); return el.innerText.length; },
    attached() {
      const r = box().getBoundingClientRect();
      return [...document.querySelectorAll("img")].filter((i) => {
        const b = i.getBoundingClientRect();
        return b.width > 20 && b.width < 90 && b.y > r.y - 120 && b.y < r.bottom && b.x >= r.x - 20;
      }).map((i) => i.src.match(/image\/([\w-]+)/)?.[1] ?? i.src.slice(0, 60));
    },
    images() {
      return [...document.querySelectorAll('img[alt="Tile displaying a user\'s image"]')]
        .filter((i) => i.src.includes("flow-content.google/image/"))
        .map((i) => ({ id: i.src.match(/image\/([\w-]+)/)[1], expires: Number(i.src.match(/Expires=(\d+)/)?.[1]), url: i.src }))
        .sort((a, b) => b.expires - a.expires);
    },
    watchVideos() {
      if (window.__flowWatching) return "already watching";
      window.__flowWatching = true;
      const send = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.send = function (...a) { this.addEventListener("load", () => { try { grab(this.responseText); } catch {} }); return send.apply(this, a); };
      const f = window.fetch;
      window.fetch = async function (...a) { const res = await f.apply(this, a); res.clone().text().then(grab).catch(() => {}); return res; };
      return "watching — now open each video tile once";
    },
    videos() {
      const list = [...vids];
      return { urls: list, curl: list.map((u, i) => `curl -s -o v${i + 1}.mp4 "${u}"`).join("\n") };
    },
    progress() {
      return [...document.querySelectorAll("*")].filter((e) => e.childElementCount === 0 && /^\d+%$/.test(e.textContent.trim())).map((e) => e.textContent.trim());
    },
  };
  return "flow helpers ready";
})();
