import type { RouterData, Options, RouterResType, ListContext } from "../types.js";
import type { RouterType } from "../router.types.js";
import { load } from "cheerio";
import { get } from "../utils/getData.js";
import { getTime } from "../utils/getTime.js";
import iconv from "iconv-lite";

// 将 get() 返回的结果解析为 HTML 字符串，兼容缓存为字符串或 Axios 原始响应（arraybuffer）
const decodeHtmlFromGet = (result: any): string => {
  try {
    const payload = result?.data;
    // 如果缓存里直接是字符串 HTML
    if (typeof payload === 'string') return payload;

    // payload 期望是 Axios Response
    const axiosResp = payload;
    let raw = axiosResp?.data;
    // 兜底：如果 data 为空，返回空字符串避免 Buffer 报错
    if (raw == null) return '';

    let buf: Buffer;
    if (Buffer.isBuffer(raw)) {
      buf = raw as Buffer;
    } else if (raw instanceof ArrayBuffer) {
      buf = Buffer.from(raw as ArrayBuffer);
    } else if (ArrayBuffer.isView(raw)) {
      const view = raw as ArrayBufferView;
      buf = Buffer.from(view.buffer);
    } else if (typeof raw === 'string') {
      return raw as string;
    } else {
      // 尝试转换为 Buffer
      buf = Buffer.from(raw as any);
    }

    // 检测编码
    const headers = axiosResp?.headers || {};
    const ct: string = headers['content-type'] || headers['Content-Type'] || '';
    let encoding = ((/charset=([^;]+)/i.exec(ct) || [])[1] || '').toLowerCase();

    if (!encoding) {
      const headAscii = buf.toString('ascii', 0, Math.min(buf.length, 2048));
      const m = headAscii.match(/charset\s*=\s*([\w-]+)/i);
      if (m) encoding = m[1].toLowerCase();
    }

    if (encoding.includes('gbk') || encoding.includes('gb2312')) {
      return iconv.decode(buf, 'gbk');
    }
    return iconv.decode(buf, 'utf8');
  } catch {
    return '';
  }
};

// 分类：经济-科技、健康
const urlMap: Record<string, string> = {
  default: "http://finance.people.com.cn/GB/414330/index.html",
  finance: "http://finance.people.com.cn/GB/414330/index.html",
  health: "http://health.people.com.cn/GB/408565/index.html",
  world: "https://world.people.com.cn/GB/157278/index.html",
  military: "http://military.people.com.cn/GB/172467/index.html",
  education: "http://edu.people.com.cn/GB/1053/index.html",
};

// 频道配置与工具
type ChannelType = "finance" | "health" | string;

interface ChannelConfig {
  type: ChannelType;
  listUrl: string;
  baseOrigin: string;
  strictDetailTime: boolean; // 是否严格使用详情页的时间
  isHealth: boolean;
  defaultSource: string;
  titleSelectors: string[];
  timeSelectors: string[];
  authorSelectors: string[];
  contentSelectors: string[]; // 主正文容器选择器
  fallbackParagraphContainers: string[]; // 备用段落容器
  listContainerSelectors?: string[]; // 列表容器范围（限定 ul/li 解析范围）
  metaBarPreferred?: boolean; // 是否优先从 meta 信息条解析时间和来源
  metaBarSelectors?: string[]; // meta 信息条的选择器（如 .chaoxi_focus, .col-1-1）
}

const getChannelConfig = (type: ChannelType): ChannelConfig => {
  const listUrl = urlMap[type] || urlMap.default;
  const baseOrigin = new URL(listUrl).origin;
  const isHealth = type === "health" || /health\.people\.com\.cn/.test(listUrl);
  const cfg: ChannelConfig = {
    type,
    listUrl,
    baseOrigin,
    strictDetailTime: type === "finance",
    isHealth,
    defaultSource: "人民网",
  // 标题选择器：不要使用 .chaoxi_focus（它是时间/来源信息条）
  titleSelectors: ["h1", ".title", ".article-title"],
    timeSelectors: [
      ".date",
      ".time",
      ".publish-time",
      ".news-time",
      ".art_time",
      ".source-time",
      ".article-time",
      ".artOri",
      "#p_publishtime",
      "p[class*='time']",
      "span[class*='time']",
      "div[class*='time']",
      "div.col-1-1",
      ".author_time"
    ],
    authorSelectors: [
      ".author",
      ".source",
      "p.source",
      "#p_source",
      "span.source",
      "div.source",
      ".article-author",
      ".news-author",
      "span[class*='author']",
      ".edit"
    ],
    contentSelectors: isHealth
      ? [
          ".artDet",
        ]
      : [
          "#rwb_zw",
          ".article-content",
          ".content",
          ".art_content",
          ".news-content",
          ".main-content",
          ".article-body",
          ".art_text",
          "#content",
          ".detail-content",
        ],
    fallbackParagraphContainers: isHealth
      ? [".artDet"]
      : ["#rwb_zw", ".article-content", ".content", ".main-content", ".article-body", ".detail-content"],
    metaBarPreferred: type === "finance", // 缺省仅财经启用，下面对 world/military 再开启
    metaBarSelectors: [".chaoxi_focus", "div.col-1-1"],
  };

  // 频道专项配置
  if (type === "world") {
    cfg.metaBarPreferred = true; // 国际频道同样采用 meta 信息条
    cfg.listContainerSelectors = ["body > div:nth-of-type(5) > div:nth-of-type(1) > div:nth-of-type(1)"];
    // 详情正文容器：/html/body/div[1]/div[8]/div[1]/div[4]
    cfg.contentSelectors = [
      "body > div:nth-of-type(1) > div:nth-of-type(8) > div:nth-of-type(1) > div:nth-of-type(4)"
    ];
    cfg.fallbackParagraphContainers = [
      "body > div:nth-of-type(1) > div:nth-of-type(8) > div:nth-of-type(1) > div:nth-of-type(4)"
    ];
  }
  if (type === "military") {
    cfg.metaBarPreferred = true; // 军事频道同样采用 meta 信息条
    cfg.listContainerSelectors = ["body > div:nth-of-type(4) > div:nth-of-type(1) > div:nth-of-type(2)"];
    // 详情正文容器：/html/body/div[1]/div[8]/div[1]/div[4]
    cfg.contentSelectors = [
      "body > div:nth-of-type(1) > div:nth-of-type(8) > div:nth-of-type(1) > div:nth-of-type(4)"
    ];
    cfg.fallbackParagraphContainers = [
      "body > div:nth-of-type(1) > div:nth-of-type(8) > div:nth-of-type(1) > div:nth-of-type(4)"
    ];
  }
  if (type === "education") {
    cfg.metaBarPreferred = true; // 教育频道采用相同的信息条结构
    cfg.listContainerSelectors = ["body > div:nth-of-type(5) > div:nth-of-type(1) > div:nth-of-type(2)"];
    // 详情正文容器同国际/军事
    cfg.contentSelectors = [
      "body > div:nth-of-type(1) > div:nth-of-type(8) > div:nth-of-type(1) > div:nth-of-type(4)"
    ];
    cfg.fallbackParagraphContainers = [
      "body > div:nth-of-type(1) > div:nth-of-type(8) > div:nth-of-type(1) > div:nth-of-type(4)"
    ];
  }
  return cfg;
};

export const handleRoute = async (c: ListContext, noCache: boolean) => {
  const type = (c.req.query("type") as string) || "finance";
  const days = c.req.query("days") || "today"; // 默认只显示今天的
  const listData = await getList({ type, days }, noCache);
  const routeData: RouterData = {
    name: "people-rmb",
    title: "人民网",
    type: type === "health" ? "健康" : type === "world" ? "国际" : type === "military" ? "军事" : type === "education" ? "教育" : "经济-科技",
    params: {
      type: {
        name: "新闻分类",
        type: {
          finance: "经济-科技",
          health: "健康",
          world: "国际",
          military: "军事",
          education: "教育",
        },
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
    link: urlMap[type] || urlMap.default,
    total: listData.data?.length || 0,
    ...listData,
  };
  return routeData;
};

// 获取新闻详情页内容和时间
const getNewsContent = async (url: string, noCache: boolean = false, config?: ChannelConfig): Promise<{ content: string; time?: string; author?: string; title?: string }> => {
  try {
    const result = await get({
      url,
      noCache, // 和列表页面保持一致的缓存逻辑
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Connection": "keep-alive",
      },
      originaInfo: true,
      responseType: "arraybuffer"
    });

  const html = decodeHtmlFromGet(result);
  const $ = load(html);

  // 提取时间信息 - 人民网常见的时间选择器
    let time: string | undefined;
    const timeSelectors = config?.timeSelectors || [];

    // 财经频道：优先从 .chaoxi_focus 信息条解析时间（形如：时间 | 来源：人民网）
    let metaBar: ReturnType<typeof load> | any;
    if (config?.metaBarPreferred) {
      const barSelectors = config?.metaBarSelectors || [".chaoxi_focus", "div.col-1-1"];
      for (const bs of barSelectors) {
        const candidate = $(bs).first();
        if (candidate.length) { metaBar = candidate; break; }
      }
      if (metaBar && metaBar.length) {
        const metaText = metaBar.text().replace(/\s+/g, " ").trim();
        const m = metaText.match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}:\d{2})(?::(\d{2}))?/);
        if (m) {
          const y = m[1];
          const mo = m[2].padStart(2, '0');
          const d = m[3].padStart(2, '0');
          const hhmm = m[4];
          const ss = m[5] ? m[5] : '00';
          time = `${y}-${mo}-${d} ${hhmm}:${ss}`;
        }
      }
    }

    // 健康频道也常见 .artOri 信息块
    const artOri = $(".artOri").first();
    if (artOri.length) {
      const oriText = artOri.text().replace(/\s+/g, " ").trim();
      const m = oriText.match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{2}:\d{2})(?::(\d{2}))?/);
      if (m) {
        const y = m[1];
        const mo = m[2].padStart(2, '0');
        const d = m[3].padStart(2, '0');
        const hhmm = m[4];
        const ss = m[5] ? m[5] : '00';
        time = `${y}-${mo}-${d} ${hhmm}:${ss}`;
      }
    }

    for (const selector of timeSelectors) {
      const timeElement = $(selector).first();
      if (timeElement.length > 0 && !time) {
        const timeText = timeElement.text().trim();
        if (timeText && timeText.length > 5) {
          // 标准化多种时间格式（支持中文 年/月/日）
          const m = timeText.match(/(\d{4})[年\-/](\d{1,2})[月\-/](\d{1,2})[日\s]*([\d:]{5,8})?/);
          if (m) {
            const y = m[1];
            const mo = m[2].padStart(2, '0');
            const d = m[3].padStart(2, '0');
            const t = (m[4] || '00:00:00').length === 5 ? `${m[4]}:00` : (m[4] || '00:00:00');
            time = `${y}-${mo}-${d} ${t}`;
          } else {
            // 常规 "YYYY/MM/DD HH:mm" 或 "YYYY-MM-DD HH:mm:ss" 已由 getTime 兼容
            time = timeText;
          }
          break;
        }
      }
    }

    // 提取作者信息
  let author: string | undefined;
    const authorSelectors = config?.authorSelectors || [];

    // 优先从 meta 信息条中解析“来源：xxx”（财经/国际/军事）
    if (config?.metaBarPreferred && metaBar && metaBar.length && !author) {
      const sourceA = metaBar.find('a').first();
      if (sourceA.length) {
        author = sourceA.text().trim() || undefined;
      } else {
        const text = metaBar.text().replace(/\s+/g,' ').trim();
        const m = text.match(/来源[:：]\s*([^|\s]+)/);
        if (m) author = m[1];
      }
    }

    // 健康频道优先从 .artOri a 中解析来源
    if (artOri && artOri.length) {
      if (!author) {
        const sourceA = artOri.find('a').first();
        if (sourceA.length) {
          author = sourceA.text().trim() || undefined;
        } else {
          const text = artOri.text().replace(/\s+/g,' ').trim();
          const m = text.match(/来源[:：]\s*([^\s]+)/);
          if (m) author = m[1];
        }
      }
    }

    for (const selector of authorSelectors) {
      const authorElement = $(selector).first();
      if (authorElement.length > 0 && !author) {
        let authorText = authorElement.text().trim();
        authorText = authorText.replace(/来源\s*[:：]/, '').trim();
        if (authorText && authorText.length > 0) {
          author = authorText;
          break;
        }
      }
    }

    // 如果没找到作者，使用默认值
    if (!author) {
      author = config?.defaultSource || "人民网";
    }
    // 财经频道作者统一标注为“人民网”，不取记者名
    if (config?.type === "finance") {
      author = config?.defaultSource || "人民网";
    }

    // 详情页标题（健康频道为 .chaoxi_focus）
    // 标题
    let detailTitle: string | undefined;
    const titleSelectors = config?.titleSelectors || ["h1"];
    for (const sel of titleSelectors) {
      const t = $(sel).first().text().trim();
      if (t) { detailTitle = t; break; }
    }

    // 查找正文内容 - 频道定制选择器，避免误抓列表页碎片
    const isHealth = config?.isHealth || /health\.people\.com\.cn/.test(url);
    const contentSelectors = config?.contentSelectors || [];

    let content = "暂无正文内容";
    for (const selector of contentSelectors) {
      const element = $(selector).first();
      if (element.length > 0) {
        const text = element.text().trim();
        if (text && text.length > 50) {
          content = text.replace(/\s+/g, ' ').substring(0, 800) + (text.length > 800 ? '...' : '');
          break;
        }
      }
    }

    // 备用方案：在合理容器范围内查找段落标签
    if (content === "暂无正文内容") {
      const containers = config?.fallbackParagraphContainers || [];
      if (isHealth) {
        const paragraphs = $(".artDet p").toArray().map(p => $(p).text().trim()).filter(text => text.length > 20);
        if (paragraphs.length > 0) {
          const joined = paragraphs.join(' ');
          content = joined.substring(0, 800) + (joined.length > 800 ? '...' : '');
        }
      } else {
        let paragraphs: string[] = [];
        for (const sel of containers) {
          const ps = $(`${sel} p`).toArray().map(p => $(p).text().trim()).filter(text => text.length > 20);
          if (ps.length) { paragraphs = ps; break; }
        }
        if (!paragraphs.length) {
          // 最后兜底再全局取 p，但可能带入噪声
          paragraphs = $("p").toArray().map(p => $(p).text().trim()).filter(text => text.length > 20);
        }
        if (paragraphs.length > 0) {
          const joined = paragraphs.join(' ');
          content = joined.substring(0, 800) + (joined.length > 800 ? '...' : '');
        }
      }
    }

    return { content, time, author, title: detailTitle };
  } catch (error) {
    console.error(`获取人民日报新闻内容失败: ${url}`, error);
    return { content: "正文内容获取失败", author: "人民网" };
  }
};

// 统一的日期范围过滤
const filterByDays = (items: Array<any>, days: string) => {
  return items.filter((item) => {
    const t = item.time;
    if (t) {
      const ts = getTime(t);
      if (ts) {
        const itemDate = new Date(ts);
        const now = new Date();
        let start: Date;
        switch (days) {
          case "today":
            start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            break;
          case "3":
            start = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
            break;
          case "7":
            start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
          case "30":
            start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            break;
          default:
            const n = parseInt(days as string, 10);
            start = !isNaN(n) && n > 0 ? new Date(now.getTime() - n * 86400000) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
        }
        return itemDate >= start;
      }
    }

    const m = item.url.match(/\/(\d{4})\/(\d{2})(\d{2})\//);
    if (m) {
      const y = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10);
      const d = parseInt(m[3], 10);
      const itemDate = new Date(y, mo - 1, d);
      const now = new Date();
      let start: Date;
      switch (days) {
        case "today":
          start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case "3":
          start = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
          break;
        case "7":
          start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case "30":
          start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        default:
          const n = parseInt(days as string, 10);
          start = !isNaN(n) && n > 0 ? new Date(now.getTime() - n * 86400000) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
      }
      return itemDate >= start;
    }
    return true;
  });
};

// 构建完整链接
const buildFullUrl = (href: string, baseOrigin: string) => {
  if (href.startsWith("/")) return `${baseOrigin}${href}`;
  if (href.startsWith("n1/")) return `${baseOrigin}/${href}`;
  if (!href.startsWith("http")) return `${baseOrigin}/${href}`;
  return href;
};

// 解析列表页
const parseList = ($: ReturnType<typeof load>, cfg: ChannelConfig) => {
  const newsItems: Array<{
    id: string;
    title: string;
    url: string;
    time?: string;
    source?: string;
  }> = [];

  if (cfg.isHealth) {
    // 健康频道：在 .columWrap 下的 .newsItems 才是文章列表
    $(".columWrap .newsItems").each((index: number, element: any) => {
      const $item = $(element);
      const $a = $item.find("a[href*='.html']").first();
      const title = $a.text().trim();
      const href = $a.attr("href");
      const time = $item.find(".n_time").first().text().trim() || undefined;
      if (!title || !href || !href.includes('.html')) return;
      const fullUrl = buildFullUrl(href, cfg.baseOrigin);
      const id = (href.split("/").pop() || href).replace(".html", "");
      newsItems.push({ id, title, url: fullUrl, time, source: "人民网" });
    });

    // 兜底：仅在 .columWrap 范围内查找链接，避免导航区
    if (newsItems.length === 0) {
      $(".columWrap a[href*='.html']").each((index: number, el: any) => {
        const $a = $(el);
        const title = $a.text().trim();
        const href = $a.attr("href");
        if (!title || !href || !href.includes('.html')) return;
        if (title.length < 6) return;
        const fullUrl = buildFullUrl(href, cfg.baseOrigin);
        const id = href.split('/').pop()?.replace('.html','') || `people-${index}`;
        newsItems.push({ id, title, url: fullUrl, source: "人民网" });
      });
    }
  } else if (cfg.listContainerSelectors && cfg.listContainerSelectors.length) {
    // 世界/军事：限定在提供的列表容器内解析 ul/li
    for (const sel of cfg.listContainerSelectors) {
      const $container = $(sel).first();
      if (!$container.length) continue;
      $container.find("ul li a[href*='.html']").each((index: number, element: any) => {
        const $a = $(element);
        const title = $a.text().trim();
        const href = $a.attr("href");
        if (!title || !href || !href.includes('.html')) return;
        const fullUrl = buildFullUrl(href, cfg.baseOrigin);
        const id = (href.split("/").pop() || href).replace(".html", "");
        newsItems.push({ id, title, url: fullUrl, source: "人民网" });
      });
      if (newsItems.length) break; // 命中一个容器即可
    }
    // 如果仍为空，做一次全局兜底但尽量克制
    if (newsItems.length === 0) {
      $("a[href*='.html']").each((index: number, el: any) => {
        const $a = $(el);
        const title = $a.text().trim();
        const href = $a.attr("href");
        if (!title || !href || !href.includes('.html')) return;
        if (title.length < 6) return;
        const fullUrl = buildFullUrl(href, cfg.baseOrigin);
        const id = href.split('/').pop()?.replace('.html','') || `people-${index}`;
        newsItems.push({ id, title, url: fullUrl, source: "人民网" });
      });
    }
  } else {
    // 财经等频道：采用通用结构
    $(".ej_list_box ul.list_16 li").each((index: number, element: any) => {
      const $li = $(element);
      const $a = $li.find("a[href*='.html']").first();
      const $em = $li.find("em").first();
      const title = $a.text().trim();
      const href = $a.attr("href");
      const time = $em.length ? $em.text().trim() : undefined;
      if (!title || !href || !href.includes(".html")) return;

      const fullUrl = buildFullUrl(href, cfg.baseOrigin);
      const id = (href.split("/").pop() || href).replace(".html", "");
      newsItems.push({ id, title, url: fullUrl, time, source: "人民网" });
    });
  }

  // 教育频道过滤掉包含“每日一句/每日一闻/每日一题”的标题
  const filteredForType = cfg.type === "education"
    ? newsItems.filter((i) => !/(每日一句|每日一闻|每日一题)/.test(i.title))
    : newsItems;

  const uniqueNews = Array.from(new Map(filteredForType.map((i) => [i.url, i])).values()).slice(0, 30);
  return uniqueNews;
};

const getList = async (options: Options, noCache: boolean): Promise<RouterResType> => {
  const { type = "finance", days = "today" } = options as { type?: string; days?: string };
  const cfg = getChannelConfig(type);

  const result = await get({
    url: cfg.listUrl,
    noCache,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "Connection": "keep-alive",
      "Referer": cfg.listUrl,
    },
    originaInfo: true,
    responseType: "arraybuffer"
  });

  const html = decodeHtmlFromGet(result);
  const $ = load(html);

  const uniqueNews = parseList($, cfg);

  const newsWithContent = await Promise.all(
    uniqueNews.map(async (item) => {
      const { content, time: contentTime, author, title: detailTitle } = await getNewsContent(item.url, noCache, cfg);
      return {
        ...item,
        title: detailTitle || item.title,
        content,
        time: cfg.strictDetailTime ? contentTime : (contentTime || item.time),
        source: author || item.source,
      } as typeof item & { content?: string };
    })
  );

  const filteredNews = filterByDays(newsWithContent, days as string);

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
    data: filteredNews.map((v) => ({
      id: v.id,
      title: v.title,
      author: v.source,
      content: (v as any).content,
      timestamp: v.time ? getTime(v.time) : undefined,
      hot: undefined,
      url: v.url,
      mobileUrl: v.url,
    })),
  };
};