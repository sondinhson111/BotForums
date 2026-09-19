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
    const feed = await parser.parseURL(FEED_URL);
    // Lấy danh sách bài chưa từng gửi lên Discord
    const newItems = feed.items.filter(item => !seen.includes(item.link)).reverse();

    for (const item of newItems) {
      const fullContent = item['content:encoded'] || item.content || item.description || '';
      const title = (item.title || '').trim();
      const titleLower = title.toLowerCase();
      
      // Lấy toàn bộ tag của bài viết (chuyển về chữ thường)
      const categories = (item.categories || []).map(cat => cat.toLowerCase());

      // 1. Kiểm tra Free: Tiêu đề chứa [free], (free), hoặc có tag "free"
      // (Bất kể bài có gắn kèm tag esx, qbcore hay gì khác đều nhận)
      const hasFreeIndicator = 
        titleLower.includes('[free]') || 
        titleLower.includes('(free)') || 
        categories.includes('free');

      // 2. Kiểm tra Paid: Tiêu đề chứa [paid], (paid), hoặc có tag "paid"
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
        embedColor = 0x00ff7f; // Xanh lá
      } else if (hasPaidIndicator) {
        targetWebhook = process.env.DISCORD_WEBHOOK_PAID;
        categoryName = 'Paid Script';
        embedColor = 0xffa500; // Cam
      } else {
        // Nếu bài viết chưa có nhãn free hay paid thì bỏ qua ở lượt này,
        // KHÔNG lưu vào seen để lần sau dev bổ sung tag thì vẫn quét được
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
        const res = await fetch(targetWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10000)
        });

        if (res.ok) {
          console.log(`Đã gửi: [${categoryName}] ${title}`);
          seen.push(item.link);
          await new Promise(r => setTimeout(r, 3500)); // Nghỉ 3.5s chống rate limit
        } else if (res.status === 429) {
          const retryAfter = Number(res.headers.get('retry-after')) || 5;
          await new Promise(r => setTimeout(r, (retryAfter + 1) * 1000));
        } else {
          console.error(`Gửi lỗi ${res.status}: ${title}`);
        }
      } catch (err) {
        console.error(`Lỗi request: ${err.message}`);
      }
    }
  } catch (err) {
    console.error('Lỗi đọc feed:', err.message);
  }

  // Giữ lại 300 link gần nhất
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(seen.slice(-300), null, 2));
}

run().catch(console.error);
