const STORAGE_KEY = 'procesabpm.analytics';
type Choice = 'granted' | 'denied';

function readChoice(): Choice | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === 'granted' || value === 'denied' ? value : null;
  } catch {
    return null;
  }
}

function saveChoice(choice: Choice): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Without storage the banner simply asks again next time.
  }
}

/** Loads gtag.js and sends the page view; called only after the visitor accepted. */
function loadGoogleAnalytics(id: string): void {
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.append(script);
  const w = window as unknown as { dataLayer: unknown[]; gtag: (...args: unknown[]) => void };
  w.dataLayer = w.dataLayer ?? [];
  w.gtag = function gtag() {
    // gtag.js reads the arguments object, not an array.
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer.push(arguments);
  };
  w.gtag('js', new Date());
  w.gtag('config', id, { anonymize_ip: true });
}

/** Google's measurement cookies (_ga, _ga_<id>) on this site, removed when the visitor takes the consent back. */
function clearAnalyticsCookies(): void {
  const domain = window.location.hostname.replace(/^www\./, '');
  for (const cookie of document.cookie.split(';')) {
    const name = cookie.split('=')[0]!.trim();
    if (name !== '_ga' && !name.startsWith('_ga_')) continue;
    for (const scope of ['', `; domain=${domain}`, `; domain=.${domain}`]) document.cookie = `${name}=; max-age=0; path=/${scope}`;
  }
}

export function startAnalytics(): void {
  const banner = document.getElementById('consent');
  const id = banner?.dataset['ga'];
  if (banner === null || id === undefined || id === '') return;
  let loaded = false;
  const load = () => {
    if (loaded) return;
    loaded = true;
    loadGoogleAnalytics(id);
  };
  if (readChoice() === 'granted') load();
  banner.hidden = readChoice() !== null;
  banner.querySelectorAll<HTMLButtonElement>('[data-choice]').forEach((button) =>
    button.addEventListener('click', () => {
      const picked = button.dataset['choice'] === 'granted' ? 'granted' : 'denied';
      saveChoice(picked);
      banner.hidden = true;
      if (picked === 'granted') load();
      else clearAnalyticsCookies();
    }),
  );
  // The footer's «Cookies» button: the choice can be changed (or taken back) at any time.
  document.querySelectorAll<HTMLButtonElement>('[data-cookie-settings]').forEach((button) => {
    button.hidden = false;
    button.addEventListener('click', () => {
      banner.hidden = false;
      banner.querySelector<HTMLButtonElement>('[data-choice="granted"]')?.focus();
    });
  });
}
