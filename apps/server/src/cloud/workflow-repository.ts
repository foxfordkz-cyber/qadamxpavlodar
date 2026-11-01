import type { Flow } from '../v2/flow.js';
import { PostgresPlanningRepository } from './planning-repository.js';
import { runPostgres } from './workflow-store.js';

export class PostgresWorkflowRepository extends PostgresPlanningRepository {
  async readFlow<T>(flow:Flow<T>):Promise<T> {
    return this.db.transaction(async c=>{
      await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      return runPostgres(c,flow);
    });
  }
}
