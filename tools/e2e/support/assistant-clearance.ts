import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';

/** Inspect rendered text/controls, not empty padding or merely page scrollWidth. */
export async function inspectAssistantClearance(targets: Locator, label: string, info: TestInfo, initialFrame = false) {
  expect(await targets.count(), `${label}: required content exists`).toBeGreaterThan(0);
  const result = await targets.evaluateAll(elements => {
    const launcher = document.querySelector('.gp-assist-fab');
    if (!launcher) return { missingLauncher: true, inspected: 0, collisions: [] };
    const assistant = launcher.getBoundingClientRect();
    let inspected = 0;
    const collisions = elements.flatMap(element => {
      const boxes: DOMRect[] = [];
      if (element.matches('input,button,a,select,summary')) boxes.push(element.getBoundingClientRect());
      else {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) if (node.textContent?.trim()) {
          const range = document.createRange();
          range.selectNodeContents(node);
          boxes.push(...range.getClientRects());
        }
      }
      return boxes.flatMap(box => {
        if (!box.width || !box.height || box.bottom <= 0 || box.top >= innerHeight || box.right <= 0 || box.left >= innerWidth) return [];
        inspected++;
        const left = Math.max(0, box.left, assistant.left), top = Math.max(0, box.top, assistant.top);
        const right = Math.min(innerWidth, box.right, assistant.right), bottom = Math.min(innerHeight, box.bottom, assistant.bottom);
        if (right <= left || bottom <= top) return [];
        const covered = [0.15, 0.5, 0.85].some(x => [0.15, 0.5, 0.85].some(y =>
          document.elementFromPoint(left + (right - left) * x, top + (bottom - top) * y)?.closest('.gp-assist-fab')));
        return covered ? [{ text: element.textContent?.trim(), target: box.toJSON(), launcher: assistant.toJSON() }] : [];
      });
    });
    return { missingLauncher: false, inspected, collisions };
  });
  await info.attach(`assistant-clearance-${label}`, { body: JSON.stringify(result), contentType: 'application/json' });
  expect(result.missingLauncher, `${label}: assistant is retained`).toBe(false);
  // The initial mobile viewport can end above a table. The subsequent deliberate
  // scrolls must inspect visible content; initial frames still catch any overlap.
  if (!initialFrame) expect(result.inspected, `${label}: inspect actual visible content`).toBeGreaterThan(0);
  expect.soft(result.collisions, `${label}: assistant must not intercept the content`).toEqual([]);
}

export async function centerContent(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  await target.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
}

export async function expectUsableAssistant(page: Page) {
  const launcher = page.locator('.gp-assist-fab');
  await launcher.scrollIntoViewIfNeeded();
  await expect(launcher).toBeVisible();
  await launcher.click();
  await expect(page.locator('#gp-assistant-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#gp-assistant-panel')).toHaveCount(0);
}

/** A slider/value must be the browser's actual hit target across its visible width. */
export async function expectHitTarget(target: Locator, label: string) {
  await expect(target).toBeInViewport({ ratio: 1 });
  const hits = await target.evaluate(element => {
    const box = element.getBoundingClientRect();
    return [0.08, 0.5, 0.92].map(fraction => {
      const hit = document.elementFromPoint(box.left + box.width * fraction, box.top + box.height / 2);
      return { fraction, accessible: hit === element || !!hit && element.contains(hit), hit: hit?.tagName ?? null };
    });
  });
  expect(hits.every(hit => hit.accessible), `${label}: ${JSON.stringify(hits)}`).toBe(true);
}
