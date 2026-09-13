// one-off: add 3 new overworld nodes and roads
const fs = require('fs');
const f = 'server/routes/city.js';
let s = fs.readFileSync(f, 'utf8');
let n = 0;

// add nodes
const nodeAnchor = "    blurb: 'A procedurally generated dungeon that never ends. Each floor is unique; each descent is harder. How deep can you go?'\n  }\n];";
const nodesAdd = `,
  {
    id: 'sewers',
    name: 'Oakhaven Sewers',
    region: 'Beneath Oakhaven',
    type: 'dungeon',
    mapId: 'sewers',
    safe: false,
    x: 28,
    y: 60,
    icon: '\u{1F577}\uFE0F',
    levelRange: 'Level 3-6',
    blurb: 'Something has been breeding in the dark beneath the city. Clear the sewers.'
  },
  {
    id: 'mill',
    name: 'The Abandoned Mill',
    region: 'The Outskirts',
    type: 'dungeon',
    mapId: 'mill',
    safe: false,
    x: 15,
    y: 65,
    icon: '\u{1F33E}',
    levelRange: 'Level 4-7',
    blurb: 'An old mill overrun by bandits, cultists and things that should not walk.'
  },
  {
    id: 'roost',
    name: "The Sun Dragon\u005c's Roost",
    region: 'The Volcanic Peaks',
    type: 'dungeon',
    mapId: 'roost',
    safe: false,
    x: 80,
    y: 15,
    icon: '\u{1F409}',
    levelRange: 'Level 9-12',
    blurb: 'The Ember Queen sleeps on a hoard of molten gold. The final challenge.'
  }
];`;
const nodeOld = nodeAnchor.slice(0, -3); // "];" removed → "  }"
s = s.replace(nodeAnchor.slice(0, -3), "  }" + nodesAdd);
n++;

// add roads
const roadAnchor = "  { from: 'crypt', to: 'drowned-vault', label: 'Sunken Barrow Path', danger: 'High' }\n];";
const roadsAdd = `,
  { from: 'oakhaven', to: 'sewers', label: 'Beneath the Cobbles', danger: 'Low' },
  { from: 'oakhaven', to: 'mill', label: 'The Outskirts Path', danger: 'Low' },
  { from: 'oakhaven', to: 'roost', label: 'The Ashen Pass', danger: 'Extreme' },
  { from: 'howling-hills', to: 'roost', label: 'The Volcanic Trail', danger: 'High' }
];`;
s = s.replace(roadAnchor, roadAnchor.slice(0, -3) + roadsAdd);
n++;

fs.writeFileSync(f, s);
console.log('applied', n);
