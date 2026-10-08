function parseInvitation(hash) {
  let raw = hash.replace(/^#/, '');
  if (!raw) raw = 'mumble://sv7.mcsv.me:18655/';
  if (!raw.startsWith('mumble://')) raw = decodeURIComponent(raw);
  // Parsed by hand: browsers before Chrome 130 do not split host and port for mumble:// URLs.
  const match = /^mumble:\/\/(\[[0-9a-fA-F:.]+\]|[a-zA-Z0-9.-]+)(?::(\d{1,5}))?\/$/i.exec(raw);
  if (!match) throw Error('ลิงก์เซิร์ฟเวอร์ไม่ถูกต้อง');
  const port = match[2] ? Number(match[2]) : 64738;
  if (port < 1 || port > 65535) throw Error('ที่อยู่หรือพอร์ตไม่ถูกต้อง');
  const address = `${match[1].toLowerCase()}:${port}`;
  return { address, uri: `mumble://${address}/` };
}
if (typeof document !== 'undefined' && document.getElementById('server')) {
  const el = id => document.getElementById(id);
  try {
    const { address, uri } = parseInvitation(location.hash);
    el('server').textContent = address;

    for (const id of ['copy', 'other']) el(id).hidden = false;
    el('username-form').addEventListener('submit', event => {
      event.preventDefault();
      const name = el('xbox').value.trim();
      if (!name || name.length > 32 || /[\x00-\x1f\x7f§]/.test(name)) {
        el('status').textContent = !name ? 'กรุณากรอกชื่อ Xbox ก่อนเปิดแอป' : 'กรุณากรอกชื่อ Xbox ให้ถูกต้อง';
        el('status').classList.add('error');
        el('xbox').setAttribute('aria-invalid', 'true');
        el('xbox').focus();
        return;
      }
      el('status').classList.remove('error');
      el('xbox').removeAttribute('aria-invalid');
      el('status').textContent = 'กำลังเปิดแอปด้วยชื่อ ' + name;
      location.href = `mumble://${encodeURIComponent(name)}@${address}/`;
    });
    el('copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(address); flash(el('copy')); el('status').textContent = 'คัดลอกที่อยู่เซิร์ฟเวอร์แล้ว'; }
      catch { el('status').textContent = `คัดลอกด้วยตนเอง: ${address}`; }
    });
    showOwnerShare(uri);
  } catch { el('server').textContent = 'ลิงก์ไม่ถูกต้อง'; el('status').textContent = 'กรุณาขอลิงก์เข้าร่วมใหม่จากผู้ส่ง'; }
}
// Briefly confirms a copy on the button itself.
function flash(button, text = 'คัดลอกแล้ว ✓') {
  const label = button.dataset.label || (button.dataset.label = button.textContent);
  button.textContent = text; button.classList.add('done');
  clearTimeout(button.flashTimer);
  button.flashTimer = setTimeout(() => { button.textContent = label; button.classList.remove('done'); }, 1600);
}
// Only the browser that ran the installer has this link in its list, so shared visitors never see the panel.
function showOwnerShare(uri) {
  const el = id => document.getElementById(id), key = 'sleepy-owned-links';
  let owned = [];
  try { owned = JSON.parse(localStorage.getItem(key) || '[]'); } catch {}
  if (!Array.isArray(owned) || !owned.includes(uri.toLowerCase())) return;
  const link = new URL('/join', location.origin); link.hash = uri;
  el('share-link').value = link.href; el('owner-share').hidden = false;
  el('share-link').addEventListener('focus', () => el('share-link').select());
  el('copy-share').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(link.href); flash(el('copy-share')); }
    catch { el('share-link').focus(); el('share-link').select(); }
  });
  if (navigator.share) {
    el('native-share').hidden = false;
    el('native-share').addEventListener('click', () => navigator.share({ title: 'เข้าร่วมเสียง Minecraft', url: link.href }).catch(() => {}));
  }
  el('hide-share').addEventListener('click', () => { el('owner-share').hidden = true; });
}
if (typeof module !== 'undefined') module.exports = { parseInvitation };
