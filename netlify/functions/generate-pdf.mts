import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { sbInsert, trackEvent } from "./lib/supabase.js";

// Generates a PDF report for an analysis
// Basic (Creator+): logo + bias bar + summary + top 3 findings
// Full (Operator+): all of basic + transcript + citations + missing voices

// Plan tier check
const BASIC_TIERS = new Set(['creator','operator','studio','trial']);
const FULL_TIERS  = new Set(['operator','studio']);

function escHtml(s: string): string {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function biasBarHtml(l: number, c: number, r: number): string {
  return `<div style="display:flex;height:12px;border-radius:6px;overflow:hidden;margin:8px 0">
    <div style="width:${l}%;background:#E24B4A"></div>
    <div style="width:${c}%;background:#D1CFC9"></div>
    <div style="width:${r}%;background:#378ADD"></div>
  </div>
  <div style="font-size:11px;color:#555;display:flex;gap:16px">
    <span>🔴 ${l}% left</span><span>⬜ ${c}% center</span><span>🔵 ${r}% right</span>
  </div>`;
}

function buildHtml(data: any, type: 'basic' | 'full'): string {
  const al = data.audioLean || {};
  const l = al.leftPct ?? 0, c = al.centerPct ?? 0, r = al.rightPct ?? 0;
  const date = new Date(data.createdAt || Date.now()).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });

  const flagsHtml = (data.flags || []).slice(0, type === 'full' ? 6 : 3).map((f: any) => `
    <div style="background:#F0EFE9;border-left:3px solid #0f2027;padding:10px 14px;margin-bottom:8px;border-radius:0 4px 4px 0">
      <strong style="font-size:12px;color:#1a1a1a">${escHtml(f.title || '')}</strong>
      <div style="font-size:12px;color:#555;margin-top:4px">${escHtml(f.detail || '')}</div>
      ${type === 'full' && f.citations?.[0] ? `<div style="font-size:11px;color:#888;margin-top:6px;font-style:italic">"${escHtml(f.citations[0].quote)}"${f.citations[0].timestamp ? ` (${f.citations[0].timestamp})` : ''}</div>` : ''}
    </div>`).join('');

  const missingVoicesHtml = type === 'full' && data.missingVoices?.length ? `
    <h3 style="font-size:14px;font-weight:600;margin:20px 0 8px">Missing Perspectives</h3>
    <ul style="margin:0;padding-left:20px">
      ${(data.missingVoices || []).map((v: string) => `<li style="font-size:12px;color:#555;margin-bottom:4px">${escHtml(v)}</li>`).join('')}
    </ul>` : '';

  const topicsHtml = (data.topicBreakdown || []).slice(0, 8).map((t: any) => `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <div style="flex:1;font-size:12px;color:#1a1a1a">${escHtml(t.topic || '')}</div>
      <div style="font-size:11px;color:#555;width:32px;text-align:right">${t.percentage || 0}%</div>
      <div style="width:120px;height:6px;background:#F0EFE9;border-radius:3px;overflow:hidden">
        <div style="width:${t.percentage || 0}%;height:100%;background:#0f2027"></div>
      </div>
    </div>`).join('');

  const keyQuotesHtml = type === 'full' ? (data.keyQuotes || []).slice(0, 5).map((q: any) => `
    <div style="border-left:3px solid ${q.concern==='high'?'#E24B4A':q.concern==='medium'?'#B45309':'#9E9E9E'};padding:8px 12px;margin-bottom:8px">
      <div style="font-size:12px;font-style:italic;color:#333">"${escHtml(q.quote || '')}"</div>
      <div style="font-size:11px;color:#888;margin-top:4px">${escHtml(q.note || '')}</div>
    </div>`).join('') : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { font-family: 'Georgia', serif; margin: 0; padding: 40px; color: #1a1a1a; font-size: 13px; line-height: 1.6; }
  @page { margin: 40px; }
  h1 { font-size: 22px; font-weight: 700; margin: 0 0 4px; }
  h2 { font-size: 16px; font-weight: 600; margin: 16px 0 8px; color: #0f2027; }
  h3 { font-size: 14px; font-weight: 600; margin: 12px 0 6px; }
  .header { background: #0f2027; color: white; padding: 24px 32px; margin: -40px -40px 32px; }
  .wordmark { font-size: 20px; font-weight: 700; letter-spacing: 0; margin-bottom: 4px; }
  .wordmark .pod { font-weight: 400; }
  .meta { font-size: 11px; color: rgba(255,255,255,.55); }
  .show { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .1em; color: #555; margin-bottom: 6px; }
  .badge { display: inline-block; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing:.08em; padding: 2px 8px; border-radius: 2px; margin-left: 8px; }
  .badge-basic { background: #EDE9FF; color: #5B21B6; }
  .badge-full { background: #0f2027; color: white; }
  .divider { border: none; border-top: 1px solid #e0ddd8; margin: 20px 0; }
  .footnote { font-size: 10px; color: #999; font-style: italic; margin-top: 4px; }
</style>
</head>
<body>
<div class="header">
  <div class="wordmark"><span class="pod">POD</span>LENS <span class="badge ${type === 'full' ? 'badge-full' : 'badge-basic'}">${type === 'full' ? 'Full Report' : 'Basic Report'}</span></div>
  <div class="meta">Generated ${date} · podlens.app</div>
</div>

<div class="show">${escHtml(data.showName || 'Podcast')}</div>
<h1>${escHtml(data.episodeTitle || 'Episode Analysis')}</h1>
${data.duration ? `<div style="font-size:12px;color:#888">${escHtml(data.duration)}</div>` : ''}

<hr class="divider">

<h2>Political Lean</h2>
${biasBarHtml(l, c, r)}
<div style="font-size:16px;font-weight:700;margin-top:12px">${escHtml(data.biasLabel || '')}</div>
<div class="footnote">Based on language patterns and framing choices — not a judgment of the host's personal politics</div>

<hr class="divider">

<h2>Summary</h2>
<p style="color:#555">${escHtml(data.summary || '')}</p>

${data.topicBreakdown?.length ? `<h2>Topics Covered</h2>${topicsHtml}` : ''}

<hr class="divider">

<h2>Key Findings</h2>
${flagsHtml || '<p style="color:#888">No significant findings flagged.</p>'}

${missingVoicesHtml}

${type === 'full' && keyQuotesHtml ? `<hr class="divider"><h2>Notable Quotes</h2>${keyQuotesHtml}` : ''}

${type === 'full' && data.hostTrustScore ? `
<hr class="divider">
<h2>Host Trust Score</h2>
<div style="font-size:28px;font-weight:700;color:#0f2027">${data.hostTrustScore}<span style="font-size:14px;color:#888">/100</span></div>
<div style="font-size:12px;color:#555">${escHtml(data.hostTrustLabel || '')}</div>
` : ''}

<hr class="divider">
<div style="font-size:10px;color:#bbb;text-align:center;margin-top:20px">
  Generated by Podlens · podlens.app · Analysis ID: ${escHtml(data.jobId || '')}
</div>
</body>
</html>`;
}

export default async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let body: any = {};
  try { body = await req.json(); } catch {}

  const { jobId, userId, plan, type: reportType = 'basic' } = body;
  if (!jobId) return new Response(JSON.stringify({ error: 'jobId required' }), { status: 400, headers: {'Content-Type':'application/json'} });

  const type = FULL_TIERS.has(plan) && reportType === 'full' ? 'full' : 'basic';
  if (type === 'basic' && !BASIC_TIERS.has(plan)) {
    return new Response(JSON.stringify({ error: 'Starter Lens plan required for PDF download' }), { status: 403, headers: {'Content-Type':'application/json'} });
  }
  if (type === 'full' && !FULL_TIERS.has(plan)) {
    return new Response(JSON.stringify({ error: 'Pro Lens plan required for full PDF' }), { status: 403, headers: {'Content-Type':'application/json'} });
  }

  // Check cache
  const cacheKey = `pdf-${type}-${jobId}`;
  try {
    const blobStore = getStore('podlens-cache');
    const cached = await blobStore.get(cacheKey, { type: 'arrayBuffer' });
    if (cached) {
      trackEvent(userId, 'pdf_downloaded', { type, jobId }, { tierAtTime: plan });
      return new Response(cached, {
        headers: { 'Content-Type': 'text/html', 'Content-Disposition': `attachment; filename="podlens-${type}-report.html"` }
      });
    }
  } catch { /* cache miss */ }

  // Get analysis data
  const store = getStore('podlens-jobs');
  let data: any = null;
  try { data = await store.get(jobId, { type: 'json' }); } catch {}

  if (!data) return new Response(JSON.stringify({ error: 'Analysis not found' }), { status: 404, headers: {'Content-Type':'application/json'} });

  const html = buildHtml({ ...data, jobId }, type);
  const htmlBytes = new TextEncoder().encode(html);

  // Cache (fire-and-forget)
  try {
    const blobStore = getStore('podlens-cache');
    await blobStore.set(cacheKey, htmlBytes.buffer as ArrayBuffer, { metadata: { contentType: 'text/html' } });
  } catch {}

  // Track in Supabase
  trackEvent(userId, 'pdf_downloaded', { type, job_id: jobId }, { tierAtTime: plan });
  sbInsert('downloads', {
    user_id: userId || null,
    analysis_id: jobId,
    download_type: `pdf_${type}`,
    created_at: new Date().toISOString(),
  }).catch(() => {});

  return new Response(htmlBytes.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="podlens-${type}-report.html"`,
    },
  });
};

export const config: Config = { path: '/api/generate-pdf' };
