import {ascend, clone, compose, descend, sortWith, pluck, prop, range, slice, zip, equals} from "ramda";

/**
 * A table of actual stat growth with respect to growth points for each rarity.
 *
 * e.g. Neutral Jagen has 5 Atk growth points.
 * The difference between a 4 star Jagen's Atk at level 1 and level 40 would be
 * growthPoints[4][5] // === 18
 */
const growthPointTable = {
  1: [0, 1, 3, 4, 6, 8, 9, 11, 13, 14, 16, 18, 19, 21, 23, 24, 26, 28],
  2: [0, 1, 3, 5, 7, 8, 10, 12, 14, 15, 17, 19, 21, 23, 25, 26, 28, 30],
  3: [0, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31, 33],
  4: [0, 1, 3, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 31, 33, 35],
  5: [0, 1, 4, 6, 8, 10, 13, 15, 17, 19, 22, 24, 26, 28, 30, 33, 35, 37],
};

export const baseStatToMaxStat = (rarity, baseStat, growthPoints) =>
  baseStat + growthPointTable[rarity][growthPoints];

export const maxStatToBaseStat = (rarity, maxStat, growthPoints) =>
  maxStat - growthPointTable[rarity][growthPoints];

export const baseStatsForRarity = (rarity, baseStats5) => {
  const difference = 5 - rarity;

  const higherStatsPenalty = Math.floor(difference / 2);
  const lowerStatsPenalty = Math.floor((difference + 1) / 2);

  const sortedStatIndices = compose(
      pluck(1),
      sortWith([
        descend(prop(0)),
        ascend(prop(1)),
      ]),
  )(zip(slice(1, 5, baseStats5), range(1, 5)));

  const rarityStats = clone(baseStats5);

  rarityStats[0] -= lowerStatsPenalty; // The HP stat.
  rarityStats[sortedStatIndices[0]] -= higherStatsPenalty; // The highest non-HP stat.
  rarityStats[sortedStatIndices[1]] -= higherStatsPenalty; // The second highest non-HP stat.
  rarityStats[sortedStatIndices[2]] -= lowerStatsPenalty; // The third highest non-HP stat.
  rarityStats[sortedStatIndices[3]] -= lowerStatsPenalty; // The lowest non-HP stat.

  return rarityStats;
}
