// Load the exact #18 implementation, as the existing tz/shared bridge does.
// The web typecheck validates its source tree; there is no backend formula copy.
export type Json = Record<string, any>;
const url=new URL('../../../web/src/shared/analytics/outcomes.ts',import.meta.url);
const module: Json=await import(url.href);
export const shared = module as {
 createOutcomeSnapshot:(input:Json)=>Json;
 createOutcomeCohort:(input:Json,registry:Json[],asOf:string)=>Json;
 summarizeOutcomeInspection:(cohort:Json,inspection:Json|null,asOf:string)=>Json;
 compareOutcomeForecast:(cohort:Json,inspection:Json|null,asOf:string)=>Json;
};
export const today=()=>new Date(Date.now()+5*3600000).toISOString().slice(0,10);
export const day=(iso:string)=>new Date(Date.parse(iso)+5*3600000).toISOString().slice(0,10);
