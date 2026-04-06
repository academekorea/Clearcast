/**
 * utils.js — Global utilities for Podlens
 * Import on every page: <script src="/js/utils.js"></script>
 */

/**
 * safeVal — safe value renderer, never outputs "undefined" or "null"
 * @param {*} val - the value to check
 * @param {string} [suffix] - appended if value is valid (e.g. '%', ' episodes')
 * @param {string} [fallback] - what to show if invalid (default '—')
 */
function safeVal(val, suffix, fallback) {
  suffix = suffix || '';
  fallback = (fallback !== undefined) ? fallback : '—';
  if (val === undefined || val === null || val === '' || val !== val /* NaN */) return fallback;
  if (typeof val === 'number' && !isFinite(val)) return fallback;
  return String(val) + suffix;
}

/**
 * cleanDescription — strips promo boilerplate, URLs, handles, keeps 2 sentences max
 */
function cleanDescription(raw) {
  if (!raw) return '';
  var s = raw
    .replace(/https?:\/\/[^\s]+/g, '')              // remove URLs
    .replace(/@[A-Za-z0-9_.]+/g, '')                // remove @handles
    .replace(/\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, '') // phone numbers
    .replace(/\b(Don'?t miss|Follow us|Subscribe|Support this show|Visit our website|Interested in trying|Fan club|Contact us|Become a member|Join our community|Learn more at|Get ad-free)[^.!?]*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // Take first 2 sentences
  var sentences = s.match(/[^.!?]+[.!?]+/g) || [];
  var result = sentences.slice(0, 2).join(' ').trim();
  if (!result) result = s.slice(0, 180).trim();
  if (result.length < 20) return 'No description available.';
  if (result.length > 180) result = result.slice(0, 180).trim() + '…';
  return result;
}

/**
 * timeAgo — relative date string
 */
function timeAgo(iso) {
  if (!iso) return '';
  var diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * escHtml — escape HTML special chars
 */
function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/**
 * avatarColor — deterministic background color from name
 */
function avatarColor(name) {
  var c = ['#1a3a5c','#2d6a4f','#6b3a3a','#3a3a6b','#5c4a1a','#2d4a6a','#5c3a1a'];
  return c[(name || 'P').charCodeAt(0) % c.length];
}

/**
 * extractSocialHandles — extract social links from description text
 */
function extractSocialHandles(text) {
  if (!text) return {};
  var links = {};
  var ig = text.match(/instagram\.com\/([A-Za-z0-9_.]+)/i);
  if (ig) links.instagram = 'https://instagram.com/' + ig[1];
  var tw = text.match(/(?:twitter|x)\.com\/([A-Za-z0-9_]+)/i);
  if (tw) links.twitter = 'https://x.com/' + tw[1];
  var tt = text.match(/tiktok\.com\/@([A-Za-z0-9_.]+)/i);
  if (tt) links.tiktok = 'https://tiktok.com/@' + tt[1];
  var fb = text.match(/facebook\.com\/([A-Za-z0-9_.]+)/i);
  if (fb) links.facebook = 'https://facebook.com/' + fb[1];
  var web = text.match(/https?:\/\/(?!(?:instagram|twitter|x|tiktok|facebook|youtube|spotify|apple|podbbang|audioclip|open\.spotify))[^\s"<>]+/i);
  if (web) links.website = web[0];
  return links;
}

/**
 * safeFetch — fetch wrapper that always returns JSON.
 * Detects HTML error pages (Netlify 404/500 pages) and throws a clean error.
 * Use instead of fetch(url).then(r => r.json()) everywhere.
 *
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<any>} parsed JSON
 */
async function safeFetch(url, options) {
  var res;
  try {
    res = await fetch(url, options || {});
  } catch (netErr) {
    throw new Error('network_error:' + (netErr.message || 'Failed to fetch'));
  }

  var text;
  try { text = await res.text(); } catch { text = ''; }

  // HTML response = function crashed or path not found
  if (text.trimStart().charAt(0) === '<') {
    console.error('[safeFetch] Got HTML from:', url, '(' + res.status + ')', text.slice(0, 150));
    throw new Error('server_html:' + res.status);
  }

  var data;
  try { data = JSON.parse(text); } catch (parseErr) {
    console.error('[safeFetch] JSON parse error from:', url, text.slice(0, 150));
    throw new Error('json_parse:' + parseErr.message);
  }

  return data;
}

/**
 * friendlyError — maps raw error messages to user-facing copy.
 * Logs the real error to console so it's still visible for debugging.
 *
 * @param {Error|string} err
 * @param {string} [context] — optional context label for the console log
 * @returns {string} user-friendly message
 */
function friendlyError(err, context) {
  var msg = (err && err.message) ? err.message : String(err || '');
  if (context) console.error('[' + context + ']', msg);
  if (/server_html|Unexpected token|JSON/.test(msg))
    return 'Our analysis server had an issue. Please try again in a moment.';
  if (/network_error|Failed to fetch|NetworkError/.test(msg))
    return 'Connection error. Check your internet and try again.';
  if (/404/.test(msg))
    return 'This episode URL could not be found.';
  if (/TimeoutError|AbortError|timeout|408/.test(msg))
    return 'Analysis is taking longer than usual. Please try again.';
  if (/limit_reached/.test(msg))
    return msg; // already user-friendly from backend
  return msg || 'Something went wrong. Please try a different URL.';
}

// Make available globally
if (typeof window !== 'undefined') {
  window.safeVal = safeVal;
  window.cleanDescription = cleanDescription;
  window.timeAgo = timeAgo;
  window.escHtml = escHtml;
  window.avatarColor = avatarColor;
  window.extractSocialHandles = extractSocialHandles;
  window.safeFetch = safeFetch;
  window.friendlyError = friendlyError;
}
