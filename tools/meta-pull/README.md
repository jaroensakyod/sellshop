# meta-pull: ดึงคลิปจาก meta.ai ลงเครื่องเมื่อปุ่ม Download ไม่ทำงาน

ใช้กับคลิปของเราเองในแชท meta.ai ที่เราล็อกอินอยู่ เหตุที่ต้องใช้วิธีนี้:
- ปุ่ม Download ของ meta.ai กดแล้วไม่มีไฟล์ลงมา เพราะ Chrome บล็อกการดาวน์โหลด
- หน้า meta.ai ส่งข้อมูลไป `localhost` ตรงๆ ไม่ได้ (CSP บล็อก)

**วิธีที่ใช้:** เปิดแท็บ `http://127.0.0.1:8765/` ขึ้นมาเป็นตัวรับ แล้วให้หน้า meta.ai ส่งคลิปไปที่แท็บนั้นด้วย `postMessage` แท็บตัวรับจะบันทึกไฟล์ลงเครื่อง

## วิธีใช้

1. เปิดตัวรับ (ไฟล์จะลงในโฟลเดอร์ที่ระบุ):
   ```bash
   node tools/meta-pull/recv.mjs /path/to/story/clips-inbox
   ```
2. ในแท็บแชท meta.ai เปิด DevTools → Console แล้ววางโค้ดข้างล่าง แก้ `ids` ให้ตรงกับลำดับวิดีโอในหน้า (บนลงล่าง):
   ```js
   const ids = ["b01a","b01b","b02a"]; // ชื่อไฟล์ตามลำดับวิดีโอในหน้า
   window.__send = async () => {
     const w = window.open("http://127.0.0.1:8765/", "recv"); window.__st = "opened:" + !!w;
     await new Promise(r => setTimeout(r, 3000));
     const vids = [...document.querySelectorAll("video")];
     for (let i = 0; i < vids.length; i++) {
       const v = vids[i], b = await (await fetch(v.currentSrc || v.src || v.querySelector("source").src)).blob();
       w.postMessage({ n: ids[i] + ".mp4", b }, "*"); window.__st += " " + ids[i] + ":" + b.size;
       await new Promise(r => setTimeout(r, 700));
     }
     window.__st += " done";
   };
   const bt = document.createElement("button"); bt.textContent = "SEND CLIPS";
   bt.style.cssText = "position:fixed;top:10px;left:50%;z-index:99999;padding:20px;background:red;color:#fff";
   bt.onclick = () => window.__send(); document.body.appendChild(bt);
   ```
3. **กดปุ่มแดง SEND CLIPS เอง** ปุ่มต้องถูกกดด้วยมือ ไม่งั้น Chrome จะบล็อกการเปิดแท็บตัวรับ
4. รอจนแท็บตัวรับขึ้นขนาดไฟล์ครบทุกตัว แล้วปิดแท็บตัวรับและหยุดสคริปต์ `recv.mjs` (Ctrl+C)

ตัวรับเปิดฟังเฉพาะ `127.0.0.1` เท่านั้น เครื่องอื่นในเครือข่ายส่งไฟล์เข้ามาไม่ได้
