import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Avatar } from './Avatar';

describe('Avatar', () => {
  it('shows the initials and stays out of the accessibility tree', () => {
    const { container } = render(<Avatar name="Laura Peña" />);
    const avatar = container.firstElementChild;
    expect(avatar).toHaveTextContent('LP');
    expect(avatar).toHaveAttribute('aria-hidden', 'true');
  });
});
