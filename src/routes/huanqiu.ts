import type { RouterData, ListContext, Options, RouterResType } from "../types.js";
import type { RouterType } from "../router.types.js";
import { load } from "cheerio";
import { get } from "../utils/getData.js";
import { getTime } from "../utils/getTime.js";
import { config } from "../config.js";

const typeMap: Record<string, string> = {
  "international": "国际新闻",
  "china": "国内新闻",
  "tech": "科技",
};

const urlMap: Record<string, string> = {
  "international": "https://world.huanqiu.com/api/list?node=%22/e3pmh22ph/e3pmh2398%22,%22/e3pmh22ph/e3pmh26vv%22,%22/e3pmh22ph/e3pn6efsl%22,%22/e3pmh22ph/efp8fqe21%22&offset=0&limit=24",
  "china": "https://china.huanqiu.com/api/list?node=%22/e3pmh1nnq/e3pmh1obd%22,%22/e3pmh1nnq/e3pn61c2g%22,%22/e3pmh1nnq/e3pn6eiep%22,%22/e3pmh1nnq/e3pra70uk%22,%22/e3pmh1nnq/e5anm31jb%22,%22/e3pmh1nnq/e7tl4e309%22&offset=0&limit=24",
  "tech": "https://tech.huanqiu.com/api/list?node=%22/e3pmh164r/e3pmh33i9%22,%22/e3pmh164r/e3pmtm015%22,%22/e3pmh164r/e3pn60k1f%22,%22/e3pmh164r/e3pmh3dh4%22,%22/e3pmh164r/e3pn46ot6%22,%22/e3pmh164r/e3pmtmdvg%22,%22/e3pmh164r/e3pmh2hq8%22,%22/e3pmh164r/e3pn4sfhb%22,%22/e3pmh164r/e3pmtod3t%22,%22/e3pmh164r/e3pn4gh77%22,%22/e3pmh164r/e3pmtlao3%22&offset=0&limit=24",
};

export const handleRoute = async (c: ListContext, noCache: boolean) => {
  const type = c.req.query("type") || "international";
  const days = c.req.query("days") || "today";
  const listData = await getList({ type, days }, noCache);
  const routeData: RouterData = {
    name: "huanqiu",
    title: "环球新闻",
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
    link: "https://world.huanqiu.com/",
    total: listData.data?.length || 0,
    ...listData,
  };
  return routeData;
};

const getList = async (options: Options, noCache: boolean): Promise<RouterResType> => {
  const { type = "international", days = "today" } = options;
  const apiUrl = urlMap[type] || urlMap["international"];

  try {
    // 获取新闻列表API
    const apiResult = await get({
      url: apiUrl,
      noCache,
      headers: {
        "Accept": "*/*",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Connection": "keep-alive",
        "Referer": "https://world.huanqiu.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
        "x-requested-with": "XMLHttpRequest",
      },
    });

    const apiData = apiResult.data;
    if (!apiData?.list || !Array.isArray(apiData.list)) {
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
        fromCache: apiResult.fromCache || false,
        data: [],
      };
    }

    const articles = apiData.list;

    // 获取文章详情（限制并发数量避免过载）
    const batchSize = 5;
    const articleDetails = [];

    for (let i = 0; i < articles.length; i += batchSize) {
      const batch = articles.slice(i, i + batchSize);
      const batchPromises = batch.map(async (article: any, index: number) => {
        try {
          // 从API数据获取基本信息
          const aid = article.aid;
          const title = article.title;
          const summary = article.summary;
          const sourceName = article.source?.name || "环球新闻";
          const createTime = article.ctime; // 毫秒时间戳
          const cover = article.cover;
          const host = article.host || "world.huanqiu.com"; // 获取域名

          // 转换时间戳为秒
          const timestamp = createTime ? getTime(parseInt(createTime) / 1000) : undefined;

          // 构建详情页URL - 使用动态域名
          const detailUrl = `https://${host}/article/${aid}`;

          // 检查aid是否存在
          if (!aid) {
            console.error(`文章ID为空: ${title}`);
            return null;
          }

          let content = summary; // 默认使用简介作为内容

          // 尝试获取详情页内容
          try {
            const detailResult = await get({
              url: detailUrl,
              noCache: false, // 详情页可以使用缓存
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
                "Referer": `https://${host}/`,
              },
            });

            const $detail = load(detailResult.data);

            // 提取文章内容
            const articleContent = extractContent(detailResult.data);
            if (articleContent && articleContent.length > summary.length) {
              content = articleContent;
            }
          } catch (error) {
            console.error(`获取文章详情失败 ${detailUrl}:`, error);
            // 如果获取详情失败，继续使用简介作为内容
          }

          return {
            id: aid,
            title: title,
            url: detailUrl,
            mobileUrl: detailUrl,
            author: sourceName || "环球新闻", // 使用API来源或默认
            content,
            timestamp,
            hot: undefined,
            cover: cover ? (cover.startsWith("http") ? cover : `https:${cover}`) : undefined,
          };
        } catch (error) {
          console.error(`处理文章失败 ${article.aid}:`, error);
          return null;
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
      fromCache: apiResult.fromCache || false,
      data: filteredData,
    };
  } catch (error) {
    console.error(`获取环球新闻失败: ${type}`, error);

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

  // 优先从 textarea.article-content 获取内容
  let content = $("textarea.article-content").val() || "";

  if (!content) {
    // 备选：从article标签内的段落获取内容
    content = $("article p").map((i, el) => $(el).text()).get().join(' ');
  }

  if (!content) {
    // 最后备选：从所有段落获取内容
    content = $("p").map((i, el) => {
      const text = $(el).text();
      // 过滤掉可能的编辑信息、时间戳等
      if (!text.includes('责编：') && !text.includes('来源：') && text.trim().length > 10) {
        return text;
      }
      return '';
    }).get().join(' ');
  }

  // 确保content是字符串类型
  const contentStr = Array.isArray(content) ? content.join(' ') : String(content);

  // 清理HTML标签和多余空格
  const cleanedContent = contentStr.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

  // 限制内容长度
  if (cleanedContent.length > 1000) {
    return cleanedContent.substring(0, 1000) + '...';
  }

  return cleanedContent || "暂无内容";
}