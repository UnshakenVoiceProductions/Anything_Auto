window.AA_SITE_CONFIG = {
  askChrisEndpoint: "/api/ask-chris",
  googleReviewsEndpoint: "/api/google-reviews",
  escalationEmail: "askchris@anythingautomotivepa.com"
};

window.addEventListener('load', function () {
  const styleId = 'aa-ask-chris-structured-style';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .ask-output { display:grid; gap:.9rem; }
      .ask-header { display:flex; align-items:center; justify-content:space-between; gap:.8rem; flex-wrap:wrap; }
      .ask-header strong { font-size:1.05rem; }
      .ask-severity {
        display:inline-flex; align-items:center; border-radius:999px; padding:.35rem .7rem;
        background:rgba(240,125,0,.12); border:1px solid rgba(240,125,0,.22); color:#ffd9ae; font-size:.82rem; font-weight:800;
      }
      .ask-summary { margin:0; }
      .ask-section {
        padding:.9rem 1rem; border-radius:16px; border:1px solid rgba(255,255,255,.08);
        background:rgba(255,255,255,.03);
      }
      .ask-section h4 { margin:0 0 .55rem 0; font-size:.98rem; }
      .ask-section p { margin:0; }
      .ask-section ul { margin:.1rem 0 0; padding-left:1.1rem; color:#f5f7fa; }
      .ask-section li { margin:.35rem 0; }
    `;
    document.head.appendChild(style);
  }

  const form = document.getElementById('askChrisForm');
  if (!form) return;

  const replacement = form.cloneNode(true);
  form.parentNode.replaceChild(replacement, form);

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function renderAskChrisResult(result) {
    const severity = escapeHtml(result.severity || 'General');
    const title = escapeHtml(result.title || 'Chris’s first take');
    const summary = escapeHtml(result.summary || '');
    const nextStep = escapeHtml(result.nextStep || '');
    const headings = result.headings || {};

    const renderList = (titleText, items) => {
      if (!Array.isArray(items) || !items.length) return '';
      return `
        <div class="ask-section">
          <h4>${escapeHtml(titleText)}</h4>
          <ul>
            ${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
          </ul>
        </div>
      `;
    };

    return `
      <div class="ask-output">
        <div class="ask-header">
          <strong>${title}</strong>
          <span class="ask-severity">${severity}</span>
        </div>
        ${summary ? `<p class="ask-summary">${summary}</p>` : ''}
        ${renderList(headings.whatImHearing || 'What I’m hearing', result.bullets?.whatImHearing)}
        ${renderList(headings.likelyCauses || 'Most likely causes', result.bullets?.likelyCauses)}
        ${renderList(headings.attentionFirst || 'What needs attention first', result.bullets?.attentionFirst)}
        ${renderList(headings.checkNow || 'What you can check now', result.bullets?.checkNow)}
        ${renderList(headings.stopDriving || 'When to stop driving', result.bullets?.stopDriving)}
        ${nextStep ? `
          <div class="ask-section">
            <h4>${escapeHtml(headings.nextStep || 'Best next step')}</h4>
            <p>${nextStep}</p>
          </div>
        ` : ''}
      </div>
    `;
  }

  replacement.addEventListener('submit', async function (event) {
    event.preventDefault();
    const questionField = document.getElementById('askChrisQuestion');
    const nameField = document.getElementById('askChrisName');
    const replyField = document.getElementById('askChrisReply');

    const question = (questionField?.value || '').trim();
    const name = (nameField?.value || '').trim();
    const replyTo = (replyField?.value || '').trim();
    if (!question) return;

    window.appendChat?.('user', `${name ? `<strong>${escapeHtml(name)}:</strong><br>` : ''}${escapeHtml(question)}`);
    window.appendChat?.('ai', '<strong>Chris, your digital mechanic</strong><br><br>Thinking through that now...');
    const log = document.getElementById('chatLog');
    const last = log?.lastElementChild;

    try {
      const result = await window.requestAskChris({ question, name, replyTo, source: 'website' });
      if (last) last.innerHTML = renderAskChrisResult(result);
      const actions = document.getElementById('responseActions');
      if (actions) actions.style.display = 'flex';
      const escalationQuestion = document.getElementById('escalationQuestion');
      if (escalationQuestion) escalationQuestion.value = question;
      if (result.shouldEscalate) {
        window.showBox?.('askChrisStatus', 'This answer suggests the vehicle may need direct follow-up or an in-person inspection.');
      } else {
        window.showBox?.('askChrisStatus', 'If you still want direct help after this first-pass answer, use the Send to Chris option.');
      }
    } catch (error) {
      if (last) {
        last.innerHTML = renderAskChrisResult({
          title: 'Chris’s first take',
          summary: 'I could not reach the live answer service right now, but you can still request direct follow-up.',
          severity: 'High',
          headings: {
            whatImHearing: 'What I’m hearing',
            likelyCauses: 'Most likely causes',
            attentionFirst: 'What needs attention first',
            checkNow: 'What you can check now',
            stopDriving: 'When to stop driving',
            nextStep: 'Best next step'
          },
          bullets: {
            whatImHearing: ['The live answer service is temporarily unavailable.'],
            attentionFirst: ['If the vehicle feels unsafe, do not keep driving it until it can be checked.'],
            checkNow: ['Try again in a moment or send the question directly to Chris.']
          },
          nextStep: 'Use the Send to Chris option if you want the shop to review the situation directly.',
          shouldEscalate: true
        });
      }
      const actions = document.getElementById('responseActions');
      if (actions) actions.style.display = 'flex';
      const escalationQuestion = document.getElementById('escalationQuestion');
      if (escalationQuestion) escalationQuestion.value = question;
      window.showBox?.('askChrisStatus', 'The live AI response is unavailable at the moment, but you can still send the question directly.');
    }

    replacement.reset();
  });
});
