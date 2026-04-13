require("dotenv").config();

const { STSClient, GetCallerIdentityCommand } = require("@aws-sdk/client-sts");
const { DynamoDBClient, ListTablesCommand } = require("@aws-sdk/client-dynamodb");

async function main() {
  const region = process.env.AWS_REGION;

  if (!region) {
    throw new Error("AWS_REGION is missing in .env. Set it before running aws:doctor.");
  }

  const sts = new STSClient({ region });
  const dynamo = new DynamoDBClient({ region });

  const identity = await sts.send(new GetCallerIdentityCommand({}));
  const tables = await dynamo.send(new ListTablesCommand({ Limit: 20 }));

  console.log("AWS identity check passed.");
  console.log(`Account: ${identity.Account}`);
  console.log(`ARN: ${identity.Arn}`);
  console.log(`Region: ${region}`);
  console.log(`Visible DynamoDB tables: ${(tables.TableNames || []).join(", ") || "none"}`);
}

main().catch((error) => {
  console.error("AWS doctor failed.");
  console.error(error.message);
  process.exit(1);
});
