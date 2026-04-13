const PHASES = [
  { key: 'in', label: '吸气', sec: 4, hint: '用鼻缓慢吸气，让腹部轻轻鼓起' },
  { key: 'hold1', label: '屏息', sec: 4, hint: '柔和地停住，不憋紧' },
  { key: 'out', label: '呼气', sec: 6, hint: '用嘴或鼻慢慢呼出，肩膀放松' },
  { key: 'hold2', label: '停', sec: 2, hint: '自然停顿，准备下一轮' }
];

const phasesForView = PHASES.map((p, index) => ({
  key: p.key,
  label: p.label,
  sec: p.sec,
  index
}));

Page({
  data: {
    uiReady: false,
    phases: phasesForView,
    running: false,
    phaseIndex: 0,
    phaseKey: PHASES[0].key,
    phaseLabel: PHASES[0].label,
    phaseHint: PHASES[0].hint,
    remain: PHASES[0].sec,
    totalCycles: 0
  },

  _timer: null,

  onReady() {
    setTimeout(() => this.setData({ uiReady: true }), 32);
  },

  onUnload() {
    this.stop();
  },

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this.setData({ running: false });
  },

  toggle() {
    if (this.data.running) {
      this.stop();
      return;
    }
    this.setData({
      running: true,
      phaseIndex: 0,
      phaseKey: PHASES[0].key,
      phaseLabel: PHASES[0].label,
      phaseHint: PHASES[0].hint,
      remain: PHASES[0].sec
    });
    this._timer = setInterval(() => this.tick(), 1000);
  },

  tick() {
    let { phaseIndex, remain, totalCycles } = this.data;
    if (remain > 1) {
      this.setData({ remain: remain - 1 });
      return;
    }
    const nextIndex = (phaseIndex + 1) % PHASES.length;
    if (nextIndex === 0) totalCycles += 1;
    const p = PHASES[nextIndex];
    this.setData({
      phaseIndex: nextIndex,
      phaseKey: p.key,
      phaseLabel: p.label,
      phaseHint: p.hint,
      remain: p.sec,
      totalCycles
    });
  },

  reset() {
    this.stop();
    this.setData({
      phaseIndex: 0,
      phaseKey: PHASES[0].key,
      phaseLabel: PHASES[0].label,
      phaseHint: PHASES[0].hint,
      remain: PHASES[0].sec,
      totalCycles: 0
    });
  }
});
