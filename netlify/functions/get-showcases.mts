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

export default async (req: Request) => {
  const showcases = PLACEHOLDERS;
  return new Response(JSON.stringify({ showcases: showcases.slice(0, 3) }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
    },
  });
};

export const config: Config = { path: "/api/showcases" };
