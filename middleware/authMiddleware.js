const jwt = require("jsonwebtoken");
const { getUserById } = require("../services/dataStore");

async function verifyToken(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: "Authentication token missing." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await getUserById(decoded.userId);

    if (!user) {
      return res.status(401).json({ message: "User not found." });
    }

    req.user = {
      userId: decoded.userId,
      role: decoded.role,
      ...user
    };

    return next();
  } catch (_error) {
    return res.status(401).json({ message: "Invalid or expired token." });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ message: "Admin access required." });
  }

  return next();
}

module.exports = {
  verifyToken,
  requireAdmin
};
