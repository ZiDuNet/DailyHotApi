import type { RouterData, ListContext, Options, RouterResType, ListItem } from "../types.js";
import type { RouterType } from "../router.types.js";
import { load } from "cheerio";
import { get } from "../utils/getData.js";
import { parseRSS } from "../utils/parseRSS.js";
import { getTime } from "../utils/getTime.js";
import { config } from "../config.js";

const typeMap: Record<string, string> = {
  "politics": "政治",
  "economics": "经济",
  "world": "国际",
  "health": "健康",
  "tech": "科技",
  "finances": "金融",
  "pressreliase": "商业",
};

const urlMap: Record<string, string> = {
  "politics": "https://unn.ua/en/rss/politics_en.xml",
  "economics": "https://unn.ua/en/rss/economics_en.xml",
  "world": "https://unn.ua/en/rss/world_en.xml",
  "health": "https://unn.ua/en/rss/health_en.xml",
  "tech": "https://unn.ua/en/rss/tech_en.xml",
  "finances": "https://unn.ua/en/rss/finances_en.xml",
  "pressreliase": "https://unn.ua/en/rss/pressreliase_en.xml",
};

export const handleRoute = async (c: ListContext, noCache: boolean) => {
  const type = c.req.query("type") || "world";
  const days = c.req.query("days") || "today"; // 默认只显示今天的
  const listData = await getList({ type, days }, noCache);
  const routeData: RouterData = {
    name: "unn",
    title: "unn",
    type: typeMap[type] || "国际",
    params: {
      type: {
        name: "新闻分类",
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
    link: urlMap[type] || urlMap["world"],
    total: listData.data?.length || 0,
    ...listData,
  };
  return routeData;
};

const getList = async (options: Options, noCache: boolean): Promise<RouterResType> => {
  const { type = "world", days = "today" } = options;
  const url = urlMap[type] || urlMap["world"];

  try {
    const result = await get({
      url,
      noCache,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/rss+xml, application/xml, text/xml",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate",
        "Connection": "keep-alive",
      },
    });

    const list = await parseRSS(result.data);

    if (!list || list.length === 0) {
      return {
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
        fromCache: false,
        data: [],
      };
    }

  const data: ListItem[] = list.map((item, index): ListItem => {
      // 提取文章内容 - 优先使用contentSnippet，然后是description
      let content = "";

      if (item.contentSnippet) {
        content = item.contentSnippet;
      } else if ((item as any).description) {
        // 从 description 中获取内容
        const $ = load((item as any).description);
        content = $.text().trim().replace(/\s+/g, ' ');
      }

      // 如果content字段存在且包含HTML，也尝试解析
      if (!content && item.content) {
        const $ = load(item.content);
        content = $.text().trim().replace(/\s+/g, ' ');
      }

      // 限制内容长度
      if (content.length > 500) {
        content = content.substring(0, 500) + '...';
      }

      // 提取作者信息
      let author = "unn";
      if ((item as any).creator) {
        const creator = (item as any).creator;
        author = Array.isArray(creator) ? creator.join(', ') : String(creator);
      } else if (item.author) {
        author = String(item.author);
      }

      // 生成唯一ID
      let id = item.title || `unn_${index}`;
      if (item.guid) {
        id = typeof item.guid === 'string' ? item.guid : (item.guid as any).toString();
      } else if (item.link) {
        // 从链接中提取ID
        const urlId = item.link.split('/').pop()?.replace(/\.[^.]*$/, '');
        if (urlId) {
          id = urlId;
        }
      }

      return {
        id: typeof id === 'string' ? id : `unn_${index}`,
        title: item.title || "暂无标题",
        url: item.link || "",
        mobileUrl: item.link || "",
        author: author,
        content: content,
        timestamp: item.pubDate ? getTime(item.pubDate) : undefined,
        hot: 0, // hot 为必填，统一设为 0（无热度）
        cover: undefined,
      };
    });

    // 按时间过滤：根据days参数过滤新闻
    const filteredData = data.filter(item => {
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
      fromCache: result.fromCache || false,
      data: filteredData, // 现在完全符合 ListItem[] 类型
    };
  } catch (error) {
    console.error(`获取unn新闻失败: ${type}`, error);
    return {
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
      fromCache: false,
      data: [], // 异常时返回空数组，符合 ListItem[] 类型
    };
  }
}