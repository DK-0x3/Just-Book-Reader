import { describe, expect, it } from 'vitest';
import { isOutsideDialog } from '../src/ui/dialog';

const dialog = { getBoundingClientRect: () => ({ left: 100, top: 100, right: 400, bottom: 300 }) } as HTMLElement;
function click(x: number, y: number, target: EventTarget = dialog): MouseEvent {
  return { clientX: x, clientY: y, target } as MouseEvent;
}

describe('dialog outside dismissal', () => {
  it('distinguishes backdrop coordinates from clicks on the dialog padding', () => {
    expect(isOutsideDialog(click(50, 200), dialog)).toBe(true);
    expect(isOutsideDialog(click(200, 50), dialog)).toBe(true);
    expect(isOutsideDialog(click(450, 200), dialog)).toBe(true);
    expect(isOutsideDialog(click(200, 350), dialog)).toBe(true);
    expect(isOutsideDialog(click(110, 110), dialog)).toBe(false);
    expect(isOutsideDialog(click(100, 100), dialog)).toBe(false);
  });

  it('ignores other targets and already unmounted dialogs', () => {
    expect(isOutsideDialog(click(50, 50, {} as EventTarget), dialog)).toBe(false);
    expect(isOutsideDialog(click(50, 50), undefined)).toBe(false);
  });
});
