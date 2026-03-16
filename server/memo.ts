import { promises as fs } from "node:fs";
import path from "node:path";
import { PATHS } from "./config";

function getYesterdayDateStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function sanitizeContent(text: string) {
  return text
    .replace(/ou_[a-f0-9]+/g, "[用户]")
    .replace(/user_id="[^"]+"/g, "user_id=\"[隐藏]\"")
    .replace(/\/root\/[^"\s]+/g, "[路径]")
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "[IP]")
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[邮箱]")
    .replace(/1[3-9]\d{9}/g, "[手机号]");
}

function extractMemoFromContent(content: string) {
  const lines = content.trim().split("\n");
  const core: string[] = [];
  for (const lineRaw of lines) {
    const line = lineRaw.trim();
    if (!line) continue;
    if (line.startsWith("#")) continue;
    if (line.startsWith("- ")) core.push(line.slice(2).trim());
    else if (line.length > 10) core.push(line);
  }

  if (core.length === 0) {
    return "「昨日无事记录」\n\n若有恒，何必三更眠五更起；最无益，莫过一日曝十日寒。";
  }

  const selected = core.slice(0, 3);
  const quotes = [
    "「工欲善其事，必先利其器。」",
    "「不积跬步，无以至千里；不积小流，无以成江海。」",
    "「知行合一，方可致远。」",
    "「业精于勤，荒于嬉；行成于思，毁于随。」",
    "「路漫漫其修远兮，吾将上下而求索。」",
    "「昨夜西风凋碧树，独上高楼，望尽天涯路。」",
    "「衣带渐宽终不悔，为伊消得人憔悴。」",
    "「众里寻他千百度，蓦然回首，那人却在，灯火阑珊处。」",
    "「世事洞明皆学问，人情练达即文章。」",
    "「纸上得来终觉浅，绝知此事要躬行。」"
  ];
  const quote = quotes[Math.floor(Math.random() * quotes.length)];

  const result: string[] = [];
  for (let point of selected) {
    point = sanitizeContent(point);
    if (point.length > 40) point = `${point.slice(0, 37)}...`;
    if (point.length <= 20) {
      result.push(`· ${point}`);
    } else {
      for (let i = 0; i < point.length; i += 20) {
        const chunk = point.slice(i, i + 20);
        result.push(i === 0 ? `· ${chunk}` : `  ${chunk}`);
      }
    }
  }

  if (quote) {
    if (quote.length <= 20) {
      result.push(`\n${quote}`);
    } else {
      for (let i = 0; i < quote.length; i += 20) {
        const chunk = quote.slice(i, i + 20);
        result.push(i === 0 ? `\n${chunk}` : chunk);
      }
    }
  }

  return result.join("\n").trim();
}

export async function getYesterdayMemo() {
  try {
    const yesterday = getYesterdayDateStr();
    const yesterdayFile = path.join(PATHS.memoryDir, `${yesterday}.md`);

    let targetFile: string | null = null;
    let targetDate = yesterday;

    try {
      await fs.access(yesterdayFile);
      targetFile = yesterdayFile;
    } catch {
      try {
        const files = await fs.readdir(PATHS.memoryDir);
        const mdFiles = files.filter((f) => /\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().reverse();
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
        for (const f of mdFiles) {
          if (f === `${todayStr}.md`) continue;
          targetFile = path.join(PATHS.memoryDir, f);
          targetDate = f.replace(/\.md$/, "");
          break;
        }
      } catch {
        targetFile = null;
      }
    }

    if (!targetFile) {
      return { success: false, msg: "没有找到昨日日记" };
    }

    const content = await fs.readFile(targetFile, "utf-8");
    const memo = extractMemoFromContent(content);
    return { success: true, date: targetDate, memo };
  } catch (e: any) {
    return { success: false, msg: String(e?.message || e) };
  }
}
