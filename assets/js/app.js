import { siteData } from './data.js';
import { createGuideService } from './guide-service.js';

const { meta, guide, modes, stations, services, faqs, ratings, config } = siteData;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const pad2 = (number) => String(number).padStart(2, '0');
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const icon = (name, className = 'icon') => `<svg class="${className}" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;

const dom = {
  body: document.body,
  intro: $('#intro'),
  introModes: $('#introModes'),
  igniteButton: $('#igniteButton'),
  skipIntro: $('#skipIntro'),
  introSound: $('#introSound'),
  appShell: $('#appShell'),
  siteFooter: $('.site-footer'),
  topbar: $('.topbar'),
  modeSwitch: $('.mode-switch'),
  soundToggle: $('#soundToggle'),
  askGuideButton: $('#askGuideButton'),
  serviceButton: $('#serviceButton'),
  progressButton: $('#progressButton'),
  topProgress: $('#topProgress'),
  mapFrame: $('#mapFrame'),
  mapSurface: $('#mapSurface'),
  stationNodes: $('#stationNodes'),
  guide: $('#guide'),
  mapStationIndex: $('#mapStationIndex'),
  mapStationName: $('#mapStationName'),
  mapHint: $('#mapHint'),
  stationPanel: $('#stationPanel'),
  stationArticle: $('#stationArticle'),
  progressTrack: $('#progressTrack'),
  progressText: $('#progressText'),
  lightScore: $('#lightScore'),
  serviceList: $('#serviceList'),
  serviceDrawer: $('#serviceDrawer'),
  guideDrawer: $('#guideDrawer'),
  guideChat: $('#guideChat'),
  guideSuggestions: $('#guideSuggestions'),
  guideForm: $('#guideForm'),
  guideInput: $('#guideInput'),
  backdrop: $('#overlayBackdrop'),
  completionModal: $('#completionModal'),
  completionContent: $('#completionContent'),
  lightbox: $('#lightbox'),
  lightboxImage: $('#lightboxImage'),
  lightboxCaption: $('#lightboxCaption'),
  lightboxPrev: $('#lightboxPrev'),
  lightboxNext: $('#lightboxNext'),
  aboutModal: $('#aboutModal'),
  aboutButton: $('#aboutButton'),
  drawerAboutButton: $('#drawerAboutButton'),
  footerAskButton: $('#footerAskButton'),
  toast: $('#toast'),
  liveRegion: $('#liveRegion')
};

const defaultState = {
  version: config.version,
  mode: 'study',
  currentStation: stations[0].id,
  visited: [],
  answers: {},
  nickname: '',
  sound: false
};

let state = loadState();
let currentStation = getStation(state.currentStation) || stations[0];
let introComplete = false;
let typingToken = 0;
let renderToken = 0;
let toastTimer = null;
let lightReturnTimer = null;
let lastFocusedElement = null;
let speechActive = false;
let chatPending = false;
let chatSeeded = false;
let guideMessages = [];
let activeLightbox = { stationId: null, index: 0 };
let quizInteraction = { stationId: null, allowRetry: false };
let audio;

const guideService = createGuideService({ faqs, llmAdapter: null });
window.GoubaGuide = {
  ask: (question) => guideService.ask({ question, stationId: currentStation.id, mode: state.mode }),
  setAdapter: (adapter) => guideService.setAdapter(adapter),
  data: siteData
};

function loadState() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(config.storageKey));
    if (!saved || saved.version !== config.version) return { ...defaultState };
    return {
      ...defaultState,
      ...saved,
      visited: Array.isArray(saved.visited) ? saved.visited.filter((id) => getStation(id)) : [],
      answers: saved.answers && typeof saved.answers === 'object' ? saved.answers : {},
      mode: saved.mode === 'family' ? 'family' : 'study',
      sound: Boolean(saved.sound)
    };
  } catch (error) {
    return { ...defaultState };
  }
}

function persistState() {
  try {
    window.localStorage.setItem(config.storageKey, JSON.stringify(state));
  } catch (error) {
    /* Private mode or storage exhaustion: keep the in-memory state. */
  }
}

function getStation(id) {
  return stations.find((station) => station.id === id);
}

function getStationIndex(id) {
  return stations.findIndex((station) => station.id === id);
}

function getProgress() {
  const visitedCount = stations.filter((station) => state.visited.includes(station.id)).length;
  const correctFirstCount = stations.filter((station) => state.answers[station.id]?.firstChoice === station.quiz.answer).length;
  const score = visitedCount + correctFirstCount;
  const rating = ratings.find((item) => score >= item.min) || ratings[ratings.length - 1];
  return { visitedCount, correctFirstCount, score, rating };
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDate(date = new Date()) {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
}

function showToast(message, duration = 2600) {
  window.clearTimeout(toastTimer);
  dom.toast.textContent = message;
  dom.toast.classList.add('is-visible');
  toastTimer = window.setTimeout(() => dom.toast.classList.remove('is-visible'), duration);
}

function announce(message) {
  dom.liveRegion.textContent = '';
  window.setTimeout(() => { dom.liveRegion.textContent = message; }, 30);
}

class AudioEngine {
  constructor() {
    this.context = null;
  }

  ensure() {
    if (!state.sound) return null;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!this.context) this.context = new AudioContextClass();
    if (this.context.state === 'suspended') this.context.resume().catch(() => {});
    return this.context;
  }

  tone(frequency, start, duration, volume = 0.035, type = 'sine') {
    const context = this.ensure();
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, context.currentTime + start);
    gain.gain.setValueAtTime(0.0001, context.currentTime + start);
    gain.gain.exponentialRampToValueAtTime(volume, context.currentTime + start + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + start + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(context.currentTime + start);
    oscillator.stop(context.currentTime + start + duration + 0.02);
  }

  play(name) {
    if (!state.sound) return;
    if (name === 'ignite') {
      [196, 293.66, 392, 523.25].forEach((frequency, index) => this.tone(frequency, index * 0.09, 0.8, 0.027, 'sine'));
    } else if (name === 'badge') {
      this.tone(523.25, 0, 0.32, 0.032, 'triangle');
      this.tone(783.99, 0.09, 0.46, 0.025, 'sine');
    } else if (name === 'correct') {
      this.tone(440, 0, 0.28, 0.03, 'sine');
      this.tone(659.25, 0.08, 0.42, 0.025, 'sine');
    } else if (name === 'wrong') {
      this.tone(196, 0, 0.3, 0.025, 'triangle');
      this.tone(164.81, 0.11, 0.34, 0.022, 'triangle');
    } else if (name === 'lamp') {
      this.tone(330, 0, 0.22, 0.02, 'sine');
      this.tone(495, 0.05, 0.36, 0.015, 'sine');
    } else {
      this.tone(480, 0, 0.09, 0.016, 'sine');
    }
  }
}

audio = new AudioEngine();

function setMode(mode, { render = true, notify = false } = {}) {
  if (!modes[mode] || state.mode === mode && render === false) return;
  const changed = state.mode !== mode;
  state.mode = mode;
  persistState();
  updateModeUI();
  if (!introComplete) {
    if (changed) renderStation({ fromUser: false });
    return;
  }
  if (changed && render) {
    stopSpeech();
    renderStation({ fromUser: false });
    startGreeting();
    if (notify) showToast(`已切换为${modes[mode].label}`);
  }
}

function updateModeUI() {
  dom.modeSwitch.dataset.mode = state.mode;
  $$('[data-mode]', dom.modeSwitch).forEach((button) => {
    const active = button.dataset.mode === state.mode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  $$('[data-intro-mode]', dom.introModes).forEach((button) => {
    const active = button.dataset.introMode === state.mode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function toggleSound(force) {
  state.sound = typeof force === 'boolean' ? force : !state.sound;
  persistState();
  updateSoundUI();
  if (state.sound) audio.play('toggle');
  announce(state.sound ? '声音已开启' : '声音已关闭');
}

function updateSoundUI() {
  [dom.soundToggle, dom.introSound].forEach((button) => {
    button.setAttribute('aria-pressed', String(state.sound));
    button.setAttribute('aria-label', state.sound ? '关闭声音' : '开启声音');
  });
  dom.soundToggle.classList.toggle('is-on', state.sound);
  $('use', dom.introSound).setAttribute('href', state.sound ? '#icon-sound' : '#icon-muted');
  $('span', dom.introSound).textContent = state.sound ? '声音开启' : '声音关闭';
}
function igniteIntro({ instant = false } = {}) {
  if (dom.intro.classList.contains('is-lit')) return;
  dom.intro.classList.add('is-lit');
  if (state.sound) audio.play('ignite');
  dom.body.classList.add('tour-ready');
  window.setTimeout(() => {
    dom.intro.classList.add('is-closing');
    dom.body.classList.remove('is-intro-open');
    if (!prefersReducedMotion && !instant) {
      window.setTimeout(finishIntro, 850);
    } else {
      finishIntro();
    }
  }, instant || prefersReducedMotion ? 0 : 820);
}

function finishIntro() {
  if (introComplete) return;
  introComplete = true;
  dom.intro.hidden = true;
  dom.appShell.inert = false;
  dom.siteFooter.inert = false;
  dom.appShell.removeAttribute('aria-hidden');
  const added = markVisited(currentStation, { notify: false });
  updateMapAndProgress();
  if (added) showToast(`已点亮第${currentStation.numeral}站马灯`, 2200);
  syncCompletionTeaser();
  startGreeting();
  const title = $('#stationTitle');
  if (title) title.focus({ preventScroll: true });
}

function buildMapNodes() {
  dom.stationNodes.innerHTML = stations.map((station) => `
    <button class="station-node${station.map.x > 70 ? ' label-left' : ''}" type="button"
      data-station="${station.id}" style="--x:${station.map.x}%;--y:${station.map.y}%"
      aria-label="${station.order}. ${station.title}：${station.summary}">
      <span class="node-pin"><span class="node-numeral">${station.numeral}</span></span>
      <span class="node-label"><small>第${station.numeral}站</small><strong>${station.navTitle}</strong></span>
    </button>
  `).join('');

  dom.progressTrack.innerHTML = stations.map((station, index) => `
    <span class="progress-segment" data-progress-index="${index}" title="第${station.numeral}站 ${station.navTitle}"></span>
  `).join('');
}

function updateMapAndProgress() {
  const index = getStationIndex(currentStation.id);
  dom.stationNodes.querySelectorAll('[data-station]').forEach((node) => {
    const isCurrent = node.dataset.station === currentStation.id;
    const isVisited = state.visited.includes(node.dataset.station);
    node.classList.toggle('is-current', isCurrent);
    node.classList.toggle('is-visited', isVisited);
    if (isCurrent) node.setAttribute('aria-current', 'step');
    else node.removeAttribute('aria-current');
  });

  dom.mapStationIndex.textContent = pad2(index + 1);
  dom.mapStationName.textContent = currentStation.navTitle;
  dom.guide.style.left = `${currentStation.map.x}%`;
  dom.guide.style.top = `${currentStation.map.y}%`;
  setLightAt(currentStation.map.x, currentStation.map.y);

  const progress = getProgress();
  dom.topProgress.textContent = `${progress.visitedCount}/5`;
  dom.lightScore.textContent = String(progress.score);
  dom.progressText.textContent = `第 ${index + 1} 站 · 共 5 站`;
  dom.progressTrack.querySelectorAll('[data-progress-index]').forEach((segment, segmentIndex) => {
    segment.classList.toggle('is-visited', state.visited.includes(stations[segmentIndex].id));
    segment.classList.toggle('is-current', segmentIndex === index);
  });
  updateCompletionPreviewIfOpen();
}

function setLightAt(x, y) {
  dom.mapFrame.style.setProperty('--lx', `${x}%`);
  dom.mapFrame.style.setProperty('--ly', `${y}%`);
}

function restoreLightToStation() {
  setLightAt(currentStation.map.x, currentStation.map.y);
}

function returnLightSoon() {
  window.clearTimeout(lightReturnTimer);
  lightReturnTimer = window.setTimeout(() => {
    if (!dom.mapSurface.classList.contains('is-exploring')) restoreLightToStation();
  }, 1500);
}

function markVisited(station, { notify = true } = {}) {
  if (state.visited.includes(station.id)) return false;
  state.visited.push(station.id);
  persistState();
  updateMapAndProgress();
  audio.play('badge');
  if (notify && introComplete) {
    showToast(`第${station.numeral}站 · 灯已点亮`);
    announce(`已到达第${station.numeral}站${station.title}`);
  }
  return true;
}

function navigateToStation(stationId, { fromUser = false, focus = false } = {}) {
  const target = getStation(stationId);
  if (!target) return;
  if (target.id === currentStation.id) {
    if (fromUser && window.innerWidth <= 980) scrollToStory();
    return;
  }
  stopSpeech();
  currentStation = target;
  state.currentStation = target.id;
  persistState();
  renderStation({ fromUser, focus });
  if (introComplete) startGreeting();
  if (fromUser && window.innerWidth <= 980) scrollToStory();
}

function scrollToStory() {
  window.setTimeout(() => {
    dom.stationPanel.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
  }, 90);
}

function renderStation({ fromUser = false, focus = false } = {}) {
  const token = ++renderToken;
  const station = currentStation;
  const markup = stationMarkup(station);
  const swap = () => {
    if (token !== renderToken) return;
    dom.stationArticle.classList.remove('is-leaving');
    dom.stationArticle.innerHTML = markup;
    dom.stationArticle.scrollTop = 0;
    if (window.innerWidth > 980) dom.stationPanel.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
    updateMapAndProgress();
    if (introComplete) markVisited(station, { notify: true });
    syncCompletionTeaser();
    if (focus) {
      window.setTimeout(() => $('#stationTitle')?.focus({ preventScroll: true }), 30);
    }
    announce(`第${station.numeral}站，${station.title}`);
  };

  if (introComplete && !prefersReducedMotion && dom.stationArticle.children.length) {
    dom.stationArticle.classList.add('is-leaving');
    window.setTimeout(swap, 180);
  } else {
    swap();
  }

  document.title = `${station.title}｜${meta.title}`;
  try {
    const url = new URL(window.location.href);
    url.hash = station.id;
    window.history.replaceState(null, '', url);
  } catch (error) {
    window.location.hash = station.id;
  }
  if (fromUser && window.innerWidth <= 980) scrollToStory();
}

function syncCompletionTeaser() {
  const teaser = $('.completion-teaser', dom.stationArticle);
  if (!teaser) return;
  const progress = getProgress();
  const title = $('h2', teaser);
  const description = $('p', teaser);
  if (progress.visitedCount >= stations.length) {
    if (title) title.textContent = '五盏灯，已经为你点亮';
    if (description) description.textContent = `当前获得 ${progress.score} / 10 真理之光，领取你的导览纪念卡。`;
  } else {
    if (title) title.textContent = '还差一点，就集齐五站';
    if (description) description.textContent = `已走完 ${progress.visitedCount} / 5 站，继续沿游线前行。`;
  }
}
function stationMarkup(station) {
  const paragraphs = station.narration[state.mode].map((paragraph) => `<p>${paragraph}</p>`).join('');
  const facts = station.facts.map((fact) => `
    <div class="history-fact"><dt>${fact.label}</dt><dd>${fact.value}</dd></div>
  `).join('');
  const gallery = station.images.map((image, index) => {
    const remaining = station.images.length - 1;
    const wide = index > 0 && index === station.images.length - 1 && remaining % 2 === 1;
    return `
      <button class="gallery-item${wide ? ' is-wide' : ''}" type="button" data-lightbox-index="${index}" aria-label="查看图片：${image.caption}">
        <img src="${image.src}-640.webp"
          srcset="${image.src}-640.webp 640w, ${image.src}-1280.webp 1280w"
          sizes="(max-width: 760px) calc(100vw - 34px), 340px"
          width="${image.width}" height="${image.height}" alt="${image.alt}"
          loading="${index === 0 ? 'eager' : 'lazy'}" decoding="async">
        <span class="gallery-zoom" aria-hidden="true">＋</span>
        <span class="gallery-caption">${image.caption}</span>
      </button>
    `;
  }).join('');

  const quiz = quizMarkup(station);
  const index = getStationIndex(station.id);
  const previous = stations[index - 1];
  const next = stations[index + 1];
  const progress = getProgress();
  const isLast = index === stations.length - 1;

  return `
    <header class="station-head">
      <div class="station-kicker"><span class="station-number">${pad2(station.order)}</span><span>第${station.numeral}站 · ${station.kicker}</span></div>
      <h1 class="station-title" id="stationTitle" tabindex="-1">${station.title}</h1>
      <p class="station-summary">${station.summary}</p>
      <div class="station-meta">
        <span>${icon('book')}${station.realPlace}</span>
        <span>${icon('lantern')}${modes[state.mode].label}</span>
      </div>
      <div class="station-actions">
        <button class="pill-button" type="button" data-action="listen" aria-pressed="false">
          ${icon('listen')}<span>听讲解</span>
        </button>
        <button class="pill-button" type="button" data-action="share">
          ${icon('share')}<span>分享本站</span>
        </button>
        <button class="pill-button" type="button" data-action="ask">
          ${icon('chat')}<span>问灯灯</span>
        </button>
      </div>
    </header>

    <div class="guide-dialogue">
      <div class="guide-avatar" aria-hidden="true">${icon('lantern')}</div>
      <div class="guide-bubble">
        <span class="guide-name">灯灯 · ${modes[state.mode].shortLabel}</span>
        <p id="greetingText">${station.greeting[state.mode]}</p>
      </div>
    </div>

    <div class="story-copy">${paragraphs}</div>

    <section class="history-panel" aria-labelledby="historyTitle">
      <div class="history-head">
        <h2 id="historyTitle">${icon('book')}史实档案</h2>
        <span>${meta.materialLabel}</span>
      </div>
      <dl class="history-facts">${facts}</dl>
    </section>

    <aside class="thought-card">
      <span>灯灯提问</span>
      <p>${station.think[state.mode]}</p>
    </aside>

    <section class="image-section" aria-labelledby="imageHeading">
      <div class="section-heading">
        <div><h2 id="imageHeading">现场影像</h2><p>点击图片可放大查看</p></div>
        <span>${station.images.length} 张 · 馆方材料</span>
      </div>
      <div class="gallery-grid">${gallery}</div>
    </section>

    ${quiz}

    <div class="station-footer">
      ${isLast ? `
        <div class="completion-teaser">
          <div>
            <h2>${progress.visitedCount >= 5 ? '五盏灯，已经为你点亮' : '还差一点，就集齐五站'}</h2>
            <p>${progress.visitedCount >= 5 ? `当前获得 ${progress.score} / 10 真理之光，领取你的导览纪念卡。` : `已走完 ${progress.visitedCount} / 5 站，继续沿游线前行。`}</p>
          </div>
          <button class="primary-button" type="button" data-action="completion">
            ${icon('spark')}<span>查看导览纪念</span>
          </button>
        </div>
      ` : `
        <div class="station-quote">
          <p>${station.think[state.mode]}</p>
          <span>— 边走边想，让历史与今天相遇</span>
        </div>
      `}
      <nav class="station-nav" aria-label="站点切换">
        <button class="station-nav-button" type="button" data-go-station="${previous ? previous.id : ''}" ${previous ? '' : 'disabled'}>
          ${icon('arrow-left')}<span><small>上一站</small><strong>${previous ? previous.navTitle : ''}</strong></span>
        </button>
        <button class="station-nav-button next" type="button" data-go-station="${next ? next.id : ''}" ${next ? '' : 'disabled'}>
          <span><small>下一站</small><strong>${next ? next.navTitle : ''}</strong></span>${icon('arrow-right')}
        </button>
      </nav>
    </div>

    <footer class="article-footer">
      <p>历史内容依据馆方提供材料整理；互动问答用于教学设问。景区地图为手绘示意图，不作为导航依据。</p>
      <button class="text-button" type="button" data-action="about">导览说明</button>
    </footer>
  `;
}

function quizMarkup(station) {
  const record = state.answers[station.id];
  const solved = Boolean(record?.solved);
  const firstCorrect = record?.firstChoice === station.quiz.answer;
  const stateLabel = solved
    ? (firstCorrect ? '首次作答正确 · 已获得真理之光' : '已完成 · 首答未计分')
    : (record ? '可继续尝试 · 首答得分已记录' : '选择一项作答');

  const options = station.quiz.options.map((option, index) => {
    let classes = '';
    if (solved && index === station.quiz.answer) classes = ' is-correct';
    return `
      <button class="quiz-option${classes}" type="button" data-quiz-index="${index}" ${solved ? 'disabled' : ''}>
        <span class="quiz-letter">${String.fromCharCode(65 + index)}</span>
        <span>${option}</span>
      </button>
    `;
  }).join('');

  const feedback = solved ? `
    <div class="quiz-feedback" role="status">
      <strong class="${firstCorrect ? 'quiz-complete' : ''}">${firstCorrect ? '答对了，真理之光 +1' : '已完成本题'}</strong>
      ${station.quiz.explanation}
    </div>
  ` : record ? `
    <div class="quiz-feedback">
      <strong>首次作答已记录</strong>
      可以继续尝试正确答案，但本站首答得分不再增加。
    </div>
  ` : '';

  return `
    <section class="quiz-section" aria-labelledby="quizHeading">
      <div class="quiz-card">
        <div class="quiz-top"><span class="quiz-label">${icon('spark')}互动问答</span><span class="quiz-state">${stateLabel}</span></div>
        <h2 id="quizHeading">${station.quiz.question}</h2>
        <div class="quiz-options" role="group" aria-label="选择题选项">${options}</div>
        <div id="quizFeedback">${feedback}</div>
      </div>
    </section>
  `;
}

function startGreeting() {
  const token = ++typingToken;
  const element = $('#greetingText');
  if (!element) return;
  const fullText = currentStation.greeting[state.mode];
  if (prefersReducedMotion) {
    element.textContent = fullText;
    return;
  }
  element.textContent = '';
  const text = document.createElement('span');
  const cursor = document.createElement('span');
  cursor.className = 'type-cursor';
  cursor.setAttribute('aria-hidden', 'true');
  element.append(text, cursor);
  let index = 0;
  const step = () => {
    if (token !== typingToken || !element.isConnected) return;
    index += 1;
    text.textContent = fullText.slice(0, index);
    if (index < fullText.length) window.setTimeout(step, 28);
    else cursor.remove();
  };
  window.setTimeout(step, 120);
}
function stopSpeech() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  speechActive = false;
  updateListenButtons();
}

function updateListenButtons() {
  $$('[data-action="listen"]', dom.stationArticle).forEach((button) => {
    button.classList.toggle('is-active', speechActive);
    button.setAttribute('aria-pressed', String(speechActive));
    const label = $('span', button);
    if (label) label.textContent = speechActive ? '停止朗读' : '听讲解';
    const use = $('use', button);
    if (use) use.setAttribute('href', speechActive ? '#icon-stop' : '#icon-listen');
  });
}

function toggleSpeech() {
  if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
    showToast('当前浏览器不支持语音朗读，请使用文字导览。');
    return;
  }
  if (speechActive) {
    stopSpeech();
    announce('已停止朗读');
    return;
  }

  stopSpeech();
  const utterance = new SpeechSynthesisUtterance([
    currentStation.title,
    ...currentStation.narration[state.mode]
  ].join('。'));
  utterance.lang = 'zh-CN';
  utterance.rate = 0.9;
  utterance.pitch = 0.96;
  const voices = window.speechSynthesis.getVoices();
  const chineseVoice = voices.find((voice) => /^zh(-|_)?CN/i.test(voice.lang)) || voices.find((voice) => /^zh/i.test(voice.lang));
  if (chineseVoice) utterance.voice = chineseVoice;
  utterance.onend = () => {
    speechActive = false;
    updateListenButtons();
  };
  utterance.onerror = () => {
    speechActive = false;
    updateListenButtons();
  };
  speechActive = true;
  updateListenButtons();
  window.speechSynthesis.cancel();
  window.setTimeout(() => window.speechSynthesis.speak(utterance), 90);
  announce(`正在朗读第${currentStation.numeral}站讲解`);
}

function answerQuiz(index, button) {
  const station = currentStation;
  const record = state.answers[station.id];
  const firstAttempt = !record;
  if (!record) {
    state.answers[station.id] = { firstChoice: index, attempts: 1, solved: false };
  } else {
    state.answers[station.id].attempts = (record.attempts || 1) + 1;
  }
  const currentRecord = state.answers[station.id];
  const correct = index === station.quiz.answer;
  if (correct) currentRecord.solved = true;
  persistState();
  updateQuizAfterAnswer(station, index, correct, firstAttempt);
  updateMapAndProgress();
  syncCompletionTeaser();
  if (correct) {
    audio.play('correct');
    if (firstAttempt) {
      showToast('答对了 · 真理之光 +1');
      announce('回答正确，获得一枚真理之光');
    } else {
      announce('回答正确。首次作答未计分');
    }
  } else {
    audio.play('wrong');
    announce('这次没有答对，可以查看解析后重试');
  }
}

function updateQuizAfterAnswer(station, selectedIndex, correct, firstAttempt) {
  const card = $('.quiz-card', dom.stationArticle);
  if (!card) return;
  const options = $$('.quiz-option', card);
  options.forEach((option, index) => {
    option.disabled = true;
    option.classList.remove('is-correct', 'is-wrong');
    if (index === station.quiz.answer && correct) option.classList.add('is-correct');
    if (index === selectedIndex && !correct) option.classList.add('is-wrong');
  });
  const stateLabel = $('.quiz-state', card);
  if (stateLabel) stateLabel.textContent = correct ? '已完成 · 本题结束' : '首答得分已记录';
  const feedback = $('#quizFeedback', card);
  if (!feedback) return;

  if (correct) {
    feedback.innerHTML = `
      <div class="quiz-feedback" role="status">
        <strong class="quiz-complete">${firstAttempt ? '答对了，真理之光 +1' : '答对了，首答未计分'}</strong>
        ${station.quiz.explanation}
      </div>
    `;
  } else {
    feedback.innerHTML = `
      <div class="quiz-feedback" role="status">
        <strong>这次没有答对</strong>
        ${station.quiz.explanation}
        <button class="quiz-retry" type="button" data-action="quiz-retry">再试一次</button>
      </div>
    `;
  }
}

function allowQuizRetry() {
  const card = $('.quiz-card', dom.stationArticle);
  if (!card) return;
  $$('.quiz-option', card).forEach((option) => {
    option.disabled = false;
    option.classList.remove('is-correct', 'is-wrong');
  });
  const feedback = $('#quizFeedback', card);
  if (feedback) {
    feedback.innerHTML = `
      <div class="quiz-feedback">
        <strong>再试一次</strong>
        可以继续作答，首次作答的得分结果不会改变。
      </div>
    `;
  }
  const stateLabel = $('.quiz-state', card);
  if (stateLabel) stateLabel.textContent = '重试中 · 首答得分已记录';
  $('.quiz-option', card)?.focus();
}

async function shareCurrentStation() {
  const url = new URL(window.location.href);
  url.hash = currentStation.id;
  const shareData = {
    title: `${currentStation.title}｜${meta.title}`,
    text: `${currentStation.summary}。${modes[state.mode].label} · 苟坝会议数字导览`,
    url: url.href
  };
  try {
    if (navigator.share) {
      await navigator.share(shareData);
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url.href);
      showToast('本站链接已复制');
    } else {
      window.prompt('复制本站链接', url.href);
    }
  } catch (error) {
    if (error.name !== 'AbortError') showToast('分享未完成，可手动复制地址栏链接。');
  }
}

function openLightbox(index) {
  activeLightbox = { stationId: currentStation.id, index };
  lastFocusedElement = document.activeElement;
  updateLightbox();
  dom.lightbox.hidden = false;
  dom.body.classList.add('is-locked');
  window.setTimeout(() => $('.lightbox-close')?.focus(), 30);
}

function updateLightbox() {
  const station = getStation(activeLightbox.stationId);
  if (!station) return;
  const image = station.images[activeLightbox.index];
  if (!image) return;
  dom.lightboxImage.src = `${image.src}-1280.webp`;
  dom.lightboxImage.alt = image.alt;
  dom.lightboxCaption.textContent = `${image.caption} · ${activeLightbox.index + 1}/${station.images.length}`;
  const multiple = station.images.length > 1;
  dom.lightboxPrev.hidden = !multiple;
  dom.lightboxNext.hidden = !multiple;
}

function stepLightbox(direction) {
  const station = getStation(activeLightbox.stationId);
  if (!station) return;
  activeLightbox.index = (activeLightbox.index + direction + station.images.length) % station.images.length;
  updateLightbox();
}

function closeLightbox() {
  dom.lightbox.hidden = true;
  unlockPageIfClear();
  lastFocusedElement?.focus?.();
}
function openCompletionModal() {
  renderCompletionContent();
  lastFocusedElement = document.activeElement;
  dom.completionModal.hidden = false;
  dom.body.classList.add('is-locked');
  window.setTimeout(() => $('.modal-close', dom.completionModal)?.focus(), 40);
  audio.play('open');
}

function closeCompletionModal() {
  dom.completionModal.hidden = true;
  unlockPageIfClear();
  lastFocusedElement?.focus?.();
}

function completionMarkup() {
  const progress = getProgress();
  const complete = progress.visitedCount === stations.length;
  const nickname = state.nickname || '提灯人';
  const badges = stations.map((station) => {
    const visited = state.visited.includes(station.id);
    return `<div class="completion-badge${visited ? ' is-lit' : ''}">${icon('lantern')}<span>${visited ? station.navTitle : '未到访'}</span></div>`;
  }).join('');

  return `
    <div class="completion-hero">
      <div class="completion-seal">${icon('lantern')}</div>
      <div>
        <p>${complete ? '五站行程已完成' : '导览进度记录'} · ${modes[state.mode].label}</p>
        <h2 id="completionTitle">${complete ? '你的提灯纪念' : '提灯足迹'}</h2>
      </div>
    </div>
    <div class="rating-line">
      <span>本次导览评级</span>
      <strong>${progress.rating.label}</strong>
      <p>${progress.rating.description}</p>
    </div>
    <div class="completion-stats">
      <div class="completion-stat"><strong>${progress.visitedCount}/5</strong><span>到访站点</span></div>
      <div class="completion-stat"><strong>${progress.correctFirstCount}/5</strong><span>首次答对</span></div>
      <div class="completion-stat"><strong>${progress.score}/10</strong><span>真理之光</span></div>
    </div>
    <div class="completion-badges" aria-label="五站徽章">${badges}</div>
    <div class="certificate-preview">
      <small>1935.3.10—3.12 · 贵州遵义苟坝</small>
      <strong>一盏马灯·照亮苟坝</strong>
      <p>致 <span id="certificateNickname">${escapeHtml(nickname)}</span>：${complete ? '你已走完五站，把这段历史提在手中。' : '继续沿灯前行，集齐五站真理之光。'}</p>
    </div>
    <div class="nickname-field">
      <label for="nicknameInput">纪念卡署名</label>
      <input id="nicknameInput" type="text" maxlength="16" autocomplete="nickname" placeholder="输入昵称（可选）" value="${escapeHtml(state.nickname)}">
    </div>
    ${complete ? '' : `<p class="completion-incomplete">还差 ${stations.length - progress.visitedCount} 站。关闭此面板后可继续沿地图或站点按钮游览；集齐五站后即可生成 PNG 纪念卡。</p>`}
    <div class="completion-actions">
      <button class="primary-button" id="downloadCard" type="button" ${complete ? '' : 'disabled'}>
        ${icon('share')}<span>${complete ? '保存纪念卡' : '集齐五站后可生成'}</span>
      </button>
      <button class="secondary-button" type="button" id="continueTour">${complete ? '继续浏览' : '前往下一站'}</button>
    </div>
  `;
}

function renderCompletionContent() {
  dom.completionContent.innerHTML = completionMarkup();
}

function updateCompletionPreviewIfOpen() {
  if (dom.completionModal.hidden) return;
  const input = $('#nicknameInput', dom.completionModal);
  const activeId = document.activeElement?.id;
  const selectionStart = input?.selectionStart;
  renderCompletionContent();
  if (activeId === 'nicknameInput') {
    const nextInput = $('#nicknameInput', dom.completionModal);
    nextInput?.focus();
    if (typeof selectionStart === 'number') nextInput?.setSelectionRange(selectionStart, selectionStart);
  }
}

function updateNickname(value) {
  state.nickname = value.slice(0, 16);
  persistState();
  const preview = $('#certificateNickname');
  if (preview) preview.textContent = state.nickname || '提灯人';
}
function canvasRoundRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function wrapCanvasText(context, text, x, y, maxWidth, lineHeight) {
  const chars = Array.from(text);
  let line = '';
  let lineCount = 0;
  for (const char of chars) {
    const test = line + char;
    if (context.measureText(test).width > maxWidth && line) {
      context.fillText(line, x, y + lineCount * lineHeight);
      line = char;
      lineCount += 1;
    } else {
      line = test;
    }
  }
  if (line) context.fillText(line, x, y + lineCount * lineHeight);
  return y + lineCount * lineHeight;
}

function drawCertificateLantern(context, x, y, lit, label) {
  context.save();
  if (lit) {
    const glow = context.createRadialGradient(x, y, 4, x, y, 48);
    glow.addColorStop(0, 'rgba(255, 205, 118, .42)');
    glow.addColorStop(1, 'rgba(255, 170, 63, 0)');
    context.fillStyle = glow;
    context.beginPath();
    context.arc(x, y, 48, 0, Math.PI * 2);
    context.fill();
  }
  context.strokeStyle = lit ? '#e2ac5b' : 'rgba(224, 196, 142, .2)';
  context.lineWidth = 2;
  canvasRoundRect(context, x - 17, y - 22, 34, 42, 6);
  context.stroke();
  context.fillStyle = lit ? '#f7d798' : 'rgba(224, 196, 142, .22)';
  context.beginPath();
  context.arc(x, y - 2, 6, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = lit ? '#f0e2c7' : 'rgba(224, 196, 142, .35)';
  context.font = '500 17px "Microsoft YaHei", sans-serif';
  context.textAlign = 'center';
  context.fillText(label, x, y + 56);
  context.restore();
}

function downloadCertificate() {
  const progress = getProgress();
  if (progress.visitedCount < stations.length) {
    showToast('集齐五站后才能生成纪念卡。');
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 1800;
  canvas.height = 1120;
  const context = canvas.getContext('2d');
  if (!context) {
    showToast('当前浏览器无法生成纪念卡。');
    return;
  }

  const background = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  background.addColorStop(0, '#1d1711');
  background.addColorStop(.55, '#120f0b');
  background.addColorStop(1, '#23170f');
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const glow = context.createRadialGradient(900, 250, 30, 900, 250, 650);
  glow.addColorStop(0, 'rgba(205, 127, 49, .22)');
  glow.addColorStop(1, 'rgba(205, 127, 49, 0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.strokeStyle = 'rgba(221, 165, 83, .42)';
  context.lineWidth = 2;
  context.strokeRect(42, 42, canvas.width - 84, canvas.height - 84);
  context.strokeStyle = 'rgba(221, 165, 83, .15)';
  context.lineWidth = 1;
  context.strokeRect(58, 58, canvas.width - 116, canvas.height - 116);

  context.textAlign = 'center';
  context.fillStyle = '#bd8d50';
  context.font = '600 20px "Microsoft YaHei", sans-serif';
  context.fillText('GOUBA CONFERENCE · DIGITAL GUIDE', 900, 122);

  context.fillStyle = '#f3e7cf';
  context.font = '600 64px "Noto Serif SC", "Songti SC", serif';
  context.fillText('一盏马灯 · 照亮苟坝', 900, 225);
  context.fillStyle = '#d5b477';
  context.font = '400 25px "Noto Serif SC", "Songti SC", serif';
  context.fillText('苟坝会议数字导览纪念', 900, 274);

  context.textAlign = 'left';
  context.fillStyle = '#a99a81';
  context.font = '500 20px "Microsoft YaHei", sans-serif';
  context.fillText('提灯人', 235, 360);
  context.fillStyle = '#f1dfbd';
  context.font = '600 48px "Noto Serif SC", "Songti SC", serif';
  context.fillText(state.nickname || '提灯人', 235, 416);

  context.textAlign = 'right';
  context.fillStyle = '#a99a81';
  context.font = '500 20px "Microsoft YaHei", sans-serif';
  context.fillText('导览评级', 1560, 360);
  context.fillStyle = '#f2c676';
  context.font = '600 48px "Noto Serif SC", "Songti SC", serif';
  context.fillText(progress.rating.label, 1560, 416);

  context.strokeStyle = 'rgba(221, 165, 83, .24)';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(235, 462);
  context.lineTo(1560, 462);
  context.stroke();

  stations.forEach((station, index) => {
    drawCertificateLantern(context, 430 + index * 235, 562, state.visited.includes(station.id), station.navTitle);
  });

  context.textAlign = 'center';
  context.fillStyle = '#e8d6b3';
  context.font = '500 24px "Microsoft YaHei", sans-serif';
  context.fillText(`到访 ${progress.visitedCount} / 5 站    ·    首次答对 ${progress.correctFirstCount} / 5 题    ·    真理之光 ${progress.score} / 10`, 900, 702);

  context.fillStyle = '#b8a88e';
  context.font = '400 27px "Noto Serif SC", "Songti SC", serif';
  wrapCanvasText(context, '一个人、一盏马灯，走出一条通往胜利的小道。愿你也能在人生的岔路口，坚持真理、敢于担当。', 900, 774, 1180, 46);

  context.fillStyle = '#c3985a';
  context.font = '500 21px "Microsoft YaHei", sans-serif';
  context.fillText(formatDate(), 900, 936);
  context.fillStyle = '#796d5c';
  context.font = '400 16px "Microsoft YaHei", sans-serif';
  context.fillText('历史内容依据馆方提供材料整理 · 本纪念卡仅作学习记录', 900, 992);

  canvas.toBlob((blob) => {
    if (!blob) {
      showToast('纪念卡生成失败，请重试。');
      return;
    }
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = `苟坝会议导览纪念卡-${formatDate().replaceAll('/', '')}.png`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    showToast('纪念卡已生成，请查看下载文件。');
  }, 'image/png');
}
function renderServiceCards() {
  dom.serviceList.innerHTML = services.map((service) => `
    <article class="service-card">
      <span class="service-icon">${icon(service.icon)}</span>
      <div>
        <h3>${service.title}</h3>
        ${service.lines.map((line) => `<p>${line}</p>`).join('')}
        ${service.href ? `<a href="${service.href}">${icon('phone')}${service.action || '联系景区'}</a>` : ''}
      </div>
    </article>
  `).join('');
}

let openDrawerElement = null;

function openDrawer(drawer, trigger = document.activeElement) {
  if (!drawer || openDrawerElement === drawer) return;
  if (openDrawerElement) closeDrawer(openDrawerElement, { restoreFocus: false });
  lastFocusedElement = trigger || document.activeElement;
  openDrawerElement = drawer;
  drawer.hidden = false;
  drawer.setAttribute('aria-hidden', 'false');
  dom.backdrop.hidden = false;
  dom.body.classList.add('is-locked');
  requestAnimationFrame(() => {
    dom.backdrop.classList.add('is-open');
    drawer.classList.add('is-open');
  });
  if (drawer === dom.guideDrawer) {
    seedGuideChat();
    renderGuideMessages();
    renderGuideSuggestions();
  }
  window.setTimeout(() => {
    if (drawer === dom.guideDrawer) dom.guideInput.focus();
    else $('.drawer-close', drawer)?.focus();
  }, 380);
  audio.play('open');
}

function closeDrawer(drawer = openDrawerElement, { restoreFocus = true } = {}) {
  if (!drawer) return;
  drawer.classList.remove('is-open');
  drawer.setAttribute('aria-hidden', 'true');
  dom.backdrop.classList.remove('is-open');
  window.setTimeout(() => {
    drawer.hidden = true;
    if (openDrawerElement === drawer) openDrawerElement = null;
    if (!openDrawerElement) dom.backdrop.hidden = true;
    unlockPageIfClear();
    if (restoreFocus) lastFocusedElement?.focus?.();
  }, 360);
}

function openModalElement(modal, focusSelector = '.icon-button') {
  if (openDrawerElement) closeDrawer(openDrawerElement, { restoreFocus: false });
  lastFocusedElement = document.activeElement;
  modal.hidden = false;
  dom.body.classList.add('is-locked');
  window.setTimeout(() => $(focusSelector, modal)?.focus(), 40);
}

function openAboutModal() {
  openModalElement(dom.aboutModal);
  audio.play('open');
}

function closeAboutModal() {
  dom.aboutModal.hidden = true;
  unlockPageIfClear();
  lastFocusedElement?.focus?.();
}

function unlockPageIfClear() {
  const anyOpen = openDrawerElement || !dom.completionModal.hidden || !dom.aboutModal.hidden || !dom.lightbox.hidden;
  if (!anyOpen) dom.body.classList.remove('is-locked');
}
function seedGuideChat() {
  if (chatSeeded) return;
  chatSeeded = true;
  guideMessages.push({
    role: 'assistant',
    text: '我是灯灯。你可以问我苟坝会议的时间、争论经过、马灯夜行、新三人团，或花茂村的体验。',
    source: '馆方材料 · 预设问答'
  });
}

function renderGuideMessages() {
  dom.guideChat.replaceChildren();
  guideMessages.forEach((message) => {
    const row = document.createElement('div');
    row.className = `chat-message${message.role === 'user' ? ' is-user' : ''}`;
    const avatar = document.createElement('span');
    avatar.className = 'chat-avatar';
    avatar.innerHTML = icon(message.role === 'user' ? 'chat' : 'lantern');
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    const text = document.createElement('span');
    text.textContent = message.text;
    bubble.append(text);
    if (message.source) {
      const source = document.createElement('span');
      source.className = 'chat-source';
      source.textContent = message.source;
      bubble.append(source);
    }
    row.append(avatar, bubble);
    dom.guideChat.append(row);
  });

  if (chatPending) {
    const row = document.createElement('div');
    row.className = 'chat-message';
    const avatar = document.createElement('span');
    avatar.className = 'chat-avatar';
    avatar.innerHTML = icon('lantern');
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.innerHTML = '<span class="chat-typing" aria-label="灯灯正在思考"><i></i><i></i><i></i></span>';
    row.append(avatar, bubble);
    dom.guideChat.append(row);
  }
  dom.guideChat.scrollTop = dom.guideChat.scrollHeight;
}

function renderGuideSuggestions() {
  const suggestions = guideService.suggestions(currentStation.id);
  dom.guideSuggestions.replaceChildren();
  suggestions.forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'suggestion-chip';
    button.dataset.question = item.question;
    button.textContent = item.question;
    dom.guideSuggestions.append(button);
  });
}

function openGuideDrawer(trigger) {
  openDrawer(dom.guideDrawer, trigger);
}

async function sendGuideQuestion(rawQuestion) {
  const question = String(rawQuestion || '').trim();
  if (!question || chatPending) return;
  seedGuideChat();
  guideMessages.push({ role: 'user', text: question });
  chatPending = true;
  renderGuideMessages();
  dom.guideInput.value = '';
  const result = await guideService.ask({ question, stationId: currentStation.id, mode: state.mode });
  guideMessages.push({ role: 'assistant', text: result.answer, source: result.source });
  chatPending = false;
  renderGuideMessages();
  announce('灯灯已回答问题');
}
function handleArticleClick(event) {
  const galleryButton = event.target.closest('[data-lightbox-index]');
  if (galleryButton) {
    openLightbox(Number(galleryButton.dataset.lightboxIndex));
    return;
  }
  const quizButton = event.target.closest('[data-quiz-index]');
  if (quizButton && !quizButton.disabled) {
    answerQuiz(Number(quizButton.dataset.quizIndex), quizButton);
    return;
  }
  const actionButton = event.target.closest('[data-action]');
  if (actionButton) {
    const action = actionButton.dataset.action;
    if (action === 'listen') toggleSpeech();
    else if (action === 'share') shareCurrentStation();
    else if (action === 'ask') openGuideDrawer(actionButton);
    else if (action === 'quiz-retry') allowQuizRetry();
    else if (action === 'completion') openCompletionModal();
    else if (action === 'about') openAboutModal();
    return;
  }
  const navButton = event.target.closest('[data-go-station]');
  if (navButton && navButton.dataset.goStation) {
    navigateToStation(navButton.dataset.goStation, { fromUser: true, focus: false });
  }
}

function bindMapLighting() {
  let pressStart = null;
  let pressTimer = null;
  let exploring = false;
  let pointerId = null;

  const moveLight = (clientX, clientY) => {
    const rect = dom.mapSurface.getBoundingClientRect();
    const x = Math.max(2, Math.min(98, ((clientX - rect.left) / rect.width) * 100));
    const y = Math.max(2, Math.min(98, ((clientY - rect.top) / rect.height) * 100));
    setLightAt(x, y);
  };

  const startExploring = () => {
    if (!pressStart) return;
    exploring = true;
    dom.mapSurface.classList.add('is-exploring');
    dom.mapFrame.classList.add('is-exploring');
    moveLight(pressStart.x, pressStart.y);
    try { dom.mapSurface.setPointerCapture(pointerId); } catch (error) {}
    if (navigator.vibrate) navigator.vibrate(10);
    audio.play('lamp');
    announce('马灯已提起，拖动光束可以照亮地图');
  };

  dom.mapSurface.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.target.closest('button, a')) return;
    window.clearTimeout(pressTimer);
    pressStart = { x: event.clientX, y: event.clientY };
    pointerId = event.pointerId;
    pressTimer = window.setTimeout(startExploring, 400);
  });

  dom.mapSurface.addEventListener('pointermove', (event) => {
    if (!pressStart || event.pointerId !== pointerId) return;
    if (!exploring) {
      if (Math.hypot(event.clientX - pressStart.x, event.clientY - pressStart.y) > 12) {
        window.clearTimeout(pressTimer);
        pressStart = null;
      }
      return;
    }
    event.preventDefault();
    moveLight(event.clientX, event.clientY);
  });

  const finishExploring = (event) => {
    window.clearTimeout(pressTimer);
    if (exploring) {
      exploring = false;
      dom.mapSurface.classList.remove('is-exploring');
      dom.mapFrame.classList.remove('is-exploring');
      try { dom.mapSurface.releasePointerCapture(event.pointerId); } catch (error) {}
      returnLightSoon();
      announce('光束已回到当前站点');
    }
    pressStart = null;
    pointerId = null;
  };

  dom.mapSurface.addEventListener('pointerup', finishExploring);
  dom.mapSurface.addEventListener('pointercancel', finishExploring);
  dom.mapSurface.addEventListener('contextmenu', (event) => {
    if (!event.target.closest('button, a')) event.preventDefault();
  });
}

function isTextEntry(element) {
  return element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT' || element.isContentEditable);
}

function getActiveLayer() {
  if (!dom.lightbox.hidden) return dom.lightbox;
  if (!dom.completionModal.hidden) return dom.completionModal;
  if (!dom.aboutModal.hidden) return dom.aboutModal;
  if (openDrawerElement) return openDrawerElement;
  return null;
}

function trapFocus(event) {
  const layer = !introComplete ? dom.intro : getActiveLayer();
  if (!layer) return false;
  const focusables = $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', layer)
    .filter((element) => element.getClientRects().length > 0);
  if (!focusables.length) return false;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;
  if (!layer.contains(active)) {
    event.preventDefault();
    first.focus();
    return true;
  }
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
    return true;
  }
  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

function handleGlobalKeydown(event) {
  if (event.key === 'Escape') {
    if (!dom.lightbox.hidden) { closeLightbox(); event.preventDefault(); return; }
    if (!dom.completionModal.hidden) { closeCompletionModal(); event.preventDefault(); return; }
    if (!dom.aboutModal.hidden) { closeAboutModal(); event.preventDefault(); return; }
    if (openDrawerElement) { closeDrawer(openDrawerElement); event.preventDefault(); return; }
  }
  if (event.key === 'Tab' && trapFocus(event)) return;
  if (!dom.lightbox.hidden) {
    if (event.key === 'ArrowLeft') { stepLightbox(-1); event.preventDefault(); }
    else if (event.key === 'ArrowRight') { stepLightbox(1); event.preventDefault(); }
    return;
  }
  if (!introComplete || getActiveLayer() || isTextEntry(event.target)) return;
  if (event.key === 'ArrowLeft') {
    const index = getStationIndex(currentStation.id);
    if (index > 0) navigateToStation(stations[index - 1].id, { fromUser: true, focus: true });
    event.preventDefault();
  } else if (event.key === 'ArrowRight') {
    const index = getStationIndex(currentStation.id);
    if (index < stations.length - 1) navigateToStation(stations[index + 1].id, { fromUser: true, focus: true });
    event.preventDefault();
  }
}

function getStationFromHash() {
  return getStation(decodeURIComponent(window.location.hash.replace(/^#/, '')));
}
function resetTourProgress() {
  const confirmed = window.confirm('将清除本机的到访记录、答题结果和纪念卡署名，并回到第一站。是否继续？');
  if (!confirmed) return;
  stopSpeech();
  state = { ...defaultState, mode: state.mode, sound: state.sound };
  currentStation = stations[0];
  state.currentStation = currentStation.id;
  guideMessages = [];
  chatSeeded = false;
  persistState();
  closeDrawer(dom.serviceDrawer, { restoreFocus: false });
  renderStation({ fromUser: false });
  updateMapAndProgress();
  renderGuideSuggestions();
  window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
  window.setTimeout(() => showToast('导览进度已清除，已回到第一站。'), 480);
}
function bindEvents() {
  dom.igniteButton.addEventListener('click', () => igniteIntro());
  dom.skipIntro.addEventListener('click', () => igniteIntro({ instant: true }));
  dom.introSound.addEventListener('click', () => toggleSound());
  dom.soundToggle.addEventListener('click', () => toggleSound());

  dom.introModes.addEventListener('click', (event) => {
    const button = event.target.closest('[data-intro-mode]');
    if (!button) return;
    setMode(button.dataset.introMode, { render: false });
    audio.play('click');
  });

  dom.modeSwitch.addEventListener('click', (event) => {
    const button = event.target.closest('[data-mode]');
    if (!button) return;
    setMode(button.dataset.mode, { render: true, notify: true });
    audio.play('click');
  });

  dom.serviceButton.addEventListener('click', () => openDrawer(dom.serviceDrawer, dom.serviceButton));
  dom.askGuideButton.addEventListener('click', () => openGuideDrawer(dom.askGuideButton));
  dom.footerAskButton.addEventListener('click', () => openGuideDrawer(dom.footerAskButton));
  dom.progressButton.addEventListener('click', () => openCompletionModal());
  dom.aboutButton.addEventListener('click', () => openAboutModal());
  dom.drawerAboutButton.addEventListener('click', () => {
    closeDrawer(dom.serviceDrawer, { restoreFocus: false });
    window.setTimeout(() => openAboutModal(), 380);
  });

  document.querySelector('#resetProgressButton').addEventListener('click', resetTourProgress);

  $$('[data-close-drawer]').forEach((button) => {
    button.addEventListener('click', () => closeDrawer(button.closest('.drawer')));
  });

  dom.backdrop.addEventListener('click', () => {
    if (openDrawerElement) closeDrawer(openDrawerElement);
  });

  $$('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', () => {
      const modal = button.closest('.modal');
      if (modal === dom.completionModal) closeCompletionModal();
      else if (modal === dom.aboutModal) closeAboutModal();
    });
  });

  $$('[data-close-lightbox]').forEach((button) => {
    button.addEventListener('click', closeLightbox);
  });
  dom.lightboxPrev.addEventListener('click', () => stepLightbox(-1));
  dom.lightboxNext.addEventListener('click', () => stepLightbox(1));
  dom.lightbox.addEventListener('click', (event) => {
    if (event.target === dom.lightbox) closeLightbox();
  });
  dom.lightboxImage.addEventListener('error', () => {
    dom.lightboxCaption.textContent = '图片暂时无法加载，请稍后再试。';
  });

  dom.stationNodes.addEventListener('click', (event) => {
    const button = event.target.closest('[data-station]');
    if (!button) return;
    navigateToStation(button.dataset.station, { fromUser: true, focus: false });
  });

  dom.stationPanel.addEventListener('click', handleArticleClick);
  dom.stationPanel.addEventListener('error', (event) => {
    if (event.target.tagName !== 'IMG') return;
    const item = event.target.closest('.gallery-item');
    if (item) item.classList.add('is-missing');
    event.target.style.visibility = 'hidden';
  }, true);

  dom.guideForm.addEventListener('submit', (event) => {
    event.preventDefault();
    sendGuideQuestion(dom.guideInput.value);
  });

  dom.guideSuggestions.addEventListener('click', (event) => {
    const button = event.target.closest('[data-question]');
    if (button) sendGuideQuestion(button.dataset.question);
  });

  dom.completionModal.addEventListener('click', (event) => {
    if (event.target.closest('#downloadCard')) {
      downloadCertificate();
      return;
    }
    if (event.target.closest('#continueTour')) {
      const complete = getProgress().visitedCount === stations.length;
      closeCompletionModal();
      if (!complete) {
        const next = stations.find((station) => !state.visited.includes(station.id));
        if (next) window.setTimeout(() => navigateToStation(next.id, { fromUser: true }), 80);
      }
    }
  });

  dom.completionModal.addEventListener('input', (event) => {
    if (event.target.id === 'nicknameInput') updateNickname(event.target.value);
  });

  document.querySelector('#brandHome').addEventListener('click', (event) => {
    event.preventDefault();
    navigateToStation(stations[0].id, { fromUser: true, focus: false });
  });

  window.addEventListener('hashchange', () => {
    const target = getStationFromHash();
    if (target && introComplete && target.id !== currentStation.id) {
      navigateToStation(target.id, { fromUser: false, focus: false });
    }
  });

  window.addEventListener('keydown', handleGlobalKeydown);
  window.addEventListener('pagehide', stopSpeech);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopSpeech();
  });
}

function init() {
  if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
  window.scrollTo(0, 0);
  dom.appShell.inert = true;
  dom.siteFooter.inert = true;
  dom.appShell.setAttribute('aria-hidden', 'true');
  renderServiceCards();
  buildMapNodes();
  updateModeUI();
  updateSoundUI();

  const hashStation = getStationFromHash();
  if (hashStation) {
    currentStation = hashStation;
    state.currentStation = hashStation.id;
    persistState();
  } else {
    const savedStation = getStation(state.currentStation);
    currentStation = savedStation || stations[0];
  }

  renderStation();
  updateMapAndProgress();
  renderGuideSuggestions();
  bindMapLighting();
  bindEvents();

  window.setTimeout(() => dom.igniteButton.focus({ preventScroll: true }), 230);
}

init();