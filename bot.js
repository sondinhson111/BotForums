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

  // Bắt video YouTube để lấy thumbnail chất lượng cao
  const ytMatch = html.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
  const ytThumb = ytMatch ? `https://img.youtube.com/vi/${ytMatch[1]}/hqdefault.jpg` : null;

  // Bắt ảnh đính kèm trong bài viết (bỏ qua emoji, avatar)
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
      const title = (item.title || '').trim();
      const titleLower = title.toLowerCase();

      // Lấy danh sách tag của bài viết
      const categories = (item.categories || []).map(cat => cat.toLowerCase());

      // 1. Kiểm tra điều kiện FREE: Có [free] ở đầu tiêu đề HOẶC có tag free
      const isFree = titleLower.startsWith('[free]') || categories.includes('free');

      // 2. Kiểm tra điều kiện PAID: Có [paid] ở đầu tiêu đề HOẶC có tag paid
      const isPaid = titleLower.startsWith('[paid]') || categories.includes('paid');

      let targetWebhook = null;
      let categoryName = '';
      let embedColor = 0x00ff7f;

      if (isFree) {
        targetWebhook = process.env.DISCORD_WEBHOOK_FREE;
        categoryName = 'Free Script';
        embedColor = 0x00ff7f; // Xanh lá
      } else if (isPaid) {
        targetWebhook = process.env.DISCORD_WEBHOOK_PAID;
        categoryName = 'Paid Script';
        embedColor = 0xffa500; // Cam
      } else {
        // Nếu bài viết không gắn [FREE] hay [PAID] thì bỏ qua, không đăng bài rác
        continue;
      }

      if (!targetWebhook) continue;

      const media = extractMedia(fullContent);

      // Cắt gọn mô tả tối đa 2000 ký tự
      let cleanSnippet = (item.contentSnippet || '').replace(/\n\s*\n/g, '\n').trim();
      if (cleanSnippet.length > 2000) {
        cleanSnippet = cleanSnippet.slice(0, 2000) + '...';
      }

      const payload = {
        thread_name: title.slice(0, 100),
        embeds: [{
          title: title,
          url: item.link,
          description: cleanSnippet.length > 0 ? cleanSnippet : 'Bấm vào tiêu đề phía trên để xem chi tiết bài viết trên Cfx Forum.',
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
    console.error('Lỗi khi fetch và xử lý feed:', err.message);
  }

  fs.writeFileSync(HISTORY_FILE, JSON.stringify(seen.slice(-200), null, 2));
}

run().catch(console.error);
