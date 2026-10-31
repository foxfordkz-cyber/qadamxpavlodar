import { readFileSync } from 'node:fs';
import { web } from '../tz/shared.js';
import { siteToV2, contextToV2, catalogFromSpecies } from '../tz/seed.js';
import { speciesEvidence, priceEvidence, pavlodarEvidence } from '../municipal/vendor/species.js';
import { contextEvidence } from '../municipal/vendor/context.js';
import { PostgresDatabase } from './database.js';

/** Explicit demo bootstrap from the SAME checked-in OSM/reference inputs as seed:tz/municipal.
 * No SQLite connection, user database import, request-time mock or overwrite of existing records.
 */
export async function seedCloudPlanning(db: PostgresDatabase) {
  const fixture = web.seed(), at = web.osmMeta.generatedAt;
  const municipal = JSON.parse(readFileSync(new URL('../../fixtures/sites.json',import.meta.url),'utf8'));
  await db.transaction(async c => {
    await c.query('SELECT pg_advisory_xact_lock(733112622)');
    await c.query('SELECT pg_advisory_xact_lock(733112623)');
    const add = async (kind:string,id:string,data:unknown,version=1,position=0) =>
      c.query('INSERT INTO gp_cloud.planning_documents VALUES ($1,$2,$3,$4,$5) ON CONFLICT(kind,id) DO NOTHING',
        [kind,id,JSON.stringify(data),version,position]);
    for (const e of fixture.evidence) {
      const doc={id:e.id,sourceType:e.sourceType,sourceLabel:e.sourceLabel,sourceUrl:e.sourceUrl??null,
        observedAt:e.observedAt??null,validUntil:e.validUntil??null,dataClass:e.dataClass,note:e.note??null,
        ...(e.publishedAt!==undefined?{publishedAt:e.publishedAt}:{}),version:1};
      await c.query("INSERT INTO gp_cloud.documents VALUES ('evidence',$1,$2,1) ON CONFLICT(kind,id) DO NOTHING",[doc.id,JSON.stringify(doc)]);
    }
    for (const site of fixture.sites) {
      const inserted=await add('site',site.id,siteToV2(site,at),site.version??1);
      // Never recalculate contexts from the original fixture over a human-edited zone.
      if (inserted.rowCount) {
        await add('context',`context-${site.id}`,contextToV2(site,at));
        for (const radius of [30,50,100,200])
          await c.query('INSERT INTO gp_cloud.zone_contexts(site_id,radius,site_version,data) VALUES ($1,$2,$3,$4)',
            [site.id,radius,site.version??1,JSON.stringify(web.siteContext(site,radius))]);
      }
    }
    for (const [i,sp] of web.species.entries()) {
      await add('species',sp.id,sp,1,i);
      await add('catalog',sp.id,catalogFromSpecies(sp));
    }
    await add('settings','site-order',{ids:municipal.sites.map((site:{id:string})=>site.id)});
    await add('settings','rates',{rates:fixture.rates,version:1});
    await add('settings','sources',{sources:[...municipal.evidence,speciesEvidence,priceEvidence,contextEvidence,...pavlodarEvidence]});
    await add('settings','osm',{osm:web.osmMeta});
    await add('settings','reference-facts',web.referenceFacts());
    // Imported soil is distinct from the explicitly synthetic display grid.
    await add('settings','imported-soils',{features:[]});
    await add('layer','soils',{data:web.soilsLayer().data,meta:{synthetic:true,empty:false,note:'No organizer soil layer unless imported. Analytics demo soil is explicitly synthetic.'}});
    await add('layer','greenery',{data:{type:'FeatureCollection',features:web.greeneryLayer().data.features},meta:{synthetic:false,empty:false,note:'Imported data plus attributed OSM snapshot where available'}});
    for (const layer of ['city','zones']) await add('layer',layer,{data:{type:'FeatureCollection',features:[]},meta:{synthetic:false,empty:true,note:'Imported data plus attributed OSM snapshot where available'}});
  });
}
