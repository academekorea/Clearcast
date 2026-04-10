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
  var gRole = [guest.title, guest.organization].filter(Boolean).join(' \u00b7') || (showName ? showName : 'Host');

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
      + '<div class="upbar"><span class="uptxt">Key findings unlock with Starter Lens</span><button class="upbtn" onclick="showUpgrade()">Upgrade \u2192</button></div>';
  }

  var html = '<div class="pl-results-wrap">';

  // Previewing-as bar (logged-out only)
  if (!u) {
    html += '<div class="demo">'
      + '<span class="dlbl">Previewing as</span>'
      + '<button class="p'+(f?' on':'')+'" onclick="setPreviewTier(\'free\')">Free</button>'
      + '<button class="p'+(c?' on':'')+'" onclick="setPreviewTier(\'creator\')">Starter Lens</button>'
      + '<button class="p'+(o?' on':'')+'" onclick="setPreviewTier(\'operator\')">Pro Lens</button>'
      + '</div>';
  }

  html += '<div class="pl-main">';

  // ETA banner
  if (isPartial || data.jobId === 'demo') {
    html += '<div class="sec"><div style="background:var(--amber-bg);border:0.5px solid #fde68a;border-radius:8px;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">'
      + '<div><div style="font-size:12px;color:#92580a">Episode is '+(data.duration||'2h 18m')+' \u2014 full analysis ready in about 7 minutes</div>'
      + '<div style="font-size:10px;color:#b58a40;margin-top:2px">First findings appear in ~90 seconds \u00b7 Play while you wait</div></div>'
      + '<div id="ar-eta-pct" style="font-size:10px;color:#b58a40">Analyzing…</div></div></div>';
  }

  // Two-column row
  html += '<div class="trow">';

  // Left column
  html += '<div>';
  if (vid) {
    html += '<div class="artwork" style="aspect-ratio:16/9;position:relative">'
      + '<iframe src="https://www.youtube-nocookie.com/embed/'+vid+'?rel=0&modestbranding=1&enablejsapi=1" id="v7-yt-player"'
      + ' allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture"'
      + ' allowfullscreen style="position:absolute;inset:0;width:100%;height:100%;border:none;border-radius:7px"></iframe></div>';
  } else {
    html += '<div class="artwork" id="v7-artwork-left" style="background:#1a3050;aspect-ratio:1/1">'
      + '<div style="display:flex;flex-direction:column;align-items:center;gap:8px">'
      + '<div class="aicon" style="background:rgba(255,255,255,.15)">&#127897;</div>'
      + '<div style="font-size:10px;color:rgba(255,255,255,.6);text-align:center;padding:0 12px;max-width:100%">'+(epTitle||showName||'')+'</div></div>'
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

  // Guest card — id="pl-guest-card" so iTunes fetch can update artwork after render
  html += '<div class="pl-card" id="pl-guest-card">'
    + '<div class="gtop">'
    + '<div class="gav" id="pl-guest-av">'+gIni+'</div>'
    + '<div><div class="gname" id="pl-guest-name">'+(guest.name||showName||'Host')+'</div>'
    + '<div class="grole" id="pl-guest-role">'+gRole+'</div></div></div>'
    + '<div class="chips" id="pl-guest-chips">'
    + (guest.lean ? '<div class="lchip">'+guest.lean+'</div>' : '')
    + (guest.episodeCount ? '<div class="chip">'+guest.episodeCount+' prior episodes</div>' : '')
    + (guest.name ? '<div class="chip">High credibility</div>' : '')
    + '</div>'
    + '<div class="srow" id="pl-guest-links">'
    + (guest.twitter   ? '<a class="sl" href="https://x.com/'+guest.twitter+'" target="_blank" rel="noopener">\uD835\uDD4F @'+guest.twitter+'</a>' : '')
    + (guest.instagram ? '<a class="sl" href="https://instagram.com/'+guest.instagram+'" target="_blank" rel="noopener">&#128247; @'+guest.instagram+'</a>' : '')
    + (guest.linkedin  ? '<a class="sl" href="'+guest.linkedin+'" target="_blank" rel="noopener">in LinkedIn</a>' : '')
    + (guest.website   ? '<a class="sl" href="'+guest.website+'" target="_blank" rel="noopener">&#127760; '+guest.website.replace(/^https?:\/\//,'').split('/')[0]+'</a>' : '')
    + '<a class="sl sl-podlens" href="#">&#127897; PodLens profile</a>'
    + '</div></div>';

  // Build a rich ~90 second audio briefing script from the full analysis
  function buildBriefingScript(d) {
    var parts = [];
    var ep = d.episodeTitle || 'this episode';
    var show = d.showName || 'this podcast';
    var guest = d.guest && d.guest.name ? d.guest.name : null;

    // Opening
    parts.push('Before you listen — here\'s what you should know about ' + ep + (show ? ' from ' + show : '') + '.');

    // Guest
    if (guest) {
      var role = [d.guest.title, d.guest.organization].filter(Boolean).join(' at ');
      parts.push(guest + (role ? ', ' + role + ',' : '') + ' is the guest.');
    }

    // Summary
    if (d.summary) parts.push(d.summary);

    // Bias
    if (d.biasLabel && d.audioLean) {
      var lp = d.audioLean.leftPct, rp = d.audioLean.rightPct, cp = d.audioLean.centerPct;
      parts.push('The episode ' + d.biasLabel.toLowerCase() + ' — ' + lp + '% of the framing leans left, ' + cp + '% is balanced, and ' + rp + '% leans right.');
    }

    // Bias reason
    if (d.biasReason) parts.push(d.biasReason);

    // Top flags
    var flags = (d.flags || []).slice(0, 3);
    if (flags.length) {
      parts.push('A few things worth knowing: ' + flags.map(function(f) { return f.detail || f.title; }).join(' Also, '));
    }

    // Closing
    parts.push('That\'s your briefing. Now you know what to listen for.');

    return parts.join(' ').replace(/'/g, '\u2019').replace(/"/g, '');
  }

  var briefingScript = data.jobId === 'demo'
    ? 'Before you listen — here\'s what you should know about this episode. Jensen Huang, CEO of NVIDIA, joins Lex Fridman for a two-hour conversation on AI infrastructure, CUDA, and the future of computing. The episode leans slightly left — about 38% of the framing uses progressive regulatory language, while 21% pushes back with free-market arguments. Four moments specifically push the bias left: Jensen frames government oversight as necessary for AI safety, emphasizes the environmental cost of model training, and argues that big tech cannot self-regulate. Two moments push right: he defends free-market innovation and argues that export controls are counterproductive. Worth knowing — the host rarely challenged Jensen\u2019s self-reported market share figures, and there is no mention of NVIDIA\u2019s ongoing antitrust scrutiny. Three sponsor segments are editorially integrated rather than clearly separated. On host trust, Jensen scores 7.2 out of 10. If you want balance, look for perspectives on AI regulation costs and NVIDIA\u2019s market dominance risks. That\u2019s your briefing. Now you know what to listen for.'
    : buildBriefingScript(data);

  briefingScript = briefingScript.replace(/'/g, '\u2019').replace(/"/g, '&quot;');
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
    + '<span style="color:#378ADD">\u25cf '+segs.rp+'% right</span>'
    + '</div>'
    + '<div class="bverdict">'+(data.biasLabel||'Slight left lean')+'</div>'
    + (isPartial||data.jobId==='demo' ? '<div class="enote">Based on first 30 min \u00b7 updating as analysis continues</div>' : '')
    + '</div>';

  html += '</div>'; // end rc
  html += '</div>'; // end trow

  // ── 6-Dimension Intelligence Panel ───────────────────────────────────────
  if (data.dimensions) {
    var dim = data.dimensions;
    function _dimBar(score, colorHigh, colorLow) {
      var pct = Math.max(0, Math.min(100, score || 0));
      var color = pct >= 60 ? colorHigh : pct >= 35 ? '#d97706' : colorLow;
      return '<div style="flex:1;height:5px;background:#f0f0f0;border-radius:3px;overflow:hidden">'
        + '<div style="width:'+pct+'%;height:100%;background:'+color+';border-radius:3px;transition:width .4s"></div></div>';
    }
    var dims6 = [
      { key:'politicalLean',   label:'Political lean',     icon:'⚖️',  d: dim.politicalLean,   barFn: function(d){ var abs = Math.abs(d.score||0); return _dimBar(abs, '#e0352b', '#378ADD'); } },
      { key:'factualDensity',  label:'Factual density',    icon:'🔬',  d: dim.factualDensity,  barFn: function(d){ return _dimBar(d.score, '#16a34a', '#ea580c'); } },
      { key:'sourceDiversity', label:'Source diversity',   icon:'🌐',  d: dim.sourceDiversity, barFn: function(d){ return _dimBar(d.score, '#16a34a', '#ea580c'); } },
      { key:'framingPatterns', label:'Loaded language',    icon:'🗣️',  d: dim.framingPatterns, barFn: function(d){ return _dimBar(d.score, '#ea580c', '#16a34a'); } },
      { key:'hostCredibility', label:'Host credibility',   icon:'🎙️',  d: dim.hostCredibility, barFn: function(d){ return _dimBar(d.score, '#16a34a', '#ea580c'); } },
      { key:'omissionRisk',    label:'Omission risk',      icon:'🕳️',  d: dim.omissionRisk,    barFn: function(d){ return _dimBar(d.score, '#ea580c', '#16a34a'); } },
    ];
    html += '<div class="sec"><div class="seclbl">6-Dimension intelligence</div>';
    html += '<div style="display:flex;flex-direction:column;gap:10px">';
    dims6.forEach(function(row) {
      if (!row.d) return;
      var labelColor = row.d.label === 'High' || row.d.label === 'Heavy' ? '#ea580c'
        : row.d.label === 'Low' || row.d.label === 'Neutral' ? '#16a34a' : '#d97706';
      if (row.key === 'hostCredibility') labelColor = row.d.label === 'High' ? '#16a34a' : row.d.label === 'Low' ? '#ea580c' : '#d97706';
      if (row.key === 'omissionRisk') labelColor = row.d.label === 'High' ? '#ea580c' : row.d.label === 'Low' ? '#16a34a' : '#d97706';
      html += '<div style="padding:9px 0;border-bottom:0.5px solid #f0f0f0">'
        + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">'
        + '<span style="font-size:13px">' + row.icon + '</span>'
        + '<span style="font-size:12px;font-weight:600;color:#333;flex:1">' + row.label + '</span>'
        + '<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:8px;background:' + labelColor + '22;color:' + labelColor + '">' + (row.d.label||'') + '</span>'
        + '</div>'
        + '<div style="display:flex;align-items:center;gap:8px">'
        + row.barFn(row.d)
        + '</div>'
        + (showFull && row.d.note ? '<div style="font-size:10px;color:#999;margin-top:4px;font-style:italic">' + row.d.note + '</div>' : '')
        + '</div>';
    });
    html += '</div>'
      + (!showFull ? '<div class="upbar" style="margin-top:8px"><span class="uptxt">Dimension notes unlock with Starter Lens</span><button class="upbtn" onclick="showUpgrade()">Upgrade →</button></div>' : '')
      + '</div>';
  }

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
      + '<div class="upbar"><span class="uptxt">Citations unlock with Starter Lens</span><button class="upbtn" onclick="showUpgrade()">Upgrade \u2192</button></div>';
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
      + '<div class="upbar"><span class="uptxt">Full transcript unlocks with Pro Lens</span><button class="upbtn" onclick="showUpgrade()">Upgrade \u2192</button></div></div>';
  }

  // Deep report bar
  html += '<div class="drbar"><div style="flex:1">'
    + '<div class="drtitle">\uD83D\uDCC4 Deep Analysis Report</div>'
    + '<div class="drdesc">'
    + (o ? 'Claim-by-claim breakdown \u00b7 Narrative arc \u00b7 Missing voices \u00b7 Comparative bias \u00b7 <span style="color:#999">Downloadable PDF</span>'
         : c ? 'Bias summary \u00b7 Top findings \u00b7 Host trust breakdown \u00b7 <span style="color:#999">Downloadable PDF \u2014 upgrade to Operator for the full deep report</span>'
             : 'Full intelligence report available on Starter Lens and Pro Lens plans.')
    + '</div>'
    + (c ? '<div class="cdlrow"><span style="font-size:10px;color:#bbb">Your Starter Lens report is ready</span><button class="drsec" style="font-size:10px;padding:4px 10px" onclick="downloadReport()">Download</button></div>' : '')
    + '</div><div style="display:flex;gap:7px;align-items:center;flex-shrink:0">'
    + (o ? '<button class="drpri" onclick="downloadReport()">Download full report</button>'
         : c ? '<div class="drlocked">\uD83D\uDD12 Full report \u2014 Operator</div>'
             : '<div class="drlocked">\uD83D\uDD12 Starter Lens or above</div>')
    + '</div></div>';

  html += '</div></div>'; // end pl-main + pl-results-wrap

  document.getElementById('results').innerHTML = html;
  var emptyState = document.getElementById('empty-state');
  if (emptyState) emptyState.style.display = 'none';

  // Populate transcript highlights tab
  renderTranscriptHighlights(data);

  _arShowDock(data);

  if (data.url && /\.(mp3|m4a|ogg|wav|aac)/i.test(data.url)) {
    setTimeout(function() { _arInitNativeAudio(data.url, data); }, 100);
  }

  // iTunes fetch — populates artwork AND guest card when API returns no guest data
  var q = showName || epTitle;
  if (q && data.jobId !== 'demo') {
    fetch('https://itunes.apple.com/search?term='+encodeURIComponent(q)+'&media=podcast&entity=podcast&limit=1', {signal:AbortSignal.timeout(5000)})
      .then(function(r){return r.json();})
      .then(function(d){
        var p = d.results && d.results[0];
        if (!p) return;
        var artUrl = (p.artworkUrl100||'').replace('100x100bb','600x600bb');
        var smallArtUrl = p.artworkUrl100 || '';
        var hostName = p.artistName || showName || '';
        var genre = p.primaryGenreName || 'Podcast';
        var trackCount = p.trackCount ? p.trackCount + ' episodes' : '';
        var appleUrl = p.artistViewUrl || p.collectionViewUrl || '';

        // Update left artwork (non-YouTube only)
        var leftArt = document.getElementById('v7-artwork-left');
        if (leftArt && artUrl && !vid) {
          leftArt.style.background = 'none';
          leftArt.style.padding = '0';
          leftArt.innerHTML = '<img src="'+artUrl+'" alt="" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:7px">';
        }

        // Update guest card if API returned no guest name
        if (!guest.name) {
          var ini = hostName.trim().split(' ').map(function(w){return w[0]||'';}).slice(0,2).join('').toUpperCase() || '?';
          var avEl   = document.getElementById('pl-guest-av');
          var nameEl = document.getElementById('pl-guest-name');
          var roleEl = document.getElementById('pl-guest-role');
          var chipsEl = document.getElementById('pl-guest-chips');
          var linksEl = document.getElementById('pl-guest-links');
          if (avEl) {
            if (smallArtUrl) {
              avEl.innerHTML = '<img src="'+smallArtUrl+'" style="width:38px;height:38px;border-radius:50%;object-fit:cover" onerror="this.parentNode.textContent=\''+ini+'\'">';
              avEl.style.cssText = 'width:38px;height:38px;border-radius:50%;overflow:hidden;flex-shrink:0;background:none;padding:0';
            } else {
              avEl.textContent = ini;
            }
          }
          if (nameEl) nameEl.textContent = hostName || showName || 'Host';
          if (roleEl) roleEl.textContent = 'Host \u00b7 ' + genre;
          if (chipsEl) chipsEl.innerHTML = trackCount ? '<div class="lchip">'+trackCount+'</div>' : '';
          if (linksEl) linksEl.innerHTML =
            (appleUrl ? '<a class="sl" href="'+appleUrl+'" target="_blank" rel="noopener">&#9654; Apple Podcasts</a>' : '')
            + '<a class="sl sl-podlens" href="#">&#127897; PodLens profile</a>';
        }
      }).catch(function(){});
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
  html += '<div class="sec"><div style="background:var(--amber-bg);border:0.5px solid #fde68a;border-radius:8px;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">'
    + '<div><div style="font-size:12px;color:#92580a">Analyzing \u2014 first findings appear in ~90 seconds</div>'
    + '<div style="font-size:10px;color:#b58a40;margin-top:2px">Play while you wait \u00b7 <strong style="color:#b45309">\u26A1 Analyzed once? Loads instantly next time</strong></div></div>'
    + '<div id="ar-eta-pct" style="font-size:10px;color:#b58a40">0% complete</div></div></div>';

  html += '<div class="trow"><div>';
  if (vid) {
    html += '<div class="artwork" style="aspect-ratio:16/9;position:relative">'
      + '<iframe src="https://www.youtube-nocookie.com/embed/'+vid+'?rel=0&modestbranding=1&enablejsapi=1" id="v7-yt-player"'
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

// ── TRANSCRIPT HIGHLIGHTS ─────────────────────────────────────────────────────
function renderTranscriptHighlights(data) {
  var el = document.getElementById('transcript-content');
  if (!el) return;

  var u = plUser();
  var isAdmin = u && (u.email === 'academekorea@gmail.com' || u.isSuperAdmin);
  var plan = u ? String(enforcePlanRules() || u.plan || 'free').toLowerCase() : (_previewTier || 'free');
  var isOperator = isAdmin || plan === 'operator' || plan === 'studio';
  var isCreator = isOperator || plan === 'creator' || plan === 'trial';

  var highlights = data.highlights || [];
  var segs = _biasSegs(data.biasScore);
  var biasLabel = data.biasLabel || 'Center';
  var biasReason = data.biasReason || '';

  var leftCount   = highlights.filter(function(h){ return h.lean === 'left'; }).length;
  var rightCount  = highlights.filter(function(h){ return h.lean === 'right'; }).length;
  var neutralCount= highlights.filter(function(h){ return h.lean === 'neutral'; }).length;

  // Verdict color
  var verdictBg = '#fde8e7', verdictColor = '#b83228';
  if (biasLabel.toLowerCase().indexOf('right') >= 0) { verdictBg = '#e6f1fb'; verdictColor = '#185fa5'; }
  if (biasLabel.toLowerCase() === 'center') { verdictBg = '#f5f5f3'; verdictColor = '#555'; }

  // Bias reason fallback
  if (!biasReason && highlights.length) {
    biasReason = leftCount + ' moment' + (leftCount!==1?'s':'') + ' pushed left, '
      + rightCount + ' pushed right, '
      + neutralCount + ' were neutral.';
  }

  // Split highlights: directional vs neutral
  var directional = highlights.filter(function(h){ return h.lean !== 'neutral'; });
  var neutral     = highlights.filter(function(h){ return h.lean === 'neutral'; });

  // Gate: free sees 2, creator sees 8, operator sees all
  var directionalLimit = isOperator ? directional.length : isCreator ? Math.min(6, directional.length) : Math.min(2, directional.length);
  var neutralLimit     = isOperator ? neutral.length     : isCreator ? Math.min(3, neutral.length)     : 0;

  function hlHTML(h, blurred) {
    var leanCls = h.lean === 'left' ? 'left' : h.lean === 'right' ? 'right' : 'neutral';
    var weightLabel = h.lean === 'left' ? '+left' : h.lean === 'right' ? '+right' : 'neutral';
    var tagCls = h.lean === 'left' ? 'left' : h.lean === 'right' ? 'right' : 'neutral';
    // Parse "1:14:08" or "12:04" into seconds for seek
    var tsStr = h.timestamp || '';
    var tsSecs = 0;
    var tsParts = tsStr.split(':').map(Number);
    if (tsParts.length === 3) tsSecs = tsParts[0]*3600 + tsParts[1]*60 + tsParts[2];
    else if (tsParts.length === 2) tsSecs = tsParts[0]*60 + tsParts[1];
    var tsHtml = tsStr
      ? '<span class="th-time th-time-seek" onclick="thSeekTo('+tsSecs+')" title="Jump to this moment">⏱ ' + tsStr + '</span>'
      : '';
    return '<div class="th-hl' + (blurred ? ' th-blur' : '') + '">'
      + '<div class="th-bar ' + leanCls + '"></div>'
      + '<div class="th-body">'
      + '<div class="th-top">' + tsHtml
      + '<span class="th-weight ' + leanCls + '">' + weightLabel + '</span></div>'
      + '<div class="th-quote">\u201c' + (h.quote||'') + '\u201d</div>'
      + (h.reason ? '<div class="th-reason ' + leanCls + '">' + h.reason + '</div>' : '')
      + '<span class="th-tag ' + tagCls + '">' + (h.tag||'') + '</span>'
      + '</div></div>';
  }

  var html = '<div class="th-wrap">';

  // Bias receipt
  html += '<div class="th-bias-receipt">'
    + '<div class="th-br-top">'
    + '<span class="th-br-lbl">Why this episode leans the way it does</span>'
    + '<span class="th-br-verdict" style="background:' + verdictBg + ';color:' + verdictColor + '">' + biasLabel + '</span>'
    + '</div>'
    + '<div style="position:relative"><div class="bias-bar-wrap">'
    + '<div class="bias-seg-left" style="width:' + segs.lp + '%"></div>'
    + '<div class="bias-seg-center" style="width:' + segs.cp + '%"></div>'
    + '<div class="bias-seg-right" style="width:' + segs.rp + '%"></div>'
    + '<div class="bias-marker" style="left:' + segs.lp + '%"></div>'
    + '</div></div>'
    + '<div class="bpcts" style="margin-bottom:8px">'
    + '<span style="color:#e0352b">\u25cf ' + segs.lp + '% left</span>'
    + '<span style="color:#999">\u25aa ' + segs.cp + '% center</span>'
    + '<span style="color:#378ADD">\u25cf ' + segs.rp + '% right</span>'
    + '</div>'
    + '<div class="th-br-note">'
    + (biasReason ? biasReason : '')
    + '</div></div>';

  if (!highlights.length) {
    html += '<div style="font-size:12px;color:#bbb;padding:20px 0;text-align:center">Highlights available after analysis completes.</div>';
    html += '</div>';
    el.innerHTML = html;
    return;
  }

  // Search + legend
  html += '<div class="th-search-row">'
    + '<input class="th-search" type="text" placeholder="Search transcript highlights\u2026" oninput="thSearch(this.value)" />'
    + '<span class="th-count" id="th-count">' + highlights.length + ' highlights</span>'
    + '</div>'
    + '<div class="th-legend">'
    + '<div class="th-leg"><div class="th-leg-dot" style="background:#e0352b"></div>Pushed left</div>'
    + '<div class="th-leg"><div class="th-leg-dot" style="background:#3a7fd4"></div>Pushed right</div>'
    + '<div class="th-leg"><div class="th-leg-dot" style="background:#d1cfc9"></div>Neutral / context</div>'
    + '</div>';

  // Directional highlights
  if (directional.length) {
    html += '<div class="th-sec-lbl">Moments that shaped the bias score</div>'
      + '<div class="th-list" id="th-directional">';
    directional.slice(0, directionalLimit).forEach(function(h) { html += hlHTML(h, false); });
    // Blur locked ones
    var lockedDirectional = directional.slice(directionalLimit);
    lockedDirectional.forEach(function(h) { html += hlHTML(h, true); });
    if (!isOperator && lockedDirectional.length) {
      html += '<div class="th-gate">'
        + '<span class="th-gate-txt">' + lockedDirectional.length + ' more highlight' + (lockedDirectional.length!==1?'s':'') + ' \u2014 ' + (isCreator ? 'Operator' : 'Creator') + ' plan</span>'
        + '<button class="th-gate-btn" onclick="showUpgrade()">Upgrade \u2192</button>'
        + '</div>';
    }
    html += '</div>';
  }

  // Neutral highlights
  if (neutral.length && isCreator) {
    html += '<div class="th-sec-lbl">Neutral context &amp; factual moments</div>'
      + '<div class="th-list" id="th-neutral">';
    neutral.slice(0, neutralLimit).forEach(function(h) { html += hlHTML(h, false); });
    var lockedNeutral = neutral.slice(neutralLimit);
    lockedNeutral.forEach(function(h) { html += hlHTML(h, true); });
    if (!isOperator && lockedNeutral.length) {
      html += '<div class="th-gate">'
        + '<span class="th-gate-txt">' + lockedNeutral.length + ' more \u2014 Operator plan</span>'
        + '<button class="th-gate-btn" onclick="showUpgrade()">Upgrade \u2192</button>'
        + '</div>';
    }
    html += '</div>';
  } else if (neutral.length && !isCreator) {
    html += '<div class="th-sec-lbl">Neutral context &amp; factual moments</div>'
      + '<div class="th-list">'
      + '<div class="th-gate"><span class="th-gate-txt">Neutral moments \u2014 Creator plan</span>'
      + '<button class="th-gate-btn" onclick="showUpgrade()">Upgrade \u2192</button></div>'
      + '</div>';
  }

  html += '</div>'; // end th-wrap
  el.innerHTML = html;
}

// ── TIMESTAMP SEEK ────────────────────────────────────────────────────────────
// Works for YouTube iframe (postMessage) and native audio element
function thSeekTo(seconds) {
  // YouTube iframe seek via postMessage
  var iframe = document.querySelector('.artwork iframe, iframe[src*="youtube"]');
  if (iframe) {
    try {
      iframe.contentWindow.postMessage(
        JSON.stringify({ event: 'command', func: 'seekTo', args: [seconds, true] }),
        '*'
      );
      // Also enable JS API on the iframe src if not already
      if (iframe.src && iframe.src.indexOf('enablejsapi') < 0) {
        iframe.src = iframe.src + (iframe.src.indexOf('?') >= 0 ? '&' : '?') + 'enablejsapi=1';
      }
    } catch(e) {}
    return;
  }
  // Native audio seek
  var audio = document.getElementById('ar-native-audio');
  if (audio) {
    audio.currentTime = seconds;
    audio.play();
    return;
  }
  // Web Speech / no player — show toast
  plToast('Seek to ' + _fmtSecs(seconds) + ' — open the episode to use timestamps');
}

function _fmtSecs(s) {
  var h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
  if (h) return h+':'+(m<10?'0':'')+m+':'+(sec<10?'0':'')+sec;
  return m+':'+(sec<10?'0':'')+sec;
}

// Search filter
function thSearch(val) {
  var q = val.toLowerCase().trim();
  var rows = document.querySelectorAll('.th-hl:not(.th-blur)');
  var shown = 0;
  rows.forEach(function(row) {
    var text = row.textContent.toLowerCase();
    var match = !q || text.indexOf(q) >= 0;
    row.style.display = match ? '' : 'none';
    if (match) shown++;
  });
  var countEl = document.getElementById('th-count');
  if (countEl) countEl.textContent = shown + ' highlight' + (shown !== 1 ? 's' : '');
}
