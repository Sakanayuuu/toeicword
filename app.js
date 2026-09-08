/* global TOEIC_WORDS */

const MS_MINUTE = 60 * 1000;
const MS_HOUR = 60 * MS_MINUTE;
const MS_DAY = 24 * MS_HOUR;
const MAX_STAGE = 7;
const REVIEW_INTERVALS = [
  1 * MS_DAY,
  2 * MS_DAY,
  4 * MS_DAY,
  7 * MS_DAY,
  15 * MS_DAY,
  30 * MS_DAY,
  60 * MS_DAY
];

const STATE_KEY = "toeic-pwa-progress-v1";
const SETTINGS_KEY = "toeic-pwa-settings-v1";

let WORDS = [];
let states = {};
let settings = { freshPerSession: 10 };
let currentView = "home";
let currentScope = "mixed";
let libraryQuery = "";
let quiz = null;

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) settings = { ...settings, ...JSON.parse(raw) };
  } catch (error) {
    console.warn(error);
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function loadStates() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) states = JSON.parse(raw) || {};
  } catch (error) {
    console.warn(error);
    states = {};
  }
}

function saveStates() {
  localStorage.setItem(STATE_KEY, JSON.stringify(states));
}

function getState(term) {
  return states[term] || { stage: 0, nextDue: 0, correctCount: 0, wrongCount: 0 };
}

function commitState(term, state) {
  states[term] = state;
  saveStates();
}

function recordAnswer(term, correct) {
  const state = getState(term);
  if (correct) {
    state.correctCount += 1;
    if (state.stage < MAX_STAGE) state.stage += 1;
    if (state.stage >= MAX_STAGE) {
      state.nextDue = Date.now() + 180 * MS_DAY;
    } else {
      state.nextDue = Date.now() + REVIEW_INTERVALS[state.stage - 1];
    }
  } else {
    state.wrongCount += 1;
    state.stage = 1;
    state.nextDue = Date.now() + MS_DAY;
  }
  commitState(term, state);
}

function stageName(stage) {
  if (stage === 0) return "生词";
  if (stage === MAX_STAGE) return "已掌握";
  return "Lv." + stage;
}

function dueWords() {
  const now = Date.now();
  return WORDS.filter((word) => {
    const state = getState(word.term);
    return state.stage > 0 && state.nextDue <= now;
  });
}

function freshWords() {
  return WORDS.filter((word) => getState(word.term).stage === 0);
}

function learningWords() {
  return WORDS.filter((word) => {
    const stage = getState(word.term).stage;
    return stage > 0 && stage < MAX_STAGE;
  });
}

function masteredWords() {
  return WORDS.filter((word) => getState(word.term).stage >= MAX_STAGE);
}

function sessionWords() {
  const due = dueWords();
  const fresh = freshWords();
  if (currentScope === "due") return shuffle(due);
  if (currentScope === "fresh") return shuffle(fresh);
  const randomFresh = shuffle(fresh).slice(0, Math.max(1, settings.freshPerSession));
  return shuffle(due.concat(randomFresh));
}

function shuffle(source) {
  const result = [...source];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function ipaPanel(word) {
  return `
    <div class="ipa-panel">
      ${ipaRow("英式", word.ipaUK, "british", word.term)}
      ${ipaRow("美式", word.ipaUS, "american", word.term)}
    </div>`;
}

function ipaRow(label, ipa, accent, term) {
  return `
    <div class="ipa-row">
      <span class="accent">${esc(label)}</span>
      <span class="ipa">${esc(ipa)}</span>
      <button class="speaker" onclick="speak(${JSON.stringify(term)}, '${accent}')" title="${esc(label)}发音" aria-label="${esc(label)}发音">🔊</button>
    </div>`;
}

function speak(term, accent) {
  if (!("speechSynthesis" in window)) {
    alert("当前浏览器不支持语音朗读，建议用 Chrome/Edge 打开。");
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(term);
  utterance.lang = accent === "british" ? "en-GB" : "en-US";
  utterance.rate = 0.82;
  window.speechSynthesis.speak(utterance);
}

function boot() {
  const raw = TOEIC_WORDS || {};
  WORDS = Object.keys(raw)
    .map((term) => ({
      term,
      meaning: raw[term].meaning,
      ipaUK: raw[term].ipaUK,
      ipaUS: raw[term].ipaUS
    }))
    .sort((a, b) => a.term.localeCompare(b.term));
  loadSettings();
  loadStates();
  bindNav();
  render("home");
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

function bindNav() {
  document.querySelectorAll("[data-nav]").forEach((button) => {
    button.addEventListener("click", () => {
      render(button.dataset.nav);
    });
  });
}

function setNav(name) {
  currentView = name;
  document.querySelectorAll("[data-nav]").forEach((button) => {
    button.classList.toggle("active", button.dataset.nav === name);
  });
}

function render(name) {
  setNav(name);
  const app = document.getElementById("app");
  if (name === "home") app.innerHTML = renderHome();
  else if (name === "library") {
    app.innerHTML = renderLibrary();
    bindLibrarySearch();
  } else if (name === "curve") {
    app.innerHTML = renderCurve();
    requestAnimationFrame(drawMemoryCurve);
  }
  else if (name === "settings") {
    app.innerHTML = renderSettings();
    bindSettingsEvents();
  }
  if (name !== "home") currentScope = currentScope;
}

function renderHome() {
  const due = dueWords();
  const fresh = freshWords();
  const learning = learningWords();
  const mastered = masteredWords();
  const scopeButtons = [
    ["mixed", "到期 + 新词"],
    ["due", "只做到期"],
    ["fresh", "只学新词"]
  ]
    .map(
      ([value, label]) =>
        `<button class="${currentScope === value ? "active" : ""}" onclick="setScope('${value}')">${label}</button>`
    )
    .join("");

  return `
    <div class="stat-grid">
      <div class="stat-card"><div class="num" style="color:var(--red)">${due.length}</div><div class="label">今天待复习</div></div>
      <div class="stat-card"><div class="num" style="color:var(--accent)">${fresh.length}</div><div class="label">还没学过</div></div>
      <div class="stat-card"><div class="num" style="color:var(--orange)">${learning.length}</div><div class="label">复习中</div></div>
      <div class="stat-card"><div class="num" style="color:var(--green)">${mastered.length}</div><div class="label">已掌握</div></div>
    </div>

    <div class="section-title">本轮练习范围</div>
    <div class="segmented">${scopeButtons}</div>

    <div class="section-title">开始练习</div>
    <div class="mode-list">
      <button class="mode-card" onclick="startSession('enZh')">
        <span class="mode-icon" style="background:#2f6fed">⇄</span>
        <span><span class="mode-title">英 → 中 选择题</span><br><span class="mode-sub">看英文选中文，显示英/美音标与发音</span></span>
      </button>
      <button class="mode-card" onclick="startSession('zhEn')">
        <span class="mode-icon" style="background:#008a8a">⇆</span>
        <span><span class="mode-title">中 → 英 选择题</span><br><span class="mode-sub">看中文选英文</span></span>
      </button>
      <button class="mode-card" onclick="startSession('dictation')">
        <span class="mode-icon" style="background:#d9822b">✍️</span>
        <span><span class="mode-title">中 → 英 听写</span><br><span class="mode-sub">看中文写英文，iPad 可用 Apple Pencil 手写</span></span>
      </button>
    </div>

    <div class="section-title">复习计划</div>
    <div class="note">答对后按 1、2、4、7、15、30、60 天安排复习，不需要按分钟/小时卡点；答错回到第 1 级，隔天再次出现。</div>
  `;
}

function setScope(scope) {
  currentScope = scope;
  render("home");
}

function startSession(mode) {
  const words = sessionWords();
  if (words.length === 0) {
    document.getElementById("app").innerHTML = `
      <div class="empty">
        <div class="emoji">🗂️</div>
        <p>这个范围暂时没有单词。</p>
        <p style="font-size:13px">可以回首页换范围，或等复习到期。</p>
        <br><button class="btn" onclick="render('home')">返回首页</button>
      </div>`;
    return;
  }
  quiz = {
    mode,
    words,
    index: 0,
    correct: 0,
    wrong: 0,
    locked: false,
    selectedIndex: null,
    correctIndex: null,
    options: [],
    submitted: false,
    typed: ""
  };
  setNav("home");
  renderQuizQuestion();
}

function currentQuizWord() {
  return quiz.words[quiz.index];
}

function textForOption(word) {
  return quiz.mode === "enZh" ? word.meaning : word.term;
}

function buildOptions() {
  const word = currentQuizWord();
  const answer = textForOption(word);
  const pool = WORDS.filter((candidate) => {
    const candidateText = textForOption(candidate);
    return candidate.term !== word.term && candidateText !== answer;
  });
  const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, 3);
  const options = shuffled.map(textForOption);
  options.push(answer);
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  quiz.options = options;
  quiz.correctIndex = options.indexOf(answer);
  quiz.locked = false;
  quiz.selectedIndex = null;
}

function renderQuizQuestion() {
  if (quiz.index >= quiz.words.length) {
    renderSummary();
    return;
  }
  const word = currentQuizWord();
  if (!quiz.locked && quiz.selectedIndex === null) buildOptions();

  const isChoice = quiz.mode !== "dictation";
  const title =
    quiz.mode === "enZh" ? "英 → 中 选择" : quiz.mode === "zhEn" ? "中 → 英 选择" : "中 → 英 听写";
  let body = "";

  if (isChoice) {
    const promptWord =
      quiz.mode === "enZh"
        ? `<div class="word">${esc(word.term)}</div>${ipaPanel(word)}<div class="hint">选择正确的中文意思</div>`
        : `<div class="meaning">${esc(word.meaning)}</div><div class="hint">选择对应的英文单词</div>`;

    const options = quiz.options
      .map((text, index) => {
        let extra = "";
        if (quiz.locked) {
          if (index === quiz.correctIndex) extra = " correct";
          else if (index === quiz.selectedIndex) extra = " wrong";
        }
        return `<button class="option-btn${extra}" onclick="chooseOption(${index})" ${quiz.locked ? "disabled" : ""}>${esc(text)}</button>`;
      })
      .join("");

    const result =
      quiz.locked &&
      (quiz.selectedIndex === quiz.correctIndex
        ? `<div class="result ok">✓ 答对了</div>`
        : `<div class="result bad">✗ 答错了<div class="sub">正确答案：${esc(quiz.options[quiz.correctIndex])}</div></div>`);

    body = `
      <div class="prompt">${promptWord}</div>
      <div class="options">${options}</div>
      ${result || ""}
      ${quiz.locked ? `<div class="btn-row"><button class="btn" onclick="nextQuestion()">${quiz.index + 1 >= quiz.words.length ? "查看本轮结果" : "下一题"}</button></div>` : ""}`;
  } else {
    const note = /iPad|Macintosh/.test(navigator.userAgent)
      ? `<div class="note">✍️ 在 iPad 上可直接用 Apple Pencil 手写；Mac 上用键盘输入即可。</div>`
      : `<div class="note">输入对应的英文单词，大小写不影响判对。</div>`;
    const result =
      quiz.submitted &&
      (quiz.wasCorrect
        ? `<div class="result ok">✓ 写对了<div class="sub">${esc(word.term)}</div></div>`
        : `<div class="result bad">${quiz.gaveUp ? "显示答案" : "✗ 写错了"}<div class="sub">正确写法：${esc(word.term)}</div>${quiz.typed ? `<div class="sub">你写的是：${esc(quiz.typed)}</div>` : ""}</div>`);

    body = `
      <div class="prompt">
        <div class="meaning">${esc(word.meaning)}</div>
        <div class="hint">写出对应的英文单词</div>
      </div>
      ${quiz.submitted ? `<div class="text-input" style="background:#f0f3f1">${esc(quiz.typed)}</div>` : `<input id="dict-input" class="text-input" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="输入英文…" value="">`}
      <div style="margin-top:12px">${note}</div>
      ${result || ""}
      ${quiz.submitted
        ? `<div class="btn-row"><button class="btn" onclick="nextQuestion()">${quiz.index + 1 >= quiz.words.length ? "查看本轮结果" : "下一题"}</button></div>`
        : `<div class="btn-row">
            <button class="btn" onclick="checkDictation()">检查</button>
            <button class="btn ghost" onclick="giveUpDictation()">显示答案</button>
          </div>`}`;
  }

  document.getElementById("app").innerHTML = `
    <div class="card">
      <h2>${title}</h2>
      <div class="progress-text">第 ${quiz.index + 1} / ${quiz.words.length} 题　答对 ${quiz.correct} · 答错 ${quiz.wrong}</div>
      ${body}
    </div>
    <div class="btn-row" style="margin-top:6px">
      <button class="btn ghost" onclick="quitSession()">退出本轮</button>
    </div>`;

  const input = document.getElementById("dict-input");
  if (input) {
    input.focus();
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") checkDictation();
    });
  }
}

function chooseOption(index) {
  if (quiz.locked) return;
  quiz.locked = true;
  quiz.selectedIndex = index;
  const correct = index === quiz.correctIndex;
  if (correct) quiz.correct += 1;
  else quiz.wrong += 1;
  recordAnswer(currentQuizWord().term, correct);
  renderQuizQuestion();
}

function nextQuestion() {
  if (quiz.index + 1 < quiz.words.length) {
    quiz.index += 1;
    quiz.locked = false;
    quiz.selectedIndex = null;
    renderQuizQuestion();
  } else {
    quiz.index = quiz.words.length;
    renderQuizQuestion();
  }
}

function normalizeDictation(value) {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

function checkDictation() {
  if (quiz.submitted) return;
  const input = document.getElementById("dict-input");
  const typed = input ? input.value : "";
  const correct = typed.trim().length > 0 && normalizeDictation(typed) === normalizeDictation(currentQuizWord().term);
  quiz.submitted = true;
  quiz.typed = typed;
  quiz.wasCorrect = correct;
  quiz.gaveUp = false;
  if (correct) quiz.correct += 1;
  else quiz.wrong += 1;
  recordAnswer(currentQuizWord().term, correct);
  renderQuizQuestion();
}

function giveUpDictation() {
  if (quiz.submitted) return;
  quiz.submitted = true;
  quiz.typed = "";
  quiz.wasCorrect = false;
  quiz.gaveUp = true;
  quiz.wrong += 1;
  recordAnswer(currentQuizWord().term, false);
  renderQuizQuestion();
}

function quitSession() {
  quiz = null;
  render("home");
}

function renderSummary() {
  const total = quiz.correct + quiz.wrong;
  document.getElementById("app").innerHTML = `
    <div class="card">
      <h2>本轮完成</h2>
      <div class="summary-stats">
        ✓ 答对 ${quiz.correct} 题<br>
        ✗ 答错 ${quiz.wrong} 题<br>
        <span style="color:var(--muted);font-size:14px">正确率 ${total ? Math.round((quiz.correct / total) * 100) : 0}%</span>
      </div>
      <div class="note">答错的词已回到第 1 级，之后会按遗忘曲线再次出现。</div>
      <div class="btn-row"><button class="btn" onclick="quitSession()">返回首页</button></div>
    </div>`;
}

function renderLibrary() {
  const query = libraryQuery.trim().toLowerCase();
  let filtered = WORDS;
  if (query) {
    filtered = WORDS.filter(
      (word) =>
        word.term.toLowerCase().includes(query) ||
        word.meaning.toLowerCase().includes(query) ||
        word.ipaUK.includes(query) ||
        word.ipaUS.includes(query)
    );
  }
  const shown = filtered.slice(0, 80);
  const rows = shown
    .map((word) => {
      const state = getState(word.term);
      return `
        <div class="word-row">
          <div class="head">
            <span class="term">${esc(word.term)}</span>
            <span class="badge">${esc(stageName(state.stage))}</span>
          </div>
          <div class="zh">${esc(word.meaning)}</div>
          <div class="ipa-panel" style="margin:6px 0 0">
            ${ipaRow("英式", word.ipaUK, "british", word.term)}
            ${ipaRow("美式", word.ipaUS, "american", word.term)}
          </div>
        </div>`;
    })
    .join("");

  return `
    <div class="section-title">词库（共 ${WORDS.length} 个词条，可搜索英文、中文或音标）</div>
    <input id="library-search" class="text-input search" placeholder="搜索…" value="${esc(libraryQuery)}">
    <div style="margin-top:12px">${rows || '<div class="empty">没有匹配的词</div>'}</div>
    ${filtered.length > shown.length ? `<div class="note" style="margin-top:10px">匹配 ${filtered.length} 条，仅显示前 ${shown.length} 条；输入更精确的关键词继续筛选。</div>` : ""}
  `;
}

function renderCurve() {
  return `
    <div class="card">
      <h2>记忆曲线</h2>
      <p style="color:var(--muted);font-size:13px;line-height:1.6">
        下面是当前“按天复习计划”的示意图。绿色实线代表按计划复习后记忆保留率的变化，红色虚线代表学过之后完全不复习。图中圆点 ①②③… 是每次到期复习的时间。
      </p>
      <div class="legend">
        <span class="legend-item"><span class="legend-line" style="background:var(--green)"></span>按计划复习</span>
        <span class="legend-item"><span class="legend-line" style="background:var(--red)"></span>完全不复习</span>
        <span class="legend-item">● 复习时间点</span>
      </div>
      <canvas id="memory-curve" class="curve-canvas"></canvas>
      <div class="note" style="margin-top:12px">
        图里的百分比是示意模型，用来直观展示“间隔逐渐拉长、记忆越来越牢固”的原理；实际到没到期以首页的“今天待复习”为准。
      </div>
    </div>
  `;
}

function drawMemoryCurve() {
  const canvas = document.getElementById("memory-curve");
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(280, canvas.clientWidth || canvas.parentElement.clientWidth);
  const height = 300;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.height = height + "px";
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const pad = { left: 44, right: 16, top: 18, bottom: 42 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const scheduledDays = [];
  let total = 0;
  for (const interval of REVIEW_INTERVALS) {
    total += interval / MS_DAY;
    scheduledDays.push(total);
  }
  const xMax = Math.ceil(scheduledDays[scheduledDays.length - 1] + 10);
  const yMax = 100;

  const x = (day) => pad.left + (day / xMax) * plotW;
  const y = (percent) => pad.top + plotH - (percent / yMax) * plotH;

  ctx.clearRect(0, 0, width, height);
  ctx.font = "12px -apple-system, PingFang SC, sans-serif";
  ctx.strokeStyle = "#dce4df";
  ctx.fillStyle = "#8a948f";
  ctx.lineWidth = 1;

  const yTicks = [0, 20, 40, 60, 80, 100];
  yTicks.forEach((tick) => {
    const yy = y(tick);
    ctx.beginPath();
    ctx.moveTo(pad.left, yy);
    ctx.lineTo(width - pad.right, yy);
    ctx.stroke();
    ctx.fillText(tick + "%", 6, yy + 4);
  });

  const xTicks = [];
  const xTickStep = xMax <= 40 ? 5 : xMax <= 80 ? 10 : 20;
  for (let day = 0; day <= xMax; day += xTickStep) xTicks.push(day);
  xTicks.forEach((tick) => {
    const xx = x(tick);
    ctx.beginPath();
    ctx.moveTo(xx, pad.top);
    ctx.lineTo(xx, height - pad.bottom);
    ctx.stroke();
    ctx.fillText(tick + "天", xx - 10, height - pad.bottom + 18);
  });

  const boostFactor = -Math.log(0.8);

  // Natural forgetting curve: no reviews.
  const naturalTau = REVIEW_INTERVALS[0] / MS_DAY / boostFactor;
  ctx.setLineDash([5, 5]);
  ctx.strokeStyle = "#e05454";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let day = 0; day <= xMax; day += 0.25) {
    const retention = Math.exp(-day / naturalTau) * 100;
    const xx = x(day);
    const yy = y(retention);
    if (day === 0) ctx.moveTo(xx, yy);
    else ctx.lineTo(xx, yy);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Scheduled review curve.
  ctx.strokeStyle = "#1c9d63";
  ctx.lineWidth = 2.5;
  let previousDay = 0;
  scheduledDays.forEach((dueDay, phaseIndex) => {
    const phaseTau = (dueDay - previousDay) / boostFactor;
    ctx.beginPath();
    for (let t = previousDay; t <= dueDay; t += 0.25) {
      const retention = Math.exp(-(t - previousDay) / phaseTau) * 100;
      const xx = x(Math.min(t, dueDay));
      const yy = y(retention);
      if (t === previousDay) ctx.moveTo(xx, yy);
      else ctx.lineTo(xx, yy);
    }
    ctx.stroke();

    // Small vertical boost line at the review point.
    ctx.strokeStyle = "rgba(28,157,99,0.35)";
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x(dueDay), y(80));
    ctx.lineTo(x(dueDay), y(100));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "#1c9d63";

    // Marker and phase number at the review point.
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#1c9d63";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x(dueDay), y(100), 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#1c9d63";
    ctx.font = "10px -apple-system, PingFang SC, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(String(phaseIndex + 1), x(dueDay), y(100) - 10);
    ctx.textAlign = "start";
    ctx.font = "12px -apple-system, PingFang SC, sans-serif";
    ctx.lineWidth = 2.5;

    previousDay = dueDay;
  });

  ctx.fillStyle = "#5a665f";
  ctx.font = "12px -apple-system, PingFang SC, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("学习后天数", width / 2, height - 3);
  ctx.textAlign = "start";
  ctx.save();
  ctx.translate(14, pad.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("记忆保留率", 0, 0);
  ctx.restore();
}

function renderSettings() {
  return `
    <div class="card">
      <h2>学习量</h2>
      <div class="field-row">
        <label for="fresh-count">「到期 + 新词」时，每轮最多加入的新词数</label>
        <select id="fresh-count" class="text-input" onchange="setFreshCount(this.value)">
          ${[5, 10, 15, 20, 25, 30].map((n) => `<option value="${n}" ${settings.freshPerSession === n ? "selected" : ""}>${n} 个</option>`).join("")}
        </select>
      </div>
    </div>

    <div class="card">
      <h2>进度备份（手动导入 / 导出）</h2>
      <p style="color:var(--muted);font-size:13px;line-height:1.6">
        学习进度保存在本机浏览器里。想换设备或电脑时，先在这里导出文件，再把文件导入另一台设备即可。
      </p>
      <div class="btn-row">
        <button class="btn" onclick="exportProgress()">导出进度</button>
        <label class="btn ghost" style="text-align:center;display:inline-block;cursor:pointer">
          导入进度
          <input id="import-file" type="file" accept=".json,application/json" style="display:none">
        </label>
      </div>
    </div>

    <div class="card">
      <h2>音标与发音</h2>
      <div class="note">每个词条都内置英式 / 美式 IPA。朗读使用浏览器系统的 en-GB / en-US 语音，离线数据已缓存；Mac 上推荐用 Chrome 或 Edge，以获得最好的语音支持。</div>
    </div>

    <div class="card">
      <h2>Apple Pencil</h2>
      <div class="note">iPad 上开启「设置 → Apple Pencil → 随手写」后，听写页点输入框直接用 Apple Pencil 书写即可。</div>
    </div>

    <div class="card">
      <h2>危险操作</h2>
      <button class="btn danger" onclick="clearProgress()">清空全部学习进度</button>
    </div>
  `;
}

function bindSettingsEvents() {
  const importInput = document.getElementById("import-file");
  if (importInput) {
    importInput.addEventListener("change", importProgress);
  }
}

function setFreshCount(value) {
  settings.freshPerSession = Number(value);
  saveSettings();
}

async function exportProgress() {
  const payload = {
    app: "toeic-words-pwa",
    version: 1,
    exportedAt: new Date().toISOString(),
    settings,
    states
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const file = new File([blob], `toeic-progress-${new Date().toISOString().slice(0, 10)}.json`, {
    type: "application/json"
  });

  // iPhone/iPad: opens the system share sheet so the file can be saved to 文件 / AirDrop.
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "托业错词本进度备份" });
      return;
    } catch (error) {
      if (error && error.name === "AbortError") return;
    }
  }

  // Mac/desktop fallback: downloads the JSON directly.
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function importProgress(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const source = payload.states || payload;
    if (!source || typeof source !== "object") throw new Error("bad file");
    const next = {};
    let count = 0;
    for (const [term, raw] of Object.entries(source)) {
      if (!TOEIC_WORDS[term] || !raw || typeof raw !== "object") continue;
      const stage = Number.isFinite(raw.stage) ? Math.max(0, Math.min(MAX_STAGE, raw.stage)) : 0;
      next[term] = {
        stage,
        nextDue: Number.isFinite(raw.nextDue) ? raw.nextDue : 0,
        correctCount: Number.isFinite(raw.correctCount) ? raw.correctCount : 0,
        wrongCount: Number.isFinite(raw.wrongCount) ? raw.wrongCount : 0
      };
      count += 1;
    }
    states = next;
    saveStates();
    if (payload.settings && payload.settings.freshPerSession) {
      settings.freshPerSession = payload.settings.freshPerSession;
      saveSettings();
    }
    alert(`导入成功，共 ${count} 个词的进度。`);
  } catch (error) {
    alert("导入失败：文件格式不正确。");
  }
  render("settings");
}

function clearProgress() {
  if (!confirm("确定清空全部学习进度？此操作会删除本机的全部进度。")) return;
  states = {};
  saveStates();
  render("settings");
  alert("已清空。");
}

function bindLibrarySearch() {
  const search = document.getElementById("library-search");
  if (search) {
    search.addEventListener("input", (event) => {
      libraryQuery = event.target.value;
      render("library");
      const next = document.getElementById("library-search");
      if (next) {
        next.focus();
        next.setSelectionRange(next.value.length, next.value.length);
      }
    });
  }
}

window.addEventListener("load", boot);
