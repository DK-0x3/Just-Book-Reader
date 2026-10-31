export function isOutsideDialog(event: MouseEvent, dialog: HTMLElement | undefined): boolean {
  if (!dialog || event.target !== dialog) return false;
  const bounds = dialog.getBoundingClientRect();
  return event.clientX < bounds.left || event.clientX > bounds.right
    || event.clientY < bounds.top || event.clientY > bounds.bottom;
}
