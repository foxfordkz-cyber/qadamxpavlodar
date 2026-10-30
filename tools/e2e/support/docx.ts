import { expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';

export async function inspectDocx(page: Page, path: string) {
  const bytes = await readFile(path);
  expect(bytes.length).toBeGreaterThan(5 * 1024);
  expect(bytes.subarray(0, 2).toString()).toBe('PK');
  const archive = unzipSync(bytes);
  for (const required of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml']) expect(archive[required], required).toBeDefined();
  const parts = Object.entries(archive).filter(([name]) => /\.(xml|rels)$/.test(name)).map(([name, value]) => [name, strFromU8(value)]);
  const parsed = await page.evaluate(parts => {
    const documents = parts.map(([name, xml]) => ({ name, doc: new DOMParser().parseFromString(xml, 'application/xml') }));
    const invalid = documents.filter(({ doc }) => doc.querySelector('parsererror')).map(({ name }) => name);
    const doc = documents.find(({ name }) => name === 'word/document.xml')!.doc;
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const text = (node: Element) => [...node.getElementsByTagNameNS(ns, 't')].map(n => n.textContent).join('');
    return { invalid, root: doc.documentElement.localName, namespace: doc.documentElement.namespaceURI,
      text: [...doc.getElementsByTagNameNS(ns, 'p')].map(text).join('\n'),
      tables: [...doc.getElementsByTagNameNS(ns, 'tbl')].map(table => [...table.getElementsByTagNameNS(ns, 'tr')]
        .map(row => [...row.getElementsByTagNameNS(ns, 'tc')].map(text))),
    };
  }, parts);
  expect(parsed.invalid, 'All DOCX XML parts must parse').toEqual([]);
  expect(parsed.root).toBe('document');
  expect(parsed.namespace).toBe('http://schemas.openxmlformats.org/wordprocessingml/2006/main');
  expect(parsed.text).not.toMatch(/undefined|NaN|\{\w+\}/);
  return parsed;
}
