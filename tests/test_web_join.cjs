const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseInvitation } = require('../web/join/join.js');
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
