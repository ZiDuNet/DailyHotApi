import type { RouterData, Options, RouterResType, ListContext } from "../types.js";
import type { RouterType } from "../router.types.js";
import { load } from "cheerio";
import { get } from "../utils/getData.js";
import { getTime } from "../utils/getTime.js";
import { config } from "../config.js";

const typeMap: Record<string, string> = {
  wsrc: "外事日程",
  minister: "部长活动",
};

const urlMap: Record<string, string> = {
  wsrc: "https://www.mfa.gov.cn/web/wjdt_674879/wsrc_674883/",
  minister: "https://www.mfa.gov.cn/web/wjdt_674879/wjbxw_674885/",
};

export const handleRoute = async (c: ListContext, noCache: boolean) => {
  const type = c.req.query("type") || "wsrc";
  const days = c.req.query("days") || "today";
  const listData = await getList({ type, days }, noCache);
  const routeData: RouterData = {
    name: "mfa-wsrc",
    title: type === "minister" ? "外交部长活动" : "外交部外事日程",
    type: typeMap[type] || "外事活动",
    params: {
      type: {
        name: "活动分类",
        type: typeMap,
      },
      days: {
        name: "时间范围",
        type: {
          "today": "今天",
          "3": "近三天",
          "7": "近一周",
          "30": "近一月",
        },
      },
    },
    description: type === "minister"
      ? "中国外交部长重要活动安排，包括会见、会谈、出访等"
      : "中国外交部外事日程安排，包括领导人出访、重要外事活动等",
    link: urlMap[type] || urlMap.wsrc,
    total: listData.data?.length || 0,
    ...listData,
  };
  return routeData;
};

// 获取外事活动详细内容
const getEventContent = async (url: string, noCache: boolean = false): Promise<{ content: string; time?: string; title?: string; location?: string }> => {
  try {
    const result = await get({
      url,
      noCache, // 和列表页面保持一致的缓存逻辑
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
    });

    const $ = load(result.data);

    // 提取时间信息 - 根据实际结构 <p class="time"><span>2025-11-20 15:00</span></p>
    let time: string | undefined;
    const timeElement = $('.time').first();
    if (timeElement.length > 0) {
      // 优先提取span标签内的时间
      const timeSpan = timeElement.find('span').first();
      let timeText = '';
      if (timeSpan.length > 0) {
        timeText = timeSpan.text().trim();
      } else {
        timeText = timeElement.text().trim();
      }

      if (timeText && timeText.length > 5) {
        time = timeText;
      }
    }

    // 提取标题 - 使用用户指定的 class="news-title"
    let title: string | undefined;
    const titleElement = $('.news-title').first();
    if (titleElement.length > 0) {
      let titleText = titleElement.text().trim();
      if (titleText && titleText.length > 0) {
        // 清理标题中的多余信息
        titleText = titleText
          .replace(/\n\s*\n/g, '\n')  // 移除多余的换行
          .replace(/\s*\d{4}-\d{2}-\d{2}\s*\d{2}:\d{2}\s*/g, '')  // 移除时间信息
          .replace(/\s*【中大小】\s*/g, '')  // 移除字体大小标记
          .replace(/\s*打印\s*/g, '')  // 移除打印标记
          .replace(/\s+/g, ' ')  // 合并多个空白字符
          .trim();
        title = titleText;
      }
    }

    // 提取正文内容 - 使用用户指定的 class="news-main"
    let content = "暂无详细内容";
    const mainContentElement = $('.news-main').first();
    if (mainContentElement.length > 0) {
      const mainText = mainContentElement.text().trim();
      if (mainText && mainText.length > 20) {
        content = mainText.replace(/\s+/g, ' ').substring(0, 800) + (mainText.length > 800 ? '...' : '');
      }
    }

    // 备用方案：如果没找到指定class，使用通用选择器
    if (content === "暂无详细内容") {
      const contentSelectors = [
        '#detail',
        '.detail',
        '.article-content',
        '.content',
        '.main-content',
        'div[id*="detail"]',
        'div[class*="content"]',
        '.article-body',
        '.news-content',
        '.event-content'
      ];

      for (const selector of contentSelectors) {
        const text = $(selector).text().trim();
        if (text && text.length > 20) {
          content = text.replace(/\s+/g, ' ').substring(0, 800) + (text.length > 800 ? '...' : '');
          break;
        }
      }
    }

    // 最后备用方案：查找段落标签
    if (content === "暂无详细内容") {
      const paragraphs = $("p").toArray().map(p => $(p).text().trim()).filter(text => text.length > 15);
      if (paragraphs.length > 0) {
        content = paragraphs.slice(0, 5).join(' ').substring(0, 800) + (paragraphs.join(' ').length > 800 ? '...' : '');
      }
    }

    // 提取地点信息（可选）
    let location: string | undefined;
    const locationSelectors = [
      '.location',
      '.place',
      '[class*="location"]',
      '[class*="place"]',
      '.venue'
    ];

    for (const selector of locationSelectors) {
      const locationElement = $(selector).first();
      if (locationElement.length > 0) {
        const locationText = locationElement.text().trim();
        if (locationText && locationText.length > 2) {
          location = locationText;
          break;
        }
      }
    }

    return { content, time, title, location };
  } catch (error) {
    console.error(`获取外事活动详细内容失败: ${url}`, error);
    return { content: "详细内容获取失败" };
  }
};

const getList = async (options: Options, noCache: boolean): Promise<RouterResType> => {
  const { type = "wsrc", days = "today" } = options;
  const url = urlMap[type] || urlMap.wsrc;

  const result = await get({
    url,
    noCache,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2",
      "Accept-Encoding": "gzip, deflate",
      "Connection": "keep-alive",
      "Upgrade-Insecure-Requests": "1",
    },
  });

  const $ = load(result.data);

  const events: Array<{
    id: string | number;
    title: string;
    url: string;
    eventDate?: string;
  }> = [];

  // 根据不同类型使用不同的选择器
  if (type === "wsrc") {
    // 外事日程页面的结构 - 直接从 .newsBd 获取内容
    $('.newsBd').each((_, bdElement) => {
      const $bd = $(bdElement);

      $bd.find('li').each((index, element) => {
        const $element = $(element);
        const $link = $element.find('a');

        if ($link.length > 0) {
          const fullTitle = $link.text().trim();
          const href = $link.attr('href');

          if (fullTitle && href && fullTitle.length > 10) {
            // 从标题中提取日期（格式：标题（YYYY-MM-DD））
            const dateMatch = fullTitle.match(/\((\d{4}-\d{2}-\d{2})\)$/);
            let eventDate = dateMatch ? dateMatch[1] : '';

            // 移除日期部分，得到纯净的标题
            const title = fullTitle.replace(/\s*\(\d{4}-\d{2}-\d{2}\)$/, '');

            // 从URL中提取文章ID（格式：t20251120_11756780）
            let articleId = '';
            const idMatch = href.match(/\/(t\d{8}_\d+)\.shtml/);
            if (idMatch) {
              articleId = idMatch[1];
            }

            // 处理URL
            let fullUrl = href;
            if (href.startsWith('./')) {
              fullUrl = `https://www.mfa.gov.cn/web/wjdt_674879/wsrc_674883/${href.replace('./', '')}`;
            } else if (href.startsWith('/')) {
              fullUrl = `https://www.mfa.gov.cn${href}`;
            } else if (!href.startsWith('http')) {
              fullUrl = `https://www.mfa.gov.cn/web/wjdt_674879/wsrc_674883/${href}`;
            }

            // 使用文章ID作为主要标识符
            const uniqueId = articleId || `mfa-${type}-${index + 1}-${Date.now()}`;

            events.push({
              id: uniqueId,
              title,
              url: fullUrl,
              eventDate,
            });
          }
        }
      });
    });
  } else if (type === "minister") {
    // 部长活动页面结构 - 也使用 .newsBd 获取内容
    $('.newsBd').each((_, bdElement) => {
      const $bd = $(bdElement);

      $bd.find('li').each((index, element) => {
        const $element = $(element);
        const $link = $element.find('a');

        if ($link.length > 0) {
          const fullTitle = $link.text().trim();
          const href = $link.attr('href');

          if (fullTitle && href && fullTitle.length > 10) {
            // 从标题中提取日期（格式：标题（YYYY-MM-DD））
            const dateMatch = fullTitle.match(/\((\d{4}-\d{2}-\d{2})\)$/);
            let eventDate = dateMatch ? dateMatch[1] : '';

            // 移除日期部分，得到纯净的标题
            const title = fullTitle.replace(/\s*\(\d{4}-\d{2}-\d{2}\)$/, '');

            // 从URL中提取文章ID（格式：t20251120_11756780）
            let articleId = '';
            const idMatch = href.match(/\/(t\d{8}_\d+)\.shtml/);
            if (idMatch) {
              articleId = idMatch[1];
            }

            // 处理URL - 部长活动页面路径不同
            let fullUrl = href;
            if (href.startsWith('./')) {
              fullUrl = `https://www.mfa.gov.cn/web/wjdt_674879/wjbxw_674885/${href.replace('./', '')}`;
            } else if (href.startsWith('/')) {
              fullUrl = `https://www.mfa.gov.cn${href}`;
            } else if (!href.startsWith('http')) {
              fullUrl = `https://www.mfa.gov.cn/web/wjdt_674879/wjbxw_674885/${href}`;
            }

            // 尝试从URL中提取日期，格式：./202511/t20251121_11757970.shtml
            if (!eventDate) {
              const urlDateMatch = href.match(/\.\/(\d{6})\/t(\d{8})_/);
              if (urlDateMatch && urlDateMatch[2]) {
                const dateStr = urlDateMatch[2];
                if (dateStr.length === 8) {
                  eventDate = `${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)}`;
                }
              }
            }

            // 使用文章ID作为主要标识符
            const uniqueId = articleId || `mfa-${type}-${index + 1}-${Date.now()}`;

            events.push({
              id: uniqueId,
              title,
              url: fullUrl,
              eventDate,
            });
          }
        }
      });
    });

    // 如果上面没找到，尝试更宽泛的选择器
    if (events.length === 0) {
      $('a[href*=".shtml"]').each((index, element) => {
        const $element = $(element);
        const title = $element.text().trim();
        const href = $element.attr('href');

        if (title && href && title.length > 10 && href.includes('.shtml')) {
          let fullUrl = href;
          if (href.startsWith('./')) {
            fullUrl = `https://www.mfa.gov.cn/web/wjdt_674879/wjbxw_674885/${href.replace('./', '')}`;
          } else if (href.startsWith('/')) {
            fullUrl = `https://www.mfa.gov.cn${href}`;
          } else if (!href.startsWith('http')) {
            fullUrl = `https://www.mfa.gov.cn/web/wjdt_674879/wjbxw_674885/${href}`;
          }

          let eventDate = '';
          const urlDateMatch = href.match(/\.\/(\d{6})\/t(\d{8})_/);
          if (urlDateMatch && urlDateMatch[2]) {
            const dateStr = urlDateMatch[2];
            if (dateStr.length === 8) {
              eventDate = `${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)}`;
            }
          }

          events.push({
            id: `mfa-${type}-fallback-${index + 1}-${Date.now()}`, // 生成唯一组合ID
            title: title.replace(/\s*\(\d{4}-\d{2}-\d{2}\)$/, ''),
            url: fullUrl,
            eventDate,
          });
        }
      });
    }
  }

  // 如果上面没有找到，尝试更宽泛的选择器
  if (events.length === 0) {
    $('a[href*="."]').each((index, element) => {
      const $element = $(element);
      const title = $element.text().trim();
      const href = $element.attr('href');

      // 查找包含日期的标题
      if (title && href && title.includes('(') && title.includes(')') &&
          title.match(/\(\d{4}-\d{2}-\d{2}\)/) && title.length > 15) {

        const dateMatch = title.match(/\((\d{4}-\d{2}-\d{2})\)$/);
        const eventDate = dateMatch ? dateMatch[1] : '';
        const cleanTitle = title.replace(/\s*\(\d{4}-\d{2}-\d{2}\)$/, '');

        let fullUrl = href;
        if (href.startsWith('./')) {
          fullUrl = `https://www.mfa.gov.cn/web/wjdt_674879/wsrc_674883/${href.replace('./', '')}`;
        } else if (href.startsWith('/')) {
          fullUrl = `https://www.mfa.gov.cn${href}`;
        } else if (!href.startsWith('http')) {
          fullUrl = `https://www.mfa.gov.cn/web/wjdt_674879/wsrc_674883/${href}`;
        }

        events.push({
          id: `mfa-${type}-last-resort-${index + 1}-${Date.now()}`, // 生成唯一组合ID
          title: cleanTitle,
          url: fullUrl,
          eventDate,
        });
      }
    });
  }

  console.log(`找到 ${events.length} 条外事日程`);
  console.log('事件样例:', events.slice(0, 2));

  // 去重并限制数量
  const uniqueEvents = Array.from(
    new Map(events.map(item => [item.url, item])).values()
  ).slice(0, 30);

  // 获取每个外事活动的详细内容
  const eventsWithContent = await Promise.all(
    uniqueEvents.map(async (item) => {
      try {
        const { content, time: detailTime, title: detailTitle, location } = await getEventContent(item.url, noCache);
        return {
          ...item,
          title: detailTitle || item.title, // 优先使用详情页的标题
          content: content,
          timestamp: detailTime || (item.eventDate ? getTime(item.eventDate) : Date.now()),
          hot: Math.floor(Math.random() * 8000) + 2000, // 模拟热度
          cover: '', // 外交部页面通常没有封面图
          author: '外交部',
          location: location || ''
        };
      } catch (error) {
        console.error(`获取外事活动内容失败: ${item.url}`, error);
        return {
          ...item,
          content: "详细内容获取失败",
          timestamp: item.eventDate ? getTime(item.eventDate) : Date.now(),
          hot: Math.floor(Math.random() * 8000) + 2000,
          cover: '',
          author: '外交部',
          location: ''
        };
      }
    })
  );

  // 按时间过滤：根据days参数过滤外事活动
  const filteredData = eventsWithContent.filter(item => {
    if (!item.timestamp) {
      return true; // 如果没有时间戳，默认通过
    }

    const itemDate = new Date(item.timestamp);
    const now = new Date();
    let targetDate: Date;

    switch (days) {
      case "today":
        targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case "3":
        targetDate = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
        break;
      case "7":
        targetDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "30":
        targetDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        // 如果是数字，按天计算
        const daysNum = parseInt(days as string);
        if (!isNaN(daysNum) && daysNum > 0) {
          targetDate = new Date(now.getTime() - daysNum * 24 * 60 * 60 * 1000);
        } else {
          targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        }
    }

    return itemDate >= targetDate;
  });

 return {
  ...result,
  updateTime: new Date().toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).replace(/\//g, '-'),
  data: filteredData.map((v) => ({
    id: v.id,
    title: v.title,
    content: v.content, // 可选字段，直接赋值（接口允许 undefined）
    url: v.url,
    // 修复1：源数据无 mobileUrl，直接用 v.url 替代（避免 TS 报错，且确保是 string 类型）
    mobileUrl: v.url,
    // 修复2：timestamp 字符串转 number，失败设为 undefined（符合接口要求）
    timestamp: typeof v.timestamp === 'string'
      ? // 情况1：如果是时间字符串（如 "2025-11-23 10:00:00"）→ 转毫秒时间戳
        new Date(v.timestamp).getTime()
      : // 情况2：如果是数字 → 直接使用；否则 → undefined
        (typeof v.timestamp === 'number' ? v.timestamp : undefined),
    // 优化：hot 直接赋值（接口要求必填字段，值允许 undefined，无需 || undefined）
    hot: v.hot,
    cover: v.cover, // 可选字段
    author: v.author, // 可选字段
    eventDate: v.eventDate,
    location: v.location
  })),
};
};