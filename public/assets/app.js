(() => {
  "use strict";

  const SPEED_DELAYS = { slow: 210, normal: 105, fast: 52 };
  const CONFETTI_COLORS = ["#FFD74A", "#FF7D8D", "#7BDCB7", "#68D4EA", "#3B79DA", "#FFB347"];
  const PREF = "siqi.rollcall.";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const classGate = document.getElementById("classGate");
  const classGrid = document.getElementById("classGrid");
  const classSearch = document.getElementById("classSearch");
  const classCount = document.getElementById("classCount");
  const gateState = document.getElementById("gateState");
  const gateStateTitle = document.getElementById("gateStateTitle");
  const gateStateText = document.getElementById("gateStateText");
  const gateActions = document.getElementById("gateActions");
  const retryClassesBtn = document.getElementById("retryClassesBtn");
  const workspace = document.getElementById("workspace");
  const switchClassBtn = document.getElementById("switchClassBtn");

  const stage = document.getElementById("stage");
  const stageStateText = document.getElementById("stageStateText");
  const roundReadout = document.getElementById("roundReadout");
  const nameDisplay = document.getElementById("nameDisplay");
  const statusText = document.getElementById("statusText");
  const resultAnnouncer = document.getElementById("resultAnnouncer");
  const startBtn = document.getElementById("startBtn");
  const startLabel = document.getElementById("startLabel");
  const stopBtn = document.getElementById("stopBtn");
  const resetBtn = document.getElementById("resetBtn");
  const soundBtn = document.getElementById("soundBtn");
  const fullscreenBtn = document.getElementById("fullscreenBtn");
  const noRepeat = document.getElementById("noRepeat");
  const speedInputs = Array.from(document.querySelectorAll('input[name="speed"]'));
  const currentClassName = document.getElementById("currentClassName");
  const currentClassDescription = document.getElementById("currentClassDescription");
  const classSubtitle = document.getElementById("classSubtitle");
  const nameCount = document.getElementById("nameCount");
  const studentRoster = document.getElementById("studentRoster");
  const refreshClassBtn = document.getElementById("refreshClassBtn");
  const manageClassLink = document.querySelector('.class-summary-actions a[href="/admin/"]');
  const historyList = document.getElementById("historyList");
  const historyEmpty = document.getElementById("historyEmpty");
  const historyTotal = document.getElementById("historyTotal");
  const toast = document.getElementById("toast");
  const confettiLayer = document.getElementById("confettiLayer");

  const state = {
    classes: [],
    classData: null,
    roster: [],
    drawn: [],
    currentName: null,
    spinning: false,
    rollTimer: null,
    speed: "normal",
    soundOn: true,
    noRepeat: true,
    searchQuery: "",
    selectionToken: 0
  };

  let toastTimer = null;
  let audioContext = null;
  let audioBroken = false;
  let lastTickAt = 0;

  function readPreference(key, fallback) {
    try {
      const value = localStorage.getItem(PREF + key);
      return value === null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function writePreference(key, value) {
    try {
      localStorage.setItem(PREF + key, String(value));
    } catch {
      return;
    }
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => {
      toast.classList.remove("is-visible");
    }, 2400);
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(options.headers || {})
      },
      ...options
    });
    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    if (!response.ok) {
      throw new Error(data.error || "请求失败，请稍后重试");
    }
    return data;
  }

  function randomIndex(length) {
    if (length <= 0) {
      return 0;
    }
    if (window.crypto && typeof window.crypto.getRandomValues === "function") {
      const values = new Uint32Array(1);
      const limit = Math.floor(4294967296 / length) * length;
      do {
        window.crypto.getRandomValues(values);
      } while (values[0] >= limit);
      return values[0] % length;
    }
    return Math.floor(Math.random() * length);
  }

  function pickFromPool(pool, exclude) {
    if (pool.length === 1) {
      return pool[0];
    }
    let picked = pool[randomIndex(pool.length)];
    let guard = 0;
    while (picked === exclude && guard < 8) {
      picked = pool[randomIndex(pool.length)];
      guard += 1;
    }
    return picked;
  }

  function getPool() {
    if (!state.noRepeat) {
      return state.roster.slice();
    }
    const drawnSet = new Set(state.drawn);
    return state.roster.filter((name) => !drawnSet.has(name));
  }

  function getRollDelay() {
    const base = SPEED_DELAYS[state.speed] || SPEED_DELAYS.normal;
    return reducedMotion.matches ? Math.max(base, 170) : base;
  }

  function updateNameDisplay(text, isPrompt) {
    const length = Array.from(text).length;
    nameDisplay.textContent = text;
    nameDisplay.classList.toggle("is-prompt", Boolean(isPrompt));
    nameDisplay.classList.toggle("is-long", !isPrompt && length > 5);
    nameDisplay.classList.toggle("is-xlong", !isPrompt && length > 9);
  }

  function syncSoundButton() {
    soundBtn.setAttribute("aria-pressed", String(state.soundOn));
    soundBtn.setAttribute("aria-label", state.soundOn ? "关闭音效" : "开启音效");
    soundBtn.title = state.soundOn ? "关闭音效" : "开启音效";
  }

  function syncFullscreenButton() {
    const isFullscreen = Boolean(document.fullscreenElement);
    document.documentElement.classList.toggle("is-fullscreen", isFullscreen);
    fullscreenBtn.setAttribute("aria-label", isFullscreen ? "退出全屏" : "进入全屏");
    fullscreenBtn.title = isFullscreen ? "退出全屏" : "进入全屏";
  }

  function setClassGateMessage(title, text, showActions = false) {
    gateStateTitle.textContent = title;
    gateStateText.textContent = text;
    gateActions.hidden = !showActions;
    gateState.hidden = false;
    classGrid.hidden = true;
  }

  function renderClassList() {
    const query = state.searchQuery.trim().toLowerCase();
    const filtered = state.classes.filter((classItem) => {
      if (!query) {
        return true;
      }
      return `${classItem.name} ${classItem.description || ""}`.toLowerCase().includes(query);
    });

    classGrid.replaceChildren();
    classGrid.setAttribute("aria-busy", "false");

    if (!state.classes.length) {
      classCount.textContent = "0 个班级";
      classSearch.disabled = true;
      setClassGateMessage(
        "还没有班级",
        "先进入老师后台，添加一个班级和学生名单。",
        true
      );
      return;
    }

    classSearch.disabled = false;
    classCount.textContent = query
      ? `找到 ${filtered.length} 个班级`
      : `共 ${state.classes.length} 个班级`;

    if (!filtered.length) {
      setClassGateMessage(
        "没有找到匹配的班级",
        "换一个关键词试试，或者清空搜索框。",
        false
      );
      return;
    }

    gateState.hidden = true;
    classGrid.hidden = false;
    const lastClassId = readPreference("lastClass", "");
    const fragment = document.createDocumentFragment();

    filtered.forEach((classItem, index) => {
      const card = document.createElement("button");
      const number = document.createElement("span");
      const name = document.createElement("span");
      const description = document.createElement("span");
      const meta = document.createElement("span");
      const arrow = document.createElement("span");

      card.type = "button";
      card.className = "class-card";
      card.dataset.classId = String(classItem.id);
      card.style.setProperty("--i", String(Math.min(index, 12)));
      if (String(classItem.id) === String(lastClassId)) {
        card.classList.add("is-last");
      }

      number.className = "class-number";
      number.textContent = String(index + 1).padStart(2, "0");
      name.className = "class-card-name";
      name.textContent = classItem.name;
      description.className = "class-card-description";
      description.textContent = classItem.description || "点击进入这个班级";
      meta.className = "class-card-meta";
      meta.append(document.createTextNode(`${Number(classItem.student_count) || 0} 位同学`));
      arrow.setAttribute("aria-hidden", "true");
      arrow.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><path d="M5 12h13M13 6.5 18.5 12 13 17.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      meta.append(arrow);

      card.append(number, name, description, meta);
      card.addEventListener("click", () => selectClass(classItem.id));
      fragment.append(card);
    });

    classGrid.append(fragment);
  }

  async function loadClasses() {
    classSearch.disabled = true;
    classGrid.setAttribute("aria-busy", "true");
    classCount.textContent = "正在读取班级…";
    setClassGateMessage("正在读取班级…", "马上就好。", false);

    try {
      const data = await api("/api/classes");
      state.classes = Array.isArray(data.classes) ? data.classes : [];
      renderClassList();
    } catch (error) {
      classGrid.setAttribute("aria-busy", "false");
      classCount.textContent = "加载失败";
      classSearch.disabled = true;
      setClassGateMessage(
        "班级读取失败",
        error.message || "请检查网络或后台配置，然后重试。",
        true
      );
    }
  }

  function renderStudentRoster() {
    studentRoster.replaceChildren();
    if (!state.roster.length) {
      const empty = document.createElement("p");
      empty.className = "student-roster-empty";
      empty.textContent = "这个班级还没有学生，请到老师后台添加。";
      studentRoster.append(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    state.roster.forEach((student) => {
      const chip = document.createElement("span");
      chip.className = "student-chip";
      chip.textContent = student;
      fragment.append(chip);
    });
    studentRoster.append(fragment);
  }

  function syncClassPanel() {
    const classData = state.classData;
    if (!classData) {
      currentClassName.textContent = "未选择班级";
      currentClassDescription.textContent = "";
      classSubtitle.textContent = "名单由老师后台统一同步";
      nameCount.textContent = "0 人";
      manageClassLink.href = "/admin/";
      return;
    }
    currentClassName.textContent = classData.name;
    currentClassDescription.textContent = classData.description || "老师还没有填写班级说明";
    classSubtitle.textContent = `当前班级 · ${state.roster.length} 位同学`;
    nameCount.textContent = `${state.roster.length} 人`;
    manageClassLink.href = `/admin/?class=${encodeURIComponent(classData.id)}`;
  }

  function syncUI() {
    const pool = getPool();
    const isEmpty = state.roster.length === 0;
    const allDrawn = !isEmpty && state.noRepeat && pool.length === 0;
    const isDone = allDrawn && !state.currentName;
    let display = "准备好了吗？";
    let prompt = true;
    let status = "名单已就绪，点击“开始点名”";
    let stageState = "idle";
    let stageLabel = "准备就绪";

    if (state.spinning) {
      display = state.currentName || "……";
      prompt = false;
      status = "正在随机滚动，快点“停止”吧！";
      stageState = "rolling";
      stageLabel = "滚动中";
    } else if (state.currentName) {
      display = state.currentName;
      prompt = false;
      stageState = "winner";
      if (allDrawn) {
        status = "本轮全班都点过啦，点“重置”再来一轮";
        stageLabel = "本轮完成";
      } else {
        status = `${state.currentName} 准备好了没～`;
        stageLabel = "已锁定";
      }
    } else if (isEmpty) {
      display = state.classData ? "班级还没有学生" : "先选择班级";
      status = state.classData
        ? "请老师到后台添加学生名单"
        : "先选择一个班级，再开始点名";
      stageState = "done";
      stageLabel = "等待名单";
    } else if (isDone) {
      display = "全班都点过啦";
      status = "点“重置”就能再来一轮";
      stageState = "done";
      stageLabel = "本轮完成";
    }

    updateNameDisplay(display, prompt);
    statusText.textContent = status;
    stage.dataset.state = stageState;
    stageStateText.textContent = stageLabel;
    roundReadout.textContent = `本轮已点 ${state.drawn.length} ${state.noRepeat ? "位" : "次"}`;
    historyTotal.textContent = `${state.drawn.length} ${state.noRepeat ? "位" : "次"}`;
    syncClassPanel();

    const canStart = !isEmpty && (!state.noRepeat || pool.length > 0);
    startBtn.disabled = state.spinning || !canStart;
    stopBtn.disabled = !state.spinning;
    startLabel.textContent = state.spinning
      ? "滚动中…"
      : (allDrawn ? "本轮已抽完" : (state.currentName ? "再抽一位" : "开始点名"));
    refreshClassBtn.disabled = state.spinning || !state.classData;
    noRepeat.disabled = state.spinning;
  }

  function renderHistory() {
    historyList.replaceChildren();
    const hasHistory = state.drawn.length > 0;
    historyEmpty.hidden = hasHistory;
    historyList.hidden = !hasHistory;
    if (!hasHistory) {
      return;
    }

    const fragment = document.createDocumentFragment();
    state.drawn.forEach((name, index) => {
      const item = document.createElement("li");
      const badge = document.createElement("span");
      const label = document.createElement("span");
      badge.className = "chip-index";
      badge.textContent = String(index + 1);
      label.textContent = name;
      item.append(badge, label);
      fragment.append(item);
    });
    historyList.append(fragment);
  }

  function stopTimer() {
    window.clearTimeout(state.rollTimer);
    state.rollTimer = null;
    state.spinning = false;
  }

  function showGate() {
    stopTimer();
    confettiLayer.replaceChildren();
    workspace.hidden = true;
    classGate.hidden = false;
    switchClassBtn.hidden = true;
    state.classData = null;
    state.roster = [];
    state.drawn = [];
    state.currentName = null;
    state.searchQuery = "";
    classSearch.value = "";
    document.title = "星星点名机";
    history.replaceState({}, "", location.pathname);
    renderClassList();
    window.scrollTo({ top: 0, behavior: reducedMotion.matches ? "auto" : "smooth" });
  }

  function showWorkspace() {
    classGate.hidden = true;
    workspace.hidden = false;
    switchClassBtn.hidden = false;
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  async function selectClass(id, { updateUrl = true } = {}) {
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      return;
    }
    const token = state.selectionToken + 1;
    state.selectionToken = token;
    stopTimer();
    classGrid.setAttribute("aria-busy", "true");
    classGrid.querySelectorAll("button").forEach((button) => {
      button.disabled = true;
    });

    try {
      const data = await api(`/api/classes/${numericId}`);
      if (token !== state.selectionToken) {
        return;
      }
      state.classData = data.class;
      state.roster = Array.isArray(data.class.students) ? data.class.students : [];
      state.drawn = [];
      state.currentName = null;
      state.spinning = false;
      writePreference("lastClass", numericId);
      if (updateUrl) {
        history.replaceState({}, "", `${location.pathname}?class=${numericId}`);
      }
      document.title = `${data.class.name} · 星星点名机`;
      syncClassPanel();
      renderStudentRoster();
      renderHistory();
      syncUI();
      showWorkspace();
    } catch (error) {
      if (token !== state.selectionToken) {
        return;
      }
      showToast(error.message || "班级加载失败");
      if (updateUrl) {
        history.replaceState({}, "", location.pathname);
      }
      if (!workspace.hidden) {
        showGate();
      }
    } finally {
      classGrid.setAttribute("aria-busy", "false");
      classGrid.querySelectorAll("button").forEach((button) => {
        button.disabled = false;
      });
    }
  }

  async function refreshCurrentClass() {
    if (!state.classData || state.spinning) {
      return;
    }
    refreshClassBtn.disabled = true;
    try {
      const data = await api(`/api/classes/${state.classData.id}`);
      state.classData = data.class;
      state.roster = Array.isArray(data.class.students) ? data.class.students : [];
      const rosterSet = new Set(state.roster);
      state.drawn = state.drawn.filter((name) => rosterSet.has(name));
      if (state.currentName && !rosterSet.has(state.currentName)) {
        state.currentName = null;
      }
      renderStudentRoster();
      renderHistory();
      syncUI();
      showToast("名单已刷新");
    } catch (error) {
      showToast(error.message || "刷新失败");
    } finally {
      refreshClassBtn.disabled = false;
    }
  }

  function reachAudioContext() {
    if (!state.soundOn || audioBroken) {
      return null;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      audioBroken = true;
      return null;
    }
    try {
      if (!audioContext) {
        audioContext = new AudioContextClass();
      }
      if (audioContext.state === "suspended") {
        audioContext.resume().catch(() => {});
      }
      return audioContext;
    } catch {
      audioBroken = true;
      return null;
    }
  }

  function playTone(frequency, duration, type = "sine", volume = 0.025, delay = 0) {
    const context = reachAudioContext();
    if (!context) {
      return;
    }
    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  function playTick() {
    const now = performance.now();
    if (now - lastTickAt < 78) {
      return;
    }
    lastTickAt = now;
    playTone(410 + Math.random() * 55, 0.035, "triangle", 0.012);
  }

  function playStartSound() {
    playTone(392, 0.07, "sine", 0.02, 0);
    playTone(523.25, 0.09, "sine", 0.02, 0.07);
  }

  function playWinSound() {
    [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
      playTone(frequency, 0.24, "sine", 0.028, index * 0.075);
    });
    playTone(1567.98, 0.34, "sine", 0.018, 0.32);
  }

  function launchConfetti() {
    if (reducedMotion.matches) {
      return;
    }
    confettiLayer.replaceChildren();
    const ticket = document.querySelector(".name-ticket");
    const rect = ticket.getBoundingClientRect();
    const fragment = document.createDocumentFragment();

    for (let index = 0; index < 42; index += 1) {
      const piece = document.createElement("span");
      const x = rect.left + rect.width / 2 + (Math.random() - 0.5) * rect.width * 0.64;
      const y = rect.top + rect.height * 0.48;
      piece.className = "confetti-piece";
      piece.style.left = `${x}px`;
      piece.style.top = `${y}px`;
      piece.style.width = `${6 + Math.random() * 7}px`;
      piece.style.height = `${10 + Math.random() * 10}px`;
      piece.style.borderRadius = Math.random() > 0.5 ? "50%" : "2px";
      piece.style.background = CONFETTI_COLORS[index % CONFETTI_COLORS.length];
      piece.style.setProperty("--drift", `${(Math.random() - 0.5) * 300}px`);
      piece.style.setProperty("--spin", `${Math.round(Math.random() * 760 - 380)}deg`);
      piece.style.setProperty("--delay", `${Math.random() * 0.12}s`);
      piece.style.setProperty("--duration", `${1 + Math.random() * 0.75}s`);
      fragment.append(piece);
    }

    confettiLayer.append(fragment);
    window.setTimeout(() => {
      confettiLayer.replaceChildren();
    }, 2400);
  }

  function scheduleRoll() {
    window.clearTimeout(state.rollTimer);
    if (!state.spinning) {
      return;
    }
    state.rollTimer = window.setTimeout(() => {
      if (!state.spinning) {
        return;
      }
      const pool = getPool();
      if (!pool.length) {
        stopRolling({ celebrate: false });
        return;
      }
      state.currentName = pickFromPool(pool, state.currentName);
      updateNameDisplay(state.currentName, false);
      playTick();
      scheduleRoll();
    }, getRollDelay());
  }

  function startRolling() {
    if (state.spinning) {
      return;
    }
    if (!state.classData) {
      showToast("请先选择一个班级");
      return;
    }
    if (!state.roster.length) {
      showToast("这个班级还没有学生，请先到后台添加");
      return;
    }
    const pool = getPool();
    if (!pool.length) {
      showToast("本轮全班都点过啦，点“重置”再来一轮");
      return;
    }

    reachAudioContext();
    confettiLayer.replaceChildren();
    resultAnnouncer.textContent = "";
    lastTickAt = 0;
    state.spinning = true;
    state.currentName = pickFromPool(pool, state.currentName);
    document.title = `正在点名 · ${state.classData.name}`;
    syncUI();
    playStartSound();
    scheduleRoll();
  }

  function stopRolling({ celebrate = true } = {}) {
    if (!state.spinning) {
      return;
    }
    window.clearTimeout(state.rollTimer);
    state.rollTimer = null;
    state.spinning = false;

    const finalName = state.currentName;
    if (finalName) {
      state.drawn.push(finalName);
      resultAnnouncer.textContent = `本次点到的同学是 ${finalName}。`;
      document.title = `${finalName} · ${state.classData.name}`;
    }

    syncUI();
    renderHistory();
    if (finalName && celebrate) {
      launchConfetti();
      playWinSound();
    }
  }

  function resetRound() {
    if (!state.classData) {
      return;
    }
    if (state.spinning) {
      window.clearTimeout(state.rollTimer);
      state.rollTimer = null;
      state.spinning = false;
    }
    confettiLayer.replaceChildren();
    state.currentName = null;
    state.drawn = [];
    resultAnnouncer.textContent = "已重置。";
    document.title = `${state.classData.name} · 星星点名机`;
    syncUI();
    renderHistory();
    showToast("已重置，班级名单保持不变");
  }

  classSearch.addEventListener("input", () => {
    state.searchQuery = classSearch.value;
    renderClassList();
  });

  retryClassesBtn.addEventListener("click", async () => {
    await loadClasses();
    const classId = Number(new URLSearchParams(location.search).get("class"));
    if (Number.isInteger(classId) && classId > 0) {
      await selectClass(classId, { updateUrl: false });
    }
  });

  switchClassBtn.addEventListener("click", async () => {
    showGate();
    classSearch.focus({ preventScroll: true });
    await loadClasses();
  });

  refreshClassBtn.addEventListener("click", refreshCurrentClass);
  startBtn.addEventListener("click", startRolling);
  stopBtn.addEventListener("click", () => stopRolling());
  resetBtn.addEventListener("click", resetRound);

  speedInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked) {
        return;
      }
      state.speed = input.value;
      writePreference("speed", state.speed);
      if (state.spinning) {
        scheduleRoll();
      }
    });
  });

  noRepeat.addEventListener("change", () => {
    state.noRepeat = noRepeat.checked;
    writePreference("noRepeat", state.noRepeat);
    syncUI();
  });

  soundBtn.addEventListener("click", () => {
    state.soundOn = !state.soundOn;
    syncSoundButton();
    writePreference("sound", state.soundOn);
    if (state.soundOn) {
      reachAudioContext();
      playTone(659.25, 0.09, "sine", 0.02);
      showToast("音效已开启");
    } else {
      showToast("音效已关闭");
    }
  });

  fullscreenBtn.addEventListener("click", async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      showToast("当前浏览器不支持全屏");
    }
  });

  document.addEventListener("fullscreenchange", syncFullscreenButton);

  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    if (workspace.hidden) {
      return;
    }
    const target = event.target;
    const isTyping = target instanceof HTMLElement
      && target.matches("textarea, input, select, [contenteditable='true']");
    if (isTyping) {
      return;
    }

    if (event.code === "Space") {
      const focusedButton = target instanceof HTMLElement ? target.closest("button") : null;
      if (focusedButton && focusedButton !== startBtn && focusedButton !== stopBtn) {
        return;
      }
      event.preventDefault();
      if (state.spinning) {
        stopRolling();
      } else {
        startRolling();
      }
      return;
    }

    if (event.key.toLowerCase() === "r") {
      event.preventDefault();
      resetRound();
    }
  });

  const storedSpeed = readPreference("speed", "normal");
  state.speed = Object.prototype.hasOwnProperty.call(SPEED_DELAYS, storedSpeed)
    ? storedSpeed
    : "normal";
  state.soundOn = readPreference("sound", "true") !== "false";
  state.noRepeat = readPreference("noRepeat", "true") !== "false";
  speedInputs.forEach((input) => {
    input.checked = input.value === state.speed;
  });
  noRepeat.checked = state.noRepeat;
  syncSoundButton();
  syncFullscreenButton();

  (async () => {
    await loadClasses();
    const requestedClass = Number(new URLSearchParams(location.search).get("class"));
    if (Number.isInteger(requestedClass) && requestedClass > 0) {
      await selectClass(requestedClass, { updateUrl: false });
      if (!state.classData) {
        showGate();
      }
    }
  })();
})();
