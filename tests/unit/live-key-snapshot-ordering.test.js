import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../../src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js',import.meta.url),'utf8');
function setup(){
 const section=source.slice(source.indexOf('// Refresh on persisted usage events'));
 const effect=section.slice(section.indexOf('useEffect(() => {')+'useEffect(() => {'.length,section.indexOf('  }, []);'));
 let callback,stream,resolve;
 const updates=[],cache=[];
 const revision={current:0};
 let reads=0;
 const cleanup=vm.runInNewContext('(function(){'+effect+'\n})()',{
   AbortController,document:{hidden:false,addEventListener(){},removeEventListener(){}},keyReadRevisionRef:revision,
   fetch:()=>{reads++;return new Promise(r=>{resolve=r;});},
   EventSource:class {constructor(){stream=this;}close(){this.closed=true;}},
   setInterval:fn=>{callback=fn;return 1;},clearInterval(){},
   writeCache:(key,value)=>cache.push(value),setKeys:keys=>updates.push(keys),
 });
 return {revision,updates,cache,cleanup,get stream(){return stream;},get reads(){return reads;},poll:()=>callback(),resolve:keys=>resolve({ok:true,json:async()=>({keys})})};
}
describe('live API key snapshot ordering',()=>{
 it('serializes event and timer reads to avoid older snapshots racing newer ones',async()=>{
   const env=setup();const first=env.stream.onmessage();
   await env.poll();expect(env.reads).toBe(1);
   env.resolve([{usedOutputTokens:3}]);await first;
   expect(env.updates[0][0].usedOutputTokens).toBe(3);env.cleanup();
 });
 it('discards a read superseded by a newer key refresh or edit',async()=>{
   const env=setup();const old=env.poll();env.revision.current++;
   env.resolve([{usedOutputTokens:0}]);await old;
   expect(env.updates).toEqual([]);expect(env.cache).toEqual([]);env.cleanup();
 });
 it('never applies a snapshot after leaving the page',async()=>{
   const env=setup();const old=env.poll();env.cleanup();env.resolve([{usedOutputTokens:0}]);await old;
   expect(env.updates).toEqual([]);expect(env.stream.closed).toBe(true);
 });
});
