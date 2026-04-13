require("dotenv").config();

const { spawnSync } = require("child_process");
const path = require("path");

const projectRoot = path.join(__dirname, "..");

function runStep(label, command, args) {
  console.log(`\n== ${label} ==`);

  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
    shell: process.platform === "win32"
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

runStep("Check AWS access", "node", ["scripts/aws-doctor.js"]);
runStep("Bootstrap DynamoDB", "node", ["scripts/aws-bootstrap.js"]);
runStep("Seed application data", "node", ["scripts/seed.js"]);

console.log("\nAWS Learner Lab setup finished. Run npm start to launch the app.");
