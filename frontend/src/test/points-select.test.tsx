import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { POINTS_MAX, PointsSelect } from '../components/PointsSelect';
import { MARKS, POINTS, POINT_PRESETS } from '../components/units';

describe('PointsSelect (points per question, with a custom value for clubs)', () => {
  it('passes a preset straight through', async () => {
    const onChange = vi.fn();
    render(<PointsSelect aria-label="Points" value="1" onChange={onChange} unit={POINTS} presets={POINT_PRESETS} custom max={POINTS_MAX} />);
    await userEvent.selectOptions(screen.getByLabelText('Points'), '20');
    expect(onChange).toHaveBeenCalledWith('20');
  });

  it('sets any value with "Custom..." and lists it next to the presets', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<PointsSelect aria-label="Points" value="10" onChange={onChange} unit={POINTS} presets={POINT_PRESETS} custom max={POINTS_MAX} />);
    await userEvent.selectOptions(screen.getByLabelText('Points'), 'custom');
    expect(onChange).not.toHaveBeenCalled(); // nothing changes until a value is set
    screen.getByRole('dialog', { name: 'Custom points' });
    const box = screen.getByRole('spinbutton');
    expect((box as HTMLInputElement).value).toBe('10'); // starts from the current value

    await userEvent.clear(box);
    await userEvent.type(box, '1500');
    expect(screen.getByRole('alert').textContent).toMatch(/0 to 1000/);
    expect((screen.getByRole('button', { name: 'Set points' }) as HTMLButtonElement).disabled).toBe(true);

    await userEvent.clear(box);
    await userEvent.type(box, '250');
    await userEvent.click(screen.getByRole('button', { name: 'Set points' }));
    expect(onChange).toHaveBeenCalledWith('250');
    expect(screen.queryByRole('dialog')).toBeNull();

    rerender(<PointsSelect aria-label="Points" value="250" onChange={onChange} unit={POINTS} presets={POINT_PRESETS} custom max={POINTS_MAX} />);
    expect(screen.getByRole('option', { name: '250 points' })).toBeTruthy();
  });

  it('offers no custom value to teachers', () => {
    render(<PointsSelect aria-label="Marks" value="1" onChange={() => {}} unit={MARKS} presets={[0, 1, 2]} />);
    expect(screen.queryByRole('option', { name: 'Custom...' })).toBeNull();
    expect(screen.getByRole('option', { name: '1 mark' })).toBeTruthy();
  });
});
