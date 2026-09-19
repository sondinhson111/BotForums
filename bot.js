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
    console.log('Bắt đầu tải RSS...');
    const feed = await parser.parseURL(FEED_URL);
    const newItems = feed.items.filter(item => !seen.includes(item.link)).reverse();

    console.log(`Tìm thấy ${newItems.length} bài mới chưa gửi.`);

    let sentCount = 0;
    const MAX_POSTS_PER_RUN = 8; // Giới hạn tối đa 8 bài mỗi lần chạy để không bị nghẽn

    for (const item of newItems) {
      if (sentCount >= MAX_POSTS_PER_RUN) {
        console.log('Đã đạt giới hạn số bài gửi trong 1 lượt chạy (8 bài). Các bài còn lại sẽ gửi ở lượt sau.');
        break;
      }

      const fullContent = item['content:encoded'] || item.content || item.description || '';
      const title = (item.title || '').trim();
      const titleLower = title.toLowerCase();
      const categories = (item.categories || []).map(cat => cat.toLowerCase());

      const isFree = titleLower.startsWith('[free]') || categories.includes('free');
      const isPaid = titleLower.startsWith('[paid]') || categories.includes('paid');

      let targetWebhook = null;
      let categoryName = '';
      let embedColor = 0x00ff7f;

      if (isFree) {
        targetWebhook = process.env.DISCORD_WEBHOOK_FREE;
        categoryName = 'Free Script';
        embedColor = 0x00ff7f;
      } else if (isPaid) {
        targetWebhook = process.env.DISCORD_WEBHOOK_PAID;
        categoryName = 'Paid Script';
        embedColor = 0xffa500;
      } else {
        seen.push(item.link); // Đánh dấu đã duyệt bài không hợp lệ
        continue;
      }

      if (!targetWebhook) continue;

      const media = extractMedia(fullContent);
      let cleanSnippet = (item.contentSnippet || '').replace(/\n\s*\n/g, '\n').trim();
      if (cleanSnippet.length > 2000) cleanSnippet = cleanSnippet.slice(0, 2000) + '...';

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
        console.log(`Đang gửi: ${title}...`);
        
        // Thêm Timeout 10s: Quá 10s không phản hồi thì tự hủy request tránh treo script
        const res = await fetch(targetWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10000)
        });

        if (res.ok) {
          console.log(`=> Gửi thành công: [${categoryName}] ${title}`);
          seen.push(item.link);
          sentCount++;
          // Giãn cách 3.5 giây giữa mỗi bài
          await new Promise(r => setTimeout(r, 3500));
        } else if (res.status === 429) {
          const retryAfter = Number(res.headers.get('retry-after')) || 5;
          console.warn(`Discord báo Rate Limit, tạm dừng ${retryAfter} giây...`);
          await new Promise(r => setTimeout(r, (retryAfter + 1) * 1000));
        } else {
          console.error(`Lỗi gửi bài: Mã phản hồi ${res.status}`);
          seen.push(item.link);
        }
      } catch (postErr) {
        console.error(`Request gửi bài bị lỗi hoặc timeout: ${postErr.message}`);
      }
    }
  } catch (err) {
    console.error('Lỗi khi tải hoặc xử lý feed RSS:', err.message);
  }

  fs.writeFileSync(HISTORY_FILE, JSON.stringify(seen.slice(-200), null, 2));
  console.log('Đã lưu lịch sử vào history.json và hoàn tất lần quét.');
}

run().catch(console.error);
