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

/* ── INTELLIGENCE SYSTEM ─────────────────────────────────────────────────────
 *
 * Two-tier signal model:
 *
 * Tier 1 — LISTENING (broad signal, weight 0.3)
 *   Recorded whenever a user plays an episode that has platform bias data.
 *   Stored in localStorage as 'pl-listen-history'.
 *   Powers: fingerprint, echo chamber, weekly bias, recommendations.
 *
 * Tier 2 — ANALYSIS (deep signal, weight 1.0)
 *   Recorded when a user explicitly analyzes an episode.
 *   Stored in localStorage as 'pl-recent' and u.analyzedEpisodes.
 *   Powers: all of Tier 1 plus show-specific host trust, framing, evidence.
 *
 * BIAS FINGERPRINT uses a weekly-normalized exponential decay:
 *   - Episodes are grouped by ISO week so one high-volume week
 *     doesn't outweigh many normal weeks (GPA rule: one bad week
 *     doesn't tank your grade).
 *   - Each week's contribution decays by DECAY_FACTOR per week of age.
 *   - A single outlier week moves the fingerprint by at most ~15%.
 *
 * WEEKLY BIAS is the exact snapshot of the current ISO week only —
 *   volatile, reflects what you've consumed right now.
 *
 * RECOMMENDED LEAN is derived from weekly bias to surface shows that
 *   would move the user toward center — anti-echo-chamber logic,
 *   NOT engagement-maximizing.
 */

var LISTEN_WEIGHT   = 0.3;  // non-analyzed play
var ANALYSIS_WEIGHT = 1.0;  // explicit analysis
var DECAY_FACTOR    = 0.85; // per-week decay for fingerprint

/* ── ISO WEEK HELPERS ─────────────────────────────────────────────────────── */
function _isoWeekKey(date) {
  // Returns 'YYYY-WW' string for grouping
  var d = new Date(date);
  if (isNaN(d.getTime())) return '0000-00';
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  var yearStart = new Date(d.getFullYear(), 0, 1);
  var week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return d.getFullYear() + '-' + (week < 10 ? '0' + week : week);
}

function _weeksDiff(weekKeyA, weekKeyB) {
  // Returns how many weeks B is before A (positive = older)
  function toMs(wk) {
    var parts = wk.split('-');
    var year = parseInt(parts[0], 10);
    var week = parseInt(parts[1], 10);
    var jan4 = new Date(year, 0, 4);
    var dayOfWeek = jan4.getDay() || 7;
    var monday = new Date(jan4.getTime() - (dayOfWeek - 1) * 86400000 + (week - 1) * 7 * 86400000);
    return monday.getTime();
  }
  return Math.round((toMs(weekKeyA) - toMs(weekKeyB)) / (7 * 86400000));
}

/* ── RECORD LISTEN EVENT ─────────────────────────────────────────────────────
 * Call this when a user presses play on any episode that has bias data.
 * Only episodes with known bias scores contribute to intelligence metrics.
 *
 * @param {object} ep — { showName, episodeTitle, url, leftPct, rightPct, biasLabel }
 */
function recordListenEvent(ep) {
  if (!ep || (ep.leftPct === undefined && ep.rightPct === undefined)) return;
  try {
    var history = [];
    try { history = JSON.parse(localStorage.getItem('pl-listen-history') || '[]'); } catch(e) {}
    // Deduplicate: don't re-record same URL within 1 hour
    var now = Date.now();
    var dupe = history.some(function(h) {
      return h.url === ep.url && (now - new Date(h.listenedAt).getTime()) < 3600000;
    });
    if (dupe) return;
    history.unshift({
      showName:     ep.showName     || '',
      episodeTitle: ep.episodeTitle || '',
      url:          ep.url          || '',
      leftPct:      ep.leftPct      || 0,
      centerPct:    ep.centerPct    || (100 - (ep.leftPct||0) - (ep.rightPct||0)),
      rightPct:     ep.rightPct     || 0,
      biasLabel:    ep.biasLabel    || '',
      durationMinutes: ep.durationMinutes || null,
      listenedAt:   new Date().toISOString(),
      weight:       LISTEN_WEIGHT
    });
    if (history.length > 500) history = history.slice(0, 500);
    localStorage.setItem('pl-listen-history', JSON.stringify(history));
    // Sync to server (fire-and-forget)
    if (typeof window.syncToServer === 'function') window.syncToServer('listen_history', history);
  } catch(e) {}
}

/* ── GET LISTEN HISTORY ───────────────────────────────────────────────────── */
function getListenHistory() {
  try { return JSON.parse(localStorage.getItem('pl-listen-history') || '[]'); } catch(e) { return []; }
}

/* ── MERGE SIGNALS ────────────────────────────────────────────────────────── */
function _mergeSignals(analyses, listenEvents) {
  var events = [];
  (analyses || []).forEach(function(ep) {
    if (ep.leftPct === undefined && ep.rightPct === undefined) return;
    var durationMinutes = ep.durationMinutes || ep.duration_minutes || null;
    var durationFactor = durationMinutes ? Math.min(1.0, Math.max(0.1, durationMinutes / 60)) : 0.5;
    var finalWeight = ANALYSIS_WEIGHT * durationFactor;
    events.push({
      leftPct:   ep.leftPct   || 0,
      centerPct: ep.centerPct || (100 - (ep.leftPct||0) - (ep.rightPct||0)),
      rightPct:  ep.rightPct  || 0,
      showName:  ep.showName  || '',
      date:      ep.analyzedAt || ep.date || new Date().toISOString(),
      weight:    finalWeight
    });
  });
  (listenEvents || []).forEach(function(ev) {
    if (ev.leftPct === undefined && ev.rightPct === undefined) return;
    var durationMinutes = ev.durationMinutes || ev.duration_minutes || null;
    var durationFactor = durationMinutes ? Math.min(1.0, Math.max(0.1, durationMinutes / 60)) : 0.5;
    var baseWeight = ev.weight !== undefined ? ev.weight : LISTEN_WEIGHT;
    var finalWeight = baseWeight * durationFactor;
    events.push({
      leftPct:   ev.leftPct   || 0,
      centerPct: ev.centerPct || (100 - (ev.leftPct||0) - (ev.rightPct||0)),
      rightPct:  ev.rightPct  || 0,
      showName:  ev.showName  || '',
      date:      ev.listenedAt || ev.date || new Date().toISOString(),
      weight:    finalWeight
    });
  });
  return events;
}

/* ── WEEKLY BIAS ─────────────────────────────────────────────────────────────
 * Exact snapshot of the current ISO week — volatile, reflects right now.
 * Returns { leftPct, centerPct, rightPct, episodeCount, listenCount } or null.
 */
function calcWeeklyBias(analyses, listenEvents) {
  var nowWeek = _isoWeekKey(new Date());
  var events = _mergeSignals(analyses, listenEvents || getListenHistory());
  var thisWeek = events.filter(function(e) { return _isoWeekKey(e.date) === nowWeek; });
  if (!thisWeek.length) return null;
  var totalWeight = thisWeek.reduce(function(s, e) { return s + e.weight; }, 0);
  var l = thisWeek.reduce(function(s, e) { return s + e.leftPct * e.weight; }, 0) / totalWeight;
  var r = thisWeek.reduce(function(s, e) { return s + e.rightPct * e.weight; }, 0) / totalWeight;
  var c = 100 - l - r;
  var diff = Math.abs(l - r);
  var label = diff < 20 ? 'Mostly balanced'
    : diff < 40 ? (l > r ? 'Lightly left' : 'Lightly right')
    : diff < 60 ? (l > r ? 'Leans left' : 'Leans right')
    : (l > r ? 'Strongly left' : 'Strongly right');
  return {
    leftPct:      Math.round(l),
    centerPct:    Math.round(Math.max(0, c)),
    rightPct:     Math.round(r),
    label:        label,
    episodeCount: thisWeek.filter(function(e) { return e.weight === ANALYSIS_WEIGHT; }).length,
    listenCount:  thisWeek.filter(function(e) { return e.weight < ANALYSIS_WEIGHT; }).length,
    hasData:      true
  };
}

/* ── BIAS FINGERPRINT ────────────────────────────────────────────────────────
 * Long-term personal lean. Uses weekly-normalized exponential decay so:
 *   - One outlier week barely moves the needle (GPA rule)
 *   - Consistent multi-week patterns gradually shift it
 *   - Analyzed episodes weighted 1.0, listened episodes weighted 0.3
 *
 * Returns { leftPct, centerPct, rightPct, label, weekCount, hasData }
 */
function calcBiasFingerprint(analyses, listenEvents) {
  var events = _mergeSignals(analyses, listenEvents || getListenHistory());

  // Count analysis vs listen
  var analysisCount = 0, listenCount = 0;
  var showSetAll = {};
  events.forEach(function(e) {
    if (e.weight >= ANALYSIS_WEIGHT * 0.5) analysisCount++; else listenCount++;
    if (e.showName) showSetAll[e.showName.toLowerCase()] = 1;
  });
  var distinctShows = Object.keys(showSetAll).length;

  // Activation threshold: 10+ analyzed episodes OR 7+ days of data
  var oldestDate = events.length ? events[events.length - 1].date : null;
  var newestDate = events.length ? events[0].date : null;
  var daysSinceFirst = oldestDate ? Math.floor((Date.now() - new Date(oldestDate).getTime()) / 86400000) : 0;
  var thresholdMet = analysisCount >= 10 || daysSinceFirst >= 7;

  if (!thresholdMet) {
    return {
      leftPct: 0, centerPct: 100, rightPct: 0, label: 'No data', weekCount: 0, hasData: false,
      description: 'Keep listening — your fingerprint unlocks after 1 week or 10 episodes.',
      progress: { current: analysisCount, needed: 10, daysRecorded: daysSinceFirst, daysNeeded: 7 },
      basis: { episodeCount: analysisCount, listenCount: listenCount, weekCount: 0, oldestDate: oldestDate, newestDate: newestDate, showCount: distinctShows }
    };
  }

  // Group by ISO week
  var weekMap = {};
  events.forEach(function(e) {
    var wk = _isoWeekKey(e.date);
    if (!weekMap[wk]) weekMap[wk] = [];
    weekMap[wk].push(e);
  });

  var weeks = Object.keys(weekMap).sort();
  var nowWeek = _isoWeekKey(new Date());

  // Each week gets one "vote" — weighted average of that week's episodes
  // This normalizes high-volume weeks (one bad week = one grade, not 20 grades)
  var weeklyLeans = weeks.map(function(wk) {
    var wkEvents = weekMap[wk];
    var totalW = wkEvents.reduce(function(s, e) { return s + e.weight; }, 0);
    var l = wkEvents.reduce(function(s, e) { return s + e.leftPct  * e.weight; }, 0) / totalW;
    var r = wkEvents.reduce(function(s, e) { return s + e.rightPct * e.weight; }, 0) / totalW;
    return { week: wk, left: l, right: r, center: 100 - l - r };
  });

  // Apply exponential decay across weeks
  var wL = 0, wR = 0, totalDecayWeight = 0;
  weeklyLeans.forEach(function(wl) {
    var age = _weeksDiff(nowWeek, wl.week);
    var decayW = Math.pow(DECAY_FACTOR, Math.max(0, age));
    wL += wl.left   * decayW;
    wR += wl.right  * decayW;
    totalDecayWeight += decayW;
  });

  var l = Math.round(wL / totalDecayWeight);
  var r = Math.round(wR / totalDecayWeight);
  var c = Math.max(0, 100 - l - r);
  var diff = Math.abs(l - r);
  var label = diff < 20 ? 'Mostly balanced'
    : diff < 40 ? (l > r ? 'Lightly left' : 'Lightly right')
    : diff < 60 ? (l > r ? 'Leans left' : 'Leans right')
    : (l > r ? 'Strongly left' : 'Strongly right');

  return {
    leftPct: l, centerPct: c, rightPct: r, label: label, weekCount: weeks.length, hasData: true,
    basis: { episodeCount: analysisCount, listenCount: listenCount, weekCount: weeks.length, oldestDate: oldestDate, newestDate: newestDate, showCount: distinctShows }
  };
}

/* ── ECHO CHAMBER SCORE ──────────────────────────────────────────────────────
 * Measures perspective diversity across analyzed + listened episodes.
 * Needs 3+ combined signals to activate.
 * Returns { score:0-100, label, description, color, dominant, hasData }
 */
function calcEchoChamber(analyses, listenEvents) {
  var events = _mergeSignals(analyses, listenEvents || getListenHistory());
  // Only count events with meaningful bias data
  events = events.filter(function(e) { return e.leftPct || e.rightPct; });

  // Count distinct shows and analysis/listen counts for basis
  var showSetAll = {};
  var analysisCount = 0, listenCount = 0;
  events.forEach(function(e) {
    if (e.showName) showSetAll[e.showName.toLowerCase()] = 1;
    if (e.weight >= ANALYSIS_WEIGHT * 0.5) analysisCount++; else listenCount++;
  });
  var distinctShows = Object.keys(showSetAll).length;

  // Activation threshold: 10+ analyzed episodes OR 7+ days of data
  var oldestDate = events.length ? events[events.length - 1].date : null;
  var newestDate = events.length ? events[0].date : null;
  var daysSinceFirst = oldestDate ? Math.floor((Date.now() - new Date(oldestDate).getTime()) / 86400000) : 0;
  var thresholdMet = analysisCount >= 10 || daysSinceFirst >= 7;

  if (!thresholdMet) {
    return {
      score: 0, label: '', description: 'Keep listening — your score unlocks after 1 week or 10 episodes.',
      hasData: false,
      progress: { current: analysisCount, needed: 10, daysRecorded: daysSinceFirst, daysNeeded: 7 },
      basis: { episodeCount: analysisCount, listenCount: listenCount, weekCount: 0, oldestDate: oldestDate, newestDate: newestDate, showCount: distinctShows }
    };
  }

  var left = 0, center = 0, right = 0;
  var showSet = {};
  events.forEach(function(e) {
    var diff = Math.abs(e.leftPct - e.rightPct);
    if (diff < 20) center++;
    else if (e.leftPct > e.rightPct) left++;
    else right++;
    if (e.showName) showSet[e.showName.toLowerCase()] = 1;
  });
  var total = events.length;
  var showCount = Object.keys(showSet).length;
  var maxPct = Math.max(left / total, center / total, right / total);
  // Dominance (0-80): how lopsided the lean distribution is
  var dominance = Math.round(Math.max(0, (maxPct - 0.34) / 0.66) * 80);
  // Diversity penalty (0-20): fewer distinct shows = higher echo risk
  var diversityPenalty = Math.max(0, 20 - Math.min(showCount, 5) * 4);
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
  var dominant = left > right && left > center ? 'left'
    : right > left && right > center ? 'right' : 'center';

  // Group by week for weekCount
  var weekSet = {};
  events.forEach(function(e) { weekSet[_isoWeekKey(e.date)] = 1; });
  var weekCount = Object.keys(weekSet).length;

  return {
    score: score, label: label, description: description, color: color, dominant: dominant,
    showCount: showCount, totalSignals: total, hasData: true,
    leftPct: Math.round(left / total * 100), centerPct: Math.round(center / total * 100), rightPct: Math.round(right / total * 100),
    basis: { episodeCount: analysisCount, listenCount: listenCount, weekCount: weekCount, oldestDate: oldestDate, newestDate: newestDate, showCount: showCount }
  };
}

/* ── TOPIC AFFINITY ──────────────────────────────────────────────────────────
 * Tracks which categories/topics the user gravitates toward.
 * Built from: onboarding interests + followed shows + liked episodes +
 *             listen history + analyzed episodes.
 *
 * Each signal type carries a different weight:
 *   Explicit follow/like  = 3.0  (user made a deliberate choice)
 *   Analysis              = 2.0  (user invested time to analyze)
 *   Listen event          = 1.0  (user played it)
 *   Onboarding interest   = 1.5  (stated preference, may be stale)
 *
 * Returns { topTopics: ['tech','news',...], profile: { tech:0.6, news:0.3 } }
 */

var TOPIC_WEIGHTS = {
  follow:   3.0,
  like:     3.0,
  analyze:  2.0,
  listen:   1.0,
  onboard:  1.5
};

// Canonical category list matching CURATED_SHOWS and Discover nav
var KNOWN_CATS = ['news', 'tech', 'business', 'society', 'crime', 'science', 'health', 'sports', 'culture', 'education'];

function _normalizeCat(raw) {
  if (!raw) return null;
  var s = String(raw).toLowerCase().trim();
  // Map common aliases
  var aliases = {
    'politics': 'news', 'technology': 'tech', 'finance': 'business',
    'economics': 'business', 'true crime': 'crime', 'comedy': 'culture',
    'arts': 'culture', 'history': 'education', 'self-help': 'education',
    'wellness': 'health', 'fitness': 'health'
  };
  return aliases[s] || (KNOWN_CATS.indexOf(s) !== -1 ? s : null);
}

/* recordListenEvent already exists — we extend it to also record category */
function _catFromEpisode(ep) {
  // Try explicit category field first, then infer from showName keywords
  var cat = ep.category || ep.cat || ep.genre || '';
  var norm = _normalizeCat(cat);
  if (norm) return norm;
  // Keyword inference from show name
  var name = (ep.showName || '').toLowerCase();
  if (/news|politi|daily|report|npr|bbc|cnn|fox/.test(name)) return 'news';
  if (/tech|code|dev|software|ai|startup|product/.test(name)) return 'tech';
  if (/business|invest|market|money|finance|econom/.test(name)) return 'business';
  if (/crime|murder|mystery|detective|court/.test(name)) return 'crime';
  if (/science|research|space|physics|biology/.test(name)) return 'science';
  if (/health|medic|mental|wellnes|fitness/.test(name)) return 'health';
  if (/sport|nba|nfl|soccer|football|baseball/.test(name)) return 'sports';
  return null;
}

/* ── BUILD TOPIC AFFINITY PROFILE ────────────────────────────────────────────
 * @param {object} opts
 *   opts.analyses       — analyzed episodes (from u.analyzedEpisodes / pl-recent)
 *   opts.listenEvents   — from getListenHistory()
 *   opts.followedShows  — from u.followedShows
 *   opts.likedEpisodes  — from localStorage pl_liked_episodes
 *   opts.userInterests  — from u.categories / u.interests (onboarding)
 *
 * Returns {
 *   topTopics:  string[]  — ordered by affinity, max 5
 *   profile:    object    — { tech: 0.6, news: 0.3, ... } (sums to 1.0)
 *   hasData:    boolean
 * }
 */
function buildTopicProfile(opts) {
  opts = opts || {};
  var scores = {};

  function add(cat, weight) {
    var norm = _normalizeCat(cat);
    if (!norm) return;
    scores[norm] = (scores[norm] || 0) + weight;
  }

  // Onboarding interests
  (opts.userInterests || []).forEach(function(c) { add(c, TOPIC_WEIGHTS.onboard); });

  // Followed shows
  (opts.followedShows || []).forEach(function(s) {
    add(s.category || s.cat || _catFromEpisode(s), TOPIC_WEIGHTS.follow);
  });

  // Liked episodes
  (opts.likedEpisodes || []).forEach(function(ep) {
    add(ep.category || ep.cat || _catFromEpisode(ep), TOPIC_WEIGHTS.like);
  });

  // Analyzed episodes
  (opts.analyses || []).forEach(function(ep) {
    add(ep.category || ep.cat || _catFromEpisode(ep), TOPIC_WEIGHTS.analyze);
  });

  // Listen events
  (opts.listenEvents || getListenHistory()).forEach(function(ev) {
    add(ev.category || ev.cat || _catFromEpisode(ev), TOPIC_WEIGHTS.listen);
  });

  var total = Object.keys(scores).reduce(function(s, k) { return s + scores[k]; }, 0);
  if (!total) return { topTopics: [], profile: {}, hasData: false };

  // Normalize to 0-1
  var profile = {};
  Object.keys(scores).forEach(function(k) { profile[k] = Math.round((scores[k] / total) * 100) / 100; });

  // Sort by weight descending
  var topTopics = Object.keys(profile).sort(function(a, b) { return profile[b] - profile[a]; }).slice(0, 5);

  return { topTopics: topTopics, profile: profile, hasData: true };
}

/* ── RECOMMENDED LEAN ────────────────────────────────────────────────────────
 * Two-pass anti-echo-chamber recommendation logic.
 *
 * Pass 1 — RELEVANCE: filter candidate shows to topics the user cares about.
 * Pass 2 — BALANCE: within relevant shows, surface those that fill the
 *           user's bias gap (move their week toward center).
 *
 * @param {object} opts
 *   opts.analyses        — analyzed episodes
 *   opts.listenEvents    — listen history
 *   opts.followedShows   — user's followed shows
 *   opts.likedEpisodes   — user's liked episodes
 *   opts.userInterests   — onboarding categories
 *   opts.candidateShows  — pool of shows to recommend from (e.g. CURATED_SHOWS)
 *                          Each show needs: { name, cat, bias:{leftPct,rightPct} }
 *
 * Returns {
 *   shows:        array of recommended show objects (max 6)
 *   prioritize:   ['center','right'] | ['center','left'] | ['all']
 *   avoid:        'left' | 'right' | null
 *   message:      string
 *   balanced:     boolean
 *   topicProfile: { topTopics, profile }
 * }
 */
function calcRecommendedLean(opts) {
  // Support legacy signature: calcRecommendedLean(analyses, listenEvents)
  if (Array.isArray(opts)) {
    opts = { analyses: opts, listenEvents: arguments[1] };
  }
  opts = opts || {};

  var analyses     = opts.analyses     || [];
  var listenEvs    = opts.listenEvents || getListenHistory();
  var candidates   = opts.candidateShows || [];
  var followedShows = opts.followedShows || [];
  var likedEpisodes = opts.likedEpisodes || [];
  var userInterests = opts.userInterests || [];

  // ── Pass 1: bias direction ──────────────────────────────────────────────
  var weekly      = calcWeeklyBias(analyses, listenEvs);
  var fingerprint = calcBiasFingerprint(analyses, listenEvs);
  var source = (weekly && weekly.hasData) ? weekly : (fingerprint && fingerprint.hasData ? fingerprint : null);

  var prioritize = ['all'], avoid = null, balanced = true, message = '';
  var THRESHOLD = 25;

  if (source) {
    var diff = source.leftPct - source.rightPct;
    if (diff > THRESHOLD) {
      prioritize = ['center', 'right']; avoid = 'left'; balanced = false;
      message = 'Your ' + (weekly && weekly.hasData ? 'week' : 'listening history') + ' leans left. These shows will help balance your perspective.';
    } else if (diff < -THRESHOLD) {
      prioritize = ['center', 'left']; avoid = 'right'; balanced = false;
      message = 'Your ' + (weekly && weekly.hasData ? 'week' : 'listening history') + ' leans right. These shows will help balance your perspective.';
    } else {
      message = 'Your listening is balanced. Keep exploring.';
    }
  } else {
    message = 'Explore shows across all perspectives.';
  }

  // ── Pass 2: topic relevance + show filtering ────────────────────────────
  var topicProfile = buildTopicProfile({
    analyses: analyses, listenEvents: listenEvs,
    followedShows: followedShows, likedEpisodes: likedEpisodes,
    userInterests: userInterests
  });

  // Get followed/liked show names so we don't re-recommend what they have
  var alreadyHave = {};
  followedShows.forEach(function(s) { alreadyHave[(s.name||'').toLowerCase()] = 1; });
  likedEpisodes.forEach(function(e) { alreadyHave[(e.showName||'').toLowerCase()] = 1; });

  var recommended = [];
  if (candidates.length) {
    // Filter + score each candidate
    var scored = candidates
      .filter(function(s) {
        // Skip shows user already follows/likes
        if (alreadyHave[(s.name||'').toLowerCase()]) return false;
        // Skip shows in the avoided lean (if balanced=false)
        if (avoid && s.bias) {
          var l = s.bias.leftPct || 0, r = s.bias.rightPct || 0;
          var d = l - r;
          if (avoid === 'left'  && d >  25) return false;
          if (avoid === 'right' && d < -25) return false;
        }
        return true;
      })
      .map(function(s) {
        var topicScore = 0;
        var showCat = _normalizeCat(s.cat || s.category || '');

        // Topic affinity score — higher if it matches user's interests
        if (showCat && topicProfile.profile[showCat]) {
          topicScore = topicProfile.profile[showCat];
        } else if (!topicProfile.hasData) {
          // No profile yet — treat all topics equally
          topicScore = 0.5;
        }
        // Don't recommend shows in topics the user has zero affinity for
        // (unless they have no profile yet)
        if (topicProfile.hasData && topicScore === 0) return null;

        // Bias balance score — higher if it fills the user's gap
        var biasScore = 0;
        if (s.bias) {
          var l = s.bias.leftPct || 0, r = s.bias.rightPct || 0;
          var lean = l - r;
          if (!balanced) {
            // Reward shows in the prioritized lean
            var isCtr = Math.abs(lean) < 20;
            var isRight = lean < -20;
            var isLeft  = lean > 20;
            if (prioritize.indexOf('center') !== -1 && isCtr)  biasScore = 1.0;
            if (prioritize.indexOf('right')  !== -1 && isRight) biasScore = 0.9;
            if (prioritize.indexOf('left')   !== -1 && isLeft)  biasScore = 0.9;
          } else {
            biasScore = 0.5; // balanced: all shows score equally on bias
          }
        }

        return { show: s, score: topicScore * 0.6 + biasScore * 0.4 };
      })
      .filter(Boolean)
      .sort(function(a, b) { return b.score - a.score; })
      .slice(0, 6)
      .map(function(s) { return s.show; });

    recommended = scored;
  }

  return {
    shows:        recommended,
    prioritize:   prioritize,
    avoid:        avoid,
    message:      message,
    balanced:     balanced,
    topicProfile: topicProfile
  };
}

if (typeof window !== 'undefined') {
  window.calcEchoChamber      = calcEchoChamber;
  window.calcBiasFingerprint  = calcBiasFingerprint;
  window.calcWeeklyBias       = calcWeeklyBias;
  window.calcRecommendedLean  = calcRecommendedLean;
  window.buildTopicProfile    = buildTopicProfile;
  window.recordListenEvent    = recordListenEvent;
  window.getListenHistory     = getListenHistory;
}
