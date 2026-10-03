/** Limits per client address, checked before the upgrade, in memory (per instance). */
export interface AdmissionLimits {
  /** Connections not yet authenticated (they hold a slot until CONNECT or `connectTimeout`). */
  readonly maxPendingPerAddress: number;
  /** All open connections of one address (generous: many people may share an office NAT). */
  readonly maxOpenPerAddress: number;
  /** New connections per address per window. */
  readonly maxUpgradesPerWindow: number;
  readonly windowMs: number;
}

export const DEFAULT_ADMISSION_LIMITS: AdmissionLimits = {
  maxPendingPerAddress: 50,
  maxOpenPerAddress: 1_000,
  maxUpgradesPerWindow: 600,
  windowMs: 60_000,
};

export type AddressRefusal = 'TOO_MANY_PENDING' | 'TOO_MANY_OPEN' | 'TOO_MANY_UPGRADES';

interface AddressState {
  pending: number;
  open: number;
  windowStartedAt: number;
  upgrades: number;
}

/** One admitted connection: it is counted as pending until it authenticates, and released once when it closes. */
export interface AdmissionTicket {
  authenticated(): void;
  release(): void;
}

/**
 * Bounds what one client address can hold before it has proved anything: without it, a single address could fill the
 * instance with connections that never send CONNECT. State exists only for addresses with open connections or a recent
 * upgrade, so memory is bounded by the traffic itself.
 */
export class ConnectionAdmission {
  private readonly addresses = new Map<string, AddressState>();

  constructor(
    private readonly limits: AdmissionLimits = DEFAULT_ADMISSION_LIMITS,
    private readonly now: () => number = Date.now,
  ) {}

  admit(address: string): AdmissionTicket | AddressRefusal {
    const now = this.now();
    const state = this.stateOf(address, now);
    if (state.pending >= this.limits.maxPendingPerAddress) return 'TOO_MANY_PENDING';
    if (state.open >= this.limits.maxOpenPerAddress) return 'TOO_MANY_OPEN';
    if (state.upgrades >= this.limits.maxUpgradesPerWindow) return 'TOO_MANY_UPGRADES';
    state.upgrades += 1;
    state.pending += 1;
    state.open += 1;
    return this.ticketFor(address, state);
  }

  /** Addresses currently tracked (for tests and stats). */
  get trackedAddresses(): number {
    return this.addresses.size;
  }

  private ticketFor(address: string, state: AddressState): AdmissionTicket {
    let pending = true;
    let open = true;
    return {
      authenticated: () => {
        if (!pending) return;
        pending = false;
        state.pending -= 1;
      },
      release: () => {
        if (!open) return;
        open = false;
        if (pending) state.pending -= 1;
        pending = false;
        state.open -= 1;
        this.forgetIfIdle(address, state, this.now());
      },
    };
  }

  private stateOf(address: string, now: number): AddressState {
    const existing = this.addresses.get(address);
    if (existing !== undefined) {
      if (now - existing.windowStartedAt >= this.limits.windowMs) {
        existing.windowStartedAt = now;
        existing.upgrades = 0;
      }
      return existing;
    }
    this.purgeIdle(now);
    const created: AddressState = { pending: 0, open: 0, windowStartedAt: now, upgrades: 0 };
    this.addresses.set(address, created);
    return created;
  }

  private forgetIfIdle(address: string, state: AddressState, now: number): void {
    if (state.open === 0 && now - state.windowStartedAt >= this.limits.windowMs) this.addresses.delete(address);
  }

  /** Addresses with no open connection whose rate window ended. */
  private purgeIdle(now: number): void {
    for (const [address, state] of this.addresses) this.forgetIfIdle(address, state, now);
  }
}
