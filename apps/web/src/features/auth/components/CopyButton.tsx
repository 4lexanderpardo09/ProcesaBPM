import { useState } from 'react';
import { Button, CopyIcon } from '@/shared/ui';

export interface CopyButtonProps {
  readonly text: string;
  readonly label: string;
  readonly copiedLabel: string;
}

/** Copies the text to the clipboard and says so in place (polite live region). */
export function CopyButton({ text, label, copiedLabel }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    navigator.clipboard.writeText(text).then(
      () => setCopied(true),
      // No clipboard permission: the text stays on screen to copy by hand.
      () => setCopied(false),
    );
  return (
    <Button variant="ghost" icon={<CopyIcon size={15} />} onClick={() => void copy()} aria-live="polite">
      {copied ? copiedLabel : label}
    </Button>
  );
}
