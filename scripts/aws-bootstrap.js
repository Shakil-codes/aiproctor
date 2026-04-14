require("dotenv").config();

const {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
  UpdateTimeToLiveCommand
} = require("@aws-sdk/client-dynamodb");

const region = process.env.AWS_REGION;

const tables = [
  { name: process.env.DYNAMODB_USERS_TABLE || "proctorly-users", keyName: "id" },
  { name: process.env.DYNAMODB_EXAMS_TABLE || "proctorly-exams", keyName: "id" },
  { name: process.env.DYNAMODB_QUESTIONS_TABLE || "proctorly-questions", keyName: "id" },
  { name: process.env.DYNAMODB_RESULTS_TABLE || "proctorly-results", keyName: "id" },
  {
    name: process.env.DYNAMODB_SESSIONS_TABLE || "proctorly-sessions",
    keyName: "sessionId",
    enableTtl: true
  }
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function describeTable(client, tableName) {
  try {
    const result = await client.send(new DescribeTableCommand({ TableName: tableName }));
    return result.Table || null;
  } catch (error) {
    if (error.name === "ResourceNotFoundException") {
      return null;
    }

    throw error;
  }
}

async function waitForTable(client, tableName) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const table = await describeTable(client, tableName);
    if (table && table.TableStatus === "ACTIVE") {
      return;
    }

    await sleep(2000);
  }

  throw new Error(`Timed out waiting for ${tableName} to become ACTIVE.`);
}

async function ensureTable(client, table) {
  const existing = await describeTable(client, table.name);
  if (existing) {
    console.log(`Table already exists: ${table.name}`);
    return;
  }

  await client.send(
    new CreateTableCommand({
      TableName: table.name,
      AttributeDefinitions: [
        {
          AttributeName: table.keyName,
          AttributeType: "S"
        }
      ],
      KeySchema: [
        {
          AttributeName: table.keyName,
          KeyType: "HASH"
        }
      ],
      BillingMode: "PAY_PER_REQUEST"
    })
  );

  console.log(`Creating table: ${table.name}`);
  await waitForTable(client, table.name);
}

async function enableTtl(client, tableName) {
  try {
    await client.send(
      new UpdateTimeToLiveCommand({
        TableName: tableName,
        TimeToLiveSpecification: {
          AttributeName: "ttl",
          Enabled: true
        }
      })
    );
  } catch (error) {
    if (error.name === "ValidationException" && /TimeToLive.*already enabled/i.test(error.message)) {
      console.log(`TTL already enabled on ${tableName}.`);
      return;
    }

    throw error;
  }

  console.log(`TTL enabled on ${tableName}.`);
}

async function main() {
  if (!region) {
    throw new Error("AWS_REGION is missing in .env.");
  }

  const client = new DynamoDBClient({ region });

  for (const table of tables) {
    await ensureTable(client, table);
  }

  const sessionTable = tables.find((table) => table.enableTtl);
  if (sessionTable) {
    await enableTtl(client, sessionTable.name);
  }

  console.log("AWS bootstrap completed.");
}

main().catch((error) => {
  console.error("AWS bootstrap failed.");
  console.error(error.message);
  process.exit(1);
});
