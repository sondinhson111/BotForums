import Parser from 'rss-parser';
import fs from 'fs';

const parser = new Parser({
  customFields: {
    item: ['content:encoded', 'content', 'description', 'categories']
  }
});

const HISTORY_FILE = 'history.json';
const FEED_URL = 'https://forum.cfx.re/c/development/releases/7.rss';

// Bóc tách ảnh thumbnail hoặc ảnh bài đăng
function extractMedia(html) {
  if (!html) return { image: null };

  // 1. Tìm video YouTube để lấy thumbnail nét cao
  const ytMatch = html.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
  const ytThumb = ytMatch ? `https://img.youtube.com/vi/${ytMatch[1]}/hqdefault.jpg` : null;

  // 2. Tìm thẻ ảnh đăng tải trên forum (bỏ qua emoji và avatar)
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
    // Lấy bài mới chưa gửi, đảo ngược để gửi theo thứ tự thời gian cũ -> mới
    const newItems = feed.items.filter(item => !seen.includes(item.link)).reverse();

    for (const item of newItems) {
      const fullContent = item['content:encoded'] || item.content || item.description || '';
      const titleLower = (item.title || '').toLowerCase();
      const contentLower = fullContent.toLowerCase();

      // Dấu hiệu nhận biết bài mất phí
      const hasPaidTag = item.categories && item.categories.some(cat => cat.toLowerCase().includes('paid'));
      const hasPaidTitle = titleLower.includes('[paid]') || titleLower.includes('(paid)');
      const hasPriceNumber = /\b([1-9][0-9]*(\.[0-9]{1,2})?)\s*(eur|usd|gbp|€|\$)/i.test(contentLower);

      // Dấu hiệu bài Free (kể cả trên Tebex 0đ hoặc GitHub)
      const hasFreeTag = item.categories && item.categories.some(cat => cat.toLowerCase().includes('free'));
      const hasFreeTitle = titleLower.includes('[free]') || titleLower.includes('(free)');
      const hasZeroPrice = 
        contentLower.includes('0.00') || 
        contentLower.includes('0€') || 
        contentLower.includes('0$') || 
        contentLower.includes('free on tebex') ||
        contentLower.includes('tebex (free)') ||
        contentLower.includes('free tebex');
      const hasOpenSource = 
        contentLower.includes('github.com') || 
        contentLower.includes('gitlab.com') || 
        contentLower.includes('drive.google.com');

      // Logic phân loại:
      // Ưu tiên: Nếu có tag/tiêu đề [Paid] hoặc có mức giá > 0 rõ ràng -> Chuyển sang Paid.
      // Ngược lại nếu có tag/tiêu đề [Free], link GitHub, hoặc gói Tebex 0.00 -> Chuyển sang Free.
      let isActuallyFree = false;

      if (hasPaidTag || hasPaidTitle || (hasPriceNumber && !hasZeroPrice)) {
        isActuallyFree = false;
      } else if (hasFreeTag || hasFreeTitle || hasZeroPrice || hasOpenSource) {
        isActuallyFree = true;
      } else {
        // Trường hợp không ghi rõ: nếu dính chữ tebex/purchase thì xếp vào Paid, còn lại cho vào Free
        const isShopLink = contentLower.includes('tebex.io') || contentLower.includes('purchase') || contentLower.includes('buy now');
        isActuallyFree = !isShopLink;
      }

      const targetWebhook = isActuallyFree 
        ? process.env.DISCORD_WEBHOOK_FREE 
        : process.env.DISCORD_WEBHOOK_PAID;

      const categoryName = isActuallyFree ? 'Free Script' : 'Paid Script';
      const embedColor = isActuallyFree ? 0x00ff7f : 0xffa500; // Xanh lá cho Free, Cam cho Paid

      if (!targetWebhook) continue;

      const media = extractMedia(fullContent);

      // Cắt gọn mô tả nội dung (giới hạn 2000 ký tự chuẩn Discord)
      let cleanSnippet = (item.contentSnippet || '').replace(/\n\s*\n/g, '\n').trim();
      if (cleanSnippet.length > 2000) {
        cleanSnippet = cleanSnippet.slice(0, 2000) + '...';
      }

      const payload = {
        thread_name: item.title.slice(0, 100),
        embeds: [{
          title: item.title,
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
        await new Promise(r => setTimeout(r, 2000)); // Khoảng cách 2 giây giữa mỗi bài để tránh Discord rate limit
      }
    }
  } catch (err) {
    console.error('Lỗi khi fetch và xử lý feed:', err.message);
  }

  // Giữ lại 200 bài đã gửi gần nhất trong history
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(seen.slice(-200), null, 2));
}

run().catch(console.error);
