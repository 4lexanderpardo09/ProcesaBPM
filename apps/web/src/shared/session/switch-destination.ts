/**
 * Where this tab goes after it moves to another organization itself (the page of an e-mail link). A change of identity
 * sends every tab home; the tab that asked for it goes here instead, once.
 */
let destination: string | undefined;

export function setSwitchDestination(to: string): void {
  destination = to;
}

export function takeSwitchDestination(): string | undefined {
  const taken = destination;
  destination = undefined;
  return taken;
}
