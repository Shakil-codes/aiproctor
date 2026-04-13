const {
  getExamById,
  listExams,
  listQuestionsByExamId,
  listResults,
  saveResult: persistResult
} = require("./dataStore");

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value._seconds) return value._seconds * 1000;
  return new Date(value).getTime() || 0;
}

async function getExamWithQuestions(examId) {
  const exam = await getExamById(examId);
  if (!exam) {
    return null;
  }

  const questions = await listQuestionsByExamId(examId);

  return {
    ...exam,
    questions
  };
}

async function getAvailableExams() {
  return (await listExams({ activeOnly: true })).sort(
    (a, b) => toMillis(b.createdAt) - toMillis(a.createdAt)
  );
}

async function getUserResults(userId) {
  return (await listResults({ userId })).sort(
    (a, b) => toMillis(b.submittedAt) - toMillis(a.submittedAt)
  );
}

async function saveResult(payload) {
  return persistResult(payload);
}

module.exports = {
  getExamWithQuestions,
  getAvailableExams,
  getUserResults,
  saveResult
};
