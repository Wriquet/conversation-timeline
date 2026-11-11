/**
 * Conversation title translation engine.
 *
 * Supports:
 * 1. Official Microsoft Azure AI Translator v3.0 (`F0` Free Tier: 2M chars/month free)
 *    via `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=zh-Hans`
 * 2. Zero-config free public REST fallback (`https://api.mymemory.translated.net/get`)
 *    so one-click English <-> Chinese toggling works immediately out of the box.
 */

export const DEFAULT_MS_ENDPOINT = 'https://api.cognitive.microsofttranslator.com';

const ALLOWED_MS_HOST_SUFFIXES = [
  '.microsofttranslator.com',
  '.cognitive.microsoft.com',
  '.cognitiveservices.azure.com',
  '.translator.azure.cn',
  '.cognitiveservices.azure.cn',
];

const BUILTIN_EXACT_MAP = new Map([
  ['new conversation', '新对话'],
  ['untitled', '未命名对话'],
  ['untitled conversation', '未命名对话'],
]);

/**
 * Returns true when a title is written in English and has no Chinese characters yet.
 */
export function needsTranslation(title) {
  if (typeof title !== 'string') return false;
  const s = title.trim();
  if (!s) return false;
  if (/[\u4e00-\u9fff]/.test(s)) return false;
  return /[A-Za-z]{2,}/.test(s);
}

/**
 * Validates and normalizes a Microsoft Translator HTTPS endpoint to prevent SSRF.
 */
export function normalizeMicrosoftEndpoint(raw) {
  const trimmed = typeof raw === 'string' ? raw.trim().replace(/\/+$/, '') : '';
  if (!trimmed) return DEFAULT_MS_ENDPOINT;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('无效的微软翻译 Endpoint URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('微软翻译 Endpoint 必须使用 https://');
  }
  const host = parsed.hostname.toLowerCase();
  const allowed = ALLOWED_MS_HOST_SUFFIXES.some(
    (suffix) => host === suffix.slice(1) || host.endsWith(suffix)
  );
  if (!allowed) {
    throw new Error('仅支持微软官方 Translator / Azure Cognitive Services 域名');
  }
  return `${parsed.protocol}//${parsed.host}`;
}

export function normalizeTranslatorConfig(raw = {}, env = process.env) {
  const provider =
    raw?.provider === 'microsoft' || raw?.provider === 'free' || raw?.provider === 'auto'
      ? raw.provider
      : 'auto';

  const fileKey = typeof raw?.apiKey === 'string' ? raw.apiKey.trim() : '';
  const envKey = (env.MICROSOFT_TRANSLATOR_KEY || env.AZURE_TRANSLATOR_KEY || '').trim();
  const apiKey = fileKey || envKey;

  const fileRegion = typeof raw?.region === 'string' ? raw.region.trim() : '';
  const envRegion = (env.MICROSOFT_TRANSLATOR_REGION || env.AZURE_TRANSLATOR_REGION || '').trim();
  const region = (fileRegion || envRegion).slice(0, 48);

  let endpoint = DEFAULT_MS_ENDPOINT;
  try {
    endpoint = normalizeMicrosoftEndpoint(raw?.endpoint || env.MICROSOFT_TRANSLATOR_ENDPOINT || '');
  } catch {
    endpoint = DEFAULT_MS_ENDPOINT;
  }

  return {
    provider,
    apiKey,
    keyFromEnv: !fileKey && Boolean(envKey),
    region,
    endpoint,
  };
}

export function maskSecretKey(key) {
  if (typeof key !== 'string' || !key.trim()) return '';
  const k = key.trim();
  if (k.length <= 8) return '••••••••';
  return `${k.slice(0, 4)}••••••••${k.slice(-4)}`;
}

/**
 * Pre-normalizes ambiguous dev phrases before machine translation so idioms like
 * "Rooted Phone" or "Tapd Hours" translate accurately into engineering Chinese.
 */
export function preNormalizeForMT(text) {
  return String(text || '')
    .replace(/\bTapd\s+Hours\b/gi, 'TAPD Work Hours')
    .replace(/\bTapd\b/g, 'TAPD')
    .replace(/\bRooted\s+Phone\b/gi, 'Root-Enabled Phone')
    .replace(/\bRoot\s+Phone\b/gi, 'Root Android Phone')
    .replace(/\bFeishu\b/gi, '飞书')
    .trim();
}

export function postPolishChinese(text) {
  return String(text || '')
    .replace(/^\s*\[\d+\]\s*/, '')
    .replace(/TAPD\s*工作时间|TAPD\s*营业时间|Tapd\s*营业时间/gi, 'TAPD 工时')
    .replace(/启用\s*Root\s*的手机|支持\s*Root\s*的手机|启用根功能的手机|根手机/gi, '已 Root 手机')
    .replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, '$1$2')
    .trim();
}

/**
 * Official Microsoft Azure AI Translator v3.0 batch translation.
 */
export async function translateWithMicrosoft(titles, config, fetchImpl = fetch) {
  const apiKey = (config?.apiKey || '').trim();
  if (!apiKey) {
    throw new Error('未配置微软翻译 Subscription Key');
  }
  const endpoint = normalizeMicrosoftEndpoint(config?.endpoint);
  const url = `${endpoint}/translate?api-version=3.0&to=zh-Hans`;

  const headers = {
    'Ocp-Apim-Subscription-Key': apiKey,
    'Content-Type': 'application/json; charset=UTF-8',
  };
  if (config?.region && config.region.trim() && config.region.trim().toLowerCase() !== 'global') {
    headers['Ocp-Apim-Subscription-Region'] = config.region.trim();
  }

  const results = new Map();
  const BATCH_SIZE = 50;

  for (let i = 0; i < titles.length; i += BATCH_SIZE) {
    const chunk = titles.slice(i, i + BATCH_SIZE);
    const body = JSON.stringify(chunk.map((t) => ({ Text: preNormalizeForMT(t) })));

    const res = await fetchImpl(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const errJson = await res.json();
        if (errJson?.error?.message) detail = errJson.error.message;
      } catch {}
      throw new Error(`微软翻译请求失败：${detail}`);
    }

    const data = await res.json();
    if (!Array.isArray(data) || data.length !== chunk.length) {
      throw new Error('微软翻译返回格式异常');
    }
    for (let j = 0; j < chunk.length; j++) {
      const tr = postPolishChinese(data[j]?.translations?.[0]?.text || '');
      if (tr) results.set(chunk[j], tr);
    }
  }

  return results;
}

async function fetchMyMemorySingle(text, fetchImpl) {
  const q = preNormalizeForMT(text).slice(0, 450);
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=en|zh-CN`;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (Number(data?.responseStatus) && Number(data.responseStatus) !== 200) {
    throw new Error(data?.responseDetails || `Status ${data.responseStatus}`);
  }
  return postPolishChinese(data?.responseData?.translatedText || '');
}

/**
 * Zero-config free public REST fallback using multi-line `[idx]` batching (< 420 chars per batch).
 */
export async function translateWithFreePublic(titles, fetchImpl = fetch) {
  const results = new Map();
  const batches = [];
  let current = [];
  let currentLen = 0;

  for (const t of titles) {
    const line = `[${current.length}] ${preNormalizeForMT(t)}`;
    const nextLen = currentLen + (current.length ? 1 : 0) + line.length;
    if (current.length > 0 && (current.length >= 8 || nextLen > 420)) {
      batches.push(current);
      current = [];
      currentLen = 0;
    }
    current.push(t);
    currentLen += (current.length > 1 ? 1 : 0) + `[${current.length - 1}] ${preNormalizeForMT(t)}`.length;
  }
  if (current.length > 0) batches.push(current);

  const CONCURRENCY = 2;
  let bIdx = 0;

  async function worker() {
    while (bIdx < batches.length) {
      const chunk = batches[bIdx++];
      if (chunk.length === 1) {
        const single = await fetchMyMemorySingle(chunk[0], fetchImpl);
        if (single) results.set(chunk[0], single);
        continue;
      }

      const joined = chunk.map((t, idx) => `[${idx}] ${preNormalizeForMT(t)}`).join('\n');
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(joined)}&langpair=en|zh-CN`;
      const missing = [];

      try {
        const res = await fetchImpl(url, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const rawOut = String(data?.responseData?.translatedText || '');
        const parsedByIdx = new Map();

        for (const rawLine of rawOut.split(/\r?\n/)) {
          const m = rawLine.match(/^\s*[\[【](\d+)[\]】]\s*(.+)$/);
          if (m) {
            parsedByIdx.set(Number(m[1]), postPolishChinese(m[2]));
          }
        }

        for (let idx = 0; idx < chunk.length; idx++) {
          const hit = parsedByIdx.get(idx);
          if (hit) results.set(chunk[idx], hit);
          else missing.push(chunk[idx]);
        }
      } catch {
        missing.push(...chunk);
      }

      for (const item of missing) {
        try {
          const tr = await fetchMyMemorySingle(item, fetchImpl);
          if (tr) results.set(item, tr);
        } catch {}
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, () => worker()));
  return results;
}

/**
 * Translates an array of English titles according to `config` ('auto' | 'microsoft' | 'free').
 */
export async function translateTitlesBatch(rawTitles, config, fetchImpl = fetch) {
  const unique = [...new Set(
    (Array.isArray(rawTitles) ? rawTitles : [])
      .filter((t) => typeof t === 'string')
      .map((t) => t.trim())
      .filter((t) => needsTranslation(t))
  )].slice(0, 80);

  const translations = {};
  const pending = [];

  for (const t of unique) {
    const exact = BUILTIN_EXACT_MAP.get(t.toLowerCase());
    if (exact) translations[t] = exact;
    else pending.push(t);
  }

  if (pending.length === 0) {
    return {
      translations,
      providerUsed: config?.apiKey && config?.provider !== 'free' ? 'microsoft' : 'free',
    };
  }

  const cfg = normalizeTranslatorConfig(config);
  const preferMs = cfg.provider === 'microsoft' || (cfg.provider === 'auto' && Boolean(cfg.apiKey));

  if (preferMs) {
    try {
      const msMap = await translateWithMicrosoft(pending, cfg, fetchImpl);
      for (const [k, v] of msMap) translations[k] = v;
      return { translations, providerUsed: 'microsoft' };
    } catch (err) {
      // In strict 'microsoft' mode, surface the error directly so the user sees invalid key/region
      if (cfg.provider === 'microsoft') throw err;
    }
  }

  const freeMap = await translateWithFreePublic(pending, fetchImpl);
  for (const [k, v] of freeMap) translations[k] = v;
  return { translations, providerUsed: 'free' };
}
