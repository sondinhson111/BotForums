import Parser from 'rss-parser';
import fs from 'fs';

const parser = new Parser({
  customFields: {
    item: ['content:encoded', 'content', 'description', 'categories']
  }
});
const HISTORY_FILE = 'history.json';
const FEED_URL = 'https://forum.cfx.re/c/development/releases/7.rss'; // Luồng gốc toàn bộ bài mới nhất

function extractMedia(html) {
  if (!html) return { image: null };

  const ytMatch = html.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
  const ytThumb = ytMatch ? `https://img.youtube.com/vi/${ytMatch[1]}/hqdefault.jpg` : null;

  const imgMatch = html.match(/<img[^>]+src="([^">]+)"/i);
  let imageUrl = null;
  if (imgMatch && imgMatch[1]) {
    const src = imgMatch[1];
    if (!src.includes('emoji') && !src.includes('avatar') && !src.includes('site_icons')) {
      imageUrl = src.startsWith('//') ? `https:${src}` : src;
    }
  }

  return { image: imageUrl || ytThumb };
}

async function run() {
  let seen = [];
  if (fs.existsSync(HISTORY_FILE)) {
    try {
      seen = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    } catch {
      seen = [];
    }
  }

  try {
    const feed = await parser.parseURL(FEED_URL);
    const newItems = feed.items.filter(item => !seen.includes(item.link)).reverse();

    for (const item of newItems) {
      const fullContent = item['content:encoded'] || item.content || item.description || '';
      const titleLower = item.title.toLowerCase();
      const contentLower = fullContent.toLowerCase();

      // Kiểm tra xem bài có phải là bài trả phí (Paid) hay không
      const isPaid = 
        titleLower.includes('[paid]') ||
        titleLower.includes('tebex') ||
        contentLower.includes('tebex.io') ||
        (item.categories && item.categories.some(cat => cat.toLowerCase().includes('paid')));

      // Lựa chọn Webhook theo phân loại
      const targetWebhook = isPaid 
        ? process.env.DISCORD_WEBHOOK_PAID 
        : process.env.DISCORD_WEBHOOK_FREE;

      const categoryName = isPaid ? 'Paid Script' : 'Free Script';
      const embedColor = isPaid ? 0xffa500 : 0x00ff7f; // Cam cho Paid, Xanh lá cho Free

      if (!targetWebhook) continue;

      const media = extractMedia(fullContent);
      let cleanSnippet = (item.contentSnippet || '').replace(/\n\s*\n/g, '\n').trim();
      if (cleanSnippet.length > 2000) cleanSnippet = cleanSnippet.slice(0, 2000) + '...';

      const payload = {
        thread_name: item.title.slice(0, 100),
        embeds: [{
          title: item.title,
          url: item.link,
          description: cleanSnippet.length > 0 ? cleanSnippet : 'Bấm vào tiêu đề phía trên để xem bài viết gốc trên diễn đàn.',
          color: embedColor,
          author: { 
            name: `${item.creator || 'Cfx Dev'} • [${categoryName}]`,
            url: `https://forum.cfx.re/u/${item.creator || ''}`
          },
          image: media.image ? { url: media.image } : undefined,
          timestamp: new Date(item.pubDate).toISOString(),
          footer: {
            text: "Cfx.re Community Releases",
            icon_url: "https://forum.cfx.re/uploads/default/original/3X/a/5/a5df3927622d057a629b3504f7621c2ae0a6b997.png"
          }
        }]
      };

      const res = await fetch(targetWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        seen.push(item.link);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  } catch (err) {
    console.error('Lỗi khi cào dữ liệu diễn đàn:', err.message);
  }

  fs.writeFileSync(HISTORY_FILE, JSON.stringify(seen.slice(-150), null, 2));
}

run().catch(console.error);
