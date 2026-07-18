import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { AuthService } from '../auth.js';
import { BankrollService } from '../bankroll.js';
import { createDatabase } from '../db/index.js';
import { users } from '../db/schema.js';
import { PersistenceService } from '../persistence.js';

const { db, sqlite } = createDatabase();
const bankroll = new BankrollService(db);
const auth = new AuthService(db, bankroll);
const persistence = new PersistenceService(db);
persistence.currentSeason();

const demoUsers = [
  { email: 'river@example.com', displayName: 'River', password: 'Poker123!' },
  { email: 'button@example.com', displayName: 'Button', password: 'Poker123!' },
];

for (const demo of demoUsers) {
  if (db.select().from(users).where(eq(users.email, demo.email)).get()) continue;
  const id = randomUUID();
  db.insert(users)
    .values({
      id,
      email: demo.email,
      displayName: demo.displayName,
      passwordHash: await auth.createPasswordHash(demo.password),
      createdAt: Date.now(),
    })
    .run();
  bankroll.initializeUser(id);
}

sqlite.close();
console.log('演示账号已创建：river@example.com / Poker123!');
console.log('演示账号已创建：button@example.com / Poker123!');
