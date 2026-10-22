import type { FormFieldResponse } from '@procesabpm/shared';
import { useEffect, useRef } from 'react';
import { useApiClient } from '@/shared/session';
import { lookupDatasetValue } from '../api/field-choices-api';
import type { InputValue } from '../lib/step-values';

const LOOKUP_DELAY_MS = 400;

/** A field filled from a dataset row found by the key typed in another field of the same form (`lookupFieldCode`). */
interface Lookup {
  readonly field: FormFieldResponse;
  readonly keyCode: string;
}

export function lookupsOf(fields: readonly FormFieldResponse[]): Lookup[] {
  const codes = new Set(fields.map((field) => field.code));
  return fields.flatMap((field) => {
    const source = field.dataSource;
    const keyCode = source?.['kind'] === 'DATASET' && typeof source['lookupFieldCode'] === 'string' ? source['lookupFieldCode'] : undefined;
    return keyCode !== undefined && codes.has(keyCode) && keyCode !== field.code ? [{ field, keyCode }] : [];
  });
}

/**
 * When a key field settles on a new value, its dependent fields take the value of the matching dataset row (a typed
 * ID number fills the name). A key with no row leaves them as they are; the API checks the values on sending anyway.
 */
export function useDatasetLookups(fields: readonly FormFieldResponse[], inputs: Readonly<Record<string, InputValue>>, fill: (code: string, value: string) => void) {
  const client = useApiClient();
  const lookups = lookupsOf(fields);
  const asked = useRef<Record<string, string>>({});
  const keys = lookups.map(({ keyCode }) => (typeof inputs[keyCode] === 'string' ? (inputs[keyCode] as string).trim() : '')).join('\u0000');

  useEffect(() => {
    if (lookups.length === 0) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      for (const { field, keyCode } of lookups) {
        const raw = inputs[keyCode];
        const key = typeof raw === 'string' ? raw.trim() : '';
        if (key === '' || asked.current[field.code] === key) continue;
        asked.current[field.code] = key;
        lookupDatasetValue(client, field.id, key, controller.signal)
          .then(({ value }) => {
            if (value !== null) fill(field.code, value);
          })
          .catch(() => undefined);
      }
    }, LOOKUP_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // Only a change of a key field asks again.
  }, [keys]);
}
