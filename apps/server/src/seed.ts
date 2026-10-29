import { Store, present } from './db.js';

export const DEMO_TIME = '2026-10-27T00:00:00.000Z';
export function seed(store: Store) {
  store.transaction(() => {
    // No UPDATE, DELETE, REPLACE, or INSERT OR IGNORE: preserve user edits,
    // while surfacing all constraint errors other than an existing primary key.
    const add = (sql: string, ...args: (string | number | null)[]) => store.run(sql, ...args);
    add('INSERT INTO users VALUES (?,?,?,1) ON CONFLICT(id) DO NOTHING', 'demo-coordinator-1', 'DEMO Координатор 1', 'coordinator');
    for (let i = 1; i <= 3; i++) {
      add('INSERT INTO users VALUES (?,?,?,1) ON CONFLICT(id) DO NOTHING', `demo-worker-${i}`, `DEMO Работник ${i}`, 'worker');
    }
    for (let i = 1; i <= 30; i++) {
      add('INSERT INTO plants VALUES (?,?,?,?,?,?,1) ON CONFLICT(id) DO NOTHING',
        `demo-plant-${i}`, `DEMO Растение ${i}`, ['DEMO Берёза', 'DEMO Тополь', 'DEMO Вяз'][i % 3]!,
        52.27 + i * 0.0002, 76.94 + i * 0.0002, i % 3 === 0 ? 'needs_care' : 'good');
      add('INSERT INTO evidence_refs VALUES (?,?,?,?,?,?,1) ON CONFLICT(id) DO NOTHING',
        `demo-evidence-${i}`, `demo-plant-${i}`, null, 'DEMO Синтетический источник; не городской реестр', null, DEMO_TIME);
    }
    for (let i = 1; i <= 6; i++) {
      add('INSERT INTO candidate_sites VALUES (?,?,?,?,?,1) ON CONFLICT(id) DO NOTHING',
        `demo-site-${i}`, `DEMO Участок ${i}`, 52.28 + i * 0.001, 76.95 + i * 0.001,
        'DEMO: вымышленный участок, координаты приблизительные; не пригодны для полевых работ');
    }
    for (let i = 1; i <= 15; i++) {
      const taskId = `demo-task-${i}`;
      const inserted = add(`INSERT INTO tasks VALUES (?,?,?,?,?,?,'pending',1,?,?,1) ON CONFLICT(id) DO NOTHING`,
        taskId, `DEMO Осмотреть растение ${i}`, `demo-plant-${i}`, null,
        `demo-worker-${(i - 1) % 3 + 1}`, 'demo-coordinator-1', DEMO_TIME, DEMO_TIME);
      if (inserted.changes === 1) {
        add('INSERT INTO task_history VALUES (?,?,?,?,?,?,?,?)',
          `demo-history-${i}`, taskId, 'demo-coordinator-1', null, 'pending', 1,
          JSON.stringify(present(store.get('SELECT * FROM tasks WHERE id=?', taskId)!)), DEMO_TIME);
      }
    }
  });
  return {
    label: 'DEMO — synthetic data, not an official Pavlodar registry',
    plants: store.get('SELECT count(*) AS count FROM plants')?.count,
    candidateSites: store.get('SELECT count(*) AS count FROM candidate_sites')?.count,
    users: store.get('SELECT count(*) AS count FROM users')?.count,
    tasks: store.get('SELECT count(*) AS count FROM tasks')?.count
  };
}
