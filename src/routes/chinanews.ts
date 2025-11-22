import type { RouterData, ListContext, Options, RouterResType } from "../types.js";
import type { RouterType } from "../router.types.js";
import { load } from "cheerio";
import { get } from "../utils/getData.js";
import { getTime } from "../utils/getTime.js";
import { config } from "../config.js";

const typeMap: Record<string, string> = {
  "world": "国际新闻",
  "finance": "财经新闻",
};

const urlMap: Record<string, string> = {
  "world": "https://www.chinanews.com.cn/world.shtml",
  "finance": "https://www.chinanews.com.cn/cj/gd.shtml",
};

export const handleRoute = async (c: ListContext, noCache: boolean) => {
  const type = c.req.query("type") || "world";
  const days = c.req.query("days") || "today";
  const listData = await getList({ type, days }, noCache);
  const routeData: RouterData = {
    name: "chinanews",
    title: "中新网新闻",
    type: typeMap[type] || "国际新闻",
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
    link: urlMap[type] || "https://www.chinanews.com.cn/world.shtml",
    total: listData.data?.length || 0,
    ...listData,
  };
  return routeData;
};

const getList = async (options: Options, noCache: boolean): Promise<RouterResType> => {
  const { type = "world", days = "today" } = options;
  const listUrl = urlMap[type] || urlMap["world"];

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

    // 解析文章列表 - 限制只获取前50条
    $(".content_list li").each((index, element) => {
      if (index >= 50) return false; // 限制只获取前50条

      const $item = $(element);

      // 获取标题和链接
      const title = $item.find(".dd_bt a").text().trim();
      const url = $item.find(".dd_bt a").attr("href");

      // 获取时间
      const timeStr = $item.find(".dd_time").text().trim();

      // 获取分类标签
      const category = $item.find(".dd_lm").text().trim();

      if (title && url) {
        articles.push({
          title,
          url: url.startsWith("http") ? url : `https://www.chinanews.com.cn${url}`,
          timeStr,
          category,
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
          const content = extractContent($detail(".left_zw").html() || "");

          // 提取标题（详情页标题作为备用）
          const detailTitle = $detail(".content_left_title").text().trim() || article.title;

          // 从隐藏的BaiduSpider标签中获取标准格式的时间和来源信息
          const pubtimeText = $detail("#pubtime_baidu").text().trim();
          const sourceText = $detail("#source_baidu").text().trim();

          let author = "";
          let source = "中新网";
          let timestamp: number | undefined;

          // 解析发布时间 - 优先使用BaiduSpider中的标准格式时间
          if (pubtimeText) {
            // 格式: "2025-11-22 22:26:04"
            timestamp = getTime(pubtimeText);
          }

          // 解析来源 - 从BaiduSpider中获取
          if (sourceText) {
            const sourceMatch = sourceText.match(/来源：(.+)/);
            if (sourceMatch) {
              source = sourceMatch[1].trim();
            }
          }

          // 将来源作为author字段使用
          author = source;

          // 如果BaiduSpider中没有获取到时间，尝试从可见的时间文本中解析
          if (!timestamp) {
            const visibleTimeText = $detail(".content_left_time").text().trim();
            if (visibleTimeText) {
              // 解析时间：格式如 "2025年11月22日 22:26　来源：新华网"
              const timeMatch = visibleTimeText.match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})/);
              if (timeMatch) {
                const year = parseInt(timeMatch[1]);
                const month = parseInt(timeMatch[2]);
                const day = parseInt(timeMatch[3]);
                const hour = parseInt(timeMatch[4]);
                const minute = parseInt(timeMatch[5]);

                const date = new Date(year, month - 1, day, hour, minute);
                timestamp = date.getTime();
              }

              // 如果仍然没有获取到来源，从可见文本中解析
              if (source === "中新网") {
                const sourceMatch = visibleTimeText.match(/来源：([^　\s]+)/);
                if (sourceMatch) {
                  source = sourceMatch[1];
                }
              }
            }
          }

          return {
            id: `chinanews_${index}_${Date.now()}`,
            title: detailTitle,
            url: article.url,
            mobileUrl: article.url,
            author: author || source, // 优先使用作者，否则使用来源
            content,
            timestamp,
            hot: 0,
            cover: undefined, // 中新网文章通常没有封面图
          };
        } catch (error) {
          console.error(`获取文章详情失败 ${article.url}:`, error);

          // 如果获取详情失败，返回基本信息
          const timeStr = article.timeStr;
          let timestamp: number | undefined;

          if (timeStr) {
            // 解析列表页时间：格式如 "11-22 22:26"
            const timeMatch = timeStr.match(/(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})/);
            if (timeMatch) {
              // 假设是当年，构造完整时间
              const currentYear = new Date().getFullYear();
              const month = parseInt(timeMatch[1]);
              const day = parseInt(timeMatch[2]);
              const hour = parseInt(timeMatch[3]);
              const minute = parseInt(timeMatch[4]);

              const date = new Date(currentYear, month - 1, day, hour, minute);
              timestamp = date.getTime();
            }
          }

          return {
            id: `chinanews_${index}_${Date.now()}`,
            title: article.title,
            url: article.url,
            mobileUrl: article.url,
            author: "中新网",
            content: article.category ? `${article.category}：${article.title}` : article.title, // 使用分类和标题作为内容
            timestamp,
            hot: 0,
            cover: undefined,
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      articleDetails.push(...(batchResults.filter(Boolean) as NonNullable<typeof batchResults[number]>[]));
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
    console.error(`获取中新网新闻失败: ${type}`, error);

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

  // 移除广告、编辑信息等无用元素
  $(".adInContent").remove();
  $(".adEditor").remove();
  $(".left_name").remove();
  $("#function_code_page").remove();

  // 提取所有段落的文本
  let content = "";
  $("p").each((index, element) => {
    const text = $(element).text().trim();
    // 过滤掉空的或太短的段落，以及可能的编辑信息
    if (text.length > 10 && !text.includes('责任编辑') && !text.includes('【编辑')) {
      content += text + " ";
    }
  });

  // 如果没有段落内容，尝试获取所有文本
  if (!content) {
    content = $.text().trim();
  }

  // 清理多余空格和换行符
  content = content.replace(/\s+/g, ' ').trim();

  // 限制内容长度
  if (content.length > 1000) {
    content = content.substring(0, 1000) + '...';
  }

  return content || "暂无内容";
}