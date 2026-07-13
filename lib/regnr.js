// Swedish registration number normalization + validation.
// Valid: 3 letters + 3 digits, OR 3 letters + 2 digits + 1 letter.

/** Uppercase, strip spaces/hyphens/other separators. Returns '' if empty. */
export function normalizeRegnr(input) {
  if (!input) return '';
  return String(input).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const RE = /^[A-Z]{3}[0-9]{2}[0-9A-Z]$/;

/** True if it looks like a Swedish plate after normalization. */
export function isValidRegnr(input) {
  return RE.test(normalizeRegnr(input));
}

/** Pretty form "ABC 123" for display. */
export function formatRegnr(input) {
  const n = normalizeRegnr(input);
  if (n.length !== 6) return n;
  return `${n.slice(0, 3)} ${n.slice(3)}`;
}
