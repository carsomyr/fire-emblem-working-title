import fs from 'fs';
import {
  ascend,
  compose,
  dissoc,
  groupBy,
  indexBy,
  map,
  pick,
  prop,
  range,
  replace,
  sort,
  sortWith,
  trim,
  without,
} from 'ramda';

import { baseStatToMaxStat, maxStatToBaseStat, baseStatsForRarity } from './statGrowth';
import { fetchApiRows } from './fetch';
import { CDN_HOST } from './constants';

const sanitizeDescription = compose(
  trim,
  replace(/<br.*?>/g, ' '),
  // remove [[]] around links
  replace(/\[\[[^\|\]]*?\|?(.*?)\]\]/g, '$1'),
  // remove text before | in links
  replace(/\[\[[^|\]]*\|(.*?)\]\]/g, '[[$1]]'),
  // completely strip [[File:]] links
  replace(/\[\[File.*?\]\]/g, ''),
  replace(/\&gt\;/g, '>'),
  replace(/\&lt\;/g, '<'),
  replace(/\&quot\;/g, '"'),
);

const formatImageName = compose(
  replace(/\'/g, ''),
  replace(/\"/g, ''),
  replace(/\:/g, ''),
);

const skillCategoriesToOrdinals = {
  "weapon": 0,
  "assist": 1,
  "special": 2,
  "passivea": 3,
  "passiveb": 4,
  "passivec": 5,
  "sacredseal": 6,
};

/**
 * Fetch and collate the data.
 * (Do all the things!)
 */

// Fetches heroes and their stats/skills
async function fetchHeroStats() {
  const heroSkills = await fetchApiRows({
    action: 'cargoquery',
    format: 'json',
    tables: [
      'Units',
      'UnitSkills',
      'Skills',
    ].join(','),
    fields: [
      'Units._pageName=HeroFullName',
      'UnitSkills.skill=WikiName',
      'UnitSkills.skillPos=SkillPos',
      'UnitSkills.unlockRarity=UnlockRarity',
      'UnitSkills.defaultRarity=DefaultRarity',
      'Skills.Scategory=Category',
    ].join(','),
    join_on: [
      'Units._pageName=UnitSkills._pageName',
      'UnitSkills.skill=Skills.WikiName',
    ].join(','),
  }).then(
      compose(
          map(
              compose(
                  sort((lhs, rhs) => {
                    const lhsCategoryOrdinal = skillCategoriesToOrdinals[lhs.Category];
                    const rhsCategoryOrdinal = skillCategoriesToOrdinals[rhs.Category];

                    if (lhsCategoryOrdinal < rhsCategoryOrdinal) {
                      return -1;
                    } else if (lhsCategoryOrdinal > rhsCategoryOrdinal) {
                      return 1;
                    } else {
                      if (lhs.SkillPos < rhs.SkillPos) {
                        return -1;
                      } else if (lhs.SkillPos > rhs.SkillPos) {
                        return 1;
                      } else {
                        return 0;
                      }
                    }
                  }),
                  map(
                    dissoc("HeroFullName"),
                  ),
              ),
          ),
          groupBy(
              (passive) => passive.HeroFullName
          ),
      ),
  ).catch(error => {
    console.error('failed to parse hero passives', error);
  });

  const heroes = await fetchApiRows({
    action: 'cargoquery',
    format: 'json',
    tables: [
      'Units',
      'UnitStats',
    ].join(','),
    fields: [
      'Units._pageName=FullName',
      'Name',
      'Title',
      'Origin',
      'WeaponType',
      'MoveType',
      'ReleaseDate',
      'UnitStats.Lv1HP5',
      'UnitStats.Lv1Atk5',
      'UnitStats.Lv1Spd5',
      'UnitStats.Lv1Def5',
      'UnitStats.Lv1Res5',
      'UnitStats.HPGR3',
      'UnitStats.AtkGR3',
      'UnitStats.SpdGR3',
      'UnitStats.DefGR3',
      'UnitStats.ResGR3',
    ].join(','),
    group_by: 'Units._pageName',
    join_on: [
      'UnitStats._pageName=Units._pageName',
    ].join(','),
  })
    .then(
      compose(
        map(
          ({
            FullName,
            Name,
            Title,
            Origin,
            WeaponType,
            MoveType,
            ReleaseDate,
            Lv1HP5: hp5,
            Lv1Atk5: atk5,
            Lv1Spd5: spd5,
            Lv1Def5: def5,
            Lv1Res5: res5,
            HPGR3: hpGrowths,
            AtkGR3: atkGrowths,
            SpdGR3: spdGrowths,
            DefGR3: defGrowths,
            ResGR3: resGrowths,
          }) => {
            const minRarity = 1;
            const maxRarity = 5;

            const rarities =
              minRarity === undefined
                ? 'N/A'
                : minRarity === maxRarity
                  ? `${minRarity}`
                  : `${minRarity}-${maxRarity}`;

            // Convert release dates into expected format.
            const formatDate = timestamp =>
              new Date(timestamp).toISOString().substring(0, 10);

            const releaseDate = ReleaseDate ? formatDate(ReleaseDate) : 'N/A';

            const skills = map((skill) => ({
              name: skill.WikiName,
              default: Number.parseInt(skill.DefaultRarity, 10) || '-',
              rarity: Number.parseInt(skill.UnlockRarity, 10) || '-',
            }))(heroSkills[FullName]);

            const growths = {
              hp: Number.parseInt(hpGrowths, 10),
              atk: Number.parseInt(atkGrowths, 10),
              spd: Number.parseInt(spdGrowths, 10),
              def: Number.parseInt(defGrowths, 10),
              res: Number.parseInt(resGrowths, 10),
            };

            // Compute the hero's stats at level 1 and 40 for all available
            // rarities.
            const stats = {
              '1': {},
              '40': {},
            };

            if (minRarity !== undefined) {
              range(minRarity, 6).forEach(rarity => {
                stats['1'][rarity] = baseStatsForRarity(rarity, [
                    Number.parseInt(hp5, 10),
                    Number.parseInt(atk5, 10),
                    Number.parseInt(spd5, 10),
                    Number.parseInt(def5, 10),
                    Number.parseInt(res5, 10),
                ]);

                stats['1'][rarity] = {
                  hp: stats['1'][rarity][0],
                  atk: stats['1'][rarity][1],
                  spd: stats['1'][rarity][2],
                  def: stats['1'][rarity][3],
                  res: stats['1'][rarity][4],
                };

                stats['40'][rarity] = {
                  hp: [
                    baseStatToMaxStat(
                      rarity,
                      stats['1'][rarity].hp - 1,
                      Number.parseInt(hpGrowths, 10) / 5 - 1,
                    ),
                    baseStatToMaxStat(
                      rarity,
                      stats['1'][rarity].hp,
                      Number.parseInt(hpGrowths, 10) / 5,
                    ),
                    baseStatToMaxStat(
                      rarity,
                      stats['1'][rarity].hp + 1,
                      Number.parseInt(hpGrowths, 10) / 5 + 1,
                    ),
                  ],
                  atk: [
                    baseStatToMaxStat(
                      rarity,
                      stats['1'][rarity].atk - 1,
                      Number.parseInt(atkGrowths, 10) / 5 - 1,
                    ),
                    baseStatToMaxStat(
                      rarity,
                      stats['1'][rarity].atk,
                      Number.parseInt(atkGrowths, 10) / 5,
                    ),
                    baseStatToMaxStat(
                      rarity,
                      stats['1'][rarity].atk + 1,
                      Number.parseInt(atkGrowths, 10) / 5 + 1,
                    ),
                  ],
                  spd: [
                    baseStatToMaxStat(
                      rarity,
                      stats['1'][rarity].spd - 1,
                      Number.parseInt(spdGrowths, 10) / 5 - 1,
                    ),
                    baseStatToMaxStat(
                      rarity,
                      stats['1'][rarity].spd,
                      Number.parseInt(spdGrowths, 10) / 5,
                    ),
                    baseStatToMaxStat(
                      rarity,
                      stats['1'][rarity].spd + 1,
                      Number.parseInt(spdGrowths, 10) / 5 + 1,
                    ),
                  ],
                  def: [
                    baseStatToMaxStat(
                      rarity,
                      stats['1'][rarity].def - 1,
                      Number.parseInt(defGrowths, 10) / 5 - 1,
                    ),
                    baseStatToMaxStat(
                      rarity,
                      stats['1'][rarity].def,
                      Number.parseInt(defGrowths, 10) / 5,
                    ),
                    baseStatToMaxStat(
                      rarity,
                      stats['1'][rarity].def + 1,
                      Number.parseInt(defGrowths, 10) / 5 + 1,
                    ),
                  ],
                  res: [
                    baseStatToMaxStat(
                      rarity,
                      stats['1'][rarity].res - 1,
                      Number.parseInt(resGrowths, 10) / 5 - 1,
                    ),
                    baseStatToMaxStat(
                      rarity,
                      stats['1'][rarity].res,
                      Number.parseInt(resGrowths, 10) / 5,
                    ),
                    baseStatToMaxStat(
                      rarity,
                      stats['1'][rarity].res + 1,
                      Number.parseInt(resGrowths, 10) / 5 + 1,
                    ),
                  ],
                };
              });
            }

            const fullName = sanitizeDescription(FullName);

            const imageName = formatImageName(fullName);

            return {
              name: fullName,
              shortName: Name,
              title: sanitizeDescription(Title),
              origin: Origin,
              weaponType: WeaponType,
              moveType: MoveType,
              rarities,
              releaseDate,
              assets: {
                portrait: {
                  '75px': `${CDN_HOST}/75px-Icon_Portrait_${imageName}.png`,
                  '113px': `${CDN_HOST}/113px-Icon_Portrait_${imageName}.png`,
                  '150px': `${CDN_HOST}/150px-Icon_Portrait_${imageName}.png`,
                },
              },
              skills,
              growths,
              stats,
            };
          },
        ),
      ),
    )
    .catch(error => {
      console.error('failed to parse hero stats', error);
    });

  return heroes;
}

// Fetches detailed info for all skills
async function fetchSkills() {
  const skills = await fetchApiRows({
    action: 'cargoquery',
    format: 'json',
    tables: 'Skills',
    fields: [
      'WikiName',
      'Description',
      'SP',
      'CanUseMove',
      'CanUseWeapon',
      'Exclusive',
      'UseRange',
      'Might',
      'Scategory=Category',
    ].join(','),
  })
    .then(
      compose(
        sortWith(
          [
            ascend(({type}) => {
              return skillCategoriesToOrdinals[type];
            }),
            ascend(prop("name")),
          ]
        ),
        map(
          ({
            WikiName,
            Description,
            SP,
            CanUseMove,
            CanUseWeapon,
            Exclusive,
            UseRange,
            Might,
            Category,
          }) => {
            return {
              name: WikiName,
              effect: sanitizeDescription(Description),
              sp: Number.parseInt(SP, 10),
              movementRestriction: CanUseMove.split(',  '),
              weaponRestriction: CanUseWeapon.split(',  '),
              exclusive: Boolean(Number.parseInt(Exclusive, 10)),
              range: Number.parseInt(UseRange, 10),
              might: Number.parseInt(Might, 10),
              type: Category,
            };
          },
        ),
      ),
    )
    .catch(error => {
      console.error('failed to parse passive skill stats', error);
    });

  return skills;
}

// log warnings if data looks suspicious
function validate(heroes, skills) {
  const skillsByName = indexBy(prop('name'), skills);
  for (let hero of heroes) {
    for (let skill of hero.skills) {
      if (skillsByName[skill.name] == null) {
        console.warn(
          'Warning: ' + hero.name + ' has unknown skill: ' + skill.name,
        );
      }
    }
    var level1Rarities = 0;
    var level40Rarities = 0;
    for (let rarity of [1, 2, 3, 4, 5]) {
      // level 1 stats:
      if (hero.stats[1][rarity] != null) {
        level1Rarities++;
      }
      // level 40 stats:
      if (hero.stats[40][rarity] != null) {
        level40Rarities++;
      }
    }
    if (level1Rarities != level40Rarities || level1Rarities == 0) {
      console.warn(
        'Warning: ' +
          hero.name +
          ' has level 1 stats for ' +
          level1Rarities +
          ' and level 40 stats for ' +
          level40Rarities +
          ' rarities.',
      );
    }
  }
}

// Fetch new data and write it to stats.json
async function fetchWikiStats(shouldFetchHeroes, shouldFetchSkills) {
  const existingStats = JSON.parse(fs.readFileSync('./stats.json', 'utf8'));
  const heroes = shouldFetchHeroes
    ? await fetchHeroStats()
    : existingStats.heroes;
  const skills = shouldFetchSkills ? await fetchSkills() : existingStats.skills;

  // Log new heroes/skills
  const getNames = map(prop('name'));
  const newHeroNames = without(
    getNames(existingStats.heroes),
    getNames(heroes),
  );
  const newSkills = without(getNames(existingStats.skills), getNames(skills));
  map(x => console.log('New hero: ' + x), newHeroNames);
  map(x => console.log('New skill: ' + x), newSkills);

  validate(heroes, skills);

  // WRITE STATS TO FILE
  const allStats = { heroes, skills };
  fs.writeFileSync('./stats.json', JSON.stringify(allStats, null, 2));
}

fetchWikiStats(true, true);
