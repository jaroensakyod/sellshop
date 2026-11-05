import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
const dir = process.argv[2];
createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  if (req.method === "OPTIONS") return res.end();
  if (req.method === "GET") { res.setHeader("content-type","text/html"); return res.end(`<p id=s>ready</p><script>addEventListener("message",async e=>{const r=await fetch("/?n="+e.data.n,{method:"POST",body:e.data.b});document.getElementById("s").textContent+=" "+e.data.n+":"+await r.text();});</script>`); }
  const name = new URL(req.url, "http://x").searchParams.get("n").replace(/[^\w.-]/g, "");
  const chunks = []; req.on("data", (c) => chunks.push(c));
  req.on("end", () => { const b = Buffer.concat(chunks); writeFileSync(`${dir}/${name}`, b); console.log(name, b.length); res.end(String(b.length)); });
}).listen(8765, "127.0.0.1", () => console.log("listening"));
