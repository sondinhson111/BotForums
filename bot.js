import Parser from 'rss-parser';
import fs from 'fs';

const parser = new Parser();
const HISTORY_FILE = 'history.json';

// Cấu hình danh sách 2 nguồn feed và webhook tương ứng
const FEEDS = [
  {
    name: 'Free Script',
    url: 'https://forum.cfx.re/tag/free.rss',
    webhook: process.env.DISCORD_WEBHOOK_FREE,
    color: 0x00ff7f // Màu xanh lá
  },
  {
    name: 'Paid Script',
    url: 'https://forum.cfx.re/tag/paid.rss', // Hoặc c/development/releases/7.rss
    webhook: process.env.DISCORD_WEBHOOK_PAID,
    color: 0xffa500 // Màu cam
  }
];

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
        const payload = {
          thread_name: item.title.slice(0, 100), // Tiêu đề bài đăng Forum
          embeds: [{
            title: item.title,
            url: item.link,
            description: item.contentSnippet ? item.contentSnippet.slice(0, 450) + '...' : 'Xem chi tiết tại Cfx Forum.',
            color: feedConfig.color,
            author: { name: `${item.creator || 'Cfx Dev'} • [${feedConfig.name}]` },
            timestamp: new Date(item.pubDate).toISOString()
          }]
        };

        const res = await fetch(feedConfig.webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          seen.push(item.link);
          await new Promise(r => setTimeout(r, 2000)); // Delay tránh rate limit
        }
      }
    } catch (err) {
      console.error(`Lỗi khi quét feed ${feedConfig.name}:`, err.message);
    }
  }

  // Lưu lại 150 link bài viết gần nhất
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(seen.slice(-150), null, 2));
}

run().catch(console.error);