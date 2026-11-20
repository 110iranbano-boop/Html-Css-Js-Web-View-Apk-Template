'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const file = 'www/v2/index.html';
const html = fs.readFileSync(file, 'utf8');
const scripts = [...html.matchAll(/<script(?:\\s[^>]*)?>([\\s\\S]*?)<\\/script>/gi)].map(x => x[1]).filter(x => x.trim());
if (!scripts.length) throw new Error('No inline application script found.');
scripts.forEach((source, index) => new vm.Script(source, { filename: file + '#script-' + (index + 1) }));
console.log('Simorgh v2 inline JavaScript syntax: OK');
