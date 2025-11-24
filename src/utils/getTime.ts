import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import customParseFormat from "dayjs/plugin/customParseFormat.js";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);
// 统一使用东八区
dayjs.tz.setDefault("Asia/Shanghai");

interface CurrentDateTime {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
}

/**
 * 将时间字符串或数字转换为时间戳
 * @param timeInput 时间字符串或数字
 * @returns 时间戳
 */
export const getTime = (timeInput: string | number): number | undefined => {
  try {
    let num: number;

    // 处理字符串的情况
    if (typeof timeInput === "string") {
      // 尝试将字符串直接转换为数字
      num = Number(timeInput);

      if (isNaN(num)) {
  const now = dayjs().tz("Asia/Shanghai");

        // 处理 "00:00"
        if (/^\d{2}:\d{2}$/.test(timeInput)) {
          const [hour, minute] = timeInput.split(":").map(Number);
          return now.set("hour", hour).set("minute", minute).set("second", 0).valueOf();
        }

        // 处理 昨天的时间
        if (/^昨日\s+\d{2}:\d{2}$/.test(timeInput)) {
          const timeStr = timeInput.replace("昨日", "").trim();
          const [hour, minute] = timeStr.split(":").map(Number);
          return now
            .subtract(1, "day")
            .set("hour", hour)
            .set("minute", minute)
            .set("second", 0)
            .valueOf();
        }

        // 处理 今年的日期
        if (/^\d{1,2}月\d{1,2}日$/.test(timeInput)) {
          const [month, day] = timeInput
            .replace("月", "-")
            .replace("日", "")
            .split("-")
            .map(Number);
          return now
            .set("month", month - 1)
            .set("date", day)
            .startOf("day")
            .valueOf();
        }

        // 处理 今年的日期+时间
        if (/^\d{1,2}月\d{1,2}日\s+\d{2}:\d{2}$/.test(timeInput)) {
          const [datePart, timePart] = timeInput.split(" ");
          const [month, day] = datePart.replace("月", "-").replace("日", "").split("-").map(Number);
          const [hour, minute] = timePart.split(":").map(Number);
          return now
            .set("month", month - 1)
            .set("date", day)
            .set("hour", hour)
            .set("minute", minute)
            .set("second", 0)
            .valueOf();
        }

        // 处理 完整年月日+时间
        if (/^\d{4}年\d{1,2}月\d{1,2}日\s+\d{2}:\d{2}$/.test(timeInput)) {
          const [datePart, timePart] = timeInput.split(" ");
          const [year, month, day] = datePart.replace("年", "-").replace("月", "-").replace("日", "").split("-").map(Number);
          const [hour, minute] = timePart.split(":").map(Number);
          return dayjs().tz("Asia/Shanghai")
            .year(year)
            .month(month - 1)
            .date(day)
            .hour(hour)
            .minute(minute)
            .second(0)
            .valueOf();
        }

        // 处理相对时间
        if (/今天/.test(timeInput)) {
          const timeStr = timeInput.replace("今天", "").trim();
          return dayjs().tz("Asia/Shanghai")
            .set("hour", parseInt(timeStr.split(":")[0]))
            .set("minute", parseInt(timeStr.split(":")[1]))
            .valueOf();
        }

        if (/昨天/.test(timeInput)) {
          const timeStr = timeInput.replace("昨天", "").trim();
          return dayjs().tz("Asia/Shanghai")
            .subtract(1, "day")
            .set("hour", parseInt(timeStr.split(":")[0]))
            .set("minute", parseInt(timeStr.split(":")[1]))
            .valueOf();
        }

        // 处理 `N 小时前` 的时间格式
        if (/小时前/.test(timeInput)) {
          const hoursAgo = parseInt(timeInput.replace("小时前", ""));
          return dayjs().tz("Asia/Shanghai").subtract(hoursAgo, "hour").valueOf();
        }

        if (/分钟前/.test(timeInput)) {
          const minutesAgo = parseInt(timeInput.replace("分钟前", ""));
          return dayjs().tz("Asia/Shanghai").subtract(minutesAgo, "minute").valueOf();
        }

        // 处理为标准格式
        let standardizedInput = timeInput
          .replace(/(\d{4})-(\d{2})-(\d{2})-(\d{2})/, "$1-$2-$3 $4") // "YYYY-MM-DD-HH" -> "YYYY-MM-DD HH"
          .replace(/(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):?(\d{2})?:?(\d{2})?/, "$1-$2-$3 $4:$5:$6") // "YYYY-MM-DDTHH:mm:ss" -> "YYYY-MM-DD HH:mm:ss"
          .replace(/(\d{4})[-/](\d{2})[-/](\d{2})/, "$1-$2-$3"); // "YYYY/MM/DD" or "YYYY-MM-DD" -> "YYYY-MM-DD"

        // 减少解析过程中可能的多余空格
        standardizedInput = standardizedInput.replace(/\s+/, " ").trim();

        // 处理标准化后的日期时间字符串
        const formatPatterns = [
          "YYYY-MM-DD HH:mm:ss",
          "YYYY-MM-DD HH:mm",
          "YYYY-MM-DD HH",
          "YYYY-MM-DD",
        ];

        // 将标准化字符串转为东八区 ISO 字符串，确保按 +08:00 解析
        const toShanghaiISO = (input: string): string => {
          const parts = input.split(" ");
          const datePart = parts[0];
          let timePart = parts[1] || "00:00:00";
          if (/^\d{2}:\d{2}$/.test(timePart)) timePart = `${timePart}:00`;
          else if (/^\d{2}$/.test(timePart)) timePart = `${timePart}:00:00`;
          return `${datePart}T${timePart}+08:00`;
        };

        const isoInput = toShanghaiISO(standardizedInput);
        const zoned = dayjs(isoInput);
        if (zoned.isValid()) {
          return zoned.valueOf();
        }

        // 兜底：尝试格式化解析再转换为东八区
        for (const pattern of formatPatterns) {
          const d = dayjs(standardizedInput, pattern, true);
          if (d.isValid()) {
            // 将解析结果视为本地时间，转换到东八区
            const converted = dayjs(`${d.format("YYYY-MM-DD")}T${d.format("HH:mm:ss")}+08:00`);
            if (converted.isValid()) return converted.valueOf();
          }
        }
        return 0;
      }
    } else {
      num = timeInput;
    }

    // 是否为毫秒级时间戳
    if (num > 946684800000) {
      // 以2000年作为毫秒时间戳参考点
      return num;
    } else {
      return num * 1000;
    }
  } catch (error) {
    console.error(error);
  }
};

/**
 * 获取当前日期时间
 * @param padZero 是否补零
 * @returns 当前日期时间
 */
export const getCurrentDateTime = (padZero: boolean = false): CurrentDateTime => {
  const now = dayjs().tz("Asia/Shanghai");

  // 补零
  const pad = (num: number): string => (num < 10 ? `0${num}` : `${num}`);

  return {
    year: now.year().toString(),
    month: padZero ? pad(now.month() + 1) : (now.month() + 1).toString(),
    day: padZero ? pad(now.date()) : now.date().toString(),
    hour: padZero ? pad(now.hour()) : now.hour().toString(),
    minute: padZero ? pad(now.minute()) : now.minute().toString(),
    second: padZero ? pad(now.second()) : now.second().toString(),
  };
};
