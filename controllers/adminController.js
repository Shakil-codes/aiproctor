const { listResults } = require("../services/dataStore");

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value._seconds) return value._seconds * 1000;
  return new Date(value).getTime() || 0;
}

async function getAdminResults(_req, res) {
  const results = (await listResults()).sort(
    (a, b) => toMillis(b.submittedAt) - toMillis(a.submittedAt)
  );

  return res.json({ results });
}

module.exports = {
  getAdminResults
};
