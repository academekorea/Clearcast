// sidebar.js — Single source of truth for left sidebar navigation
// Used on / (dashboard) and /library
// Include: <script src="/sidebar.js" defer></script>
// Container: <div id="app-sidebar"></div>

(function () {
  'use strict';

  // ── Detect page ──────────────────────────────────────────────────────────────
  var path = window.location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
  var isLibrary = path === '/library';
  var isDashboard = !isLibrary; // / or /dashboard or /dashboard/*

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

    // ── Routing helpers based on page ──
    // Dashboard: Home sub-items call JS functions, library items link away
    // Library: Home sub-items link to dashboard, library items call JS functions

    function homeToggleAttrs() {
      return 'id="sb-home-toggle" data-sb="home-toggle"';
    }

    function homeSubItem(id, icon, label, badge) {
      var badgeHtml = badge ? '<span class="sb-badge">' + badge + '</span>' : '';
      if (isDashboard) {
        return '<button class="sb-sub-btn" data-sb="' + id + '" onclick="showDashSection(\'' + id + '\')">' + icon + label + badgeHtml + '</button>';
      } else {
        return '<a href="/?section=' + id + '" class="sb-sub-btn" data-sb="' + id + '">' + icon + label + badgeHtml + '</a>';
      }
    }

    function topNavItem(id, icon, label) {
      if (isDashboard) {
        return '<button class="sb-btn" data-sb="' + id + '" onclick="showView(\'' + id + '\')">' + icon + label + '</button>';
      } else {
        var href = id === 'discover' ? '/discover' : '/';
        return '<a href="' + href + '" class="sb-btn" data-sb="' + id + '">' + icon + label + '</a>';
      }
    }

    function libLandingAttrs() {
      // Library is now an inline view in index.html — always use showView/switchTab
      if (isDashboard) {
        return 'class="sb-btn" data-sb="library" onclick="showView(\'library\')"';
      } else {
        return 'class="sb-btn" data-sb="library" onclick="switchTab(\'following\');window.sidebarSetActive(\'following\')"';
      }
    }

    function libSubItem(id, icon, label, suffix) {
      var suffixHtml = suffix || '';
      if (isDashboard) {
        return '<button class="sb-sub-btn" data-sb="' + id + '" onclick="showView(\'library\');setTimeout(function(){if(typeof switchTab===\'function\')switchTab(\'' + id + '\')},0)">' + icon + label + suffixHtml + '</button>';
      } else {
        return '<button class="sb-sub-btn" data-sb="' + id + '" onclick="switchTab(\'' + id + '\');window.sidebarSetActive(\'' + id + '\')">' + icon + label + suffixHtml + '</button>';
      }
    }

    function playlistsToggleAttrs() {
      return 'data-sb="playlists" id="sb-playlists-toggle"';
    }

    // ── Assemble HTML ──
    var html = '';

    // Menu section
    html += '<div class="sb-lbl">Menu</div>';

    // Home (toggle dropdown)
    html += '<button class="sb-btn" ' + homeToggleAttrs() + ' onclick="window._sbToggle(\'home\')">' + icons.home + 'Home<span class="sb-arrow open" id="sb-arr-home">\u203A</span></button>';
    html += '<div class="sb-sub open" id="sb-drop-home">';
    html += homeSubItem('intelligence', icons.intel, 'My intelligence', '');
    html += homeSubItem('queue', icons.queue, 'Smart queue', c.queued || '');
    html += '</div>';

    // Discover & Analyze
    html += topNavItem('discover', icons.discover, 'Discover');
    html += topNavItem('analyze', icons.analyze, 'Analyze');

    // Divider
    html += '<div class="sb-div"></div>';

    // My Library section
    html += '<div class="sb-lbl">My Library</div>';

    // My Library (landing)
    html += '<a ' + libLandingAttrs() + '>' + icons.library + 'My Library</a>';

    // Library sub-items
    html += libSubItem('following', icons.following, 'Following', '<span class="sb-count">' + (c.follows || '') + '</span>');
    html += libSubItem('liked', icons.liked, 'Liked episodes', '<span class="sb-count">' + (c.liked || '') + '</span>');

    // Playlists (toggle dropdown)
    if (isLibrary) {
      html += '<button class="sb-sub-btn" ' + playlistsToggleAttrs() + ' onclick="window._sbToggle(\'playlists\');switchTab(\'playlists\');window.sidebarSetActive(\'playlists\')">' + icons.playlists + 'Playlists<span class="sb-arrow" id="sb-arr-playlists">\u203A</span></button>';
      html += '<div class="sb-sub" id="sb-drop-playlists">';
      html += '<div id="sb-playlists-list" style="display:none"></div>';
      html += '<button class="sb-sub-btn sb-muted" onclick="switchTab(\'playlists\');window.sidebarSetActive(\'playlists\')">' + icons.newPlaylist + 'New playlist</button>';
      html += '</div>';
    } else {
      html += '<a href="/library#playlists" class="sb-sub-btn" data-sb="playlists">' + icons.playlists + 'Playlists</a>';
    }

    html += libSubItem('analyzed', icons.analyzed, 'Analyzed', '<span class="sb-count">' + (c.analyzed || '') + '</span>');
    html += libSubItem('downloads', icons.downloads, 'Downloads', '<span class="sb-soon">Soon</span>');

    // Bottom section: Account + Settings first, then Resources
    html += '<div class="sb-spacer" style="flex:1"></div>';
    html += '<div style="border-top:0.5px solid rgba(255,255,255,.08);padding-top:4px">';

    // Account
    if (isDashboard) {
      html += '<button class="sb-btn sb-bot" data-sb="account" onclick="showView(\'account\')"><svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>Account</button>';
      html += '<button class="sb-btn sb-bot" data-sb="settings" onclick="showView(\'settings\')"><svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>Settings</button>';
    } else {
      html += '<a class="sb-btn sb-bot" data-sb="account" href="/?view=account"><svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>Account</a>';
      html += '<a class="sb-btn sb-bot" data-sb="settings" href="/?view=settings"><svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>Settings</a>';
    }

    // Divider then Resources
    html += '<div class="sb-div"></div>';
    html += '<a class="sb-btn sb-bot" href="/methodology.html"><svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>Methodology</a>';
    html += '<a class="sb-btn sb-bot" href="/faq.html"><svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>FAQ</a>';
    html += '<a class="sb-btn sb-bot" href="/contact.html"><svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>Contact</a>';

    if (showBulk && isDashboard) {
      html += '<div class="sb-div"></div>';
      html += '<a class="sb-btn sb-bot" href="/bulk-scan.html"><svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>Bulk Scanner</a>';
    }

    html += '</div>';

    return html;
  }

  // ── Inject CSS ───────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('sb-styles')) return;
    var style = document.createElement('style');
    style.id = 'sb-styles';
    style.textContent = [
      '#app-sidebar{background:#0a1a20;display:flex;flex-direction:column;position:sticky;top:60px;height:calc(100vh - 60px);border-right:1px solid rgba(255,255,255,.07);min-width:220px;overflow:hidden}',
      '#app-sidebar > *:not(:last-child){overflow-y:auto}',
      '.sb-bot{font-size:11px!important;padding:6px 20px!important;color:rgba(255,255,255,.35)!important}',
      '.sb-bot:hover{color:rgba(255,255,255,.65)!important}',
      '.sb-bot.active{color:#fff!important;background:rgba(255,255,255,.08)!important}',
      '.sb-bot svg{width:11px!important;height:11px!important}',
      '#app-sidebar *{color:#fff}',
      '#app-sidebar a{text-decoration:none}',

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

      '.sb-arrow{margin-left:auto;font-size:11px;color:rgba(255,255,255,.2);transition:transform .15s;line-height:1}',
      '.sb-arrow.open{transform:rotate(90deg)}',

      '.sb-count{margin-left:auto;font-size:10px;color:rgba(255,255,255,.22)}',
      '.sb-badge{margin-left:auto;font-size:9px;background:rgba(55,138,221,.3);color:#378ADD;padding:1px 5px;border-radius:10px}',
      '.sb-soon{margin-left:auto;font-size:9px;background:rgba(255,255,255,.08);color:rgba(255,255,255,.3);padding:1px 5px;border-radius:10px}',
      '.sb-muted{color:rgba(255,255,255,.3);font-style:italic}',

      '@media(max-width:1100px){#app-sidebar{display:none}}',
    ].join('\n');
    document.head.appendChild(style);
  }

  // ── Toggle dropdown ──────────────────────────────────────────────────────────
  window._sbToggle = function (id) {
    var el = document.getElementById('sb-drop-' + id);
    var arr = document.getElementById('sb-arr-' + id);
    if (!el) return;
    var isOpen = el.classList.contains('open');
    el.classList.toggle('open', !isOpen);
    if (arr) arr.classList.toggle('open', !isOpen);
  };

  // ── Set active item ──────────────────────────────────────────────────────────
  // Called by each page after render: window.sidebarSetActive('following')
  window.sidebarSetActive = function (id) {
    var sidebar = document.getElementById('app-sidebar');
    if (!sidebar) return;
    sidebar.querySelectorAll('.sb-btn, .sb-sub-btn').forEach(function (b) {
      b.classList.remove('active');
    });
    // Activate the matching item
    var target = sidebar.querySelector('[data-sb="' + id + '"]');
    if (target) target.classList.add('active');

    // Keep parent button highlighted for sub-items
    var libraryItems = ['following', 'liked', 'playlists', 'analyzed', 'downloads'];
    if (libraryItems.indexOf(id) !== -1) {
      var libBtn = sidebar.querySelector('[data-sb="library"]');
      if (libBtn) libBtn.classList.add('active');
    }
    var homeItems = ['intelligence', 'queue'];
    if (homeItems.indexOf(id) !== -1) {
      var homeBtn = sidebar.querySelector('[data-sb="home-toggle"]');
      if (homeBtn) homeBtn.classList.add('active');
    }
  };

  // Called when navigating to account/settings view
  window.sidebarSetView = function(view) {
    window.sidebarSetActive(view);
  };

  // ── Update counts (callable from outside) ────────────────────────────────────
  window.sidebarUpdateCounts = function () {
    var c = getCounts();
    var sidebar = document.getElementById('app-sidebar');
    if (!sidebar) return;
    // Update count spans by finding the sb-count inside each sub-btn
    var map = { following: c.follows, analyzed: c.analyzed, liked: c.liked };
    Object.keys(map).forEach(function (id) {
      var btn = sidebar.querySelector('[data-sb="' + id + '"]');
      if (!btn) return;
      var span = btn.querySelector('.sb-count');
      if (span) span.textContent = map[id] || '';
    });
    // Queue badge
    var qBtn = sidebar.querySelector('[data-sb="queue"]');
    if (qBtn) {
      var badge = qBtn.querySelector('.sb-badge');
      if (badge) badge.textContent = c.queued || '';
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  function render() {
    var container = document.getElementById('app-sidebar');
    if (!container) return;
    injectStyles();
    container.innerHTML = buildSidebar();
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
