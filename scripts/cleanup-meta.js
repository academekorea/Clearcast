// Remove duplicate og:image meta from secondary pages
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOT = '/Users/albertlee/Desktop/podlens';
const PAGES = ['about.html','account.html','bulk-scan.html','extension.html',
  'how-it-works.html','pricing.html','privacy.html','profile.html','settings.html','terms.html'];

for (const file of PAGES) {
  const path = join(ROOT, file);
  let html = readFileSync(path, 'utf8');

  // Remove stray lone og:image line that was already there before the full block
  // Pattern: <meta property="og:image" content="..."> followed by blank line, then <meta name="description"
  html = html.replace(/<meta property="og:image" content="https:\/\/podlens\.app\/og-image\.png">\n\n<meta name="description"/,
    '<meta name="description"');

  writeFileSync(path, html, 'utf8');
  console.log(`✓ ${file}`);
}
