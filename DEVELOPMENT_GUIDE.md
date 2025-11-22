# DailyHotAPI 开发规范文档

## 📋 目录
- [接口开发规范](#接口开发规范)
- [字段规范](#字段规范)
- [缓存规范](#缓存规范)
- [时间筛选](#时间筛选)
- [参数规范](#参数规范)
- [路由注册](#路由注册)
- [代码示例](#代码示例)

## 🔧 接口开发规范

### 1. 文件位置
- 所有接口文件位于 `src/routes/` 目录下
- 文件命名使用小写字母连字符：`interface-name.ts`
- 例如：`xinhua.ts`, `unn.ts`, `36kr.ts`

### 2. 必需导出函数
```typescript
export const handleRoute = async (c: ListContext, noCache: boolean) => {
  // 实现逻辑
};
```

### 3. 类型定义
- 必须在 `src/router.types.d.ts` 中添加接口类型定义
- 类型名称必须与文件名一致

## 📊 字段规范

### 必需字段
```typescript
interface RouteItem {
  id: string;           // 唯一标识符
  title: string;         // 标题
  url: string;           // 文章链接
  mobileUrl: string;     // 移动端链接（通常与url相同）
  author: string;       // 作者/来源
  content: string;      // 文章内容
  timestamp: number;    // 时间戳（毫秒）
  hot?: number;         // 热度值
  cover?: string;       // 封面图片URL
}
```

### 可选字段说明
- `hot`: 热门度、热度值或权重
- `cover`: 文章封面图片URL
- 其他自定义字段根据接口需要添加

### 返回数据结构
```typescript
{
  "code": 200,
  "name": "interface-name",
  "title": "接口标题",
  "type": "分类名称",
  "params": {
    "paramName": {
      "name": "参数描述",
      "type": { "value": "显示名", ... }
    }
  },
  "link": "接口源链接",
  "total": 100,
  "updateTime": "2025-11-22 21:30:00",
  "fromCache": false,
  "data": [...]
}
```

## 🗂️ 时间筛选规范

### days 参数
所有支持时间筛选的接口必须包含 `days` 参数：

```typescript
// 参数配置
params: {
  days: {
    name: "时间范围",
    type: {
      "today": "今天",
      "3": "近三天",
      "7": "近一周",
      "30": "近一月"
    }
  }
}

// 获取参数
const days = c.req.query("days") || "today";

// 过滤逻辑
const filteredData = data.filter(item => {
  if (!item.timestamp) return true;

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
      const daysNum = parseInt(days);
      if (!isNaN(daysNum) && daysNum > 0) {
        targetDate = new Date(now.getTime() - daysNum * 24 * 60 * 60 * 1000);
      } else {
        targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      }
  }

  return itemDate >= targetDate;
});
```

## 🚀 缓存规范

### 1. 缓存控制参数
- 通过 `cache` 查询参数控制：`?cache=false` 强制不使用缓存
- `noCache` 参数传递给底层获取函数

### 2. 缓存时间
- 使用 `config.CACHE_TTL` 环境变量配置缓存时间
- 不要硬编码缓存时间

### 3. 缓存返回值
- `fromCache` 字段指示数据是否来自缓存

```typescript
const noCache = c.req.query("cache") === "false";
const listData = await getList({ type }, noCache);
```

### 4. 接口设计
```typescript
export const handleRoute = async (c: ListContext, noCache: boolean) => {
  // 是否采用缓存
  const noCache = c.req.query("cache") === "false";
  // 限制显示条目
  const limit = c.req.query("limit");

  const listData = await getList({ type }, noCache);

  // 是否限制条目
  if (limit && listData?.data?.length > parseInt(limit)) {
    listData.total = parseInt(limit);
    listData.data = listData.data.slice(0, parseInt(limit));
  }

  return { code: 200, ...listData };
};
```

## 📝 参数规范

### 1. 查询参数获取
```typescript
const type = c.req.query("type") || "default-value";
const days = c.req.query("days") || "today";
const limit = c.req.query("limit");
```

### 2. 参数验证
```typescript
const typeMap = {
  "type1": "显示名1",
  "type2": "显示名2"
};

const validType = Object.keys(typeMap).includes(type) ? type : "default";
```

### 3. 参数说明配置
```typescript
params: {
  paramName: {
    name: "参数中文名",
    type: {
      "value1": "显示名1",
      "value2": "显示名2"
    }
  }
}
```

## 🛣️ 路由注册

### 1. 自动注册
- 项目使用自动路由注册系统
- `src/routes/` 目录下的所有 `.ts` 文件自动注册
- 路由路径与文件名一致：`file-name.ts` → `/file-name`

### 2. 路由处理
```typescript
// 注册全部路由 - 由系统自动完成
app.get("/:router", async (c) => {
  const { handleRoute } = await import(`./routes/${router}.js`);
  return await handleRoute(c, noCache);
});
```

### 3. 避免手动路由
- 不要在 `src/index.ts` 中手动添加路由
- 不要在 `src/registry.ts` 中硬编码路由路径

## 📋 代码示例

### 完整接口实现模板
```typescript
import type { RouterData, ListContext, Options, RouterResType } from "../types.js";
import type { RouterType } from "../router.types.js";
import { load } from "cheerio";
import { get } from "../utils/getData.js";
import { getTime } from "../utils/getTime.js";
import { config } from "../config.js";

// 类型映射
const typeMap: Record<string, string> = {
  "type1": "显示名1",
  "type2": "显示名2"
};

// URL映射
const urlMap: Record<string, string> = {
  "type1": "https://example.com/rss1.xml",
  "type2": "https://example.com/rss2.xml"
};

export const handleRoute = async (c: ListContext, noCache: boolean) => {
  const type = c.req.query("type") || "default";
  const days = c.req.query("days") || "today";

  const listData = await getList({ type, days }, noCache);

  const routeData: RouterData = {
    name: "interface-name",
    title: "接口标题",
    type: typeMap[type] || "默认分类",
    params: {
      type: {
        name: "分类名称",
        type: typeMap,
      },
      days: {
        name: "时间范围",
        type: {
          "today": "今天",
          "3": "近三天",
          "7": "近一周",
          "30": "近一月"
        }
      }
    },
    link: urlMap[type] || urlMap["default"],
    total: listData.data?.length || 0,
    ...listData,
  };
  return routeData;
};

const getList = async (options: Options, noCache: boolean): Promise<RouterResType> => {
  const { type = "default", days = "today" } = options;
  const url = urlMap[type] || urlMap["default"];

  try {
    // 获取数据
    const result = await get({
      url,
      noCache,
      headers: {
        "User-Agent": "Mozilla/5.0...",
        "Accept": "application/rss+xml, application/xml, text/xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    // 解析数据（根据数据源使用不同解析方法）
    const list = await parseData(result.data);

    // 数据映射
    const data = list.map((item, index): RouterType["interface-name"] => ({
      id: item.id || `interface_${index}`,
      title: item.title || "暂无标题",
      url: item.url || "",
      mobileUrl: item.url || "",
      author: item.author || "接口名称",
      content: extractContent(item.content || item.description),
      timestamp: item.pubDate ? getTime(item.pubDate) : undefined,
      hot: item.hot,
      cover: item.cover
    }));

    // 时间过滤
    const filteredData = filterByDays(data, days);

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
      data: filteredData,
    };
  } catch (error) {
    console.error(`获取${type}新闻失败: ${error}`);

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

// 辅助函数
function extractContent(htmlContent: string): string {
  if (!htmlContent) return "";

  const $ = load(htmlContent);
  const text = $.text().trim().replace(/\s+/g, ' ');

  return text.length > 500 ? text.substring(0, 500) + '...' : text;
}

function filterByDays(data: any[], days: string): any[] {
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
      const daysNum = parseInt(days);
      if (!isNaN(daysNum) && daysNum > 0) {
        targetDate = new Date(now.getTime() - daysNum * 24 * 60 * 60 * 1000);
      } else {
        targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      }
  }

  return data.filter(item => {
    if (!item.timestamp) return true;

    const itemDate = new Date(item.timestamp);
    return itemDate >= targetDate;
  });
}
```

## 📅 类型定义模板

```typescript
// src/router.types.d.ts
export type RouterType = {
  // ... 其他接口

  "interface-name": {
    id: string;
    title: string;
    url: string;
    mobileUrl: string;
    author: string;
    content?: string;
    timestamp: number | undefined;
    hot?: number | undefined;
    cover?: string;
  };
};
```

## 🎯 开发注意事项

### 1. 错误处理
- 所有网络请求必须有 try-catch 包装
- 提供有意义的错误日志
- 失败时返回空数据，不崩溃接口

### 2. 数据验证
- 验证必需字段存在
- 处理空值和边界情况
- 确保数据类型正确

### 3. 性能考虑
- 合理限制数据长度（如内容字段限制500字符）
- 使用适当的请求头
- 避免不必要的请求嵌套

### 4. 时间格式
- 统一使用 UTC+8 时区（Asia/Shanghai）
- 时间格式：`YYYY-MM-DD HH:mm:ss`
- 时间戳使用毫秒

### 5. 字段完整性
- 确保所有接口返回一致的字段结构
- 可选字段确实可为 undefined 而不是空字符串
- 保持与类型定义一致

### 6. 缓存一致性
- 列表页和详情页缓存逻辑一致
- 缓存参数正确传递到所有调用链
- 更新数据时正确刷新缓存

## ⚠️ TypeScript常见错误修复

### 1. parseInt类型错误
**问题**: `Argument of type 'string | number' is not assignable to parameter of type 'string'`

**解决方案**:
```typescript
// ❌ 错误
const daysNum = parseInt(days);

// ✅ 正确
const daysNum = parseInt(days as string);
```

**位置**: comnews.ts, eastmoney.ts, huanqiu.ts, wallstreetcn.ts, unn.ts 等所有使用parseInt的地方

### 2. 字符串方法调用错误
**问题**: `Property 'replace' does not exist on type 'string | string[]'`

**解决方案**:
```typescript
// ❌ 错误 - content可能是数组
content = content.replace(/<[^>]*>/g, '');

// ✅ 正确 - 确保类型安全
const contentStr = Array.isArray(content) ? content.join(' ') : String(content);
const cleanedContent = contentStr.replace(/<[^>]*>/g, '');
```

**位置**: huanqiu.ts extractContent函数

### 3. 属性访问错误
**问题**: `Property 'description' does not exist on type`

**解决方案**:
```typescript
// ❌ 错误 - 属性不在类型定义中
if (item.description) { }

// ✅ 正确 - 使用类型断言
if ((item as any).description) { }
```

**位置**: unn.ts 访问description和creator属性

### 4. hot字段必需性问题
**问题**: `Property 'hot' is optional but required in type 'ListItem'`

**解决方案**:
```typescript
// ❌ 错误 - hot是可选的
hot: undefined,

// ✅ 正确 - hot是必需的
hot: 0,
```

**修复**: 修改 `src/types.d.ts` 中的ListItem接口：
```typescript
export interface ListItem {
  // ...
  hot: number; // 从 number | undefined 改为 number
  // ...
}
```

### 5. 数组toString问题
**问题**: `Property 'toString' does not exist on type 'never'`

**解决方案**:
```typescript
// ❌ 错误
id = typeof item.guid === 'string' ? item.guid : item.guid.toString();

// ✅ 正确
id = typeof item.guid === 'string' ? item.guid : (item.guid as any).toString();
```

## 🔧 接口开发最佳实践

### 1. 数据获取限制
```typescript
// ✅ 推荐的列表获取限制
$(".content_list li").each((index, element) => {
  if (index >= 50) return false; // 限制只获取前50条
  // 处理逻辑...
});
```

### 2. 并发控制
```typescript
// ✅ 推荐的并发控制
const batchSize = 5; // 限制同时请求数量
const articleDetails = [];

for (let i = 0; i < articles.length; i += batchSize) {
  const batch = articles.slice(i, i + batchSize);
  const batchPromises = batch.map(async (article, index) => {
    // 处理逻辑...
  });

  const batchResults = await Promise.all(batchPromises);
  articleDetails.push(...(batchResults.filter(Boolean) as NonNullable<typeof batchResults[number]>[]));
}
```

### 3. 时间处理优先级
```typescript
// ✅ 推荐的时间获取优先级
const pubtimeText = $detail("#pubtime_baidu").text().trim();
if (pubtimeText) {
  // 1. 优先使用BaiduSpider中的标准ISO格式时间
  timestamp = getTime(pubtimeText); // 格式: "2025-11-22 22:26:04"
} else {
  // 2. 备选：从可见文本中解析中文时间格式
  const timeMatch = timeStr.match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})/);
  if (timeMatch) {
    const date = new Date(year, month - 1, day, hour, minute);
    timestamp = date.getTime();
  }
}
```

### 4. 请求头优化
```typescript
// ✅ 推荐的请求头配置
const headers = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  "Accept-Encoding": "gzip, deflate",
  "Connection": "keep-alive",
  "Referer": baseUrl, // 设置合适的Referer避免反爬
};
```

## 🚀 性能优化指南

### 1. 数据量控制
- **列表获取**: 限制前50条，避免过载
- **内容长度**: 详情内容限制1000字符
- **并发控制**: 详情页获取每批5个请求

### 2. 缓存策略
- **列表页**: `noCache: true` (实时数据)
- **详情页**: `noCache: false` (可用缓存)
- **错误降级**: 失败时使用列表页简介

### 3. 反爬虫应对
- **完整User-Agent**: 模拟真实浏览器
- **Referer设置**: 从列表页跳转
- **请求间隔**: 控制并发请求频率
- **错误重试**: 适度的重试机制

## 🧪 测试和调试

### 1. 本地开发
```bash
# 启动开发服务器
npm run dev

# 测试接口
curl "http://localhost:6688/interface-name"
curl "http://localhost:6688/interface-name?days=3"
curl "http://localhost:6688/interface-name?type=some-type"
```

### 2. 构建验证
```bash
# 确保构建无错误
npm run build

# 检查类型错误
npx tsc --noEmit
```

### 3. 调试技巧
- **网络请求**: 使用浏览器开发者工具分析目标网站
- **HTML解析**: 检查选择器是否正确匹配元素
- **时间解析**: 验证时间格式和转换逻辑
- **缓存问题**: 检查Redis连接和缓存命中

## 📝 今日修复记录

### 2025-11-22 修复内容
1. **36氪科技频道** (`36kr-keji.ts`)
   - 实现JSON数据解析（script async标签）
   - 修复时间戳解析错误
   - 添加类型定义

2. **中新网国际和财经频道** (`chinanews.ts`)
   - 实现列表页和内容页数据解析
   - 优先使用BaiduSpider标准时间格式
   - 添加并发控制和数据量限制

3. **TypeScript编译错误**
   - 修复parseInt类型转换错误（多处）
   - 修复字符串方法类型检查（huanqiu.ts）
   - 修复属性访问权限问题（unn.ts）
   - 修复hot字段必需性问题

4. **接口规范更新**
   - 修改ListItem接口hot字段为必需
   - 统一错误处理和降级策略
   - 完善时间筛选逻辑

## 🔗 相关链接

- [TypeScript 类型系统](https://www.typescriptlang.org/)
- [Hono 框架文档](https://hono.dev/)
- [Cheerio 文档](https://cheerio.js.org/)
- [项目 GitHub](https://github.com/imsyy/DailyHotApi)