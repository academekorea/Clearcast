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
    if (document.getElementById('nav-css')) return;
    var s = document.createElement('style');
    s.id = 'nav-css';
    s.textContent = [
      'nav{display:flex!important;align-items:center!important;width:100%!important}',
      '.nav-links{display:flex!important;align-items:center!important;gap:24px!important;margin-left:auto!important;flex-shrink:0!important}',
      '.nav-link{padding:6px 12px;font-size:13px;color:var(--text2,#6B7280);border-radius:4px;text-decoration:none;background:none;border:none;cursor:pointer;font-family:Inter,-apple-system,sans-serif;font-weight:500;transition:color .12s,background .12s;white-space:nowrap}',
      '.nav-link:hover{color:var(--text,#111);background:rgba(0,0,0,.05)}',
      '.nav-link.active{color:var(--text,#111);font-weight:600;border-bottom:2px solid currentColor;padding-bottom:4px}',
      '.nav-signin{background:#0f2027!important;color:#fff!important;border:none;border-radius:999px;padding:8px 20px;font-size:13px;font-weight:600;text-decoration:none!important;font-family:Inter,-apple-system,sans-serif;cursor:pointer;white-space:nowrap;transition:opacity .15s;margin-left:4px}',
      '.nav-signin:hover{opacity:.85}',
      '.nav-theme{background:none;border:none;cursor:pointer;font-size:16px;padding:6px;border-radius:8px;line-height:1;flex-shrink:0}',
      '.nav-avatar-btn{background:none;border:none;cursor:pointer;padding:0;border-radius:50%;display:flex;align-items:center;flex-shrink:0}',
      '.nav-avatar-img{width:32px;height:32px;border-radius:50%;object-fit:cover}',
      '.nav-avatar-ini{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;font-family:Inter,sans-serif}',
      '.nav-dd-wrap{position:relative;margin-left:4px}',
      '.nav-dd{display:none;position:absolute;top:calc(100% + 8px);right:0;background:var(--bg,#fff);border:1px solid var(--border,#e0ddd8);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.12);min-width:210px;z-index:9999;overflow:hidden}',
      '.nav-dd.open{display:block}',
      '.nav-dd-head{padding:12px 16px;border-bottom:1px solid var(--border,#e0ddd8)}',
      '.nav-dd-name{font-size:13px;font-weight:600;color:var(--text,#111);font-family:Inter,sans-serif}',
      '.nav-dd-email{font-size:11px;color:var(--text3,#9CA3AF);margin-top:2px;font-family:Inter,sans-serif}',
      '.nav-dd-item{display:block;padding:10px 16px;font-size:13px;color:var(--text,#111);text-decoration:none;font-family:Inter,sans-serif;transition:background .1s;cursor:pointer;width:100%;text-align:left;background:none;border:none;box-sizing:border-box;line-height:1.2}',
      '.nav-dd-item:hover{background:var(--bg3,#F0EFE9)}',
      '.nav-dd-div{height:1px;background:var(--border,#e0ddd8);margin:4px 0}',
    ].join('');
    document.head.appendChild(s);
  }

  function _isActive(href, path) {
    if (href === '/discover') {
      return path === '/discover' || path.startsWith('/discover');
    }
    return path === href || (href.length > 1 && path.includes(href.replace('.html', '')));
  }

  function _buildLoggedOut(navLinks, path) {
    navLinks.innerHTML =
      '<a href="/discover" class="nav-link' + (_isActive('/discover', path) ? ' active' : '') + '">Discover</a>'
      + '<a href="/how-it-works.html" class="nav-link' + (_isActive('/how-it-works.html', path) ? ' active' : '') + '">How it works</a>'
      + '<a href="/pricing.html" class="nav-link' + (_isActive('/pricing.html', path) ? ' active' : '') + '">Pricing</a>'
      + '<button class="nav-theme-toggle mode-toggle" onclick="if(typeof toggleMode===\'function\')toggleMode()" aria-label="Toggle dark/light mode" style="background:none;border:none;cursor:pointer;font-size:16px;padding:4px 6px">☀️</button>'
      + '<a href="/" class="nav-signin" onclick="if(typeof openModal===\'function\'){openModal(\'login\');return false}">Sign in / up</a>';
  }

  function _buildLoggedIn(navLinks, u, path) {
    var displayName = (u.name || u.email || 'U').trim();
    var avatarUrl = u.avatar_custom_url || u.avatar_url || '';
    var isSuperAdmin = u.email === 'academekorea@gmail.com' || u.isSuperAdmin;
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';

    var _personSvg = '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" aria-hidden="true"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/></svg>';
    var _ini = (displayName && displayName !== 'U') ? _initials(displayName) : null;
    var avatarInner = avatarUrl
      ? '<img class="nav-avatar-img" src="' + _esc(avatarUrl) + '" alt="' + _esc(displayName) + '" onerror="this.style.display=\'none\'">'
      : (_ini
          ? '<div class="nav-avatar-ini" style="background:' + _avatarColor(displayName) + '">' + _ini + '</div>'
          : '<div class="nav-avatar-ini" style="background:#6B7280;display:flex;align-items:center;justify-content:center;color:#fff">' + _personSvg + '</div>');

    var adminRow = isSuperAdmin
      ? '<a href="/account?tab=admin" class="nav-dd-item" style="color:#dc2626;font-weight:600">🔴 Admin Panel</a><div class="nav-dd-div"></div>'
      : '';

    var planBadge = u.plan
      ? ' <span style="font-size:9px;font-weight:700;text-transform:uppercase;background:var(--bg3,#F0EFE9);color:var(--text3,#999);padding:1px 5px;border-radius:2px;letter-spacing:.04em;margin-left:4px">' + u.plan + '</span>'
      : '';

    navLinks.innerHTML =
      '<a href="/" class="nav-link' + (_isActive('/', path) ? ' active' : '') + '" onclick="if(typeof showView===\'function\'){showView(\'discover\');return false}">Home</a>'
      + '<a href="/" class="nav-link" onclick="if(typeof showHome===\'function\'){showHome();return false}">Home</a>'
      + '<a href="/discover" class="nav-link' + (_isActive('/discover', path) ? ' active' : '') + '" onclick="if(typeof showView===\'function\'){showView(\'discover\');return false}">Discover</a>'
      + '<a href="/?view=analyze" class="nav-link' + (_isActive('/?view=analyze', path) ? ' active' : '') + '" onclick="if(typeof showView===\'function\'){showView(\'analyze\');return false}">Analyze</a>'
      + '<a href="/library.html" class="nav-link' + (_isActive('/library.html', path) ? ' active' : '') + '">Library</a>'
      + '<button class="nav-theme" id="nav-theme-btn" aria-label="Toggle theme">' + (isDark ? '🌙' : '☀️') + '</button>'
      + '<div class="nav-dd-wrap">'
      + '<button class="nav-avatar-btn" id="nav-avatar-btn" aria-label="Profile menu">' + avatarInner + '</button>'
      + '<div class="nav-dd" id="nav-dd">'
      + '<div class="nav-dd-head">'
      + '<div class="nav-dd-name">' + _esc(displayName) + planBadge + '</div>'
      + '<div class="nav-dd-email">' + _esc(u.email || '') + '</div>'
      + '</div>'
      + adminRow
      + '<a href="/profile.html" class="nav-dd-item">Profile settings</a>'
      + '<a href="/account.html" class="nav-dd-item">Account &amp; billing</a>'
      + '<div class="nav-dd-div"></div>'
      + '<button onclick="localStorage.removeItem(\'pl-user\');window.location.href=\'/\'" class="nav-dd-item">Sign out</button>'
      + '</div>'
      + '</div>';

    var themeBtn = document.getElementById('nav-theme-btn');
    if (themeBtn) {
      themeBtn.onclick = function () {
        if (typeof toggleMode === 'function') {
          toggleMode();
        } else {
          var dark = document.documentElement.getAttribute('data-theme') === 'dark';
          document.documentElement.setAttribute('data-theme', dark ? 'light' : 'dark');
          localStorage.setItem('pl-theme', dark ? 'light' : 'dark');
          localStorage.setItem('podlens-mode', dark ? 'light' : 'dark');
        }
        var nowDark = document.documentElement.getAttribute('data-theme') === 'dark';
        themeBtn.textContent = nowDark ? '🌙' : '☀️';
      };
    }

    var avatarBtn = document.getElementById('nav-avatar-btn');
    var dd = document.getElementById('nav-dd');
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
    if (navLinks.dataset.navDone) return;
    navLinks.dataset.navDone = '1';

    injectCSS();

    var u = plUser();
    var path = window.location.pathname;

    var logo = document.querySelector('nav > a:first-child, .nav-logo');
    if (logo) {
      logo.href = '/';
      logo.onclick = function(e) {
        e.preventDefault();
        if (u && u.id) {
          // Logged in — go to home dashboard
          if (typeof showHome === 'function') { showHome(); }
          else { window.location.href = '/'; }
        } else {
          // Logged out — go to homepage
          if (typeof showHome === 'function') { showHome(); }
          else { window.location.href = '/'; }
        }
      };
    }

    if (u && u.id) {
      _buildLoggedIn(navLinks, u, path);
    } else {
      _buildLoggedOut(navLinks, path);
    }

    var msg = sessionStorage.getItem('pl-auth-toast');
    if (msg) {
      sessionStorage.removeItem('pl-auth-toast');
      setTimeout(function () { _showToast(msg); }, 300);
    }
  }

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
