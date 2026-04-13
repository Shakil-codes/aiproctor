# Proctorly

Proctorly is a minimal online MCQ exam platform built with HTML, CSS, vanilla JavaScript, Node.js, Express.js, bcrypt, JWT, and an AWS-ready backend. The existing UI stays unchanged while the backend can now run with local storage for development or AWS services in Learner Lab.

## What Changed

- Existing frontend routes and page flow remain unchanged
- Backend persistence now supports:
  - `local` provider for development
  - `aws` provider for DynamoDB-backed deployment
- Integrity-review AI now supports:
  - Amazon Bedrock as the preferred AWS option
  - OpenAI as an optional fallback
  - a built-in heuristic fallback when no model is configured
- Exam sessions can be stored in DynamoDB instead of process memory, which is better for cloud deployment

## AWS Academy Topic Coverage

This project can be used to demonstrate the main ideas from:

- `AWS Academy Cloud Foundations`
  - Compute: run the Express app on EC2 in Learner Lab
  - Networking: use a security group to allow HTTP access
  - IAM: use the Learner Lab role for DynamoDB and Bedrock access
  - Storage/database: use DynamoDB tables for app data and active exam sessions
- `AWS Academy Generative AI Foundations`
  - Use Amazon Bedrock to evaluate integrity-chat responses
  - Compare Bedrock AI evaluation with deterministic heuristic fallbacks
  - Keep prompts and outputs constrained to structured JSON
- `AWS Academy Machine Learning Foundations`
  - Treat the trust score and integrity decision as a simple applied inference workflow
  - Use saved result data for future analytics, classification tuning, and feature engineering ideas
  - Explain how rule-based features such as focus-loss count, copy/paste count, and response quality feed the decision
- `AWS Academy Learner Lab`
  - Provision DynamoDB tables
  - Run the app on an EC2 instance
  - Use the attached lab credentials and region
  - Seed the data and test the app end to end

## Backend Architecture

- `public/` remains the unchanged frontend
- `routes/` and `controllers/` still expose the same API contract
- `services/dataStore.js` abstracts persistence
- `services/sessionStore.js` uses the persistence layer for active exam sessions
- `services/openaiService.js` now supports Bedrock, OpenAI, or heuristic mode
- `scripts/aws-doctor.js`, `scripts/aws-bootstrap.js`, and `scripts/aws-full-setup.js` automate Learner Lab setup

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env`

3. For local development, use:

```env
DATA_PROVIDER=local
AI_PROVIDER=heuristic
```

4. For AWS Learner Lab, use:

```env
DATA_PROVIDER=aws
AWS_REGION=us-east-1
DYNAMODB_USERS_TABLE=proctorly-users
DYNAMODB_EXAMS_TABLE=proctorly-exams
DYNAMODB_QUESTIONS_TABLE=proctorly-questions
DYNAMODB_RESULTS_TABLE=proctorly-results
DYNAMODB_SESSIONS_TABLE=proctorly-sessions
AI_PROVIDER=bedrock
BEDROCK_MODEL_ID=anthropic.claude-3-haiku-20240307-v1:0
JWT_SECRET=replace-with-a-long-random-secret
JWT_EXPIRES_IN=8h
```

5. Seed demo data:

```bash
npm run seed
```

6. Start the app:

```bash
npm run dev
```

7. Open `http://localhost:3000`

## Automated Learner Lab Setup

After the Learner Lab role is attached and `.env` contains your AWS settings, run:

```bash
npm run aws:full
```

This does three things:

1. Verifies the attached AWS identity and region
2. Creates the DynamoDB tables and enables TTL on the sessions table
3. Seeds the demo users, exams, and questions

Then run:

```bash
npm start
```

## DynamoDB Tables

Create these tables in Learner Lab:

1. `proctorly-users`
   - Partition key: `id` (String)
2. `proctorly-exams`
   - Partition key: `id` (String)
3. `proctorly-questions`
   - Partition key: `id` (String)
4. `proctorly-results`
   - Partition key: `id` (String)
5. `proctorly-sessions`
   - Partition key: `sessionId` (String)
   - Enable TTL on attribute `ttl`

For this demo, scans are acceptable. If you want to optimize later, add GSIs for `email`, `userId`, and `examId`.

## Learner Lab Deployment Path

1. Launch an EC2 instance in Learner Lab
2. Attach or use the provided Lab role with access to:
   - DynamoDB
   - Bedrock model invocation
3. Install Node.js on the instance
4. Copy this project to the instance
5. Set `.env` with the AWS values above
6. Create the DynamoDB tables
7. Run:

```bash
npm install
npm run seed
npm start
```

8. Open the EC2 public IP on port `3000`, or place Nginx in front of it

## Demo Accounts

- Student: `student@proctorly.demo` / `student123`
- Admin: `admin@proctorly.demo` / `admin123`

## Notes

- Raw chatbot history is not stored in final exam results
- Final results save the score, warning counters, trust metrics, and a short integrity summary
- If Bedrock or OpenAI is unavailable, the app still works with the heuristic evaluator
- The UI was intentionally left unchanged; the backend was refactored underneath it
