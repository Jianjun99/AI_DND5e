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
  , localized:{"en":{"name":"Hounds of the Old Sorrow","targetName":"Crypt Hound","offer":"Bram lingers after the others sleep. \"The hounds took my brother's pack, and nearly his life. Put four down for me. Just do it, and I'll know.\"","done":"Bram counts on scarred fingers. \"He would have liked you.\" He now watches your flank like his own."},"zh-CN":{"name":"旧伤·猎犬","targetName":"墓穴猎犬","offer":"众人睡后，布拉姆留下：“这些猎犬夺走我兄弟的行囊，差点也夺走他的命。替我杀掉四只。不必多言，做了我就知道。”","done":"布拉姆用伤痕累累的手指数着击杀：“他会喜欢你的。”此后他守护你的侧翼，就像守护自己。"}}},
  valeria: {
    name: '守誓者之骸',
    english: 'The Warden\u2019s Vigil',
    offerAt: 65, need: 4, target: 'skeleton', targetName: 'Skeleton',
    offer: 'Valeria polishes her shield in silence, then looks up: "The dead in these halls wear the crest I once served. Lay four of them to rest — a warden\u2019s vigil ends only when the service does."',
    done: 'Valeria sets down her shield and, for one breath, bows her head. "The vigil is kept. Whatever comes, I hold the line beside you."',
    reward: { gold: 60, loyalty: 15, itemRarity: 'rare', itemCategory: 'armor' }
  , localized:{"en":{"name":"The Warden's Vigil","targetName":"Skeleton","offer":"Valeria polishes her shield. \"These dead wear the crest I once served. Lay four to rest. The vigil ends only when the service does.\"","done":"Valeria bows her head. \"The vigil is kept. Whatever comes, I hold the line beside you.\""},"zh-CN":{"name":"守誓者之骸","targetName":"骷髅","offer":"瓦莱莉娅默默擦盾，抬头说：“这些亡灵穿着我曾效忠的纹章。让四具安息——守卫的职责结束，守夜才结束。”","done":"瓦莱莉娅放下盾，短暂低头：“守夜结束了。无论何事，我都与你并肩坚守。”"}}},
  aldous: {
    name: '药师的老鼠账',
    english: 'The Apothecary\u2019s Ledger',
    offerAt: 55, need: 4, target: 'giant_rat', targetName: 'Giant Rat',
    offer: 'Aldous wrinkles his nose at the dark. "Giant rats chewed through my ingredient stores on my last delve — four of them, and I can finally restock. Consider it professional courtesy."',
    done: 'Aldous tallies his ledger with a satisfied grunt. "Restocked — and a bonus for you, naturally. Never say Aldous forgets a debt."',
    reward: { gold: 60, loyalty: 15, itemRarity: 'rare', itemCategory: 'armor' }
  , localized:{"en":{"name":"The Apothecary's Ledger","targetName":"Giant Rat","offer":"Aldous wrinkles his nose. \"Giant rats chewed through my supplies. Kill four, and I can restock. Consider it professional courtesy.\"","done":"Aldous tallies his ledger. \"Restocked, with a bonus for you. Never say I forget a debt.\""},"zh-CN":{"name":"药师的老鼠账","targetName":"巨鼠","offer":"奥尔多斯对黑暗皱鼻：“巨鼠上次啃坏了我的药材储备。杀四只，我就能补货。当作同行的礼貌吧。”","done":"奥尔多斯满意地记账：“补齐了——自然还有你的奖金。别说我忘恩负义。”"}}}
};

module.exports = { PERSONAL_QUESTS };
