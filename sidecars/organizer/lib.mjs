/**
 * Pure, cross-platform parsing and indexing helpers for Conversation Timeline.
 */
import { closeSync, existsSync, openSync, readSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const HEAD_BYTES = 64 * 1024;
export const TAIL_BYTES = 32 * 1024;

export const DEFAULT_PREFS = {
  starred: [],
  aliases: {},
  groupMode: 'ymd',      // 'ymd' | 'ym'
  timeField: 'created',  // 'created' | 'updated'
  hideSubagents: true,
  showCalendar: true,
  translateTitles: false, // false = original native titles, true = translated Chinese titles
  lang: 'auto',          // 'auto' | 'zh' | 'en'
};

const VAGUE_PROMPT_RE = /^(?:1|2|3|ok|yes|好|好的|继续|开始|执行|看看|看下|看看这个|看下这个|看看这个问题|看下这个问题[，,。.\s\w\u4e00-\u9fff]{0,6}|帮我看下|帮我看看|帮我看一下|帮我看下这个需求[^。！？!?]*|处理下这个|处理一下这个|解决下这个|这是什么|怎么解决)/i;
const GENERIC_HEADING_RE = /(?:一句话结论|结论速览|排查结论|问题定位|排查报告|根因分析|根因剖析|原因分析|报错原因|排查证据|解决方案|修复方案|核心结论|总结|背景)/;

export function resolvePaths(env = process.env, home = homedir()) {
  const envData = env.ANTIGRAVITY_EXECUTABLE_DATA_DIR;
  if (envData) {
    for (let d = envData; d !== dirname(d); d = dirname(d)) {
      if (basename(d) === 'sidecar_data') {
        const appData = dirname(d);
        return { appDirs: [appData], dataDir: envData };
      }
    }
  }
  const geminiRoot = join(home, '.gemini');
  let appDirs = [join(geminiRoot, 'antigravity')];
  try {
    const found = readdirSync(geminiRoot)
      .sort()
      .map((name) => join(geminiRoot, name))
      .filter((dir) => existsSync(join(dir, 'brain')));
    if (found.length > 0) appDirs = found;
  } catch {
    // Keep default appDirs fallback
  }
  const dataDir = envData || join(appDirs[0], 'sidecar_data', 'conversation-timeline', 'organizer', 'data');
  return { appDirs, dataDir };
}

export function normalizePrefs(raw) {
  const out = { ...DEFAULT_PREFS, starred: [], aliases: {} };
  if (!raw || typeof raw !== 'object') return out;
  if (Array.isArray(raw.starred)) {
    out.starred = [...new Set(
      raw.starred
        .filter((id) => typeof id === 'string' && UUID_RE.test(id))
        .map((s) => s.toLowerCase())
    )].slice(0, 500);
  }
  if (raw.aliases && typeof raw.aliases === 'object') {
    const clean = {};
    for (const [k, v] of Object.entries(raw.aliases)) {
      if (UUID_RE.test(k) && typeof v === 'string' && v.trim()) {
        clean[k.toLowerCase()] = v.trim().slice(0, 120);
      }
    }
    out.aliases = clean;
  }
  if (raw.groupMode === 'ymd' || raw.groupMode === 'ym') out.groupMode = raw.groupMode;
  if (raw.timeField === 'created' || raw.timeField === 'updated') out.timeField = raw.timeField;
  if (typeof raw.hideSubagents === 'boolean') out.hideSubagents = raw.hideSubagents;
  if (typeof raw.showCalendar === 'boolean') out.showCalendar = raw.showCalendar;
  if (typeof raw.translateTitles === 'boolean') out.translateTitles = raw.translateTitles;
  if (raw.lang === 'auto' || raw.lang === 'zh' || raw.lang === 'en') out.lang = raw.lang;
  return out;
}

/**
 * Extracts `title:"..."` from Antigravity's `<appData>/annotations/<id>.pbtxt`,
 * decoding both raw UTF-8 and protobuf C/octal byte escapes.
 */
export function parseAnnotationTitle(pbtxt) {
  if (typeof pbtxt !== 'string' || !pbtxt) return '';
  const m = pbtxt.match(/(?:^|\s)title:\s*"((?:[^"\\]|\\.)*)"/);
  if (!m) return '';
  const raw = m[1];
  if (!raw.includes('\\')) return raw.trim();

  const bytes = [];
  let out = '';
  const flushBytes = () => {
    if (bytes.length > 0) {
      out += Buffer.from(bytes).toString('utf-8');
      bytes.length = 0;
    }
  };

  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== '\\') {
      flushBytes();
      out += raw[i];
      continue;
    }
    const next = raw[i + 1] || '';
    if (/[0-7]/.test(next)) {
      const oct = raw.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)[0];
      bytes.push(parseInt(oct, 8));
      i += oct.length;
    } else {
      flushBytes();
      i++;
      if (next === 'n') out += '\n';
      else if (next === 'r') out += '\r';
      else if (next === 't') out += '\t';
      else out += next;
    }
  }
  flushBytes();
  return out.trim();
}

/**
 * Resolves Antigravity's native sidebar title without replacing it with user prompt text.
 */
export function resolveNativeTitle({ annotationTitle = '', dbTitle = '', dbPreview = '' } = {}) {
  for (const candidate of [annotationTitle, dbTitle, dbPreview]) {
    if (typeof candidate !== 'string') continue;
    const firstLine = candidate.split(/\r?\n/)[0].trim();
    if (firstLine) {
      return firstLine.length > 90 ? `${firstLine.slice(0, 88)}…` : firstLine;
    }
  }
  return 'New Conversation';
}

export function parseWorkspaceName(uri) {
  if (typeof uri !== 'string' || !uri) return '';
  let text = uri;
  try {
    text = decodeURIComponent(uri);
  } catch {
    // Keep undecoded URI if malformed percent-encoding exists
  }
  text = text
    .replace(/^file:\/\/\/?/i, '')
    .replace(/[\\/]+$/, '');
  const parts = text.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || '';
}

export function extractPromptText(rawContent) {
  if (typeof rawContent !== 'string' || !rawContent) return '';
  const match = rawContent.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/i);
  let text = match ? match[1] : rawContent;
  text = text
    .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, '')
    .replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/gi, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .trim();
  return text;
}

/**
 * Strip full local filesystem paths like `@/Users/foo/Downloads/report.docx`
 * or `C:\Users\foo\video.mp4` into concise filenames, and compact long URLs.
 */
export function compactInlineUrls(str) {
  let out = String(str || '');

  // Compact URLs
  out = out.replace(/https?:\/\/([^\s\u4e00-\u9fff]+)/gi, (_full, rest) => {
    const clean = rest.replace(/[),.。，；！!？?]+$/, '');
    const gh = clean.match(/^github\.com\/[^/]+\/([^/?#]+)/i);
    if (gh) return `（${gh[1]}）`;
    if (/feishu\.cn|larksuite\.com/i.test(clean)) return ' ';
    const host = clean.split('/')[0].replace(/^www\./i, '');
    return `（${host}）`;
  });

  // Compact POSIX / Windows local file paths (@/Users/.../file.ext or C:\...\file.ext)
  out = out.replace(
    /@?(?:\/(?:Users|home|var|tmp|opt|private|Volumes)\/|[A-Za-z]:\\)(?:[^\s\u4e00-\u9fff/\\]+[/\\])*([^\s/\\]+\.[A-Za-z0-9]{1,8})/g,
    (_full, file) => `（${file}）`
  );

  // Also handle local paths whose filename contains CJK characters (e.g. /Users/wangqi/Downloads/尚_原文.docx看下...)
  out = out.replace(
    /@?(?:\/(?:Users|home|var|tmp|opt|private|Volumes)\/|[A-Za-z]:\\)(?:[^\s/\\]+[/\\])+([^\s/\\]+?\.[A-Za-z0-9]{1,8})/g,
    (_full, file) => `（${file}）`
  );

  return out;
}

/**
 * If a line starts with an English repo/path/tag like `（escrcpy）这个项目能打卡吗`
 * or `GAMECO_BRANCH 帮我审查代码` while containing Chinese text, put the Chinese
 * clause first so Chinese conversations always start with Chinese characters.
 */
export function promoteChineseClause(line) {
  let s = String(line || '').trim();
  if (!/[\u4e00-\u9fff]/.test(s)) return s;

  const suffixTags = [];

  // Case 1: Leading parenthesized tag(s) `（xxx）中文内容` -> `中文内容（xxx）`
  const leadParen = s.match(/^(?:（([^）]{1,40})）\s*)+([\s\S]+)$/);
  if (leadParen && /[\u4e00-\u9fff]/.test(leadParen[2])) {
    const tag = leadParen[1];
    s = leadParen[2].trim().replace(/^的\s*/, '').replace(/[。.]+$/, '');
    if (!/^(?:微信图片|截屏|Screenshot|image|media_)/i.test(tag)) {
      suffixTags.push(tag);
    }
  }

  // Case 2: Leading long ASCII identifier/branch/API path (>= 8 ASCII chars) followed by Chinese
  const leadAscii = s.match(/^([A-Za-z0-9_./:@\[\]-]{8,})\s*(?:（[^）]*）\s*)*([\u4e00-\u9fff][\s\S]*)$/);
  if (leadAscii && leadAscii[2].length >= 4) {
    const prefix = leadAscii[1].replace(/^@/, '');
    const shortPrefix = prefix.length > 22 ? `${prefix.slice(0, 20)}…` : prefix;
    s = leadAscii[2].trim().replace(/^的\s*/, '').replace(/[。.]+$/, '');
    suffixTags.push(shortPrefix);
  }

  if (suffixTags.length > 0) {
    return `${s}（${suffixTags.join(' · ')}）`;
  }
  return s;
}

export function extractAssistantTopic(assistantContent) {
  if (typeof assistantContent !== 'string' || !assistantContent.trim()) return '';
  const cleaned = assistantContent
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/```[\s\S]*?```/g, ' ');

  const lines = cleaned.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // 1. Check only the opening heading (first 2 lines); if it's a generic section header like "一句话结论", read the sentence beneath it instead of jumping to subheadings
  for (const line of lines.slice(0, 2)) {
    const h = line.match(/^#{1,4}\s+(.+)$/);
    if (h) {
      const heading = h[1].replace(/[*`]/g, '').replace(/^[一二三四五六七八九十0-9]+[、.．)\s]+/, '').trim();
      if (heading.length >= 6 && !(heading.length <= 16 && GENERIC_HEADING_RE.test(heading))) {
        return heading;
      }
    }
  }

  // 2. Join early non-heading lines and extract a complete meaningful clause/topic
  const bodyText = lines
    .filter((l) => !/^#{1,6}\s/.test(l) && !/^[-:|]+$/.test(l))
    .slice(0, 5)
    .map((l) => l.replace(/^[-*>\d.)]+\s*/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  const boldMatch = bodyText.match(/\*\*([^*]{8,44})\*\*/);
  if (boldMatch && /[\u4e00-\u9fff]/.test(boldMatch[1])) {
    return boldMatch[1].trim();
  }

  const cleanBody = bodyText.replace(/[*`]/g, '').trim();
  const clauseEnd = cleanBody.search(/[。！？；\n]/);
  if (clauseEnd >= 8 && clauseEnd <= 48) {
    return cleanBody.slice(0, clauseEnd).trim();
  }
  return cleanBody;
}

export function summarizePrompt(text, artifacts = [], assistantContent = '') {
  const rawLines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^#+\s*/, '').replace(/^>\s*/, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim())
    .filter(Boolean);

  let chosen = '';
  let fallbackTagged = '';
  for (const line of rawLines) {
    const compacted = promoteChineseClause(compactInlineUrls(line).replace(/\s+/g, ' ').trim());
    const strippedNoise = compacted.replace(/（(?:微信图片|截屏|Screenshot|image|media_)[^）]*）/gi, '').trim();
    if (!fallbackTagged && strippedNoise.length >= 2) fallbackTagged = strippedNoise;
    // Prefer a line that has real words outside parenthesized URL/host tags
    const outsideTags = strippedNoise.replace(/（[^）]*）/g, '').trim();
    if (outsideTags.length >= 2) {
      chosen = strippedNoise;
      break;
    }
  }
  if (!chosen) chosen = fallbackTagged;

  const cleanArtifact = artifacts.length > 0
    ? artifacts[0].replace(/\.md$/i, '').replace(/_/g, ' ').trim()
    : '';
  const aiTopic = extractAssistantTopic(assistantContent);

  // When prompt is empty or vague ("看看这个问题", "1", "帮我看下这个需求"), enrich with artifact or AI topic
  if (!chosen || VAGUE_PROMPT_RE.test(chosen)) {
    if (cleanArtifact) {
      chosen = chosen && !/^(?:1|2|3)$/.test(chosen) ? `${cleanArtifact}` : cleanArtifact;
    } else if (aiTopic) {
      chosen = aiTopic;
    }
  }

  if (!chosen && rawLines.length > 0) {
    chosen = promoteChineseClause(compactInlineUrls(rawLines[0]).replace(/\s+/g, ' ').trim());
  }
  if (!chosen) {
    chosen = '图片或附件对话';
  }

  let title = chosen;
  if (title.length > 52) {
    const endPunct = title.slice(0, 52).search(/[。！？；]/);
    title = endPunct >= 10 ? title.slice(0, endPunct) : `${title.slice(0, 50)}…`;
  }

  const rest = compactInlineUrls(rawLines.join(' ')).replace(/\s+/g, ' ').trim();
  const snippet = (rest || aiTopic).slice(0, 130);

  return { title, snippet };
}

function readChunk(fd, position, length) {
  const buf = Buffer.allocUnsafe(length);
  const bytes = readSync(fd, buf, 0, length, position);
  return buf.subarray(0, bytes).toString('utf-8');
}

export function parseTranscriptFast(transcriptPath, fileSize, mtimeMs) {
  let fd = -1;
  let createdAt = '';
  let updatedAt = '';
  let promptText = '';
  let assistantText = '';
  let stepCount = 1;
  let hasMedia = false;

  try {
    fd = openSync(transcriptPath, 'r');
    const headLen = Math.min(fileSize, HEAD_BYTES);
    const head = readChunk(fd, 0, headLen);

    const headLines = head.split('\n');
    for (let i = 0; i < Math.min(headLines.length, 25); i++) {
      const line = headLines[i].trim();
      if (!line) continue;
      try {
        const obj = JSON.parse(line);
        if (!createdAt && typeof obj.created_at === 'string') createdAt = obj.created_at;
        if (!promptText && obj.type === 'USER_INPUT' && typeof obj.content === 'string') {
          promptText = extractPromptText(obj.content);
          hasMedia = Array.isArray(obj.media) && obj.media.length > 0;
        } else if (!assistantText && obj.type === 'PLANNER_RESPONSE' && typeof obj.content === 'string' && obj.content.trim()) {
          assistantText = obj.content.trim();
        }
        if (promptText && assistantText) break;
      } catch {
        const tsMatch = line.match(/"created_at"\s*:\s*"([^"]+)"/);
        if (!createdAt && tsMatch) createdAt = tsMatch[1];
        const reqMatch = line.match(/<USER_REQUEST>\\n?([\s\S]{1,400})/);
        if (!promptText && reqMatch) {
          promptText = reqMatch[1]
            .replace(/\\n/g, '\n')
            .replace(/\\"/g, '"')
            .replace(/<\/USER_REQUEST>[\s\S]*$/, '')
            .trim();
        }
        break;
      }
    }

    const tailStr = fileSize <= HEAD_BYTES
      ? head
      : readChunk(fd, Math.max(0, fileSize - TAIL_BYTES), TAIL_BYTES);
    const tsMatches = [...tailStr.matchAll(/"created_at"\s*:\s*"([^"]+)"/g)];
    if (tsMatches.length > 0) {
      updatedAt = tsMatches[tsMatches.length - 1][1];
    }
    const stepMatches = [...tailStr.matchAll(/"step_index"\s*:\s*(\d+)/g)];
    if (stepMatches.length > 0) {
      stepCount = Number(stepMatches[stepMatches.length - 1][1]) + 1;
    }

    // If first assistant reply happened after several tool calls (>64KB), grab one from tail
    if (!assistantText && tailStr !== head) {
      for (const line of tailStr.split('\n').reverse()) {
        if (!line.includes('"PLANNER_RESPONSE"') || !line.includes('"content"')) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.type === 'PLANNER_RESPONSE' && typeof obj.content === 'string' && obj.content.trim()) {
            assistantText = obj.content.trim();
            break;
          }
        } catch {}
      }
    }
  } catch {
    // Ignore transient read errors while files are written
  } finally {
    if (fd >= 0) {
      try { closeSync(fd); } catch {}
    }
  }

  const fallbackIso = new Date(mtimeMs).toISOString();
  return {
    createdAt: createdAt || fallbackIso,
    updatedAt: updatedAt || fallbackIso,
    promptText,
    assistantText,
    stepCount,
    hasMedia,
  };
}
