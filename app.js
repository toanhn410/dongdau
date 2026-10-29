"use strict";
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const FONTS = [
  ["Be Vietnam Pro", "Hiện đại"], ["Montserrat", "Gọn gàng"], ["Baloo 2", "Tròn, dễ thương"],
  ["Comfortaa", "Mềm mại"], ["Patrick Hand", "Viết tay"], ["Dancing Script", "Bay bướm"],
  ["Pacifico", "Nghệ thuật"], ["Lobster", "Cổ điển"], ["Playfair Display", "Sang trọng"]
];
const COLORS = ["#ffffff", "#111111", "#e2336b", "#d62828", "#f4a261", "#2a9d8f", "#3a86ff", "#c9a227"];
const DEFAULTS = {
  mode: "text", text: "", font: "Be Vietnam Pro", bold: true, italic: false, outline: true,
  badge: false, color: "#ffffff", badgeColor: "#e2336b", logo: null, knockout: false,
  pos: "br", x: 0.5, y: 0.5, size: 30, opacity: 85, rotate: 0, shopee: false, vary: false, blend: false
};
const KEY = "dongdau-settings";
const EXPORT_MAX = 4096;   // giới hạn canvas an toàn trên iPhone
const SHOPEE_MAX = 2048;
const SHOPEE_BYTES = 2 * 1024 * 1024;

let S = { ...DEFAULTS, ...safeParse(localStorage.getItem(KEY)) };
let files = [], current = 0, previewSrc = null, outputs = [], logoCache = { key: null, canvas: null };

function safeParse(s) { try { return JSON.parse(s) || {}; } catch { return {}; } }
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch { $("#logoinfo").textContent = "Logo quá lớn nên không nhớ được cho lần sau, nhưng vẫn dùng được lần này."; }
}
function canvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
function placeholderText() { return S.text.trim() || "Tên shop của bạn"; }

// ---------- Dấu ----------
function fontString(px) {
  return `${S.italic ? "italic" : "normal"} ${S.bold ? 800 : 500} ${px}px "${S.font}", "Be Vietnam Pro", sans-serif`;
}

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

async function textStamp(L) {
  const lines = placeholderText().split("\n").slice(0, 3);
  try { await document.fonts.load(fontString(64), lines.join(" ")); } catch {}
  const m = canvas(1, 1).getContext("2d");
  m.font = fontString(100);
  const w100 = Math.max(...lines.map(l => m.measureText(l).width), 1) / 100;
  const pad = S.badge ? 0.45 : S.outline ? 0.15 : 0.06;          // tính theo cỡ chữ
  const fs = L / (w100 + 2 * pad);
  const lineH = fs * 1.3;
  const W = Math.ceil(w100 * fs + 2 * pad * fs);
  const H = Math.ceil(lines.length * lineH + pad * fs * 1.1);
  const c = canvas(W, H), ctx = c.getContext("2d");
  if (S.badge) {
    ctx.fillStyle = S.badgeColor;
    ctx.beginPath(); ctx.roundRect(0, 0, W, H, Math.min(H / 2, fs * 0.6)); ctx.fill();
  }
  ctx.font = fontString(fs);
  ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
  lines.forEach((line, i) => {
    const y = H / 2 + (i - (lines.length - 1) / 2) * lineH;
    if (S.outline && !S.blend) {   // khi hoà vân, viền cứng làm mất vẻ tự nhiên; viền dập nổi thay thế
      ctx.strokeStyle = luminance(S.color) > 0.5 ? "rgba(0,0,0,.6)" : "rgba(255,255,255,.85)";
      ctx.lineWidth = Math.max(2, fs * 0.09);
      ctx.strokeText(line, W / 2, y);
    }
    ctx.fillStyle = S.color;
    ctx.fillText(line, W / 2, y);
  });
  return c;
}

async function logoCanvas() {
  if (!S.logo) return null;
  const key = S.logo.length + ":" + S.logo.slice(-64) + ":" + S.knockout;
  if (logoCache.key === key) return logoCache.canvas;
  const img = new Image(); img.src = S.logo; await img.decode();
  const c = canvas(img.naturalWidth, img.naturalHeight), ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  if (S.knockout) {
    const d = ctx.getImageData(0, 0, c.width, c.height), p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      const min = Math.min(p[i], p[i + 1], p[i + 2]);
      if (min > 235) p[i + 3] = 0;
      else if (min > 205) p[i + 3] = Math.round(p[i + 3] * (235 - min) / 30);   // mép mềm
    }
    ctx.putImageData(d, 0, 0);
  }
  logoCache = { key, canvas: c };
  return c;
}

async function buildStamp(L) {
  if (S.mode === "logo") {
    const logo = await logoCanvas();
    if (!logo) return null;
    const k = L / Math.max(logo.width, logo.height);
    const c = canvas(Math.max(1, Math.round(logo.width * k)), Math.max(1, Math.round(logo.height * k)));
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(logo, 0, 0, c.width, c.height);
    return c;
  }
  return textStamp(L);
}

function center(W, H, st) {
  const m = 0.04 * Math.min(W, H), hw = st.width / 2, hh = st.height / 2;
  switch (S.pos) {
    case "tl": return [m + hw, m + hh];
    case "tr": return [W - m - hw, m + hh];
    case "bl": return [m + hw, H - m - hh];
    case "br": return [W - m - hw, H - m - hh];
    case "c": return [W / 2, H / 2];
    default: return [S.x * W, S.y * H];
  }
}

// Mỗi ảnh xuất ra lệch dấu một chút (vị trí, cỡ, góc, độ rõ). Nếu cả loạt ảnh có dấu y hệt nhau
// ở cùng một chỗ, phần mềm có thể so các ảnh để tách dấu ra và xoá sạch hàng loạt
// (Dekel và cộng sự, "On the Effectiveness of Visible Watermarks", CVPR 2017).
function variation(on) {
  if (!on) return { dx: 0, dy: 0, ds: 1, dr: 0, da: 1 };
  const r = a => (Math.random() * 2 - 1) * a;
  return { dx: r(0.03), dy: r(0.03), ds: 1 + r(0.08), dr: r(4), da: 1 + r(0.12) };
}

// Vẽ dấu lên ctx; trả về khung chữ nhật (đã tính xoay) mà dấu chiếm.
function drawStamp(ctx, W, H, st, v) {
  ctx.save();
  ctx.globalAlpha = Math.min(1, Math.max(0.05, S.opacity / 100 * v.da));
  const rot = (S.rotate + v.dr) * Math.PI / 180;
  let box = { x0: 0, y0: 0, x1: W, y1: H };
  if (S.pos === "tile") {
    const step = Math.max(st.width, st.height) * 1.5, rowH = st.height * 2.6;
    ctx.translate(W / 2 + v.dx * step * 10, H / 2 + v.dy * rowH * 10); ctx.rotate(rot);
    const R = Math.hypot(W, H) / 2 + step;
    for (let y = -R, row = 0; y < R; y += rowH, row++)
      for (let x = -R + (row % 2) * step / 2; x < R; x += step)
        ctx.drawImage(st, x - st.width / 2, y - st.height / 2);
  } else {
    let [cx, cy] = center(W, H, st);
    cx = Math.min(W - st.width / 2, Math.max(st.width / 2, cx + v.dx * W));
    cy = Math.min(H - st.height / 2, Math.max(st.height / 2, cy + v.dy * H));
    ctx.translate(cx, cy); ctx.rotate(rot);
    ctx.drawImage(st, -st.width / 2, -st.height / 2);
    const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
    const hw = (st.width * c + st.height * s) / 2, hh = (st.width * s + st.height * c) / 2;
    box = { x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh };
  }
  ctx.restore();
  return box;
}

// "Hoà vào vân ảnh": như in màu lên vải. Màu dấu được nhân với độ sáng tương đối của ảnh bên dưới
// (sáng điểm ảnh / sáng trung bình cả vùng dấu), nên nếp gấp, sợi vải, bóng đổ vẫn hiện xuyên qua dấu.
function printOnto(ctx, mask, W, H, box) {
  const x0 = Math.max(0, Math.floor(box.x0)), y0 = Math.max(0, Math.floor(box.y0));
  const w = Math.min(W, Math.ceil(box.x1)) - x0, h = Math.min(H, Math.ceil(box.y1)) - y0;
  if (w <= 0 || h <= 0) return;
  const img = ctx.getImageData(x0, y0, w, h), p = img.data;
  const m = mask.getContext("2d").getImageData(x0, y0, w, h).data;
  const lum = i => 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
  let sum = 0, wsum = 0;
  for (let i = 0; i < p.length; i += 4) if (m[i + 3]) { sum += lum(i) * m[i + 3]; wsum += m[i + 3]; }
  if (!wsum) return;
  // Độ sáng trung bình ứng với 88% màu gốc, để chỗ sáng hơn trung bình vẫn còn chỗ sáng lên (không cháy trắng)
  const ref = sum / wsum / 0.88 + 1;
  for (let i = 0; i < p.length; i += 4) {
    const a = m[i + 3] / 255;
    if (!a) continue;
    const shade = Math.min(1.6, Math.max(0.35, lum(i) / ref));
    for (let k = 0; k < 3; k++) p[i + k] = p[i + k] * (1 - a) + Math.min(255, m[i + k] * shade) * a;
  }
  ctx.putImageData(img, x0, y0);
}

// Cắt (nếu Shopee) → thu nhỏ → vẽ ảnh → đóng dấu
async function render(src, maxSide, vary = false) {
  let sx = 0, sy = 0, sw = src.width, sh = src.height;
  if (S.shopee) { const m = Math.min(sw, sh); sx = (sw - m) / 2; sy = (sh - m) / 2; sw = sh = m; }
  const cap = S.shopee ? Math.min(maxSide, SHOPEE_MAX) : maxSide;
  const k = Math.min(1, cap / Math.max(sw, sh));
  const W = Math.round(sw * k), H = Math.round(sh * k);
  const c = canvas(W, H), ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);           // ảnh PNG trong suốt → nền trắng khi lưu JPEG
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, W, H);
  const v = variation(vary);
  const st = await buildStamp(S.size / 100 * Math.min(W, H) * v.ds);
  if (st) {
    if (S.blend) {
      const mask = canvas(W, H);
      printOnto(ctx, mask, W, H, drawStamp(mask.getContext("2d"), W, H, st, v));
    } else drawStamp(ctx, W, H, st, v);
  }
  return c;
}

function toBlob(c, q) { return new Promise(r => c.toBlob(r, "image/jpeg", q)); }
async function encode(c) {
  let blob = await toBlob(c, 0.92);
  if (!S.shopee) return blob;
  for (const q of [0.86, 0.8, 0.72, 0.64]) {
    if (blob.size <= SHOPEE_BYTES) return blob;
    blob = await toBlob(c, q);
  }
  while (blob.size > SHOPEE_BYTES && c.width > 600) {
    const s = canvas(Math.round(c.width * 0.85), Math.round(c.height * 0.85));
    s.getContext("2d").drawImage(c, 0, 0, s.width, s.height);
    c = s; blob = await toBlob(c, 0.8);
  }
  return blob;
}

// ---------- Xem trước ----------
function samplePhoto() {
  const c = canvas(1000, 1000), ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 1000, 1000);
  g.addColorStop(0, "#fde2e4"); g.addColorStop(1, "#cde7f0");
  ctx.fillStyle = g; ctx.fillRect(0, 0, 1000, 1000);
  ctx.font = "260px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("👗", 500, 470);
  ctx.font = "600 34px 'Be Vietnam Pro', sans-serif"; ctx.fillStyle = "#7b6f77";
  ctx.fillText("Ảnh mẫu – bấm “Chọn ảnh từ máy”", 500, 860);
  return c;
}

async function loadPreview() {
  if (previewSrc && previewSrc.close) previewSrc.close();
  previewSrc = null;
  if (files.length) {
    try { previewSrc = await createImageBitmap(files[current]); }
    catch { previewSrc = null; }
  }
  if (!previewSrc) previewSrc = samplePhoto();
  $("#idx").textContent = files.length ? `Ảnh ${current + 1}/${files.length}` : "";
  $("#nav").hidden = files.length < 2;
  drawPreview();
}

let pending = false;
function drawPreview() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(async () => {
    pending = false;
    if (!previewSrc) return;
    const out = await render(previewSrc, 1000);
    const cv = $("#canvas");
    cv.width = out.width; cv.height = out.height;
    cv.getContext("2d").drawImage(out, 0, 0);
  });
}

// ---------- Giao diện ----------
function syncUI() {
  $$(".tabs button[data-mode]").forEach(b => b.classList.toggle("on", b.dataset.mode === S.mode));
  $$(".tabs button[data-blend]").forEach(b => b.classList.toggle("on", (b.dataset.blend === "1") === S.blend));
  $("#pane-logo").hidden = S.mode !== "logo";
  $("#pane-text").hidden = S.mode !== "text";
  $("#text").value = S.text;
  $$("#fonts button").forEach(b => b.classList.toggle("on", b.dataset.font === S.font));
  ["bold", "italic", "outline", "badge"].forEach(k => $("#" + k).classList.toggle("on", S[k]));
  $("#badgerow").hidden = !S.badge;
  $$("#colors .sw").forEach(b => b.classList.toggle("on", b.dataset.c === S.color));
  $$("#bcolors .sw").forEach(b => b.classList.toggle("on", b.dataset.c === S.badgeColor));
  $("#knockout").checked = S.knockout;
  $("#logoinfo").textContent = S.logo ? "✅ Đã có logo (được nhớ cho lần sau). Chọn file khác để thay." : "Nên dùng logo PNG nền trong suốt. Logo được nhớ cho lần sau.";
  $$(".pos button").forEach(b => b.classList.toggle("on", b.dataset.pos === S.pos));
  for (const k of ["size", "opacity", "rotate"]) {
    $("#" + k).value = S[k];
    $("#" + k + "v").textContent = S[k] + (k === "rotate" ? "°" : "%");
  }
  $("#shopee").checked = S.shopee;
  $("#vary").checked = S.vary;
  $("#go").disabled = !files.length;
  $("#go").textContent = files.length ? `✨ Tạo ${files.length} ảnh` : "✨ Chọn ảnh ở bước 1 trước";
}

function set(patch) {
  Object.assign(S, patch);
  save(); syncUI(); drawPreview();
  $("#done").hidden = true;
}

function swatches(el, key) {
  el.innerHTML = COLORS.map(c => `<button class="sw" data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join("")
    + `<input type="color" aria-label="Màu khác">`;
  el.addEventListener("click", e => { const c = e.target.dataset.c; if (c) set({ [key]: c }); });
  el.querySelector("input").addEventListener("input", e => set({ [key]: e.target.value }));
}

$("#fonts").innerHTML = FONTS.map(([f, d]) => `<button data-font="${f}" style="font-family:'${f}'">Shop Bé Na<small>${d}</small></button>`).join("");
$("#fonts").addEventListener("click", e => { const b = e.target.closest("button"); if (b) set({ font: b.dataset.font }); });
swatches($("#colors"), "color");
swatches($("#bcolors"), "badgeColor");

$$(".tabs button[data-mode]").forEach(b => b.onclick = () => set({ mode: b.dataset.mode }));
$$(".tabs button[data-blend]").forEach(b => b.onclick = () => set({ blend: b.dataset.blend === "1" }));
["bold", "italic", "outline", "badge"].forEach(k => $("#" + k).onclick = () => set({ [k]: !S[k] }));
$("#text").oninput = e => set({ text: e.target.value });
$("#knockout").onchange = e => set({ knockout: e.target.checked });
$("#shopee").onchange = e => set({ shopee: e.target.checked });
$("#vary").onchange = e => set({ vary: e.target.checked });
for (const k of ["size", "opacity", "rotate"]) $("#" + k).oninput = e => set({ [k]: +e.target.value });
$$(".pos button").forEach(b => b.onclick = () => {
  const p = b.dataset.pos;
  // Phủ kín: mặc định dấu nhỏ, mờ, xiên để khó xoá mà không che sản phẩm
  if (p === "tile" && S.pos !== "tile") set({ pos: p, size: Math.min(S.size, 25), opacity: Math.min(S.opacity, 30), rotate: S.rotate || -30 });
  else set({ pos: p });
});

$("#logo").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  const bm = await createImageBitmap(f);
  const k = Math.min(1, 1200 / Math.max(bm.width, bm.height));
  const c = canvas(Math.round(bm.width * k), Math.round(bm.height * k));
  c.getContext("2d").drawImage(bm, 0, 0, c.width, c.height);
  bm.close();
  set({ logo: c.toDataURL("image/png"), mode: "logo" });
  e.target.value = "";
};

$("#files").onchange = e => {
  files = [...e.target.files].filter(f => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
  current = 0;
  $("#count").textContent = files.length ? `Đã chọn ${files.length} ảnh.` : "Chưa chọn ảnh nào.";
  $("#done").hidden = true;
  syncUI(); loadPreview();
};
$("#prev").onclick = () => { current = (current - 1 + files.length) % files.length; loadPreview(); };
$("#next").onclick = () => { current = (current + 1) % files.length; loadPreview(); };

// Chạm/kéo để đặt vị trí
function pointTo(e) {
  const r = $("#canvas").getBoundingClientRect();
  const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
  set({ pos: "custom", x, y });
}
let dragging = false;
$("#pv").addEventListener("pointerdown", e => { if (S.pos === "tile") return; dragging = true; $("#pv").setPointerCapture(e.pointerId); pointTo(e); });
$("#pv").addEventListener("pointermove", e => { if (dragging) pointTo(e); });
$("#pv").addEventListener("pointerup", () => { dragging = false; });

// ---------- Xuất ảnh ----------
function outName(f) { return f.name.replace(/\.[^.]+$/, "") + "-dongdau.jpg"; }

$("#go").onclick = async () => {
  if (S.mode === "logo" && !S.logo) { alert("Bạn chưa chọn file logo ở bước 2."); return; }
  $("#go").disabled = true; $("#done").hidden = true; $("#prog").hidden = false;
  outputs.forEach(o => URL.revokeObjectURL(o.url)); outputs = [];
  const failed = [];
  for (let i = 0; i < files.length; i++) {
    try {
      const bm = await createImageBitmap(files[i]);
      const c = await render(bm, EXPORT_MAX, S.vary);
      bm.close();
      const blob = await encode(c);
      c.width = c.height = 0;   // giải phóng bộ nhớ trên điện thoại
      const file = new File([blob], outName(files[i]), { type: "image/jpeg" });
      outputs.push({ file, url: URL.createObjectURL(blob) });
    } catch { failed.push(files[i].name); }
    $("#prog div").style.width = ((i + 1) / files.length * 100) + "%";
  }
  $("#results").innerHTML = outputs.map(o => `<a href="${o.url}" download="${o.file.name}"><img src="${o.url}" alt=""></a>`).join("");
  $("#prog").hidden = true; $("#done").hidden = false; $("#go").disabled = false;
  const canShare = navigator.canShare && navigator.canShare({ files: outputs.map(o => o.file) });
  $("#share").hidden = !canShare; $("#sharehint").hidden = !canShare;
  if (failed.length) alert("Không đọc được " + failed.length + " ảnh: " + failed.join(", "));
  $("#done").scrollIntoView({ behavior: "smooth" });
};

$("#share").onclick = async () => {
  try { await navigator.share({ files: outputs.map(o => o.file) }); }
  catch (e) { if (e.name !== "AbortError") alert("Không chia sẻ được, hãy dùng nút Tải tất cả về máy."); }
};
$("#dl").onclick = async () => {
  for (const o of outputs) {
    const a = document.createElement("a"); a.href = o.url; a.download = o.file.name;
    document.body.appendChild(a); a.click(); a.remove();
    await new Promise(r => setTimeout(r, 350));
  }
};

// ---------- Cài đặt như app ----------
const ua = navigator.userAgent;
$("#inapp").hidden = !/Zalo|FBAN|FBAV|Instagram/i.test(ua);
$("#ioshint").hidden = !(/iPhone|iPad/.test(ua) && !navigator.standalone && /Safari/.test(ua) && !/CriOS|Zalo|FBAN/.test(ua));
let installEvt = null;
addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; $("#install").hidden = false; });
$("#install").onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; $("#install").hidden = true; };
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

syncUI();
document.fonts.ready.then(loadPreview);
