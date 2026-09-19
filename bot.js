import Parser from 'rss-parser';
import fs from 'fs';

const parser = new Parser({
  customFields: {
    item: ['content:encoded', 'content']
  }
});
const HISTORY_FILE = 'history.json';

const FEEDS = [
  {
    name: 'Free Script',
    url: 'https://forum.cfx.re/tag/free.rss',
    webhook: process.env.DISCORD_WEBHOOK_FREE,
    color: 0x00ff7f
  },
  {
    name: 'Paid Script',
    url: 'https://forum.cfx.re/tag/paid.rss',
    webhook: process.env.DISCORD_WEBHOOK_PAID,
    color: 0xffa500
  }
];

// Hàm bóc tách link ảnh từ nội dung bài viết
function extractImage(htmlOrText) {
  if (!htmlOrText) return null;
  // Tìm các link ảnh dạng <img> hoặc markdown ![]()
  const imgRegex = /<img[^>]+src="([^">]+)"/i;
  const match = htmlOrText.match(imgRegex);
  if (match && match[1]) {
    // Bỏ qua các emoji hoặc ảnh gif nhỏ của hệ thống forum
    if (match[1].includes('emoji') || match[1].includes('avatar')) return null;
    return match[1];
  }
  return null;
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

  for (const feedConfig of FEEDS) {
    if (!feedConfig.webhook) continue;

    try {
      const feed = await parser.parseURL(feedConfig.url);
      const newItems = feed.items.filter(item => !seen.includes(item.link)).reverse();

      for (const item of newItems) {
        const fullContent = item['content:encoded'] || item.content || '';
        const previewImage = extractImage(fullContent);

        const payload = {
          thread_name: item.title.slice(0, 100), // Tiêu đề bài viết trong diễn đàn
          embeds: [{
            title: item.title,
            url: item.link,
            description: item.contentSnippet ? item.contentSnippet.slice(0, 450) + '...' : 'Xem chi tiết tại Cfx Forum.',
            color: feedConfig.color,
            author: { 
              name: `${item.creator || 'Cfx Dev'} • [${feedConfig.name}]`,
              url: `https://forum.cfx.re/u/${item.creator || ''}`
            },
            // Thêm ảnh xem trước lớn cho Discord Embed
            image: previewImage ? { url: previewImage } : undefined,
            timestamp: new Date(item.pubDate).toISOString(),
            footer: {
              text: "Cfx Forum Releases",
              icon_url: "https://forum.cfx.re/uploads/default/original/3X/a/5/a5df3927622d057a629b3504f7621c2ae0a6b997.png" // Icon Cfx
            }
          }]
        };

        const res = await fetch(feedConfig.webhook, {
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
      console.error(`Lỗi khi quét feed ${feedConfig.name}:`, err.message);
    }
  }

  fs.writeFileSync(HISTORY_FILE, JSON.stringify(seen.slice(-150), null, 2));
}

run().catch(console.error);
