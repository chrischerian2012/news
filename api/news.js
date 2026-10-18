// Vercel serverless function: GET /api/news?q=topic
// Pulls from Google News (RSS), Hacker News and Reddit. No API keys needed.
const UA = { 'User-Agent': 'NewsFinder/1.0 (personal news search)' };

const decode = s => s.replace(/<!\[CDATA\[|\]\]>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

async function googleNews(q) {
  const r = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`, { headers: UA });
  const xml = await r.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 25).map(m => {
    const g = tag => (m[1].match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1] || '';
    const full = decode(g('title'));
    const i = full.lastIndexOf(' - ');
    return {
      title: i > 0 ? full.slice(0, i) : full,
      source: i > 0 ? full.slice(i + 3) : 'Google News',
      platform: 'News',
      url: decode(g('link')),
      time: new Date(decode(g('pubDate'))).getTime() || 0
    };
  });
}

async function hackerNews(q) {
  const r = await fetch(`https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=15&query=${encodeURIComponent(q)}`);
  const j = await r.json();
  return j.hits.filter(h => h.title).map(h => ({
    title: h.title,
    source: 'Hacker News',
    platform: 'Hacker News',
    url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
    time: new Date(h.created_at).getTime()
  }));
}

async function reddit(q) {
  const r = await fetch(`https://www.reddit.com/search.json?sort=new&limit=15&q=${encodeURIComponent(q)}`, { headers: UA });
  const j = await r.json();
  return j.data.children.map(c => c.data).map(p => ({
    title: p.title,
    source: 'r/' + p.subreddit,
    platform: 'Reddit',
    url: 'https://www.reddit.com' + p.permalink,
    time: p.created_utc * 1000
  }));
}

export default async function handler(req, res) {
  const q = String(req.query.q || '').trim().slice(0, 100);
  if (!q) return res.status(400).json({ error: 'Type a topic to search.' });

  const sources = [googleNews, hackerNews, reddit];
  const results = await Promise.allSettled(sources.map(f => f(q)));
  const seen = new Set();
  const items = results
    .flatMap(r => (r.status === 'fulfilled' ? r.value : []))
    .filter(i => {
      const k = i.title.toLowerCase().slice(0, 60);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => b.time - a.time);

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.status(200).json({ items, failed: results.filter(r => r.status === 'rejected').length });
}
