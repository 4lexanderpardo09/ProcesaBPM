export type WorkflowProblemSeverity = 'error' | 'warning';

export interface WorkflowProblem {
  readonly code: string;
  readonly severity: WorkflowProblemSeverity;
  readonly stepId?: string;
  readonly transitionId?: string;
  readonly fieldId?: string;
  readonly amountRuleId?: string;
  /** Values the UI needs to explain the problem (field code, block names, zod issues…). */
  readonly params?: Readonly<Record<string, string | number | readonly string[]>>;
}

export interface WorkflowValidation {
  readonly errors: readonly WorkflowProblem[];
  readonly warnings: readonly WorkflowProblem[];
}

type Location = Pick<WorkflowProblem, 'stepId' | 'transitionId' | 'fieldId' | 'amountRuleId' | 'params'>;

/** Collects problems in the order the rules find them (deterministic). */
export class ProblemCollector {
  private readonly all: WorkflowProblem[] = [];

  error(code: string, location: Location = {}): void {
    this.all.push({ code, severity: 'error', ...location });
  }

  warning(code: string, location: Location = {}): void {
    this.all.push({ code, severity: 'warning', ...location });
  }

  result(): WorkflowValidation {
    return { errors: this.all.filter((problem) => problem.severity === 'error'), warnings: this.all.filter((problem) => problem.severity === 'warning') };
  }
}
