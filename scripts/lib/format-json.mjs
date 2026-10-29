// Formats content JSON the same way every time: small, flat objects and
// lists stay on one line; everything else is indented with 2 spaces.
const INLINE_LIMIT = 200;

const isFlat = (v) =>
  Array.isArray(v)
    ? v.every((x) => x === null || typeof x !== 'object')
    : Object.values(v).every((x) => x === null || typeof x !== 'object' || (Array.isArray(x) && x.every((y) => typeof y !== 'object')));

function inline(v) {
  if (Array.isArray(v)) return `[${v.map(inline).join(', ')}]`;
  if (v && typeof v === 'object') {
    const parts = Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`);
    return parts.length ? `{ ${parts.join(', ')} }` : '{}';
  }
  return JSON.stringify(v);
}

export function formatJson(value, indent = '') {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const one = inline(value);
  if (isFlat(value) && one.length + indent.length <= INLINE_LIMIT) return one;
  const next = indent + '  ';
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    return `[\n${value.map((x) => next + formatJson(x, next)).join(',\n')}\n${indent}]`;
  }
  const entries = Object.entries(value);
  if (!entries.length) return '{}';
  return `{\n${entries.map(([k, x]) => `${next}${JSON.stringify(k)}: ${formatJson(x, next)}`).join(',\n')}\n${indent}}`;
}
