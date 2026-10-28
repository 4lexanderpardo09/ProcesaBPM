import { AMOUNT_RULE_THRESHOLD } from '../data/flows';
import { keepEdgesDrawn } from './edges';

const ROUTE_ABOVE = ['q-c', 'c-g', 'g-p', 'p-r', 'r-f'];
const ROUTE_BELOW = ['q-c', 'c-p', 'p-r', 'r-f'];
const money = new Intl.NumberFormat('es-CO');

/** The visitor moves the quoted amount; the condition sends the order through management or straight to purchasing. */
export function startRuleDemo(): void {
  const canvas = document.getElementById('rule-canvas');
  const input = document.getElementById('amount-in') as HTMLInputElement | null;
  const output = document.getElementById('amount-out');
  const verdict = document.getElementById('verdict');
  if (canvas === null || input === null || output === null || verdict === null) return;

  const apply = () => {
    const amount = Number(input.value);
    const above = amount > AMOUNT_RULE_THRESHOLD;
    const route = above ? ROUTE_ABOVE : ROUTE_BELOW;
    output.textContent = `$${money.format(amount)}`;
    canvas.querySelectorAll<SVGPathElement>('svg.edges path').forEach((path) => {
      const edge = path.dataset['edge'] ?? '';
      if (path.classList.contains('retry')) return;
      path.classList.toggle('done', route.includes(edge));
      path.classList.toggle('off', !route.includes(edge));
    });
    canvas.querySelector('[data-for="c-g"]')?.classList.toggle('off', !above);
    canvas.querySelector('[data-for="g-p"]')?.classList.toggle('off', !above);
    canvas.querySelector('[data-for="c-p"]')?.classList.toggle('off', above);
    canvas.querySelectorAll<HTMLElement>('.node').forEach((node) => {
      node.classList.toggle('is-off', node.dataset['id'] === 'g' && !above);
      node.classList.toggle('is-live', node.dataset['id'] === (above ? 'g' : 'p'));
    });
    const condition = canvas.querySelector('[data-id="c"] .s');
    if (condition !== null) condition.textContent = above ? 'Sí, más de 10 M' : 'No: monto normal';
    verdict.textContent = above ? 'Va a Gerencia. Hasta que no firme, Compras no ve el pedido.' : 'Va directo a Compras. Gerencia no recibe nada que revisar.';
  };

  keepEdgesDrawn(canvas, apply);
  input.addEventListener('input', apply);
}
