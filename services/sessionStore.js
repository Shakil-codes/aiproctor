const crypto = require("crypto");
const {
  createSession: persistSession,
  deleteAllSessions,
  deleteSession,
  getSession: loadSession,
  updateSession: mutateSession
} = require("./dataStore");

function generateSessionId() {
  return `fg_${crypto.randomBytes(12).toString("hex")}`;
}

async function createSession({ userId, examId, examTitle, durationMinutes }) {
  return persistSession({
    sessionId: generateSessionId(),
    userId,
    examId,
    examTitle,
    startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + durationMinutes * 60 * 1000).toISOString(),
    warnings: [],
    chatMessages: [
      {
        role: "assistant",
        text: "I am Proctorly AI. I will stay here during the exam and only step in if I detect repeated integrity risks.",
        createdAt: new Date().toISOString()
      }
    ],
    chatbotReasons: [],
    aiNotes: [],
    counts: {
      unfocus: 0,
      visibility: 0,
      copy: 0,
      paste: 0
    },
    warningLevel: 0,
    uiState: "normal",
    interventionOpen: false,
    answerLocked: false,
    finalDecision: "continue",
    decisionHistory: [],
    lastAiLevelNotified: 0,
    trustLevel: "uncertain",
    truthScore: 50,
    studentSummary: "",
    investigation: {
      active: false,
      reason: "",
      weakReplyCount: 0,
      turns: 0,
      lastAssessment: "uncertain",
      followUpQuestions: [],
      followUpAnswers: []
    }
  });
}

async function getSession(sessionId) {
  return loadSession(sessionId);
}

async function updateSession(sessionId, updater) {
  return mutateSession(sessionId, updater);
}

async function clearSession(sessionId) {
  return deleteSession(sessionId);
}

async function clearAllSessions() {
  return deleteAllSessions();
}

function buildSummary(session) {
  const explanationCount = session.chatbotReasons.length;
  const categories = session.chatbotReasons.map((item) => item.category);
  const genuineCount = categories.filter((item) => item === "genuine").length;
  const suspiciousCount = categories.filter((item) => item === "suspicious").length;

  let tone = "mixed";
  if (genuineCount && suspiciousCount === 0) {
    tone = "mostly genuine";
  } else if (suspiciousCount && genuineCount === 0) {
    tone = "mostly suspicious";
  }

  return `User lost focus ${session.counts.unfocus + session.counts.visibility} times, copied ${session.counts.copy} times, pasted ${session.counts.paste} times, reached warning level ${session.warningLevel}, gave ${explanationCount} explanation(s) categorized as ${tone}, ended with trust level ${session.trustLevel} and truth score ${session.truthScore}, and finished with decision "${session.finalDecision}".`;
}

module.exports = {
  createSession,
  getSession,
  updateSession,
  clearSession,
  clearAllSessions,
  buildSummary
};
