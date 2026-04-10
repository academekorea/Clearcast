import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// International — exactly 3 cards
const PLACEHOLDERS = [
  {
    slug: "jre",
    show_name: "The Joe Rogan Experience",
    host: "Joe Rogan",
    episode_title: "Episode #2254 \u2014 Elon Musk",
    episode_date: "",
    bias_label: "Lightly Right-Leaning",
    bias_score: 62,
    bias_direction: "right",
    top_finding: "Long-form conversations with minimal editorial framing allow guests to express views without challenge",
    show_artwork: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/71/15/1d/71151d33-32e7-f0e1-2a6b-412bf4835c5d/mza_9550948332778108059.jpg/600x600bb.jpg",
    analysis_url: null,
    source_type: "youtube",
    is_placeholder: true,
  },
  {
    slug: "lex-fridman",
    show_name: "Lex Fridman Podcast",
    host: "Lex Fridman",
    episode_title: "Episode #419 \u2014 Sam Altman: OpenAI, AGI and the Future",
    episode_date: "",
    bias_label: "Mostly Balanced",
    bias_score: 52,
    bias_direction: "balanced",
    top_finding: "Technical and philosophical discussions with diverse guests across the political spectrum",
    show_artwork: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts125/v4/08/ec/49/08ec491f-0c2a-48b1-88be-89c6e1a9c4c5/mza_4887527765374920501.jpg/600x600bb.jpg",
    analysis_url: null,
    source_type: "youtube",
    is_placeholder: true,
  },
  {
    slug: "the-daily",
    show_name: "The Daily",
    host: "Michael Barbaro",
    episode_title: "The Housing Crisis, Explained",
    episode_date: "",
    bias_label: "Lightly Left-Leaning",
    bias_score: 38,
    bias_direction: "left",
    top_finding: "NYT editorial framing emphasizes institutional sources and progressive policy perspectives",
    show_artwork: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/da/5d/72/da5d7247-1a90-a0b5-6b6e-7ec26aca7a8a/mza_2948437641474798613.jpg/600x600bb.jpg",
    analysis_url: null,
    source_type: "rss",
    is_placeholder: true,
  },
];

// Korean — exactly 3 cards
const KOREAN_PLACEHOLDERS = [
  {
    slug: "korean-showcase",
    show_name: "지식인의 사랑방",
    host: "",
    episode_title: "AI와 한국 사회의 미래",
    episode_date: "",
    bias_label: "중립적",
    bias_score: 50,
    bias_direction: "balanced",
    top_finding: "한국의 시사와 문화를 균형 있게 다루는 팟캐스트",
    show_artwork: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts115/v4/50/b9/1d/50b91d16-7f9d-f41e-12a5-a7ef7b7bfcf0/mza_16754016.jpg/600x600bb.jpg",
    analysis_url: null,
    source_type: "rss",
    is_placeholder: true,
  },
  {
    slug: "sisa-in",
    show_name: "시사인 팟캐스트",
    host: "시사인",
    episode_title: "총선 이후 한국 정치의 변화",
    episode_date: "",
    bias_label: "약간 좌편향",
    bias_score: 38,
    bias_direction: "left",
    top_finding: "진보적 관점에서 한국 정치 이슈를 심층 분석하는 시사 팟캐스트",
    show_artwork: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts115/v4/7a/e1/88/7ae18843-6e4b-0e75-0e8a-6e7b66f17a15/mza_15784413.jpg/600x600bb.jpg",
    analysis_url: null,
    source_type: "rss",
    is_placeholder: true,
  },
  {
    slug: "news-factory",
    show_name: "뉴스공장",
    host: "김어준",
    episode_title: "오늘의 이슈 분석",
    episode_date: "",
    bias_label: "좌편향",
    bias_score: 28,
    bias_direction: "left",
    top_finding: "진보 성향의 시사 논평으로 현 정치 상황을 비판적으로 해석",
    show_artwork: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts115/v4/6a/0a/fc/6a0afc24-4e4d-38c9-5aad-a2c5e7d78c7a/mza_3462780.jpg/600x600bb.jpg",
    analysis_url: null,
    source_type: "rss",
    is_placeholder: true,
  },
];

export default async (req: Request) => {
  const url = new URL(req.url);
  // Phase 2: Korean market deferred — always serve international showcases
  // const region = req.headers.get("x-pl-region") || url.searchParams.get("region") || "INTL";
  // const isKorean = region === "KR";
  const isKorean = false;

  const store = getStore("podlens-blobs");
  const showcases: any[] = [];

  // Always exactly 3 slugs
  const slugs = ["jre", "lex-fridman", "the-daily"];

  const placeholderMap: Record<string, any> = {};
  for (const p of PLACEHOLDERS) placeholderMap[p.slug] = p;
  // Korean placeholders preserved for Phase 2 re-enable
  for (const p of KOREAN_PLACEHOLDERS) placeholderMap[p.slug] = p;

  for (const slug of slugs) {
    try {
      const card = await store.get(`showcase-card-${slug}`, { type: "json" }) as any;
      if (card && card.show_name && !card.is_placeholder) {
        showcases.push({ ...card, slug });
        continue;
      }
    } catch {}
    showcases.push(placeholderMap[slug] || { slug, show_name: slug, is_placeholder: true });
  }

  return new Response(JSON.stringify({ showcases: showcases.slice(0, 3) }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
    },
  });
};

export const config: Config = { path: "/api/showcases" };
