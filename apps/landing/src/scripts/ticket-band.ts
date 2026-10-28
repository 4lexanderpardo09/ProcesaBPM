import { JOURNEY } from '../data/ticket-155';
import { prefersReducedMotion } from './motion';

const CYCLE_MS = 2600;

function show(element: HTMLElement | null, value: string): void {
  if (element === null || element.textContent === value) return;
  element.textContent = value;
  element.classList.remove('flip');
  void element.offsetWidth;
  element.classList.add('flip');
}

/** The hero's key-data band moves through ticket #155's steps, like the ticket detail would while it advances. */
export function startTicketBand(): void {
  if (prefersReducedMotion()) return;
  const step = document.getElementById('tb-step');
  const holder = document.getElementById('tb-who');
  const signatures = document.getElementById('tb-sign');
  const state = document.getElementById('tb-state');
  let index = 1;
  window.setInterval(() => {
    if (document.hidden) return;
    index = (index + 1) % JOURNEY.length;
    const stop = JOURNEY[index];
    if (stop === undefined) return;
    show(step, stop.band[0]);
    show(holder, stop.band[1]);
    show(signatures, `${index + 1} de ${JOURNEY.length} pasos`);
    const closed = index === JOURNEY.length - 1;
    if (state !== null) {
      state.textContent = closed ? 'Cerrado' : 'Abierto';
      state.className = `badge ${closed ? 'b-mut' : 'b-acc'}`;
    }
  }, CYCLE_MS);
}
