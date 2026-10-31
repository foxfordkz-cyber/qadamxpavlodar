import assert from 'node:assert/strict';
import { test } from 'node:test';
import { postgresFixture } from './workflow-helpers.js';
import { sqliteParity } from './stage-e-helpers.js';
import { geocodeBudget } from '../../src/cloud/geocode.js';

test('E1 geocode: attributed search, PostgreSQL/SQLite HTTP parity and bounded access', {timeout:180000}, async t => {
  const f=await postgresFixture(t), sql=await sqliteParity(t,f);
  await t.test('RU/KK, address, street, place, zone, noise and unknown query preserve exact DTOs',async()=>{
    for(const q of ['Торайгырова 1/5',' Торайғыров көшесі ','улица Кривенко','Лермонтова','собор','abc','Павлодар','1/5',"'; DROP TABLE gp_cloud.documents; --",'%_']) {
      const path='/geocode?q='+encodeURIComponent(q),pg=await f.request(path,'GET','viewer'),sqlite=await sql.request(path,'GET','viewer');
      assert.equal(pg.status,200);assert.equal(sqlite.status,200);assert.deepEqual(pg.body,sqlite.body,q);
      assert(pg.body.data.length<=8);assert.deepEqual((await f.request(path,'GET','viewer')).body,pg.body);
      for(const hit of pg.body.data)assert(!('keys' in hit)&&!('house' in hit)&&!('rank' in hit));
    }
    assert((await f.ok('/geocode?q='+encodeURIComponent('Торайгырова 1/5'))).some((x:any)=>x.kind==='address'));
    assert.equal((await f.db.pool.query("SELECT count(*)::int n FROM gp_cloud.documents WHERE kind='site'")).rows[0].n,114);
  });
  await t.test('strict query, authentication and worker/foreman boundary',async()=>{
    for(const query of ['', '?q=', '?q='+encodeURIComponent(' '.repeat(5)), '?q='+'x'.repeat(101),'?q=a&q=b','?q=abc&limit=100']) {
      const pg=await f.request('/geocode'+query),sqlite=await sql.request('/geocode'+query);
      assert.equal(pg.status,400);assert.equal(sqlite.status,400);
    }
    assert.equal((await fetch(f.base+'/geocode?q=abc')).status,401);
    for(const role of ['worker','foreman']){
      await f.createUser('geocode-'+role,role);
      assert.equal((await f.request('/geocode?q=abc','GET','geocode-'+role)).status,403);
    }
  });
  await t.test('PostgreSQL zone changes are searchable immediately and survive both-process restart/reseed',async()=>{
    // Only the isolated DEMO database. This is reference persistence, not a fabricated OSM address.
    await f.db.pool.query(`INSERT INTO gp_cloud.documents VALUES ('site','search-demo',$1,1)`,[JSON.stringify({id:'search-demo',name:'Сынақ Demo search',centroid:{lat:52.28,lng:76.95},version:1})]);
    const path='/geocode?q='+encodeURIComponent('Сынақ'),before=(await f.request(path)).body;
    assert.equal(before.data[0].zoneId,'search-demo');
    await f.restart();await f.reseed();assert.deepEqual((await f.request(path)).body,before);
  });
  await t.test('real HTTP per-account budget returns structured 429 and leaves another role usable',async()=>{
    for(let i=0;i<60;i++)assert.equal((await f.request('/geocode?q=abc','GET','admin')).status,200);
    assert.equal((await f.request('/geocode?q=abc','GET','admin')).body.error.code,'GEOCODE_RATE_LIMIT');
    const session=f.sessions.get('admin')!;
    const blocked=await fetch(f.base+'/geocode?q=abc',{headers:{Cookie:session.cookie}});
    assert.equal(blocked.status,429);assert(Number(blocked.headers.get('retry-after'))>0);
    assert.equal((await f.request('/geocode?q=abc','GET','viewer')).status,200);
  });
});

test('E1 search budget bounds unique actors and recovers at the next window',()=>{
  let at=0;const budget=geocodeBudget(()=>at);
  for(let i=0;i<600;i++)assert.equal(budget('user-'+i),0);
  assert.equal(budget('new-user'),60);at=60000;assert.equal(budget('new-user'),0);
  for(let i=1;i<60;i++)assert.equal(budget('new-user'),0);
  assert.equal(budget('new-user'),60);
});
