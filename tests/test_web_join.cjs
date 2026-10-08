const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const parserContext = { URL };
vm.runInNewContext(fs.readFileSync(require.resolve('../web/join/join.js'), 'utf8'), parserContext);
const { parseInvitation } = parserContext;
assert.equal(parseInvitation('#mumble://example.com:18655/').address, 'example.com:18655');
assert.equal(parseInvitation('#mumble://example.com/').address, 'example.com:64738');
assert.equal(parseInvitation('#mumble://[::1]:18655/').address, '[::1]:18655');
assert.equal(parseInvitation('#' + encodeURIComponent('mumble://example.com:1234/')).address, 'example.com:1234');
for (const uri of ['https://example.com/', 'mumble://name@example.com/', 'mumble://example.com:0/', 'mumble://example.com:65536/', 'mumble://example.com/path', '%invalid']) {
  assert.throws(() => parseInvitation('#' + uri));
}
const elements = {};
for (const id of ['server', 'copy', 'other', 'username-form', 'xbox', 'status']) {
  elements[id] = { hidden: true, value: '', events: {}, addEventListener(type, fn) { this.events[type] = fn; }, focus() {}, setAttribute() {}, removeAttribute() {}, classList: { add() {}, remove() {} } };
}
const location = { hash: '#mumble://example.com:18655/', href: '' };
vm.runInNewContext(fs.readFileSync(require.resolve('../web/join/join.js'), 'utf8'), {
  document: { getElementById: id => elements[id] }, location, URL, navigator: {},
});
elements['username-form'].events.submit({ preventDefault() {} });
assert.equal(location.href, '');
assert.equal(elements.status.textContent, 'กรุณากรอกชื่อ Xbox ก่อนเปิดแอป');
elements.xbox.value = 'Sam Player+#123';
elements['username-form'].events.submit({ preventDefault() {} });
assert.equal(location.href, 'mumble://Sam%20Player%2B%23123@example.com:18655/');
location.href = '';
elements.xbox.value = 'bad\nname';
elements['username-form'].events.submit({ preventDefault() {} });
assert.equal(location.href, '');
console.log('Web invitation parsing and Xbox app handoff passed');
// The share panel appears only in the browser that ran the installer.
function ownerView(stored) {
  const items = {};
  for (const id of ['server', 'copy', 'other', 'username-form', 'xbox', 'status', 'owner-share', 'share-link', 'copy-share', 'native-share', 'hide-share']) {
    items[id] = { hidden: true, value: '', events: {}, addEventListener(type, fn) { this.events[type] = fn; }, focus() {}, select() {}, setAttribute() {}, removeAttribute() {}, classList: { add() {}, remove() {} } };
  }
  const storage = { getItem: () => stored };
  vm.runInNewContext(fs.readFileSync(require.resolve('../web/join/join.js'), 'utf8'), {
    document: { getElementById: id => items[id] }, location: { hash: '#mumble://example.com:18655/', origin: 'https://join.test', href: '' }, URL, navigator: {}, localStorage: storage,
  });
  return items;
}
const owner = ownerView(JSON.stringify(['mumble://example.com:18655/']));
assert.equal(owner['owner-share'].hidden, false);
assert.equal(owner['share-link'].value, 'https://join.test/join#mumble://example.com:18655/');
assert.equal(owner['native-share'].hidden, true);
assert.equal(ownerView(null)['owner-share'].hidden, true);
assert.equal(ownerView(JSON.stringify(['mumble://other.com:18655/']))['owner-share'].hidden, true);
assert.equal(ownerView('not json')['owner-share'].hidden, true);
console.log('PASS owner share panel: only the installing browser sees the invite link');
