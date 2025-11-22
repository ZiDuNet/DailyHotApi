import type { RouterData, ListContext, Options, RouterResType } from "../types.js";
import type { RouterType } from "../router.types.js";
import { load } from "cheerio";
import { get } from "../utils/getData.js";
import { getTime } from "../utils/getTime.js";
import { config } from "../config.js";

const typeMap: Record<string, string> = {
  "business": "商务要闻",
  "economic": "经济新闻",
  "international": "国际资讯",
};

const urlMap: Record<string, string> = {
  "business": "https://www.comnews.cn/node_317.html",
  "economic": "https://www.comnews.cn/node_391.html",
  "international": "https://www.comnews.cn/node_9.html",
};

export const handleRoute = async (c: ListContext, noCache: boolean) => {
  const type = c.req.query("type") || "business";
  const days = c.req.query("days") || "today";
  const listData = await getList({ type, days }, noCache);
  const routeData: RouterData = {
    name: "comnews",
    title: "中国商务新闻网",
    type: typeMap[type] || "商务要闻",
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
    link: urlMap[type] || "https://www.comnews.cn/",
    total: listData.data?.length || 0,
    ...listData,
  };
  return routeData;
};

const getList = async (options: Options, noCache: boolean): Promise<RouterResType> => {
  const { type = "business", days = "today" } = options;
  const listUrl = urlMap[type] || urlMap["business"];

  try {
    // 获取列表页
    const listResult = await get({
      url: listUrl,
      noCache,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
      },
    });

    const $ = load(listResult.data);
    const articles: any[] = [];

    // 解析文章列表
    $(".list-left li").each((index, element) => {
      const $item = $(element);

      // 获取标题和链接
      const title = $item.find("h2 a").text().trim();
      const url = $item.find("h2 a").attr("href");

      // 获取时间
      const timeStr = $item.find("span").text().trim();

      // 获取封面图片
      const cover = $item.find(".list-left-one img").attr("src");

      // 获取简介
      const desc = $item.find("p").text().trim();

      if (title && url) {
        articles.push({
          title,
          url: url.startsWith("http") ? url : `https://www.comnews.cn${url}`,
          timeStr,
          cover: cover ? (cover.startsWith("http") ? cover : `https:${cover}`) : undefined,
          desc,
        });
      }
    });

    // 获取文章详情（限制并发数量避免过载）
    const batchSize = 5;
    const articleDetails = [];

    for (let i = 0; i < articles.length; i += batchSize) {
      const batch = articles.slice(i, i + batchSize);
      const batchPromises = batch.map(async (article, index) => {
        try {
          const detailResult = await get({
            url: article.url,
            noCache: false, // 详情页可以使用缓存
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
              "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
              "Referer": listUrl,
            },
          });

          const $detail = load(detailResult.data);

          // 提取文章内容
          const content = extractContent($detail(".content-text").html() || "");

          // 提取文章来源
          let sourceText = $detail(".content-title p span:contains('来源')").text().replace(/来源：/, '').trim();

          // 提取发布时间
          const timeText = $detail(".content-title p span:first").text().trim() || article.timeStr;
          const timestamp = timeText ? getTime(timeText) : undefined;

          return {
            id: `comnews_${index}_${Date.now()}`,
            title: article.title,
            url: article.url,
            mobileUrl: article.url,
            author: sourceText || "中国商务新闻网", // 使用详情页的来源
            content,
            timestamp,
            hot: undefined,
            cover: article.cover,
          };
        } catch (error) {
          console.error(`获取文章详情失败 ${article.url}:`, error);

          // 如果获取详情失败，返回基本信息
          const timeStr = article.timeStr;
          const timestamp = timeStr ? getTime(timeStr) : undefined;

          return {
            id: `comnews_${index}_${Date.now()}`,
            title: article.title,
            url: article.url,
            mobileUrl: article.url,
            author: "中国商务新闻网", // 详情获取失败时使用默认来源
            content: extractContent(article.desc), // 使用列表页简介作为内容
            timestamp,
            hot: undefined,
            cover: article.cover,
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      articleDetails.push(...batchResults.filter(Boolean));
    }

    // 按时间过滤：根据days参数过滤新闻
    const filteredData = articleDetails.filter(item => {
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
          const daysNum = parseInt(days);
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
      fromCache: listResult.fromCache || false,
      data: filteredData,
    };
  } catch (error) {
    console.error(`获取中国商务新闻网新闻失败: ${type}`, error);

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
};

// 辅助函数：提取文章内容
function extractContent(htmlContent: string): string {
  if (!htmlContent) return "";

  const $ = load(htmlContent);

  // 移除图片、样式等无用元素
  $("img").remove();
  $("style").remove();
  $("script").remove();
  $("iframe").remove();

  // 提取纯文本内容
  let text = $.text().trim().replace(/\s+/g, ' ');

  // 限制内容长度
  if (text.length > 1000) {
    text = text.substring(0, 1000) + '...';
  }

  return text || "暂无内容";
}