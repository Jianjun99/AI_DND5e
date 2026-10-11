// Presentation-only projection of this confirmed mechanical commit; never log prose.
function project(before,after,events,action,actionId) {
  const result=[],push=(entityId,animation)=>result.push({entityId,animation,eventId:actionId+':visual:'+result.length});
  for(const event of events){
    const data=event.data;
    if(!['attack','attack_in','miss','spell_hit'].includes(event.type)||!data?.targetId)continue;
    let actor=data.attackerId;
    if(!actor&&['attack','cast'].includes(action.type)&&data.targetId===action.targetId)actor='player';
    if(actor)push(actor,event.type==='spell_hit'||(actor==='player'&&action.type==='cast')?'cast':'attack');
  }
  for(const next of after){const previous=before.find(e=>e.id===next.id);if(!previous||previous.alive===false||next.fled)continue;
    if(next.hp<previous.hp)push(next.id,'hit');
    if(next.alive===false)push(next.id,'death');
  }
  return result;
}
module.exports={project};
