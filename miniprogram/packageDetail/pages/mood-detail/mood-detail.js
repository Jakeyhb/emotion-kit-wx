const STORAGE_KEY = 'kitMoodRecords';
const toast = require('../../../utils/toast');

const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;

const MOOD_COLORS = {
  very_low: '#a8b5c4', low: '#8b9cb0', neutral_low: '#7b8fa3', neutral: '#6b8cae',
  calm: '#7ba3a8', ok: '#6b9b8a', good: '#5a9a7a', unsure: '#9a9a9a'
};

const DEGREE_LABEL = { 1: '很轻', 2: '较轻', 3: '中等', 4: '较强', 5: '很强' };

function clampDegree(v) {
  const n = parseInt(v, 10);
  if (Number.isFinite(n) && n >= 1 && n <= 5) return n;
  return 3;
}

function parseWhatToDoSegments(whatToDo) {
  if (!whatToDo || typeof whatToDo !== 'string') return [];
  const openTag = '《重点》';
  const closeTag = '《/重点》';
  const segments = [];
  let pos = 0;
  while (true) {
    const i = whatToDo.indexOf(openTag, pos);
    if (i === -1) {
      if (pos < whatToDo.length) segments.push({ type: 'normal', text: whatToDo.slice(pos) });
      break;
    }
    if (i > pos) segments.push({ type: 'normal', text: whatToDo.slice(pos, i) });
    const j = whatToDo.indexOf(closeTag, i + openTag.length);
    if (j === -1) {
      segments.push({ type: 'highlight', text: whatToDo.slice(i + openTag.length) });
      break;
    }
    segments.push({ type: 'highlight', text: whatToDo.slice(i + openTag.length, j) });
    pos = j + closeTag.length;
  }
  return segments.length ? segments : [{ type: 'normal', text: whatToDo }];
}

const DEGREE_LINE_COLOR = {
  1: '#d0dcd8',
  2: '#a8c0b8',
  3: '#7a9a8e',
  4: '#5a7a6e',
  5: '#4a6a5a'
};

const EMOTION_COLORS = {
  焦虑: '#8b9cb0', 愤怒: '#a87a7a', 悲伤: '#7a8a9a', 羞耻: '#9a8a7a', 内疚: '#7a7a8a',
  恐惧: '#6a7a8a', 空虚: '#8a8a8a', 愉悦: '#5a9a7a', 平静: '#7ba3a8', 委屈: '#8b8a9a',
  嫉妒: '#7a6a8a', 爱: '#9a7a7a', 感恩: '#6b9b8a', 麻木: '#9a9a9a', 其他: '#8b9cb0'
};

function formatChinaDateTime(ms) {
  const d = new Date(ms + CHINA_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function getRecordsArray() {
  const raw = wx.getStorageSync(STORAGE_KEY);
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return Object.entries(raw)
      .filter(([d]) => d.length === 10)
      .map(([date, r]) => ({ id: `${date}_${(r.savedAt || Date.now())}`, date, ...r }));
  }
  return [];
}

function normalizeRecord(record) {
  if (!record) return record;
  let tagsDisplay = '';
  if (record.tags != null) {
    if (Array.isArray(record.tags)) tagsDisplay = record.tags.join('、');
    else if (typeof record.tags === 'string') tagsDisplay = record.tags;
  }
  let emotionsDisplay = '';
  let emotionsForDisplay = [];
  if (record.emotions && Array.isArray(record.emotions) && record.emotions.length) {
    emotionsDisplay = record.emotions
      .map((e) => `${e.name}（${DEGREE_LABEL[clampDegree(e.degree)] || '中等'}）`)
      .join('、');
    emotionsForDisplay = record.emotions.map((e, ei) => {
      const degree = clampDegree(e.degree);
      const degreeSegments = [1, 2, 3, 4, 5].map((d) => ({
        value: d,
        lineColor: DEGREE_LINE_COLOR[d] || DEGREE_LINE_COLOR[3],
        isActive: d === degree
      }));
      return {
        rowKey: `${e.name}-${ei}`,
        name: e.name,
        degreeLabel: DEGREE_LABEL[degree] || '中等',
        color: EMOTION_COLORS[e.name] || '#7a9a8e',
        lineColor: DEGREE_LINE_COLOR[degree] || DEGREE_LINE_COLOR[3],
        degreeSegments
      };
    });
  }
  const moodColor = (record.emotions && record.emotions[0] && record.emotions[0].name)
    ? (EMOTION_COLORS[record.emotions[0].name] || '#7a9a8e')
    : (MOOD_COLORS[record.mood] || '#8b9cb0');
  let aiResult = record.aiResult;
  if (aiResult && aiResult.whatToDo) {
    const whatToDoSegments = parseWhatToDoSegments(aiResult.whatToDo);
    aiResult = { ...aiResult, whatToDoSegments };
  }
  return { ...record, tagsDisplay, emotionsDisplay, emotionsForDisplay, moodColor, aiResult };
}

Page({
  data: {
    record: null,
    displayTime: ''
  },

  onLoad(options) {
    this.setData({ record: null, displayTime: '' });

    const id = options.id || '';
    if (!id) {
      toast.hint('这条记录找不到啦～');
      return;
    }
    const records = getRecordsArray();
    let record = records.find(r => r.id === id) || null;
    if (record) record = normalizeRecord(record);
    const displayTime = record && record.savedAt ? formatChinaDateTime(record.savedAt) : '';
    this.setData({ record, displayTime });
  },

  onReady() {
    setTimeout(() => {
      wx.pageScrollTo({ scrollTop: 0, duration: 0 });
    }, 50);
  }
});
