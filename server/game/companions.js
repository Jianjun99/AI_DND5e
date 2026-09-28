// companions.js — the companions' personal quest lines: loyalty-gated story beats
// that play out inside delves. Offered once (persisted on the roster via
// char.companionQuests), progressed by killing the target monster, completed with
// gold, a loyalty surge and a rolled rare gift. Targets are crypt-present monsters
// so the core dungeon can always finish a line; other maps simply wait.
const PERSONAL_QUESTS = {
  bram: {
    name: '旧伤·猎犬',
    english: 'Hounds of the Old Sorrow',
    offerAt: 60, need: 4, target: 'crypt_hound', targetName: 'Crypt Hound',
    offer: 'Bram lingers after the others sleep. "The hounds that run these halls took my brother\u2019s pack — and near took his luck. Put four down in my name. No speech needed. Just do it, and I\u2019ll know."',
    done: 'Bram counts the kills on scarred fingers. "He would have liked you." From now on he watches your flank like it\u2019s his own.',
    reward: { gold: 60, loyalty: 15, itemRarity: 'rare', itemCategory: 'weapon' }
  },
  valeria: {
    name: '守誓者之骸',
    english: 'The Warden\u2019s Vigil',
    offerAt: 65, need: 4, target: 'skeleton', targetName: 'Skeleton',
    offer: 'Valeria polishes her shield in silence, then looks up: "The dead in these halls wear the crest I once served. Lay four of them to rest — a warden\u2019s vigil ends only when the service does."',
    done: 'Valeria sets down her shield and, for one breath, bows her head. "The vigil is kept. Whatever comes, I hold the line beside you."',
    reward: { gold: 60, loyalty: 15, itemRarity: 'rare', itemCategory: 'armor' }
  },
  aldous: {
    name: '药师的老鼠账',
    english: 'The Apothecary\u2019s Ledger',
    offerAt: 55, need: 4, target: 'giant_rat', targetName: 'Giant Rat',
    offer: 'Aldous wrinkles his nose at the dark. "Giant rats chewed through my ingredient stores on my last delve — four of them, and I can finally restock. Consider it professional courtesy."',
    done: 'Aldous tallies his ledger with a satisfied grunt. "Restocked — and a bonus for you, naturally. Never say Aldous forgets a debt."',
    reward: { gold: 60, loyalty: 15, itemRarity: 'rare', itemCategory: 'armor' }
  }
};

module.exports = { PERSONAL_QUESTS };
