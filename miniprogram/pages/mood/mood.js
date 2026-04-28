// 每日情绪记录 - 设计原则：安全、低负担、不评判；记录一次即一条数据
const STORAGE_KEY = 'kitMoodRecords';
const PREMISE_STORAGE_KEY = 'kit_user_premise';
const NICK_STORAGE_KEY = 'kit_user_nickname';
const PREMISE_INTRO_DONE_KEY = 'kit_premise_intro_done';
const toast = require('../../utils/toast');
const { reflectEmotion } = require('../../utils/apiClient');

const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;

const getToday = () => {
  const d = new Date(Date.now() + CHINA_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

function formatChinaTime(ms) {
  const d = new Date(ms + CHINA_OFFSET_MS);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function formatFriendlyTime(ms) {
  const d = new Date((ms || Date.now()) + CHINA_OFFSET_MS);
  const h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  const segment = h < 6 ? '凌晨' : h < 12 ? '上午' : h === 12 ? '中午' : h < 18 ? '下午' : '晚上';
  const hour12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${segment} ${hour12}:${m}`;
}

function formatDateShort(dateStr) {
  if (!dateStr || dateStr.length !== 10) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${m}月${d}日`;
}

const formatRecordTitle = (dateStr, savedAt, includeDate = false) => {
  const timePart = formatFriendlyTime(savedAt || Date.now());
  if (includeDate && dateStr && dateStr.length === 10) {
    return `${formatDateShort(dateStr)} ${timePart}`;
  }
  return timePart;
};

function getRecordsArray() {
  const raw = wx.getStorageSync(STORAGE_KEY);
  if (Array.isArray(raw)) {
    return raw.slice().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const arr = Object.entries(raw)
      .filter(([d]) => d.length === 10)
      .map(([date, r]) => ({ id: `${date}_${(r.savedAt || Date.now())}`, date, ...r }));
    arr.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    wx.setStorageSync(STORAGE_KEY, arr);
    return arr;
  }
  return [];
}

const EMOTION_OPTIONS = [
  { name: '焦虑', color: '#8b9cb0' },
  { name: '愤怒', color: '#a87a7a' },
  { name: '悲伤', color: '#7a8a9a' },
  { name: '羞耻', color: '#9a8a7a' },
  { name: '内疚', color: '#7a7a8a' },
  { name: '恐惧', color: '#6a7a8a' },
  { name: '空虚', color: '#8a8a8a' },
  { name: '愉悦', color: '#5a9a7a' },
  { name: '平静', color: '#7ba3a8' },
  { name: '委屈', color: '#8b8a9a' },
  { name: '嫉妒', color: '#7a6a8a' },
  { name: '爱', color: '#9a7a7a' },
  { name: '感恩', color: '#6b9b8a' },
  { name: '麻木', color: '#9a9a9a' },
  { name: '其他', color: '#8b9cb0' }
];

const DEGREE_OPTIONS = [
  { value: 1, label: '很轻', lineColor: '#d0dcd8' },
  { value: 2, label: '较轻', lineColor: '#a8c0b8' },
  { value: 3, label: '中等', lineColor: '#7a9a8e' },
  { value: 4, label: '较强', lineColor: '#5a7a6e' },
  { value: 5, label: '很强', lineColor: '#4a6a5a' }
];

function getMoodColor(moodValueOrEmotionName) {
  if (!moodValueOrEmotionName) return '#7a9a8e';
  const opt = EMOTION_OPTIONS.find(o => o.name === moodValueOrEmotionName);
  return opt ? opt.color : '#7a9a8e';
}

function getChinaDateStrFromDate(d) {
  const t = (d && d.getTime ? d.getTime() : Date.now()) + CHINA_OFFSET_MS;
  const x = new Date(t);
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`;
}

function getChinaDayOfWeek(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function addDaysToDateStr(dateStr, delta) {
  const d = new Date(dateStr.replace(/-/g, '/'));
  d.setDate(d.getDate() + delta);
  const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getMondayOfWeekChina(dateStr) {
  const dow = getChinaDayOfWeek(dateStr);
  const offset = dow === 0 ? -6 : 1 - dow;
  return addDaysToDateStr(dateStr, offset);
}

function getWeekDays(refDate, recordsByDate, moodColorByDate) {
  const refStr = getChinaDateStrFromDate(refDate);
  const mondayStr = getMondayOfWeekChina(refStr);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const dateStr = addDaysToDateStr(mondayStr, i);
    const dayNum = parseInt(dateStr.slice(8, 10), 10);
    const rec = recordsByDate[dateStr];
    days.push({
      date: dateStr,
      dayNum,
      isToday: dateStr === getToday(),
      hasRecord: !!rec,
      moodColor: (moodColorByDate && moodColorByDate[dateStr]) || '#8b9cb0'
    });
  }
  return days;
}

function getMonthGrid(refDate, recordsByDate, moodColorByDate) {
  const refStr = getChinaDateStrFromDate(refDate);
  const [refY, refM] = refStr.split('-').map(Number);
  const firstDayStr = `${refY}-${String(refM).padStart(2, '0')}-01`;
  const firstDow = getChinaDayOfWeek(firstDayStr);
  const startOffset = firstDow === 0 ? -6 : 1 - firstDow;
  const startStr = addDaysToDateStr(firstDayStr, startOffset);
  const todayStr = getToday();
  const grid = [];
  for (let row = 0; row < 6; row++) {
    const rowCells = [];
    for (let col = 0; col < 7; col++) {
      const dateStr = addDaysToDateStr(startStr, row * 7 + col);
      const [y, m, day] = dateStr.split('-').map(Number);
      const isCurrentMonth = y === refY && m === refM;
      const rec = recordsByDate[dateStr];
      rowCells.push({
        date: dateStr,
        dayNum: day,
        isToday: dateStr === todayStr,
        hasRecord: !!rec,
        isCurrentMonth,
        moodColor: (moodColorByDate && moodColorByDate[dateStr]) || '#8b9cb0'
      });
    }
    grid.push(rowCells);
  }
  return grid;
}

function getRecordsByDate(records) {
  const byDate = {};
  (records || []).forEach(r => {
    if (r.date && !byDate[r.date]) byDate[r.date] = r;
  });
  return byDate;
}

function getDominantMoodColorByDate(records) {
  const byDate = {};
  (records || []).forEach(r => {
    if (!r.date) return;
    if (!byDate[r.date]) byDate[r.date] = {};
    const key = r.emotions && r.emotions[0] ? r.emotions[0].name : (r.mood || r.moodLabel || '');
    byDate[r.date][key] = (byDate[r.date][key] || 0) + 1;
  });
  const colorByDate = {};
  Object.keys(byDate).forEach(dateStr => {
    const counts = byDate[dateStr];
    let maxKey = '';
    let maxCount = 0;
    Object.entries(counts).forEach(([k, n]) => {
      if (n > maxCount) {
        maxCount = n;
        maxKey = k;
      }
    });
    colorByDate[dateStr] = getMoodColor(maxKey);
  });
  return colorByDate;
}

function getWeekTitle(refDate) {
  const days = getWeekDays(refDate, {});
  if (!days.length) return '';
  const first = days[0].date.split('-');
  const last = days[6].date.split('-');
  return `${parseInt(first[1])}月${parseInt(first[2])}日 - ${parseInt(last[1])}月${parseInt(last[2])}日`;
}

function getMonthTitle(refDate) {
  const s = getChinaDateStrFromDate(refDate);
  const [y, m] = s.split('-');
  return `${y}年${parseInt(m, 10)}月`;
}

function formatDateLabel(dateStr) {
  if (!dateStr || dateStr.length < 10) return dateStr || '';
  const parts = dateStr.split('-');
  return `${parseInt(parts[1], 10)}月${parseInt(parts[2], 10)}日`;
}

Page({
  data: {
    today: getToday(),
    emotionOptions: EMOTION_OPTIONS,
    degreeOptions: DEGREE_OPTIONS,
    emotionList: EMOTION_OPTIONS.map(o => ({ ...o, selected: false })),
    selectedEmotions: [],
    selectedEmotionsWithColor: [],
    question3: '',
    userPremise: '',
    showPremiseIntro: false,
    showPremiseEdit: false,
    premiseModalValue: '',
    todayRecord: null,
    recentList: [],
    showMore: false,
    calendarView: 'week',
    calendarRefDate: null,
    weekDays: [],
    monthGrid: [],
    calendarTitle: '',
    selectedDate: getToday(),
    selectedDateLabel: formatDateLabel(getToday()),
    selectedDateRecords: [],
    showToast: false,
    toastText: '',
    toastType: 'success',
    showBackTop: false
  },

  onPageScroll(e) {
    const show = (e && e.scrollTop) > 280;
    if (this.data.showBackTop !== show) this.setData({ showBackTop: show });
  },

  onBackTop() {
    wx.pageScrollTo({ scrollTop: 0, duration: 320 });
  },

  onLoad() {
    toast.setPage(this);
    const savedPremise = wx.getStorageSync(PREMISE_STORAGE_KEY) || '';
    this.setData({ userPremise: savedPremise });
    this.initCalendar();
    this.loadRecords();
  },

  onShow() {
    this.setData({ today: getToday() });
    this.loadRecords();
    this.refreshCalendar();
    const introDone = wx.getStorageSync(PREMISE_INTRO_DONE_KEY);
    if (!introDone) {
      const saved = wx.getStorageSync(PREMISE_STORAGE_KEY) || '';
      this.setData({
        showPremiseIntro: true,
        premiseModalValue: saved
      });
    }
  },

  initCalendar() {
    const ref = new Date();
    this.setData({
      calendarRefDate: ref,
      calendarTitle: getWeekTitle(ref)
    });
    this.refreshCalendar();
  },

  refreshCalendar() {
    const records = getRecordsArray();
    const byDate = getRecordsByDate(records);
    const ref = this.data.calendarRefDate ? new Date(this.data.calendarRefDate) : new Date();
    const view = this.data.calendarView || 'week';
    const moodColorByDate = getDominantMoodColorByDate(records);

    if (view === 'week') {
      const weekDays = getWeekDays(ref, byDate, moodColorByDate);
      this.setData({
        weekDays,
        calendarTitle: getWeekTitle(ref)
      });
    } else {
      const monthGrid = getMonthGrid(ref, byDate, moodColorByDate);
      this.setData({
        monthGrid,
        calendarTitle: getMonthTitle(ref)
      });
    }
    this.updateSelectedDateRecords(records);
  },

  updateSelectedDateRecords(records) {
    const sel = this.data.selectedDate;
    if (!sel) {
      this.setData({ selectedDateRecords: [], selectedDateLabel: '' });
      return;
    }
    const moodKey = r => r.emotions?.[0]?.name || r.moodLabel || r.mood;
    const list = (records || [])
      .filter(r => r.date === sel)
      .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
      .map(r => {
        const emotionsShort = r.emotions && r.emotions.length
          ? (r.emotions.slice(0, 3).map(e => e.name).join('、') + (r.emotions.length > 3 ? ' 等' : ''))
          : (r.tags && r.tags.length ? r.tags.slice(0, 3).join('、') + (r.tags.length > 3 ? ' 等' : '') : '');
        return {
          ...r,
          displayTitle: formatRecordTitle(r.date, r.savedAt, false),
          moodColor: getMoodColor(moodKey(r)),
          emotionsShort
        };
      });
    this.setData({
      selectedDateRecords: list,
      selectedDateLabel: formatDateLabel(sel)
    });
  },

  loadRecords() {
    const records = getRecordsArray();
    const today = getToday();
    const todayRecord = records.find(r => r.date === today) || null;
    const recentList = records.map(r => {
      const moodKey = r.emotions?.[0]?.name || r.moodLabel || r.mood;
      const displaySummary = r.emotions
        ? (r.emotions[0].name + (r.emotions.length > 1 ? ' 等' : ''))
        : (r.moodLabel || '');
      const emotionsShort = r.emotions && r.emotions.length
        ? (r.emotions.slice(0, 3).map(e => e.name).join('、') + (r.emotions.length > 3 ? ' 等' : ''))
        : (r.tags && r.tags.length ? r.tags.slice(0, 3).join('、') + (r.tags.length > 3 ? ' 等' : '') : '');
      return {
        ...r,
        displayTitle: formatRecordTitle(r.date, r.savedAt, true),
        moodColor: getMoodColor(moodKey),
        displaySummary,
        emotionsShort
      };
    });

    this.setData({
      records,
      todayRecord: todayRecord ? {
        ...todayRecord,
        displaySummary: todayRecord.emotions
          ? (todayRecord.emotions[0].name + (todayRecord.emotions.length > 1 ? ' 等' : ''))
          : (todayRecord.moodLabel || '')
      } : null,
      recentList
    });
    this.refreshCalendar();
  },

  calendarPrev() {
    const ref = new Date(this.data.calendarRefDate || Date.now());
    if (this.data.calendarView === 'week') {
      ref.setDate(ref.getDate() - 7);
    } else {
      ref.setMonth(ref.getMonth() - 1);
    }
    this.setData({ calendarRefDate: ref });
    this.refreshCalendar();
  },

  calendarNext() {
    const ref = new Date(this.data.calendarRefDate || Date.now());
    if (this.data.calendarView === 'week') {
      ref.setDate(ref.getDate() + 7);
    } else {
      ref.setMonth(ref.getMonth() + 1);
    }
    this.setData({ calendarRefDate: ref });
    this.refreshCalendar();
  },

  switchCalendarView() {
    const next = this.data.calendarView === 'week' ? 'month' : 'week';
    this.setData({ calendarView: next });
    this.refreshCalendar();
  },

  onSelectDay(e) {
    const date = e.currentTarget.dataset.date;
    if (!date) return;
    this.setData({ selectedDate: date });
    this.updateSelectedDateRecords(getRecordsArray());
  },

  onEmotionTap(e) {
    const name = e.currentTarget.dataset.name;
    if (!name) return;
    let selectedEmotions = [...(this.data.selectedEmotions || [])];
    const idx = selectedEmotions.findIndex(item => item.name === name);
    if (idx >= 0) {
      selectedEmotions.splice(idx, 1);
    } else {
      selectedEmotions.push({ name, degree: 3 });
    }
    const emotionList = (this.data.emotionOptions || []).map(o => ({
      ...o,
      selected: selectedEmotions.some(item => item.name === o.name)
    }));
    const selectedEmotionsWithColor = selectedEmotions.map(e => {
      const opt = EMOTION_OPTIONS.find(o => o.name === e.name);
      const degOpt = DEGREE_OPTIONS.find(o => o.value === e.degree);
      return {
        ...e,
        color: opt ? opt.color : '#7a9a8e',
        degreeLabel: degOpt ? degOpt.label : '中等'
      };
    });
    this.setData({ selectedEmotions, emotionList, selectedEmotionsWithColor });
  },

  onDegreeChange(e) {
    const { name, degree } = e.currentTarget.dataset;
    if (name == null || degree == null) return;
    const d = Number(degree);
    const selectedEmotions = (this.data.selectedEmotions || []).map(item =>
      item.name === name ? { ...item, degree: d } : item
    );
    const selectedEmotionsWithColor = selectedEmotions.map(e => {
      const opt = EMOTION_OPTIONS.find(o => o.name === e.name);
      const degOpt = DEGREE_OPTIONS.find(o => o.value === e.degree);
      return {
        ...e,
        color: opt ? opt.color : '#7a9a8e',
        degreeLabel: degOpt ? degOpt.label : '中等'
      };
    });
    this.setData({ selectedEmotions, selectedEmotionsWithColor });
  },

  onQuestion3Input(e) {
    this.setData({ question3: (e.detail && e.detail.value) || '' });
  },

  onPremiseModalInput(e) {
    const value = (e.detail && e.detail.value) || '';
    this.setData({ premiseModalValue: value });
  },

  confirmPremiseIntro() {
    const v = (this.data.premiseModalValue || '').trim();
    if (!v) {
      toast.hint('请至少填写一点哦，AI 解读会更贴合你');
      return;
    }
    wx.setStorageSync(PREMISE_STORAGE_KEY, v);
    wx.setStorageSync(PREMISE_INTRO_DONE_KEY, true);
    this.setData({
      userPremise: v,
      showPremiseIntro: false,
      premiseModalValue: ''
    });
    toast.success('已保存～');
  },

  skipPremiseIntro() {
    wx.setStorageSync(PREMISE_INTRO_DONE_KEY, true);
    this.setData({
      showPremiseIntro: false,
      premiseModalValue: ''
    });
  },

  openPremiseEdit() {
    this.setData({
      showPremiseEdit: true,
      premiseModalValue: this.data.userPremise || ''
    });
  },

  savePremiseEdit() {
    const v = (this.data.premiseModalValue || '').trim();
    wx.setStorageSync(PREMISE_STORAGE_KEY, v);
    this.setData({
      userPremise: v,
      showPremiseEdit: false,
      premiseModalValue: ''
    });
    toast.success('已保存～');
  },

  closePremiseEdit() {
    this.setData({
      showPremiseEdit: false,
      premiseModalValue: ''
    });
  },

  preventMove() {},

  toggleMore() {
    this.setData({ showMore: !this.data.showMore });
  },

  async saveRecord() {
    const { selectedEmotions, question3 } = this.data;
    if (!selectedEmotions || selectedEmotions.length === 0) {
      toast.hint('先选至少一种情绪哦～');
      return;
    }

    const today = getToday();
    const savedAt = Date.now();
    const id = `${today}_${savedAt}`;
    const emotions = selectedEmotions.map(e => ({ name: e.name, degree: e.degree }));
    const summary = emotions[0].name + (emotions.length > 1 ? ' 等' : '');
    const newRecord = {
      id,
      date: today,
      emotions,
      question3: (question3 && question3.trim()) || undefined,
      moodLabel: summary,
      mood: emotions[0].name,
      savedAt,
      aiStatus: 'pending',
      aiPendingAt: savedAt
    };

    const records = getRecordsArray();
    records.unshift(newRecord);
    wx.setStorageSync(STORAGE_KEY, records);
    this.setData({
      records,
      todayRecord: newRecord,
      selectedEmotions: [],
      selectedEmotionsWithColor: [],
      emotionList: EMOTION_OPTIONS.map(o => ({ ...o, selected: false })),
      question3: '',
      showMore: false
    });
    toast.success('记下啦～', 1500);
    this.loadRecords();

    // 调用 node-ai-service 进行 AI 解读
    const premise = wx.getStorageSync(PREMISE_STORAGE_KEY) || '';
    try {
      const { whatIsWrong, whatToDo } = await reflectEmotion({
        emotions,
        question3: (question3 && question3.trim()) || undefined,
        premise: (premise && premise.trim()) || undefined,
        recordId: id
      });
      const arr = getRecordsArray();
      const i = arr.findIndex(r => r.id === id);
      if (i >= 0) {
        arr[i].aiResult = { whatIsWrong, whatToDo };
        arr[i].aiStatus = 'done';
        arr[i].aiError = undefined;
        arr[i].aiPendingAt = undefined;
        wx.setStorageSync(STORAGE_KEY, arr);
      }
      this.loadRecords();
      toast.success('解读好了～');
    } catch (e) {
      console.error('reflectEmotion fail', e);
      const msg = (e && e.message) || '解读暂时没跟上，稍后再试哦～';
      const arr = getRecordsArray();
      const i = arr.findIndex(r => r.id === id);
      if (i >= 0) {
        arr[i].aiStatus = 'failed';
        arr[i].aiError = msg;
        arr[i].aiPendingAt = undefined;
        wx.setStorageSync(STORAGE_KEY, arr);
      }
      this.loadRecords();
      toast.fail(msg, 2500);
    }
  },

  clearAllEmotionRecords() {
    wx.showModal({
      title: '清空情绪记录',
      content: '确定要清空所有情绪记录吗？本地数据将被删除，且不可恢复。',
      confirmText: '清空',
      confirmColor: '#c62828',
      success: (res) => {
        if (!res.confirm) return;
        wx.setStorageSync(STORAGE_KEY, []);
        this.loadRecords();
        this.showCustomToast('已清空所有情绪记录', 'success');
      }
    });
  },

  showCustomToast(text, type = 'success', duration = 2000) {
    this.setData({
      showToast: true,
      toastText: text,
      toastType: type
    });
    setTimeout(() => {
      this.setData({ showToast: false });
    }, duration);
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/packageDetail/pages/mood-detail/mood-detail?id=${id}` });
  },

  clearSelection() {
    const emotionList = (this.data.emotionOptions || []).map(o => ({ ...o, selected: false }));
    this.setData({
      selectedEmotions: [],
      emotionList,
      question3: '',
      showMore: false
    });
  }
});
