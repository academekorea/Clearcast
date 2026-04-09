// ── V7 RENDER — exact mockup class names and structure ──────────────────────
// CSS classes match podlens_dashboard_v7__1_.html verbatim.
// ─────────────────────────────────────────────────────────────────────────────

var _openFindings = {};
var _openKF = {};

function toggleFinding(i) {
  _openFindings[i] = !_openFindings[i];
  var fis = document.querySelectorAll('.fi');
  var exps = document.querySelectorAll('.expand');
  // find paired expand (next sibling)
  if (fis[i]) {
    fis[i].classList.toggle('open', !!_openFindings[i]);
    var next = fis[i].nextElementSibling;
    if (next && next.classList.contains('expand')) next.classList.toggle('show', !!_openFindings[i]);
  }
}

function toggleKF(i) {
  _openKF[i] = !_openKF[i];
  var kfis = document.querySelectorAll('.kfi');
  if (kfis[i]) {
    kfis[i].classList.toggle('open', !!_openKF[i]);
    var next = kfis[i].nextElementSibling;
    if (next && next.classList.contains('expand')) next.classList.toggle('show', !!_openKF[i]);
  }
}

function tagHTML(cls, tag) {
  return '<div class="ftag ' + cls + '">' + tag + '</div>';
}

function _ftCls(t) {
  return { framing:'ff', 'fact-check':'fc', omission:'fo', 'sponsor-note':'fs', sponsor:'fs', context:'fx' }[t] || 'fx';
}
function _ftLabel(t) {
  return { framing:'FRAMING', 'fact-check':'FACT CHECK', omission:'OMISSION', 'sponsor-note':'SPONSOR', sponsor:'SPONSOR', context:'CONTEXT' }[t] || (t||'').toUpperCase();
}

function expandHTML(d) {
  var evHTML = (d.evidence || []).map(function(e) {
    return '<div class="exp-ev">'
      + '<div class="exp-time">' + e.time + '</div>'
      + '<div class="exp-quote">' + e.quote + '</div>'
      + (e.note ? '<div class="exp-note">' + e.note + '</div>' : '')
      + '</div>';
  }).join('');
  var impHTML = (d.impacts || []).map(function(imp) {
    return '<div class="exp-impact"><div class="exp-dot"></div><div class="exp-impact-text">' + imp + '</div></div>';
  }).join('');
  return '<div class="exp-summary">' + (d.summary || d.detail || '') + '</div>'
    + (evHTML ? '<div class="exp-lbl">Evidence from this episode</div>' + evHTML + '<br>' : '')
    + (impHTML ? '<div class="exp-lbl" style="margin-top:2px">Why it matters</div><div style="margin-bottom:12px">' + impHTML + '</div>' : '')
    + (d.balanced ? '<div class="exp-lbl">What balanced would look like</div><div class="exp-balanced"><div class="exp-bal-lbl">A more balanced approach</div><div class="exp-bal-text">' + d.balanced + '</div></div>' : '');
}

function _biasSegs(biasScore) {
  var bs = typeof biasScore === 'number' ? Math.max(-100, Math.min(100, biasScore)) : 0;
  var lp, cp, rp;
  if (bs < -5) {
    lp = Math.round(30 + Math.abs(bs) * 0.45); rp = Math.max(5, Math.round(20 - Math.abs(bs) * 0.15)); cp = Math.max(5, 100 - lp - rp);
  } else if (bs > 5) {
    rp = Math.round(30 + bs * 0.45); lp = Math.max(5, Math.round(20 - bs * 0.15)); cp = Math.max(5, 100 - lp - rp);
  } else { lp = 20; cp = 60; rp = 20; }
  return { lp: lp, cp: cp, rp: rp };
}

function renderResults(data) {
  if (data.jobId && data.jobId !== 'demo') _currentJobId = data.jobId;
  window._lastAnalysisResult = data;

  var u = plUser();
  var isAdmin = u && (u.email === 'academekorea@gmail.com' || u.isSuperAdmin);

  var tier;
  if (!u) { tier = _previewTier || 'free'; }
  else if (isAdmin) { tier = 'operator'; }
  else { var plan = String(enforcePlanRules() || u.plan || 'free').toLowerCase(); tier = (plan === 'trial' || plan === 'studio') ? 'operator' : plan; }

  var c = tier === 'creator', o = tier === 'operator', f = tier === 'free';
  var showFull = c || o;

  _openFindings = {}; _openKF = {};

  var isPartial = data.status === 'partial';
  var epTitle = decodeHTMLEntities(data.episodeTitle || '');
  var showName = decodeHTMLEntities(data.showName || '');
  var vid = ytId(data.url || '');
  var guest = data.guest || {};
  var gIni = (guest.name || showName || '?').trim().split(' ').map(function(w){return w[0]||'';}).slice(0,2).join('').toUpperCase();
  var gRole = [guest.title, guest.organization].filter(Boolean).join(' \u00b7') || 'Host';

  var findings = (data.flags || []).map(function(flag) {
    return {
      tag: _ftLabel(flag.type), cls: _ftCls(flag.type),
      title: flag.title || '', short: flag.detail || flag.summary || '',
      summary: flag.detail || flag.summary || '',
      evidence: (flag.citations || []).map(function(c) { return { time: c.timestamp||'', quote: c.quote||'', note: c.explanation||'' }; }),
      impacts: flag.impacts || [], balanced: flag.balanced || ''
    };
  });

  var keyFindings = (data.keyFindings || []).map(function(kf) {
    if (typeof kf === 'string') return { c: '#888', t: kf, summary: kf, evidence: [], impacts: [], balanced: '' };
    var col = kf.lean==='left' ? '#e0352b' : kf.lean==='right' ? '#3a7fd4' : '#888';
    return { c: col, t: kf.text||kf.title||'', summary: kf.detail||kf.text||'', evidence: kf.evidence||[], impacts: kf.impacts||[], balanced: kf.balanced||'' };
  });

  var cits = [];
  (data.flags || []).forEach(function(flag) {
    (flag.citations || []).forEach(function(c) {
      cits.push({ t: c.quote ? '\u201c'+c.quote.substring(0,60)+'\u2026\u201d' : (c.explanation||'Citation'), s: c.timestamp ? 'cited at '+c.timestamp : '' });
    });
  });

  var segs = _biasSegs(data.biasScore);

  // Findings rows
  var fRows;
  if (showFull) {
    fRows = findings.map(function(d, i) {
      return '<div class="fi" onclick="toggleFinding('+i+')">' + tagHTML(d.cls, d.tag)
        + '<div><div class="ftitle">'+d.title+'</div><div class="fbody">'+d.short+'</div></div>'
        + '<div class="farrow">\u203a</div></div>'
        + '<div class="expand">'+expandHTML(d)+'</div>';
    }).join('');
  } else {
    fRows = findings.slice(0,2).map(function(d,i) {
      return '<div class="fi" onclick="toggleFinding('+i+')">' + tagHTML(d.cls, d.tag)
        + '<div><div class="ftitle">'+d.title+'</div><div class="fbody">'+d.short+'</div></div>'
        + '<div class="farrow">\u203a</div></div>'
        + '<div class="expand">'+expandHTML(d)+'</div>';
    }).join('')
    + '<div class="blur-r"><div class="btext"></div><span class="lock">\uD83D\uDD12</span></div>'
    + '<div class="blur-r"><div class="btext"></div><span class="lock">\uD83D\uDD12</span></div>'
    + '<div class="blur-r" style="border-bottom:none"><div class="btext"></div><span class="lock">\uD83D\uDD12</span></div>'
    + '<div class="upbar"><span class="uptxt">All findings unlock with Creator</span><button class="upbtn" onclick="showUpgrade()">Upgrade \u2192</button></div>';
  }

  var kfRows;
  if (showFull) {
    kfRows = keyFindings.map(function(d,i) {
      return '<div class="kfi" onclick="toggleKF('+i+')">'
        + '<div class="kfd" style="background:'+d.c+'"></div>'
        + '<div class="kft">'+d.t+'</div>'
        + '<div class="kfarrow">\u203a</div></div>'
        + '<div class="expand" style="border-bottom:0.5px solid #f0f0f0">'+expandHTML(d)+'</div>';
    }).join('');
  } else {
    kfRows = '<div class="blur-r"><div class="btext"></div><span class="lock">\uD83D\uDD12</span></div>'
      + '<div class="blur-r"><div class="btext"></div><span class="lock">\uD83D\uDD12</span></div>'
      + '<div class="upbar"><span class="uptxt">Key findings unlock with Creator</span><button class="upbtn" onclick="showUpgrade()">Upgrade \u2192</button></div>';
  }

  var html = '<div class="pl-results-wrap">';

  // Previewing-as bar (logged-out only)
  if (!u) {
    html += '<div class="demo">'
      + '<span class="dlbl">Previewing as</span>'
      + '<button class="p'+(f?' on':'')+'" onclick="setPreviewTier(\'free\')">Free</button>'
      + '<button class="p'+(c?' on':'')+'" onclick="setPreviewTier(\'creator\')">Creator</button>'
      + '<button class="p'+(o?' on':'')+'" onclick="setPreviewTier(\'operator\')">Operator</button>'
      + '</div>';
  }

  html += '<div class="pl-main">';

  // ETA banner
  if (isPartial || data.jobId === 'demo') {
    html += '<div class="sec"><div style="background:#fffbeb;border:0.5px solid #fde68a;border-radius:8px;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">'
      + '<div><div style="font-size:12px;color:#92580a">Episode is '+(data.duration||'2h 18m')+' \u2014 full analysis ready in about 7 minutes</div>'
      + '<div style="font-size:10px;color:#b58a40;margin-top:2px">First findings appear in ~90 seconds \u00b7 Play while you wait</div></div>'
      + '<div style="font-size:10px;color:#b58a40">42% complete</div></div></div>';
  }

  // Two-column row
  html += '<div class="trow">';

  // Left column
  html += '<div>';
  if (vid) {
    html += '<div class="artwork" style="aspect-ratio:16/9;position:relative">'
      + '<iframe src="https://www.youtube.com/embed/'+vid+'?rel=0&modestbranding=1&enablejsapi=1"'
      + ' allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture"'
      + ' allowfullscreen style="position:absolute;inset:0;width:100%;height:100%;border:none;border-radius:7px"></iframe></div>';
  } else {
    html += '<div class="artwork" id="v7-artwork-left">'
      + '<div style="display:flex;flex-direction:column;align-items:center;gap:6px">'
      + '<div class="aicon">&#127897;</div>'
      + '<div style="font-size:10px;color:#aaa">'+(epTitle||showName||'')+'</div></div>'
      + '<div class="pov"><button class="pbig" onclick="arPlayPause()">\u25b6</button></div></div>';
  }
  html += '<div class="pl-ctls">'
    + '<button class="pl-cb" onclick="arSkip(-30)">\u21ba 30s</button>'
    + '<button class="pl-pc" id="ar-play-btn" onclick="arPlayPause()">\u25b6</button>'
    + '<button class="pl-cb" onclick="arSkip(30)">30s \u21bb</button>'
    + '<button class="pl-spd" onclick="arSetSpeed(1,this)">1\u00d7</button>'
    + '</div>'
    + '<div class="pl-abar">'
    + '<div class="pl-abarlbl"><span id="v7-time-cur">0:00</span><span id="v7-time-dur">'+(data.duration||'')+'</span></div>'
    + '<div class="pl-atrack" id="v7-atrack" onclick="arScrub(event)">'
    + '<div class="pl-afill" id="v7-afill" style="width:0%"></div>'
    + '<div class="pl-athumb" id="v7-athumb" style="left:0%"></div>'
    + '</div></div>';
  html += '</div>';

  // Right column
  html += '<div class="rc">';

  // Guest card
  html += '<div class="pl-card">'
    + '<div class="gtop"><div class="gav">'+gIni+'</div>'
    + '<div><div class="gname">'+(guest.name||showName||'Host')+'</div>'
    + '<div class="grole">'+gRole+'</div></div></div>'
    + '<div class="chips">'
    + (guest.lean ? '<div class="lchip">'+guest.lean+'</div>' : '')
    + (guest.episodeCount ? '<div class="chip">'+guest.episodeCount+' prior episodes</div>' : '')
    + '<div class="chip">High credibility</div>'
    + '</div>'
    + '<div class="srow">'
    + (guest.twitter   ? '<a class="sl" href="https://x.com/'+guest.twitter+'" target="_blank" rel="noopener">\uD835\uDD4F @'+guest.twitter+'</a>' : '')
    + (guest.instagram ? '<a class="sl" href="https://instagram.com/'+guest.instagram+'" target="_blank" rel="noopener">&#128247; @'+guest.instagram+'</a>' : '')
    + (guest.linkedin  ? '<a class="sl" href="'+guest.linkedin+'" target="_blank" rel="noopener">in LinkedIn</a>' : '')
    + (guest.website   ? '<a class="sl" href="'+guest.website+'" target="_blank" rel="noopener">&#127760; '+guest.website.replace(/^https?:\/\//,'').split('/')[0]+'</a>' : '')
    + '<a class="sl sl-podlens" href="#">&#127897; PodLens profile</a>'
    + '</div></div>';

  // Audio briefing card — always playable using summary text via Web Speech API
  var briefingScript = (data.summary || data.biasLabel || 'Analysis complete.').replace(/'/g,"&#39;").replace(/"/g,'&quot;');
  html += '<div class="pl-card">'
    + '<div class="lbl">Audio briefing \u00b7 Before you listen</div>'
    + '<div class="bdesc">'+(data.summary ? data.summary.substring(0,120)+(data.summary.length>120?'\u2026':'') : 'AI-narrated overview of bias, framing, and sponsor patterns.')+'</div>'
    + '<div style="display:flex;align-items:center;gap:8px">'
    + '<button class="bbtn" onclick="toggleAudioSummary(\''+(data.jobId||'demo')+'\',\''+briefingScript+'\')">\u25b6 Play briefing</button>'
    + (showFull ? '<span class="bdur">~2 min</span>' : '<span class="bdur" style="color:#bbb">10 sec preview</span>')
    + '</div></div>';

  // Bias card
  html += '<div class="pl-card">'
    + '<div class="biasrow">'
    + '<div class="lbl" style="margin-bottom:0">Political lean \u2014 how this episode frames issues</div>'
    + '<div style="display:flex;align-items:center;gap:4px;font-size:10px;color:#d97706"><div class="pdot"></div>'+(isPartial||data.jobId==='demo' ? 'Early signal' : 'Final')+'</div>'
    + '</div>'
    + '<div style="position:relative"><div class="bias-bar-wrap">'
    + '<div class="bias-seg-left" style="width:'+segs.lp+'%"></div>'
    + '<div class="bias-seg-center" style="width:'+segs.cp+'%"></div>'
    + '<div class="bias-seg-right" style="width:'+segs.rp+'%"></div>'
    + '<div class="bias-marker" style="left:'+segs.lp+'%"></div>'
    + '</div></div>'
    + '<div class="bpcts">'
    + '<span style="color:#e0352b">\u25cf '+segs.lp+'% left</span>'
    + '<span style="color:#999">\u25aa '+segs.cp+'% center</span>'
    + '<span style="color:#3a7fd4">\u25cf '+segs.rp+'% right</span>'
    + '</div>'
    + '<div class="bverdict">'+(data.biasLabel||'Slight left lean')+'</div>'
    + (isPartial||data.jobId==='demo' ? '<div class="enote">Based on first 30 min \u00b7 updating as analysis continues</div>' : '')
    + '</div>';

  html += '</div>'; // end rc
  html += '</div>'; // end trow

  // Quick metrics
  if (showFull) {
    var ts = data.hostTrustScore;
    var tv = ts != null ? (ts/10).toFixed(1) : '7.2';
    var tl = ts > 65 ? 'High' : ts > 35 ? 'Moderate' : 'Low';
    var tc = tl==='High' ? '#16a34a' : tl==='Low' ? '#ea580c' : '#d97706';
    html += '<div class="sec"><div class="seclbl">Quick metrics</div><div class="mrow">'
      + '<div class="mc"><div class="mv">'+tv+'</div><div class="ml">Host trust</div><div class="ms" style="color:'+tc+'">'+tl+'</div></div>'
      + '<div class="mc"><div class="mv">6.1</div><div class="ml">Source quality</div><div class="ms" style="color:#d97706">Moderate</div></div>'
      + '<div class="mc"><div class="mv">4.8</div><div class="ml">Guest balance</div><div class="ms" style="color:#ea580c">Low</div></div>'
      + '</div></div>';
  }

  // Worth knowing
  html += '<div class="sec"><div class="seclbl">Worth knowing before you listen'
    + (showFull ? '<span style="font-size:10px;color:#ccc;text-transform:none;letter-spacing:0;margin-left:4px">\u00b7 tap any finding to expand</span>' : '')
    + '</div><div class="findings-wrap">'+fRows+'</div></div>';

  // Key findings
  html += '<div class="sec"><div class="seclbl">Key findings'
    + (showFull ? '<span style="font-size:10px;color:#ccc;text-transform:none;letter-spacing:0;margin-left:4px">\u00b7 tap any finding to expand</span>' : '')
    + '</div><div class="findings-wrap">'+kfRows+'</div></div>';

  // Source citations
  html += '<div class="sec"><div class="seclbl">Source citations</div>';
  if (showFull && cits.length) {
    html += cits.map(function(x,i){ return '<div class="cit"><div class="cnum">'+(i+1)+'</div><div><div class="ctitle2">'+x.t+'</div>'+(x.s?'<div class="csrc">'+x.s+'</div>':'')+'</div></div>'; }).join('');
  } else if (showFull) {
    html += '<div style="font-size:11px;color:#bbb;padding:6px 0">No citations available.</div>';
  } else {
    html += '<div class="blur-r"><div class="btext"></div><span class="lock">\uD83D\uDD12</span></div>'
      + '<div class="upbar"><span class="uptxt">Citations unlock with Creator</span><button class="upbtn" onclick="showUpgrade()">Upgrade \u2192</button></div>';
  }
  html += '</div>';

  // Full transcript
  if (o) {
    html += '<div class="sec"><div class="seclbl">Full transcript</div>'
      + '<div style="background:#fafafa;border:0.5px solid #e8e8e8;border-radius:8px;padding:13px;font-size:11px;color:#aaa;line-height:1.9">'
      + (data.transcript ? data.transcript.substring(0,800)+(data.transcript.length>800?'\u2026':'') : '<span style="color:#ccc">[00:00]</span> <strong style="color:#888">' + showName + ':</strong> Transcript available after analysis completes.')
      + '</div></div>';
  } else if (c) {
    html += '<div class="sec"><div class="seclbl">Full transcript</div>'
      + '<div class="upbar"><span class="uptxt">Full transcript unlocks with Operator</span><button class="upbtn" onclick="showUpgrade()">Upgrade \u2192</button></div></div>';
  }

  // Deep report bar
  html += '<div class="drbar"><div style="flex:1">'
    + '<div class="drtitle">\uD83D\uDCC4 Deep Analysis Report</div>'
    + '<div class="drdesc">'
    + (o ? 'Claim-by-claim breakdown \u00b7 Narrative arc \u00b7 Missing voices \u00b7 Comparative bias \u00b7 <span style="color:#999">Downloadable PDF</span>'
         : c ? 'Bias summary \u00b7 Top findings \u00b7 Host trust breakdown \u00b7 <span style="color:#999">Downloadable PDF \u2014 upgrade to Operator for the full deep report</span>'
             : 'Full intelligence report available on Creator and Operator plans.')
    + '</div>'
    + (c ? '<div class="cdlrow"><span style="font-size:10px;color:#bbb">Your Creator Report is ready</span><button class="drsec" style="font-size:10px;padding:4px 10px" onclick="downloadReport()">Download</button></div>' : '')
    + '</div><div style="display:flex;gap:7px;align-items:center;flex-shrink:0">'
    + (o ? '<button class="drpri" onclick="downloadReport()">Download full report</button>'
         : c ? '<div class="drlocked">\uD83D\uDD12 Full report \u2014 Operator</div>'
             : '<div class="drlocked">\uD83D\uDD12 Creator or above</div>')
    + '</div></div>';

  html += '</div></div>'; // end pl-main + pl-results-wrap

  document.getElementById('results').innerHTML = html;
  var emptyState = document.getElementById('empty-state');
  if (emptyState) emptyState.style.display = 'none';

  _arShowDock(data);

  if (data.url && /\.(mp3|m4a|ogg|wav|aac)/i.test(data.url)) {
    setTimeout(function() { _arInitNativeAudio(data.url, data); }, 100);
  }

  // iTunes artwork fetch for non-demo, non-YouTube
  if (!vid && data.jobId !== 'demo') {
    var q = showName || epTitle;
    if (q) {
      fetch('https://itunes.apple.com/search?term='+encodeURIComponent(q)+'&media=podcast&entity=podcast&limit=1', {signal:AbortSignal.timeout(5000)})
        .then(function(r){return r.json();})
        .then(function(d){
          var p = d.results && d.results[0];
          if (!p) return;
          var artUrl = (p.artworkUrl100||'').replace('100x100bb','600x600bb');
          var leftArt = document.getElementById('v7-artwork-left');
          if (leftArt && artUrl) leftArt.innerHTML = '<img src="'+artUrl+'" alt="" style="width:100%;height:100%;object-fit:cover;display:block">';
        }).catch(function(){});
    }
  }

  if (!isPartial) loadPlatformButtons(data);
}

// ── Skeleton ──────────────────────────────────────────────────────────────────
function renderSkeletonDashboard(audioUrl, epTitle, showName) {
  var vid = ytId(audioUrl || '');
  var _cleanTitle = decodeHTMLEntities(epTitle) || '';
  var _cleanShow = decodeHTMLEntities(showName) || '';

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

  var emptyState = document.getElementById('empty-state');
  if (emptyState) emptyState.style.display = 'none';

  var html = '<div class="pl-results-wrap"><div class="pl-main">';
  html += '<div class="sec"><div style="background:#fffbeb;border:0.5px solid #fde68a;border-radius:8px;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">'
    + '<div><div style="font-size:12px;color:#92580a">Analyzing \u2014 first findings appear in ~90 seconds</div>'
    + '<div style="font-size:10px;color:#b58a40;margin-top:2px">Play while you wait</div></div>'
    + '<div id="ar-eta-pct" style="font-size:10px;color:#b58a40">0% complete</div></div></div>';

  html += '<div class="trow"><div>';
  if (vid) {
    html += '<div class="artwork" style="aspect-ratio:16/9;position:relative">'
      + '<iframe src="https://www.youtube.com/embed/'+vid+'?rel=0&modestbranding=1&enablejsapi=1"'
      + ' allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture"'
      + ' allowfullscreen style="position:absolute;inset:0;width:100%;height:100%;border:none;border-radius:7px"></iframe></div>';
  } else {
    html += '<div class="artwork" id="v7-artwork-left">'
      + '<div style="display:flex;flex-direction:column;align-items:center;gap:6px">'
      + '<div class="aicon">&#127897;</div>'
      + (_cleanTitle && !/^(yt-|aai-|GLT|demo)/i.test(_cleanTitle) ? '<div style="font-size:10px;color:#aaa">'+_cleanTitle+'</div>' : '')
      + '</div>'
      + '<div class="pov"><button class="pbig">\u25b6</button></div></div>';
  }
  html += '<div class="pl-ctls">'
    + '<button class="pl-cb" onclick="arSkip(-30)">\u21ba 30s</button>'
    + '<button class="pl-pc" id="ar-play-btn" onclick="arPlayPause()">\u25b6</button>'
    + '<button class="pl-cb" onclick="arSkip(30)">30s \u21bb</button>'
    + '</div>'
    + '<div class="pl-abar"><div class="pl-abarlbl"><span id="v7-time-cur">0:00</span><span id="v7-time-dur"></span></div>'
    + '<div class="pl-atrack" id="v7-atrack" onclick="arScrub(event)">'
    + '<div class="pl-afill" id="v7-afill" style="width:0%"></div>'
    + '<div class="pl-athumb" id="v7-athumb" style="left:0%"></div>'
    + '</div></div>';
  html += '</div>';

  html += '<div class="rc">'
    + '<div class="pl-card"><div class="gtop"><div class="gav" style="background:#e8e8e8;color:#bbb">&#127897;</div>'
    + '<div><div class="gname" style="color:#bbb">'+(_cleanShow||'Loading\u2026')+'</div>'
    + '<div class="grole" style="color:#ddd">Host</div></div></div></div>'
    + '<div class="pl-card"><div class="lbl">Audio briefing \u00b7 Before you listen</div>'
    + '<div class="bdesc" style="color:#bbb">Ready when analysis completes \u2014 play while you wait</div>'
    + '<button class="bbtn" style="margin-top:8px;opacity:.5;cursor:default" disabled>\u25b6 Play briefing</button></div>'
    + '<div class="pl-card"><div class="biasrow">'
    + '<div class="lbl" style="margin-bottom:0">Political lean \u2014 how this episode frames issues</div>'
    + '<div style="display:flex;align-items:center;gap:4px;font-size:10px;color:#d97706"><div class="pdot"></div>Calculating</div></div>'
    + '<div class="enote" style="margin-top:8px">Analyzing transcript \u2014 lean appears in ~90 seconds</div></div>'
    + '</div>';

  html += '</div>'; // end trow

  html += '<div class="sec"><div class="seclbl">Worth knowing before you listen</div>'
    + '<div class="findings-wrap" style="padding:14px 12px;display:flex;align-items:center;gap:10px">'
    + '<div class="feed-spin" style="width:14px;height:14px;border-width:2px;margin:0;flex-shrink:0"></div>'
    + '<span style="font-size:11px;color:#bbb">Identifying key moments\u2026</span></div></div>';

  html += '</div></div>';
  document.getElementById('results').innerHTML = html;

  if (audioUrl && /\.(mp3|m4a|ogg|wav|aac)/i.test(audioUrl)) {
    setTimeout(function() { _arInitNativeAudio(audioUrl, {}); }, 100);
  }
}
