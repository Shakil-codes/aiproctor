require("dotenv").config();

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const {
  createUser,
  findUserByEmail,
  getProvider,
  getExamById,
  putExam,
  putQuestion
} = require("../services/dataStore");

async function seed() {
  const samplePath = path.join(__dirname, "..", "data", "sample-data.json");
  const data = JSON.parse(fs.readFileSync(samplePath, "utf8"));

  for (const user of data.users) {
    const existing = await findUserByEmail(user.email);

    if (!existing) {
      await createUser({
        name: user.name,
        email: user.email,
        passwordHash: await bcrypt.hash(user.password, 10),
        role: user.role
      });
    }
  }

  const existingExam = await getExamById(data.exam.id);

  if (!existingExam) {
    await putExam({
      id: data.exam.id,
      title: data.exam.title,
      description: data.exam.description,
      durationMinutes: data.exam.durationMinutes,
      totalMarks: data.exam.totalMarks,
      active: data.exam.active,
      createdAt: new Date().toISOString()
    });
  }

  for (const question of data.questions) {
    await putQuestion({
      id: question.id,
      examId: data.exam.id,
      order: question.order,
      prompt: question.prompt,
      options: question.options,
      correctAnswerIndex: question.correctAnswerIndex,
      marks: question.marks
    });
  }

  console.log(`Seed data added using the ${getProvider()} backend.`);
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
