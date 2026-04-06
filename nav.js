/**
 * nav.js — Shared persistent nav for all Podlens pages
 * Appends auth-aware Sign-in button (logged out) or Avatar dropdown (logged in)
 * to the page <nav> element. Does NOT run on index.html or account.html
 * which manage their own nav state.
 */
(function () {
  function plUser() {
    try { return JSON.parse(localStorage.getItem('pl-user') || 'null'); } catch (e) { return null; }
  }

  function _esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function _initials(name) {
    var parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }

  function _avatarColor(name) {
    var colors = ['#1a3a5c', '#2d6a4f', '#6b3a3a', '#3a3a6b', '#5c4a1a', '#2d4a6a'];
    return colors[name.charCodeAt(0) % colors.length];
  }

  function injectNavCSS() {
    if (document.getElementById('pl-shared-nav-css')) return;
    var s = document.createElement('style');
    s.id = 'pl-shared-nav-css';
    s.textContent = [
      'nav{display:flex!important;align-items:center!important;width:100%!important}',
      '.nav-links{margin-left:auto!important;display:flex!important;align-items:center!important;gap:24px!important}',
      '.pl-nav-auth{margin-left:auto;display:flex;align-items:center;gap:12px;flex-shrink:0}',
      '.pl-nav-signin{background:#0f2027;color:#fff;border:none;border-radius:999px;padding:8px 20px;font-size:13px;font-weight:600;text-decoration:none;font-family:Inter,-apple-system,sans-serif;cursor:pointer;white-space:nowrap;transition:opacity .15s}',
      '.pl-nav-signin:hover{opacity:.85}',
      '.pl-nav-avatar-btn{background:none;border:none;cursor:pointer;padding:0;border-radius:50%;display:flex;align-items:center}',
      '.pl-nav-avatar-img{width:32px;height:32px;border-radius:50%;object-fit:cover}',
      '.pl-nav-avatar-initials{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;font-family:Inter,sans-serif}',
      '.pl-nav-dd-wrap{position:relative}',
      '.pl-nav-dd{display:none;position:absolute;top:calc(100% + 8px);right:0;background:var(--bg,#fff);border:1px solid var(--border,#e0ddd8);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.12);min-width:200px;z-index:9999;overflow:hidden}',
      '.pl-nav-dd.open{display:block}',
      '.pl-nav-dd-head{padding:12px 16px;border-bottom:1px solid var(--border,#e0ddd8)}',
      '.pl-nav-dd-name{font-size:13px;font-weight:600;color:var(--text,#111);font-family:Inter,sans-serif}',
      '.pl-nav-dd-email{font-size:11px;color:var(--text3,#9CA3AF);margin-top:2px;font-family:Inter,sans-serif}',
      '.pl-nav-dd-item{display:block;padding:10px 16px;font-size:13px;color:var(--text,#111);text-decoration:none;font-family:Inter,sans-serif;transition:background .1s;cursor:pointer;width:100%;text-align:left;background:none;border:none;box-sizing:border-box}',
      '.pl-nav-dd-item:hover{background:var(--bg2,#F5F4F1)}',
      '.pl-nav-dd-div{height:1px;background:var(--border,#e0ddd8);margin:4px 0}',
    ].join('\n');
    document.head.appendChild(s);
  }

  function buildSignin() {
    var wrap = document.createElement('div');
    wrap.className = 'pl-nav-auth';
    var btn = document.createElement('a');
    btn.className = 'pl-nav-signin';
    btn.href = '/';
    btn.textContent = 'Sign in';
    wrap.appendChild(btn);
    return wrap;
  }

  function buildAvatar(u) {
    var displayName = (u.name || u.email || 'U').trim();
    var avatarUrl = u.avatar_custom_url || u.avatar_url || '';
    var isSuperAdmin = u.email === 'academekorea@gmail.com' || u.isSuperAdmin;

    var avatarInner;
    if (avatarUrl) {
      avatarInner = '<img class="pl-nav-avatar-img" src="' + _esc(avatarUrl) + '" alt="' + _esc(displayName) + '" onerror="this.style.display=\'none\'">';
    } else {
      avatarInner = '<div class="pl-nav-avatar-initials" style="background:' + _avatarColor(displayName) + '">' + _initials(displayName) + '</div>';
    }

    var adminRow = isSuperAdmin
      ? '<a href="/account?tab=admin" class="pl-nav-dd-item" style="color:#dc2626;font-weight:600">🔴 Admin Panel</a><div class="pl-nav-dd-div"></div>'
      : '';

    var wrap = document.createElement('div');
    wrap.className = 'pl-nav-auth';
    wrap.innerHTML =
      '<div class="pl-nav-dd-wrap">'
      + '<button class="pl-nav-avatar-btn" id="pl-nav-avatar-btn" aria-label="Profile menu">' + avatarInner + '</button>'
      + '<div class="pl-nav-dd" id="pl-nav-dd">'
      + '<div class="pl-nav-dd-head">'
      + '<div class="pl-nav-dd-name">' + _esc(displayName) + '</div>'
      + '<div class="pl-nav-dd-email">' + _esc(u.email || '') + '</div>'
      + '</div>'
      + adminRow
      + '<a href="/account?tab=profile" class="pl-nav-dd-item">View &amp; Edit Profile</a>'
      + '<a href="/account?tab=settings" class="pl-nav-dd-item">Settings</a>'
      + '<a href="/account?tab=billing" class="pl-nav-dd-item">Billing &amp; Plans</a>'
      + '<div class="pl-nav-dd-div"></div>'
      + '<button onclick="localStorage.removeItem(\'pl-user\');window.location.href=\'/\'" class="pl-nav-dd-item">Sign out</button>'
      + '</div>'
      + '</div>';

    // Toggle dropdown
    wrap.querySelector('#pl-nav-avatar-btn').addEventListener('click', function (e) {
      e.stopPropagation();
      document.getElementById('pl-nav-dd').classList.toggle('open');
    });

    // Close on outside click
    document.addEventListener('click', function () {
      var dd = document.getElementById('pl-nav-dd');
      if (dd) dd.classList.remove('open');
    });

    return wrap;
  }

  function initSharedNav() {
    var nav = document.querySelector('nav');
    if (!nav) return;
    if (nav.dataset.plNavDone) return;
    nav.dataset.plNavDone = '1';

    injectNavCSS();

    var u = plUser();
    nav.appendChild(u && u.id ? buildAvatar(u) : buildSignin());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSharedNav);
  } else {
    initSharedNav();
  }
})();
