import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  compactInlineUrls,
  extractAssistantTopic,
  extractPromptText,
  normalizePrefs,
  parseTranscriptFast,
  parseWorkspaceName,
  promoteChineseClause,
  resolvePaths,
  summarizePrompt,
} from '../lib.mjs';

test('extractPromptText extracts USER_REQUEST and strips metadata blocks', () => {
  const raw = `<USER_REQUEST>\n帮我按年/月/日整理左侧对话列表\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\ntime\n</ADDITIONAL_METADATA>`;
  assert.equal(extractPromptText(raw), '帮我按年/月/日整理左侧对话列表');
});

test('compactInlineUrls and promoteChineseClause put Chinese subject at the beginning', () => {
  const githubPrompt = summarizePrompt('https://github.com/viarotel-org/escrcpy 这个项目能控制iphone来打卡吗？');
  assert.equal(githubPrompt.title, '这个项目能控制iphone来打卡吗？（escrcpy）');

  const localPathPrompt = summarizePrompt('/Users/wangqi/Downloads/408309-1080p.mp4给这个视频加中文字幕。');
  assert.equal(localPathPrompt.title, '给这个视频加中文字幕（408309-1080p.mp4）');

  assert.equal(
    promoteChineseClause('GAMECO_MASTER_FIX_RETAIN_DUP_261027帮我审查下这个修复的代码'),
    '帮我审查下这个修复的代码（GAMECO_MASTER_FIX_RE…）'
  );

  const multiLineUrlFirst = summarizePrompt(
    'http://172.16.0.133:10580/plan-center\n登录之后检查一下工时同步报错'
  );
  assert.equal(multiLineUrlFirst.title, '登录之后检查一下工时同步报错');
});

test('summarizePrompt enriches vague prompts using artifacts or AI Chinese reply headings', () => {
  const feishuVague = summarizePrompt(
    'https://acn6eda1cxtm.feishu.cn/wiki/EhANw0mDniqq\n帮我看下这个需求需要怎么做',
    ['LR_HOV_01_需求纠偏与落地指南.md'],
    ''
  );
  assert.equal(feishuVague.title, 'LR HOV 01 需求纠偏与落地指南');

  const screenshotOnly = summarizePrompt(
    '看看这个问题',
    [],
    '### 1. 南航 Pre 页面加载异常根因分析\n接口返回超时导致渲染中断。'
  );
  assert.equal(screenshotOnly.title, '南航 Pre 页面加载异常根因分析');
  assert.equal(
    extractAssistantTopic('## 一句话结论\n这次报错是因为 **南航 Pre 网关鉴权缓存未刷新** 导致的。\n## 详细根因剖析\n...'),
    '南航 Pre 网关鉴权缓存未刷新'
  );
  assert.equal(extractAssistantTopic('我把最新版的 **起落架工卡交接需求** 梳理如下'), '起落架工卡交接需求');
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
