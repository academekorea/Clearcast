// sidebar.js — Single source of truth for left sidebar navigation
// Used on / (dashboard) and /library
// Include: <script src="/sidebar.js" defer></script>
// Container: <div id="app-sidebar"></div>

(function () {
  'use strict';

  // ── All views are in one SPA (index.html) — no page detection needed ──

  // ── User data helpers ────────────────────────────────────────────────────────
  function getUser() {
    try { return JSON.parse(localStorage.getItem('pl-user') || 'null'); } catch (e) { return null; }
  }

  function getCounts() {
    var u = getUser() || {};
    var follows = (u.followedShows || []).length;
    var analyzed = (u.analyzedEpisodes || []).length;
    var liked = 0;
    try { liked = JSON.parse(localStorage.getItem('pl-saved-episodes') || '[]').length; } catch (e) { /* */ }
    var queued = 0;
    try {
      var fs = u.followedShows || [];
      for (var i = 0; i < fs.length; i++) { if (fs[i].smartQueue) queued++; }
    } catch (e) { /* */ }
    return { follows: follows, analyzed: analyzed, liked: liked, queued: queued };
  }

  function getUserPlan() {
    var u = getUser();
    if (!u) return 'free';
    var plan = u.plan || 'free';
    if (plan === 'trial' && new Date() > new Date(u.trialEndsAt)) return 'free';
    return plan;
  }

  // ── SVG icons ────────────────────────────────────────────────────────────────
  var icons = {
    home:        '<svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    intel:       '<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    queue:       '<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>',
    discover:    '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    analyze:     '<svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
    library:     '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
    following:   '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78z"/></svg>',
    liked:       '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78z"/></svg>',
    playlists:   '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
    analyzed:    '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    downloads:   '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    newPlaylist: '<svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    bulk:        '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
    methodology: '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
    faq:         '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    contact:     '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    account:     '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    settings:    '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  };

  // ── Build HTML ───────────────────────────────────────────────────────────────
  function buildSidebar() {
    var c = getCounts();
    var plan = getUserPlan();
    var showBulk = plan === 'operator' || plan === 'studio';

    // ── Routing — all views are in one SPA ──

    function homeSubItem(id, icon, label, badge) {
      var badgeHtml = badge ? '<span class="sb-badge">' + badge + '</span>' : '';
      return '<button class="sb-sub-btn" data-sb="' + id + '" onclick="if(!plUser()){openModal(\'signup\');return}if(typeof showView===\'function\')showView(\'home\');if(typeof showDashSection===\'function\')showDashSection(\'' + id + '\')">' + icon + label + badgeHtml + '</button>';
    }

    function topNavItem(id, icon, label, authRequired) {
      var gate = authRequired ? 'if(!plUser()){openModal(\'signup\');return}' : '';
      return '<button class="sb-btn" data-sb="' + id + '" onclick="' + gate + 'if(typeof showView===\'function\')showView(\'' + id + '\')">' + icon + label + '</button>';
    }

    function libSubItem(id, icon, label, suffix) {
      var suffixHtml = suffix || '';
      return '<button class="sb-sub-btn" data-sb="' + id + '" onclick="if(!plUser()){openModal(\'signup\');return}window._pendingLibTab=\'' + id + '\';if(typeof showView===\'function\')showView(\'library\')">' + icon + label + suffixHtml + '</button>';
    }

    // ── Assemble HTML ──
    var html = '';

    // ── Top section (scrollable) ──
    html += '<div class="sb-top">';

    // Menu section
    html += '<div class="sb-lbl">Menu</div>';

    // Home (toggle dropdown + navigate to dashboard)
    html += '<button class="sb-btn" id="sb-home-toggle" data-sb="home-toggle" onclick="if(!plUser()){openModal(\'signup\');return}if(typeof showView===\'function\')showView(\'home\')">' + icons.home + 'Home<span class="sb-arrow" id="sb-arr-home" onclick="event.stopPropagation();if(!plUser()){openModal(\'signup\');return}window._sbToggle(\'home\')" style="padding:4px 6px;margin:-4px -6px;border-radius:3px">\u203A</span></button>';
    html += '<div class="sb-sub" id="sb-drop-home">';
    html += homeSubItem('intelligence', icons.intel, 'My intelligence', '');
    html += homeSubItem('queue', icons.queue, 'Smart queue', c.queued || '');
    html += '</div>';

    // Discover & Analyze
    html += topNavItem('discover', icons.discover, 'Discover', false);
    html += topNavItem('analyze', icons.analyze, 'Analyze', true);

    // Library (toggle dropdown + navigate, same pattern as Home)
    html += '<button class="sb-btn" id="sb-library-toggle" data-sb="library" onclick="if(!plUser()){openModal(\'signup\');return}window._pendingLibTab=\'library\';if(typeof showView===\'function\')showView(\'library\')">' + icons.library + 'Library<span class="sb-arrow" id="sb-arr-library" onclick="event.stopPropagation();if(!plUser()){openModal(\'signup\');return}window._sbToggle(\'library\')" style="padding:4px 6px;margin:-4px -6px;border-radius:3px">\u203A</span></button>';
    html += '<div class="sb-sub" id="sb-drop-library">';
    html += libSubItem('following', icons.following, 'Following', '<span class="sb-count">' + (c.follows || '') + '</span>');
    html += libSubItem('liked', icons.liked, 'Liked episodes', '<span class="sb-count">' + (c.liked || '') + '</span>');
    html += '<button class="sb-sub-btn" data-sb="playlists" onclick="window._pendingLibTab=\'playlists\';if(typeof showView===\'function\')showView(\'library\')">' + icons.playlists + 'Playlists</button>';
    html += libSubItem('analyzed', icons.analyzed, 'Analyzed', '<span class="sb-count">' + (c.analyzed || '') + '</span>');
    html += libSubItem('downloads', icons.downloads, 'Downloads', '<span class="sb-soon">Soon</span>');
    html += '</div>';

    html += '</div>'; // end .sb-top

    // ── Bottom section (pinned) — only rendered when there's content ──
    if (showBulk) {
      html += '<div class="sb-bottom">';
      html += '<a class="sb-btn sb-bot" href="/bulk-scan.html"><svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>Bulk Scanner</a>';
      html += '</div>';
    }

    return html;
  }

  // ── Inject CSS ───────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('sb-styles')) return;
    var style = document.createElement('style');
    style.id = 'sb-styles';
    style.textContent = [
      '#app-sidebar,#app-sidebar-lib,#app-sidebar-analyze,#app-sidebar-show,#app-sidebar-discover{background:#0a1a20;display:flex;flex-direction:column;position:sticky;top:60px;height:calc(100vh - 60px);border-right:1px solid rgba(255,255,255,.07);min-width:220px;overflow:hidden}',
      '.sb-top{flex:1;overflow-y:auto;padding:0}',
      '.sb-bottom{flex-shrink:0;padding:4px 0 8px;border-top:0.5px solid rgba(255,255,255,.08)}',
      '.sb-bot{font-size:11px!important;padding:6px 20px!important;color:rgba(255,255,255,.35)!important}',
      '.sb-bot:hover{color:rgba(255,255,255,.65)!important}',
      '.sb-bot.active{color:#fff!important;background:rgba(255,255,255,.08)!important}',
      '.sb-bot svg{width:11px!important;height:11px!important}',
      '#app-sidebar *,#app-sidebar-lib *,#app-sidebar-analyze *,#app-sidebar-show *,#app-sidebar-discover *{color:#fff}',
      '#app-sidebar a,#app-sidebar-lib a,#app-sidebar-analyze a,#app-sidebar-show a,#app-sidebar-discover a{text-decoration:none}',

      '.sb-lbl{padding:16px 20px 8px;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;opacity:.4}',

      '.sb-btn{display:flex;align-items:center;gap:10px;padding:10px 20px;font-size:13px;font-weight:500;border:none;background:transparent;width:100%;text-align:left;cursor:pointer;transition:background .1s;font-family:var(--ff,Inter,-apple-system,sans-serif);color:#fff}',
      '.sb-btn svg{width:15px;height:15px;flex-shrink:0}',
      '.sb-btn:hover{background:rgba(255,255,255,.07)}',
      '.sb-btn.active{background:rgba(255,255,255,.13)}',

      '.sb-div{height:0.5px;background:rgba(255,255,255,.1);margin:6px 20px}',

      '.sb-sub{display:none;flex-direction:column}',
      '.sb-sub.open{display:flex}',

      '.sb-sub-btn{display:flex;align-items:center;gap:8px;padding:7px 20px 7px 38px;font-size:12px;border:none;background:transparent;width:100%;text-align:left;cursor:pointer;color:rgba(255,255,255,.4);font-family:var(--ff,Inter,-apple-system,sans-serif);transition:background .12s,color .12s;text-decoration:none}',
      '.sb-sub-btn:hover{background:rgba(255,255,255,.05);color:rgba(255,255,255,.7)}',
      '.sb-sub-btn.active{color:rgba(255,255,255,.9);background:rgba(255,255,255,.07)}',

      '.sb-arrow{margin-left:auto;font-size:11px;color:rgba(255,255,255,.2);transition:transform .15s;line-height:1;cursor:pointer}',
      '.sb-arrow:hover{color:rgba(255,255,255,.6);background:rgba(255,255,255,.08)}',
      '.sb-arrow.open{transform:rotate(90deg)}',

      '.sb-count{margin-left:auto;font-size:10px;color:rgba(255,255,255,.22)}',
      '.sb-badge{margin-left:auto;font-size:9px;background:rgba(55,138,221,.3);color:#378ADD;padding:1px 5px;border-radius:10px}',
      '.sb-soon{margin-left:auto;font-size:9px;background:rgba(255,255,255,.08);color:rgba(255,255,255,.3);padding:1px 5px;border-radius:10px}',
      '.sb-muted{color:rgba(255,255,255,.3);font-style:italic}',

      '@media(max-width:1100px){#app-sidebar,#app-sidebar-lib,#app-sidebar-analyze,#app-sidebar-show,#app-sidebar-discover{display:none}}',
    ].join('\n');
    document.head.appendChild(style);
  }

  // ── Helper: get all sidebar containers ────────────────────────────────────────
  function getAllSidebars() {
    var result = [];
    ['app-sidebar', 'app-sidebar-lib', 'app-sidebar-analyze', 'app-sidebar-show', 'app-sidebar-discover'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) result.push(el);
    });
    return result;
  }

  // ── Toggle dropdown ──────────────────────────────────────────────────────────
  window._sbToggle = function (id) {
    // Toggle in both primary (sb-) and secondary (sb2-) sidebars
    ['sb-', 'sb2-', 'sb3-', 'sb4-'].forEach(function (prefix) {
      var el = document.getElementById(prefix + 'drop-' + id);
      var arr = document.getElementById(prefix + 'arr-' + id);
      if (!el) return;
      var isOpen = el.classList.contains('open');
      el.classList.toggle('open', !isOpen);
      if (arr) arr.classList.toggle('open', !isOpen);
    });
  };

  // ── Set active item ──────────────────────────────────────────────────────────
  // Called by each page after render: window.sidebarSetActive('following')
  window.sidebarSetActive = function (id) {
    getAllSidebars().forEach(function (sidebar) {
      sidebar.querySelectorAll('.sb-btn, .sb-sub-btn').forEach(function (b) {
        b.classList.remove('active');
      });
      var target = sidebar.querySelector('[data-sb="' + id + '"]');
      if (target) target.classList.add('active');
      var libraryItems = ['following', 'liked', 'playlists', 'analyzed', 'downloads'];
      if (libraryItems.indexOf(id) !== -1 || id === 'library') {
        var libBtn = sidebar.querySelector('[data-sb="library"]');
        if (libBtn) libBtn.classList.add('active');
        // Auto-open library dropdown
        var libDrop = sidebar.querySelector('[id$="drop-library"]');
        var libArr = sidebar.querySelector('[id$="arr-library"]');
        if (libDrop && !libDrop.classList.contains('open')) { libDrop.classList.add('open'); }
        if (libArr && !libArr.classList.contains('open')) { libArr.classList.add('open'); }
      }
      var homeItems = ['intelligence', 'queue'];
      if (homeItems.indexOf(id) !== -1) {
        var homeBtn = sidebar.querySelector('[data-sb="home-toggle"]');
        if (homeBtn) homeBtn.classList.add('active');
      }
    });
  };

  // Called when navigating to account/settings view
  window.sidebarSetView = function(view) {
    window.sidebarSetActive(view);
  };

  // ── Update counts (callable from outside) ────────────────────────────────────
  window.sidebarUpdateCounts = function () {
    var c = getCounts();
    var map = { following: c.follows, analyzed: c.analyzed, liked: c.liked };
    getAllSidebars().forEach(function (sidebar) {
      Object.keys(map).forEach(function (id) {
        var btn = sidebar.querySelector('[data-sb="' + id + '"]');
        if (!btn) return;
        var span = btn.querySelector('.sb-count');
        if (span) span.textContent = map[id] || '';
      });
      var qBtn = sidebar.querySelector('[data-sb="queue"]');
      if (qBtn) {
        var badge = qBtn.querySelector('.sb-badge');
        if (badge) badge.textContent = c.queued || '';
      }
    });
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  function render() {
    injectStyles();
    var html = buildSidebar();
    // Primary sidebar gets IDs as-is
    var primary = document.getElementById('app-sidebar');
    if (primary) primary.innerHTML = html;
    // Secondary sidebars get IDs prefixed to avoid duplicates
    var prefixMap = { 'app-sidebar-lib': 'sb2-', 'app-sidebar-analyze': 'sb3-', 'app-sidebar-show': 'sb4-', 'app-sidebar-discover': 'sb5-' };
    ['app-sidebar-lib', 'app-sidebar-analyze', 'app-sidebar-show', 'app-sidebar-discover'].forEach(function (containerId) {
      var el = document.getElementById(containerId);
      if (!el) return;
      var prefix = prefixMap[containerId] || 'sb2-';
      el.innerHTML = html.replace(/id="sb-/g, 'id="' + prefix);
    });

    // Append Categories section to discover sidebar
    var discoverEl = document.getElementById('app-sidebar-discover');
    if (discoverEl) {
      var sbTopDisc = discoverEl.querySelector('.sb-top');
      if (sbTopDisc) {
        var catSection = document.createElement('div');
        catSection.id = 'disc-nav-cat-section';
        catSection.innerHTML =
          '<div class="sb-div"></div>' +
          '<div class="sb-lbl">Categories</div>' +
          '<button class="disc-nav-cat on" onclick="discNavCat(\'all\',this)"><span class="disc-nav-cdot" style="background:#e0352b"></span>All</button>' +
          '<button class="disc-nav-cat" onclick="discNavCat(\'news\',this)"><span class="disc-nav-cdot" style="background:#e0352b"></span>News &amp; Politics</button>' +
          '<button class="disc-nav-cat" onclick="discNavCat(\'tech\',this)"><span class="disc-nav-cdot" style="background:#378ADD"></span>Technology</button>' +
          '<button class="disc-nav-cat" onclick="discNavCat(\'business\',this)"><span class="disc-nav-cdot" style="background:#22c55e"></span>Business</button>' +
          '<button class="disc-nav-cat" onclick="discNavCat(\'society\',this)"><span class="disc-nav-cdot" style="background:#a855f7"></span>Society</button>' +
          '<button class="disc-nav-cat" onclick="discNavCat(\'crime\',this)"><span class="disc-nav-cdot" style="background:#f59e0b"></span>True Crime</button>' +
          '<button class="disc-nav-cat" onclick="discNavCat(\'comedy\',this)"><span class="disc-nav-cdot" style="background:#ec4899"></span>Comedy</button>' +
          '<button class="disc-nav-cat" onclick="discNavCat(\'health\',this)"><span class="disc-nav-cdot" style="background:#14b8a6"></span>Health</button>' +
          '<button class="disc-nav-cat" onclick="discNavCat(\'sports\',this)"><span class="disc-nav-cdot" style="background:#f97316"></span>Sports</button>';
        sbTopDisc.appendChild(catSection);
      }
    }

    // Append Recent analyses section to analyze sidebar
    var analyzeEl = document.getElementById('app-sidebar-analyze');
    if (analyzeEl) {
      var sbTop = analyzeEl.querySelector('.sb-top');
      if (sbTop) {
        var recentSection = document.createElement('div');
        recentSection.innerHTML =
          '<div class="sb-div"></div>' +
          '<div class="sb-lbl">Recent</div>' +
          '<div id="analyze-nav-recent" style="padding:0 12px"></div>';
        sbTop.appendChild(recentSection);
      }
    }
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
