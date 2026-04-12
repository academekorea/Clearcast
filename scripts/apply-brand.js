// Apply brand identity updates to all secondary HTML pages
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOT = '/Users/albertlee/Desktop/podlens';

// Shared CSS to inject after .podlens-wordmark rules
const LOCKUP_CSS = `
/* ── LOGO LOCKUP ── */
.pl-lockup{display:inline-flex;align-items:center;gap:10px;text-decoration:none;flex-shrink:0}
.pl-lockup-icon{width:28px;height:28px;flex-shrink:0;border-radius:6px;display:block}
.pl-lockup-divider{width:1px;height:30px;background:var(--border2,rgba(0,0,0,.15));flex-shrink:0}
.pl-lockup-text{display:flex;flex-direction:column;gap:3px;line-height:1}
.pl-lockup-wm{font-family:'Playfair Display',Georgia,serif;font-size:18px;line-height:1;color:var(--navy,#0f2027);letter-spacing:0;display:block}
[data-theme="dark"] .pl-lockup-wm{color:var(--text,#FAF9F6)}
.pl-wm-pod{font-weight:400}
.pl-wm-lens{font-weight:700}
.pl-lockup-tagline{display:block;font-family:'Inter',-apple-system,sans-serif;font-size:9.5px;color:var(--text3,#999);letter-spacing:.02em;line-height:1.3;white-space:nowrap}
@media(max-width:480px){nav .pl-lockup-divider,nav .pl-lockup-text{display:none}nav .pl-lockup-icon{width:30px;height:30px}}`;

// New nav logo HTML
const NEW_NAV_LOGO = `<a class="pl-lockup" href="/" aria-label="Podlens home">
    <img src="/favicon.svg" class="pl-lockup-icon" alt="" width="28" height="28">
    <span class="pl-lockup-divider"></span>
    <span class="pl-lockup-text">
      <span class="pl-lockup-wm"><span class="pl-wm-pod">POD</span><span class="pl-wm-lens">LENS</span></span>
      <span class="pl-lockup-tagline">Know what you&rsquo;re actually listening to</span>
    </span>
  </a>`;

// Meta tags to inject after <meta charset>/<meta viewport>
function buildMetaTags(pageTitle, pageUrl) {
  return `
<meta name="description" content="Paste any podcast URL. We surface bias, framing patterns, missing perspectives, and host influence — grounded in the actual transcript.">
<meta property="og:title" content="Podlens — Know what you're actually listening to">
<meta property="og:description" content="Paste any podcast URL. We surface bias, framing patterns, missing perspectives, and host influence — grounded in the actual transcript.">
<meta property="og:image" content="https://podlens.app/og-image.png">
<meta property="og:url" content="${pageUrl}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="https://podlens.app/og-image.png">`;
}

const PAGES = [
  { file: 'about.html',        url: 'https://podlens.app/about.html' },
  { file: 'account.html',      url: 'https://podlens.app/account.html' },
  { file: 'bulk-scan.html',    url: 'https://podlens.app/bulk-scan.html' },
  { file: 'extension.html',    url: 'https://podlens.app/extension.html' },
  { file: 'how-it-works.html', url: 'https://podlens.app/how-it-works.html' },
  { file: 'pricing.html',      url: 'https://podlens.app/pricing.html' },
  { file: 'privacy.html',      url: 'https://podlens.app/privacy.html' },
  { file: 'profile.html',      url: 'https://podlens.app/profile.html' },
  { file: 'settings.html',     url: 'https://podlens.app/settings.html' },
  { file: 'terms.html',        url: 'https://podlens.app/terms.html' },
];

for (const { file, url } of PAGES) {
  const path = join(ROOT, file);
  let html = readFileSync(path, 'utf8');
  let changed = false;

  // 1. Update og:image .jpg → .png
  if (html.includes('og-image.jpg')) {
    html = html.replace(/og-image\.jpg/g, 'og-image.png');
    changed = true;
  }

  // 2. Add comprehensive meta tags if not present
  if (!html.includes('og:title')) {
    // Inject after the og:image line or after the theme-color meta
    const metaInsert = buildMetaTags('', url);
    html = html.replace(/<meta name="theme-color"/, metaInsert + '\n<meta name="theme-color"');
    changed = true;
  } else {
    // Update og:url if present
    html = html.replace(/content="https:\/\/podlens\.app\/[^"]*"(\s*><\/meta>)?(\s*\/>)?(\s*>)(\s*<meta property="og:type")/g,
      `content="${url}"$4`);
  }

  // 3. Add favicon PNG links if not present
  if (!html.includes('favicon-32.png')) {
    html = html.replace(
      /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg">/,
      `<link rel="icon" type="image/svg+xml" href="/favicon.svg">\n<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">\n<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png">\n<link rel="apple-touch-icon" sizes="180x180" href="/favicon-180.png">`
    );
    changed = true;
  }

  // 4. Fix wordmark letter-spacing
  html = html.replace(/\.podlens-wordmark\{([^}]*?)letter-spacing:\.08em([^}]*?)\}/g,
    (m, before, after) => `.podlens-wordmark{${before}letter-spacing:0${after}}`);

  // 5. Add lockup CSS if not present
  if (!html.includes('pl-lockup')) {
    html = html.replace(
      /\.podlens-wordmark\{[^}]+\}\.podlens-wordmark \.pod\{[^}]+\}\.podlens-wordmark \.lens\{[^}]+\}/,
      (match) => match + LOCKUP_CSS
    );
    changed = true;
  }

  // 6. Replace old nav logo with lockup
  // Pattern: <a class="logo" href="/"><span class="podlens-wordmark">...</span></a>
  html = html.replace(
    /<a class="logo" href="\/">\s*<span class="podlens-wordmark">[\s\S]*?<\/span>\s*<\/a>/,
    NEW_NAV_LOGO
  );

  writeFileSync(path, html, 'utf8');
  console.log(`✓ ${file}`);
}
console.log('Done.');
