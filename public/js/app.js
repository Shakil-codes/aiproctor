const storageKeys = {
  token: "proctorly_token",
  user: "proctorly_user",
  examSessionId: "proctorly_exam_session_id",
  examData: "proctorly_exam_data",
  answers: "proctorly_answers",
  timerEndsAt: "proctorly_timer_ends_at",
  currentIndex: "proctorly_current_index",
  latestResult: "proctorly_latest_result"
};

function getToken() {
  return localStorage.getItem(storageKeys.token);
}

function getUser() {
  const raw = localStorage.getItem(storageKeys.user);
  return raw ? JSON.parse(raw) : null;
}

function setAuth(data) {
  localStorage.setItem(storageKeys.token, data.token);
  localStorage.setItem(storageKeys.user, JSON.stringify(data.user));
}

function clearAuth() {
  Object.values(storageKeys).forEach((key) => localStorage.removeItem(key));
}

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(path, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || "Request failed");
  }

  return data;
}

function redirectIfNeeded(page) {
  const user = getUser();
  if (!user && page !== "login") {
    window.location.href = "/login.html";
    return true;
  }

  if (user?.role === "admin" && page === "dashboard") {
    window.location.href = "/admin.html";
    return true;
  }

  if (user?.role !== "admin" && page === "admin") {
    window.location.href = "/dashboard.html";
    return true;
  }

  return false;
}

function setMessage(id, message, tone = "error") {
  const element = document.getElementById(id);
  if (!element) return;
  element.textContent = message || "";
  element.style.color = tone === "success" ? "var(--teal)" : "var(--danger)";
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function bindLogout() {
  document.querySelectorAll("#logoutButton").forEach((button) => {
    button.addEventListener("click", () => {
      clearAuth();
      window.location.href = "/login.html";
    });
  });
}

function renderStats(container, stats) {
  container.innerHTML = stats
    .map(
      (stat) => `
        <article class="card">
          <p class="eyebrow">${stat.label}</p>
          <p class="stat-value">${stat.value}</p>
          <p class="muted">${stat.note}</p>
        </article>
      `
    )
    .join("");
}

function formatDecision(decision) {
  return String(decision || "").replaceAll("_", " ");
}

function formatDate(value) {
  if (!value) return "Pending";
  if (value._seconds) {
    return new Date(value._seconds * 1000).toLocaleString();
  }
  return new Date(value).toLocaleString();
}

async function initLoginPage() {
  const user = getUser();
  if (user) {
    window.location.href = user.role === "admin" ? "/admin.html" : "/dashboard.html";
    return;
  }

  let mode = "login";
  const authForm = document.getElementById("authForm");
  const nameField = document.getElementById("nameField");
  const authSubmitButton = document.getElementById("authSubmitButton");
  const tabButtons = document.querySelectorAll("[data-auth-tab]");

  function switchMode(nextMode) {
    mode = nextMode;
    nameField.hidden = mode !== "signup";
    authSubmitButton.textContent = mode === "signup" ? "Create Account" : "Access Dashboard";
    tabButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.authTab === mode);
    });
    setMessage("authMessage", "");
  }

  tabButtons.forEach((button) => {
    button.addEventListener("click", () => switchMode(button.dataset.authTab));
  });

  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage("authMessage", "");

    const payload = {
      email: document.getElementById("email").value.trim(),
      password: document.getElementById("password").value.trim()
    };

    if (mode === "signup") {
      payload.name = document.getElementById("name").value.trim();
    }

    try {
      const data = await api(mode === "signup" ? "/auth/signup" : "/auth/login", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setAuth(data);
      window.location.href = data.user.role === "admin" ? "/admin.html" : "/dashboard.html";
    } catch (error) {
      setMessage("authMessage", error.message);
    }
  });

  document.getElementById("demoStudentButton").addEventListener("click", async () => {
    try {
      const data = await api("/auth/demo-login", {
        method: "POST",
        body: JSON.stringify({ role: "student" })
      });
      setAuth(data);
      window.location.href = "/dashboard.html";
    } catch (error) {
      setMessage("authMessage", error.message);
    }
  });

  document.getElementById("demoAdminButton").addEventListener("click", async () => {
    try {
      const data = await api("/auth/demo-login", {
        method: "POST",
        body: JSON.stringify({ role: "admin" })
      });
      setAuth(data);
      window.location.href = "/admin.html";
    } catch (error) {
      setMessage("authMessage", error.message);
    }
  });

  document.getElementById("resetDemoButton").addEventListener("click", async () => {
    try {
      clearAuth();
      const data = await api("/auth/reset-demo", {
        method: "POST",
        body: JSON.stringify({})
      });
      setMessage("authMessage", data.message, "success");
    } catch (error) {
      setMessage("authMessage", error.message);
    }
  });

  switchMode("login");
}

async function initDashboardPage() {
  const user = getUser();
  document.getElementById("studentName").textContent = user?.name || "Student";
  document.getElementById("studentRole").textContent = user?.role || "student";

  const data = await api("/exams");
  const exams = data.exams || [];
  const attempts = data.previousAttempts || [];

  renderStats(document.getElementById("dashboardStats"), [
    { label: "Available Tests", value: exams.length, note: "Active exams ready to start" },
    { label: "Completed Attempts", value: attempts.length, note: "Saved in Firestore" },
    {
      label: "Average Score",
      value: attempts.length
        ? `${Math.round(
            attempts.reduce((sum, item) => sum + (item.score / item.totalMarks) * 100, 0) / attempts.length
          )}%`
        : "--",
      note: "Across previous submissions"
    },
    {
      label: "Warnings Logged",
      value: attempts.reduce((sum, item) => sum + (item.unfocusCount || 0), 0),
      note: "Focus-loss events in past exams"
    }
  ]);

  const examList = document.getElementById("examList");
  if (!exams.length) {
    examList.innerHTML = '<p class="muted">No active exams found. Run the seed script to add the demo exam.</p>';
  } else {
    examList.innerHTML = exams
      .map(
        (exam) => `
          <article class="exam-card">
            <div>
              <p class="eyebrow">Starting now</p>
              <h3>${exam.title}</h3>
            </div>
            <p>${exam.description || "Online MCQ assessment with session monitoring."}</p>
            <div class="meta-row">
              <span>${exam.durationMinutes} minutes</span>
              <span>${exam.totalMarks} marks</span>
            </div>
            <button class="secondary-button start-exam-button" data-exam-id="${exam.id}">
              Launch Exam Portal
            </button>
          </article>
        `
      )
      .join("");

    document.querySelectorAll(".start-exam-button").forEach((button) => {
      button.addEventListener("click", async () => {
        const startData = await api("/exam/start", {
          method: "POST",
          body: JSON.stringify({ examId: button.dataset.examId })
        });

        localStorage.setItem(storageKeys.examSessionId, startData.sessionId);
        localStorage.setItem(storageKeys.examData, JSON.stringify(startData.exam));
        localStorage.setItem(storageKeys.answers, JSON.stringify({}));
        localStorage.setItem(storageKeys.currentIndex, "0");
        localStorage.setItem(
          storageKeys.timerEndsAt,
          String(Date.now() + startData.exam.durationMinutes * 60 * 1000)
        );

        window.location.href = "/test.html";
      });
    });
  }

  const attemptList = document.getElementById("attemptList");
  if (!attempts.length) {
    attemptList.innerHTML = '<p class="muted">No attempts yet.</p>';
  } else {
    attemptList.innerHTML = attempts
      .slice(0, 5)
      .map(
        (attempt) => `
          <div class="attempt-row">
            <div>
              <strong>${attempt.examTitle}</strong>
              <p class="muted">${formatDate(attempt.submittedAt)}</p>
            </div>
            <div><strong>${attempt.score}/${attempt.totalMarks}</strong></div>
          </div>
        `
      )
      .join("");
  }
}

function loadExamState() {
  const sessionId = localStorage.getItem(storageKeys.examSessionId);
  const exam = JSON.parse(localStorage.getItem(storageKeys.examData) || "null");
  const answers = JSON.parse(localStorage.getItem(storageKeys.answers) || "{}");
  const currentIndex = Number(localStorage.getItem(storageKeys.currentIndex) || 0);
  const timerEndsAt = Number(localStorage.getItem(storageKeys.timerEndsAt) || 0);

  return { sessionId, exam, answers, currentIndex, timerEndsAt };
}

function saveExamState({ answers, currentIndex }) {
  localStorage.setItem(storageKeys.answers, JSON.stringify(answers));
  localStorage.setItem(storageKeys.currentIndex, String(currentIndex));
}

async function initTestPage() {
  const user = getUser();
  const state = loadExamState();

  if (!state.sessionId || !state.exam) {
    window.location.href = "/dashboard.html";
    return;
  }

  document.getElementById("examTitle").textContent = state.exam.title;
  document.getElementById("examStudentName").textContent = user?.name || "Student";

  let answers = state.answers;
  let currentIndex = state.currentIndex;
  let answerLocked = false;
  const exam = state.exam;
  const total = exam.questions.length;
  let currentUiState = "normal";
  let currentWarningLevel = 0;
  let chatOpen = false;
  let lockoutTimerId = null;
  let chatMessages = [
    {
      role: "assistant",
      text:
        "I am Proctorly AI. I stay in this corner during the test. If repeated integrity risks appear, I will review them with you here."
    }
  ];
  let sendingChat = false;
  let hasUnreadChat = false;

  const questionCounter = document.getElementById("questionCounter");
  const progressText = document.getElementById("progressText");
  const progressValue = document.getElementById("progressValue");
  const questionPrompt = document.getElementById("questionPrompt");
  const optionsList = document.getElementById("optionsList");
  const questionMapGrid = document.getElementById("questionMapGrid");
  const warningBanner = document.getElementById("warningBanner");
  const questionPanel = document.getElementById("questionPanel");
  const integrityCard = document.getElementById("integrityCard");
  const integrityMessage = document.getElementById("integrityMessage");
  const blockedCard = document.getElementById("blockedCard");
  const blockedMessage = document.getElementById("blockedMessage");
  const chatThread = document.getElementById("chatThread");
  const chatWidget = document.getElementById("chatWidget");
  const warningPopup = document.getElementById("warningPopup");
  const warningPopupTitle = document.getElementById("warningPopupTitle");
  const warningPopupMessage = document.getElementById("warningPopupMessage");
  const lockoutScreen = document.getElementById("lockoutScreen");
  const lockoutMessage = document.getElementById("lockoutMessage");
  const timerValue = document.getElementById("timerValue");
  const chatReasonInput = document.getElementById("chatReasonInput");
  const chatToggleButton = document.getElementById("chatToggleButton");
  const chatCloseButton = document.getElementById("chatCloseButton");
  const chatFabDot = document.getElementById("chatFabDot");
  const sendReasonButton = document.getElementById("sendReasonButton");

  function clearPendingLockout() {
    if (lockoutTimerId) {
      window.clearTimeout(lockoutTimerId);
      lockoutTimerId = null;
    }
  }

  function setChatOpen(nextOpen) {
    chatOpen = nextOpen;
    chatWidget.classList.toggle("is-collapsed", !chatOpen);
    chatToggleButton.setAttribute("aria-expanded", String(chatOpen));
    if (chatOpen) {
      hasUnreadChat = false;
      chatFabDot.hidden = true;
      window.requestAnimationFrame(() => {
        chatReasonInput.focus();
        chatThread.scrollTop = chatThread.scrollHeight;
      });
    }
  }

  function renderChatMessages(messages = []) {
    chatMessages = messages.slice();
    chatThread.innerHTML = messages
      .map(
        (item) => `
          <div class="chat-bubble ${item.loading ? "typing assistant" : item.role === "user" ? "user" : "assistant"}">${
            item.loading
              ? "<span></span><span></span><span></span>"
              : escapeHtml(item.text)
          }</div>
        `
      )
      .join("");
    chatThread.scrollTop = chatThread.scrollHeight;
  }

  function pushLocalChatMessage(role, text) {
    chatMessages.push({ role, text });
    renderChatMessages(chatMessages);
  }

  function setTypingState(active) {
    chatMessages = chatMessages.filter((item) => !item.loading);
    if (active) {
      chatMessages.push({ role: "assistant", text: "", loading: true });
    }
    renderChatMessages(chatMessages);
  }

  function setChatInputState(disabled, placeholder) {
    sendingChat = disabled;
    chatReasonInput.disabled = disabled || currentUiState === "blocked" || currentUiState === "terminated";
    sendReasonButton.disabled = disabled || currentUiState === "blocked" || currentUiState === "terminated";
    chatReasonInput.placeholder =
      placeholder ||
      (currentUiState === "blocked" || currentUiState === "terminated"
        ? "Chat is closed for this session."
        : "Reply to Proctorly AI...");
  }

  function showPopup(title, message) {
    warningPopup.hidden = false;
    warningPopupTitle.textContent = title;
    warningPopupMessage.textContent = message;
    window.clearTimeout(showPopup.timeoutId);
    showPopup.timeoutId = window.setTimeout(() => {
      warningPopup.hidden = true;
    }, 4200);
  }

  function showLockout(message) {
    clearPendingLockout();
    answerLocked = true;
    currentUiState = "terminated";
    localStorage.removeItem(storageKeys.examSessionId);
    localStorage.removeItem(storageKeys.examData);
    localStorage.removeItem(storageKeys.answers);
    localStorage.removeItem(storageKeys.timerEndsAt);
    localStorage.removeItem(storageKeys.currentIndex);
    questionPanel.classList.add("is-intervention");
    integrityCard.hidden = true;
    blockedCard.hidden = true;
    setChatOpen(false);
    warningBanner.hidden = false;
    warningBanner.textContent = message;
    lockoutMessage.textContent = message;
    lockoutScreen.hidden = false;
    setChatInputState(true);
    chatFabDot.hidden = true;
    renderQuestion();
  }

  function applyProctorState(payload) {
    clearPendingLockout();
    currentUiState = payload.uiState || "normal";
    currentWarningLevel = payload.warningLevel || 0;
    answerLocked = Boolean(payload.answerLocked);

    if (payload.chatMessages) {
      renderChatMessages(payload.chatMessages);
    }

    lockoutScreen.hidden = true;
    integrityCard.hidden = true;
    blockedCard.hidden = true;
    warningPopup.hidden = true;
    questionPanel.classList.remove("is-intervention");

    warningBanner.hidden = !payload.inlineWarning;
    warningBanner.textContent = payload.inlineWarning || "";

    chatWidget.classList.toggle("is-strict", currentWarningLevel >= 3);
    setChatInputState(true, "Proctorly AI will ask for a reply if review is needed.");

    if (currentUiState === "warning") {
      if (currentWarningLevel === 1) {
        showPopup(payload.warningTitle, payload.warningMessage);
      } else if (currentWarningLevel >= 2) {
        hasUnreadChat = true;
        chatFabDot.hidden = false;
      }
      setChatInputState(true, "I will ask for a reply here if the review becomes stricter.");
    }

    if (currentUiState === "investigation") {
      questionPanel.classList.add("is-intervention");
      setChatOpen(true);
      hasUnreadChat = true;
      chatFabDot.hidden = false;
      setChatInputState(false, "Type your explanation...");
    }

    if (currentUiState === "blocked") {
      blockedCard.hidden = false;
      blockedMessage.textContent = payload.warningMessage;
      questionPanel.classList.add("is-intervention");
      setChatOpen(true);
      hasUnreadChat = false;
      chatFabDot.hidden = true;
      setChatInputState(true);
    }

    if (currentUiState === "terminated") {
      showLockout(payload.warningMessage);
      return;
    }

    if (currentUiState === "normal") {
      warningBanner.hidden = true;
      chatFabDot.hidden = true;
      hasUnreadChat = false;
      setChatInputState(true, "Proctorly AI will ask for a reply if review is needed.");
    }

    renderQuestion();
  }

  function renderMap() {
    questionMapGrid.innerHTML = exam.questions
      .map((question, index) => {
        const answer = answers[question.id];
        const classes = [
          "map-item",
          index === currentIndex ? "is-current" : "",
          answer !== undefined && index !== currentIndex ? "is-answered" : ""
        ]
          .filter(Boolean)
          .join(" ");

        return `<button type="button" class="${classes}" data-map-index="${index}">${index + 1}</button>`;
      })
      .join("");

    document.querySelectorAll("[data-map-index]").forEach((button) => {
      button.addEventListener("click", () => {
        if (answerLocked) return;
        currentIndex = Number(button.dataset.mapIndex);
        saveExamState({ answers, currentIndex });
        renderQuestion();
      });
    });
  }

  function renderQuestion() {
    const question = exam.questions[currentIndex];
    const answeredCount = exam.questions.filter((item) => answers[item.id] !== undefined).length;
    const percent = Math.round((answeredCount / total) * 100);

    questionCounter.textContent = `Question ${currentIndex + 1} of ${total}`;
    progressText.textContent = `${percent}% completed`;
    progressValue.style.width = `${Math.max(percent, 4)}%`;
    questionPrompt.textContent = question.prompt;

    optionsList.innerHTML = question.options
      .map((option, index) => {
        const checked = Number(answers[question.id]) === index;
        return `
          <div class="option-card ${checked ? "is-selected" : ""}">
            <label>
              <input type="radio" name="currentQuestion" value="${index}" ${checked ? "checked" : ""} ${
          answerLocked ? "disabled" : ""
        } />
              <span>${option}</span>
            </label>
          </div>
        `;
      })
      .join("");

    optionsList.querySelectorAll("input[type='radio']").forEach((input) => {
      input.addEventListener("change", () => {
        if (answerLocked) return;
        answers[question.id] = Number(input.value);
        saveExamState({ answers, currentIndex });
        renderQuestion();
        renderMap();
      });
    });

    document.getElementById("prevQuestionButton").disabled = answerLocked || currentIndex === 0;
    document.getElementById("nextQuestionButton").disabled = answerLocked || currentIndex === total - 1;
    document.getElementById("submitExamButton").disabled = answerLocked;
    renderMap();
  }

  async function sendEvent(eventType, meta = {}) {
    if (currentUiState === "blocked" || currentUiState === "terminated") {
      return;
    }

    try {
      const response = await api("/exam/log-event", {
        method: "POST",
        body: JSON.stringify({
          sessionId: state.sessionId,
          eventType,
          meta
        })
      });

      if (response.uiState) {
        applyProctorState(response);
      }
    } catch (error) {
      warningBanner.hidden = false;
      warningBanner.textContent = error.message;
    }
  }

  async function submitExam() {
    const result = await api("/exam/submit", {
      method: "POST",
      body: JSON.stringify({
        sessionId: state.sessionId,
        answers
      })
    });

    localStorage.setItem(storageKeys.latestResult, JSON.stringify(result));
    localStorage.removeItem(storageKeys.examSessionId);
    localStorage.removeItem(storageKeys.examData);
    localStorage.removeItem(storageKeys.answers);
    localStorage.removeItem(storageKeys.timerEndsAt);
    localStorage.removeItem(storageKeys.currentIndex);
    window.location.href = "/result.html";
  }

  document.getElementById("prevQuestionButton").addEventListener("click", () => {
    currentIndex = Math.max(0, currentIndex - 1);
    saveExamState({ answers, currentIndex });
    renderQuestion();
  });

  document.getElementById("nextQuestionButton").addEventListener("click", () => {
    currentIndex = Math.min(total - 1, currentIndex + 1);
    saveExamState({ answers, currentIndex });
    renderQuestion();
  });

  document.getElementById("submitExamButton").addEventListener("click", submitExam);

  async function sendChatMessage() {
    if (sendingChat) {
      return;
    }

    if (currentUiState === "blocked" || currentUiState === "terminated") {
      setMessage("chatMessage", "This session can no longer accept chat replies.");
      return;
    }

    const message = chatReasonInput.value.trim();
    if (!message) {
      setMessage("chatMessage", "Type a short reply so Proctorly AI can continue the review.");
      return;
    }

    pushLocalChatMessage("user", message);
    chatReasonInput.value = "";
    setMessage("chatMessage", "");
    setTypingState(true);
    setChatInputState(true, "Proctorly AI is reviewing your reply...");

    try {
      const review = await api("/exam/chat-reason", {
        method: "POST",
        body: JSON.stringify({
          sessionId: state.sessionId,
          message,
          messages: chatMessages.filter((item) => !item.loading)
        })
      });

      setTypingState(false);
      applyProctorState(review);

      if (review.awaitingUserReply) {
        setMessage("chatMessage", "Continue chatting with Proctorly AI to finish the review.");
      } else if (
        review.decision === "continue" ||
        review.decision === "continue_with_warning" ||
        review.decision === "final_warning"
      ) {
        setMessage("chatMessage", review.reasoning || review.note, "success");
        window.setTimeout(() => {
          if (currentUiState === "warning") {
            setChatOpen(false);
          }
        }, 900);
      } else if (review.decision === "block" || review.decision === "block_now" || review.decision === "terminate") {
        setMessage("chatMessage", review.reasoning || review.note);
      } else {
        setMessage("chatMessage", review.reasoning || review.note || "");
      }
    } catch (error) {
      setTypingState(false);
      renderChatMessages(chatMessages.filter((item) => !item.loading));
      setChatInputState(false);
      setMessage("chatMessage", error.message);
    }
  }

  sendReasonButton.addEventListener("click", sendChatMessage);

  chatReasonInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendChatMessage().catch((error) => {
        setMessage("chatMessage", error.message);
      });
    }
  });

  chatToggleButton.addEventListener("click", () => {
    setChatOpen(!chatOpen);
  });

  chatCloseButton.addEventListener("click", () => {
    setChatOpen(false);
  });

  document.getElementById("returnLoginButton").addEventListener("click", () => {
    clearAuth();
    window.location.href = "/login.html";
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      sendEvent("visibility-hidden");
    }
  });

  window.addEventListener("blur", () => sendEvent("blur"));
  document.addEventListener("copy", () => sendEvent("copy"));
  document.addEventListener("paste", () => sendEvent("paste"));

  const timerId = setInterval(() => {
    if (currentUiState === "terminated") {
      clearInterval(timerId);
      return;
    }

    const remaining = Math.max(0, state.timerEndsAt - Date.now());
    const minutes = String(Math.floor(remaining / 60000)).padStart(2, "0");
    const seconds = String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0");
    timerValue.textContent = `${minutes}:${seconds}`;

    if (remaining <= 0) {
      clearInterval(timerId);
      submitExam().catch((error) => {
        warningBanner.hidden = false;
        warningBanner.textContent = error.message;
      });
    }
  }, 1000);

  renderChatMessages(chatMessages);
  setChatOpen(false);
  setChatInputState(true, "Proctorly AI will ask for a reply if review is needed.");
  renderQuestion();
}

async function initResultPage() {
  const latestResult = JSON.parse(localStorage.getItem(storageKeys.latestResult) || "null");
  const historyData = await api("/results/me");
  const history = historyData.results || [];
  const result = latestResult || history[0];

  if (!result) {
    document.getElementById("resultExamTitle").textContent = "No results found";
    return;
  }

  document.getElementById("resultExamTitle").textContent = result.examTitle;
  document.getElementById("resultScore").textContent = `${Math.round(
    (result.score / result.totalMarks) * 100
  )}%`;
  document.getElementById("resultMarksText").textContent = `${result.score} / ${result.totalMarks}`;
  document.getElementById("resultDecision").textContent = formatDecision(result.finalDecision);
  document.getElementById("resultSummary").textContent = result.shortReasonSummary;
  document.getElementById("resultMetrics").innerHTML = `
    <div class="metric-item"><span>Correct Answers</span><strong>${result.correctCount}/${result.totalQuestions}</strong></div>
    <div class="metric-item"><span>Focus Loss Count</span><strong>${result.unfocusCount}</strong></div>
    <div class="metric-item"><span>Copy Attempts</span><strong>${result.copyCount}</strong></div>
    <div class="metric-item"><span>Paste Attempts</span><strong>${result.pasteCount}</strong></div>
    <div class="metric-item"><span>Trust Level</span><strong>${formatDecision(result.trustLevel || "uncertain")}</strong></div>
    <div class="metric-item"><span>Truth Score</span><strong>${result.truthScore ?? "--"}</strong></div>
  `;

  document.getElementById("resultsHistory").innerHTML = history
    .slice(0, 6)
    .map(
      (item) => `
        <div class="attempt-row">
          <div>
            <strong>${item.examTitle}</strong>
            <p class="muted">${formatDecision(item.finalDecision)}</p>
          </div>
          <div><strong>${item.score}/${item.totalMarks}</strong></div>
        </div>
      `
    )
    .join("");
}

async function initAdminPage() {
  const data = await api("/admin/results");
  const results = data.results || [];

  renderStats(document.getElementById("adminStats"), [
    { label: "Total Attempts", value: results.length, note: "All submissions in Firestore" },
    {
      label: "Flagged Attempts",
      value: results.filter((item) => String(item.finalDecision).includes("block")).length,
      note: "Blocked or heavily flagged sessions"
    },
    {
      label: "Average Score",
      value: results.length
        ? `${Math.round(results.reduce((sum, item) => sum + (item.score / item.totalMarks) * 100, 0) / results.length)}%`
        : "--",
      note: "Across all attempts"
    },
    {
      label: "Focus Loss Events",
      value: results.reduce((sum, item) => sum + (item.unfocusCount || 0), 0),
      note: "Summed across sessions"
    }
  ]);

  const body = document.getElementById("adminResultsBody");
  if (!results.length) {
    body.innerHTML = '<tr><td colspan="6" class="muted">No results found yet.</td></tr>';
  } else {
    body.innerHTML = results
      .map((item) => {
        const decisionClass = String(item.finalDecision).includes("block")
          ? "block"
          : String(item.finalDecision).includes("warning")
          ? "warn"
          : "safe";
        return `
          <tr>
            <td>${item.userName || item.userId}</td>
            <td>${item.examTitle}</td>
            <td>${item.score}/${item.totalMarks}</td>
            <td>${item.unfocusCount}</td>
            <td><span class="pill ${decisionClass}">${formatDecision(item.finalDecision)}</span></td>
            <td>${formatDate(item.submittedAt)}</td>
          </tr>
        `;
      })
      .join("");
  }

  const focusItem = results[0];
  document.getElementById("adminReviewCard").innerHTML = focusItem
    ? `
      <div class="attempt-row">
        <div>
          <strong>${focusItem.userName || focusItem.userId}</strong>
          <p class="muted">${focusItem.examTitle}</p>
        </div>
        <div><strong>${focusItem.unfocusCount} warnings</strong></div>
      </div>
      <div class="info-card subtle">
        <p class="info-title">Saved integrity note</p>
        <p>${focusItem.shortReasonSummary}</p>
      </div>
      <div class="metric-item"><span>Decision</span><strong>${formatDecision(focusItem.finalDecision)}</strong></div>
      <div class="metric-item"><span>Trust / Score</span><strong>${formatDecision(
        focusItem.trustLevel || "uncertain"
      )} / ${focusItem.truthScore ?? "--"}</strong></div>
      <div class="metric-item"><span>Copy / Paste</span><strong>${focusItem.copyCount} / ${focusItem.pasteCount}</strong></div>
    `
    : '<p class="muted">No review data available.</p>';
}

async function initPage() {
  const page = document.body.dataset.page;
  if (!page) return;
  if (redirectIfNeeded(page)) return;

  bindLogout();

  try {
    if (page === "login") await initLoginPage();
    if (page === "dashboard") await initDashboardPage();
    if (page === "test") await initTestPage();
    if (page === "result") await initResultPage();
    if (page === "admin") await initAdminPage();
  } catch (error) {
    const targetId = ["authMessage", "chatMessage", "warningBanner"].find((id) =>
      document.getElementById(id)
    );

    if (targetId === "warningBanner") {
      const banner = document.getElementById("warningBanner");
      banner.hidden = false;
      banner.textContent = error.message;
    } else if (targetId) {
      setMessage(targetId, error.message);
    } else {
      console.error(error);
    }
  }
}

document.addEventListener("DOMContentLoaded", initPage);
