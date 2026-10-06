function parseInvitation(hash) {
  let raw = hash.replace(/^#/, '');
  if (!raw) raw = 'mumble://sv7.mcsv.me:18655/';
  if (!raw.startsWith('mumble://')) raw = decodeURIComponent(raw);
  const url = new URL(raw);
  if (url.protocol !== 'mumble:' || !url.hostname || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error('ลิงก์เซิร์ฟเวอร์ไม่ถูกต้อง');
  const port = url.port ? Number(url.port) : 64738;
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^[a-zA-Z0-9.:[\]-]+$/.test(url.hostname)) throw Error('ที่อยู่หรือพอร์ตไม่ถูกต้อง');
  const address = `${url.hostname}:${port}`;
  return { address, uri: `mumble://${address}/` };
}
if (typeof document !== 'undefined' && document.getElementById('server')) {
  const el = id => document.getElementById(id);
  try {
    const { address, uri } = parseInvitation(location.hash);
    el('server').textContent = address;

    for (const id of ['copy', 'other']) el(id).hidden = false;
    el('other').addEventListener('click', () => { el('username-form').hidden = false; el('other').hidden = true; el('xbox').focus(); });
    el('cancel-name').addEventListener('click', () => { el('username-form').hidden = true; el('other').hidden = false; });
    el('username-form').addEventListener('submit', event => {
      event.preventDefault();
      const name = el('xbox').value.trim();
      if (!name || name.length > 32 || /[\x00-\x1f\x7f§]/.test(name)) { el('status').textContent = 'กรุณากรอกชื่อ Xbox ให้ถูกต้อง'; return; }
      el('status').textContent = 'กำลังเปิดแอปด้วยชื่อ ' + name;
      location.href = `mumble://${encodeURIComponent(name)}@${address}/`;
    });
    el('copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(address); el('status').textContent = 'คัดลอกที่อยู่เซิร์ฟเวอร์แล้ว'; }
      catch { el('status').textContent = `คัดลอกด้วยตนเอง: ${address}`; }
    });
  } catch { el('server').textContent = 'ลิงก์ไม่ถูกต้อง'; el('status').textContent = 'กรุณาขอลิงก์เข้าร่วมใหม่จากผู้ส่ง'; }
}
if (typeof module !== 'undefined') module.exports = { parseInvitation };
