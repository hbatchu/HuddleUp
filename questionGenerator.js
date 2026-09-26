const Anthropic = require('@anthropic-ai/sdk');
const { zodOutputFormat } = require('@anthropic-ai/sdk/helpers/zod');
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

let client = null;
let warnedNoKey = false;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    if (!warnedNoKey) { console.warn('ANTHROPIC_API_KEY not set — quiz questions will use the built-in static question bank.'); warnedNoKey = true; }
    return null;
  }
  if (!client) client = new Anthropic();
  return client;
}

async function generateQuestions(category, count) {
  const topic = TOPIC_PROMPTS[category];
  const anthropic = getClient();
  if (!topic || !anthropic) return null;
  try {
    const response = await anthropic.messages.parse({
      model: 'claude-opus-5',
      max_tokens: 6000,
      system: `You write multiple-choice trivia questions for a live party quiz game. Every question must be about ${topic}. Write exactly ${count} questions, ordered from easiest to hardest (roughly the first third "Easy", the middle third "Medium", the last third "Hard"). Rules for every question: exactly 4 answer options; exactly one is correct; the "correct" field is the 0-based index of the correct option; all facts must be well-established and verifiable, not obscure or debatable; answer options must be short (a few words) and clearly distinct from one another; every question in the set must be about a different fact (no near-duplicates); never hint or reveal the answer inside the question text itself.`,
      messages: [{ role: 'user', content: `Generate the ${count} quiz questions now.` }],
      output_config: { format: zodOutputFormat(QuizSchema) },
    });
    const parsed = response.parsed_output;
    if (!parsed || !Array.isArray(parsed.questions) || parsed.questions.length !== count) return null;
    const seen = new Set();
    for (const q of parsed.questions) {
      const key = q.question.trim().toLowerCase();
      if (seen.has(key)) return null;
      seen.add(key);
    }
    return parsed.questions;
  } catch (err) {
    console.error('Question generation failed, falling back to built-in questions:', err.message);
    return null;
  }
}

module.exports = { generateQuestions };
