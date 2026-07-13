// rateLimit.js — minimal in-memory per-IP fixed-window rate limiter.
// Blunts abuse of the public (unauthenticated) customer lookup; not distributed.
// Buckets are pruned on a timer so the map can't grow unbounded. Requires
// `app.set('trust proxy', true)` so req.ip reflects the real client behind Caddy.
import { log } from './log.js';

export function rateLimit({ windowMs = 60_000, max = 20 } = {}) {
  const hits = new Map(); // ip -> { count, reset }

  const timer = setInterval(() => {
    const now = Date.now();
    for (const [ip, e] of hits) if (e.reset <= now) hits.delete(ip);
  }, windowMs);
  if (timer.unref) timer.unref();

  return function rateLimiter(req, res, next) {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    let e = hits.get(ip);
    if (!e || e.reset <= now) { e = { count: 0, reset: now + windowMs }; hits.set(ip, e); }
    e.count += 1;

    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - e.count)));

    if (e.count > max) {
      const retry = Math.ceil((e.reset - now) / 1000);
      res.setHeader('Retry-After', String(retry));
      log.warn(`rate limit hit for ${ip} (${e.count}/${max})`);
      return res.status(429).json({
        ok: false, code: 'rate_limited',
        error: 'För många förfrågningar. Vänta en stund och försök igen.',
      });
    }
    next();
  };
}
