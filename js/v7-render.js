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

  // ── Freshness check (7-day flag) ─────────────────────────────────────────
  var _analyzedAt = data.firstAnalyzedAt || data.analyzedAt || data.cachedAt;
  var _daysSince = _analyzedAt ? Math.floor((Date.now() - _analyzedAt) / (1000*60*60*24)) : 0;
  var _isStale = _daysSince >= 7;

  var u = plUser();
  var isAdmin = u && (u.email === 'academekorea@gmail.com' || u.isSuperAdmin);

  var tier;
  if (!u) { tier = _previewTier || 'free'; }
  else if (isAdmin) { tier = 'operator'; }
  else {
    var plan = String(enforcePlanRules() || u.plan || 'free').toLowerCase();
    // Map plan keys to display tiers
    // studio = Operator Lens (full features), trial = operator during trial
    if (plan === 'studio' || plan === 'trial') tier = 'operator';
    else if (plan === 'operator') tier = 'operator';
    else if (plan === 'creator') tier = 'creator';
    else tier = 'free';
  }

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
    + '<div class="upbar"><span class="uptxt">All findings unlock with Starter Lens</span><button class="upbtn" onclick="showUpgrade()">Upgrade \u2192</button></div>';
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
  // Bias bar — 2nd visible item in left column (early signal)
  html += '<div class="pl-card" style="margin-top:10px" id="pl-bias-left">'
    + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">'
    + '<div class="lbl" style="margin-bottom:0">Political lean</div>'
    + '<div style="display:flex;align-items:center;gap:4px;font-size:10px;color:#d97706">'
    + '<div class="pdot"></div>'+(isPartial||data.jobId==='demo' ? 'Early signal' : 'Final')
    + '</div></div>'
    + '<div class="bverdict">'+(data.biasLabel||'Mostly balanced')
    + (data.biasDirection ? '<span style="font-size:10px;font-weight:400;opacity:.65;margin-left:6px">('+data.biasDirection+')</span>' : '')
    + '</div>'
    + '<div style="position:relative"><div class="bias-bar-wrap">'
    + '<div class="bias-seg-left" style="width:'+segs.lp+'%"></div>'
    + '<div class="bias-seg-center" style="width:'+segs.cp+'%"></div>'
    + '<div class="bias-seg-right" style="width:'+segs.rp+'%"></div>'
    + '</div></div>'
    + '<div class="bpcts">'
    + '<span style="color:#e0352b">&#9679; '+segs.lp+'% left</span>'
    + '<span style="color:#999">&#9642; '+segs.cp+'% center</span>'
    + '<span style="color:#378ADD">&#9679; '+segs.rp+'% right</span>'
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
    + (showName ? '<a class="sl sl-podlens" onclick="showView(\'show\');loadShowProfile(\''+_showSlug+'\',null,\''+showName.replace(/'/g,"\\'")+'\');return false" href="javascript:void(0)">&#127897; Show profile</a>' : '')
    + '</div></div>';

  // Build bias-intelligence-first audio briefing — tells listener what to watch for
  function buildBriefingScript(d) {
    var parts = [];
    var ep = d.episodeTitle || 'this episode';
    var show = d.showName || 'this podcast';
    var guest = d.guest && d.guest.name ? d.guest.name : null;
    var dim = d.dimensions || {};

    // Opening — what this brief is for
    parts.push('Before you press play — here is what Podlens found about ' + ep + (show ? ', from ' + show : '') + '.');

    // Bias verdict — the headline finding
    if (d.biasLabel && d.audioLean) {
      var lp = d.audioLean.leftPct, rp = d.audioLean.rightPct;
      var dir = lp > rp ? 'left' : rp > lp ? 'right' : 'balanced';
      var stronger = Math.max(lp, rp);
      if (stronger >= 40) {
        parts.push('This episode leans ' + dir + '. ' + stronger + ' percent of the framing pushes in one direction.');
      } else if (stronger >= 20) {
        parts.push('The episode has a mild ' + dir + ' lean. Most of it is balanced, but watch for one-sided framing.');
      } else {
        parts.push('The framing is mostly balanced across the political spectrum.');
      }
    }

    // Host credibility — should they trust the host
    if (dim.hostCredibility) {
      var hc = dim.hostCredibility;
      var hLabel = (hc.label || '').toLowerCase();
      if (hLabel === 'weak' || hLabel === 'low') {
        parts.push('Host credibility is low. The host rarely challenged the guest. Accept claims with caution and verify key statistics independently.');
      } else if (hLabel === 'moderate') {
        parts.push('The host pushes back sometimes but lets some significant claims pass unchallenged. Stay critical on the big numbers.');
      } else {
        parts.push('Host credibility is strong. The host holds the guest to evidential standards throughout.');
      }
    }

    // Omission risk — what the listener won't hear
    if (dim.omissionRisk) {
      var or = dim.omissionRisk;
      var orLabel = (or.label || '').toLowerCase();
      if (orLabel === 'high') {
        var ev = (or.evidence || [])[0];
        parts.push('Omission risk is high. Important context is missing from this episode.' + (ev ? ' Specifically: ' + ev : ''));
      } else if (orLabel === 'medium') {
        parts.push('Some relevant context is missing, but nothing that materially distorts the picture.');
      }
    }

    // Source diversity — is it one-sided sourcing
    if (dim.sourceDiversity) {
      var sd = dim.sourceDiversity;
      var sdLabel = (sd.label || '').toLowerCase();
      if (sdLabel === 'weak' || sdLabel === 'low') {
        parts.push('Source diversity is weak. This episode relies on a single perspective. You are hearing one side of a larger conversation.');
      }
    }

    // Top flags — specific things to watch for
    var flags = (d.flags || []).filter(function(f) {
      return f.type === 'fact-check' || f.type === 'omission' || f.type === 'framing';
    }).slice(0, 2);
    if (flags.length) {
      parts.push('Two things to watch for as you listen: ' + flags.map(function(f, i) {
        return (i === 0 ? 'First, ' : 'Second, ') + (f.detail || f.title || '');
      }).join(' '));
    }

    // Closing — actionable
    parts.push('Now you know what to listen for. Stay critical.');

    return parts.join(' ').replace(/'/g, '\u2019').replace(/"/g, '');
  }

  var _showSlug = showName ? showName.toLowerCase().split('').map(function(ch){return /[a-z0-9]/.test(ch)?ch:'-';}).join('').replace(/-+/g,'-') : '';
  var briefingScript = data.jobId === 'demo'
    ? 'Before you press play \u2014 here is what Podlens found about this episode with Jensen Huang from Lex Fridman Podcast. The episode has a mild left lean. About 38 percent of the framing uses progressive regulatory language, while 21 percent pushes back with free-market arguments. Host credibility is strong overall, but Lex Fridman rarely challenged Jensen\u2019s self-reported market share figures. Key stat: Jensen claimed over 80 percent of AI training compute \u2014 independent estimates put it at 65 to 70 percent. That was never questioned. Omission risk is high. NVIDIA\u2019s active antitrust scrutiny in the EU and US is never mentioned. The 40 billion dollar ARM acquisition failure is also absent, despite a full discussion of NVIDIA\u2019s strategic bets. Three sponsor segments are editorially integrated rather than clearly separated from content. Two things to watch for as you listen: First, when market share figures are cited, they are not sourced. Second, government regulation is framed as necessary without presenting the counterargument. Now you know what to listen for. Stay critical.'
    : buildBriefingScript(data);

  briefingScript = briefingScript.replace(/'/g, '\u2019').replace(/"/g, '&quot;');
  html += '<div class="pl-card">'
    + '<div class="lbl">Audio briefing \u00b7 Before you listen</div>'
    + '<div class="bdesc">'+(data.summary ? data.summary.substring(0,120)+(data.summary.length>120?'\u2026':'') : 'AI-narrated overview of bias, framing, and sponsor patterns.')+'</div>'
    + '<div style="display:flex;align-items:center;gap:8px">'
    + '<button class="bbtn" onclick="toggleAudioSummary(\''+(data.jobId||'demo')+'\',\''+briefingScript+'\')">\u25b6 Play briefing</button>'
    + (showFull ? '<span class="bdur">~2 min</span>' : '<span class="bdur" style="color:#bbb">10 sec preview</span>')
    + '</div></div>';

  // Bias card moved to left column (see above)

  html += '</div>'; // end rc
  html += '</div>'; // end trow

  // ── 6-Dimension Intelligence Panel ───────────────────────────────────────
  if (data.dimensions) {
    var dim = data.dimensions;
    var TAU6 = Math.PI * 2 * 26;

    function _ringColor(key, label, score) {
      if (key === 'hostCredibility') {
        return label === 'Strong' || label === 'High' ? '#639922' : label === 'Weak' || label === 'Low' ? '#D85A30' : '#EF9F27';
      }
      if (key === 'perspectiveBalance' || key === 'factualDensity' || key === 'sourceDiversity') {
        return (score||0) >= 60 ? '#639922' : (score||0) >= 35 ? '#EF9F27' : '#D85A30';
      }
      // framingPatterns, omissionRisk — high = bad
      return (score||0) >= 60 ? '#D85A30' : (score||0) >= 35 ? '#EF9F27' : '#639922';
    }

    function _ringVerdict(key, d) {
      var label = (d.label||'').toLowerCase();
      var s = d.score || 0;
      var map = {
        perspectiveBalance: {
          strong:'Multiple perspectives represented fairly.',
          moderate:'Some balance, but key views underrepresented.',
          weak:'Opposing views largely absent.'
        },
        factualDensity: {
          high:'Most claims are sourced or verifiable.',
          medium:'Mix of sourced and unsourced claims.',
          low:'Many unsourced assertions. Verify independently.'
        },
        sourceDiversity: {
          strong:'Multiple independent sources represented.',
          moderate:'Some source variety, but gaps remain.',
          weak:'Single viewpoint dominates.'
        },
        framingPatterns: {
          neutral:'Language is mostly neutral and informational.',
          'somewhat loaded':'Some advocacy framing detected.',
          'highly loaded':'Frequent emotionally charged language.'
        },
        hostCredibility: {
          strong:'Host actively challenges claims and cites sources.',
          high:'Host actively challenges claims and cites sources.',
          moderate:'Host sometimes pushes back, sometimes lets claims slide.',
          weak:'Host rarely challenges guest claims.',
          low:'Host rarely challenges guest claims.'
        },
        omissionRisk: {
          low:'No significant omissions detected.',
          medium:'Some relevant context missing.',
          high:'Important context notably absent.'
        }
      };
      var tier = map[key];
      if (!tier) return d.label || '';
      return tier[label] || d.label || '';
    }

    function _ringBadge(key, label) {
      var color, bg;
      var l = (label||'').toLowerCase();
      var good = l === 'strong' || l === 'high' || l === 'neutral' || l === 'low';
      var bad  = l === 'weak' || l === 'highly loaded' || (key === 'omissionRisk' && l === 'high') || (key === 'framingPatterns' && l === 'highly loaded');
      if (key === 'hostCredibility') { good = l === 'strong' || l === 'high'; bad = l === 'weak' || l === 'low'; }
      if (key === 'omissionRisk' || key === 'framingPatterns') { good = l === 'low' || l === 'neutral'; bad = l === 'high' || l === 'highly loaded'; }
      if (good) { color='#14532d'; bg='#f0fdf4'; }
      else if (bad) { color='#9a3412'; bg='#fff7ed'; }
      else { color='#92400e'; bg='#fffbeb'; }
      return '<span style="display:inline-block;font-size:10px;padding:2px 8px;border-radius:20px;font-weight:500;background:'+bg+';color:'+color+'">'+label+'</span>';
    }

    function _svgRing(score, color) {
      var offset = TAU6 - (Math.max(0,Math.min(100,score||0))/100)*TAU6;
      return '<svg width="68" height="68" viewBox="0 0 68 68" style="display:block">'
        +'<circle cx="34" cy="34" r="26" fill="none" stroke="#f0f0f0" stroke-width="5"/>'
        +'<circle cx="34" cy="34" r="26" fill="none" stroke="'+color+'" stroke-width="5"'
        +' stroke-linecap="round" stroke-dasharray="'+TAU6+'" stroke-dashoffset="'+offset+'"'
        +' transform="rotate(-90 34 34)"/>'
        +'</svg>';
    }

    var dims6 = [
      { key:'perspectiveBalance', label:'Perspective balance', d: dim.perspectiveBalance },
      { key:'factualDensity',     label:'Factual density',     d: dim.factualDensity     },
      { key:'sourceDiversity',    label:'Source diversity',    d: dim.sourceDiversity    },
      { key:'framingPatterns',    label:'Loaded language',     d: dim.framingPatterns    },
      { key:'hostCredibility',    label:'Host credibility',    d: dim.hostCredibility    },
      { key:'omissionRisk',       label:'Omission risk',       d: dim.omissionRisk       },
    ];

    html += '<div class="sec"><div class="seclbl">Credibility check'
      + (showFull ? '<span style="font-size:10px;color:#ccc;text-transform:none;letter-spacing:0;margin-left:4px">&middot; tap any card for evidence</span>' : '')
      + '</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:8px">';

    dims6.forEach(function(row, i) {
      if (!row.d) return;
      var color = _ringColor(row.key, row.d.label, row.d.score);
      var verdict = _ringVerdict(row.key, row.d);
      var badge = _ringBadge(row.key, row.d.label);
      var score = Math.round(row.d.score || 0);

      var evHtml = '';
      if (showFull && row.d.evidence && row.d.evidence.length) {
        evHtml = '<div class="v7-dim-ev" style="display:none;flex-direction:column;gap:5px;margin-top:10px;padding-top:10px;border-top:0.5px solid #f0f0f0">'
          + row.d.evidence.slice(0,2).map(function(ev){
              return '<div style="font-size:10px;color:#666;font-style:italic;padding:4px 8px;border-left:2px solid '+color+';line-height:1.5">&ldquo;'+ev+'&rdquo;</div>';
            }).join('')
          + '</div>';
      }

      html += '<div class="v7-dim-card" onclick="toggleDimCard(this)" style="background:var(--bg2);border:0.5px solid var(--border);border-radius:12px;padding:14px 10px;cursor:pointer;transition:border-color .15s;text-align:center">'
        + '<div style="position:relative;width:68px;height:68px;margin:0 auto 10px">'
        + _svgRing(score, color)
        + '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">'
        + '<span style="font-size:15px;font-weight:500;color:'+color+';line-height:1">'+score+'</span>'
        + '<span style="font-size:9px;color:var(--text3);margin-top:1px">/100</span>'
        + '</div></div>'
        + '<div style="font-size:11px;font-weight:500;color:var(--text);margin-bottom:3px">'+row.label+'</div>'
        + '<div style="font-size:10px;color:var(--text3);line-height:1.4;margin-bottom:6px">'+verdict+'</div>'
        + badge
        + evHtml
        + '</div>';
    });

    html += '</div>';

    if (!showFull) {
      html += '<div class="upbar"><span class="uptxt">Evidence unlocks with Starter Lens</span><button class="upbtn" onclick="showUpgrade()">Upgrade →</button></div>';
    }

    html += '</div>';
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

  // Unheard section — what was left out
  var unheardFlags = (data.flags || []).filter(function(f) { return f.type === 'omission'; });
  var unheardText = data.unheardSummary || (unheardFlags.length > 0
    ? unheardFlags.slice(0,2).map(function(f){ return f.detail || f.title || ''; }).join(' ')
    : null);
  if (unheardText || unheardFlags.length > 0) {
    var unheardCount = unheardFlags.length;
    var unheardTopics = unheardFlags.slice(0,3).map(function(f){ return f.title || ''; }).filter(Boolean).join(' \u00b7 ');
    html += '<div class="sec">'
      + '<div class="seclbl">Unheard <span style="font-size:10px;color:#ccc;text-transform:none;letter-spacing:0;margin-left:4px">\u00b7 what this episode left out</span></div>'
      + '<div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:8px;overflow:hidden">'
      + '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:0.5px solid var(--border)">'
      + '<div style="width:22px;height:22px;border-radius:4px;background:#fff1f0;display:flex;align-items:center;justify-content:center;flex-shrink:0">'
      + '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9a3412" stroke-width="2.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>'
      + '</div>'
      + '<div>'
      + '<div style="font-size:12px;font-weight:600;color:var(--text)">'+(unheardCount > 0 ? unheardCount + ' perspective'+(unheardCount!==1?'s':'')+' missing from this episode' : 'Perspectives missing from this episode')+'</div>'
      + (unheardTopics ? '<div style="font-size:10px;color:var(--text3);margin-top:2px">'+unheardTopics+'</div>' : '')
      + '</div></div>'
      + '<div style="padding:10px 12px 10px 15px;border-left:3px solid #e24b4a;font-size:11px;color:var(--text2);line-height:1.6">'+(unheardText||'Important context was absent from this episode.')+'</div>'
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

  // Source citations (Pro Lens+)
  html += '<div class="sec"><div class="seclbl">Source citations</div>';
  if (o && cits.length) {
    html += '<div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:8px;overflow:hidden">'
      + cits.map(function(x,i){ return '<div class="cit"><div class="cnum">'+(i+1)+'</div><div><div class="ctitle2">'+x.t+'</div>'+(x.s?'<div class="csrc">'+x.s+'</div>':'')+'</div></div>'; }).join('')
      + '</div>';
  } else if (o) {
    html += '<div style="font-size:11px;color:#bbb;padding:6px 0">No citations detected in this episode.</div>';
  } else {
    html += '<div class="blur-r"><div class="btext"></div><span class="lock">\uD83D\uDD12</span></div>'
      + '<div class="upbar"><span class="uptxt">Source citations unlock with Pro Lens</span><button class="upbtn" onclick="showUpgrade()">Upgrade \u2192</button></div>';
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

  // Freshness flag — quiet note if analysis is 7+ days old
  if (_isStale) {
    html += '<div style="background:var(--bg3);border:0.5px solid var(--border2);border-radius:6px;padding:10px 14px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:12px">'
      + '<div style="flex:1">'
      + '<div style="font-size:11px;font-weight:600;color:var(--text2);margin-bottom:2px">Analysis from ' + _daysSince + ' days ago</div>'
      + '<div style="font-size:11px;color:var(--text3);line-height:1.4">Some details may have changed since this was analyzed. Re-analyzing is free.</div>'
      + '</div>'
      + '<button onclick="reRunAnalysis()" style="flex-shrink:0;padding:6px 12px;background:var(--navy);color:#fff;border:none;border-radius:var(--r);font-size:11px;font-weight:600;cursor:pointer;font-family:var(--ff)">Re-analyze free →</button>'
      + '</div>';
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
         : c ? '<div class="drlocked">\uD83D\uDD12 Full report \u2014 Pro Lens</div>'
             : '<div class="drlocked">\uD83D\uDD12 Starter Lens or above</div>')
    + '</div></div>';

  html += '</div></div>'; // end pl-main + pl-results-wrap

  document.getElementById('results').innerHTML = html;

  // Show share bar after results render
  (function() {
    var bar = document.getElementById('results-share-bar');
    var lbl = document.getElementById('results-share-label');
    if (bar) {
      bar.style.display = 'flex';
      if (lbl) lbl.textContent = (data.showName || '') + (data.episodeTitle ? ' — ' + (data.episodeTitle).substring(0, 60) : '');
    }
  })();
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
    fetch('https://itunes.apple.com/search?term='+encodeURIComponent(q)+'&media=podcast&entity=podcast&limit=5', {signal:AbortSignal.timeout(5000)})
      .then(function(r){return r.json();})
      .then(function(d){
        var results = d.results || [];
        if (!results.length) return;
        // Find best match — prefer exact or substring match on show name
        var qLower = q.toLowerCase();
        var p = results.find(function(r) {
          var name = (r.collectionName || '').toLowerCase();
          return name === qLower || name.indexOf(qLower) >= 0 || qLower.indexOf(name) >= 0;
        }) || (showName ? null : results[0]);
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
            + (showName ? '<a class="sl sl-podlens" onclick="showView(\'show\');loadShowProfile(\''+_showSlug+'\',null,\''+showName.replace(/'/g,"\\'")+'\');return false" href="javascript:void(0)">&#127897; Show profile</a>' : '');
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
    + '<div><div style="font-size:12px;color:#92580a">Analyzing \u2014 findings appear shortly</div>'
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
  // Bias skeleton in left column (2nd item)
  html += '<div class="pl-card" style="margin-top:10px">'
    + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">'
    + '<div class="lbl" style="margin-bottom:0">Political lean</div>'
    + '<div style="font-size:10px;color:#d97706">Calculating\u2026</div></div>'
    + '<div style="height:7px;background:#f0f0f0;border-radius:4px;margin:6px 0 4px;animation:shimmer 1.5s infinite"></div>'
    + '<div style="font-size:10px;color:#bbb">Lean appears when analysis completes</div></div>';
  html += '</div>';

  html += '<div class="rc">'
    + '<div class="pl-card"><div class="gtop"><div class="gav" style="background:#e8e8e8;color:#bbb">&#127897;</div>'
    + '<div><div class="gname" style="color:#bbb">'+(_cleanShow||'Loading\u2026')+'</div>'
    + '<div class="grole" style="color:#ddd">Host</div></div></div></div>'
    + '<div class="pl-card"><div class="lbl">Audio briefing \u00b7 Before you listen</div>'
    + '<div class="bdesc" style="color:#bbb">Ready when analysis completes \u2014 play while you wait</div>'
    + '<button class="bbtn" style="margin-top:8px;opacity:.5;cursor:default" disabled>\u25b6 Play briefing</button></div>'
    + '</div>';

  html += '</div>'; // end trow

  html += '<div class="sec"><div class="seclbl">Worth knowing before you listen</div>'
    + '<div class="findings-wrap" style="padding:14px 12px;display:flex;align-items:center;gap:10px">'
    + '<div class="feed-spin" style="width:14px;height:14px;border-width:2px;margin:0;flex-shrink:0"></div>'
    + '<span style="font-size:11px;color:#bbb">Identifying key moments\u2026</span></div></div>';

  html += '</div></div>';
  document.getElementById('results').innerHTML = html;

  // Show share bar after results render
  (function() {
    var bar = document.getElementById('results-share-bar');
    var lbl = document.getElementById('results-share-label');
    if (bar) {
      bar.style.display = 'flex';
      if (lbl) lbl.textContent = (data.showName || '') + (data.episodeTitle ? ' — ' + (data.episodeTitle).substring(0, 60) : '');
    }
  })();

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
  var biasLabel = data.biasLabel || 'Mostly balanced';
  var biasDirection = data.biasDirection || data.biasLabel || '';
  var biasReason = data.biasReason || '';

  var leftCount   = highlights.filter(function(h){ return h.lean === 'left'; }).length;
  var rightCount  = highlights.filter(function(h){ return h.lean === 'right'; }).length;
  var neutralCount= highlights.filter(function(h){ return h.lean === 'neutral'; }).length;

  // Verdict color — use directional label for color, plain label for text
  var verdictBg = '#fde8e7', verdictColor = '#b83228';
  if (biasDirection.toLowerCase().indexOf('right') >= 0) { verdictBg = '#e6f1fb'; verdictColor = '#185fa5'; }
  if (biasDirection.toLowerCase() === 'center' || biasLabel === 'Mostly balanced') { verdictBg = '#f0fdf4'; verdictColor = '#15803d'; }

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
        + '<span class="th-gate-txt">' + lockedNeutral.length + ' more \u2014 Pro Lens</span>'
        + '<button class="th-gate-btn" onclick="showUpgrade()">Upgrade \u2192</button>'
        + '</div>';
    }
    html += '</div>';
  } else if (neutral.length && !isCreator) {
    html += '<div class="th-sec-lbl">Neutral context &amp; factual moments</div>'
      + '<div class="th-list">'
      + '<div class="th-gate"><span class="th-gate-txt">Neutral moments \u2014 Starter Lens</span>'
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
