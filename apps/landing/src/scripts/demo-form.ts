import { API_PREFIX, demoRequestSchema } from '@procesabpm/shared';

/** The API is reached on the landing's own origin: the proxy sends /api/public/* to it (deploy/Caddyfile.example). */
const ENDPOINT = `${API_PREFIX}/public/demo-requests`;

const MESSAGES = {
  sent: 'Recibimos tu pedido. Te escribimos en un día hábil.',
  invalid: 'Revisa los campos marcados: nombre y empresa de al menos 2 letras, un correo válido y la aceptación del aviso.',
  busy: 'Recibimos muchos pedidos en este momento. Inténtalo de nuevo en unos minutos.',
  failed: 'No pudimos enviar el pedido. Revisa tu conexión e inténtalo de nuevo.',
} as const;

type Outcome = keyof typeof MESSAGES;

function valuesOf(form: HTMLFormElement): Record<string, unknown> {
  const data = new FormData(form);
  const text = (name: string) => String(data.get(name) ?? '');
  const process = text('process').trim();
  return {
    fullName: text('fullName'),
    company: text('company'),
    email: text('email'),
    teamSize: text('teamSize'),
    ...(process === '' ? {} : { process }),
    privacyConsent: data.get('privacyConsent') === 'on',
    website: text('website'),
  };
}

async function send(body: unknown): Promise<Outcome> {
  try {
    const response = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (response.status === 202) return 'sent';
    if (response.status === 429) return 'busy';
    if (response.status === 400) return 'invalid';
    return 'failed';
  } catch {
    return 'failed';
  }
}

/** Checks the form with the API's own contract, sends it and says what happened next to the button. */
export function startDemoForm(): void {
  const form = document.getElementById('demo-form') as HTMLFormElement | null;
  const message = document.getElementById('form-message');
  const submit = document.getElementById('f-submit') as HTMLButtonElement | null;
  if (form === null || message === null || submit === null) return;

  const say = (outcome: Outcome) => {
    message.hidden = false;
    message.textContent = MESSAGES[outcome];
    message.dataset['tone'] = outcome === 'sent' ? 'ok' : 'error';
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const parsed = demoRequestSchema.safeParse(valuesOf(form));
    form.querySelectorAll('[aria-invalid]').forEach((field) => field.removeAttribute('aria-invalid'));
    if (!parsed.success) {
      for (const issue of parsed.error.issues) form.querySelector(`[name="${String(issue.path[0])}"]`)?.setAttribute('aria-invalid', 'true');
      say('invalid');
      return;
    }
    submit.disabled = true;
    void send(parsed.data).then((outcome) => {
      submit.disabled = false;
      say(outcome);
      if (outcome === 'sent') form.reset();
    });
  });
}
