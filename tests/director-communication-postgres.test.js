import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

test('communication migration, version check and approval constraints on isolated PostgreSQL schema', {
  skip: process.env.TEST_COMMUNICATION_DB !== '1', timeout: 15000,
}, async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  const schema = `communication_test_${randomUUID().replaceAll('-', '')}`;
  assert.match(schema, /^communication_test_[a-f0-9]{32}$/);
  await client.connect();
  try {
    // Everything, including schema creation, is rolled back. Application tables are never written.
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query(await readFile(new URL('../prisma/migrations/20261110120000_director_communication/migration.sql', import.meta.url), 'utf8'));
    await client.query(`INSERT INTO work_order_proposal (id,"authorId","authorName",data,"updatedAt") VALUES ('p','a','Author','{"title":"Test"}',NOW())`);
    const first = await client.query(`UPDATE work_order_proposal SET status='NA_PREGLEDU',version=version+1 WHERE id='p' AND version=1 RETURNING version`);
    const stale = await client.query(`UPDATE work_order_proposal SET status='NA_PREGLEDU',version=version+1 WHERE id='p' AND version=1 RETURNING version`);
    assert.equal(first.rowCount, 1);
    assert.equal(stale.rowCount, 0);
    await client.query('SAVEPOINT invalid_approval');
    await assert.rejects(client.query(`UPDATE work_order_proposal SET status='ODOBREN' WHERE id='p'`), { code: '23514' });
    await client.query('ROLLBACK TO SAVEPOINT invalid_approval');
    await client.query(`UPDATE work_order_proposal SET status='ODOBREN',version=3,"approvedById"='b',"approvedAt"=NOW(),"approvedVersion"=3 WHERE id='p'`);
    await client.query(`INSERT INTO proposal_event (id,"proposalId","actorId","actorName",action,version,snapshot) VALUES ('e','p','b','Director','approve',3,'{"title":"Test"}')`);
    assert.equal((await client.query('SELECT snapshot FROM proposal_event')).rows[0].snapshot.title, 'Test');
    await client.query(`INSERT INTO proposal_event (id,"proposalId","actorId","actorName",action,version,snapshot,"createdAt") VALUES ('submitted','p','a','Author','submit',2,'{"title":"Prvobitni naziv"}','2026-11-10T08:00:00')`);
    await client.query(await readFile(new URL('../prisma/migrations/20261110140000_proposal_messages/migration.sql', import.meta.url), 'utf8'));
    const announcement = (await client.query(`SELECT * FROM director_message WHERE "proposalId"='p'`)).rows[0];
    assert.equal(announcement.proposalVersion, 2);
    assert.equal(announcement.authorId, 'a');
    assert.ok(announcement.body.includes('Prvobitni naziv'));
    assert.equal(announcement.createdAt.toISOString(), new Date('2026-11-10T08:00:00').toISOString());
    await client.query('SAVEPOINT duplicate_announcement');
    await assert.rejects(client.query(`INSERT INTO director_message (id,"authorId","authorName",body,"proposalId","proposalVersion") VALUES ('duplicate','a','Author','Duplicate','p',2)`), { code: '23505' });
    await client.query('ROLLBACK TO SAVEPOINT duplicate_announcement');
    await client.query(`INSERT INTO proposal_event (id,"proposalId","actorId","actorName",action,version,snapshot) VALUES
      ('created','p','a','Author','create',1,'{"title":"Prvobitni naziv"}'),
      ('unchanged','p','a','Author','edit',4,'{"title":"Prvobitni naziv","labels":{"workerId":"Name"}}'),
      ('changed','p','a','Author','edit',5,'{"title":"Izmenjeni naziv"}'),
      ('approved-again','p','b','Director','approve',6,'{"title":"Izmenjeni naziv"}')`);
    await client.query(`UPDATE work_order_proposal SET version=6,"approvedVersion"=6,data='{"title":"Izmenjeni naziv"}' WHERE id='p'`);
    await client.query(await readFile(new URL('../prisma/migrations/20261110150000_proposal_content_versions/migration.sql', import.meta.url), 'utf8'));
    const versions = await client.query(`SELECT id,"contentVersion" FROM proposal_event ORDER BY version`);
    assert.deepEqual(versions.rows.map(row => row.contentVersion), [1, 1, 1, 1, 2, 2]);
    const contentVersion = (await client.query(`SELECT version,"contentVersion","approvedVersion" FROM work_order_proposal WHERE id='p'`)).rows[0];
    assert.deepEqual(contentVersion, { version: 6, contentVersion: 2, approvedVersion: 6 });
    assert.ok((await client.query(`SELECT body FROM director_message WHERE "proposalId"='p'`)).rows[0].body.endsWith('Verzija: 1'));
    await client.query(`INSERT INTO director_message (id,"authorId","authorName",body) VALUES ('m','a','Author','Poruka')`);
    await client.query(`INSERT INTO director_notification (id,"userId","messageId",title) VALUES ('n','b','m','Nova poruka')`);
    assert.equal((await client.query(`UPDATE director_notification SET "readAt"=NOW() WHERE id='n' AND "userId"='other'`)).rowCount, 0);
    assert.equal((await client.query(`SELECT "readAt" FROM director_notification WHERE id='n'`)).rows[0].readAt, null);
    const tables = await client.query('SELECT table_name FROM information_schema.tables WHERE table_schema=$1', [schema]);
    assert.equal(tables.rows.length, 4);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});
