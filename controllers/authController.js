const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const {
  createUser,
  deleteResultsByUserIds,
  deleteUsersByIds,
  findUserByEmail,
  listUsers
} = require("../services/dataStore");
const { clearAllSessions } = require("../services/sessionStore");

function issueToken(userId, role) {
  return jwt.sign({ userId, role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "8h"
  });
}

async function signup(req, res) {
  const { name, email, password, role = "student" } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: "Name, email, and password are required." });
  }

  const existingUser = await findUserByEmail(email);
  if (existingUser) {
    return res.status(409).json({ message: "Email is already registered." });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await createUser({
    name,
    email,
    passwordHash,
    role
  });
  const token = issueToken(user.id, role);

  return res.status(201).json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    }
  });
}

async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required." });
  }

  const user = await findUserByEmail(email);
  if (!user) {
    return res.status(401).json({ message: "Invalid email or password." });
  }

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    return res.status(401).json({ message: "Invalid email or password." });
  }

  const token = issueToken(user.id, user.role);

  return res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    }
  });
}

async function ensureDemoUser(role) {
  const demoUsers = {
    student: {
      name: "Demo Student",
      email: "student@proctorly.demo",
      password: "student123",
      role: "student"
    },
    admin: {
      name: "Demo Admin",
      email: "admin@proctorly.demo",
      password: "admin123",
      role: "admin"
    }
  };

  const demoUser = demoUsers[role] || demoUsers.student;
  const existingUser = await findUserByEmail(demoUser.email);

  if (existingUser) {
    return {
      ...existingUser,
      plainPassword: demoUser.password
    };
  }

  const passwordHash = await bcrypt.hash(demoUser.password, 10);
  const user = await createUser({
    name: demoUser.name,
    email: demoUser.email,
    passwordHash,
    role: demoUser.role
  });

  return {
    ...user,
    plainPassword: demoUser.password
  };
}

async function demoLogin(req, res) {
  const { role = "student" } = req.body;
  const demoUser = await ensureDemoUser(role);
  const token = issueToken(demoUser.id, demoUser.role);

  return res.json({
    token,
    user: {
      id: demoUser.id,
      name: demoUser.name,
      email: demoUser.email,
      role: demoUser.role
    },
    demoCredentials: {
      email: demoUser.email,
      password: demoUser.plainPassword
    }
  });
}

async function resetDemoData(_req, res) {
  const demoEmails = new Set([
    "student@proctorly.demo",
    "admin@proctorly.demo",
    "student@focusguard.demo",
    "admin@focusguard.demo"
  ]);
  const demoNames = new Set(["Demo Student", "Demo Admin"]);
  const users = await listUsers();
  const demoUsers = users.filter(
    (user) =>
      demoEmails.has(String(user.email || "").toLowerCase()) || demoNames.has(String(user.name || ""))
  );
  const demoUserIds = demoUsers.map((user) => user.id);

  await deleteResultsByUserIds(demoUserIds);
  await deleteUsersByIds(demoUserIds);
  await clearAllSessions();

  return res.json({
    message: "Legacy and current demo users, results, and active sessions were reset."
  });
}

module.exports = {
  signup,
  login,
  demoLogin,
  ensureDemoUser,
  resetDemoData
};
