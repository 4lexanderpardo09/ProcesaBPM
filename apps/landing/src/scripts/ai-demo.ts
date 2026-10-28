import { keepEdgesDrawn } from './edges';
import { gsap, prefersReducedMotion, ScrollTrigger } from './motion';

const ORDER = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

/** The assistant's real stages run, then the draft appears block by block, each connection drawn as its block lands. */
function play(canvas: HTMLElement): gsap.core.Timeline {
  const stages = [...document.querySelectorAll<HTMLElement>('#ai-stages .stage-pill')];
  const answer = document.getElementById('ai-answer')?.children ?? [];
  const edges = JSON.parse(canvas.dataset['edges'] ?? '[]') as Array<{ from: string; to: string }>;
  const timeline = gsap.timeline();
  timeline.add(() => stages.forEach((stage) => (stage.className = 'stage-pill')));
  timeline.set(answer, { opacity: 0, y: 8 });
  timeline.set(canvas.querySelectorAll('.node, .edge-label'), { opacity: 0, scale: 0.92 });
  timeline.set(canvas.querySelectorAll('svg.edges path'), { opacity: 0 });
  stages.forEach((stage, index) => {
    timeline.add(() => {
      const previous = stages[index - 1];
      if (previous !== undefined) previous.className = 'stage-pill is-done';
      stage.className = 'stage-pill is-live';
    }, `+=${index === 0 ? 0.3 : 0.9}`);
  });
  ORDER.forEach((id, index) => {
    timeline.to(canvas.querySelector(`.node[data-id="${id}"]`), { opacity: 1, scale: 1, duration: 0.35, ease: 'back.out(1.6)' }, index === 0 ? '-=1.6' : '-=0.12');
    for (const edge of edges.filter((candidate) => candidate.to === id)) {
      const path = canvas.querySelector<SVGPathElement>(`path[data-edge="${edge.from}-${edge.to}"]`);
      if (path === null) continue;
      const length = path.getTotalLength();
      timeline.fromTo(path, { opacity: 1, strokeDasharray: length, strokeDashoffset: length }, { strokeDashoffset: 0, duration: 0.35, ease: 'none', clearProps: 'strokeDasharray,strokeDashoffset' }, '<');
    }
  });
  timeline.to(canvas.querySelectorAll('.edge-label'), { opacity: 1, scale: 1, duration: 0.25 });
  timeline.add(() => {
    const last = stages.at(-1);
    if (last !== undefined) last.className = 'stage-pill is-done';
  });
  timeline.to(answer, { opacity: 1, y: 0, stagger: 0.12, duration: 0.35 });
  return timeline;
}

export function startAiDemo(): void {
  const canvas = document.getElementById('ai-canvas');
  const replay = document.getElementById('ai-replay');
  if (canvas === null || replay === null) return;
  keepEdgesDrawn(canvas);
  if (prefersReducedMotion()) return;
  replay.hidden = false;
  let running: gsap.core.Timeline | undefined;
  ScrollTrigger.create({ trigger: canvas, start: 'top 75%', once: true, onEnter: () => (running = play(canvas)) });
  replay.addEventListener('click', () => {
    running?.progress(1).kill();
    running = play(canvas);
  });
}
