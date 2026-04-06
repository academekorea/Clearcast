/**
 * nav.js — Single source of truth for all Podlens navigation
 * Injects auth-aware links into #nav-links on every page.
 * Does NOT run on index.html (SPA manages its own nav).
 */
(function () {
  'use strict';

  function plUser() {
    try { return JSON.parse(localStorage.getItem('pl-user') || 'null'); } catch (e) { return null; }
  }

  function _esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function _initials(name) {
    var p = (name || 'U').trim().split(/\s+/);
    return p.length >= 2 ? (p[0][0] + p[p.length - 1][0]).toUpperCase() : (name || 'U').slice(0, 2).toUpperCase();
  }

  function _avatarColor(name) {
    var c = ['#1a3a5c', '#2d6a4f', '#6b3a3a', '#3a3a6b', '#5c4a1a', '#2d4a6a'];
    return c[(name || 'U').charCodeAt(0) % c.length];
  }

  function _showToast(msg) {
    var t = document.createElement('div');
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#0f2027;color:#fff;padding:10px 20px;border-radius:999px;font-size:13px;font-family:Inter,sans-serif;z-index:99999;pointer-events:none;white-space:nowrap;box-shadow:0 4px 16px rgba(0,0,0,.2)';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3000);
  }

  function injectCSS() {
    if (document.getElementById('pl-nav-css')) return;
    var s = document.createElement('style');
    s.id = 'pl-nav-css';
    s.textContent = [
      'nav{display:flex!important;align-items:center!important;width:100%!important}',
      '.nav-links{display:flex!important;align-items:center!important;gap:24px!important;margin-left:auto!important;flex-shrink:0!important}',
      '.pl-nav-link{padding:6px 12px;font-size:13px;color:var(--text2,#6B7280);border-radius:4px;text-decoration:none;background:none;border:none;cursor:pointer;font-family:Inter,-apple-system,sans-serif;font-weight:500;transition:color .12s,background .12s;white-space:nowrap}',
      '.pl-nav-link:hover{color:var(--text,#111);background:rgba(0,0,0,.05)}',
      '.pl-nav-link.active{color:var(--text,#111);font-weight:600;border-bottom:2px solid currentColor;padding-bottom:4px}',
      '.pl-nav-signin{background:#0f2027!important;color:#fff!important;border:none;border-radius:999px;padding:8px 20px;font-size:13px;font-weight:600;text-decoration:none!important;font-family:Inter,-apple-system,sans-serif;cursor:pointer;white-space:nowrap;transition:opacity .15s;margin-left:4px}',
      '.pl-nav-signin:hover{opacity:.85}',
      '.pl-nav-theme{background:none;border:none;cursor:pointer;font-size:16px;padding:6px;border-radius:8px;line-height:1;flex-shrink:0}',
      '.pl-nav-avatar-btn{background:none;border:none;cursor:pointer;padding:0;border-radius:50%;display:flex;align-items:center;flex-shrink:0}',
      '.pl-nav-avatar-img{width:32px;height:32px;border-radius:50%;object-fit:cover}',
      '.pl-nav-avatar-ini{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;font-family:Inter,sans-serif}',
      '.pl-nav-dd-wrap{position:relative;margin-left:4px}',
      '.pl-nav-dd{display:none;position:absolute;top:calc(100% + 8px);right:0;background:var(--bg,#fff);border:1px solid var(--border,#e0ddd8);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.12);min-width:210px;z-index:9999;overflow:hidden}',
      '.pl-nav-dd.open{display:block}',
      '.pl-nav-dd-head{padding:12px 16px;border-bottom:1px solid var(--border,#e0ddd8)}',
      '.pl-nav-dd-name{font-size:13px;font-weight:600;color:var(--text,#111);font-family:Inter,sans-serif}',
      '.pl-nav-dd-email{font-size:11px;color:var(--text3,#9CA3AF);margin-top:2px;font-family:Inter,sans-serif}',
      '.pl-nav-dd-item{display:block;padding:10px 16px;font-size:13px;color:var(--text,#111);text-decoration:none;font-family:Inter,sans-serif;transition:background .1s;cursor:pointer;width:100%;text-align:left;background:none;border:none;box-sizing:border-box;line-height:1.2}',
      '.pl-nav-dd-item:hover{background:var(--bg3,#F0EFE9)}',
      '.pl-nav-dd-div{height:1px;background:var(--border,#e0ddd8);margin:4px 0}',
    ].join('');
    document.head.appendChild(s);
  }

  function _isActivePath(href, currentPath) {
    if (href === '/discover') {
      return currentPath === '/' || currentPath === '/discover' || currentPath === '/index.html';
    }
    return currentPath === href || (href !== '/' && currentPath.includes(href.replace('.html', '')));
  }

  function _buildLoggedOut(navLinks, currentPath) {
    var links = [
      { label: 'Discover',     href: '/discover' },
      { label: 'How it works', href: '/how-it-works.html' },
      { label: 'Pricing',      href: '/pricing.html' },
    ];
    var html = links.map(function (lk) {
      var active = _isActivePath(lk.href, currentPath) ? ' active' : '';
      return '<a href="' + lk.href + '" class="pl-nav-link' + active + '">' + lk.label + '</a>';
    }).join('');
    html += '<a href="/" class="pl-nav-link pl-nav-signin" onclick="if(typeof openModal===\'function\'){openModal(\'login\');return false}">Sign in</a>';
    navLinks.innerHTML = html;
  }

  function _buildLoggedIn(navLinks, u, currentPath) {
    var displayName = (u.name || u.email || 'U').trim();
    var avatarUrl = u.avatar_custom_url || u.avatar_url || '';
    var isSuperAdmin = u.email === 'academekorea@gmail.com' || u.isSuperAdmin;

    var links = [
      { label: 'Discover',  href: '/discover' },
      { label: 'Library',   href: '/library.html' },
      { label: 'Dashboard', href: '/dashboard.html' },
    ];
    var linksHtml = links.map(function (lk) {
      var active = _isActivePath(lk.href, currentPath) ? ' active' : '';
      return '<a href="' + lk.href + '" class="pl-nav-link' + active + '">' + lk.label + '</a>';
    }).join('');

    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';

    var avatarInner = avatarUrl
      ? '<img class="pl-nav-avatar-img" src="' + _esc(avatarUrl) + '" alt="' + _esc(displayName) + '" onerror="this.style.display=\'none\'">'
      : '<div class="pl-nav-avatar-ini" style="background:' + _avatarColor(displayName) + '">' + _initials(displayName) + '</div>';

    var adminRow = isSuperAdmin
      ? '<a href="/account?tab=admin" class="pl-nav-dd-item" style="color:#dc2626;font-weight:600">🔴 Admin Panel</a><div class="pl-nav-dd-div"></div>'
      : '';

    var planBadge = u.plan
      ? ' <span style="font-size:9px;font-weight:700;text-transform:uppercase;background:var(--bg3,#F0EFE9);color:var(--text3,#999);padding:1px 5px;border-radius:2px;letter-spacing:.04em;margin-left:4px">' + u.plan + '</span>'
      : '';

    navLinks.innerHTML = linksHtml
      + '<button class="pl-nav-theme" id="pl-nav-theme-btn" aria-label="Toggle theme">' + (isDark ? '🌙' : '☀️') + '</button>'
      + '<div class="pl-nav-dd-wrap">'
      + '<button class="pl-nav-avatar-btn" id="pl-nav-avatar-btn" aria-label="Profile menu">' + avatarInner + '</button>'
      + '<div class="pl-nav-dd" id="pl-nav-dd">'
      + '<div class="pl-nav-dd-head">'
      + '<div class="pl-nav-dd-name">' + _esc(displayName) + planBadge + '</div>'
      + '<div class="pl-nav-dd-email">' + _esc(u.email || '') + '</div>'
      + '</div>'
      + adminRow
      + '<a href="/dashboard.html" class="pl-nav-dd-item">Dashboard</a>'
      + '<a href="/account?tab=profile" class="pl-nav-dd-item">View &amp; Edit Profile</a>'
      + '<a href="/account?tab=settings" class="pl-nav-dd-item">Settings</a>'
      + '<a href="/account?tab=billing" class="pl-nav-dd-item">Billing &amp; Plans</a>'
      + '<div class="pl-nav-dd-div"></div>'
      + '<button onclick="localStorage.removeItem(\'pl-user\');window.location.href=\'/\'" class="pl-nav-dd-item">Sign out</button>'
      + '</div>'
      + '</div>';

    // Theme toggle — calls page toggleMode() if defined, else does it inline
    var themeBtn = document.getElementById('pl-nav-theme-btn');
    if (themeBtn) {
      themeBtn.onclick = function () {
        if (typeof toggleMode === 'function') {
          toggleMode();
          var nowDark2 = document.documentElement.getAttribute('data-theme') === 'dark';
          themeBtn.textContent = nowDark2 ? '🌙' : '☀️';
        } else {
          var nowDark = document.documentElement.getAttribute('data-theme') === 'dark';
          document.documentElement.setAttribute('data-theme', nowDark ? 'light' : 'dark');
          themeBtn.textContent = nowDark ? '☀️' : '🌙';
          localStorage.setItem('pl-theme', nowDark ? 'light' : 'dark');
          localStorage.setItem('podlens-mode', nowDark ? 'light' : 'dark');
        }
      };
    }

    // Avatar dropdown toggle
    var avatarBtn = document.getElementById('pl-nav-avatar-btn');
    var dd = document.getElementById('pl-nav-dd');
    if (avatarBtn && dd) {
      avatarBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        dd.classList.toggle('open');
      });
      document.addEventListener('click', function () {
        if (dd) dd.classList.remove('open');
      });
    }
  }

  function initNav() {
    var navLinks = document.getElementById('nav-links');
    if (!navLinks) return;
    if (navLinks.dataset.plNavDone) return;
    navLinks.dataset.plNavDone = '1';

    injectCSS();

    var u = plUser();
    var currentPath = window.location.pathname;

    // Update logo href: logged-in → /dashboard, logged-out → /
    var logo = document.querySelector('nav > a:first-child');
    if (logo) logo.href = (u && u.id) ? '/dashboard.html' : '/';

    if (u && u.id) {
      _buildLoggedIn(navLinks, u, currentPath);
    } else {
      _buildLoggedOut(navLinks, currentPath);
    }

    // Show queued toast from auth redirects
    var msg = sessionStorage.getItem('pl-auth-toast');
    if (msg) {
      sessionStorage.removeItem('pl-auth-toast');
      setTimeout(function () { _showToast(msg); }, 300);
    }
  }

  // Auth gate helper — call from pages that require login
  window.plRequireAuth = function (context) {
    var u = plUser();
    if (!u || !u.id) {
      sessionStorage.setItem('pl-auth-toast', 'Sign in to access your ' + (context || 'account'));
      window.location.href = '/';
      return false;
    }
    return u;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNav);
  } else {
    initNav();
  }
})();
