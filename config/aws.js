const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient } = require("@aws-sdk/lib-dynamodb");
const { BedrockRuntimeClient } = require("@aws-sdk/client-bedrock-runtime");

let dynamoDocumentClient;
let bedrockRuntimeClient;

function hasAwsRegion() {
  return Boolean(process.env.AWS_REGION);
}

function getDynamoDocumentClient() {
  if (!hasAwsRegion()) {
    return null;
  }

  if (!dynamoDocumentClient) {
    const client = new DynamoDBClient({
      region: process.env.AWS_REGION
    });

    dynamoDocumentClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: {
        removeUndefinedValues: true
      }
    });
  }

  return dynamoDocumentClient;
}

function getBedrockRuntimeClient() {
  if (!hasAwsRegion()) {
    return null;
  }

  if (!bedrockRuntimeClient) {
    bedrockRuntimeClient = new BedrockRuntimeClient({
      region: process.env.AWS_REGION
    });
  }

  return bedrockRuntimeClient;
}

module.exports = {
  getBedrockRuntimeClient,
  getDynamoDocumentClient
};
