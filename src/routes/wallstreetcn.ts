import type { RouterData, ListContext, Options, RouterResType } from "../types.js";
import type { RouterType } from "../router.types.js";
import { load } from "cheerio";
import { get } from "../utils/getData.js";
import { getTime } from "../utils/getTime.js";
import { config } from "../config.js";

const typeMap: Record<string, string> = {
  "global": "最新",
};

const urlMap: Record<string, string> = {
  "global": "https://api-one-wscn.awtmt.com/apiv1/content/information-flow?channel=global&accept=article&cursor=&limit=30&action=upglide",
};

export const handleRoute = async (c: ListContext, noCache: boolean) => {
  const type = c.req.query("type") || "global";
  const days = c.req.query("days") || "today";
  const listData = await getList({ type, days }, noCache);
  const routeData: RouterData = {
    name: "wallstreetcn",
    title: "华尔街见闻",
    type: typeMap[type] || "最新",
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
    link: "https://wallstreetcn.com",
    total: listData.data?.length || 0,
    ...listData,
  };
  return routeData;
};

const getList = async (options: Options, noCache: boolean): Promise<RouterResType> => {
  const { type = "global", days = "today" } = options;
  const listUrl = urlMap[type] || urlMap["global"];

  try {
    // 获取文章列表
    const listResult = await get({
      url: listUrl,
      noCache,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate",
        "Connection": "keep-alive",
        "Referer": "https://wallstreetcn.com/",
      },
    });

    const listData = listResult.data;
    if (!listData?.data?.items || !Array.isArray(listData.data.items)) {
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
        data: [],
      };
    }

    // 过滤出文章类型的资源
    const articles = listData.data.items.filter((item: any) =>
      item.resource_type === "article" && item.resource && item.resource.id
    );

    // 获取文章详情（限制并发数量避免过载）
    const batchSize = 5;
    const articleDetails = [];

    for (let i = 0; i < articles.length; i += batchSize) {
      const batch = articles.slice(i, i + batchSize);
      const batchPromises = batch.map(async (item: any) => {
        try {
          const articleId = item.resource.id;
          const detailUrl = `https://api-one-wscn.awtmt.com/apiv1/content/articles/${articleId}?extract=1`;

          const detailResult = await get({
            url: detailUrl,
            noCache: false, // 详情页可以使用缓存
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Accept": "application/json, text/plain, */*",
              "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
              "Referer": "https://wallstreetcn.com/",
            },
          });

          const detailData = detailResult.data;
          if (detailData?.code === 20000 && detailData?.data) {
            return {
              id: articleId,
              title: detailData.data.title || item.resource.title || "暂无标题",
              url: detailData.data.uri || item.resource.uri || `https://wallstreetcn.com/articles/${articleId}`,
              mobileUrl: detailData.data.uri || item.resource.uri || `https://wallstreetcn.com/articles/${articleId}`,
              author: "华尔街见闻",
              content: extractContent(detailData.data.content || ""),
              timestamp: detailData.data.display_time ? getTime(detailData.data.display_time * 1000) :
                        (item.resource.display_time ? getTime(item.resource.display_time * 1000) : undefined),
              hot: undefined,
              cover: detailData.data.image?.uri || item.resource.image?.uri,
            };
          }
        } catch (error) {
          console.error(`获取文章详情失败 ${item.resource?.id}:`, error);
        }

        // 如果获取详情失败，返回基本信息
        return {
          id: item.resource.id,
          title: item.resource.title || "暂无标题",
          url: item.resource.uri || `https://wallstreetcn.com/articles/${item.resource.id}`,
          mobileUrl: item.resource.uri || `https://wallstreetcn.com/articles/${item.resource.id}`,
          author: "尔街见闻",
          content: extractContent(item.resource.content_short || ""), // 详情失败时使用简介
          timestamp: item.resource.display_time ? getTime(item.resource.display_time * 1000) : undefined,
          hot: undefined,
          cover: item.resource.image?.uri,
        };
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
    console.error(`获取华尔街见闻新闻失败: ${type}`, error);

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

  // 移除免责声明、风险提示等无用元素
  $('div[style*="color: #666"]').remove();
  $('div[style*="font-size: 12px"]').remove();
  $('div:contains("风险提示及免责条款")').remove();
  $('div:contains("市场有风险，投资需谨慎")').remove();

  // 提取纯文本内容
  let text = $.text().trim().replace(/\s+/g, ' ');

  // 移除免责声明等无用信息（正则匹配）
  text = text.replace(/市场有风险，投资需谨慎。[\s\S]*$/, '');
  text = text.replace(/风险提示及免责条款[\s\S]*$/, '');
  text = text.replace(/本文内容仅代表作者观点[\s\S]*$/, '');
  text = text.replace(/投资者不应以该等信息作为决策依据[\s\S]*$/, '');
  text = text.replace(/本文来源于：[\s\S]*$/, '');

  // 限制内容长度
  if (text.length > 1000) {
    text = text.substring(0, 1000) + '...';
  }

  return text || "暂无内容";
}