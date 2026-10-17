import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { QrCode } from './QrCode';

describe('QrCode', () => {
  it('is an image with its label, drawn in the page', () => {
    render(<QrCode value="otpauth://totp/x?secret=ABC" label="Código QR para tu app de autenticación" />);
    const image = screen.getByRole('img', { name: 'Código QR para tu app de autenticación' });
    expect(image.tagName.toLowerCase()).toBe('svg');
    expect(image.querySelector('path')?.getAttribute('d')).toMatch(/^M/);
  });
});
