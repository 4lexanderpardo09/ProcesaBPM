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

export function startAnalytics(): void {
  const banner = document.getElementById('consent');
  const id = banner?.dataset['ga'];
  if (banner === null || id === undefined || id === '') return;
  const choice = readChoice();
  if (choice === 'granted') loadGoogleAnalytics(id);
  if (choice !== null) return;
  banner.hidden = false;
  banner.querySelectorAll<HTMLButtonElement>('[data-choice]').forEach((button) =>
    button.addEventListener('click', () => {
      const picked = button.dataset['choice'] === 'granted' ? 'granted' : 'denied';
      saveChoice(picked);
      banner.hidden = true;
      if (picked === 'granted') loadGoogleAnalytics(id);
    }),
  );
}
