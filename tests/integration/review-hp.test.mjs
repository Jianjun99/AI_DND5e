// Review regression: real HTTP routes + engine, isolated from player data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { assertTestContainer } from '../../scripts/test-container.mjs';
assertTestContainer();
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dnd-review-hp-'));
const require = createRequire(import.meta.url);
const engine = require('../../server/game/engine.js');
const presets = require('../../server/game/presets.js');
const store = require('../../server/store.js');
const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/characters', require('../../server/routes/characters.js'));
app.use('/api/game', require('../../server/routes/game.js'));
app.use('/api/city', require('../../server/routes/city.js'));
const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
const base = 'http://127.0.0.1:' + server.address().port;
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  PASS: ' + name); }
  catch (error) { failed++; console.error('  FAIL: ' + name + ': ' + error.stack); }
}
async function api(method, url, body) {
  const res = await fetch(base + url, { method, headers: {'Content-Type':'application/json'}, body:body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json(); assert.equal(res.status, 200, JSON.stringify(data)); return data;
}
function draft(species, tough) { return {...presets.draftFor('guardian'), name:'Review HP', species, background:tough ? 'farmer' : 'guard'}; }
function extra(char) { return (char.species === 'dwarf' ? 1 : 0) + (char.feat === 'tough' || char.unlockedFeats?.includes('tough') ? 2 : 0); }
const recalc = char => engine.applyClassAndSpecies(char, null, null, char.level, true);
try {
  for (const species of ['human', 'dwarf']) for (const tough of [false, true]) {
    const title = species + (tough ? ' + Tough' : '');
    await test(title + ': creation, repeated recompute, equipment and temporary modifiers', () => {
      const char = engine.buildCharacter(draft(species, tough));
      const initial = 10 + engine.mod(char.abilities.con) + extra(char);
      assert.equal(char.hpMax, initial);
      for (let n=0; n<6; n++) { recalc(char); assert.equal(char.hpMax, initial); }
      // A real inventory-shaped rolled item: uniqueId is the equipment reference.
      char.inventory.push({itemId:'chain_mail', uniqueId:'review-vigor', qty:1, hpBonus:7});
      char.equipped.armor = 'review-vigor'; recalc(char); assert.equal(char.hpMax, initial+7);
      const state = engine.startGame(char, {mapId:'crypt', bringAlly:false});
      engine.adjustTempHp(state, 4, []); assert.equal(state.character.hpMax, initial+11);
      for (let n=0; n<6; n++) { recalc(state.character); assert.equal(state.character.hpMax, initial+11); }
      state.character.equipped.armor = 'chain_mail'; recalc(state.character); assert.equal(state.character.hpMax, initial+4);
      engine.adjustTempHp(state, -6, []); recalc(state.character); assert.equal(state.character.hpMax, initial-2);
      engine.adjustTempHp(state, 0, [], '', {clear:true}); recalc(state.character); assert.equal(state.character.hpMax, initial);
      const beforeRest = state.character.hpMax;
      Object.assign(engine.playerEntity(state), {x:engine.campfireOf(state).x,y:engine.campfireOf(state).y});
      for (let n=0; n<2; n++) { const events=[]; engine.longRest(state, events); assert.ok(events.some(event=>event.type==='rest')); assert.ok(!events.some(event=>event.type==='error')); }
      assert.equal(state.character.hpMax, beforeRest); assert.equal(engine.playerEntity(state).hpMax, beforeRest);
      assert.equal(char.hpMax, initial+7, 'delve modifiers never mutate roster input');
    });
    await test(title + ': API shield swaps, average upgrades/ASI, long rests and settlement', async () => {
      let char = await api('POST', '/api/characters', draft(species, tough));
      const initial = char.hpMax;
      for (let n=0; n<6; n++) {
        char = (await api('POST', '/api/characters/'+char.id+'/equip', {slot:'offHand',itemId:n%2 ? 'shield' : 'none'})).char;
        assert.equal(char.hpMax, initial); assert.equal(char.level, 1); assert.equal(char.xp, 0);
      }
      const state = (await api('POST', '/api/game/start', {characterId:char.id, mapId:'crypt', bringAlly:false})).state;
      const live = store.getSave(state.id);
      const camp=engine.campfireOf(live), hero=engine.playerEntity(live);
      Object.assign(hero,{x:camp.x,y:camp.y});
      engine.adjustTempHp(live, 4, []); hero.tempHp=3; store.saveGame(live);
      for (const level of [2,3,4]) {
        const roster = store.getCharacters(); const owner = roster.find(c=>c.id===char.id);
        owner.xp = engine.XP_THRESHOLDS[level]; store.saveCharacters(roster);
        const before = char.hpMax, con = engine.mod(char.abilities.con);
        const response = await api('POST', '/api/characters/'+char.id+'/level-up', {hpChoice:'average',featOrAsi:'asi',chosenAbilities:{str:2}});
        char = response.char;
        assert.equal(response.gainedHp, 6+con+extra(char));
        assert.equal(char.hpMax, before+response.gainedHp, 'one real gain, including dwarf/Tough exactly once');
        const saved = store.getSave(state.id), pe = engine.playerEntity(saved);
        assert.equal(saved.character.hpMax, char.hpMax+4); assert.equal(pe.hpMax, char.hpMax+4); assert.equal(pe.hp, char.hpMax+4);
        assert.equal(saved.character.tempHpMod,4); assert.equal(pe.tempHp,3, 'ordinary temporary HP also survives roster synchronization');
        assert.ok(!char.tempHpMod, 'delve modifier never writes into roster');
        recalc(char); assert.equal(char.hpMax, before+response.gainedHp, 'post-upgrade recompute is idempotent');
      }
      for (let n=0; n<3; n++) {
        const res = await api('POST', '/api/game/'+state.id+'/action', {type:'rest',kind:'long'});
        assert.ok(res.events.some(event=>event.type==='rest'), 'real API long rest was accepted');
        assert.ok(!res.events.some(event=>event.type==='error'), 'long rest returned no engine error');
        assert.equal(res.state.character.hpMax, char.hpMax+4);
        assert.equal(res.state.entities.find(e=>e.kind==='player').hpMax, char.hpMax+4);
      }
      await api('POST', '/api/game/'+state.id+'/action', {type:'retreat'});
      await api('POST', '/api/city/sync-delve', {charId:char.id,delveStateId:state.id});
      assert.equal((await api('GET','/api/characters/'+char.id)).hpMax, char.hpMax);
    });
  }
  await test('Tough selected at level 4 is retroactive once; level 5 and recompute do not double it', async () => {
    let char = await api('POST','/api/characters',draft('dwarf',false));
    for (const level of [2,3,4,5]) {
      const roster=store.getCharacters(); roster.find(c=>c.id===char.id).xp=engine.XP_THRESHOLDS[level]; store.saveCharacters(roster);
      const before=char.hpMax, perLevel=6+engine.mod(char.abilities.con)+1+(level===5?2:0);
      const res=await api('POST','/api/characters/'+char.id+'/level-up',{hpChoice:'average',featOrAsi:'feat',chosenFeat:'tough'});
      char=res.char; assert.equal(char.hpMax,before+perLevel+(level===4?8:0));
      recalc(char); assert.equal(char.hpMax,before+perLevel+(level===4?8:0));
    }
  });
  await test('engine real upgrade with ASI rolls one hit die and one dwarf/Tough increment', () => {
    const state=engine.startGame(engine.buildCharacter(draft('dwarf',true)),{mapId:'crypt',bringAlly:false});
    const char=state.character, initial=char.hpMax, con=engine.mod(char.abilities.con);
    char.level=3; char.xp=engine.XP_THRESHOLDS[4];
    // Inject the RNG rather than depend on a particular seed's random output.
    const random=Math.random; Math.random=()=>0.5;
    try { engine.awardXp(state, 0, []); } finally { Math.random=random; }
    assert.equal(char.level,4); assert.equal(char.hpMax,initial+6+con+3);
    recalc(char); assert.equal(char.hpMax,initial+6+con+3);
    assert.equal(engine.playerEntity(state).hpMax,char.hpMax);
  });
} finally {
  await new Promise(resolve=>server.close(resolve));
  fs.rmSync(process.env.DATA_DIR,{recursive:true,force:true});
}
console.log('Review HP: '+passed+' cases passed, '+failed+' failed.'); process.exitCode=failed?1:0;
