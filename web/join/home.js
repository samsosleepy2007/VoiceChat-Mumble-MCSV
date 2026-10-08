const el = id => document.getElementById(id);
el('invite').addEventListener('submit', event => {
  event.preventDefault(); el('result').hidden = true; document.body.classList.remove('generated'); el('status').classList.remove('error');
  try {
    let raw = el('address').value.trim();
    if (!raw.startsWith('mumble://')) {
      let address = raw.replace(/\/+$/, '');
      const port = el('port').value.trim();
      if (port && !/^(\[[^\]]+\]|[^:]+):\d+$/.test(address)) address += ':' + port;
      raw = 'mumble://' + address + '/';
    }
    const {uri} = parseInvitation('#' + raw);
    const link = new URL('/join/', location.origin); link.hash = uri;
    el('link').value = link.href; el('visit').href = link.href;
    el('result').hidden = false; document.body.classList.add('generated'); el('status').textContent = 'สร้างลิงก์แล้ว ส่งลิงก์นี้ให้เพื่อนได้เลย';
  } catch { el('status').classList.add('error'); el('status').textContent = 'กรุณาตรวจที่อยู่เซิร์ฟเวอร์และพอร์ต (1–65535)'; }
});
el('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(el('link').value); el('status').textContent = 'คัดลอกแล้ว ส่งให้เพื่อนได้เลย'; el('copy').textContent = 'คัดลอกแล้ว ✓'; el('copy').classList.add('done'); setTimeout(() => { el('copy').textContent = 'คัดลอกลิงก์'; el('copy').classList.remove('done'); }, 1600); }
  catch { el('link').focus(); el('link').select(); el('status').textContent = 'เลือกลิงก์ไว้แล้ว กรุณาคัดลอกด้วยตนเอง'; }
});
