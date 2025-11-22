import type { RouterData, ListContext, Options, RouterResType } from "../types.js";
import type { RouterType } from "../router.types.js";
import { load } from "cheerio";
import { get } from "../utils/getData.js";
import { getTime } from "../utils/getTime.js";
import { config } from "../config.js";

const typeMap: Record<string, string> = {
  "global": "全球",
};

const urlMap: Record<string, string> = {
  "global": "https://global.eastmoney.com/",
};

export const handleRoute = async (c: ListContext, noCache: boolean) => {
  const type = c.req.query("type") || "global";
  const days = c.req.query("days") || "today";
  const listData = await getList({ type, days }, noCache);
  const routeData: RouterData = {
    name: "eastmoney",
    title: "东方财富网",
    type: typeMap[type] || "全球",
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
    link: urlMap[type] || "https://global.eastmoney.com/",
    total: listData.data?.length || 0,
    ...listData,
  };
  return routeData;
};

const getList = async (options: Options, noCache: boolean): Promise<RouterResType> => {
  const { type = "global", days = "today" } = options;
  const listUrl = urlMap[type] || urlMap["global"];

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
    $(".article_list li").each((index, element) => {
      const $item = $(element);
      const title = $item.find(".title a").text().trim();
      const url = $item.find(".title a").attr("href");
      const desc = $item.find(".desc").text().trim();
      const timeStr = $item.find(".time").text().trim();
      const cover = $item.find(".newsImg").attr("src");

      if (title && url) {
        articles.push({
          title,
          url: url.startsWith("http") ? url : `https://global.eastmoney.com${url}`,
          desc,
          timeStr,
          cover: cover ? (cover.startsWith("http") ? cover : `https:${cover}`) : undefined,
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
          const content = extractContent($detail("#ContentBody").html() || "");

          // 提取文章来源
          let sourceText = $detail(".sourcebox span:first").text().trim();
          if (!sourceText) {
            sourceText = $detail(".infos .item:contains('来源')").text().replace(/来源：/, '').trim();
          }
          if (!sourceText) {
            sourceText = $detail(".sourcebox").text().replace(/文章来源：/, '').trim();
          }
          if (sourceText.startsWith('文章来源：')) {
            sourceText = sourceText.replace('文章来源：', '').trim();
          }

          // 提取作者信息
          const authorText = $detail(".infos .item:contains('作者')").text().replace(/作者：/, '').trim();

          // 提取发布时间
          const timeText = $detail(".infos .item:first").text().trim() || article.timeStr;
          const timestamp = timeText ? getTime(timeText) : undefined;

          return {
            id: `eastmoney_${index}_${Date.now()}`,
            title: article.title,
            url: article.url,
            mobileUrl: article.url,
            author: sourceText || "东方财富网", // 使用详情页的来源
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
            id: `eastmoney_${index}_${Date.now()}`,
            title: article.title,
            url: article.url,
            mobileUrl: article.url,
            author: "东方财富网", // 详情获取失败时使用默认来源
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
      fromCache: listResult.fromCache || false,
      data: filteredData,
    };
  } catch (error) {
    console.error(`获取东方财富网新闻失败: ${type}`, error);

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

  // 移除广告、图片等无用元素
  $(".em_xuangu").remove();
  $("style").remove();
  $("script").remove();
  $("iframe").remove();
  $("a[data-code]").remove(); // 移除股票链接

  // 提取纯文本内容
  let text = $.text().trim().replace(/\s+/g, ' ');

  // 移除免责声明等无用信息
  text = text.replace(/郑重声明：[\s\S]*$/, '');
  text = text.replace(/东方财富发布此内容旨在传播更多信息[\s\S]*$/, '');
  text = text.replace(/风险提示及免责条款[\s\S]*$/, '');
  text = text.replace(/投资建议[\s\S]*$/, '');
  text = text.replace(/风险自担[\s\S]*$/, '');
  text = text.replace(/EM_StockImg_Start[\s\S]*$/, '');
  text = text.replace(/EM_StockImg_End[\s\S]*$/, '');

  
  return text || "暂无内容";
}