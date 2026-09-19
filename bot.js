import Parser from 'rss-parser';
import fs from 'fs';

const parser = new Parser({
  customFields: {
    item: ['content:encoded', 'content', 'description', 'categories']
  }
});

const HISTORY_FILE = 'history.json';
const FEED_URL = 'https://forum.cfx.re/c/development/releases/7.rss';

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
      if (!Array.isArray(seen)) seen = [];
    } catch {
      seen = [];
    }
  }

  try {
    console.log('Đang tải danh sách bài viết từ Cfx Forum...');
    const feed = await parser.parseURL(FEED_URL);
    const newItems = feed.items.filter(item => !seen.includes(item.link)).reverse();

    console.log(`Tìm thấy ${newItems.length} bài chưa có trong lịch sử.`);

    for (const item of newItems) {
      const fullContent = item['content:encoded'] || item.content || item.description || '';
      const title = (item.title || '').trim();
      const titleLower = title.toLowerCase();
      const categories = (item.categories || []).map(cat => cat.toLowerCase());

      const hasFreeIndicator = 
        titleLower.includes('[free]') || 
        titleLower.includes('(free)') || 
        categories.includes('free');

      const hasPaidIndicator = 
        titleLower.includes('[paid]') || 
        titleLower.includes('(paid)') || 
        categories.includes('paid');

      let targetWebhook = null;
      let categoryName = '';
      let embedColor = 0x00ff7f;

      if (hasFreeIndicator && !hasPaidIndicator) {
        targetWebhook = process.env.DISCORD_WEBHOOK_FREE;
        categoryName = 'Free Script';
        embedColor = 0x00ff7f;
      } else if (hasPaidIndicator) {
        targetWebhook = process.env.DISCORD_WEBHOOK_PAID;
        categoryName = 'Paid Script';
        embedColor = 0xffa500;
      } else {
        continue;
      }

      if (!targetWebhook) continue;

      const media = extractMedia(fullContent);
      let cleanSnippet = (item.contentSnippet || '').replace(/\n\s*\n/g, '\n').trim();
      if (cleanSnippet.length > 2000) {
        cleanSnippet = cleanSnippet.slice(0, 2000) + '...';
      }

      const payload = {
        thread_name: title.slice(0, 100),
        embeds: [{
          title: title,
          url: item.link,
          description: cleanSnippet.length > 0 ? cleanSnippet : 'Bấm vào tiêu đề phía trên để xem chi tiết.',
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

      try {
        console.log(`Đang gửi: [${categoryName}] ${title}`);

        const res = await fetch(targetWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(8000)
        });

        if (res.ok) {
          console.log(`=> Thành công: ${title}`);
          seen.push(item.link);
          await new Promise(r => setTimeout(r, 4000));
        } else if (res.status === 429) {
          const retryHeader = res.headers.get('retry-after');
          const waitSeconds = retryHeader ? parseFloat(retryHeader) : 5;
          console.warn(`Discord báo Rate Limit 429. Đang chờ ${waitSeconds}s...`);
          await new Promise(r => setTimeout(r, (waitSeconds + 1) * 1000));
        } else {
          console.error(`Gửi không thành công (Status: ${res.status}): ${title}`);
        }
      } catch (err) {
        console.error(`Bỏ qua bài do timeout hoặc mạng nghẽn: ${err.message}`);
      }
    }
  } catch (err) {
    console.error('Lỗi khi đọc dữ liệu RSS:', err.message);
  }

fs.writeFileSync(HISTORY_FILE, JSON.stringify(seen.slice(-300), null, 2));
  console.log('Đã cập nhật file history.json thành công.');
  process.exit(0); // Ép Node.js thoát ngay để GitHub Actions chuyển sang bước Commit
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
