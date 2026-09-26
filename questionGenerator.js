const OpenAI = require('openai');
const { z } = require('zod');

const QuestionSchema = z.object({
  level: z.enum(['Easy', 'Medium', 'Hard']),
  question: z.string().min(8).max(220),
  answers: z.array(z.string().min(1).max(80)).length(4),
  correct: z.number().int().min(0).max(3),
});
const QuizSchema = z.object({ questions: z.array(QuestionSchema) });

const TOPIC_PROMPTS = {
  general: 'general knowledge, spanning science, history, geography, world culture, economics, and current events',
  ai: 'artificial intelligence, spanning LLMs, AI agents, machine learning concepts, AI companies and products, and how modern AI tools work',
};

// NVIDIA's API catalog (build.nvidia.com) serves Nemotron models through an
// OpenAI-compatible endpoint. The exact model slug can move as NVIDIA updates
// its catalog, so it's overridable without a code change.
const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const MODEL = process.env.NVIDIA_NEMOTRON_MODEL || 'nvidia/nemotron-3.5-lightning-30b-a3b';

let client = null;
let warnedNoKey = false;
function getClient() {
  if (!process.env.NVIDIA_API_KEY) {
    if (!warnedNoKey) { console.warn('NVIDIA_API_KEY not set — quiz questions will use the built-in static question bank.'); warnedNoKey = true; }
    return null;
  }
  // NVIDIA's hosted catalog has been observed queuing 40-55s under shared
  // load (and this varies run to run), so a 60s cap was cutting it too
  // close and tripping the fallback on otherwise-successful requests.
  // Wider margin here; the loading state on the client covers the wait.
  if (!client) client = new OpenAI({ apiKey: process.env.NVIDIA_API_KEY, baseURL: NVIDIA_BASE_URL, timeout: 90000 });
  return client;
}

// Nemotron sometimes wraps JSON in a markdown code fence despite instructions
// not to; strip that and take the outermost {...} span before parsing.
function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try { return JSON.parse(body.slice(start, end + 1)); } catch { return null; }
}

async function generateQuestions(category, count) {
  const topic = TOPIC_PROMPTS[category];
  const nvidia = getClient();
  if (!topic || !nvidia) return null;
  try {
    const completion = await nvidia.chat.completions.create({
      model: MODEL,
      temperature: 0.9,
      max_tokens: 4000,
      // Nemotron's reasoning models emit a separate reasoning_content block by
      // default, which eats into the token budget before the real answer;
      // this quiz-generation task doesn't need it.
      chat_template_kwargs: { thinking: false },
      messages: [
        {
          role: 'system',
          content: `You write multiple-choice trivia questions for a live party quiz game. Every question must be about ${topic}. Write exactly ${count} questions, ordered from easiest to hardest (roughly the first third "Easy", the middle third "Medium", the last third "Hard"). Rules for every question: exactly 4 answer options; exactly one is correct; "correct" is the 0-based index of the correct option; all facts must be well-established and verifiable, not obscure or debatable; answer options must be short (a few words) and clearly distinct from one another; every question must be about a different fact (no near-duplicates); never hint or reveal the answer inside the question text itself.

Respond with ONLY a single JSON object in exactly this shape, no markdown code fences, no commentary before or after it:
{"questions":[{"level":"Easy","question":"...","answers":["...","...","...","..."],"correct":0}]}`,
        },
        { role: 'user', content: `Generate the ${count} quiz questions now.` },
      ],
    });
    const raw = completion.choices?.[0]?.message?.content;
    if (!raw) { console.error('Question generation returned no content — falling back to built-in questions.'); return null; }
    const json = extractJson(raw);
    if (!json) { console.error('Question generation returned unparseable JSON — falling back to built-in questions.'); return null; }
    const result = QuizSchema.safeParse(json);
    if (!result.success) {
      console.error(`Question generation returned an invalid shape (${result.error.issues[0]?.message}) — falling back to built-in questions.`);
      return null;
    }
    const { questions } = result.data;
    if (questions.length !== count) {
      console.error(`Question generation returned ${questions.length} questions, expected ${count} — falling back to built-in questions.`);
      return null;
    }
    const seen = new Set();
    for (const q of questions) {
      const key = q.question.trim().toLowerCase();
      if (seen.has(key)) { console.error('Question generation returned a duplicate question — falling back to built-in questions.'); return null; }
      seen.add(key);
    }
    return questions;
  } catch (err) {
    console.error(`Question generation failed (${err.name}: ${err.message}) — falling back to built-in questions.`);
    return null;
  }
}

module.exports = { generateQuestions };
