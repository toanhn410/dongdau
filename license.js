"use strict";
// Gói sử dụng: miễn phí N ảnh/ngày cho mỗi trình duyệt; quá mức phải nhập mã mở khoá.
// Mã mở khoá có chữ ký số ECDSA P-256, gắn với mã thiết bị và ngày hết hạn,
// nên app tự kiểm tra ngay trên máy, không cần máy chủ. Mã do trang admin.html tạo bằng khoá bí mật.

const PAYWALL = {
  // null = giai đoạn thử: miễn phí không giới hạn. Đặt "YYYY-MM-DD" để bắt đầu thu tiền từ ngày đó.
  // Chỉ có hiệu lực khi đã điền đủ bank và zalo bên dưới.
  from: null,
  freePerDay: 20,
  plans: [
    { days: 30, price: 39000, label: "1 tháng" },
    { days: 365, price: 299000, label: "1 năm" }
  ],
  bank: null,   // { id: "VCB", account: "0123456789", name: "NGUYEN VAN A" } → mã VietQR
  zalo: null    // số Zalo nhận ảnh xác nhận chuyển khoản
};

const LICENSE_PUBKEY = { kty: "EC", crv: "P-256", x: "uyQ174XUSXB9I1te14FOlEmUDhVIbaLSSRYmyqETnDs", y: "_3peVRJTcEK_q2pVLhvYp3D4sgzPEWDG0xXlhFZSUDk" };
const LICENSE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";   // không có I, L, O, U cho khỏi đọc nhầm
const LICENSE_EPOCH = Date.UTC(2026, 0, 1);
const DAY_MS = 86400000;

const Plan = (() => {
  const K = { device: "dongdau-device", usage: "dongdau-usage", license: "dongdau-license" };
  let licensedUntil = null;

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function deviceId() {
    let id = localStorage.getItem(K.device);
    if (!/^[0-9A-Z]{8}$/.test(id || "")) {
      id = [...crypto.getRandomValues(new Uint8Array(8))].map(b => LICENSE_ALPHABET[b & 31]).join("");
      localStorage.setItem(K.device, id);
    }
    return id;
  }
  const prettyId = () => { const id = deviceId(); return id.slice(0, 4) + "-" + id.slice(4); };

  function idBytes(id) {   // 8 ký tự base32 = 40 bit = 5 byte
    let n = 0n;
    for (const ch of id) n = n * 32n + BigInt(LICENSE_ALPHABET.indexOf(ch));
    const out = new Uint8Array(5);
    for (let i = 4; i >= 0; i--) { out[i] = Number(n & 255n); n >>= 8n; }
    return out;
  }

  function decode(s) {
    const t = s.replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(atob(t + "===".slice((t.length + 3) % 4)), c => c.charCodeAt(0));
  }

  function clean(code) {
    const m = String(code).match(/key=([\w-]+)/);
    return (m ? m[1] : String(code)).replace(/\s+/g, "");
  }

  // Mã = 8 byte dữ liệu [phiên bản 1][mã thiết bị 5 byte][ngày hết hạn 2 byte] + 64 byte chữ ký
  async function verify(code) {
    let raw;
    try { raw = decode(clean(code)); } catch { return { error: "invalid" }; }
    if (raw.length !== 72 || raw[0] !== 1) return { error: "invalid" };
    const payload = raw.slice(0, 8), sig = raw.slice(8);
    const key = await crypto.subtle.importKey("jwk", LICENSE_PUBKEY, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    if (!await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, sig, payload)) return { error: "invalid" };
    const mine = idBytes(deviceId());
    if (!mine.every((b, i) => b === payload[1 + i])) return { error: "device" };
    const until = new Date(LICENSE_EPOCH + ((payload[6] << 8 | payload[7]) + 1) * DAY_MS);   // hết hạn sau ngày ghi trên mã
    if (until.getTime() <= Date.now()) return { error: "expired", until };
    return { until };
  }

  async function activate(code) {
    const r = await verify(code);
    if (r.error) return r;
    localStorage.setItem(K.license, clean(code));
    licensedUntil = r.until;
    return r;
  }

  function used() {
    try { const u = JSON.parse(localStorage.getItem(K.usage)); return u && u.day === today() ? u.n : 0; }
    catch { return 0; }
  }
  function addUsed(n) { localStorage.setItem(K.usage, JSON.stringify({ day: today(), n: used() + n })); }

  const configured = () => !!(PAYWALL.bank && PAYWALL.zalo);
  const active = () => !!PAYWALL.from && configured() && today() >= PAYWALL.from;
  const licensed = () => !!licensedUntil && Date.now() < licensedUntil.getTime();
  const remaining = () => (!active() || licensed()) ? Infinity : Math.max(0, PAYWALL.freePerDay - used());

  async function init() {
    const saved = localStorage.getItem(K.license);
    if (saved) { const r = await verify(saved); if (!r.error) licensedUntil = r.until; }
    return fromHash();
  }

  // Link mở khoá có dạng …/#key=…; bỏ phần #key khỏi thanh địa chỉ sau khi dùng
  async function fromHash() {
    if (!/key=/.test(location.hash)) return null;
    const r = await activate(location.hash);
    history.replaceState(null, "", location.pathname + location.search);
    return r;
  }

  function qrUrl(plan) {
    const b = PAYWALL.bank;
    return `https://img.vietqr.io/image/${encodeURIComponent(b.id)}-${encodeURIComponent(b.account)}-compact2.png`
      + `?amount=${plan.price}&addInfo=${encodeURIComponent(transferNote())}&accountName=${encodeURIComponent(b.name)}`;
  }
  const transferNote = () => "DD " + prettyId();

  return { init, fromHash, activate, remaining, addUsed, used, active, licensed, prettyId, transferNote, qrUrl,
           until: () => licensedUntil, today };
})();
