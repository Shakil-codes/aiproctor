const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const {
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  ScanCommand
} = require("@aws-sdk/lib-dynamodb");
const { getDynamoDocumentClient } = require("../config/aws");

const LOCAL_DB_FILE = process.env.LOCAL_DB_FILE || path.join(__dirname, "..", "data", "local-db.json");
const TABLES = {
  users: process.env.DYNAMODB_USERS_TABLE || "proctorly-users",
  exams: process.env.DYNAMODB_EXAMS_TABLE || "proctorly-exams",
  questions: process.env.DYNAMODB_QUESTIONS_TABLE || "proctorly-questions",
  results: process.env.DYNAMODB_RESULTS_TABLE || "proctorly-results",
  sessions: process.env.DYNAMODB_SESSIONS_TABLE || "proctorly-sessions"
};

function nowIso() {
  return new Date().toISOString();
}

function generateId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function getProvider() {
  if (process.env.DATA_PROVIDER) {
    return process.env.DATA_PROVIDER;
  }

  return process.env.AWS_REGION ? "aws" : "local";
}

async function ensureLocalDb() {
  try {
    await fs.access(LOCAL_DB_FILE);
  } catch (_error) {
    await fs.mkdir(path.dirname(LOCAL_DB_FILE), { recursive: true });
    await fs.writeFile(
      LOCAL_DB_FILE,
      JSON.stringify(
        {
          users: [],
          exams: [],
          questions: [],
          results: [],
          sessions: []
        },
        null,
        2
      )
    );
  }
}

async function readLocalDb() {
  await ensureLocalDb();
  return JSON.parse(await fs.readFile(LOCAL_DB_FILE, "utf8"));
}

async function writeLocalDb(data) {
  await ensureLocalDb();
  await fs.writeFile(LOCAL_DB_FILE, JSON.stringify(data, null, 2));
}

async function scanAll(TableName, options = {}) {
  const client = getDynamoDocumentClient();
  if (!client) {
    throw new Error("AWS_REGION is required for DynamoDB access.");
  }

  const items = [];
  let ExclusiveStartKey;

  do {
    const response = await client.send(
      new ScanCommand({
        TableName,
        ExclusiveStartKey,
        ...options
      })
    );
    items.push(...(response.Items || []));
    ExclusiveStartKey = response.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return items;
}

async function batchDelete(TableName, items, keyName = "id") {
  const client = getDynamoDocumentClient();
  if (!items.length) {
    return;
  }

  for (let index = 0; index < items.length; index += 25) {
    const chunk = items.slice(index, index + 25);
    await client.send(
      new BatchWriteCommand({
        RequestItems: {
          [TableName]: chunk.map((item) => ({
            DeleteRequest: {
              Key: {
                [keyName]: item[keyName]
              }
            }
          }))
        }
      })
    );
  }
}

async function getUserById(id) {
  if (getProvider() === "local") {
    const db = await readLocalDb();
    return db.users.find((user) => user.id === id) || null;
  }

  const client = getDynamoDocumentClient();
  const response = await client.send(
    new GetCommand({
      TableName: TABLES.users,
      Key: { id }
    })
  );
  return response.Item || null;
}

async function findUserByEmail(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return null;

  if (getProvider() === "local") {
    const db = await readLocalDb();
    return db.users.find((user) => String(user.email || "").toLowerCase() === normalizedEmail) || null;
  }

  const users = await scanAll(TABLES.users, {
    FilterExpression: "email = :email",
    ExpressionAttributeValues: {
      ":email": normalizedEmail
    }
  });
  return users[0] || null;
}

async function createUser({ name, email, passwordHash, role = "student" }) {
  const item = {
    id: generateId("usr"),
    name,
    email: String(email).toLowerCase(),
    passwordHash,
    role,
    createdAt: nowIso()
  };

  if (getProvider() === "local") {
    const db = await readLocalDb();
    db.users.push(item);
    await writeLocalDb(db);
    return item;
  }

  const client = getDynamoDocumentClient();
  await client.send(
    new PutCommand({
      TableName: TABLES.users,
      Item: item
    })
  );
  return item;
}

async function listUsers() {
  if (getProvider() === "local") {
    const db = await readLocalDb();
    return db.users;
  }

  return scanAll(TABLES.users);
}

async function deleteUsersByIds(userIds = []) {
  const ids = new Set(userIds);
  if (!ids.size) return;

  if (getProvider() === "local") {
    const db = await readLocalDb();
    db.users = db.users.filter((user) => !ids.has(user.id));
    await writeLocalDb(db);
    return;
  }

  await batchDelete(
    TABLES.users,
    Array.from(ids).map((id) => ({ id }))
  );
}

async function getExamById(id) {
  if (getProvider() === "local") {
    const db = await readLocalDb();
    return db.exams.find((exam) => exam.id === id) || null;
  }

  const client = getDynamoDocumentClient();
  const response = await client.send(
    new GetCommand({
      TableName: TABLES.exams,
      Key: { id }
    })
  );
  return response.Item || null;
}

async function putExam(exam) {
  const item = {
    ...exam,
    createdAt: exam.createdAt || nowIso()
  };

  if (getProvider() === "local") {
    const db = await readLocalDb();
    const index = db.exams.findIndex((existing) => existing.id === item.id);
    if (index >= 0) db.exams[index] = item;
    else db.exams.push(item);
    await writeLocalDb(db);
    return item;
  }

  const client = getDynamoDocumentClient();
  await client.send(
    new PutCommand({
      TableName: TABLES.exams,
      Item: item
    })
  );
  return item;
}

async function listExams({ activeOnly = false } = {}) {
  let exams;
  if (getProvider() === "local") {
    const db = await readLocalDb();
    exams = db.exams;
  } else if (activeOnly) {
    exams = await scanAll(TABLES.exams, {
      FilterExpression: "active = :active",
      ExpressionAttributeValues: {
        ":active": true
      }
    });
  } else {
    exams = await scanAll(TABLES.exams);
  }

  return activeOnly ? exams.filter((exam) => exam.active === true) : exams;
}

async function putQuestion(question) {
  const item = {
    ...question
  };

  if (getProvider() === "local") {
    const db = await readLocalDb();
    const index = db.questions.findIndex((existing) => existing.id === item.id);
    if (index >= 0) db.questions[index] = item;
    else db.questions.push(item);
    await writeLocalDb(db);
    return item;
  }

  const client = getDynamoDocumentClient();
  await client.send(
    new PutCommand({
      TableName: TABLES.questions,
      Item: item
    })
  );
  return item;
}

async function listQuestionsByExamId(examId) {
  let questions;
  if (getProvider() === "local") {
    const db = await readLocalDb();
    questions = db.questions.filter((question) => question.examId === examId);
  } else {
    questions = await scanAll(TABLES.questions, {
      FilterExpression: "examId = :examId",
      ExpressionAttributeValues: {
        ":examId": examId
      }
    });
  }

  return questions.sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
}

async function saveResult(payload) {
  const item = {
    id: generateId("res"),
    ...payload,
    submittedAt: nowIso()
  };

  if (getProvider() === "local") {
    const db = await readLocalDb();
    db.results.push(item);
    await writeLocalDb(db);
    return item.id;
  }

  const client = getDynamoDocumentClient();
  await client.send(
    new PutCommand({
      TableName: TABLES.results,
      Item: item
    })
  );

  return item.id;
}

async function listResults({ userId } = {}) {
  let results;
  if (getProvider() === "local") {
    const db = await readLocalDb();
    results = userId ? db.results.filter((result) => result.userId === userId) : db.results;
  } else if (userId) {
    results = await scanAll(TABLES.results, {
      FilterExpression: "userId = :userId",
      ExpressionAttributeValues: {
        ":userId": userId
      }
    });
  } else {
    results = await scanAll(TABLES.results);
  }

  return results;
}

async function deleteResultsByUserIds(userIds = []) {
  const ids = new Set(userIds);
  if (!ids.size) return;

  if (getProvider() === "local") {
    const db = await readLocalDb();
    db.results = db.results.filter((result) => !ids.has(result.userId));
    await writeLocalDb(db);
    return;
  }

  const matchingResults = await scanAll(TABLES.results);
  await batchDelete(
    TABLES.results,
    matchingResults.filter((result) => ids.has(result.userId))
  );
}

async function createSession(session) {
  const item = {
    ...session,
    sessionId: session.sessionId || generateId("ses"),
    ttl: Math.floor(new Date(session.expiresAt).getTime() / 1000)
  };

  if (getProvider() === "local") {
    const db = await readLocalDb();
    db.sessions.push(item);
    await writeLocalDb(db);
    return item;
  }

  const client = getDynamoDocumentClient();
  await client.send(
    new PutCommand({
      TableName: TABLES.sessions,
      Item: item
    })
  );
  return item;
}

async function getSession(sessionId) {
  if (getProvider() === "local") {
    const db = await readLocalDb();
    return db.sessions.find((session) => session.sessionId === sessionId) || null;
  }

  const client = getDynamoDocumentClient();
  const response = await client.send(
    new GetCommand({
      TableName: TABLES.sessions,
      Key: { sessionId }
    })
  );

  return response.Item || null;
}

async function updateSession(sessionId, updater) {
  const current = await getSession(sessionId);
  if (!current) {
    return null;
  }

  updater(current);
  current.ttl = Math.floor(new Date(current.expiresAt).getTime() / 1000);

  if (getProvider() === "local") {
    const db = await readLocalDb();
    const index = db.sessions.findIndex((session) => session.sessionId === sessionId);
    if (index >= 0) {
      db.sessions[index] = current;
      await writeLocalDb(db);
    }
    return current;
  }

  const client = getDynamoDocumentClient();
  await client.send(
    new PutCommand({
      TableName: TABLES.sessions,
      Item: current
    })
  );

  return current;
}

async function deleteSession(sessionId) {
  if (getProvider() === "local") {
    const db = await readLocalDb();
    db.sessions = db.sessions.filter((session) => session.sessionId !== sessionId);
    await writeLocalDb(db);
    return;
  }

  const client = getDynamoDocumentClient();
  await client.send(
    new DeleteCommand({
      TableName: TABLES.sessions,
      Key: { sessionId }
    })
  );
}

async function deleteAllSessions() {
  if (getProvider() === "local") {
    const db = await readLocalDb();
    db.sessions = [];
    await writeLocalDb(db);
    return;
  }

  const sessions = await scanAll(TABLES.sessions);
  await batchDelete(TABLES.sessions, sessions, "sessionId");
}

module.exports = {
  createSession,
  createUser,
  deleteAllSessions,
  deleteResultsByUserIds,
  deleteSession,
  deleteUsersByIds,
  findUserByEmail,
  getExamById,
  getProvider,
  getSession,
  getUserById,
  listExams,
  listQuestionsByExamId,
  listResults,
  listUsers,
  putExam,
  putQuestion,
  saveResult,
  updateSession
};
