// Shared fetch helper: real browser User-Agent, timeout, sensible errors.
// Every outbound request (onecargroup.se feed, car.info) goes through here.

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const DEFAULT_TIMEOUT_MS = 20000;

/**
 * fetch with a browser UA and an abort timeout.
 * @param {string} url
 * @param {{timeoutMs?:number, headers?:Record<string,string>, method?:string}} [opts]
 * @returns {Promise<Response>}
 */
export async function fetchWithUA(url, opts = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, headers = {}, method = 'GET' } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8',
        ...headers,
      },
    });
    return res;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Timeout efter ${timeoutMs}ms vid hämtning av ${url}`);
    }
    throw new Error(`Nätverksfel vid hämtning av ${url}: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchText(url, opts) {
  const res = await fetchWithUA(url, opts);
  if (!res.ok) throw new HttpError(`GET ${url} → ${res.status}`, res.status);
  return res.text();
}

export async function fetchJson(url, opts) {
  const res = await fetchWithUA(url, opts);
  if (!res.ok) throw new HttpError(`GET ${url} → ${res.status}`, res.status);
  return res.json();
}

export async function fetchBuffer(url, opts) {
  const res = await fetchWithUA(url, opts);
  if (!res.ok) throw new HttpError(`GET ${url} → ${res.status}`, res.status);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

export class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export { BROWSER_UA };
