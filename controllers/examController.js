const {
  getAiProvider,
  isAiConfigured,
  generateNextIntegrityReply,
  evaluateIntegrityDecision
} = require("../services/openaiService");
const {
  createSession,
  getSession,
  updateSession,
  clearSession,
  buildSummary
} = require("../services/sessionStore");
const {
  getExamWithQuestions,
  getAvailableExams,
  getUserResults,
  saveResult
} = require("../services/examService");

function sanitizeExam(exam) {
  return {
    ...exam,
    questions: exam.questions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      options: question.options,
      order: question.order
    }))
  };
}

function pushChatMessage(session, role, text) {
  session.chatMessages.push({
    role,
    text,
    createdAt: new Date().toISOString()
  });
}

function getFocusLossCount(session) {
  return session.counts.unfocus + session.counts.visibility;
}

function deriveWarningLevel(session) {
  const focusLoss = getFocusLossCount(session);
  const intrusiveActions = session.counts.copy + session.counts.paste;

  if (session.uiState === "terminated") return 5;
  if (session.uiState === "blocked") return 4;
  if (focusLoss >= 3 || intrusiveActions >= 1) return 3;
  if (focusLoss >= 2) return 2;
  if (focusLoss >= 1) return 1;
  return 0;
}

function buildLevelMessage(level) {
  const messages = {
    1: {
      title: "Level 1 warning",
      message: "Focus was lost once. Please stay inside the test window."
    },
    2: {
      title: "Level 2 warning",
      message: "Second warning recorded. Further violations will trigger a strict investigation."
    },
    3: {
      title: "Level 3 review",
      message: "Integrity review is active. Please continue in the Proctorly AI chat."
    },
    4: {
      title: "Level 4 blocked",
      message: "The test is blocked. Access was not restored by the integrity review."
    },
    5: {
      title: "Level 5 session terminated",
      message: "You have been logged out of this assessment due to repeated suspicious activity."
    }
  };

  return messages[level] || { title: "Monitoring active", message: "Exam monitoring is active." };
}

function buildStatusResponse(session) {
  const levelInfo = buildLevelMessage(session.warningLevel);
  return {
    warningLevel: session.warningLevel,
    uiState: session.uiState,
    answerLocked: session.answerLocked,
    finalDecision: session.finalDecision,
    trustLevel: session.trustLevel,
    truthScore: session.truthScore,
    studentSummary: session.studentSummary,
    warningTitle: levelInfo.title,
    warningMessage: levelInfo.message,
    inlineWarning:
      session.warningLevel >= 2 && session.uiState !== "blocked" && session.uiState !== "terminated"
        ? levelInfo.message
        : "",
    focusLossCount: getFocusLossCount(session),
    chatMessages: session.chatMessages,
    aiEnabled: isAiConfigured(),
    aiProvider: getAiProvider()
  };
}

function buildConversationContext(session, extraMessages = []) {
  return {
    session,
    messages: [...session.chatMessages, ...extraMessages]
  };
}

function applyLiveDecision(draft, decision) {
  if (decision === "continue") {
    draft.interventionOpen = false;
    draft.answerLocked = false;
    draft.uiState = "warning";
    draft.finalDecision = "continue";
    return;
  }

  if (decision === "continue_with_warning") {
    draft.interventionOpen = false;
    draft.answerLocked = false;
    draft.uiState = "warning";
    draft.finalDecision = "continue_with_warning";
    return;
  }

  if (decision === "final_warning") {
    draft.interventionOpen = false;
    draft.answerLocked = false;
    draft.uiState = "warning";
    draft.finalDecision = "final_warning";
    return;
  }

  draft.interventionOpen = true;
  draft.answerLocked = true;
  draft.uiState = "blocked";
  draft.warningLevel = Math.max(draft.warningLevel, 4);
  draft.finalDecision = "block_now";
}

async function getExams(req, res) {
  const exams = await getAvailableExams();
  const previousAttempts = await getUserResults(req.user.userId);

  return res.json({
    exams,
    previousAttempts
  });
}

async function startExam(req, res) {
  const { examId } = req.body;

  if (!examId) {
    return res.status(400).json({ message: "examId is required." });
  }

  const exam = await getExamWithQuestions(examId);

  if (!exam || !exam.active) {
    return res.status(404).json({ message: "Exam not found." });
  }

  const session = await createSession({
    userId: req.user.userId,
    examId: exam.id,
    examTitle: exam.title,
    durationMinutes: exam.durationMinutes
  });

  return res.status(201).json({
    sessionId: session.sessionId,
    exam: sanitizeExam(exam),
    ...buildStatusResponse(session)
  });
}

async function logEvent(req, res) {
  const { sessionId, eventType, meta = {} } = req.body;
  const session = await getSession(sessionId);

  if (!session || session.userId !== req.user.userId) {
    return res.status(404).json({ message: "Exam session not found." });
  }

  if (Date.now() > new Date(session.expiresAt).getTime()) {
    await clearSession(sessionId);
    return res.status(410).json({ message: "Exam session expired." });
  }

  const suspiciousFocusEvents = ["blur", "visibility-hidden"];
  const counterMap = {
    blur: "unfocus",
    "visibility-hidden": "visibility",
    copy: "copy",
    paste: "paste"
  };

  const updated = await updateSession(sessionId, (draft) => {
    const key = counterMap[eventType];
    if (key) {
      draft.counts[key] += 1;
    }

    draft.warnings.push({
      eventType,
      meta,
      createdAt: new Date().toISOString()
    });

    if (draft.uiState === "blocked" && ["blur", "visibility-hidden", "copy", "paste"].includes(eventType)) {
      draft.uiState = "terminated";
      draft.warningLevel = 5;
      draft.answerLocked = true;
      draft.interventionOpen = true;
      draft.finalDecision = "terminated";
      pushChatMessage(
        draft,
        "assistant",
        "The session received another high-risk event while already blocked, so I have terminated this assessment."
      );
      return;
    }

    const focusLossCount = getFocusLossCount(draft);
    const intrusiveActions = draft.counts.copy + draft.counts.paste;

    if (focusLossCount >= 5 || intrusiveActions >= 3) {
      draft.uiState = "blocked";
      draft.warningLevel = 4;
      draft.answerLocked = true;
      draft.interventionOpen = true;
      draft.finalDecision = "block_now";
      pushChatMessage(
        draft,
        "assistant",
        "I have blocked this test because the warning pattern crossed the allowed limit."
      );
      return;
    }

    draft.warningLevel = deriveWarningLevel(draft);

    if (draft.warningLevel >= 3) {
      draft.uiState = "investigation";
      draft.interventionOpen = true;
      draft.answerLocked = false;
      draft.finalDecision = "under_investigation";
    } else if (draft.warningLevel >= 1) {
      draft.uiState = "warning";
      draft.answerLocked = false;
      draft.interventionOpen = false;
    }

    if (draft.warningLevel === 2 && draft.warningLevel > draft.lastAiLevelNotified) {
      pushChatMessage(
        draft,
        "assistant",
        buildLevelMessage(draft.warningLevel).message
      );
      draft.lastAiLevelNotified = draft.warningLevel;
    }
  });

  if (updated.warningLevel >= 3 && suspiciousFocusEvents.includes(eventType) && !updated.investigation.active) {
    const nextReply = await generateNextIntegrityReply(buildConversationContext(updated));
    await updateSession(sessionId, (draft) => {
      draft.investigation.active = true;
      draft.investigation.reason = "";
      draft.investigation.followUpQuestions = [];
      draft.investigation.followUpAnswers = [];
      draft.investigation.turns = 0;
      draft.investigation.weakReplyCount = 0;
      draft.investigation.lastAssessment = nextReply.interim_assessment || "uncertain";
      pushChatMessage(
        draft,
        "assistant",
        nextReply.assistant_message ||
          "We noticed repeated focus loss during your test. Please explain what happened."
      );
    });
  }

  return res.json({
    warningCounts: updated.counts,
    intervention: updated.interventionOpen,
    ...buildStatusResponse(await getSession(sessionId))
  });
}

async function chatReason(req, res) {
  const { sessionId, reason, message, messages = [] } = req.body;
  const session = await getSession(sessionId);
  const incomingMessage = String(message || reason || "").trim();
  const normalizedMessages = Array.isArray(messages)
    ? messages
        .filter((item) => item && item.role && item.text)
        .map((item) => ({ role: item.role, text: String(item.text) }))
    : [];

  if (!session || session.userId !== req.user.userId) {
    return res.status(404).json({ message: "Exam session not found." });
  }

  if (session.uiState === "blocked") {
    return res.json({
      classification: session.trustLevel,
      trustLevel: session.trustLevel,
      truthScore: session.truthScore,
      decision: "block_now",
      reasoning: "Access has already been denied for this exam session.",
      studentSummary: session.studentSummary,
      note: "Access has already been denied for this exam session.",
      assistantMessage: "Access cannot be restored for this session.",
      requiresFollowUp: false,
      awaitingUserReply: false,
      ...buildStatusResponse(session)
    });
  }

  if (session.uiState === "terminated") {
    return res.json({
      ...buildStatusResponse(session),
      decision: "terminate",
      note: "This exam session has already been terminated.",
      assistantMessage: "This assessment is already terminated and can no longer continue."
    });
  }

  if (!incomingMessage) {
    return res.status(400).json({ message: "Please send a reply in the chat." });
  }

  if (!session.investigation.active && session.warningLevel < 3) {
    return res.status(409).json({ message: "No active integrity review is open for this session." });
  }

  const lastProvidedMessage = normalizedMessages[normalizedMessages.length - 1];
  const conversation = normalizedMessages.length
    ? lastProvidedMessage &&
      lastProvidedMessage.role === "user" &&
      lastProvidedMessage.text === incomingMessage
      ? normalizedMessages
      : [...normalizedMessages, { role: "user", text: incomingMessage }]
    : [...session.chatMessages, { role: "user", text: incomingMessage }];
  const context = {
    session,
    messages: conversation
  };
  const assessment = await evaluateIntegrityDecision(context);
  const nextReply = await generateNextIntegrityReply({
    ...context,
    assessment
  });
  const closeReview = assessment.decision === "block_now" || !nextReply.should_continue_chat;

  const updated = await updateSession(sessionId, (draft) => {
    pushChatMessage(draft, "user", incomingMessage);
    draft.trustLevel = assessment.trustLevel;
    draft.truthScore = assessment.truthScore;
    draft.studentSummary = assessment.studentSummary;
    draft.chatbotReasons.push({
      reason: incomingMessage,
      category: assessment.trustLevel,
      decision: assessment.decision,
      createdAt: new Date().toISOString()
    });
    draft.aiNotes.push(assessment.reasoning);
    draft.decisionHistory.push(assessment.decision);
    draft.investigation.turns += 1;
    draft.investigation.reason = draft.investigation.reason || incomingMessage;
    draft.investigation.followUpAnswers.push(incomingMessage);
    draft.investigation.lastAssessment = nextReply.interim_assessment || assessment.trustLevel;

    if (assessment.trustLevel === "evasive" || assessment.trustLevel === "suspicious") {
      draft.investigation.weakReplyCount += 1;
    } else {
      draft.investigation.weakReplyCount = 0;
    }

    pushChatMessage(
      draft,
      "assistant",
      nextReply.assistant_message || "Please continue with a clearer explanation."
    );

    if (closeReview) {
      draft.investigation.active = false;
      applyLiveDecision(draft, assessment.decision);
    } else {
      draft.interventionOpen = true;
      draft.answerLocked = false;
      draft.uiState = "investigation";
      draft.warningLevel = Math.max(draft.warningLevel, 3);
      draft.finalDecision = "under_investigation";
    }
  });

  return res.json({
    classification: assessment.trustLevel,
    category: assessment.trustLevel,
    trustLevel: assessment.trustLevel,
    truthScore: assessment.truthScore,
    decision: assessment.decision,
    reasoning: assessment.reasoning,
    studentSummary: assessment.studentSummary,
    note: assessment.reasoning,
    assistantMessage: nextReply.assistant_message,
    requiresFollowUp: !closeReview,
    awaitingUserReply: !closeReview,
    ...buildStatusResponse(updated)
  });
}

async function submitExam(req, res) {
  const { sessionId, answers = {} } = req.body;
  const session = await getSession(sessionId);

  if (!session || session.userId !== req.user.userId) {
    return res.status(404).json({ message: "Exam session not found." });
  }

  const exam = await getExamWithQuestions(session.examId);
  if (!exam) {
    return res.status(404).json({ message: "Exam not found." });
  }

  let score = 0;
  let correctCount = 0;

  exam.questions.forEach((question) => {
    if (Number(answers[question.id]) === Number(question.correctAnswerIndex)) {
      score += Number(question.marks || 1);
      correctCount += 1;
    }
  });

  const finalDecision = session.finalDecision;
  const shortReasonSummary = buildSummary(session);

  const resultId = await saveResult({
    userId: req.user.userId,
    userName: req.user.name,
    examId: exam.id,
    examTitle: exam.title,
    score,
    totalMarks: exam.totalMarks,
    totalQuestions: exam.questions.length,
    correctCount,
    unfocusCount: session.counts.unfocus + session.counts.visibility,
    copyCount: session.counts.copy,
    pasteCount: session.counts.paste,
    warningLevel: session.warningLevel,
    finalDecision,
    trustLevel: session.trustLevel,
    truthScore: session.truthScore,
    studentSummary: session.studentSummary,
    shortReasonSummary,
    warningEvents: session.warnings.length
  });

  await clearSession(sessionId);

  return res.json({
    resultId,
    examTitle: exam.title,
    score,
    totalMarks: exam.totalMarks,
    correctCount,
    totalQuestions: exam.questions.length,
    unfocusCount: session.counts.unfocus + session.counts.visibility,
    copyCount: session.counts.copy,
    pasteCount: session.counts.paste,
    finalDecision,
    trustLevel: session.trustLevel,
    truthScore: session.truthScore,
    shortReasonSummary,
    submittedAt: new Date().toISOString()
  });
}

module.exports = {
  getExams,
  startExam,
  logEvent,
  chatReason,
  submitExam
};
