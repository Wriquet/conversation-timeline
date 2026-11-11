import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  compactInlineUrls,
  extractPromptText,
  normalizePrefs,
  parseTranscriptFast,
  parseWorkspaceName,
  resolvePaths,
  summarizePrompt,
} from '../lib.mjs';

test('extractPromptText extracts USER_REQUEST and strips metadata blocks', () => {
  const raw = `<USER_REQUEST>\n帮我按年/月/日整理左侧对话列表\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\ntime\n</ADDITIONAL_METADATA>`;
  assert.equal(extractPromptText(raw), '帮我按年/月/日整理左侧对话列表');
});

test('compactInlineUrls shortens GitHub, Feishu, and generic URLs', () => {
  assert.equal(
    compactInlineUrls('https://github.com/viarotel-org/escrcpy 这个项目怎么用'),
    'viarotel-org/escrcpy  这个项目怎么用'
  );
  assert.equal(
    compactInlineUrls('https://acn6eda1cxtm.feishu.cn/wiki/EhANw0mDniqq 帮我看需求'),
    '[Feishu]  帮我看需求'
  );
});

test('summarizePrompt skips bare URL lines when descriptive lines follow and falls back to artifacts', () => {
  const withSecondLine = summarizePrompt(
    'https://example.com/some/very/long/path\n起落架工卡交接需求分析与评审',
    []
  );
  assert.equal(withSecondLine.title, '起落架工卡交接需求分析与评审');

  const urlOnlyWithArtifact = summarizePrompt(
    'https://acn6eda1cxtm.feishu.cn/wiki/EhANw0mDniqq',
    ['LR_HOV_01_需求纠偏与落地指南.md']
  );
  assert.equal(urlOnlyWithArtifact.title, 'LR HOV 01 需求纠偏与落地指南');
});

test('parseWorkspaceName supports POSIX and Windows file URIs', () => {
  assert.equal(parseWorkspaceName('file:///Users/alice/Project/'), 'Project');
  assert.equal(parseWorkspaceName('file:///C:/Users/alice/My%20Repo'), 'My Repo');
  assert.equal(parseWorkspaceName('C:\\Workspaces\\backend\\'), 'backend');
});

test('normalizePrefs validates UUIDs, aliases, and enums safely', () => {
  const validId = '2AB892DE-CCDB-4D96-AF84-58E919A3C8A5';
  const prefs = normalizePrefs({
    starred: [validId, 'not-a-uuid', validId.toLowerCase()],
    aliases: {
      [validId]: '  自定义中文标题  ',
      bad: 'ignored',
    },
    groupMode: 'ym',
    timeField: 'updated',
    lang: 'en',
  });
  assert.deepEqual(prefs.starred, [validId.toLowerCase()]);
  assert.equal(prefs.aliases[validId.toLowerCase()], '自定义中文标题');
  assert.equal(prefs.aliases.bad, undefined);
  assert.equal(prefs.groupMode, 'ym');
  assert.equal(prefs.timeField, 'updated');
  assert.equal(prefs.lang, 'en');
});

test('parseTranscriptFast reads head and tail timestamps and step count accurately', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tl-test-'));
  try {
    const file = join(dir, 'transcript.jsonl');
    const lines = [
      JSON.stringify({
        step_index: 0,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        created_at: '2026-11-11T07:00:00Z',
        content: '<USER_REQUEST>\n测试按日期归档对话\n</USER_REQUEST>',
      }),
      JSON.stringify({
        step_index: 4,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        created_at: '2026-11-11T07:15:30Z',
        content: 'Done.',
      }),
    ].join('\n') + '\n';
    writeFileSync(file, lines, 'utf-8');
    const st = statSync(file);
    const parsed = parseTranscriptFast(file, st.size, st.mtimeMs);
    assert.equal(parsed.createdAt, '2026-11-11T07:00:00Z');
    assert.equal(parsed.updatedAt, '2026-11-11T07:15:30Z');
    assert.equal(parsed.promptText, '测试按日期归档对话');
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
