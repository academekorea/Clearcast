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

/* ── ECHO CHAMBER SCORE ──────────────────────────────────────────────────────
 * Measures listening diversity across all analyzed episodes.
 * Needs 3+ analyses to return a meaningful score.
 * Returns: { score:0-100, label, description, hasData }
 */
function calcEchoChamber(analyses) {
  if (!analyses || analyses.length < 3) {
    return { score: null, label: null, description: 'Analyze 3+ episodes to see your echo chamber score.', hasData: false };
  }
  var left = 0, center = 0, right = 0;
  var showSet = new Set();
  analyses.forEach(function(ep) {
    var l = ep.leftPct || 0;
    var r = ep.rightPct || 0;
    var diff = Math.abs(l - r);
    if (diff < 20) center++;
    else if (l > r) left++;
    else right++;
    if (ep.showName) showSet.add((ep.showName || '').toLowerCase());
  });
  var total = analyses.length;
  var maxPct = Math.max(left / total, center / total, right / total);
  // Dominance score: how lopsided is distribution (0-80)
  var dominance = Math.round(Math.max(0, (maxPct - 0.34) / 0.66) * 80);
  // Show diversity: fewer distinct shows = higher echo risk (0-20)
  var diversityPenalty = Math.max(0, 20 - Math.min(showSet.size, 5) * 4);
  var score = Math.min(100, Math.max(0, dominance + diversityPenalty));
  var label, description, color;
  if (score <= 25) {
    label = 'Low risk'; color = '#3B6D11';
    description = 'You\'re hearing diverse perspectives across your shows.';
  } else if (score <= 50) {
    label = 'Moderate'; color = '#854F0B';
    description = 'Some lean in your listening. Consider balancing with opposing views.';
  } else if (score <= 75) {
    label = 'High risk'; color = '#A32D2D';
    description = 'Your listening is significantly one-sided. Counterpoint shows recommended.';
  } else {
    label = 'Echo chamber'; color = '#791F1F';
    description = 'Almost all your content shares the same perspective. You\'re in a bubble.';
  }
  var dominant = left > right && left > center ? 'left' : right > left && right > center ? 'right' : 'center';
  return { score: score, label: label, description: description, color: color, dominant: dominant, showCount: showSet.size, totalAnalyses: total, hasData: true };
}

/* ── BIAS FINGERPRINT ────────────────────────────────────────────────────────
 * Aggregates all analyzed episodes into a single lean summary.
 */
function calcBiasFingerprint(analyses) {
  if (!analyses || !analyses.length) return { leftPct: 0, centerPct: 100, rightPct: 0, label: 'No data', hasData: false };
  var leftSum = 0, centerSum = 0, rightSum = 0;
  analyses.forEach(function(ep) {
    leftSum   += (ep.leftPct   || 0);
    centerSum += (ep.centerPct || 100 - (ep.leftPct||0) - (ep.rightPct||0));
    rightSum  += (ep.rightPct  || 0);
  });
  var n = analyses.length;
  var l = Math.round(leftSum / n);
  var r = Math.round(rightSum / n);
  var c = 100 - l - r;
  var diff = Math.abs(l - r);
  var label = diff < 20 ? 'Mostly balanced' : diff < 40 ? (l > r ? 'Lightly left' : 'Lightly right') : (l > r ? 'Leans left' : 'Leans right');
  return { leftPct: l, centerPct: c, rightPct: r, label: label, hasData: true };
}

if (typeof window !== 'undefined') {
  window.calcEchoChamber    = calcEchoChamber;
  window.calcBiasFingerprint = calcBiasFingerprint;
}
