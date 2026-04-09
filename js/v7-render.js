// ── V7 DASHBOARD RENDER FUNCTIONS ──────────────────────────────────────────
// Drop-in replacements for renderSkeletonDashboard and renderResults.
// API field mapping:
//   biasScore  (-100..+100)  →  converted to audioLean by _enrichWithAudioLean
//   biasLabel                →  plain English verdict
//   flags[].type/title/detail
//   guest.name/title/organization/twitter/linkedin/wikipedia
//   episodeTitle / showName / duration / summary
// ───────────────────────────────────────────────────────────────────────────

function _enrichWithAudioLean(d) {
  if (typeof d.biasScore === 'number' && !d.audioLean) {
    var bs = Math.max(-100, Math.min(100, d.biasScore));
    var abs = Math.abs(bs);
    var lp, cp, rp;
    if (bs < -5) {
      lp = Math.round(30 + abs * 0.45);
      rp = Math.max(5, Math.round(20 - abs * 0.15));
      cp = Math.max(5, 100 - lp - rp);
    } else if (bs > 5) {
      rp = Math.round(30 + abs * 0.45);
      lp = Math.max(5, Math.round(20 - abs * 0.15));
      cp = Math.max(5, 100 - lp - rp);
    } else {
      lp = 20; cp = 60; rp = 20;
    }
    d.audioLean = { leftPct: lp, centerPct: cp, rightPct: rp, plainEnglishLabel: d.biasLabel || '' };
  }
  return d;
}

function _v7FtCls(t) {
  return { framing:'v7-ff', 'fact-check':'v7-fc', omission:'v7-fo', 'sponsor-note':'v7-fs', sponsor:'v7-fs', context:'v7-fx' }[t] || 'v7-fx';
}
function _v7FtLabel(t) {
  return { framing:'FRAMING', 'fact-check':'FACT CHECK', omission:'OMISSION', 'sponsor-note':'SPONSOR', sponsor:'SPONSOR', context:'CONTEXT' }[t] || (t || '').toUpperCase();
}

// Shared: build the left column (media + controls + scrubber)
function _v7LeftCol(vid, epTitle) {
  var left = '';
  if (vid) {
    _arMedia.type = 'yt'; _arMedia.ytVid = vid;
    left += '<div class="v7-artwork" style="aspect-ratio:16/9;position:relative">'
      + '<iframe id="yt-iframe-' + vid + '"'
      + ' src="https://www.youtube.com/embed/' + vid + '?rel=0&modestbranding=1&enablejsapi=1"'
      + ' allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture"'
      + ' allowfullscreen style="position:absolute;inset:0;width:100%;height:100%;border:none;border-radius:7px"></iframe>'
      + '</div>';
  } else {
    left += '<div class="v7-artwork" id="v7-artwork-left" style="flex-direction:column;gap:8px;aspect-ratio:1/1">'
      + '<div class="v7-aicon">&#127897;</div>'
      + '<div id="v7-artwork-title" style="font-size:10px;color:#aaa;text-align:center;padding:0 12px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'
      + (epTitle || '') + '</div>'
      + '</div>';
  }
  // Playback controls row — play button is larger and centered
  left += '<div class="v7-ctls">'
    + '<button class="v7-cb" onclick="arSkip(-30)">&#8634; 30s</button>'
    + '<button class="v7-pc" id="ar-play-btn" onclick="arPlayPause()">&#9654;</button>'
    + '<button class="v7-cb" onclick="arSkip(30)">30s &#8635;</button>'
    + '</div>';
  // Speed buttons — separate row
  left += '<div class="v7-spds">'
    + '<button class="v7-spd on" onclick="arSetSpeed(1,this)">1&times;</button>'
    + '<button class="v7-spd" onclick="arSetSpeed(1.25,this)">1.25&times;</button>'
    + '<button class="v7-spd" onclick="arSetSpeed(1.5,this)">1.5&times;</button>'
    + '<button class="v7-spd" onclick="arSetSpeed(2,this)">2&times;</button>'
    + '</div>';
  // Scrubber
  left += '<div class="v7-abar">'
    + '<div class="v7-abarlbl"><span id="v7-time-cur">0:00</span><span id="v7-time-dur"></span></div>'
    + '<div class="v7-atrack" id="v7-atrack" onclick="arScrub(event)">'
    + '<div class="v7-afill" id="v7-afill"></div>'
    + '<div class="v7-athumb" id="v7-athumb"></div>'
    + '</div></div>';
  return '<div class="v7-card">' + left + '</div>';
}

// Shared: bias bar card HTML
function _v7BiasCard(audioLean, isPartial) {
  var html = '<div class="v7-card">';
  html += '<div class="v7-biasrow">'
    + '<div class="v7-lbl" style="margin-bottom:0">Political Lean &mdash; how this episode frames issues</div>';
  if (audioLean) {
    html += isPartial
      ? '<div style="display:flex;align-items:center;gap:4px;font-size:10px;color:#d97706"><div class="v7-pdot"></div>Early signal</div>'
      : '<div style="font-size:10px;color:#16a34a">&#10003; Final</div>';
  } else {
    html += '<div style="display:flex;align-items:center;gap:4px;font-size:10px;color:#d97706"><div class="v7-pdot"></div>Calculating</div>';
  }
  html += '</div>';

  if (audioLean) {
    var lp = audioLean.leftPct || 0, cp = audioLean.centerPct || 0, rp = audioLean.rightPct || 0;
    var total = lp + cp + rp || 100;
    var lw = (lp/total*100).toFixed(1), cw = (cp/total*100).toFixed(1), rw = (rp/total*100).toFixed(1);
    var pinLeft = (lp/total*100).toFixed(1);
    var verdict = biasPlainLabel(lp, rp);
    var vClass = Math.abs(lp-rp) < 20 ? 'v7-bverdict-b' : lp > rp ? 'v7-bverdict-l' : 'v7-bverdict-r';
    html += '<div style="position:relative"><div class="v7-bias-bar-wrap">'
      + '<div class="v7-bias-seg-l" style="width:' + lw + '%"></div>'
      + '<div class="v7-bias-seg-c" style="width:' + cw + '%"></div>'
      + '<div class="v7-bias-seg-r" style="width:' + rw + '%"></div>'
      + '<div class="v7-bias-marker" style="left:' + pinLeft + '%"></div>'
      + '</div></div>'
      + '<div class="v7-bpcts">'
      + '<span style="color:#e0352b">&#9679; ' + lp + '% left</span>'
      + '<span style="color:#999">&#9642; ' + cp + '% center</span>'
      + '<span style="color:#3a7fd4">&#9679; ' + rp + '% right</span>'
      + '</div>'
      + '<div class="v7-bverdict ' + vClass + '">' + verdict + '</div>';
    if (isPartial) {
      html += '<div class="v7-enote">Based on first 30 min &middot; updating as analysis continues</div>';
    }
  } else {
    html += '<div class="v7-enote">Analyzing transcript &mdash; lean appears in ~90 seconds</div>';
  }
  html += '</div>';
  return html;
}

// Shared: post-render init (YouTube player + iTunes guest card fetch)
function _v7PostRender(vid, showName, epTitle) {
  // YouTube player
  if (vid) {
    if (_arScrubProgId) { clearInterval(_arScrubProgId); _arScrubProgId = null; }
    _arMedia.type = 'yt'; _arMedia.ytVid = vid;
    setTimeout(function() {
      initYouTubePlayer(vid, {});
      _arScrubProgId = setInterval(function() {
        var p = _ytPlayers[vid];
        if (!p) return;
        function fmt(s) { if (!isFinite(s)||!s) return '0:00'; var m=Math.floor(s/60),sc=Math.floor(s%60); return m+':'+(sc<10?'0':'')+sc; }
        try {
          var ct = p.getCurrentTime(), dt = p.getDuration(), pct = dt ? (ct/dt*100) : 0;
          var fill = document.getElementById('v7-afill');
          var thumb = document.getElementById('v7-athumb');
          var cur = document.getElementById('v7-time-cur');
          var dur = document.getElementById('v7-time-dur');
          if (fill) fill.style.width = pct.toFixed(2) + '%';
          if (thumb) thumb.style.left = pct.toFixed(2) + '%';
          if (cur) cur.textContent = fmt(ct);
          if (dur && dt) dur.textContent = fmt(dt);
        } catch(e) {}
        if (!document.getElementById('v7-afill')) { clearInterval(_arScrubProgId); _arScrubProgId = null; }
      }, 500);
    }, 200);
  }

  // iTunes guest card + artwork fetch (only when no guest data from API)
  var q = showName || epTitle;
  if (q) {
    fetch('https://itunes.apple.com/search?term=' + encodeURIComponent(q) + '&media=podcast&entity=podcast&limit=1', { signal: AbortSignal.timeout(5000) })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        var p = d.results && d.results[0];
        if (!p) return;
        var artUrl = p.artworkUrl100 || '';
        var host = p.artistName || showName || '';
        var ini = host.trim().split(' ').map(function(w){return w[0]||'';}).slice(0,2).join('').toUpperCase() || '?';
        var genre = p.primaryGenreName || 'Podcast';
        var epCount = p.trackCount ? p.trackCount + ' episodes' : '';

        // Update guest card only if it still shows the skeleton/fallback state
        var card = document.getElementById('v7-guest-card');
        if (card && card.dataset.guestLocked !== '1') {
          card.innerHTML = '<div class="v7-gtop">'
            + (artUrl ? '<img src="' + artUrl + '" style="width:38px;height:38px;border-radius:50%;object-fit:cover;flex-shrink:0" onerror="this.style.display=\'none\'">' : '<div class="v7-gav">' + ini + '</div>')
            + '<div><div class="v7-gname">' + decodeHTMLEntities(host) + '</div>'
            + '<div class="v7-grole">Host &middot; ' + genre + '</div></div></div>'
            + '<div class="v7-chips">'
            + (epCount ? '<div class="v7-lchip">' + epCount + '</div>' : '')
            + '</div>'
            + '<div class="v7-srow">'
            + (p.artistViewUrl ? '<a class="v7-sl" href="' + p.artistViewUrl + '" target="_blank" rel="noopener">&#9654; Apple Podcasts</a>' : '')
            + '<a class="v7-sl v7-sl-pl" href="#">&#127897; Podlens profile</a>'
            + '</div>';
        }

        // Update left-column artwork (non-YouTube only)
        var bigArtUrl = artUrl.replace('100x100bb', '600x600bb');
        var leftArt = document.getElementById('v7-artwork-left');
        if (leftArt && bigArtUrl) {
          leftArt.innerHTML = '<img src="' + bigArtUrl + '" alt="" style="width:100%;height:100%;object-fit:cover;display:block" onerror="this.style.display=\'none\'">';
        }
        // Update episode header artwork
        var skelArt = document.getElementById('ar-skel-art');
        if (skelArt && artUrl) {
          skelArt.innerHTML = '<img src="' + artUrl + '" style="width:48px;height:48px;border-radius:50%;object-fit:cover">';
        }
        // Update dock artwork
        var dockArt = document.getElementById('ar-dock-art');
        if (dockArt && artUrl) dockArt.src = artUrl;
      }).catch(function() {});
  }
}

// ── SKELETON DASHBOARD ─────────────────────────────────────────────────────
function renderSkeletonDashboard(audioUrl, epTitle, showName) {
  var vid = ytId(audioUrl || '');
  var _cleanTitle = decodeHTMLEntities(epTitle) || '';
  var _cleanShow = decodeHTMLEntities(showName) || '';

  // Show dock + progress strip immediately
  var dockEl = document.getElementById('ar-dock');
  var stripEl = document.getElementById('ar-progress-strip');
  if (dockEl) dockEl.classList.remove('hidden');
  if (stripEl) stripEl.classList.remove('hidden');
  var dockTitle = document.getElementById('ar-dock-title');
  var dockShow = document.getElementById('ar-dock-show');
  if (dockTitle) dockTitle.textContent = _cleanTitle || 'Loading\u2026';
  if (dockShow) dockShow.textContent = _cleanShow;
  _arSetDockStatus(false);
  _arUpdateProgress(0);

  var html = '<div class="v7-dash"><div class="v7-main">';

  // Episode header
  html += '<div class="v7-ep-header">'
    + '<div class="v7-ep-art" id="ar-skel-art">&#127897;</div>'
    + '<div style="flex:1;min-width:0">'
    + '<div class="v7-ep-title">' + (_cleanTitle || 'Analyzing episode\u2026') + '</div>'
    + (_cleanShow ? '<div class="v7-ep-show">' + _cleanShow + '</div>' : '')
    + '</div>'
    + '<div class="v7-ep-actions">'
    + '<button class="v7-act-btn" onclick="document.getElementById(\'url-input\').value=\'\';document.getElementById(\'ep-picker\').classList.remove(\'on\')">Analyze another</button>'
    + '</div></div>';

  // ETA banner
  html += '<div class="v7-eta-banner" id="ar-eta">'
    + '<div><div class="v7-eta-text">Full analysis ready in about 2&ndash;5 minutes</div>'
    + '<div class="v7-eta-sub">First findings appear in ~90 seconds &middot; Play while you wait</div></div>'
    + '<div class="v7-eta-pct" id="ar-eta-pct">0% complete</div>'
    + '</div>';

  // Two-column row
  html += '<div class="v7-trow">';
  html += _v7LeftCol(vid, _cleanTitle);

  // Right column
  var right = '<div class="v7-rc">';

  // Guest card — skeleton with show name if available
  right += '<div class="v7-card" id="v7-guest-card">'
    + '<div class="v7-gtop">'
    + '<div class="v7-gav" style="background:#e8e8e8;color:#bbb">&#127897;</div>'
    + '<div><div class="v7-gname" style="color:#bbb">' + (_cleanShow || 'Loading show info\u2026') + '</div>'
    + '<div class="v7-grole" style="color:#ddd">Host</div></div>'
    + '</div></div>';

  // Audio briefing — placeholder while analyzing
  right += '<div class="v7-card">'
    + '<div class="v7-lbl">Audio Briefing &middot; Before You Listen</div>'
    + '<div class="v7-bdesc" style="color:#bbb">Generates when analysis completes</div>'
    + '<div style="display:flex;align-items:center;gap:8px;margin-top:8px">'
    + '<button class="v7-bbtn" disabled style="opacity:0.4;cursor:default">&#9654; Play briefing</button>'
    + '</div>'
    + '</div>';

  // Bias bar — skeleton state
  right += _v7BiasCard(null, true);

  right += '</div>'; // end v7-rc
  html += right + '</div>'; // end v7-trow

  // Metrics — skeleton
  html += '<div class="v7-mrow">'
    + '<div class="v7-mc"><div class="ar-skel" style="height:22px;border-radius:4px;margin-bottom:6px"></div><div class="v7-ml">Host trust</div></div>'
    + '<div class="v7-mc"><div class="ar-skel" style="height:22px;border-radius:4px;margin-bottom:6px"></div><div class="v7-ml">Source quality</div></div>'
    + '<div class="v7-mc"><div class="ar-skel" style="height:22px;border-radius:4px;margin-bottom:6px"></div><div class="v7-ml">Guest balance</div></div>'
    + '</div>';

  // Findings — skeleton
  html += '<div class="v7-sec"><div class="v7-seclbl">Worth knowing before you listen</div>'
    + '<div class="v7-findings-wrap" style="padding:14px 12px;display:flex;align-items:center;gap:10px">'
    + '<div class="feed-spin" style="width:14px;height:14px;border-width:2px;margin:0;flex-shrink:0"></div>'
    + '<span style="font-size:11px;color:#bbb">Identifying key moments\u2026</span>'
    + '</div></div>';

  html += '</div><div class="ar-dock-spacer"></div></div>';

  document.getElementById('results').innerHTML = html;
  _v7PostRender(vid, _cleanShow, _cleanTitle);
}

// ── FULL RESULTS DASHBOARD ─────────────────────────────────────────────────
function renderResults(data) {
  if (data.jobId) _currentJobId = data.jobId;
  window._lastAnalysisResult = data;

  _enrichWithAudioLean(data);

  var vid = ytId(data.url || '');
  var isPartial = data.status === 'partial';
  var u = plUser();
  var _cfg = _getEffectiveTierConfig();

  var epTitle = decodeHTMLEntities(data.episodeTitle) || '';
  var showName = decodeHTMLEntities(data.showName) || '';
  var al = data.audioLean || null;

  // Update dock
  _arShowDock(data);
  _arSetDockStatus(!isPartial);

  var html = '<div class="v7-dash"><div class="v7-main">';

  // Guest preview bar (logged-out only)
  if (!u) {
    html += '<div class="v7-preview-bar">'
      + '<span class="v7-prev-lbl">Previewing as:</span>'
      + '<button class="v7-prev-pill' + (_previewTier === 'free' ? ' on-free' : '') + '" onclick="setPreviewTier(\'free\')">Free</button>'
      + '<button class="v7-prev-pill' + (_previewTier === 'creator' ? ' on-creator' : '') + '" onclick="setPreviewTier(\'creator\')">Creator</button>'
      + '<button class="v7-prev-pill' + (_previewTier === 'operator' ? ' on-operator' : '') + '" onclick="setPreviewTier(\'operator\')">Operator</button>'
      + '<span class="v7-prev-cta"><a onclick="if(typeof openModal===\'function\')openModal(\'signup\')">Sign up free &rarr;</a></span>'
      + '</div>';
  }

  // Episode header
  html += '<div class="v7-ep-header">'
    + '<div class="v7-ep-art" id="ar-skel-art">'
    + (data.artworkUrl ? '<img src="' + data.artworkUrl + '" style="border-radius:50%;width:48px;height:48px;object-fit:cover" onerror="this.style.display=\'none\'">' : '&#127897;')
    + '</div>'
    + '<div style="flex:1;min-width:0">'
    + '<div class="v7-ep-title">' + (epTitle || 'Episode Analysis') + '</div>'
    + (showName ? '<div class="v7-ep-show">' + showName + (data.duration ? ' &middot; ' + data.duration : '') + '</div>' : '')
    + '</div>'
    + '<div class="v7-ep-actions">'
    + '<button class="v7-act-btn" onclick="shareAnalysis(\'' + (data.jobId || '') + '\')">&#8599; Share</button>'
    + '<button class="v7-act-btn" onclick="document.getElementById(\'url-input\').value=\'\';document.getElementById(\'ep-picker\').classList.remove(\'on\')">Analyze another</button>'
    + '</div></div>';

  // ETA banner (partial only)
  if (isPartial) {
    var etaText = data.duration
      ? 'Episode is ' + data.duration + ' &mdash; full analysis ready soon'
      : 'Analysis in progress &mdash; more findings loading';
    html += '<div class="v7-eta-banner" id="ar-eta">'
      + '<div><div class="v7-eta-text">' + etaText + '</div>'
      + '<div class="v7-eta-sub">First findings appear in ~90 seconds &middot; Play while you wait</div></div>'
      + '<div class="v7-eta-pct" id="ar-eta-pct">Analyzing\u2026</div>'
      + '</div>';
  }

  // Two-column row
  html += '<div class="v7-trow">';
  html += _v7LeftCol(vid, epTitle);

  // Right column
  var right = '<div class="v7-rc">';

  // ── Card 1: Guest / host card ──
  var guest = data.guest || null;
  if (guest && guest.name) {
    var gIni = (guest.name || '?').trim().split(' ').map(function(w){return w[0]||'';}).slice(0,2).join('').toUpperCase();
    var gRole = [guest.title, guest.organization].filter(Boolean).join(' &middot; ');
    right += '<div class="v7-card" id="v7-guest-card" data-guest-locked="1">'
      + '<div class="v7-gtop">'
      + '<div class="v7-gav">' + gIni + '</div>'
      + '<div><div class="v7-gname">' + (guest.name || '') + '</div>'
      + (gRole ? '<div class="v7-grole">' + gRole + '</div>' : '')
      + '</div></div>'
      + '<div class="v7-chips">'
      + (guest.lean ? '<div class="v7-lchip">' + guest.lean + '</div>' : '')
      + (guest.episodeCount ? '<div class="v7-chip">' + guest.episodeCount + ' prior episodes</div>' : '')
      + '<div class="v7-chip">High credibility</div>'
      + '</div>'
      + '<div class="v7-srow">'
      + (guest.twitter ? '<a class="v7-sl" href="https://x.com/' + guest.twitter + '" target="_blank" rel="noopener">&#120143; @' + guest.twitter + '</a>' : '')
      + (guest.linkedin ? '<a class="v7-sl" href="' + guest.linkedin + '" target="_blank" rel="noopener">in LinkedIn</a>' : '')
      + (guest.wikipedia ? '<a class="v7-sl" href="' + guest.wikipedia + '" target="_blank" rel="noopener">W Wikipedia</a>' : '')
      + '<a class="v7-sl v7-sl-pl" href="#">&#127897; Podlens profile</a>'
      + '</div></div>';
  } else {
    // Fallback: show host info card, populated by _v7PostRender iTunes fetch
    right += '<div class="v7-card" id="v7-guest-card">'
      + '<div class="v7-gtop">'
      + '<div class="v7-gav" style="background:#1a3050;color:#fff">&#127897;</div>'
      + '<div><div class="v7-gname">' + (showName || 'Host') + '</div>'
      + '<div class="v7-grole">Host</div></div>'
      + '</div></div>';
  }

  // ── Card 2: Audio briefing ──
  var summaryDesc = data.summary
    ? data.summary.substring(0, 100) + (data.summary.length > 100 ? '\u2026' : '')
    : '';
  right += '<div class="v7-card"><div class="v7-lbl">Audio Briefing &middot; Before You Listen</div>';
  right += '<div class="v7-bdesc">' + (summaryDesc || 'AI-narrated summary of bias, missing voices, and sponsor flags.') + '</div>';
  if (data.audioScript) {
    var safeScript = data.audioScript.replace(/'/g, '&#39;').replace(/"/g, '&quot;');
    right += '<div style="display:flex;align-items:center;gap:8px;margin-top:8px">'
      + '<button class="v7-bbtn" id="audio-play-btn-' + data.jobId + '" onclick="toggleAudioSummary(\'' + data.jobId + '\',\'' + safeScript + '\')">&#9654; Play briefing</button>'
      + '<span class="v7-bdur">' + (_cfg.audioFull ? '~2 min' : '30 sec preview') + '</span>'
      + '</div>'
      + (!_cfg.audioFull ? '<div class="v7-upbar" style="margin-top:8px"><span class="v7-uptxt">Full briefing &mdash; Creator plan</span><button class="v7-upbtn" onclick="showUpgrade()">Upgrade &rarr;</button></div>' : '')
      + '<div class="audio-progress-rail" style="margin-top:10px"><div class="audio-progress-fill" id="audio-prog-' + data.jobId + '"></div></div>';
  } else {
    right += '<div style="display:flex;align-items:center;gap:8px;margin-top:8px">'
      + '<button class="v7-bbtn" disabled style="opacity:0.4;cursor:default">&#9654; Play briefing</button>'
      + '<span class="v7-bdur" style="color:#bbb">'
      + (isPartial ? 'Generates when analysis completes' : 'Not available for this episode')
      + '</span>'
      + '</div>';
  }
  right += '</div>';

  // ── Card 3: Political lean ──
  right += _v7BiasCard(al, isPartial);

  right += '</div>'; // end v7-rc
  html += right + '</div>'; // end v7-trow

  // ── QUICK METRICS ROW ──
  var trustScore = data.hostTrustScore;
  var trustVal = trustScore != null ? (trustScore / 10).toFixed(1) : '&mdash;';
  var trustLbl = trustScore > 65 ? 'High' : trustScore > 35 ? 'Moderate' : trustScore != null ? 'Low' : '';
  var trustCls = trustLbl === 'High' ? 'v7-ms-hi' : trustLbl === 'Low' ? 'v7-ms-lo' : 'v7-ms-mod';
  var mvCount = (data.missingVoices || []).length;
  var guestScore = mvCount === 0 ? '9.0' : mvCount <= 2 ? '6.5' : mvCount <= 4 ? '4.0' : '2.5';
  var guestLbl = mvCount === 0 ? 'High' : mvCount <= 2 ? 'Moderate' : 'Low';
  var guestCls = guestLbl === 'High' ? 'v7-ms-hi' : guestLbl === 'Low' ? 'v7-ms-lo' : 'v7-ms-mod';
  var fl = data.factualityLabel || '';
  var sqScore = fl.indexOf('green') >= 0 || fl.indexOf('Mostly') >= 0 ? '8.5' : fl.indexOf('Mixed') >= 0 ? '5.5' : fl.indexOf('Unreliable') >= 0 || fl.indexOf('red') >= 0 ? '2.5' : '6.0';
  var sqLbl = parseFloat(sqScore) >= 7 ? 'High' : parseFloat(sqScore) >= 4.5 ? 'Moderate' : 'Low';
  var sqCls = sqLbl === 'High' ? 'v7-ms-hi' : sqLbl === 'Low' ? 'v7-ms-lo' : 'v7-ms-mod';

  html += '<div class="v7-mrow">'
    + '<div class="v7-mc"><div class="v7-mv">' + trustVal + '</div><div class="v7-ml">Host trust</div><div class="v7-ms ' + trustCls + '">' + trustLbl + '</div></div>'
    + '<div class="v7-mc"><div class="v7-mv">' + sqScore + '</div><div class="v7-ml">Source quality</div><div class="v7-ms ' + sqCls + '">' + sqLbl + '</div></div>'
    + '<div class="v7-mc"><div class="v7-mv">' + guestScore + '</div><div class="v7-ml">Guest balance</div><div class="v7-ms ' + guestCls + '">' + guestLbl + '</div></div>'
    + '</div>';

  // ── WORTH KNOWING BEFORE YOU LISTEN ──
  var allFlags = (data.flags || []).slice().sort(function(a,b) {
    var aS = (a.type==='sponsor'||a.type==='sponsor-note') ? 0 : 1;
    var bS = (b.type==='sponsor'||b.type==='sponsor-note') ? 0 : 1;
    return aS - bS;
  });
  var visCount = _cfg.findingsVisible;

  html += '<div class="v7-sec"><div class="v7-seclbl">Worth knowing before you listen'
    + (allFlags.length ? '<span style="text-transform:none;letter-spacing:0;font-weight:400;color:#aaa"> &middot; tap any finding to expand</span>' : '')
    + '</div><div class="v7-findings-wrap">';

  if (allFlags.length) {
    allFlags.slice(0, visCount).forEach(function(f) {
      var expandBody = '<div class="v7-exp-summary">' + (f.detail || f.summary || '') + '</div>';
      (f.citations || []).slice(0, _cfg.citations || 0).forEach(function(c) {
        expandBody += '<div class="v7-exp-ev">';
        if (c.timestamp) expandBody += '<div class="v7-exp-time">' + c.timestamp + '</div>';
        if (c.quote) expandBody += '<div class="v7-exp-quote">\u201c' + c.quote + '\u201d</div>';
        if (c.explanation) expandBody += '<div class="v7-exp-note">' + c.explanation + '</div>';
        expandBody += '</div>';
      });

      html += '<div class="v7-fi" onclick="arToggleFinding(this)">'
        + '<div class="v7-ftag ' + _v7FtCls(f.type) + '">' + _v7FtLabel(f.type) + '</div>'
        + '<div><div class="v7-ftitle">' + (f.title || '') + '</div>'
        + '<div class="v7-fbody">' + (f.detail || f.summary || '') + '</div></div>'
        + '<div class="v7-farrow">&#8250;</div>'
        + '</div>'
        + '<div class="v7-expand">' + expandBody + '</div>';
    });

    var lockedCount = allFlags.length - visCount;
    if (lockedCount > 0) {
      for (var i = 0; i < lockedCount; i++) {
        html += '<div class="v7-blur-r"><div class="v7-btext"></div><span class="v7-lock">&#128274;</span></div>';
      }
      html += '<div class="v7-upbar"><span class="v7-uptxt">' + lockedCount + ' more finding' + (lockedCount > 1 ? 's' : '') + ' &mdash; upgrade to see all</span><button class="v7-upbtn" onclick="showUpgrade()">Upgrade &rarr;</button></div>';
    }

    if (isPartial) {
      html += '<div style="padding:10px 12px;display:flex;align-items:center;gap:8px"><div class="feed-spin" style="width:14px;height:14px;border-width:2px;margin:0"></div><span style="font-size:11px;color:#bbb">More findings loading\u2026</span></div>';
    }
  } else if (isPartial) {
    html += '<div style="padding:14px 12px;display:flex;align-items:center;gap:10px">'
      + '<div class="feed-spin" style="width:14px;height:14px;border-width:2px;margin:0;flex-shrink:0"></div>'
      + '<span style="font-size:11px;color:#bbb">Identifying key moments\u2026</span></div>';
  } else {
    html += '<div style="padding:12px;font-size:11px;color:#bbb">No significant findings for this episode.</div>';
  }
  html += '</div></div>';

  // ── KEY FINDINGS ──
  if (data.keyFindings && data.keyFindings.length) {
    html += '<div class="v7-sec"><div class="v7-seclbl">Key Findings</div><div class="v7-findings-wrap">';
    data.keyFindings.forEach(function(kf) {
      var lean = typeof kf === 'object' ? (kf.lean || '') : '';
      var dot = lean === 'left' ? '#e0352b' : lean === 'right' ? '#3a7fd4' : '#999';
      var bodyText = typeof kf === 'string' ? kf : (kf.text || kf.title || kf.detail || '');
      var detailText = typeof kf === 'object' ? (kf.detail || bodyText) : bodyText;
      html += '<div class="v7-fi" onclick="arToggleFinding(this)">'
        + '<div style="width:8px;height:8px;border-radius:50%;background:' + dot + ';flex-shrink:0;margin-top:3px"></div>'
        + '<div><div class="v7-ftitle">' + bodyText + '</div></div>'
        + '<div class="v7-farrow">&#8250;</div>'
        + '</div>'
        + '<div class="v7-expand"><div class="v7-exp-summary">' + detailText + '</div></div>';
    });
    html += '</div></div>';
  }

  // ── SOURCE CITATIONS ──
  html += '<div class="v7-sec"><div class="v7-seclbl">Source citations</div>';
  if (_cfg.citations > 0) {
    var allCits = [];
    (data.flags || []).forEach(function(f) { (f.citations || []).forEach(function(c) { allCits.push(c); }); });
    var shownCits = _cfg.citations >= 99 ? allCits : allCits.slice(0, _cfg.citations);
    if (shownCits.length) {
      shownCits.forEach(function(c, ci) {
        html += '<div class="v7-cit"><div class="v7-cnum">' + (ci+1) + '</div>'
          + '<div><div class="v7-ctitle2">' + (c.quote ? '\u201c' + c.quote.substring(0,80) + (c.quote.length>80?'\u2026\u201d':'\u201d') : c.explanation || 'Citation') + '</div>'
          + (c.timestamp ? '<div class="v7-csrc">cited at ' + c.timestamp + '</div>' : '')
          + '</div></div>';
      });
    } else {
      html += '<div style="font-size:11px;color:#bbb;padding:6px 0">No citations available.</div>';
    }
    if (_cfg.citations < 99 && allCits.length > _cfg.citations) {
      var moreC = allCits.length - _cfg.citations;
      html += '<div class="v7-upbar"><span class="v7-uptxt">' + moreC + ' more &mdash; Operator plan</span><button class="v7-upbtn" onclick="showUpgrade()">Upgrade &rarr;</button></div>';
    }
  } else {
    html += '<div class="v7-blur-r"><div class="v7-btext"></div><span class="v7-lock">&#128274;</span></div>'
      + '<div class="v7-upbar"><span class="v7-uptxt">Citations &mdash; Creator plan</span><button class="v7-upbtn" onclick="showUpgrade()">Upgrade &rarr;</button></div>';
  }
  html += '</div>';

  // ── FULL TRANSCRIPT ──
  html += '<div class="v7-sec"><div class="v7-seclbl">Full Transcript</div>';
  if (_cfg.fullTranscript) {
    html += '<div style="font-size:11px;color:#bbb;padding:6px 0">Transcript available after full analysis completes.</div>';
  } else {
    html += '<div class="v7-blur-r"><div class="v7-btext"></div><span class="v7-lock">&#128274;</span></div>'
      + '<div class="v7-upbar"><span class="v7-uptxt">Full transcript unlocks with Operator</span><button class="v7-upbtn" onclick="showUpgrade()">Upgrade &rarr;</button></div>';
  }
  html += '</div>';

  // ── DEEP ANALYSIS REPORT BAR ──
  html += '<div class="v7-drbar"><div style="flex:1">'
    + '<div class="v7-drtitle">&#128196; Deep Analysis Report</div>';
  if (_cfg.deepReport) {
    html += '<div class="v7-drdesc">Claim-by-claim &middot; Narrative arc &middot; Missing voices &middot; Comparative bias &middot; PDF download</div>'
      + '</div><div><button class="v7-drpri" onclick="downloadReport()">Download report</button></div>';
  } else if (_cfg.creatorReport) {
    html += '<div class="v7-drdesc">Bias summary &middot; Top findings &middot; Host trust &middot; PDF download</div>'
      + '</div><div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">'
      + '<button class="v7-drsec" onclick="downloadReport()">Download Creator report</button>'
      + '<div class="v7-drlocked">&#128274; Full report &mdash; Operator</div>'
      + '</div>';
  } else {
    html += '<div class="v7-drdesc">Full intelligence report on Creator and Operator plans.</div>'
      + '</div><div><div class="v7-drlocked">&#128274; Creator or above</div></div>';
  }
  html += '</div>';

  // ── SHARE ──
  if (u) {
    var shareUrl = window.location.origin + '/analysis/' + (_currentJobId || '');
    html += '<div class="v7-sec"><div class="v7-seclbl">Share this analysis</div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap">'
      + '<button class="v7-bbtn" onclick="_shareCopyLink(\'' + shareUrl + '\')">&#128279; Copy link</button>'
      + '<button class="v7-bbtn" style="background:#1a1a1a" onclick="shareToX(window._lastAnalysisResult||{})">&#120143; Share to X</button>'
      + '</div></div>';
  }

  html += '</div><div class="ar-dock-spacer"></div></div>';

  document.getElementById('results').innerHTML = html;

  // Init audio if MP3
  if (data.url && /\.(mp3|m4a|ogg|wav|aac)/i.test(data.url)) {
    setTimeout(function() { _arInitNativeAudio(data.url, data); }, 100);
  }

  // Post-render: YouTube + iTunes
  _v7PostRender(vid, showName, epTitle);

  // Load platform buttons
  if (!isPartial) loadPlatformButtons(data);
}
