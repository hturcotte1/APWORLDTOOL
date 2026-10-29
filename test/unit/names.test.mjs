import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkName, nameKey, cleanName } from '../../src/names.js';

test('names match ignoring capitalization and extra spaces', () => {
  assert.equal(nameKey('Maya'), nameKey('  maya '));
  assert.equal(nameKey('Maya   R'), nameKey('maya r'));
  assert.equal(nameKey('MAYA'), 'maya');
  assert.notEqual(nameKey('Maya R'), nameKey('Maya'));
  assert.equal(cleanName('  Ana   Lucia  '), 'Ana Lucia');
});

test('lowercase names are tidied for display', () => {
  assert.equal(checkName('maya').name, 'Maya');
  assert.equal(checkName('anne-marie').name, 'Anne-Marie');
  assert.equal(checkName('DeShawn').name, 'DeShawn');
});

test('real names are allowed', () => {
  for (const n of ['Maya', 'José', "D'Andre", 'Anne-Marie', 'Nguyễn', 'Kshitij', 'Cassandra', 'Hellen', 'Titus', 'Nazir', 'Ashita', 'Fartun', 'Pornchai', 'Dickens']) {
    assert.equal(checkName(n).ok, true, n);
  }
});

test('inappropriate or invalid names are blocked', () => {
  // Test words are ROT13-encoded like the blocklist itself.
  const rot = (w) => w.replace(/[a-z]/gi, (c) => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
  for (const n of ['nff', 'Uhtu Wnff', 'S.h.p.x', 'shhhpx', 'Zvxr Uhag', 'Uryy', 'Uvgyre', 'Ora Qbire'].map(rot)) {
    assert.equal(checkName(n).ok, false, `${n} should be blocked`);
  }
  assert.equal(checkName('').ok, false);
  assert.equal(checkName('   ').ok, false);
  assert.equal(checkName('<script>').ok, false);
  assert.equal(checkName('Maya2').ok, false);
  assert.equal(checkName('A'.repeat(21)).ok, false);
});
