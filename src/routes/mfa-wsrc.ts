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
  const listData = await getList({ type }, noCache);
  const routeData: RouterData = {
    name: "mfa-wsrc",
    title: type === "minister" ? "外交部长活动" : "外交部外事日程",
    type: typeMap[type] || "外事活动",
    params: {
      type: {
        name: "活动分类",
        type: typeMap,
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

    // 提取时间信息 - 使用用户指定的 class="time"
    let time: string | undefined;
    const timeElement = $('.time').first();
    if (timeElement.length > 0) {
      const timeText = timeElement.text().trim();
      if (timeText && timeText.length > 5) {
        time = timeText;
      }
    }

    // 提取标题 - 使用用户指定的 class="news-title"
    let title: string | undefined;
    const titleElement = $('.news-title').first();
    if (titleElement.length > 0) {
      const titleText = titleElement.text().trim();
      if (titleText && titleText.length > 0) {
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
  const { type = "wsrc" } = options;
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
    id: number;
    title: string;
    url: string;
    eventDate?: string;
  }> = [];

  // 根据不同类型使用不同的选择器
  if (type === "wsrc") {
    // 外事日程页面的结构
    $('.newsList .newsBd .list1').each((_, listElement) => {
      const $list = $(listElement);

      $list.find('li').each((index, element) => {
        const $element = $(element);
        const $link = $element.find('a');

        if ($link.length > 0) {
          const fullTitle = $link.text().trim();
          const href = $link.attr('href');

          if (fullTitle && href && fullTitle.length > 10) {
            // 从标题中提取日期（格式：标题（YYYY-MM-DD））
            const dateMatch = fullTitle.match(/\((\d{4}-\d{2}-\d{2})\)$/);
            const eventDate = dateMatch ? dateMatch[1] : '';

            // 移除日期部分，得到纯净的标题
            const title = fullTitle.replace(/\s*\(\d{4}-\d{2}-\d{2}\)$/, '');

            // 处理URL
            let fullUrl = href;
            if (href.startsWith('./')) {
              fullUrl = `https://www.mfa.gov.cn/web/wjdt_674879/wsrc_674883/${href.replace('./', '')}`;
            } else if (href.startsWith('/')) {
              fullUrl = `https://www.mfa.gov.cn${href}`;
            } else if (!href.startsWith('http')) {
              fullUrl = `https://www.mfa.gov.cn/web/wjdt_674879/wsrc_674883/${href}`;
            }

            events.push({
              id: index + 1,
              title,
              url: fullUrl,
              eventDate,
            });
          }
        }
      });
    });
  } else if (type === "minister") {
    // 部长活动页面结构 - 使用 class="newsList"
    $('.newsList').each((_, listElement) => {
      const $listContainer = $(listElement);

      // 查找所有的li元素
      $listContainer.find('li').each((index, element) => {
        const $element = $(element);
        const $link = $element.find('a').first();

        if ($link.length > 0) {
          const title = $link.text().trim();
          const href = $link.attr('href');

          if (title && href && title.length > 10) {
            // 处理URL格式: ./202511/t20251121_11757970.shtml
            let fullUrl = href;
            if (href.startsWith('./')) {
              fullUrl = `https://www.mfa.gov.cn/web/wjdt_674879/wjbxw_674885/${href.replace('./', '')}`;
            } else if (href.startsWith('/')) {
              fullUrl = `https://www.mfa.gov.cn${href}`;
            } else if (!href.startsWith('http')) {
              fullUrl = `https://www.mfa.gov.cn/web/wjdt_674879/wjbxw_674885/${href}`;
            }

            // 尝试从URL中提取日期，格式：./202511/t20251121_11757970.shtml
            let eventDate = '';
            const urlDateMatch = href.match(/\.\/(\d{6})\/t(\d{8})_/);
            if (urlDateMatch && urlDateMatch[2]) {
              const dateStr = urlDateMatch[2];
              if (dateStr.length === 8) {
                eventDate = `${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)}`;
              }
            }

            // 如果URL中没有提取到日期，尝试从标题中提取
            if (!eventDate) {
              const titleDateMatch = title.match(/\((\d{4}-\d{2}-\d{2})\)/);
              if (titleDateMatch) {
                eventDate = titleDateMatch[1];
              }
            }

            events.push({
              id: index + 1,
              title: title.replace(/\s*\(\d{4}-\d{2}-\d{2}\)$/, ''),
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
            id: index + 1,
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
          id: index + 1,
          title: cleanTitle,
          url: fullUrl,
          eventDate,
        });
      }
    });
  }

  console.log(`找到 ${events.length} 条外事日程`);

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
    data: eventsWithContent.map((v: RouterType["mfa-wsrc"]) => ({
      id: v.id,
      title: v.title,
      content: v.content,
      url: v.url,
      mobileUrl: v.url || v.mobileUrl, // 确保有mobileUrl字段
      timestamp: v.timestamp,
      hot: v.hot || 0, // 提供默认值
      cover: v.cover,
      author: v.author,
      eventDate: v.eventDate,
      location: v.location
    })),
  };
};