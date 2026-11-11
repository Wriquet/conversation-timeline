(() => {
  const POLL_MS = 4000;
  const $ = (id) => document.getElementById(id);

  const I18N = {
    zh: {
      searchPlaceholder: '搜索标题、提问内容或日期（如 11-11）',
      modeYmd: '年/月/日',
      modeYm: '年/月',
      timeCreated: '发起日',
      timeUpdated: '活跃日',
      allProjects: '全部项目',
      calendarBtn: '日历',
      collapseAll: '收起全部',
      expandMonth: '展开当月',
      today: '今天',
      yesterday: '昨天',
      showAllDates: '显示全部日期',
      loading: '正在读取历史对话…',
      reconnecting: '连接后台索引服务中…',
      refresh: '刷新',
      refreshedToast: '已重新扫描本地历史对话',
      copiedIdToast: (short) => `已复制会话 ID：${short}…`,
      saveFailedToast: '保存偏好设置失败',
      weekdays: ['一', '二', '三', '四', '五', '六', '日'],
      weekdayNames: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
      monthHeader: (y, m, cnt) => `${y}年 ${m}月（${cnt}）`,
      yearLabel: (y) => `${y}年`,
      monthLabel: (m) => `${m}月`,
      dayLabel: (m, d) => `${m}月${d}日`,
      countItems: (n) => `${n} 条`,
      starredFolder: '收藏置顶',
      currentBadge: '当前',
      renamePlaceholder: '输入自定义标题（留空恢复默认）',
      save: '保存',
      cancel: '取消',
      renameTip: '自定义标题备注',
      starTip: '收藏置顶',
      unstarTip: '取消收藏',
      summaryCount: (n, extra) => `共 ${n} 条对话${extra}`,
      filteredDate: (d) => ` · 已筛选 ${d}`,
      filteredSearch: ' · 搜索匹配',
      emptyTitle: '没有匹配的对话',
      emptyFilteredDesc: '可以尝试清空搜索词或取消日期筛选',
      emptyInitDesc: '发起新对话后会自动按年 / 月 / 日归档到这里',
      resetFilters: '重置筛选条件',
      calCellTip: (ymd, cnt) => cnt > 0 ? `${ymd}：${cnt} 条对话（点击筛选）` : `${ymd}：无对话`,
      langBtn: 'EN',
    },
    en: {
      searchPlaceholder: 'Search titles, prompts, or dates (e.g. 11-11)…',
      modeYmd: 'Y / M / D',
      modeYm: 'Y / M',
      timeCreated: 'Created',
      timeUpdated: 'Updated',
      allProjects: 'All Projects',
      calendarBtn: 'Calendar',
      collapseAll: 'Collapse All',
      expandMonth: 'Expand Month',
      today: 'Today',
      yesterday: 'Yesterday',
      showAllDates: 'All Dates',
      loading: 'Loading conversations…',
      reconnecting: 'Connecting to timeline sidecar…',
      refresh: 'Refresh',
      refreshedToast: 'Rescanned local conversations',
      copiedIdToast: (short) => `Copied conversation ID: ${short}…`,
      saveFailedToast: 'Failed to save preferences',
      weekdays: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
      weekdayNames: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      monthHeader: (y, m, cnt) => `${MONTH_NAMES_EN[Number(m) - 1]} ${y} (${cnt})`,
      yearLabel: (y) => `${y}`,
      monthLabel: (m) => MONTH_NAMES_EN[Number(m) - 1],
      dayLabel: (m, d) => `${MONTH_SHORT_EN[Number(m) - 1]} ${d}`,
      countItems: (n) => `${n}`,
      starredFolder: 'Starred',
      currentBadge: 'Active',
      renamePlaceholder: 'Custom title (leave blank to reset)',
      save: 'Save',
      cancel: 'Cancel',
      renameTip: 'Rename custom alias',
      starTip: 'Star conversation',
      unstarTip: 'Unstar conversation',
      summaryCount: (n, extra) => `${n} conversation${n === 1 ? '' : 's'}${extra}`,
      filteredDate: (d) => ` · ${d}`,
      filteredSearch: ' · Search match',
      emptyTitle: 'No matching conversations',
      emptyFilteredDesc: 'Try clearing the search query or date filter.',
      emptyInitDesc: 'New conversations will automatically appear here organized by date.',
      resetFilters: 'Reset Filters',
      calCellTip: (ymd, cnt) => cnt > 0 ? `${ymd}: ${cnt} conversation${cnt === 1 ? '' : 's'} (click to filter)` : `${ymd}: No conversations`,
      langBtn: '中',
    },
  };

  const MONTH_NAMES_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const MONTH_SHORT_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const detectDefaultLang = () =>
    /^zh\b/i.test(navigator.language || '') ? 'zh' : 'en';

  const state = {
    etag: '',
    conversations: [],
    workspaces: [],
    currentConversationId: '',
    groupMode: 'ymd',
    timeField: 'created',
    hideSubagents: true,
    showCalendar: true,
    langPref: 'auto', // 'auto' | 'zh' | 'en'
    workspaceFilter: '',
    searchQuery: '',
    selectedDateFilter: '',
    calYear: new Date().getFullYear(),
    calMonth: new Date().getMonth() + 1,
    openKeys: new Set(),
    initializedExpansion: false,
    renamingId: null,
  };

  const activeLang = () =>
    state.langPref === 'zh' || state.langPref === 'en' ? state.langPref : detectDefaultLang();
  const t = () => I18N[activeLang()];

  // ---------- Host Theme Sync ----------
  function syncTheme() {
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;color:var(--background, #f6f3ea)';
    document.documentElement.appendChild(probe);
    const computed = getComputedStyle(probe).color;
    probe.remove();
    const nums = (computed.match(/[\d.]+/g) || []).map(Number);
    if (nums.length >= 3) {
      const scale = computed.startsWith('color(') ? 1 : 255;
      const [r, g, b] = nums.slice(0, 3).map((v) => v / scale);
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      document.documentElement.dataset.theme = lum < 0.48 ? 'dark' : 'light';
    }
  }
  syncTheme();
  new MutationObserver(syncTheme).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style'],
  });

  // ---------- Sidecar Transport & Navigation ----------
  function activeConvId() {
    const params = new URLSearchParams(location.search);
    return (window.sidecar?.conversationId || params.get('conversationId') || '').toLowerCase();
  }

  async function apiFetch(path, options = { method: 'GET' }) {
    const fn = window.sidecar?.fetch ? window.sidecar.fetch.bind(window.sidecar) : fetch;
    const res = await fn(path, options);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  let toastTimer = null;
  function showToast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2200);
  }

  function openConversation(convId) {
    if (!convId) return;
    if (window.sidecar?.ui?.toggleConversation) {
      window.sidecar.ui.toggleConversation(convId);
      state.currentConversationId = convId.toLowerCase();
      renderTree();
      return;
    }
    navigator.clipboard?.writeText(convId).catch(() => {});
    showToast(t().copiedIdToast(convId.slice(0, 8)));
  }

  async function savePref(patch) {
    try {
      const updated = await apiFetch('/api/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      applyServerPrefs(updated);
      await loadConversations(true);
    } catch {
      showToast(t().saveFailedToast);
    }
  }

  function applyServerPrefs(prefs) {
    if (!prefs) return;
    if (prefs.groupMode === 'ymd' || prefs.groupMode === 'ym') state.groupMode = prefs.groupMode;
    if (prefs.timeField === 'created' || prefs.timeField === 'updated') state.timeField = prefs.timeField;
    if (typeof prefs.hideSubagents === 'boolean') state.hideSubagents = prefs.hideSubagents;
    if (typeof prefs.showCalendar === 'boolean') state.showCalendar = prefs.showCalendar;
    if (prefs.lang === 'auto' || prefs.lang === 'zh' || prefs.lang === 'en') state.langPref = prefs.lang;
    syncControlStates();
  }

  // ---------- Date Helpers (Viewer Local Timezone) ----------
  const pad2 = (n) => String(n).padStart(2, '0');

  function datePartsOf(iso) {
    const ms = Date.parse(iso);
    const d = Number.isFinite(ms) ? new Date(ms) : new Date();
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const weekday = t().weekdayNames[d.getDay()];
    return {
      ms: d.getTime(),
      year,
      month,
      day,
      weekday,
      ymKey: `${year}-${pad2(month)}`,
      ymdKey: `${year}-${pad2(month)}-${pad2(day)}`,
      clock: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
      monthDayClock: `${pad2(month)}/${pad2(day)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
    };
  }

  function todayKeys() {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const d = now.getDate();
    const yest = new Date(y, m - 1, d - 1);
    return {
      todayYmd: `${y}-${pad2(m)}-${pad2(d)}`,
      yesterdayYmd: `${yest.getFullYear()}-${pad2(yest.getMonth() + 1)}-${pad2(yest.getDate())}`,
      thisYm: `${y}-${pad2(m)}`,
      thisYear: String(y),
    };
  }

  function itemDateParts(conv) {
    const iso = state.timeField === 'updated' ? conv.updatedAt : conv.createdAt;
    return datePartsOf(iso);
  }

  // ---------- Filtering & Hierarchy Construction ----------
  function baseFilteredConversations() {
    const q = state.searchQuery.trim().toLowerCase();
    return state.conversations.filter((c) => {
      if (state.hideSubagents && c.isSubagent) return false;
      if (state.workspaceFilter && c.workspace !== state.workspaceFilter) return false;
      if (q) {
        const dp = itemDateParts(c);
        const hay = `${c.title}\n${c.autoTitle}\n${c.snippet}\n${(c.artifacts || []).join(' ')}\n${dp.ymdKey}\n${dp.year}年${dp.month}月${dp.day}日`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function dateFilteredConversations(baseList) {
    if (!state.selectedDateFilter) return baseList;
    return baseList.filter((c) => {
      const dp = itemDateParts(c);
      if (state.selectedDateFilter.length === 10) return dp.ymdKey === state.selectedDateFilter;
      return dp.ymKey === state.selectedDateFilter;
    });
  }

  function ensureInitialExpansion(items) {
    if (state.initializedExpansion) return;
    state.initializedExpansion = true;
    const { todayYmd, thisYm, thisYear } = todayKeys();
    state.openKeys.add('starred');
    state.openKeys.add(`y:${thisYear}`);
    state.openKeys.add(`m:${thisYm}`);
    state.openKeys.add(`d:${todayYmd}`);

    const targets = [items[0], items.find((c) => c.id === state.currentConversationId)].filter(Boolean);
    for (const item of targets) {
      const dp = itemDateParts(item);
      state.openKeys.add(`y:${dp.year}`);
      state.openKeys.add(`m:${dp.ymKey}`);
      state.openKeys.add(`d:${dp.ymdKey}`);
    }
    if (items[0]) {
      const newest = itemDateParts(items[0]);
      state.calYear = newest.year;
      state.calMonth = newest.month;
    }
  }

  // ---------- SVG Icons ----------
  const SVG_CHEVRON = '<svg class="chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const SVG_FOLDER = '<svg class="folder-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.8l1.4 1.5h4.8A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5v-7Z" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/></svg>';
  const SVG_CAL_DAY = '<svg class="folder-icon" viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="10" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M2.5 6.5h11M5.5 2v2.5M10.5 2v2.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
  const SVG_STAR = '<svg class="folder-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.2l1.75 3.55 3.92.57-2.84 2.76.67 3.9L8 11.14 4.5 12.98l.67-3.9L2.33 6.32l3.92-.57L8 2.2Z" fill="currentColor"/></svg>';

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- Render Calendar ----------
  function renderCalendar(baseList) {
    const L = t();
    const panel = $('calendar-panel');
    panel.classList.toggle('hidden', !state.showCalendar);
    $('toggle-cal-btn').classList.toggle('active', state.showCalendar);
    if (!state.showCalendar) return;

    $('cal-weekdays').innerHTML = L.weekdays.map((w) => `<span>${w}</span>`).join('');

    const dayCounts = new Map();
    let monthTotal = 0;
    const targetYm = `${state.calYear}-${pad2(state.calMonth)}`;

    for (const c of baseList) {
      const dp = itemDateParts(c);
      if (dp.ymKey === targetYm) {
        monthTotal++;
        dayCounts.set(dp.ymdKey, (dayCounts.get(dp.ymdKey) || 0) + 1);
      }
    }

    $('cal-title').textContent = L.monthHeader(state.calYear, pad2(state.calMonth), monthTotal);
    $('cal-clear-filter').classList.toggle('hidden', !state.selectedDateFilter);

    const firstDay = new Date(state.calYear, state.calMonth - 1, 1);
    const startOffset = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(state.calYear, state.calMonth, 0).getDate();
    const { todayYmd } = todayKeys();

    let html = '';
    for (let i = 0; i < startOffset; i++) {
      html += '<div class="cal-cell empty" aria-hidden="true"></div>';
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const ymd = `${state.calYear}-${pad2(state.calMonth)}-${pad2(d)}`;
      const cnt = dayCounts.get(ymd) || 0;
      const heat = cnt === 0 ? '' : cnt <= 2 ? 'heat-1' : cnt <= 6 ? 'heat-2' : 'heat-3';
      const cls = [
        'cal-cell',
        cnt > 0 ? 'has-data' : '',
        heat,
        ymd === todayYmd ? 'is-today' : '',
        state.selectedDateFilter === ymd ? 'is-selected' : '',
      ].filter(Boolean).join(' ');
      const title = L.calCellTip(ymd, cnt);
      html += `<button type="button" class="${cls}" data-cal-ymd="${ymd}" ${cnt === 0 ? 'disabled' : ''} title="${esc(title)}">` +
              `<span>${d}</span>${cnt > 0 ? `<span class="cal-count">${cnt}</span>` : ''}` +
              `</button>`;
    }
    $('cal-grid').innerHTML = html;
  }

  // ---------- Render Conversation Row ----------
  function renderConvRow(conv, dp, showMonthDay) {
    const L = t();
    const isCurrent = conv.id === state.currentConversationId;
    const isRenaming = state.renamingId === conv.id;
    const rowCls = [
      'conv-row',
      isCurrent ? 'is-current' : '',
      conv.starred ? 'is-starred' : '',
    ].filter(Boolean).join(' ');

    if (isRenaming) {
      return `<div class="${rowCls}" data-conv-id="${esc(conv.id)}">
        <form class="rename-form" data-rename-form="${esc(conv.id)}">
          <input class="rename-input" type="text" value="${esc(conv.hasAlias ? conv.title : conv.autoTitle)}" placeholder="${esc(L.renamePlaceholder)}" maxlength="120" />
          <button type="submit" class="ghost-btn active">${esc(L.save)}</button>
          <button type="button" class="ghost-btn" data-rename-cancel="1">${esc(L.cancel)}</button>
        </form>
      </div>`;
    }

    const timeText = showMonthDay ? dp.monthDayClock : dp.clock;
    const firstArtifact = conv.artifacts?.[0] ? conv.artifacts[0].replace(/\.md$/i, '') : '';
    const showSub = Boolean(firstArtifact || (state.workspaces.length > 1 && conv.workspace));

    return `<div class="${rowCls}" data-conv-id="${esc(conv.id)}">
      <button type="button" class="conv-main" data-open-conv="${esc(conv.id)}" title="${esc(conv.snippet || conv.title)}">
        <div class="conv-top">
          ${isCurrent ? `<span class="current-pill">${esc(L.currentBadge)}</span>` : ''}
          <span class="conv-title">${esc(conv.title)}</span>
          <span class="conv-time">${esc(timeText)}</span>
        </div>
        ${showSub ? `<div class="conv-sub">
          ${firstArtifact ? `<span class="conv-artifact-badge">📄 ${esc(firstArtifact)}</span>` : ''}
          ${state.workspaces.length > 1 && conv.workspace ? `<span class="conv-ws-badge">${esc(conv.workspace)}</span>` : ''}
        </div>` : ''}
      </button>
      <div class="conv-actions">
        <button type="button" class="act-btn act-rename" data-start-rename="${esc(conv.id)}" title="${esc(L.renameTip)}" aria-label="${esc(L.renameTip)}">✎</button>
        <button type="button" class="act-btn act-star ${conv.starred ? 'starred' : ''}" data-toggle-star="${esc(conv.id)}" title="${esc(conv.starred ? L.unstarTip : L.starTip)}" aria-label="Star">${conv.starred ? '★' : '☆'}</button>
      </div>
    </div>`;
  }

  // ---------- Render Folder Tree ----------
  function renderTree() {
    const L = t();
    const baseList = baseFilteredConversations();
    ensureInitialExpansion(baseList);
    renderCalendar(baseList);

    const visibleList = dateFilteredConversations(baseList);
    const forceExpand = Boolean(state.searchQuery.trim() || state.selectedDateFilter);
    const { todayYmd, yesterdayYmd } = todayKeys();

    const filterDesc = state.selectedDateFilter
      ? L.filteredDate(state.selectedDateFilter)
      : state.searchQuery.trim()
        ? L.filteredSearch
        : '';
    $('summary-text').textContent = L.summaryCount(visibleList.length, filterDesc);

    const anyFolderOpen = state.openKeys.size > 1;
    $('fold-toggle-btn').textContent = anyFolderOpen ? L.collapseAll : L.expandMonth;

    if (visibleList.length === 0) {
      $('tree-root').innerHTML = `<div class="empty-state">
        <p class="empty-title">${esc(L.emptyTitle)}</p>
        <p class="empty-desc">${esc(state.selectedDateFilter || state.searchQuery ? L.emptyFilteredDesc : L.emptyInitDesc)}</p>
        ${(state.selectedDateFilter || state.searchQuery) ? `<button type="button" class="ghost-btn active" id="reset-filters-btn">${esc(L.resetFilters)}</button>` : ''}
      </div>`;
      return;
    }

    const yearsMap = new Map();
    const starredItems = [];
    const sorted = [...visibleList].sort((a, b) => itemDateParts(b).ms - itemDateParts(a).ms);

    for (const conv of sorted) {
      const dp = itemDateParts(conv);
      if (conv.starred && !state.selectedDateFilter && !state.searchQuery.trim()) {
        starredItems.push({ conv, dp });
      }
      const yKey = String(dp.year);
      if (!yearsMap.has(yKey)) yearsMap.set(yKey, { year: dp.year, count: 0, months: new Map() });
      const yBucket = yearsMap.get(yKey);
      yBucket.count++;

      if (!yBucket.months.has(dp.ymKey)) {
        yBucket.months.set(dp.ymKey, { ymKey: dp.ymKey, month: dp.month, count: 0, days: new Map(), items: [] });
      }
      const mBucket = yBucket.months.get(dp.ymKey);
      mBucket.count++;
      mBucket.items.push({ conv, dp });

      if (!mBucket.days.has(dp.ymdKey)) {
        mBucket.days.set(dp.ymdKey, {
          ymdKey: dp.ymdKey,
          month: dp.month,
          day: dp.day,
          weekday: dp.weekday,
          items: [],
        });
      }
      mBucket.days.get(dp.ymdKey).items.push({ conv, dp });
    }

    let html = '';

    if (starredItems.length > 0) {
      const isOpen = forceExpand || state.openKeys.has('starred');
      html += `<section class="folder-group starred-section ${isOpen ? 'open' : ''}">
        <button type="button" class="folder-row" data-folder-key="starred" aria-expanded="${isOpen}">
          ${SVG_CHEVRON}${SVG_STAR}
          <span class="folder-label">${esc(L.starredFolder)}</span>
          <span class="folder-count">${starredItems.length}</span>
        </button>
        <div class="folder-children">
          ${starredItems.map(({ conv, dp }) => renderConvRow(conv, dp, true)).join('')}
        </div>
      </section>`;
    }

    for (const [yKey, yBucket] of yearsMap) {
      const yFolderKey = `y:${yKey}`;
      const yOpen = forceExpand || state.openKeys.has(yFolderKey);
      html += `<section class="folder-group level-year ${yOpen ? 'open' : ''}">
        <button type="button" class="folder-row" data-folder-key="${yFolderKey}" aria-expanded="${yOpen}">
          ${SVG_CHEVRON}${SVG_FOLDER}
          <span class="folder-label">${esc(L.yearLabel(yBucket.year))}</span>
          <span class="folder-count">${esc(L.countItems(yBucket.count))}</span>
        </button>
        <div class="folder-children">`;

      for (const [ymKey, mBucket] of yBucket.months) {
        const mFolderKey = `m:${ymKey}`;
        const mOpen = forceExpand || state.openKeys.has(mFolderKey);
        html += `<div class="folder-group level-month ${mOpen ? 'open' : ''}">
          <button type="button" class="folder-row" data-folder-key="${mFolderKey}" data-jump-ym="${ymKey}" aria-expanded="${mOpen}">
            ${SVG_CHEVRON}${SVG_FOLDER}
            <span class="folder-label">${esc(L.monthLabel(pad2(mBucket.month)))}</span>
            <span class="folder-count">${esc(L.countItems(mBucket.count))}</span>
          </button>
          <div class="folder-children">`;

        if (state.groupMode === 'ym') {
          html += mBucket.items.map(({ conv, dp }) => renderConvRow(conv, dp, true)).join('');
        } else {
          for (const [ymdKey, dBucket] of mBucket.days) {
            const dFolderKey = `d:${ymdKey}`;
            const dOpen = forceExpand || state.openKeys.has(dFolderKey);
            const badge = ymdKey === todayYmd ? `<span class="day-tag">${esc(L.today)}</span>`
              : ymdKey === yesterdayYmd ? `<span class="day-tag">${esc(L.yesterday)}</span>` : '';
            html += `<div class="folder-group level-day ${dOpen ? 'open' : ''}">
              <button type="button" class="folder-row" data-folder-key="${dFolderKey}" aria-expanded="${dOpen}">
                ${SVG_CHEVRON}${SVG_CAL_DAY}
                <span class="folder-label">${esc(L.dayLabel(pad2(dBucket.month), pad2(dBucket.day)))}</span>
                <span class="folder-weekday">${esc(dBucket.weekday)}</span>
                ${badge}
                <span class="folder-count">${dBucket.items.length}</span>
              </button>
              <div class="folder-children">
                ${dBucket.items.map(({ conv, dp }) => renderConvRow(conv, dp, false)).join('')}
              </div>
            </div>`;
          }
        }

        html += `</div></div>`;
      }

      html += `</div></section>`;
    }

    $('tree-root').innerHTML = html;

    if (state.renamingId) {
      const inp = document.querySelector(`[data-rename-form="${CSS.escape(state.renamingId)}"] .rename-input`);
      if (inp) {
        inp.focus();
        inp.select();
      }
    }
  }

  function syncControlStates() {
    const L = t();
    document.documentElement.lang = activeLang() === 'zh' ? 'zh-CN' : 'en';
    $('search-input').placeholder = L.searchPlaceholder;
    $('btn-mode-ymd').textContent = L.modeYmd;
    $('btn-mode-ym').textContent = L.modeYm;
    $('btn-time-created').textContent = L.timeCreated;
    $('btn-time-updated').textContent = L.timeUpdated;
    $('toggle-cal-btn').textContent = L.calendarBtn;
    $('cal-today').textContent = L.today;
    $('cal-clear-filter').textContent = L.showAllDates;
    $('refresh-btn').textContent = L.refresh;
    $('lang-toggle-btn').textContent = L.langBtn;

    document.querySelectorAll('[data-group-mode]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.groupMode === state.groupMode);
    });
    document.querySelectorAll('[data-time-field]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.timeField === state.timeField);
    });
    $('toggle-cal-btn').classList.toggle('active', state.showCalendar);

    const wsSelect = $('workspace-select');
    if (state.workspaces.length > 1) {
      wsSelect.classList.remove('hidden');
      const cur = state.workspaceFilter;
      wsSelect.innerHTML = `<option value="">${esc(L.allProjects)}</option>` +
        state.workspaces.map((w) => `<option value="${esc(w)}">${esc(w)}</option>`).join('');
      wsSelect.value = state.workspaces.includes(cur) ? cur : '';
    } else {
      wsSelect.classList.add('hidden');
    }
  }

  // ---------- Data Polling ----------
  async function loadConversations(force = false) {
    try {
      const convId = activeConvId();
      const qs = new URLSearchParams();
      if (convId) qs.set('conversationId', convId);
      if (!force && state.etag) qs.set('etag', state.etag);
      if (force) qs.set('force', '1');

      const data = await apiFetch(`/api/conversations?${qs.toString()}`);
      if (data.currentConversationId) {
        state.currentConversationId = data.currentConversationId;
      }
      if (data.unchanged) return;

      state.etag = data.etag || '';
      state.conversations = Array.isArray(data.conversations) ? data.conversations : [];
      state.workspaces = Array.isArray(data.workspaces) ? data.workspaces : [];
      applyServerPrefs(data.preferences);
      syncControlStates();
      renderTree();
    } catch {
      $('summary-text').textContent = t().reconnecting;
    }
  }

  // ---------- Event Listeners ----------
  $('search-input').addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    $('search-clear').classList.toggle('hidden', !state.searchQuery);
    renderTree();
  });

  $('search-clear').addEventListener('click', () => {
    state.searchQuery = '';
    $('search-input').value = '';
    $('search-clear').classList.add('hidden');
    $('search-input').focus();
    renderTree();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== $('search-input') && !state.renamingId) {
      e.preventDefault();
      $('search-input').focus();
    } else if (e.key === 'Escape') {
      if (state.renamingId) {
        state.renamingId = null;
        renderTree();
      } else if (state.searchQuery) {
        state.searchQuery = '';
        $('search-input').value = '';
        $('search-clear').classList.add('hidden');
        renderTree();
      }
    }
  });

  document.querySelectorAll('[data-group-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.groupMode = btn.dataset.groupMode;
      syncControlStates();
      renderTree();
      savePref({ groupMode: state.groupMode });
    });
  });

  document.querySelectorAll('[data-time-field]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.timeField = btn.dataset.timeField;
      syncControlStates();
      renderTree();
      savePref({ timeField: state.timeField });
    });
  });

  $('workspace-select').addEventListener('change', (e) => {
    state.workspaceFilter = e.target.value;
    renderTree();
  });

  $('toggle-cal-btn').addEventListener('click', () => {
    state.showCalendar = !state.showCalendar;
    renderTree();
    savePref({ showCalendar: state.showCalendar });
  });

  $('fold-toggle-btn').addEventListener('click', () => {
    if (state.openKeys.size > 1) {
      state.openKeys.clear();
    } else {
      const { todayYmd, thisYm, thisYear } = todayKeys();
      state.openKeys.add('starred');
      state.openKeys.add(`y:${thisYear}`);
      state.openKeys.add(`m:${thisYm}`);
      state.openKeys.add(`d:${todayYmd}`);
    }
    renderTree();
  });

  $('lang-toggle-btn').addEventListener('click', () => {
    const next = activeLang() === 'zh' ? 'en' : 'zh';
    state.langPref = next;
    syncControlStates();
    renderTree();
    savePref({ lang: next });
  });

  $('cal-prev').addEventListener('click', () => {
    state.calMonth--;
    if (state.calMonth < 1) {
      state.calMonth = 12;
      state.calYear--;
    }
    renderTree();
  });

  $('cal-next').addEventListener('click', () => {
    state.calMonth++;
    if (state.calMonth > 12) {
      state.calMonth = 1;
      state.calYear++;
    }
    renderTree();
  });

  $('cal-title').addEventListener('click', () => {
    const ym = `${state.calYear}-${pad2(state.calMonth)}`;
    state.selectedDateFilter = state.selectedDateFilter === ym ? '' : ym;
    state.openKeys.add(`y:${state.calYear}`);
    state.openKeys.add(`m:${ym}`);
    renderTree();
  });

  $('cal-today').addEventListener('click', () => {
    const now = new Date();
    state.calYear = now.getFullYear();
    state.calMonth = now.getMonth() + 1;
    const { todayYmd, thisYm, thisYear } = todayKeys();
    state.selectedDateFilter = '';
    state.openKeys.add(`y:${thisYear}`);
    state.openKeys.add(`m:${thisYm}`);
    state.openKeys.add(`d:${todayYmd}`);
    renderTree();
  });

  $('cal-clear-filter').addEventListener('click', () => {
    state.selectedDateFilter = '';
    renderTree();
  });

  $('cal-grid').addEventListener('click', (e) => {
    const cell = e.target.closest('[data-cal-ymd]');
    if (!cell || cell.disabled) return;
    const ymd = cell.dataset.calYmd;
    state.selectedDateFilter = state.selectedDateFilter === ymd ? '' : ymd;
    const [y, m] = ymd.split('-');
    state.openKeys.add(`y:${y}`);
    state.openKeys.add(`m:${y}-${m}`);
    state.openKeys.add(`d:${ymd}`);
    renderTree();
  });

  $('refresh-btn').addEventListener('click', () => {
    loadConversations(true);
    showToast(t().refreshedToast);
  });

  $('tree-root').addEventListener('click', (e) => {
    if (e.target.id === 'reset-filters-btn') {
      state.selectedDateFilter = '';
      state.searchQuery = '';
      $('search-input').value = '';
      $('search-clear').classList.add('hidden');
      renderTree();
      return;
    }

    const folderBtn = e.target.closest('[data-folder-key]');
    if (folderBtn) {
      const key = folderBtn.dataset.folderKey;
      if (state.openKeys.has(key)) state.openKeys.delete(key);
      else {
        state.openKeys.add(key);
        if (folderBtn.dataset.jumpYm) {
          const [y, m] = folderBtn.dataset.jumpYm.split('-').map(Number);
          state.calYear = y;
          state.calMonth = m;
        }
      }
      renderTree();
      return;
    }

    const starBtn = e.target.closest('[data-toggle-star]');
    if (starBtn) {
      e.stopPropagation();
      savePref({ toggleStar: starBtn.dataset.toggleStar });
      return;
    }

    const renameBtn = e.target.closest('[data-start-rename]');
    if (renameBtn) {
      e.stopPropagation();
      state.renamingId = renameBtn.dataset.startRename;
      renderTree();
      return;
    }

    if (e.target.closest('[data-rename-cancel]')) {
      state.renamingId = null;
      renderTree();
      return;
    }

    const openBtn = e.target.closest('[data-open-conv]');
    if (openBtn) {
      openConversation(openBtn.dataset.openConv);
    }
  });

  $('tree-root').addEventListener('submit', (e) => {
    const form = e.target.closest('[data-rename-form]');
    if (!form) return;
    e.preventDefault();
    const id = form.dataset.renameForm;
    const val = form.querySelector('.rename-input')?.value || '';
    state.renamingId = null;
    savePref({ alias: { id, title: val } });
  });

  syncControlStates();
  loadConversations(false);
  setInterval(() => {
    if (!document.hidden && !state.renamingId) {
      loadConversations(false);
    }
  }, POLL_MS);
})();
