// library-view.js — Library view embedded in index.html SPA
// Loaded via <script src="/library-view.js" defer></script>
// Initialized lazily when showView('library') is first called

(function () {
  'use strict';

  var _libInitialized = false;

  /* ── HELPERS ── */
  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function timeAgo(iso) {
    if (!iso) return '';
    var d = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (d < 60) return 'just now';
    if (d < 3600) return Math.floor(d / 60) + 'm ago';
    if (d < 86400) return Math.floor(d / 3600) + 'h ago';
    if (d < 604800) return Math.floor(d / 86400) + 'd ago';
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  function biasPillClass(leftPct, rightPct) {
    var diff = Math.abs((leftPct || 0) - (rightPct || 0));
    if (diff < 20) return 'balanced';
    var dir = (leftPct || 0) > (rightPct || 0) ? 'left' : 'right';
    if (diff < 40) return 'lightly-' + dir;
    return dir;
  }
  function biasPillLabel(leftPct, rightPct) {
    var diff = Math.abs((leftPct || 0) - (rightPct || 0));
    if (diff < 20) return 'Mostly Balanced';
    var dir = (leftPct || 0) > (rightPct || 0) ? 'Left-Leaning' : 'Right-Leaning';
    if (diff < 40) return 'Lightly ' + dir;
    if (diff < 60) return dir;
    return 'Strongly ' + dir;
  }
  function biasFromEp(ep) { return biasPillLabel(ep.leftPct, ep.rightPct); }
  function biasCls(ep) { return biasPillClass(ep.leftPct, ep.rightPct); }
  function artHtml(src, name, cls) {
    var initial = (name || 'P').charAt(0).toUpperCase();
    var phCls = cls.replace('-', '-ph');
    if (src) {
      return '<img class="' + cls + '" src="' + esc(src) + '" alt="" loading="lazy" onerror="this.outerHTML=\'<div class=&quot;' + phCls + '&quot;>' + initial + '</div>\'">';
    }
    return '<div class="' + phCls + '">' + initial + '</div>';
  }

  /* ── DATA ── */
  var u, follows, analyses, activeTab, searchQuery;

  function refreshUser() {
    try { u = JSON.parse(localStorage.getItem('pl-user') || 'null'); } catch (e) { u = null; }
  }

  function getPlanLimits() {
    if (!u) return { max: 3, label: 'week', unlimited: false };
    var plan = u.plan || 'free';
    if (plan === 'trial') return { max: 30, label: 'trial', unlimited: false };
    if (plan === 'creator') return { max: 25, label: 'week', unlimited: false };
    if (plan === 'operator') return { max: 100, label: 'week', unlimited: false };
    if (plan === 'studio') return { max: 0, label: '', unlimited: true };
    return { max: 3, label: 'week', unlimited: false };
  }

  /* ── LOAD DATA ── */
  function loadData() {
    refreshUser();
    if (!u) {
      console.warn('[library-view] No user found in pl-user');
      // Still render empty states
      follows = [];
      analyses = [];
      renderAll();
      return;
    }
    follows = [];
    analyses = [];
    activeTab = activeTab || 'library';
    searchQuery = '';
    try {
      follows = (u.followedShows || []).slice();
      analyses = (u.analyzedEpisodes || []).slice().sort(function (a, b) {
        return new Date(b.analyzedAt || 0) - new Date(a.analyzedAt || 0);
      });
    } catch (e) { }
    var tcF = document.getElementById('tc-following');
    var tcA = document.getElementById('tc-analyzed');
    if (tcF) tcF.textContent = follows.length;
    if (tcA) tcA.textContent = analyses.length;
    if (window.sidebarUpdateCounts) window.sidebarUpdateCounts();
    renderAll();
  }

  /* ── RENDER ── */
  function renderAll() {
    renderLibraryOverview();
    renderFollowing();
    renderLiked();
    renderPlaylists();
    renderAnalyzed();
  }

  function applySearch(arr, fields) {
    if (!searchQuery) return arr;
    var q = searchQuery.toLowerCase();
    return arr.filter(function (item) {
      return fields.some(function (f) { return (item[f] || '').toLowerCase().includes(q); });
    });
  }

  /* Library overview */
  function renderLibraryOverview() {
    var el = document.getElementById('library-overview-content');
    if (!el) { console.warn('[library-view] library-overview-content not found'); return; }
    try { _renderLibraryOverviewInner(el); } catch(e) {
      console.error('[library-view] renderLibraryOverview error:', e);
      el.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text3)"><div style="font-size:32px;margin-bottom:12px">📚</div><div style="font-size:15px;font-weight:500;color:var(--text);margin-bottom:6px">Your Library</div><div style="font-size:13px">Follow shows and analyze episodes to build your library.</div></div>';
    }
  }
  function _renderLibraryOverviewInner(el) {
    var fp = (typeof calcBiasFingerprint === 'function') ? calcBiasFingerprint(analyses || []) : null;
    var eco = (typeof calcEchoChamber === 'function') ? calcEchoChamber(analyses || []) : null;
    var mostBiased = '', mostBiasedLean = '', mostBiasedCls = '';
    if (follows.length) {
      follows.forEach(function(s) {
        var b = s.bias || {};
        var l = b.l || b.leftPct || 0;
        var r = b.r || b.rightPct || 0;
        if (!mostBiased || Math.abs(l - r) > 20) {
          mostBiased = s.name || '';
          mostBiasedLean = l > r ? 'Leans left' : r > l ? 'Leans right' : 'Center';
          mostBiasedCls = l > r ? 'bias-pill left' : r > l ? 'bias-pill right' : 'bias-pill balanced';
        }
      });
    }
    var fpL = fp ? fp.leftPct : 0, fpC = fp ? fp.centerPct : 100, fpR = fp ? fp.rightPct : 0;
    var ecoScore = eco && eco.hasData ? eco.score : null;
    var ecoLabel = eco && eco.hasData ? eco.label : null;
    var ecoColor = eco && eco.hasData ? eco.color : 'var(--text3)';
    var html = '';

    // ── Recently liked shows (horizontal chips) ──
    var liked = [];
    try { liked = JSON.parse(localStorage.getItem('pl_liked_episodes') || '[]'); } catch(e) {}
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">';
    html += '<span style="font-size:13px;font-weight:500;color:var(--text)">Recently liked shows</span>';
    html += '<button onclick="switchTab(\'liked\')" style="font-size:11px;color:var(--text3);background:none;border:none;cursor:pointer;font-family:var(--ff)">See all \u2192</button>';
    html += '</div>';
    html += '<div style="display:flex;gap:7px;overflow-x:auto;padding-bottom:3px;margin-bottom:12px;scrollbar-width:none">';
    // Show chips from liked episodes (dedupe by show name)
    var seenShows = {};
    liked.forEach(function(ep) {
      var sn = ep.showName || '';
      if (!sn || seenShows[sn]) return;
      seenShows[sn] = true;
      var leanLabel = ep.biasLabel || biasFromEp(ep) || '';
      var leanCls = biasCls(ep);
      html += '<div style="display:flex;align-items:center;gap:6px;padding:5px 9px;background:var(--bg2);border:0.5px solid var(--border);border-radius:var(--r,8px);flex-shrink:0;cursor:pointer;min-width:120px">';
      html += artHtml(ep.artwork, sn, 'saved-art');
      html += '<div style="min-width:0"><div style="font-size:11px;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(sn)+'</div>';
      if (leanLabel) html += '<span class="bias-pill '+leanCls+'" style="font-size:8px;padding:1px 4px;margin-top:2px;display:inline-block">'+esc(leanLabel)+'</span>';
      html += '</div></div>';
    });
    // Dashed placeholder
    html += '<div style="display:flex;align-items:center;justify-content:center;padding:5px 9px;border:0.5px dashed var(--border2);border-radius:var(--r,8px);flex-shrink:0;min-width:64px;cursor:pointer">';
    html += '<div style="font-size:10px;color:var(--text3);text-align:center;line-height:1.4">\u2665 like a<br>show</div></div>';
    html += '</div>';

    // Divider
    html += '<div style="height:0.5px;background:var(--border);margin-bottom:13px"></div>';

    // ── Your followed shows ──
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">';
    html += '<span style="font-size:13px;font-weight:500;color:var(--text)">Your followed shows</span>';
    html += '<button onclick="switchTab(\'following\')" style="font-size:11px;color:var(--text3);background:none;border:none;cursor:pointer;font-family:var(--ff)">See all \u2192</button></div>';

    // Filter tabs (underline style with colored dots)
    var leftCount = 0, centerCount = 0, rightCount = 0;
    follows.forEach(function(s) {
      var b = s.bias || {}; var l = b.l||b.leftPct||0; var r = b.r||b.rightPct||0;
      var diff = Math.abs(l - r);
      if (diff < 20) centerCount++;
      else if (l > r) leftCount++;
      else rightCount++;
    });
    var filters = [
      {id:'all', label:'All', count:follows.length, dot:''},
      {id:'left', label:'Left', count:leftCount, dot:'#E24B4A'},
      {id:'center', label:'Center', count:centerCount, dot:'#D1CFC9'},
      {id:'right', label:'Right', count:rightCount, dot:'#378ADD'}
    ];
    html += '<div style="display:flex;gap:0;border-bottom:0.5px solid var(--border2);margin-bottom:12px">';
    filters.forEach(function(f, i) {
      var isOn = i === 0;
      html += '<button onclick="libFilterShows(\''+f.id+'\',this)" style="padding:5px 11px;font-size:11px;font-weight:500;border:none;background:none;cursor:pointer;color:'+(isOn?'var(--text)':'var(--text3)')+';border-bottom:2px solid '+(isOn?'#0f2027':'transparent')+';font-family:var(--ff);margin-bottom:-0.5px;display:flex;align-items:center;gap:4px;transition:color .12s">';
      if (f.dot) html += '<span style="width:6px;height:6px;border-radius:50%;background:'+f.dot+';flex-shrink:0"></span>';
      html += f.label+' <span style="font-size:9px;color:var(--text3);margin-left:2px">'+f.count+'</span>';
      html += '</button>';
    });
    html += '</div>';
    html += '<div id="lib-shows-grid">'+buildShowsGrid('all')+'</div>';
    if (analyses.length) {
      html += '<div style="display:flex;align-items:center;justify-content:space-between;margin:20px 0 10px">';
      html += '<div style="font-size:14px;font-weight:600;color:var(--text)">Recently analyzed</div>';
      html += '<button onclick="switchTab(\'analyzed\')" style="font-size:12px;color:var(--navy);background:none;border:none;cursor:pointer;font-family:var(--ff)">See all \u2192</button></div>';
      html += '<div style="display:flex;flex-direction:column;gap:6px">';
      analyses.slice(0,3).forEach(function(ep) {
        var pillCls = biasCls(ep); var pillLabel = ep.biasLabel || biasFromEp(ep);
        var viewUrl = ep.jobId ? '/?jobId='+ep.jobId : '#';
        html += '<div onclick="window.location=\''+esc(viewUrl)+'\'" style="display:flex;align-items:center;gap:10px;padding:9px 14px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);cursor:pointer;transition:border-color .1s" onmouseover="this.style.borderColor=\'var(--border2)\'" onmouseout="this.style.borderColor=\'var(--border)\'">';
        html += artHtml(ep.artwork, ep.showName, 'ep-art-sm');
        html += '<div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(ep.episodeTitle||'Episode')+'</div>';
        html += '<div style="font-size:10px;color:var(--text3);margin-top:1px">'+esc(ep.showName||'')+(ep.analyzedAt?' \u00b7 '+timeAgo(ep.analyzedAt):'')+'</div></div>';
        html += (pillLabel ? '<span class="bias-pill '+pillCls+'" style="font-size:10px">'+pillLabel+'</span>' : '');
        html += '</div>';
      });
      html += '</div>';
    }
    el.innerHTML = html;
  }

  window.libFilterShows = function(filter, btn) {
    if (btn && btn.parentElement) {
      btn.parentElement.querySelectorAll('button').forEach(function(b) {
        b.style.color = 'var(--text3)';
        b.style.borderBottomColor = 'transparent';
      });
      btn.style.color = 'var(--text)';
      btn.style.borderBottomColor = '#0f2027';
    }
    var grid = document.getElementById('lib-shows-grid');
    if (grid) grid.innerHTML = buildShowsGrid(filter);
  };

  function buildShowsGrid(filter) {
    var items = follows.filter(function(s) {
      if (filter === 'all') return true;
      var b = s.bias || {}; var l = b.l||b.leftPct||0; var r = b.r||b.rightPct||0; var diff = Math.abs(l-r);
      if (filter === 'center') return diff < 20;
      if (filter === 'left') return l > r && diff >= 20;
      if (filter === 'right') return r > l && diff >= 20;
      return true;
    });
    if (!items.length) return '<div style="text-align:center;padding:32px;color:var(--text3);font-size:13px">No shows in this category yet.</div>';
    var html = '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:14px">';
    items.forEach(function(s,i) {
      var b = s.bias||{}; var l = b.l||b.leftPct||0; var r = b.r||b.rightPct||0; var ctr = 100-l-r;
      var bLabel = biasPillLabel(l,r); var bCls = biasPillClass(l,r);
      var showName = s.name||s.showName||'';
      var showEps = analyses.filter(function(ep){ return (ep.showName||'').toLowerCase()===showName.toLowerCase(); });
      var analyzeUrl = s.feedUrl||s.youtubeUrl||'';
      html += '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:12px;transition:border-color .12s">';
      html += '<div style="display:flex;align-items:center;gap:9px;margin-bottom:9px">';
      html += artHtml(s.artwork,showName,'show-art-lg');
      html += '<div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(showName)+'</div>';
      html += '<div style="font-size:10px;color:var(--text3);margin-top:1px">'+esc(s.host||'')+(showEps.length?' \u00b7 '+showEps.length+' analyzed':'')+'</div></div>';
      html += '<span class="bias-pill '+bCls+'" style="font-size:9px">'+esc(bLabel)+'</span></div>';
      if (l||r) {
        html += '<div style="height:5px;border-radius:3px;overflow:hidden;display:flex;margin-bottom:3px"><div style="width:'+l+'%;background:#E24B4A"></div><div style="width:'+ctr+'%;background:var(--border2)"></div><div style="width:'+r+'%;background:#378ADD"></div></div>';
        html += '<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--text3);margin-bottom:8px"><span style="color:#E24B4A">'+l+'%</span><span>'+ctr+'% center</span><span style="color:#378ADD">'+r+'%</span></div>';
      }
      html += '<div style="display:flex;gap:5px">';
      if (analyzeUrl) html += '<button class="btn-analyze" onclick="event.stopPropagation();analyzeLatest(\''+esc(analyzeUrl)+'\',\''+esc(showName)+'\')">Analyze \u2192</button>';
      html += '</div></div>';
    });
    html += '</div>';
    return html;
  }

  /* Following — archive style */
  function renderFollowing() {
    var el = document.getElementById('following-content');
    if (!el) return;
    var items = applySearch(follows, ['name','host','latestEp']);
    if (!items.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">\uD83C\uDFA7</div>'
        + '<div class="empty-title">'+(follows.length?'No matching shows':"You haven't followed any shows yet")+'</div>'
        + '<div class="empty-sub">'+(follows.length?'Try a different search.':'Head to Discover to find podcasts to follow.')+'</div>'
        + (!follows.length?'<button onclick="showView(\'discover\')" class="btn-cta">Go to Discover \u2192</button>':'')
        + '</div>';
      return;
    }
    var plan = u?(u.plan||'free'):'free';
    var showSQ = ['creator','operator','studio','trial'].indexOf(plan) !== -1;
    var html = '<div class="archive-search-wrap"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input type="text" class="archive-search" placeholder="Search your followed shows\u2026" oninput="filterLib(this.value)"></div>';
    items.forEach(function(s,i) {
      var showName = s.name||s.showName||'';
      var showEps = analyses.filter(function(ep){ return (ep.showName||ep.show||'').toLowerCase()===showName.toLowerCase(); }).sort(function(a,b){ return new Date(b.analyzedAt||0)-new Date(a.analyzedAt||0); });
      var artEl = s.artwork
        ? '<img class="sah-art" src="'+esc(s.artwork)+'" alt="" loading="lazy" onerror="this.outerHTML=\'<div class=&quot;sah-art-ph&quot;>'+esc((showName||'P').charAt(0).toUpperCase())+'</div>\'">'
        : '<div class="sah-art-ph">'+esc((showName||'P').charAt(0).toUpperCase())+'</div>';
      var bias = s.bias||{};
      var bLabel = biasPillLabel(bias.l||bias.leftPct, bias.r||bias.rightPct);
      var bCls = biasPillClass(bias.l||bias.leftPct, bias.r||bias.rightPct);
      var trendBars = showEps.slice(0,6).reverse().map(function(ep) {
        var h = Math.max(20,Math.min(100,ep.credibilityScore||ep.hostTrustScore||55));
        var col = (ep.leftPct||0)>(ep.rightPct||0)?'var(--left)':(ep.rightPct||0)>(ep.leftPct||0)?'var(--right)':'var(--center)';
        return '<div class="sah-trend-bar" style="height:'+h+'%;background:'+col+';opacity:.7"></div>';
      }).join('');
      var sqHtml = showSQ?'<label class="sq-toggle" title="Smart Queue"><input type="checkbox" '+(s.smartQueue?'checked':'')+' onchange="toggleSmartQueue('+i+',this.checked)"><span class="sq-slider"></span></label>':'';
      var analyzeUrl = s.feedUrl||s.youtubeUrl||'';
      var hasEps = showEps.length>0;
      html += '<div class="show-archive-block">';
      html += '<div class="show-archive-hd'+(hasEps?' has-eps':'')+'">';
      html += artEl;
      html += '<div class="sah-info"><div class="sah-name">'+esc(showName)+'</div>';
      html += '<div class="sah-meta">'+(s.host?esc(s.host)+' \u00b7 ':'')+(hasEps?showEps.length+' analyzed':'No analyses yet')+'</div></div>';
      if (trendBars) html += '<div class="sah-trend">'+trendBars+'</div>';
      if (bLabel && (bias.l !== undefined || bias.leftPct !== undefined)) html += '<span class="bias-pill '+bCls+'">'+esc(bLabel)+'</span>';
      html += '<div class="sah-actions">'+sqHtml;
      if (analyzeUrl) html += '<button class="btn-analyze" onclick="analyzeLatest(\''+esc(analyzeUrl)+'\',\''+esc(showName)+'\')">Analyze \u2192</button>';
      html += '<button class="btn-unfollow" onclick="unfollowShow('+i+')">Unfollow</button>';
      html += '</div></div>';
      if (hasEps) {
        html += '<div class="archive-ep-list">';
        showEps.slice(0,3).forEach(function(ep,n) {
          var epCls = biasCls(ep); var epLbl = ep.biasLabel||biasFromEp(ep);
          var viewUrl = ep.jobId?'/?jobId='+ep.jobId:'#';
          html += '<div class="archive-ep" onclick="window.location=\''+esc(viewUrl)+'\'">';
          html += '<span class="aep-num">'+(n+1)+'</span>';
          html += '<span class="aep-title">'+esc(ep.episodeTitle||ep.title||'Episode')+'</span>';
          html += '<span class="bias-pill '+epCls+'" style="font-size:9px;padding:2px 6px;flex-shrink:0">'+esc(epLbl)+'</span>';
          html += '<span class="aep-date">'+esc(timeAgo(ep.analyzedAt))+'</span></div>';
        });
        if (showEps.length>3) html += '<button class="archive-show-more" onclick="switchTab(\'analyzed\')">+ '+(showEps.length-3)+' more analyzed episodes \u2014 see in Analyzed \u2192</button>';
        html += '</div>';
      } else {
        html += '<div class="archive-ep-list"><div class="archive-no-eps">No analyses yet \u2014 <button onclick="analyzeLatest(\''+esc(analyzeUrl)+'\',\''+esc(showName)+'\')" style="background:none;border:none;color:var(--navy);font-size:12px;cursor:pointer;font-family:var(--ff);padding:0;font-weight:500">analyze latest \u2192</button></div></div>';
      }
      html += '</div>';
    });
    el.innerHTML = html;
  }

  /* Analyzed */
  function renderAnalyzed() {
    var el = document.getElementById('analyzed-content');
    if (!el) return;
    var items = applySearch(analyses, ['episodeTitle','showName']);
    var lim = getPlanLimits();
    var used = u ? (u.analysesThisWeek||0) : 0;
    var umWrap = document.getElementById('usage-meter-wrap');
    if (umWrap) {
      if (!lim.unlimited) {
        var pct = Math.min(100,Math.round(used/lim.max*100));
        var fillCls = pct>=100?'red':pct>=80?'amber':'';
        umWrap.innerHTML = '<div class="usage-meter"><span class="usage-label">'+used+' of '+lim.max+' analyses this '+lim.label+'</span><div class="usage-track"><div class="usage-fill '+fillCls+'" style="width:'+pct+'%"></div></div><span class="usage-pct">'+pct+'%</span>'+(pct>=80?'<a href="/pricing.html" class="usage-upgrade">Upgrade \u2192</a>':'')+'</div>';
      } else {
        umWrap.innerHTML = '<div class="usage-meter"><span class="usage-label" style="color:var(--text3)">Unlimited analyses</span></div>';
      }
    }
    if (!items.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">\uD83D\uDCCA</div>'
        + '<div class="empty-title">'+(analyses.length?'No matching analyses':'No analyses yet')+'</div>'
        + '<div class="empty-sub">'+(analyses.length?'Try a different search.':'Analyze any podcast episode to see it here.')+'</div>'
        + (!analyses.length?'<button onclick="showView(\'analyze\')" class="btn-cta">Analyze an episode \u2192</button>':'')
        + '</div>';
      return;
    }
    var html = '<div class="history-col-hd"><span>Episode</span><span style="text-align:right">Date</span><span style="text-align:right">Lean</span><span style="text-align:right">Score</span></div>';
    html += items.map(function(ep) {
      var pillCls = biasCls(ep); var pillLabel = ep.biasLabel||biasFromEp(ep);
      var viewUrl = ep.jobId?'/?jobId='+ep.jobId:'#';
      var score = ep.credibilityScore||ep.hostTrustScore||'';
      return '<div class="history-row" onclick="window.location=\''+esc(viewUrl)+'\'">'
        + '<div class="hr-ep"><div class="hr-title">'+esc(ep.episodeTitle||'Episode')+'</div><div class="hr-show">'+esc(ep.showName||'')+'</div></div>'
        + '<div class="hr-date">'+esc(timeAgo(ep.analyzedAt))+'</div>'
        + '<div class="hr-lean">'+(pillLabel?'<span class="bias-pill '+pillCls+'" style="font-size:9px;padding:2px 6px">'+esc(pillLabel)+'</span>':'')+'</div>'
        + '<div class="hr-score">'+(score?esc(String(score)):'\u2014')+'</div></div>';
    }).join('');
    el.innerHTML = html;
  }

  /* Liked */
  var PL_LIKED_KEY = 'pl_liked_episodes';
  var PL_PLAYLISTS_KEY = 'pl_playlists';
  function getLiked() { try { return JSON.parse(localStorage.getItem(PL_LIKED_KEY)||'[]'); } catch(e){ return []; } }
  function getPlaylists() { try { return JSON.parse(localStorage.getItem(PL_PLAYLISTS_KEY)||'[]'); } catch(e){ return []; } }

  function renderLiked() {
    var el = document.getElementById('liked-content');
    if (!el) return;
    var liked = getLiked();
    var tc = document.getElementById('tc-liked');
    if (tc) tc.textContent = liked.length||0;
    if (!liked.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">\u2661</div><div class="empty-title">No liked episodes yet</div><div class="empty-sub">Tap the heart on any episode in Discover to save it here.</div></div>';
      return;
    }
    el.innerHTML = '<div class="saved-grid">'+liked.map(function(ep,i) {
      return '<div class="saved-card">'+artHtml(ep.artwork,ep.showName,'saved-art')
        + '<div class="saved-info"><div class="saved-show">'+esc(ep.showName||'')+'</div>'
        + '<div class="saved-title">'+esc(ep.title||'Episode')+'</div>'
        + '<div class="saved-card-actions">'
        + (ep.url?'<button class="btn-analyze" onclick="analyzeLatest(\''+esc(ep.url)+'\',\''+esc(ep.showName||'')+'\')">Analyze \u2192</button>':'')
        + '<button class="btn-remove" onclick="unlikeEp('+i+')">Unlike</button>'
        + '</div></div></div>';
    }).join('')+'</div>';
  }

  window.unlikeEp = function(i) {
    var liked = getLiked(); liked.splice(i,1);
    localStorage.setItem(PL_LIKED_KEY, JSON.stringify(liked));
    renderLiked();
  };

  /* Playlists */
  function renderPlaylists() {
    var el = document.getElementById('playlists-content');
    if (!el) return;
    var pls = getPlaylists();
    var tc = document.getElementById('tc-playlists');
    if (tc) tc.textContent = pls.length||0;
    var activePl = window._activePl != null ? window._activePl : -1;
    if (activePl >= 0 && pls[activePl]) {
      var pl = pls[activePl];
      el.innerHTML = '<button onclick="window._activePl=null;renderPlaylists()" style="background:none;border:none;cursor:pointer;font-size:13px;color:var(--text2);font-family:var(--ff);margin-bottom:16px;padding:0">\u2190 All playlists</button>'
        + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">'
        + '<div><div style="font-size:20px;font-weight:700;font-family:var(--ffs)">'+esc(pl.name)+'</div>'
        + '<div style="font-size:13px;color:var(--text3);margin-top:4px">'+pl.episodes.length+' episode'+(pl.episodes.length!==1?'s':'')+'</div></div>'
        + '<button onclick="deletePlaylist('+activePl+')" style="background:none;border:1px solid var(--border2);border-radius:6px;padding:6px 12px;cursor:pointer;font-size:12px;color:var(--text3);font-family:var(--ff)">Delete playlist</button></div>';
      if (!pl.episodes.length) {
        el.innerHTML += '<div style="color:var(--text3);font-size:13px;padding:24px 0">No episodes in this playlist yet.</div>';
      } else {
        el.innerHTML += '<div class="saved-grid">'+pl.episodes.map(function(ep,i){
          return '<div class="saved-card">'+artHtml(ep.artwork,ep.showName,'saved-art')
            + '<div class="saved-info"><div class="saved-show">'+esc(ep.showName||'')+'</div>'
            + '<div class="saved-title">'+esc(ep.title||'Episode')+'</div>'
            + '<div class="saved-card-actions">'
            + (ep.url?'<button class="btn-analyze" onclick="analyzeLatest(\''+esc(ep.url)+'\',\''+esc(ep.showName||'')+'\')">Analyze \u2192</button>':'')
            + '<button class="btn-remove" onclick="removeFromPlaylist('+activePl+','+i+')">Remove</button>'
            + '</div></div></div>';
        }).join('')+'</div>';
      }
      return;
    }
    if (!pls.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">\uD83C\uDFB5</div><div class="empty-title">No playlists yet</div><div class="empty-sub">Tap "Add to playlist" on any episode to create your first playlist.</div></div>';
      return;
    }
    el.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px">'
      + pls.map(function(pl,i){
        return '<div onclick="window._activePl='+i+';renderPlaylists()" style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;overflow:hidden;cursor:pointer">'
          + '<div style="width:100%;aspect-ratio:1;background:var(--navy);border-radius:8px 8px 0 0;display:flex;align-items:center;justify-content:center;font-size:28px">\uD83C\uDFB5</div>'
          + '<div style="padding:12px 14px"><div style="font-weight:600;font-size:14px">'+esc(pl.name)+'</div>'
          + '<div style="font-size:12px;color:var(--text3);margin-top:3px">'+pl.episodes.length+' episode'+(pl.episodes.length!==1?'s':'')+'</div></div></div>';
      }).join('')+'</div>';
  }

  window.deletePlaylist = function(i) { var pls=getPlaylists(); pls.splice(i,1); localStorage.setItem(PL_PLAYLISTS_KEY,JSON.stringify(pls)); window._activePl=null; renderPlaylists(); };
  window.removeFromPlaylist = function(pi,ei) { var pls=getPlaylists(); pls[pi].episodes.splice(ei,1); localStorage.setItem(PL_PLAYLISTS_KEY,JSON.stringify(pls)); renderPlaylists(); };

  /* Tab switching */
  window.switchTab = function(tab) {
    if (tab === 'library') renderLibraryOverview();
    activeTab = tab;
    document.querySelectorAll('#view-library .lib-panel').forEach(function(p) {
      p.classList.toggle('active', p.id === 'panel-' + tab);
    });
    if (window.sidebarSetActive) window.sidebarSetActive(tab);
  };

  window.filterLib = function(q) {
    searchQuery = q;
    if (activeTab==='following') renderFollowing();
    else if (activeTab==='liked') renderLiked();
    else if (activeTab==='playlists') { window._activePl=null; renderPlaylists(); }
    else if (activeTab==='analyzed') renderAnalyzed();
  };

  /* Actions */
  window.toggleSmartQueue = function(idx, val) {
    if (!u || !u.followedShows[idx]) return;
    u.followedShows[idx].smartQueue = val;
    localStorage.setItem('pl-user', JSON.stringify(u));
    follows = u.followedShows.slice();
  };

  window.unfollowShow = function(idx) {
    if (!follows[idx] || !confirm('Unfollow "' + (follows[idx].name||'this show') + '"?')) return;
    u.followedShows.splice(idx, 1);
    localStorage.setItem('pl-user', JSON.stringify(u));
    follows = u.followedShows.slice();
    renderFollowing();
    if (window.sidebarUpdateCounts) window.sidebarUpdateCounts();
  };

  window.analyzeLatest = window.analyzeLatest || function(url, showName) {
    window.location.href = '/?analyze=' + encodeURIComponent(url) + '&show=' + encodeURIComponent(showName || '');
  };

  /* ── Right sidebar — populate with real data when available ── */
  function renderLibRightSidebar() {
    var fp = (typeof calcBiasFingerprint === 'function') ? calcBiasFingerprint(analyses) : null;
    var eco = (typeof calcEchoChamber === 'function') ? calcEchoChamber(analyses) : null;

    // Bias bar
    var biasEl = document.getElementById('lib-rs-bias-content');
    if (biasEl && fp && fp.hasData) {
      biasEl.innerHTML = '<div style="height:6px;border-radius:3px;overflow:hidden;display:flex;margin-bottom:5px">'
        + '<div style="width:'+fp.leftPct+'%;background:#E24B4A"></div>'
        + '<div style="width:'+fp.centerPct+'%;background:#D1CFC9"></div>'
        + '<div style="width:'+fp.rightPct+'%;background:#378ADD"></div></div>'
        + '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text3)">'
        + '<span style="color:#E24B4A">'+fp.leftPct+'%</span>'
        + '<span>'+fp.centerPct+'% center</span>'
        + '<span style="color:#378ADD">'+fp.rightPct+'%</span></div>'
        + '<div style="font-size:10px;color:var(--text3);margin-top:4px">'+analyses.length+' episode'+(analyses.length!==1?'s':'')+' analyzed</div>';
    }

    // Echo chamber
    var echoEl = document.getElementById('lib-rs-echo-content');
    if (echoEl && eco && eco.hasData) {
      var barColor = eco.score <= 25 ? '#3B6D11' : eco.score <= 50 ? '#BA7517' : '#E24B4A';
      echoEl.innerHTML = '<div style="display:flex;align-items:baseline;gap:5px;margin-bottom:4px">'
        + '<span style="font-size:20px;font-weight:500;color:'+eco.color+'">'+eco.score+'</span>'
        + '<span style="font-size:10px;color:var(--text3)">/100</span></div>'
        + '<div style="height:6px;border-radius:3px;background:var(--bg3,#eee);overflow:hidden;margin-bottom:4px">'
        + '<div style="height:100%;width:'+eco.score+'%;background:'+barColor+';border-radius:3px"></div></div>'
        + '<div style="font-size:10px;font-weight:500;color:'+eco.color+'">'+eco.label+'</div>'
        + '<div style="font-size:10px;color:var(--text3);margin-top:2px">'+eco.description+'</div>';
    }
  }

  /* ── Public init — called by showView('library') ── */
  window.initLibraryView = function(tab) {
    console.log('[library-view] initLibraryView called, tab:', tab, 'initialized:', _libInitialized);
    loadData();
    renderLibRightSidebar();
    if (tab && document.getElementById('panel-' + tab)) {
      switchTab(tab);
    } else if (!_libInitialized) {
      switchTab('library');
    }
    _libInitialized = true;
  };
})();
