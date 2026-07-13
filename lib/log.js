// Tiny leveled logger. INFO/DEBUG toggled by LOG_LEVEL (default info).
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const current = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;

function ts() {
  return new Date().toISOString();
}
function emit(level, args) {
  if (LEVELS[level] > current) return;
  const line = `[${ts()}] ${level.toUpperCase()}`;
  // eslint-disable-next-line no-console
  (level === 'error' ? console.error : console.log)(line, ...args);
}

export const log = {
  error: (...a) => emit('error', a),
  warn: (...a) => emit('warn', a),
  info: (...a) => emit('info', a),
  debug: (...a) => emit('debug', a),
};
