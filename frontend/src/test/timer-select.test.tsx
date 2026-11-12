import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TimerSelect } from '../components/TimerSelect';

describe('TimerSelect (question timer with a custom clock)', () => {
  it('passes a preset straight through', async () => {
    const onChange = vi.fn();
    render(<TimerSelect aria-label="Timer" value="" onChange={onChange} />);
    await userEvent.selectOptions(screen.getByLabelText('Timer'), '30');
    expect(onChange).toHaveBeenCalledWith('30');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the clock for "Custom..." and sets minutes and seconds', async () => {
    const onChange = vi.fn();
    render(<TimerSelect aria-label="Timer" value="30" onChange={onChange} />);
    await userEvent.selectOptions(screen.getByLabelText('Timer'), 'custom');
    expect(onChange).not.toHaveBeenCalled(); // nothing changes until a time is set
    const clock = screen.getByRole('dialog', { name: 'Custom time' });
    expect(clock).toBeTruthy();
    // starts from the current timer: 00:30
    expect((screen.getByLabelText('Seconds') as HTMLInputElement).value).toBe('30');

    await userEvent.click(screen.getByRole('button', { name: 'More minutes' }));
    await userEvent.click(screen.getByRole('button', { name: 'More minutes' }));
    await userEvent.click(screen.getByRole('button', { name: '+10 s' }));
    await userEvent.click(screen.getByRole('button', { name: 'Less seconds' }));
    expect((screen.getByLabelText('Minutes') as HTMLInputElement).value).toBe('02');
    expect((screen.getByLabelText('Seconds') as HTMLInputElement).value).toBe('39');
    await userEvent.click(screen.getByRole('button', { name: 'Set timer' }));
    expect(onChange).toHaveBeenCalledWith('159');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lists a custom time next to the presets and refuses times under 5 seconds', async () => {
    render(<TimerSelect aria-label="Timer" value="159" onChange={() => {}} />);
    expect(screen.getByRole('option', { name: '2 min 39 s' })).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText('Timer'), 'custom');
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect((screen.getByRole('button', { name: 'Set timer' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('5 seconds to 60 minutes');
  });

  it('keeps the extra choices of the "for all questions" list', () => {
    render(
      <TimerSelect
        aria-label="Timer for all questions"
        value="keep"
        onChange={() => {}}
        head={[
          ['keep', 'Keep'],
          ['none', 'No timer'],
        ]}
      />,
    );
    expect(screen.getByRole('option', { name: 'Keep' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Custom...' })).toBeTruthy();
  });
});
