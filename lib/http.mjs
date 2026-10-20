// The one place the nightly run makes HTTP requests, so the probe step and
// the fetch send exactly the same thing.
//
// BROWSER-LIKE HEADERS. ESPN answered curl with 200 and the fetch's
// self-identifying bot User-Agent with 403 seconds later, and cdn.nba.com
// let the request hang until it timed out. Every request therefore looks
// like desktop Chrome asking for JSON in US English; cdn.nba.com also gets
// the Referer and Origin nba.com's own pages send.

export const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
export const REQUEST_TIMEOUT_MS = 30000;
export const RETRY_DELAY_MS = 2000;

export function requestHeaders(url) {
  const h = {
    'User-Agent': CHROME_UA,
    Accept: 'application/json',
    'Accept-Language': 'en-US',
  };
  if (new URL(url).hostname === 'cdn.nba.com') {
    h.Referer = 'https://www.nba.com/';
    h.Origin = 'https://www.nba.com';
  }
  return h;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// GET a JSON document: 30s per attempt, one retry after a short pause. The
// error names every attempt, so a failed run's log says what each one got.
export async function getJson(url, { timeoutMs = REQUEST_TIMEOUT_MS, retries = 1, retryDelayMs = RETRY_DELAY_MS } = {}) {
  const errors = [];
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await sleep(retryDelayMs);
    try {
      const r = await fetch(url, { headers: requestHeaders(url), signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      errors.push('attempt ' + (attempt + 1) + ': ' + (e.name === 'TimeoutError' ? 'timed out after ' + timeoutMs / 1000 + 's' : e.message));
    }
  }
  throw new Error(errors.join('; ') + ' (' + url + ')');
}
