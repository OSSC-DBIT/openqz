import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PasswordInput } from '../components/ui';

describe('PasswordInput', () => {
  it('starts hidden, shows on click and hides again', async () => {
    const user = userEvent.setup();
    render(
      <label>
        Password
        <PasswordInput label="Password" defaultValue="secret" />
      </label>,
    );

    const input = screen.getByLabelText('Password', { selector: 'input' });
    expect(input).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: 'Show Password' }));
    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByRole('textbox', { name: /^Password$/ })).toBe(input);
    // Chromium adds the nested toggle button's name to the label text, so keep an explicit name.
    expect(input).toHaveAttribute('aria-label', 'Password');

    await user.click(screen.getByRole('button', { name: 'Hide Password' }));
    expect(input).toHaveAttribute('type', 'password');
  });
});
