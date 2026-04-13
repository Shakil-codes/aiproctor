const path = require("path");
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const { getProvider } = require("./services/dataStore");
const { getAiProvider } = require("./services/openaiService");
const authRoutes = require("./routes/authRoutes");
const examRoutes = require("./routes/examRoutes");
const resultRoutes = require("./routes/resultRoutes");
const adminRoutes = require("./routes/adminRoutes");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "Proctorly",
    persistence: getProvider(),
    aiProvider: getAiProvider()
  });
});

app.use("/auth", authRoutes);
app.use("/", examRoutes);
app.use("/", resultRoutes);
app.use("/", adminRoutes);

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({
    message: err.message || "Something went wrong.",
  });
});

app.listen(PORT, () => {
  console.log(`Proctorly server running on http://localhost:${PORT}`);
});
