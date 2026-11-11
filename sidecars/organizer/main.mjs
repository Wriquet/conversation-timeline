/**
 * Conversation Timeline sidecar backend.
 *
 * Read-only over Antigravity's documented conversation transcripts & metadata:
 *   - <appData>/brain/<convId>/.system_generated/logs/transcript.jsonl
 *   - `agentapi get-conversation-metadata <convId>`
 * Stores only its own caches & user stars/aliases under ANTIGRAVITY_EXECUTABLE_DATA_DIR.
 */
import { execFile } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DEFAULT_PREFS,
  UUID_RE,
  normalizePrefs,
  parseTranscriptFast,
  parseWorkspaceName,
  resolvePaths,
  summarizePrompt,
} from './lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const { appDirs: APP_DIRS, dataDir: DATA_DIR } = resolvePaths();

try {
  mkdirSync(DATA_DIR, { recursive: true });
} catch {
  // Ignore if sandboxed during offline tests
}

const META_CACHE_FILE = join(DATA_DIR, 'metadata-cache.json');
const PREFS_FILE = join(DATA_DIR, 'preferences.json');

function readJsonSafe(path, fallback) {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(path, value) {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: 'utf-8', mode: 0o600 });
    renameSync(tmp, path);
  } catch {
    try { rmSync(tmp, { force: true }); } catch {}
  }
}

// ---------------------------------------------------------------------------
// Preferences (stars, custom aliases, view options)
// ---------------------------------------------------------------------------

let prefs = normalizePrefs(readJsonSafe(PREFS_FILE, DEFAULT_PREFS));

function updatePrefs(patch) {
  if (!patch || typeof patch !== 'object') return prefs;
  const next = {
    ...prefs,
    starred: [...prefs.starred],
    aliases: { ...prefs.aliases },
  };
  if (typeof patch.toggleStar === 'string' && UUID_RE.test(patch.toggleStar)) {
    const id = patch.toggleStar.toLowerCase();
    const idx = next.starred.indexOf(id);
    if (idx >= 0) next.starred.splice(idx, 1);
    else next.starred.unshift(id);
  }
  if (patch.alias && typeof patch.alias === 'object' && UUID_RE.test(patch.alias.id || '')) {
    const id = patch.alias.id.toLowerCase();
    const name = typeof patch.alias.title === 'string' ? patch.alias.title.trim().slice(0, 120) : '';
    if (name) next.aliases[id] = name;
    else delete next.aliases[id];
  }
  if (patch.groupMode === 'ymd' || patch.groupMode === 'ym') next.groupMode = patch.groupMode;
  if (patch.timeField === 'created' || patch.timeField === 'updated') next.timeField = patch.timeField;
  if (typeof patch.hideSubagents === 'boolean') next.hideSubagents = patch.hideSubagents;
  if (typeof patch.showCalendar === 'boolean') next.showCalendar = patch.showCalendar;
  if (patch.lang === 'auto' || patch.lang === 'zh' || patch.lang === 'en') next.lang = patch.lang;

  prefs = normalizePrefs(next);
  writeJsonAtomic(PREFS_FILE, prefs);
  cachedEtag = '';
  return prefs;
}

// ---------------------------------------------------------------------------
// Immutable metadata cache via documented `agentapi get-conversation-metadata`
// ---------------------------------------------------------------------------

const metaCache = new Map(Object.entries(readJsonSafe(META_CACHE_FILE, {})));
const metaPending = new Set();
const metaQueue = [];
let metaWorkers = 0;
let metaDirty = false;
let metaSaveTimer = null;

function scheduleMetaSave() {
  metaDirty = true;
  if (metaSaveTimer) return;
  metaSaveTimer = setTimeout(() => {
    metaSaveTimer = null;
    if (!metaDirty) return;
    metaDirty = false;
    writeJsonAtomic(META_CACHE_FILE, Object.fromEntries(metaCache));
  }, 1500);
  if (metaSaveTimer.unref) metaSaveTimer.unref();
}

function fetchMetadataOne(id) {
  const exe = process.env.ANTIGRAVITY_AGENTAPI_EXE;
  const file = exe || 'agentapi';
  const args = [...(exe ? ['agentapi'] : []), 'get-conversation-metadata', id];
  return new Promise((resolve) => {
    execFile(file, args, { encoding: 'utf-8', timeout: 5000, windowsHide: true }, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      try {
        const parsed = JSON.parse(stdout);
        const m = parsed?.response?.conversationMetadata?.metadata || parsed?.metadata || {};
        const wsUri =
          m.workspaces?.[0]?.workspaceFolderAbsoluteUri ||
          m.workspaceUris?.[0] ||
          '';
        const isSubagent = Boolean(
          (typeof m.parentConversationId === 'string' && m.parentConversationId.length > 0) ||
          (typeof m.nestingDepth === 'number' && m.nestingDepth > 0) ||
          m.subagentSpec != null
        );
        resolve({
          createdAt: typeof m.createdAt === 'string' ? m.createdAt : '',
          workspace: parseWorkspaceName(wsUri),
          workspaceUri: wsUri,
          projectId: typeof m.projectId === 'string' ? m.projectId : '',
          isSubagent,
        });
      } catch {
        resolve(null);
      }
    });
  });
}

function pumpMetaQueue() {
  while (metaWorkers < 5 && metaQueue.length > 0) {
    const id = metaQueue.shift();
    metaWorkers++;
    fetchMetadataOne(id)
      .then((res) => {
        if (res) {
          metaCache.set(id, res);
          cachedEtag = '';
          scheduleMetaSave();
        }
      })
      .finally(() => {
        metaPending.delete(id);
        metaWorkers--;
        pumpMetaQueue();
      });
  }
}

function enqueueMetadata(id) {
  if (metaCache.has(id) || metaPending.has(id)) return;
  metaPending.add(id);
  metaQueue.push(id);
  pumpMetaQueue();
}

function listArtifacts(convDir) {
  try {
    return readdirSync(convDir)
      .filter((name) => name.endsWith('.md') && !name.startsWith('.'))
      .slice(0, 12);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Incremental Conversation Scanner
// ---------------------------------------------------------------------------

const recordCache = new Map();
let lastScanAt = 0;
let cachedItems = [];
let cachedEtag = '';

function scanConversations(force = false) {
  const now = Date.now();
  if (!force && now - lastScanAt < 2000 && cachedItems.length > 0) {
    return cachedItems;
  }
  lastScanAt = now;

  const seen = new Set();
  const list = [];

  for (const appDir of APP_DIRS) {
    const brainRoot = join(appDir, 'brain');
    if (!existsSync(brainRoot)) continue;

    let entries = [];
    try {
      entries = readdirSync(brainRoot);
    } catch {
      continue;
    }

    for (const rawName of entries) {
      if (!UUID_RE.test(rawName)) continue;
      const id = rawName.toLowerCase();
      if (seen.has(id)) continue;
      seen.add(id);

      const convDir = join(brainRoot, rawName);
      const transcriptPath = join(convDir, '.system_generated', 'logs', 'transcript.jsonl');

      let tStat;
      try {
        tStat = statSync(transcriptPath);
      } catch {
        continue;
      }

      let dMtime = 0;
      try {
        dMtime = statSync(convDir).mtimeMs;
      } catch {}

      const stamp = `${tStat.size}:${tStat.mtimeMs}:${dMtime}`;
      let base = recordCache.get(id);
      if (!base || base.stamp !== stamp) {
        const parsed = parseTranscriptFast(transcriptPath, tStat.size, tStat.mtimeMs);
        const artifacts = listArtifacts(convDir);
        const { title, snippet } = summarizePrompt(parsed.promptText, artifacts);
        base = {
          id,
          stamp,
          autoTitle: title,
          snippet,
          artifacts,
          transcriptCreatedAt: parsed.createdAt,
          updatedAt: parsed.updatedAt,
          mtimeMs: tStat.mtimeMs,
          stepCount: parsed.stepCount,
          hasMedia: parsed.hasMedia,
        };
        recordCache.set(id, base);
      }

      const meta = metaCache.get(id);
      if (!meta) enqueueMetadata(id);

      const alias = prefs.aliases[id] || '';
      const createdAt = meta?.createdAt || base.transcriptCreatedAt;
      const updatedAt = base.updatedAt;

      list.push({
        id,
        title: alias || base.autoTitle,
        autoTitle: base.autoTitle,
        hasAlias: Boolean(alias),
        snippet: base.snippet,
        artifacts: base.artifacts,
        createdAt,
        updatedAt,
        stepCount: base.stepCount,
        hasMedia: base.hasMedia,
        workspace: meta?.workspace || '',
        isSubagent: Boolean(meta?.isSubagent),
        starred: prefs.starred.includes(id),
      });
    }
  }

  for (const oldId of recordCache.keys()) {
    if (!seen.has(oldId)) recordCache.delete(oldId);
  }

  list.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  cachedItems = list;
  return list;
}

function buildPayload(query = {}) {
  const force = query.force === '1' || query.force === true;
  const items = scanConversations(force);
  const currentConv = (query.conversationId || '').toLowerCase();
  const etag = `${items.length}:${items[0]?.id || ''}:${items[0]?.updatedAt || ''}:${metaCache.size}:${JSON.stringify(prefs)}:${currentConv}`;

  if (!force && query.etag && query.etag === etag && cachedEtag === etag) {
    return { unchanged: true, etag, currentConversationId: currentConv };
  }
  cachedEtag = etag;

  const workspaces = [...new Set(items.map((i) => i.workspace).filter(Boolean))].sort();
  return {
    unchanged: false,
    etag,
    currentConversationId: currentConv,
    metaPendingCount: metaPending.size,
    workspaces,
    preferences: prefs,
    conversations: items,
  };
}

// ---------------------------------------------------------------------------
// CLI self-test & Sidecar HTTP server bootstrap
// ---------------------------------------------------------------------------

if (process.argv.includes('--self-test')) {
  const t0 = performance.now();
  const payload = buildPayload({ force: true });
  const dt = (performance.now() - t0).toFixed(1);
  console.log(JSON.stringify({
    ok: true,
    appDirs: APP_DIRS,
    dataDir: DATA_DIR,
    scanMs: Number(dt),
    totalConversations: payload.conversations.length,
  }, null, 2));
  process.exit(0);
}

async function loadSdk() {
  try {
    return await import('sidecar_sdk');
  } catch (err) {
    const resolved = createRequire(import.meta.url).resolve('sidecar_sdk');
    return import(pathToFileURL(resolved).href);
  }
}

const { SidecarApp, Response } = await loadSdk();
const app = new SidecarApp();

const STATIC_FILES = {
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'application/javascript; charset=utf-8'],
};

app.page('/', () => readFileSync(join(__dirname, 'index.html'), 'utf-8'));

for (const [route, [filename, contentType]] of Object.entries(STATIC_FILES)) {
  app.api(
    route,
    () =>
      new Response(readFileSync(join(__dirname, filename), 'utf-8'), {
        contentType,
        headers: { 'Cache-Control': 'no-store' },
      }),
    'GET'
  );
}

app.api(
  '/api/conversations',
  (data) => buildPayload({
    conversationId: data?.conversationId || app.config?.conversationId || '',
    etag: data?.etag || '',
    force: data?.force || '',
  }),
  'GET'
);

app.api('/api/preferences', () => prefs, 'GET');
app.api('/api/preferences', (data) => updatePrefs(data), 'POST');

console.log(`[conversation-timeline] indexing ${APP_DIRS.join(', ')}`);
app.run();
