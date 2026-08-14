import type { Locator, Page } from '@playwright/test';

/**
 * Two fingers moving apart on an element.
 *
 * Playwright's touchscreen taps and nothing else, and multi-touch is a
 * Chromium-only protocol call — neither reaches WebKit, which is the engine the
 * gesture was written for. What the photo actually listens to is **pointer**
 * events, so the gesture is dispatched as the pair of pointers the component
 * would receive: `pointerdown` twice is what turns a drag into a pinch, and the
 * moves that follow are what it measures.
 */
export async function pinchApart(target: Locator): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error('Nothing to pinch: the element has no box');

  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const from = Math.min(box.width, box.height) / 8;

  await target.dispatchEvent('pointerdown', finger(1, x - from, y));
  await target.dispatchEvent('pointerdown', finger(2, x + from, y));

  // Several steps rather than one jump: the component scales from the ratio
  // between spans, and a gesture is a series of them.
  for (const spread of [1.5, 2, 3]) {
    await target.dispatchEvent('pointermove', finger(2, x + from * spread, y));
  }

  await target.dispatchEvent('pointerup', finger(2, x + from * 3, y));
  await target.dispatchEvent('pointerup', finger(1, x - from, y));
}

function finger(pointerId: number, clientX: number, clientY: number): Record<string, unknown> {
  return {
    pointerId,
    pointerType: 'touch',
    isPrimary: pointerId === 1,
    // Left button, because the photo ignores any other — a pinch reported as a
    // secondary press would be dropped before it started.
    button: 0,
    buttons: 1,
    clientX,
    clientY,
    bubbles: true,
    cancelable: true,
    composed: true,
  };
}

/**
 * Drags an element downwards, the way a sheet is put away.
 *
 * The real mouse rather than dispatched events: the grip captures its pointer,
 * and capture only behaves like capture when the browser is the one routing the
 * events.
 */
export async function dragDown(page: Page, target: Locator, distance: number): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error('Nothing to drag: the element has no box');

  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  await page.mouse.move(x, y);
  await page.mouse.down();
  // Steps, because a single move past the threshold carries no speed, and the
  // sheet decides where to land from both.
  for (let travelled = 10; travelled <= distance; travelled += 20) {
    await page.mouse.move(x, y + travelled);
  }
  await page.mouse.up();
}
