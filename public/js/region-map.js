import { contentText, localizeAttribute } from './i18n.js';

// Vector-only presentation symbols. IDs and map geometry remain server-owned.
export function waypointSymbol(marker = 'dungeon') {
  const shapes = {
    city: '<path d="M-12 12V-10h6v5h12v-5h6v22H4V3h-8v9Z"/>',
    endless: '<path d="M0 0c-9-10-18 6-6 12 14 7 26-10 12-22C-7-23-25-5-16 12"/>',
    crypt: '<path d="M-10 5V-5a10 10 0 0 1 20 0V5L6 8v5H-6V8Z"/><path d="M-5-2h1m8 0h1M-3 10v3m6-3v3"/>',
    vault: '<path d="M0-14C-4-6-12 1-12 6a12 12 0 0 0 24 0C12 1 4-6 0-14Z"/>',
    sewers: '<path d="M-12-5h24M-12 3h24M-12 11h24M-8-12v24M0-12v24M8-12v24"/>',
    mill: '<path d="M0-2-10-12-14-8-3 2l-9 10 4 3L3 4l9 8 3-4L4-3l8-9-4-3Z"/>',
    dragon: '<path d="M-12 11-8-5 0-12l4 8 10-2-5 9-7 1-6 8Z"/><path d="m-8-5-6-4M-1-5h2"/>',
    hills: '<path d="m-15 12 10-24 8 15 5-12 9 21ZM-8 4h10"/>',
    gate: '<path d="M-12 12V-12h24v24M-5 12V0a5 5 0 0 1 10 0v12M-12-7h24"/>',
    courier: '<rect x="-14" y="-9" width="28" height="18" rx="2"/><path d="m-13-8 13 10 13-10"/>',
    dungeon: '<path d="M-12 12V-5a12 12 0 0 1 24 0v17ZM-5 12V1a5 5 0 0 1 10 0v11"/>'
  };
  return `<g class="waypoint-symbol" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[marker] || shapes.dungeon}</g>`;
}

const overlap = (a, b, gap = 5) => a.x < b.x+b.w+gap && a.x+a.w+gap > b.x && a.y < b.y+b.h+gap && a.y+a.h+gap > b.y;
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

// Screen-sized text/targets; bounded displacement resolves crowded authored positions.
// All changes touch existing SVG nodes only, including on locale/viewport changes.
export function createRegionMap(svg, nodes) {
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
  let alive = true;
  function refresh() {
    if (!alive || !svg.isConnected) return;
    const rect = svg.getBoundingClientRect(), scale = Math.min(rect.width/1000, rect.height/600);
    if (!(scale > 0)) return;
    const font = 13/scale, radius = 20/scale, gap = 8/scale;
    context.font = `600 ${font}px Georgia, serif`;
    const placed = [], labels = [];
    const ordered = [...nodes].sort((a,b) => Number(!!b.safe)-Number(!!a.safe) || a.id.localeCompare(b.id));
    for (const node of ordered) {
      const origin = { x:clamp(node.x*10,radius+gap,1000-radius-gap), y:clamp(node.y*6,radius+gap,600-radius-gap) };
      let point = origin;
      for (let ring=0; ring<12; ring++) {
        const candidates = ring ? Array.from({length:16},(_,i) => ({ x:clamp(origin.x+Math.cos(i*Math.PI/8)*ring*(radius+gap),radius+gap,1000-radius-gap), y:clamp(origin.y+Math.sin(i*Math.PI/8)*ring*(radius+gap),radius+gap,600-radius-gap) })) : [origin];
        const free = candidates.find(p => placed.every(n => Math.hypot(p.x-n.x,p.y-n.y) >= radius*2+gap));
        if (free) { point=free; break; }
      }
      placed.push({ ...point, node, radius });
    }
    const markers = placed.map(n => ({x:n.x-radius,y:n.y-radius,w:radius*2,h:radius*2}));
    const annotated = placed.map(item => {
      const name = contentText(item.node), maxWidth = 180/scale;
      const width = Math.min(maxWidth,context.measureText(name).width) + 16/scale;
      const lines = [];
      let line = '';
      for (const char of name) {
        if (line && context.measureText(line+char).width > maxWidth) {
          const space = line.lastIndexOf(' ');
          if (space > 0) { lines.push(line.slice(0,space)); line=line.slice(space+1); }
          else { lines.push(line); line=''; }
        }
        line += char;
      }
      if (line) lines.push(line);
      // Arbitrarily long author names remain readable in the directory and title.
      if (lines.length>3) { lines.length=3; lines[2]=lines[2].slice(0,-1)+'…'; }
      const height = Math.max(1,lines.length)*font*1.2 + 10/scale;
      return { ...item, name, width, lines, height };
    }).sort((a,b)=>b.width*b.height-a.width*a.height || a.node.id.localeCompare(b.node.id));
    // Large translated blocks go first so short labels cannot fragment their space.
    for (const item of annotated) {
      const { name, width, lines, height } = item;
      const candidates = [];
      for (let y=gap;y+height<600-gap;y+=14/scale) for (let x=gap;x+width<1000-gap;x+=14/scale) {
        const box={x,y,w:width,h:height};
        if ([...markers,...labels].some(b=>overlap(box,b,gap/2))) continue;
        const dx=x+width/2-item.x, dy=y+height/2-item.y;
        candidates.push({box,score:Math.hypot(dx,dy)+(dy<0?8/scale:0)});
      }
      candidates.sort((a,b)=>a.score-b.score);
      const box=candidates[0]?.box || {x:clamp(item.x-width/2,gap,1000-width-gap),y:clamp(item.y+radius+gap,gap,600-height-gap),w:width,h:height};
      labels.push(box);
      const group = [...svg.querySelectorAll('[data-node-id]')].find(el=>el.getAttribute('data-node-id')===item.node.id);
      group.setAttribute('transform',`translate(${item.x} ${item.y})`);
      group.querySelectorAll('circle').forEach(circle=>circle.setAttribute('r',String(radius+(circle.classList.contains('campaign-ring')?4/scale:0))));
      group.querySelector('.waypoint-symbol').setAttribute('transform',`scale(${radius/22})`);
      const background=group.querySelector('.waypoint-label-box');
      for (const [key,value] of Object.entries({x:box.x-item.x,y:box.y-item.y,width:box.w,height:box.h})) background.setAttribute(key,String(value));
      const text=group.querySelector('text[data-i18n-display]'), x=box.x+box.w/2-item.x, y=box.y-item.y+font+5/scale;
      text.setAttribute('x',String(x)); text.setAttribute('y',String(y)); text.setAttribute('font-size',String(font));
      text.replaceChildren();
      if (lines.length===1) text.textContent=name;
      else lines.forEach((value,i)=>{const span=document.createElementNS('http://www.w3.org/2000/svg','tspan');span.setAttribute('x',String(x));span.setAttribute('y',String(y+i*font*1.2));span.textContent=value;text.appendChild(span);});
      localizeAttribute(group,'aria-label',()=>contentText(item.node));
      const leader=group.querySelector('.waypoint-leader');
      leader.setAttribute('x2',String(x)); leader.setAttribute('y2',String(box.y+box.h/2-item.y));
    }
    svg.querySelectorAll('[data-road-from]').forEach(road=>{
      const from=placed.find(n=>n.node.id===road.getAttribute('data-road-from')),to=placed.find(n=>n.node.id===road.getAttribute('data-road-to'));
      if (from&&to) road.setAttribute('d',`M ${from.x},${from.y} L ${to.x},${to.y}`);
    });
  }
  const observer=new ResizeObserver(refresh); observer.observe(svg); refresh();
  return { refresh, dispose() { alive=false; observer.disconnect(); } };
}
