const {
  ConverseCommand
} = require("@aws-sdk/client-bedrock-runtime");
const { getBedrockRuntimeClient } = require("../config/aws");

const fetchFn =
  typeof fetch === "function"
    ? fetch
    : (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

const DEFAULT_OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const DEFAULT_BEDROCK_MODEL = process.env.BEDROCK_MODEL_ID || "anthropic.claude-3-haiku-20240307-v1:0";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getAiProvider() {
  if (process.env.AI_PROVIDER) {
    return process.env.AI_PROVIDER;
  }

  if (process.env.BEDROCK_MODEL_ID && process.env.AWS_REGION) {
    return "bedrock";
  }

  if (process.env.OPENAI_API_KEY) {
    return "openai";
  }

  return "heuristic";
}

function isAiConfigured() {
  return getAiProvider() !== "heuristic";
}

function formatConversation(messages = []) {
  return messages
    .filter((item) => item && item.role && item.text)
    .map((item) => `${item.role === "user" ? "Student" : "Assistant"}: ${item.text}`)
    .join("\n");
}

function studentMessages(messages = []) {
  return messages
    .filter((item) => item && item.role === "user" && item.text)
    .map((item) => String(item.text).trim());
}

function weakReply(text = "") {
  const value = String(text).trim().toLowerCase();
  if (!value || value.length <= 3) return true;

  return [
    "why",
    "what",
    "idk",
    "i dont know",
    "don't know",
    "nothing",
    "just like that",
    "leave it",
    "bro",
    "ok",
    "okay",
    "hmm",
    "k",
    "no",
    "yes",
    "whatever"
  ].includes(value);
}

function rudeReply(text = "") {
  const value = String(text).toLowerCase();
  return ["bro", "shut up", "leave it", "none of your business", "whatever"].some((item) =>
    value.includes(item)
  );
}

function suspiciousSignal(text = "") {
  const value = String(text).toLowerCase();
  return [
    "chatgpt",
    "google",
    "friend",
    "phone",
    "whatsapp",
    "notes",
    "answer",
    "looked up",
    "search"
  ].some((item) => value.includes(item));
}

function genuineSignal(text = "") {
  const value = String(text).toLowerCase();
  return [
    "internet",
    "network",
    "wifi",
    "connection",
    "notification",
    "popup",
    "accident",
    "mistake",
    "system",
    "laptop",
    "mouse",
    "reconnect",
    "power"
  ].some((item) => value.includes(item));
}

function hasDurationDetail(text = "") {
  const value = String(text).toLowerCase();
  return (
    /\b\d+\s?(sec|secs|second|seconds|min|mins|minute|minutes)\b/.test(value) ||
    value.includes("moment") ||
    value.includes("briefly")
  );
}

function hasPreventiveIntent(text = "") {
  const value = String(text).toLowerCase();
  return [
    "i will",
    "stay",
    "avoid",
    "continue fairly",
    "ignore notifications",
    "keep the exam tab",
    "only on the exam",
    "won't switch"
  ].some((item) => value.includes(item));
}

function buildMetadata(session) {
  return {
    warningLevel: session.warningLevel,
    unfocusCount: session.counts.unfocus,
    visibilityCount: session.counts.visibility,
    focusLossCount: session.counts.unfocus + session.counts.visibility,
    copyCount: session.counts.copy,
    pasteCount: session.counts.paste,
    warningCount: session.warnings.length
  };
}

function summarizeStudentClaim(messages = []) {
  const text = studentMessages(messages).join(" ").trim();
  if (!text) {
    return "Student has not yet provided a meaningful explanation.";
  }

  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function heuristicAssessment(context) {
  const replies = studentMessages(context.messages);
  const latestReply = replies[replies.length - 1] || "";
  const combined = replies.join(" ").toLowerCase();
  const metadata = context.metadata;
  const weakReplyCount = replies.filter((item) => weakReply(item)).length;
  const hasCause = combined.length >= 14 && !weakReply(latestReply);
  const hasDuration = hasDurationDetail(combined);
  const hasPrevention = hasPreventiveIntent(combined);

  let truthScore = 52;

  if (genuineSignal(combined)) truthScore += 14;
  if (hasDuration) truthScore += 10;
  if (hasPrevention) truthScore += 12;
  if (combined.includes("my mistake") || combined.includes("i clicked")) truthScore += 8;
  if (metadata.copyCount + metadata.pasteCount > 0) truthScore -= 10;
  if (metadata.focusLossCount >= 5) truthScore -= 8;
  if (weakReply(latestReply)) truthScore -= 20;
  if (rudeReply(latestReply)) truthScore -= 18;
  if (weakReplyCount >= 2) truthScore -= 18;
  if (suspiciousSignal(combined)) truthScore -= 30;

  truthScore = clamp(truthScore, 0, 100);

  let trustLevel = "uncertain";
  if (truthScore >= 78) trustLevel = "genuine";
  else if (truthScore < 30) trustLevel = "suspicious";
  else if (truthScore < 52) trustLevel = "evasive";

  const hasAllCoreDetails = hasCause && hasDuration && hasPrevention;

  let decision = "continue_with_warning";
  if (weakReplyCount >= 2 || rudeReply(latestReply) || suspiciousSignal(combined)) {
    decision = "block_now";
  } else if (!hasAllCoreDetails && replies.length < 3) {
    decision = "final_warning";
  } else if (truthScore >= 84) {
    decision = "continue";
  } else if (truthScore >= 62) {
    decision = "continue_with_warning";
  } else if (truthScore >= 40) {
    decision = "final_warning";
  } else {
    decision = "block_now";
  }

  return {
    trustLevel,
    truthScore,
    decision,
    reasoning:
      decision === "block_now"
        ? "Replies remain vague or suspicious for integrity review."
        : hasAllCoreDetails
        ? "Explanation covers cause, duration, and preventive intent."
        : "More specific detail is still needed for a confident integrity review.",
    studentSummary: summarizeStudentClaim(context.messages),
    missingGoals: [
      !hasCause ? "cause" : null,
      !hasDuration ? "duration" : null,
      !hasPrevention ? "prevention" : null
    ].filter(Boolean),
    weakReplyCount
  };
}

function fallbackNextReply(context, assessment) {
  const latestReply = studentMessages(context.messages).slice(-1)[0] || "";
  const missingGoals = assessment.missingGoals || [];
  const weakCount = assessment.weakReplyCount || 0;

  if (assessment.decision === "block_now") {
    return {
      assistant_message: "Your responses are too vague for integrity review. Access to this test cannot be restored.",
      interim_assessment: assessment.trustLevel,
      should_continue_chat: false
    };
  }

  if (weakReply(latestReply) || weakCount >= 1) {
    return {
      assistant_message:
        weakCount >= 2
          ? "Your explanation remains insufficient for integrity review. This session cannot continue."
          : "Your reply is not sufficient for integrity review. Please clearly explain why you left the exam window.",
      interim_assessment: weakCount >= 2 ? "suspicious" : "evasive",
      should_continue_chat: weakCount < 2
    };
  }

  if (missingGoals.includes("cause")) {
    return {
      assistant_message: "Please explain what caused you to leave the exam window.",
      interim_assessment: assessment.trustLevel,
      should_continue_chat: true
    };
  }

  if (missingGoals.includes("duration")) {
    return {
      assistant_message: "How long were you away from the test interface?",
      interim_assessment: assessment.trustLevel,
      should_continue_chat: true
    };
  }

  if (missingGoals.includes("prevention")) {
    return {
      assistant_message: "What will you do now to avoid another interruption and continue fairly?",
      interim_assessment: assessment.trustLevel,
      should_continue_chat: true
    };
  }

  return {
    assistant_message:
      assessment.decision === "continue"
        ? "Thank you. Your explanation is consistent enough to restore access."
        : assessment.decision === "continue_with_warning"
        ? "Thank you. Your explanation is sufficient to continue, but this attempt will remain flagged with a warning."
        : "You may continue, but this is a final warning. Any further suspicious activity may end the test.",
    interim_assessment: assessment.trustLevel,
    should_continue_chat: false
  };
}

async function callOpenAI(systemPrompt, userPrompt) {
  const response = await fetchFn("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: DEFAULT_OPENAI_MODEL,
      temperature: 0.25,
      response_format: {
        type: "json_object"
      },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    })
  });

  if (!response.ok) {
    throw new Error("OpenAI request failed.");
  }

  const json = await response.json();
  return json?.choices?.[0]?.message?.content || "{}";
}

async function callBedrock(systemPrompt, userPrompt) {
  const client = getBedrockRuntimeClient();
  if (!client) {
    throw new Error("AWS Bedrock client is not configured.");
  }

  const response = await client.send(
    new ConverseCommand({
      modelId: DEFAULT_BEDROCK_MODEL,
      system: [{ text: systemPrompt }],
      messages: [
        {
          role: "user",
          content: [{ text: userPrompt }]
        }
      ],
      inferenceConfig: {
        temperature: 0.25
      }
    })
  );

  const text = response?.output?.message?.content?.map((item) => item.text || "").join("").trim();
  return text || "{}";
}

async function callLlm(systemPrompt, userPrompt) {
  const provider = getAiProvider();
  if (provider === "bedrock") {
    return callBedrock(systemPrompt, userPrompt);
  }

  if (provider === "openai") {
    return callOpenAI(systemPrompt, userPrompt);
  }

  throw new Error("No LLM provider configured.");
}

async function evaluateIntegrityDecision(context) {
  const metadata = buildMetadata(context.session);
  const fallback = heuristicAssessment({
    ...context,
    metadata
  });

  if (!isAiConfigured()) {
    return fallback;
  }

  const systemPrompt = [
    "You are Proctorly AI, a professional online exam integrity reviewer.",
    "Judge the student's credibility in a live review chat.",
    "Be strict about evasive, dismissive, rude, or suspicious replies.",
    "Return JSON only."
  ].join(" ");

  const userPrompt = `
Return JSON only with:
- trustLevel: genuine | uncertain | evasive | suspicious
- truthScore: integer 0-100
- decision: continue | continue_with_warning | final_warning | block_now
- reasoning: short professional explanation under 22 words
- studentSummary: short neutral summary of the student's claim under 28 words

Rules:
- Weak replies such as "why", "what", "idk", "nothing", "ok", "hmm", rude replies, or repeated one-word answers should lower trust sharply.
- If replies are still vague after at least two student turns, use block_now.
- If the student is specific, consistent, and gives preventive intent, allow continue or continue_with_warning.
- Use final_warning when the student is somewhat credible but still not strong.
- Be conservative when copy/paste events exist.

Violation metadata:
warningLevel=${metadata.warningLevel}
warningCount=${metadata.warningCount}
focusLossCount=${metadata.focusLossCount}
unfocusCount=${metadata.unfocusCount}
visibilityCount=${metadata.visibilityCount}
copyCount=${metadata.copyCount}
pasteCount=${metadata.pasteCount}

Conversation transcript:
"""
${formatConversation(context.messages)}
"""
`;

  try {
    const parsed = JSON.parse(await callLlm(systemPrompt, userPrompt));
    return {
      trustLevel: parsed.trustLevel || fallback.trustLevel,
      truthScore: clamp(Number(parsed.truthScore || fallback.truthScore), 0, 100),
      decision: parsed.decision || fallback.decision,
      reasoning: parsed.reasoning || fallback.reasoning,
      studentSummary: parsed.studentSummary || fallback.studentSummary,
      missingGoals: fallback.missingGoals,
      weakReplyCount: fallback.weakReplyCount
    };
  } catch (_error) {
    return fallback;
  }
}

async function generateNextIntegrityReply(context) {
  const metadata = buildMetadata(context.session);
  const assessment =
    context.assessment ||
    heuristicAssessment({
      ...context,
      metadata
    });
  const fallback = fallbackNextReply(
    {
      ...context,
      metadata
    },
    assessment
  );

  if (!isAiConfigured()) {
    return fallback;
  }

  const systemPrompt = [
    "You are Proctorly AI, a calm and formal exam integrity reviewer.",
    "Write the assistant's next message in a live integrity chat.",
    "The chat must feel professional and context-aware, not scripted.",
    "Return JSON only."
  ].join(" ");

  const userPrompt = `
Conversation goals:
- understand cause of the detected behavior
- understand duration and impact
- understand preventive intent before restoration

Return JSON only with:
- assistant_message: short professional assistant reply
- interim_assessment: genuine | uncertain | evasive | suspicious
- should_continue_chat: true | false

Rules:
- If the latest student reply is weak, vague, dismissive, or evasive, ask for a clearer explanation or end the chat if trust is too low.
- If enough detail is already available and the current assessment is continue, continue_with_warning, or final_warning, set should_continue_chat=false and give a final professional message.
- Avoid robotic repetition.
- Keep the message under 28 words.

Current live assessment:
trustLevel=${assessment.trustLevel}
truthScore=${assessment.truthScore}
decision=${assessment.decision}
reasoning="${assessment.reasoning}"
studentSummary="${assessment.studentSummary}"

Violation metadata:
warningLevel=${metadata.warningLevel}
warningCount=${metadata.warningCount}
focusLossCount=${metadata.focusLossCount}
copyCount=${metadata.copyCount}
pasteCount=${metadata.pasteCount}

Conversation transcript:
"""
${formatConversation(context.messages)}
"""
`;

  try {
    const parsed = JSON.parse(await callLlm(systemPrompt, userPrompt));
    return {
      assistant_message: parsed.assistant_message || fallback.assistant_message,
      interim_assessment: parsed.interim_assessment || assessment.trustLevel,
      should_continue_chat:
        typeof parsed.should_continue_chat === "boolean"
          ? parsed.should_continue_chat
          : fallback.should_continue_chat
    };
  } catch (_error) {
    return fallback;
  }
}

module.exports = {
  evaluateIntegrityDecision,
  generateNextIntegrityReply,
  getAiProvider,
  isAiConfigured
};
