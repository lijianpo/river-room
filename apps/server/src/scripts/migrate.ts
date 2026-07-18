import { createDatabase } from '../db/index.js';

const { sqlite } = createDatabase();
sqlite.close();
console.log('数据库迁移完成');
