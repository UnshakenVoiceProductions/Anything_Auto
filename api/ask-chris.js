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
    'You are Ask Chris, the first-pass digital mechanic assistant for Anything Automotive LLC in Rural Valley, Pennsylvania.',
    'Sound practical, experienced, calm, helpful, and like a capable head mechanic speaking to a customer.',
    'Do not pretend to perform a confirmed diagnosis without inspection or testing.',
    'Do not invent prices, parts, or shop policies.',
    'Focus on useful first-pass reasoning, likely causes, safety, and clear next steps.',
    'Return only valid JSON with this exact structure:',
    '{',
    '"title": string,',
    '"summary": string,',
    '"severity": "Low" | "Moderate" | "High",',
    '"headings": {',
    '"whatImHearing": string,',
    '"likelyCauses": string,',
    '"attentionFirst": string,',
    '"checkNow": string,',
    '"stopDriving": string,',
    '"nextStep": string',
    '},',
    '"bullets": {',
    '"whatImHearing": string[],',
    '"likelyCauses": string[],',
    '"attentionFirst": string[],',
    '"checkNow": string[],',
    '"stopDriving": string[]',
    '},',
    '"nextStep": string,',
    '"shouldEscalate": boolean',
    '}',
    'Keep the output concise, readable, and customer-facing.',
    'Use short bullets, not long paragraphs.',
    'If the issue could be unsafe to drive, set severity to High and shouldEscalate to true.',
    'If there is any mention of fuel smell, brake concerns, overheating, smoke, severe vibration, or major drivability problems, treat safety seriously.'
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

function extractJsonObject(text) {
  const normalized = String(text || '').trim();
  if (!normalized) throw new Error('Empty response');
  try {
    return JSON.parse(normalized);
  } catch {}
  const match = normalized.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object found in model response');
  return JSON.parse(match[0]);
}

function normalizeString(value, fallback = '') {
  const str = String(value ?? '').trim();
  return str || fallback;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => normalizeString(item)).filter(Boolean).slice(0, 6);
}

function normalizeStructuredResponse(parsed, question) {
  const headings = parsed?.headings || {};
  const bullets = parsed?.bullets || {};
  const result = {
    title: normalizeString(parsed?.title, 'Chris’s first take'),
    summary: normalizeString(parsed?.summary, 'Here is a practical first-pass read on what you described.'),
    severity: normalizeSeverity(parsed?.severity, question),
    headings: {
      whatImHearing: normalizeString(headings.whatImHearing, 'What I’m hearing'),
      likelyCauses: normalizeString(headings.likelyCauses, 'Most likely causes'),
      attentionFirst: normalizeString(headings.attentionFirst, 'What needs attention first'),
      checkNow: normalizeString(headings.checkNow, 'What you can check now'),
      stopDriving: normalizeString(headings.stopDriving, 'When to stop driving'),
      nextStep: normalizeString(headings.nextStep, 'Best next step')
    },
    bullets: {
      whatImHearing: normalizeStringArray(bullets.whatImHearing),
      likelyCauses: normalizeStringArray(bullets.likelyCauses),
      attentionFirst: normalizeStringArray(bullets.attentionFirst),
      checkNow: normalizeStringArray(bullets.checkNow),
      stopDriving: normalizeStringArray(bullets.stopDriving)
    },
    nextStep: normalizeString(parsed?.nextStep, 'If the vehicle feels unsafe, arrange direct follow-up or an in-person inspection.'),
    shouldEscalate: Boolean(parsed?.shouldEscalate)
  };

  if (forceEscalation(question, result)) {
    result.severity = 'High';
    result.shouldEscalate = true;
  }
  return result;
}

function normalizeSeverity(value, question) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'low') return 'Low';
  if (normalized === 'moderate' || normalized === 'medium') return 'Moderate';
  if (normalized === 'high') return 'High';
  return forceEscalation(question, {}) ? 'High' : 'Moderate';
}

function forceEscalation(question, result) {
  const combined = `${question || ''} ${result?.summary || ''} ${result?.nextStep || ''} ${JSON.stringify(result?.bullets || {})}`.toLowerCase();
  return /(fuel smell|smell gas|gas smell|brake|overheat|overheating|smoke|fire|severe vibration|violent shake|unsafe|not safe|flashing check engine|loss of power)/i.test(combined);
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
      response_format: { type: 'json_object' },
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
      max_tokens: 900,
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
  const textParts = Array.isArray(data?.content)
    ? data.content.filter(item => item.type === 'text').map(item => item.text)
    : [];
  return textParts.join('\n').trim();
}

function fallbackStructuredAnswer(question) {
  const q = String(question || '');
  const fuelConcern = /fuel smell|smell gas|gas smell/i.test(q);
  const tireConcern = /flat|tire|tyre|losing air/i.test(q);
  const codeMention = /\bP0?\d{3,4}\b/i.test(q);

  return {
    title: 'Chris’s first take',
    summary: 'Here is a practical first-pass read on what you described.',
    severity: fuelConcern ? 'High' : 'Moderate',
    headings: {
      whatImHearing: 'What I’m hearing',
      likelyCauses: 'Most likely causes',
      attentionFirst: 'What needs attention first',
      checkNow: 'What you can check now',
      stopDriving: 'When to stop driving',
      nextStep: 'Best next step'
    },
    bullets: {
      whatImHearing: [
        tireConcern ? 'You mentioned a tire or air-loss problem.' : 'You described a vehicle concern that needs inspection.',
        codeMention ? 'You also mentioned a trouble code.' : 'No confirmed warning code details were provided.',
        fuelConcern ? 'You reported a fuel smell, which can be a safety concern.' : 'The vehicle may need condition-based troubleshooting.'
      ].filter(Boolean),
      likelyCauses: [
        tireConcern ? 'A slow leak can come from the valve stem, bead, puncture, or wheel sealing surface.' : null,
        fuelConcern ? 'A gas smell can point to a fuel leak, vapor leak, injector issue, or line concern.' : null,
        codeMention ? 'The code may point in a useful direction, but testing is still needed before recommending parts.' : null
      ].filter(Boolean),
      attentionFirst: [
        fuelConcern ? 'Treat the fuel smell as the first priority.' : 'Pay attention to anything that affects safe driving.',
        tireConcern ? 'Do not keep driving on a tire that may be losing pressure.' : null
      ].filter(Boolean),
      checkNow: [
        tireConcern ? 'Check and document the tire pressure before driving again.' : null,
        fuelConcern ? 'Do not ignore a strong fuel smell near the engine bay.' : null,
        'Look for obvious leaks, loose caps, or any recent repair history that changed the symptoms.'
      ].filter(Boolean),
      stopDriving: [
        fuelConcern ? 'If the gas smell is strong, avoid driving until it can be checked.' : null,
        'Stop driving if the vehicle feels unsafe, unstable, or starts running much worse.'
      ].filter(Boolean)
    },
    nextStep: fuelConcern
      ? 'Because of the fuel smell, this should be inspected soon and may not be a good vehicle to keep driving until it is checked.'
      : 'The best next step is a proper inspection so the issue can be confirmed before parts are guessed at.',
    shouldEscalate: fuelConcern
  };
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
      ...fallbackStructuredAnswer(question),
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

      const parsed = normalizeStructuredResponse(extractJsonObject(raw), question);
      return sendJson(response, 200, {
        ...parsed,
        escalationEmail,
        providerUsed: provider
      });
    } catch (error) {
      errors.push(`${provider}: ${error.message}`);
    }
  }

  return sendJson(response, 502, {
    error: 'Both AI providers failed.',
    ...fallbackStructuredAnswer(question),
    shouldEscalate: true,
    escalationEmail,
    details: errors
  });
};
