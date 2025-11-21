import type { RouterData, ListContext, Options, RouterResType } from "../types.js";
import type { RouterType } from "../router.types.js";
import { load } from "cheerio";
import { get } from "../utils/getData.js";
import { getTime } from "../utils/getTime.js";
import { config } from "../config.js";

const typeMap: Record<string, string> = {
  world: "国际新闻",
  politics: "时政新闻",
  tech: "科技新闻",
  finance: "金融新闻",
  health: "健康新闻",
};

const urlMap: Record<string, string> = {
  world: "http://www.news.cn/worldpro/gjxw/index.html",
  politics: "https://www.news.cn/politics/szlb/index.html",
  tech: "https://www.news.cn/tech/index.html",
  finance: "https://www.news.cn/money/index.html",
  health: "https://www.news.cn/health/index.html",
};

export const handleRoute = async (c: ListContext, noCache: boolean) => {
  const type = c.req.query("type") || "world";
  const days = c.req.query("days") || "today"; // 默认只显示今天的
  const listData = await getList({ type, days }, noCache);
  const routeData: RouterData = {
    name: "xinhua",
    title: "新华网",
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
    link: urlMap[type] || urlMap.world,
    total: listData.data?.length || 0,
    ...listData,
  };
  return routeData;
};

// 获取新闻详情页内容和时间
const getNewsContent = async (url: string, noCache: boolean = false): Promise<{ content: string; time?: string }> => {
  try {
    const result = await get({
      url,
      noCache, // 和列表页面保持一致的缓存逻辑
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
    });

    const $ = load(result.data);

    // 提取时间信息
    let time: string | undefined;
    const timeElement = $(".header-time .year, .header-time .day, .header-time .time");
    if (timeElement.length > 0) {
      const year = $(".header-time .year em").text().trim() || new Date().getFullYear().toString();
      const day = $(".header-time .day").text().trim();
      const timeOfDay = $(".header-time .time").text().trim();

      if (day && timeOfDay) {
        time = `${year}/${day} ${timeOfDay}`;
      }
    }

    // 查找正文内容
    const contentSelectors = [
      "#detail",
      ".detail",
      ".article-content",
      ".content",
      ".main-content",
      "div[id*='detail']",
      "div[class*='content']",
      ".article-body"
    ];

    let content = "暂无正文内容";
    for (const selector of contentSelectors) {
      const text = $(selector).text().trim();
      if (text && text.length > 50) {
        content = text.replace(/\s+/g, ' ').substring(0, 500) + (text.length > 10000 ? '...' : '');
        break;
      }
    }

    // 备用方案：查找段落标签
    if (content === "暂无正文内容") {
      const paragraphs = $("p").toArray().map(p => $(p).text().trim()).filter(text => text.length > 20);
      if (paragraphs.length > 0) {
        content = paragraphs.slice(0, 3).join(' ').substring(0, 500) + (paragraphs.join(' ').length > 1000 ? '...' : '');
      }
    }

    return { content, time };
  } catch (error) {
    console.error(`获取新闻内容失败: ${url}`, error);
    return { content: "正文内容获取失败" };
  }
};

// 判断日期是否在指定范围内
const isDateInRange = (dateStr: string, url?: string, days: string = "today"): boolean => {
  if (!dateStr && !url) {
    return true; // 如果都没有信息，默认通过
  }

  const now = new Date();
  let targetDate: Date;

  // 根据days参数确定目标日期范围
  switch (days) {
    case "today":
      targetDate = now;
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
        targetDate = now;
      }
  }

  const targetStr = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`;
  const targetCompact = `${targetDate.getFullYear()}${String(targetDate.getMonth() + 1).padStart(2, '0')}${String(targetDate.getDate()).padStart(2, '0')}`;

  // 1. 检查URL中是否包含目标日期 (如: /20251121/)
  if (url && url.includes(targetCompact)) {
    return true;
  }

  // 2. 检查日期字符串中是否包含目标日期
  if (dateStr.includes(targetCompact)) {
    return true;
  }

  // 3. 处理标准日期格式
  if (dateStr.includes('-')) {
    // 处理 YYYY-MM-DD HH:MM:SS 格式
    const datePart = dateStr.split(' ')[0];
    return datePart === targetStr;
  } else if (dateStr.includes('/')) {
    // 处理 YYYY/MM/DD HH:MM:SS 格式
    const datePart = dateStr.split(' ')[0];
    const [year, month, day] = datePart.split('/');
    const formatted = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    return formatted === targetStr;
  }

  return false;
};

const getList = async (options: Options, noCache: boolean): Promise<RouterResType> => {
  const { type, days = "today" } = options;
  const url = urlMap[type as string] || urlMap.world;

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

  const newsItems: Array<{
    id: string;
    title: string;
    url: string;
    time?: string;
    source?: string;
  }> = [];

  // 查找新闻列表 - 专门匹配新华网的HTML结构
  $("#list.list").each((_, listElement) => {
    const $listContainer = $(listElement);

    //console.log(`找到新闻列表容器，包含 ${$listContainer.find("div.item, div[class*='item']").length} 个item元素`);

    // 查找新闻项 - 匹配 .item.item-style1 和 .item.item-style2
    $listContainer.find("div.item, div[class*='item']").each((index, element) => {
      const $element = $(element);

      // 检查是否有内容，跳过空的div占位符
      const elementText = $element.text().trim();
      //console.log(`第${index + 1}个item文本长度: ${elementText.length}, 内容: ${elementText.substring(0, 50)}`);

      if (elementText.length < 5) {
        return; // 跳过空的占位符
      }

      // 查找标题链接 - 优先查找直接的 span a，然后查找复杂的 .txt .tit span a
      let titleElement = $element.find("span a[href*='.html']").first();
      if (titleElement.length === 0) {
        titleElement = $element.find(".txt .tit span a, div.txt div.tit span a, .tit span a").first();
      }
      //console.log(`第${index + 1}个item找到的标题链接数量: ${$element.find("span a[href*='.html'], .txt .tit span a, div.txt div.tit span a, .tit span a").length}`);

      if (titleElement.length > 0) {
        const title = titleElement.text().trim();
        const href = titleElement.attr("href");
       // console.log(`第${index + 1}个item - 标题: ${title}, 链接: ${href}`);

        if (title && href && href.includes(".html") && title.length > 5) {
          // 处理相对链接
          let fullUrl = href;
          if (href.startsWith("/")) {
            fullUrl = "https://www.news.cn" + href;
          } else if (href.startsWith("http")) {
            fullUrl = href;
          } else {
            const baseUrlPrefix = type === "politics" ? "https://www.news.cn/politics/" :
                                   type === "tech" ? "https://www.news.cn/tech/" :
                                   type === "finance" ? "https://www.news.cn/money/" :
                                   type === "health" ? "https://www.news.cn/health/" :
                                   "http://www.news.cn/worldpro/";
            fullUrl = `${baseUrlPrefix}${href}`;
          }

          // 查找时间信息 - 在当前元素或其子元素中查找
          let time: string | undefined;
          let timeElement = $element.find(".time, .date, [class*='time'], [class*='date'], .publish-time, .news-time").first();

          if (timeElement.length === 0) {
            // 在父元素中查找
            timeElement = $element.parent().find(".time, .date, [class*='time'], [class*='date'], .publish-time, .news-time").first();
          }

          if (timeElement.length > 0) {
            time = timeElement.text().trim();
          }

          // 从URL中提取ID - 提取路径中的唯一标识部分
          let id: string;
          const urlParts = href.split("/");
          const idIndex = urlParts.findIndex(part => part.includes(".html"));

          if (idIndex > 1) {
            // 获取 .html 前面的部分作为ID
            const potentialId = urlParts[idIndex - 1];
            if (potentialId && /^[a-f0-9]{32}$/.test(potentialId)) {
              id = potentialId;
            } else {
              id = href.split("/").pop()?.replace(".html", "") || `xinhua-${type}_${index}`;
            }
          } else {
            id = href.split("/").pop()?.replace(".html", "") || `xinhua-${type}_${index}`;
          }

          newsItems.push({
            id,
            title,
            url: fullUrl,
            time,
            source: "新华网",
          });
        }
      }
    });
  });

  // 如果上面没有找到，尝试更宽泛的选择器
  if (newsItems.length === 0) {
    // 查找所有可能的新闻链接
    $("a[href*='.html']").each((index, element) => {
      const $element = $(element);
      const title = $element.text().trim();
      const href = $element.attr("href");

      // 过滤掉非新闻链接
      if (title && href && title.length > 10 && href.includes(".html") &&
          (href.includes("news") || href.includes("politics") || href.includes("world") || href.includes("tech") || href.includes("money") || href.includes("health"))) {

        let fullUrl = href;
        if (href.startsWith("/")) {
          fullUrl = "https://www.news.cn" + href;
        } else if (!href.startsWith("http")) {
          const baseUrlPrefix = type === "politics" ? "https://www.news.cn/politics/" :
                                 type === "tech" ? "https://www.news.cn/tech/" :
                                 type === "finance" ? "https://www.news.cn/money/" :
                                 type === "health" ? "https://www.news.cn/health/" :
                                 "http://www.news.cn/worldpro/";
          fullUrl = `${baseUrlPrefix}${href}`;
        }

        // 从URL中提取ID
        let id: string;
        const urlParts = href.split("/");
        const idIndex = urlParts.findIndex(part => part.includes(".html"));

        if (idIndex > 1) {
          const potentialId = urlParts[idIndex - 1];
          if (potentialId && /^[a-f0-9]{32}$/.test(potentialId)) {
            id = potentialId;
          } else {
            id = href.split("/").pop()?.replace(".html", "") || `xinhua-${type}_${index}`;
          }
        } else {
          id = href.split("/").pop()?.replace(".html", "") || `xinhua-${type}_${index}`;
        }

        // 尝试在附近找时间信息
        let time: string | undefined;
        const parentElement = $element.parent();
        if (parentElement.length > 0) {
          const timeElement = parentElement.find(".time, .date, [class*='time'], [class*='date'], span").first();
          time = timeElement.length > 0 ? timeElement.text().trim() : undefined;
        }

        newsItems.push({
          id,
          title,
          url: fullUrl,
          time,
          source: "新华网",
        });
      }
    });
  }

  console.log(`找到 ${newsItems.length} 条新闻`);

  // 去重并限制数量 - 增加到50条以获取更多今天的新闻
  const uniqueNews = Array.from(
    new Map(newsItems.map(item => [item.url, item])).values()
  ).slice(0, 50);

  // 获取每条新闻的正文内容和时间
  const newsWithContent = await Promise.all(
    uniqueNews.map(async (item) => {
      try {
        const { content, time: contentTime } = await getNewsContent(item.url, noCache);
        return {
          ...item,
          content,
          time: contentTime || item.time, // 优先使用详情页的时间
        };
      } catch (error) {
        console.error(`获取新闻内容失败: ${item.url}`, error);
        return {
          ...item,
          content: "正文内容获取失败",
        };
      }
    })
  );

  // 按时间过滤：根据days参数过滤新闻
  const filteredNews = newsWithContent.filter(item => {
    // 尝试从时间字符串或URL中提取日期信息进行过滤
    const timeString = item.time;

    if (timeString) {
      // 如果有time字符串，尝试解析并过滤
      try {
        const timeObj = getTime(timeString);
        if (timeObj) {
          const itemDate = new Date(timeObj);
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
              targetDate = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
          }

          return itemDate >= targetDate;
        }
      } catch (error) {
        // 如果解析失败，继续下面的逻辑
      }
    }

    // 如果没有有效的时间字符串，使用原有的字符串过滤逻辑或URL过滤
    return isDateInRange(timeString || '', item.url, days);
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
    fromCache: false,
    data: filteredNews.map((v: RouterType["xinhua"] & { content?: string }) => ({
      id: v.id,
      title: v.title,
      author: v.source,
      content: v.content,
      timestamp: v.time ? getTime(v.time) : undefined,
      hot: undefined,
      url: v.url,
      mobileUrl: v.url,
    })),
  };
};