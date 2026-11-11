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
  lang: 'auto',          // 'auto' | 'zh' | 'en'
};

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
  if (raw.lang === 'auto' || raw.lang === 'zh' || raw.lang === 'en') out.lang = raw.lang;
  return out;
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
    .replace(/```[\s\S]*?```/g, ' [code] ')
    .trim();
  return text;
}

export function compactInlineUrls(str) {
  return String(str || '').replace(/https?:\/\/([^\s\u4e00-\u9fff]+)/gi, (_full, rest) => {
    const clean = rest.replace(/[),.。，；！!？?]+$/, '');
    const gh = clean.match(/^github\.com\/([^/]+\/[^/?#]+)/i);
    if (gh) return `${gh[1]} `;
    if (/feishu\.cn|larksuite\.com/i.test(clean)) return '[Feishu] ';
    const host = clean.split('/')[0].replace(/^www\./i, '');
    return `[${host}] `;
  });
}

export function summarizePrompt(text, artifacts = []) {
  const rawLines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^#+\s*/, '').replace(/^>\s*/, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim())
    .filter(Boolean);

  let chosen = '';
  for (const line of rawLines) {
    const withoutUrls = line.replace(/https?:\/\/[^\s\u4e00-\u9fff]+/gi, '').trim();
    if (withoutUrls.length >= 2) {
      chosen = compactInlineUrls(line).replace(/\s+/g, ' ').trim();
      break;
    }
  }

  if (!chosen && artifacts.length > 0) {
    chosen = artifacts[0].replace(/\.md$/i, '').replace(/_/g, ' ').trim();
  }
  if (!chosen && rawLines.length > 0) {
    chosen = compactInlineUrls(rawLines[0]).replace(/\s+/g, ' ').trim();
  }
  if (!chosen) {
    chosen = '(Media Conversation)';
  }

  let title = chosen;
  if (title.length > 52) {
    const endPunct = title.slice(0, 52).search(/[。！？；]/);
    title = endPunct >= 12 ? title.slice(0, endPunct) : `${title.slice(0, 50)}…`;
  }

  const rest = compactInlineUrls(rawLines.join(' ')).replace(/\s+/g, ' ').trim();
  const snippet = rest.length > 130 ? `${rest.slice(0, 128)}…` : rest;

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
  let stepCount = 1;
  let hasMedia = false;

  try {
    fd = openSync(transcriptPath, 'r');
    const headLen = Math.min(fileSize, HEAD_BYTES);
    const head = readChunk(fd, 0, headLen);

    const headLines = head.split('\n');
    for (let i = 0; i < Math.min(headLines.length, 8); i++) {
      const line = headLines[i].trim();
      if (!line) continue;
      try {
        const obj = JSON.parse(line);
        if (!createdAt && typeof obj.created_at === 'string') createdAt = obj.created_at;
        if (obj.type === 'USER_INPUT' && typeof obj.content === 'string') {
          promptText = extractPromptText(obj.content);
          hasMedia = Array.isArray(obj.media) && obj.media.length > 0;
          break;
        }
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
    stepCount,
    hasMedia,
  };
}
