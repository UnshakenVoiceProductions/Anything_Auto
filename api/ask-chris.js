const DEFAULT_OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const DEFAULT_ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest';

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
}

function normalizeBody(request) {
  if (!request.body) return {};
  if (typeof request.body === 'string') {
    try {
      return JSON.parse(request.body);
    } catch {
      return {};
    }
  }
  return request.body;
}

function buildSystemPrompt() {
  return [
    'You are Ask Chris, the first-pass website assistant for Anything Automotive LLC in Rural Valley, Pennsylvania.',
    'Sound practical, experienced, calm, and helpful.',
    'Do not pretend to perform a confirmed diagnosis without inspection or testing.',
    'Give likely categories, risk level, and clear next steps.',
    'When a shop visit is the correct next step, say so plainly.',
    'Avoid alarmism and avoid overselling repairs.',
    'If a vehicle may be unsafe to drive, say that directly.',
    'Keep the answer concise and useful for a customer.',
    'End your answer with a final line exactly in one of these two forms: ESCALATE: yes or ESCALATE: no.'
  ].join(' ');
}

function buildUserPrompt({ question = '', name = '', replyTo = '', source = 'website' }) {
  return [
    `Customer name: ${name || 'Not provided'}`,
    `Reply contact: ${replyTo || 'Not provided'}`,
    `Source: ${source || 'website'}`,
    '',
    'Customer question:',
    question || 'No question provided.'
  ].join('\n');
}

function shouldPreferAnthropic(question) {
  return question.length > 420 || /(intermittent|already replaced|multiple issues|history|after replacing|still happening|several symptoms|long story short|what else)/i.test(question);
}

function buildProviderOrder(question, hasOpenAI, hasAnthropic) {
  const order = [];
  if (shouldPreferAnthropic(question)) {
    if (hasAnthropic) order.push('anthropic');
    if (hasOpenAI) order.push('openai');
  } else {
    if (hasOpenAI) order.push('openai');
    if (hasAnthropic) order.push('anthropic');
  }
  return order;
}

function extractEscalation(text) {
  const normalized = String(text || '').trim();
  const match = normalized.match(/ESCALATE:\s*(yes|no)\s*$/i);
  const shouldEscalate = match ? match[1].toLowerCase() === 'yes' : false;
  const cleaned = match ? normalized.replace(/ESCALATE:\s*(yes|no)\s*$/i, '').trim() : normalized;
  return { cleaned, shouldEscalate };
}

async function askOpenAI(apiKey, payload) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: DEFAULT_OPENAI_MODEL,
      temperature: 0.2,
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: buildUserPrompt(payload) }
      ]
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${message}`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content || '';
}

async function askAnthropic(apiKey, payload) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: DEFAULT_ANTHROPIC_MODEL,
      max_tokens: 500,
      temperature: 0.2,
      system: buildSystemPrompt(),
      messages: [
        { role: 'user', content: buildUserPrompt(payload) }
      ]
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Anthropic request failed: ${response.status} ${message}`);
  }

  const data = await response.json();
  const textParts = Array.isArray(data?.content) ? data.content.filter(item => item.type === 'text').map(item => item.text) : [];
  return textParts.join('\n').trim();
}

module.exports = async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return sendJson(response, 405, { error: 'Method not allowed' });
  }

  const body = normalizeBody(request);
  const question = String(body.question || '').trim();
  const name = String(body.name || '').trim();
  const replyTo = String(body.replyTo || '').trim();
  const source = String(body.source || 'website').trim();

  if (!question) {
    return sendJson(response, 400, { error: 'Question is required.' });
  }

  const openAiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const escalationEmail = process.env.ASK_CHRIS_ESCALATION_EMAIL || 'askchris@anythingautomotivepa.com';

  if (!openAiKey && !anthropicKey) {
    return sendJson(response, 503, {
      error: 'Ask Chris AI is not configured yet.',
      title: 'Ask Chris',
      answer: 'The live answer service is not configured yet. Please call the shop or request direct follow-up.',
      shouldEscalate: true,
      escalationEmail
    });
  }

  const payload = { question, name, replyTo, source };
  const providerOrder = buildProviderOrder(question, Boolean(openAiKey), Boolean(anthropicKey));
  const errors = [];

  for (const provider of providerOrder) {
    try {
      const raw = provider === 'anthropic'
        ? await askAnthropic(anthropicKey, payload)
        : await askOpenAI(openAiKey, payload);

      const parsed = extractEscalation(raw);
      return sendJson(response, 200, {
        title: 'Ask Chris',
        answer: parsed.cleaned || 'A first-pass answer was generated, but it came back empty.',
        shouldEscalate: parsed.shouldEscalate,
        escalationEmail,
        providerUsed: provider
      });
    } catch (error) {
      errors.push(`${provider}: ${error.message}`);
    }
  }

  return sendJson(response, 502, {
    error: 'Both AI providers failed.',
    title: 'Ask Chris',
    answer: 'The live answer service is having trouble right now. Please try again or send the question directly to Chris.',
    shouldEscalate: true,
    escalationEmail,
    details: errors
  });
};
