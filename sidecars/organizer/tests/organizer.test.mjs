import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  extractPromptText,
  normalizePrefs,
  parseAnnotationTitle,
  parseTranscriptFast,
  parseWorkspaceName,
  resolveNativeTitle,
  resolvePaths,
} from '../lib.mjs';
import {
  needsTranslation,
  normalizeMicrosoftEndpoint,
  postPolishChinese,
  preNormalizeForMT,
  translateTitlesBatch,
} from '../translator.mjs';

test('extractPromptText extracts USER_REQUEST and strips metadata blocks', () => {
  const raw = `<USER_REQUEST>\n帮我按年/月/日整理左侧对话列表\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\ntime\n</ADDITIONAL_METADATA>`;
  assert.equal(extractPromptText(raw), '帮我按年/月/日整理左侧对话列表');
});

test('parseAnnotationTitle decodes raw UTF-8, escaped quotes, and protobuf octal UTF-8 bytes', () => {
  assert.equal(
    parseAnnotationTitle('title:"Browser Memory Usage Comparison" last_user_view_time:{seconds:1794311171}'),
    'Browser Memory Usage Comparison'
  );
  assert.equal(
    parseAnnotationTitle('title:"起落架工卡交接需求分析"  last_user_view_time:{seconds:1794386197}'),
    '起落架工卡交接需求分析'
  );
  assert.equal(
    parseAnnotationTitle('title:"Fix \\"NPE\\" in Service"'),
    'Fix "NPE" in Service'
  );
  // "\346\265\213\350\257\225" == UTF-8 bytes for "测试"
  assert.equal(
    parseAnnotationTitle('title:"\\346\\265\\213\\350\\257\\225"'),
    '测试'
  );
  assert.equal(parseAnnotationTitle('archived:true'), '');
});

test('resolveNativeTitle preserves native sidebar titles with proper fallback priority', () => {
  assert.equal(
    resolveNativeTitle({
      annotationTitle: 'Using Rooted Phone As Computer',
      dbTitle: 'Old Title',
      dbPreview: 'Preview',
    }),
    'Using Rooted Phone As Computer'
  );
  assert.equal(
    resolveNativeTitle({
      annotationTitle: '',
      dbTitle: '',
      dbPreview: 'Work Package Issuance Failure',
    }),
    'Work Package Issuance Failure'
  );
  assert.equal(resolveNativeTitle({}), 'New Conversation');
});

test('needsTranslation detects pure English titles and skips titles already containing Chinese', () => {
  assert.equal(needsTranslation('Using Rooted Phone As Computer'), true);
  assert.equal(needsTranslation('IntelliJ IDEA Power Save Mode'), true);
  assert.equal(needsTranslation('GAMECO API 菜单权限映射'), false);
  assert.equal(needsTranslation('起落架工卡交接需求分析'), false);
  assert.equal(needsTranslation('12345'), false);
});

test('normalizeMicrosoftEndpoint enforces HTTPS and official Microsoft/Azure domains', () => {
  assert.equal(
    normalizeMicrosoftEndpoint('https://api.cognitive.microsofttranslator.com/'),
    'https://api.cognitive.microsofttranslator.com'
  );
  assert.equal(
    normalizeMicrosoftEndpoint('https://api.translator.azure.cn'),
    'https://api.translator.azure.cn'
  );
  assert.throws(() => normalizeMicrosoftEndpoint('http://api.cognitive.microsofttranslator.com'));
  assert.throws(() => normalizeMicrosoftEndpoint('https://127.0.0.1:8080'));
  assert.throws(() => normalizeMicrosoftEndpoint('https://evil.example.com'));
});

test('translateTitlesBatch calls Microsoft Translator v3.0 when API key is configured', async () => {
  let capturedUrl = '';
  let capturedHeaders = {};
  let capturedBody = null;

  const fakeFetch = async (url, opts) => {
    capturedUrl = url;
    capturedHeaders = opts.headers;
    capturedBody = JSON.parse(opts.body);
    return {
      ok: true,
      json: async () => [
        { translations: [{ text: '将启用 Root 的手机用作电脑', to: 'zh-Hans' }] },
        { translations: [{ text: '更新昨天 TAPD 工作时间', to: 'zh-Hans' }] },
      ],
    };
  };

  const out = await translateTitlesBatch(
    ['Using Rooted Phone As Computer', 'Update Yesterday Tapd Hours', 'New Conversation'],
    {
      provider: 'auto',
      apiKey: 'ms-test-key-123456',
      region: 'eastasia',
      endpoint: 'https://api.cognitive.microsofttranslator.com',
    },
    fakeFetch
  );

  assert.equal(out.providerUsed, 'microsoft');
  assert.equal(capturedUrl, 'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=zh-Hans');
  assert.equal(capturedHeaders['Ocp-Apim-Subscription-Key'], 'ms-test-key-123456');
  assert.equal(capturedHeaders['Ocp-Apim-Subscription-Region'], 'eastasia');
  assert.equal(capturedBody[0].Text, preNormalizeForMT('Using Rooted Phone As Computer'));
  assert.equal(out.translations['Using Rooted Phone As Computer'], '将已 Root 手机用作电脑');
  assert.equal(out.translations['Update Yesterday Tapd Hours'], '更新昨天 TAPD 工时');
  assert.equal(out.translations['New Conversation'], '新对话');
});

test('translateTitlesBatch falls back to free public batch API when no Microsoft key is set', async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      responseStatus: 200,
      responseData: {
        translatedText: '[0] IntelliJ IDEA省电模式\n[1] 调试SIT API超时',
      },
    }),
  });

  const out = await translateTitlesBatch(
    ['IntelliJ IDEA Power Save Mode', 'Debugging SIT API Timeout'],
    { provider: 'auto', apiKey: '' },
    fakeFetch
  );

  assert.equal(out.providerUsed, 'free');
  assert.equal(out.translations['IntelliJ IDEA Power Save Mode'], postPolishChinese('IntelliJ IDEA省电模式'));
  assert.equal(out.translations['Debugging SIT API Timeout'], '调试SIT API超时');
});

test('parseWorkspaceName supports POSIX and Windows file URIs', () => {
  assert.equal(parseWorkspaceName('file:///Users/alice/Project/'), 'Project');
  assert.equal(parseWorkspaceName('file:///C:/Users/alice/My%20Repo'), 'My Repo');
  assert.equal(parseWorkspaceName('C:\\Workspaces\\backend\\'), 'backend');
});

test('normalizePrefs validates UUIDs, aliases, translateTitles, and enums safely', () => {
  const validId = '2AB892DE-CCDB-4D96-AF84-58E919A3C8A5';
  const prefs = normalizePrefs({
    starred: [validId, 'not-a-uuid', validId.toLowerCase()],
    aliases: {
      [validId]: '  自定义中文标题  ',
      bad: 'ignored',
    },
    groupMode: 'ym',
    timeField: 'updated',
    translateTitles: true,
    lang: 'en',
  });
  assert.deepEqual(prefs.starred, [validId.toLowerCase()]);
  assert.equal(prefs.aliases[validId.toLowerCase()], '自定义中文标题');
  assert.equal(prefs.aliases.bad, undefined);
  assert.equal(prefs.groupMode, 'ym');
  assert.equal(prefs.timeField, 'updated');
  assert.equal(prefs.translateTitles, true);
  assert.equal(prefs.lang, 'en');
});

test('parseTranscriptFast reads head, tail, and assistant reply accurately', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tl-test-'));
  try {
    const file = join(dir, 'transcript.jsonl');
    const lines = [
      JSON.stringify({
        step_index: 0,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        created_at: '2026-11-11T07:00:00Z',
        content: '<USER_REQUEST>\n看看这个问题\n</USER_REQUEST>',
      }),
      JSON.stringify({
        step_index: 4,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        created_at: '2026-11-11T07:15:30Z',
        content: '### 定检工包同步失败排查结论\n已完成修复。',
      }),
    ].join('\n') + '\n';
    writeFileSync(file, lines, 'utf-8');
    const st = statSync(file);
    const parsed = parseTranscriptFast(file, st.size, st.mtimeMs);
    assert.equal(parsed.createdAt, '2026-11-11T07:00:00Z');
    assert.equal(parsed.updatedAt, '2026-11-11T07:15:30Z');
    assert.equal(parsed.promptText, '看看这个问题');
    assert.match(parsed.assistantText, /定检工包同步失败排查结论/);
    assert.equal(parsed.stepCount, 5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolvePaths derives appData from ANTIGRAVITY_EXECUTABLE_DATA_DIR', () => {
  const fakeApp = join('/tmp', 'fake-agy');
  const fakeData = join(fakeApp, 'sidecar_data', 'conversation-timeline', 'organizer', 'data');
  const resolved = resolvePaths({ ANTIGRAVITY_EXECUTABLE_DATA_DIR: fakeData }, '/tmp');
  assert.deepEqual(resolved.appDirs, [fakeApp]);
  assert.equal(resolved.dataDir, fakeData);
});
