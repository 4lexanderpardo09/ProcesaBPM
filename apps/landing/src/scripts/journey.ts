import { JOURNEY, type JourneyStop } from '../data/ticket-155';
import { gsap, prefersReducedMotion } from './motion';

/** Natural size of the flow map screenshot. */
const MAP_RATIO = 1640 / 4224;
/** Scroll length of the pinned map, per step, in % of the viewport height. */
const SCROLL_PER_STEP = 70;

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function filesHtml(files: readonly string[] = []): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const file of files) {
    const chip = document.createElement('span');
    chip.className = 'file';
    chip.textContent = file;
    fragment.append(chip);
  }
  return fragment;
}

/** The pinned map travels ticket #155's path as the page scrolls; the card shows what each person left in the activity. */
export function startJourney(): void {
  if (prefersReducedMotion()) return;
  const box = byId('journey-box');
  const pin = byId('map-pin');
  const layer = byId('map-layer');
  const dot = byId('map-dot');
  const log = { step: byId('log-step'), count: byId('log-count'), who: byId('log-who'), text: byId('log-text'), files: byId('log-files'), initials: byId('log-av') };
  const bars = [...byId('log-progress').children];
  box.classList.remove('static');

  let shown = -1;
  const showLog = (index: number) => {
    const stop = JOURNEY[index];
    if (index === shown || stop === undefined) return;
    shown = index;
    log.step.textContent = stop.step;
    log.count.textContent = `${index + 1} / ${JOURNEY.length}`;
    log.who.innerHTML = stop.who;
    log.text.textContent = stop.text;
    log.text.classList.toggle('described', stop.described === true);
    log.files.replaceChildren(filesHtml(stop.files));
    log.initials.textContent = stop.initials;
    bars.forEach((bar, at) => bar.classList.toggle('on', at <= index));
  };

  const mapWidth = () => {
    const width = pin.clientWidth;
    return Math.min(2800, Math.max(1500, width * (width < 700 ? 3.6 : 2.1)));
  };

  /** `t` runs from 0 to the last stop; between two stops the view slides from one to the next. */
  const place = (t: number) => {
    const at = Math.min(Math.floor(t), JOURNEY.length - 2);
    const a = JOURNEY[at] as JourneyStop;
    const b = JOURNEY[at + 1] as JourneyStop;
    const f = t - at;
    const x = a.x + (b.x - a.x) * f;
    const y = a.y + (b.y - a.y) * f;
    const W = mapWidth();
    const H = W * MAP_RATIO;
    const vw = pin.clientWidth;
    const vh = pin.clientHeight;
    const narrow = vw < 700;
    const focusX = narrow ? vw * 0.5 : vw * 0.62;
    const focusY = narrow ? vh * 0.32 : vh * 0.42;
    const tx = Math.min(0, Math.max(vw - W, focusX - x * W));
    const ty = H < vh ? (vh - H) / 2 : Math.min(0, Math.max(vh - H, focusY - y * H));
    layer.style.width = `${W}px`;
    layer.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
    dot.style.left = `${x * 100}%`;
    dot.style.top = `${y * 100}%`;
    showLog(Math.round(t));
  };

  const progress = { t: 0 };
  place(0);
  gsap.to(progress, {
    t: JOURNEY.length - 1,
    ease: 'none',
    onUpdate: () => place(progress.t),
    scrollTrigger: {
      trigger: pin,
      start: 'top top',
      end: `+=${JOURNEY.length * SCROLL_PER_STEP}%`,
      pin: true,
      scrub: 0.7,
      snap: { snapTo: 1 / (JOURNEY.length - 1), duration: { min: 0.2, max: 0.6 }, ease: 'power1.inOut' },
      invalidateOnRefresh: true,
      onRefresh: () => place(progress.t),
    },
  });
}
