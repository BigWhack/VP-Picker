import { openDb, type Db } from '../../server/db/client.js';
export function testDb(): Db {
  return openDb(':memory:');
}
