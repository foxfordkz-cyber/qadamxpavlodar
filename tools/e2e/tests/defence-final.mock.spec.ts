import { test, expect } from '../support/test';
import { zoneToDocument } from '../support/final-journey';
import { openPage, dismissHint } from '../support/helpers';

for (const lang of ['ru','kk'] as const) test(`defence journey: ${lang}, site → recommendation/cost → growth → DOCX/XML`, async ({page}) => {
  await zoneToDocument(page, 'mock', lang);
});

for (const lang of ['ru','kk'] as const) test(`mobile assistant: ${lang}, cost and primary actions stay uncovered at 375px`, async ({page}, info) => {
  // This requirement is exercised in every project without a technical skip.
  await page.setViewportSize({width:375,height:812});
  const records: unknown[] = [];
  for (const [route, selector] of [
    ['/', '.gp-hero .gp-plansum:not(.gp-plansum--place) dd, .gp-hero .gp-btn-row a'],
    ['/lab', '.gp-lab-card [data-metric=spent], .gp-lab-card .gp-lab-map, .gp-lab-controls > button.gp-btn'],
    ['/outcomes', '.gp-outcomes__main-metric dd, .gp-outcome-save button'],
  ]) {
    await openPage(page, route, 'mock', lang); await dismissHint(page);
    const inspect = async (step: string) => {
      const collisions = await page.locator(selector).evaluateAll((elements, step) => {
        const floating = document.querySelector('.gp-assist-fab');
        if (!floating || getComputedStyle(floating).display === 'none') return [];
        const f = floating.getBoundingClientRect();
        return elements.flatMap(el => {
          // Text rectangles exclude the deliberate empty padding beside prices.
          // Buttons retain their whole hit area; a round FAB is checked by real hit testing.
          const boxes: DOMRect[] = [];
          if (el.matches('button,a')) boxes.push(el.getBoundingClientRect());
          else {
            const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
            let node: Node|null;
            while ((node=walker.nextNode())) if (node.textContent?.trim()) {
              const range=document.createRange(); range.selectNodeContents(node); boxes.push(...range.getClientRects());
            }
          }
          return boxes.flatMap(b => {
          if (!b.width || !b.height || b.top >= innerHeight || b.bottom <= 0) return [];
          const width = Math.max(0, Math.min(b.right,f.right,innerWidth)-Math.max(b.left,f.left,0));
          const height = Math.max(0, Math.min(b.bottom,f.bottom,innerHeight)-Math.max(b.top,f.top,0));
          const left=Math.max(b.left,f.left,0),top=Math.max(b.top,f.top,0);
          const covered=width*height>0 && [0.2,0.5,0.8].some(x=>[0.2,0.5,0.8].some(y=>
            document.elementFromPoint(left+width*x,top+height*y)?.closest('.gp-assist-fab')));
          return covered ? [{step,label:el.textContent?.trim(),intersectionPx:width*height,
            content:{left:b.left,right:b.right,top:b.top,bottom:b.bottom},assistant:{left:f.left,right:f.right,top:f.top,bottom:f.bottom}}] : [];
          });
        });
      }, step);
      records.push({route,step,collisions});
      expect.soft(collisions, `${route} ${step}: assistant covers a cost or important action`).toEqual([]);
    };
    await inspect('initial completed page');
    const important = page.locator(selector);
    expect(await important.count()).toBeGreaterThan(0);
    for (let i=0;i<await important.count();i++) {
      await important.nth(i).scrollIntoViewIfNeeded();
      await inspect(`action/cost ${i+1} in view`);
    }
  }
  await info.attach('assistant-intersections', {body:JSON.stringify(records,null,2),contentType:'application/json'});
});
