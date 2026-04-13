const { getUserResults } = require("../services/examService");

async function getMyResults(req, res) {
  const results = await getUserResults(req.user.userId);
  return res.json({ results });
}

module.exports = {
  getMyResults
};
