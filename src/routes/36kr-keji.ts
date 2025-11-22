import type { RouterData, ListContext, Options, RouterResType } from "../types.js";
import type { RouterType } from "../router.types.js";
import { load } from "cheerio";
import { get } from "../utils/getData.js";
import { getTime } from "../utils/getTime.js";
import { config } from "../config.js";

export const handleRoute = async (c: ListContext, noCache: boolean) => {
  const days = c.req.query("days") || "today";
  const listData = await getList({ days }, noCache);
  const routeData: RouterData = {
    name: "36kr-keji",
    title: "36氪科技频道",
    type: "科技资讯",
    params: {
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
    link: "https://www.36kr.com/information/technology/",
    total: listData.data?.length || 0,
    ...listData,
  };
  return routeData;
};

const getList = async (options: Options, noCache: boolean): Promise<RouterResType> => {
  const { days = "today" } = options;
  const listUrl = "https://www.36kr.com/information/technology/";

  try {
    // 获取列表页
    const listResult = await get({
      url: listUrl,
      noCache,
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Host": "www.36kr.com",
        "Pragma": "no-cache",
        "Sec-Ch-Ua": "\"Google Chrome\";v=\"135\", \"Not-A.Brand\";v=\"8\", \"Chromium\";v=\"135\"",
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": "\"Windows\"",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
      },
    });

    const $ = load(listResult.data);

    // 从所有script标签中提取数据
    let articles: any[] = [];

    $("script").each((index, element) => {
      const scriptContent = $(element).html();
      if (scriptContent && scriptContent.includes("window.initialState")) {
        try {
          // 提取window.initialState对象
          const initialStateMatch = scriptContent.match(/window\.initialState\s*=\s*({[\s\S]*?})(?=\s*$|;)/);
          if (initialStateMatch) {
            const initialState = JSON.parse(initialStateMatch[1]);

            // 获取information.informationList.itemList数据
            if (initialState?.information?.informationList?.itemList) {
              articles = initialState.information.informationList.itemList;
            }
          }
        } catch (error) {
          console.error("解析36氪JSON数据失败:", error);
        }
      }
    });

    if (articles.length === 0) {
      console.warn("未找到36氪数据，尝试使用HTML解析方式");
      // 备选方案：从HTML中解析
      articles = parseFromHTML($);
    }

    // 获取文章详情（限制并发数量避免过载）
    const batchSize = 5;
    const articleDetails = [];

    for (let i = 0; i < articles.length; i += batchSize) {
      const batch = articles.slice(i, i + batchSize);
      const batchPromises = batch.map(async (article: any, index: number) => {
        try {
          // 从数据中获取基本信息
          const itemId = article.itemId || article.templateMaterial?.itemId;
          const templateMaterial = article.templateMaterial || {};
          const title = templateMaterial.widgetTitle || article.title;
          const summary = templateMaterial.summary || article.summary;
          const authorName = templateMaterial.authorName || article.authorName;
          const publishTime = templateMaterial.publishTime || article.publishTime;
          const widgetImage = templateMaterial.widgetImage || article.widgetImage;
          const authorRoute = templateMaterial.authorRoute || article.authorRoute;

          if (!itemId || !title) {
            console.error(`文章ID或标题为空: ${itemId}, ${title}`);
            return null;
          }

          // 构建详情页URL
          const detailUrl = `https://www.36kr.com/p/${itemId}`;

          // 转换时间戳
          const timestamp = publishTime ? getTime(parseInt(publishTime) / 1000) : undefined;

          let content = summary;

          // 尝试获取详情页内容
          try {
            const detailResult = await get({
              url: detailUrl,
              noCache: false, // 详情页可以使用缓存
              headers: {
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
                "Referer": listUrl,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
              },
            });

            const $detail = load(detailResult.data);

            // 提取文章内容
            const articleContent = extractContent(detailResult.data);
            if (articleContent && articleContent.length > (summary?.length || 0)) {
              content = articleContent;
            }
          } catch (error) {
            console.error(`获取文章详情失败 ${detailUrl}:`, error);
            // 如果获取详情失败，继续使用简介作为内容
          }

          return {
            id: itemId.toString(),
            title: title,
            url: detailUrl,
            mobileUrl: detailUrl,
            author: authorName || "36氪",
            content: content || "暂无内容",
            timestamp,
            hot: 0, // hot字段是必需的，设置为0
            cover: widgetImage ? (widgetImage.startsWith("http") ? widgetImage : `https:${widgetImage}`) : undefined,
          };
        } catch (error) {
          console.error(`处理文章失败 ${article.itemId}:`, error);
          return null;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      articleDetails.push(...(batchResults.filter(Boolean) as NonNullable<typeof batchResults[number]>[]));
    }

    // 按时间过滤：根据days参数过滤新闻
    const filteredData = articleDetails.filter(item => {
      if (!item || !item.timestamp) {
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
    console.error("获取36氪科技新闻失败:", error);

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

// 备选方案：从HTML中解析数据
function parseFromHTML($: any): any[] {
  const articles: any[] = [];

  // 尝试从常见的HTML结构中解析
  $(".information-item").each((index: number, element: any) => {
    const $item = $(element);
    const title = $item.find("h3, .title").text().trim();
    const url = $item.find("a").attr("href");
    const author = $item.find(".author, .name").text().trim();
    const timeStr = $item.find(".time, .date").text().trim();
    const summary = $item.find(".desc, .summary").text().trim();

    if (title && url) {
      articles.push({
        itemId: `fallback_${index}`,
        title,
        url: url.startsWith("http") ? url : `https://www.36kr.com${url}`,
        authorName: author || "36氪",
        summary,
        publishTime: timeStr ? Date.now() : undefined,
      });
    }
  });

  return articles;
}

// 辅助函数：提取文章内容
function extractContent(htmlContent: string): string {
  if (!htmlContent) return "";

  const $ = load(htmlContent);

  // 优先从主要内容区域获取
  let content = "";

  // 尝试从不同的内容选择器获取内容
  const contentSelectors = [
    ".article-content",
    ".content-text",
    ".article-body",
    ".markdown-body",
    "article",
    ".post-content",
    "[data-article-content]"
  ];

  for (const selector of contentSelectors) {
    const $content = $(selector);
    if ($content.length > 0) {
      content = $content.text().trim();
      if (content.length > 50) {
        break; // 如果内容长度足够，使用这个选择器
      }
    }
  }

  // 如果没有找到合适的内容，尝试从段落中提取
  if (!content || content.length < 50) {
    const paragraphs = $("p").map((i, el) => {
      const text = $(el).text().trim();
      // 过滤掉可能的编辑信息、时间戳等
      if (!text.includes('责任编辑') && !text.includes('来源：') && text.length > 20) {
        return text;
      }
      return '';
    }).get();

    content = paragraphs.join(' ');
  }

  // 清理HTML标签和多余空格
  content = content.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

  // 限制内容长度
  if (content.length > 1000) {
    content = content.substring(0, 1000) + '...';
  }

  return content || "暂无内容";
}