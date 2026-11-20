'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const file = 'www/v2/index.html';
const html = fs.readFileSync(file, 'utf8');

function requireMatch(pattern, message) {
  assert.match(html, pattern, message);
}

const start = html.indexOf('<script>');
const end = html.indexOf('</script>', start + 8);
assert.ok(start >= 0 && end > start, 'Inline application script must exist.');
const source = html.slice(start + 8, end);

// Parse the complete inline script without executing browser-dependent code.
new vm.Script(source, { filename: file });

// Basic document and mobile/RTL requirements.
requireMatch(/<html lang="fa" dir="rtl">/i, 'App must declare Persian RTL layout.');
requireMatch(/name="viewport"/i, 'Mobile viewport metadata is required.');
requireMatch(/id="view"/, 'Main application view container is required.');
requireMatch(/id="nav"/, 'Bottom navigation container is required.');
requireMatch(/id="modal"/, 'Modal container is required.');

// Required product areas and their initial UI entry points.
for (const page of ['home', 'cafe', 'library', 'events', 'store', 'forum', 'profile', 'admin']) {
  assert.ok(source.includes("'" + page + "'"), `Missing application area: ${page}`);
}
for (const fn of ['render', 'renderNav', 'bookAction', 'registerEvent', 'suggestBook', 'comment', 'editProfile', 'addItem', 'editItem', 'deleteItem']) {
  assert.match(source, new RegExp('function\\s+' + fn + '\\s*\\('), `Missing application function: ${fn}`);
}

// User-controlled text must be escaped before being interpolated into HTML.
assert.match(source, /const esc\s*=\s*s\s*=>/, 'HTML escaping helper is required.');
assert.match(source, /replace\(\/\[&<>"/, 'Escaping helper must encode HTML-sensitive characters.');

console.log('Simorgh frontend checks: OK');
