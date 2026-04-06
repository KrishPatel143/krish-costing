/**
 * @file calculator.js
 * @description Pure business-logic for pouch costing. Zero DOM — fully unit-testable.
 */

import {
  MATERIALS,
  FLEX_MATERIALS,
  POUCH_TYPES,
  PRINT_TYPES,
  FOIL_CLASSIFICATIONS,
  FOIL_THICKNESS_TO_CLASS,
  FOIL_PRINTING_GSM,
} from '../data/materials.js';

// ─── Core primitive ───────────────────────────────────────────────────────────

/**
 * Calculate material cost for one layer of one pouch.
 * @param {number} areaSqM   Pouch area in m²
 * @param {number} gsm       Grams per square metre
 * @param {number} ratePerKg ₹ per kg
 * @param {number} wastagePercent Wastage percentage
 * @returns {{ baseKg: number, wastageKg: number, costPerPouch: number }}
 */
export function calcMaterial(areaSqM, gsm, ratePerKg, wastagePercent = 3) {
  const baseKg = (areaSqM * gsm) / 1000;
  const wastageKg = baseKg * (1 + wastagePercent / 100);
  const costPerPouch = wastageKg * ratePerKg;
  return { baseKg, wastageKg, costPerPouch };
}

/**
 * Foil costing calculation for one pouch.
 * @param {{
 *   materialGroupKey: string,
 *   thicknessKey: string,
 *   printType: 'plain' | 'printed',
 *   gsmByThickness: Record<string, number>,
 *   rates: { blister: number, aluminium: number, imported: number, ink: number },
 *   sizeMm: number,
 *   quantity?: number,
 *   wastagePercent: number,
 *   profitPercent: number,
 * }} p
 */
export function calcFoilPouch({
  materialGroupKey,
  thicknessKey,
  printType = 'plain',
  gsmByThickness,
  rates,
  sizeMm,
  quantity = 1000,
  wastagePercent,
  profitPercent,
}) {
  const classKey = FOIL_THICKNESS_TO_CLASS[thicknessKey];
  if (!classKey) throw new Error('Invalid thickness selected.');

  const materialClass = FOIL_CLASSIFICATIONS[classKey];
  const materialRate = rates[materialClass.rateKey];
  const materialGsm = gsmByThickness[thicknessKey];
  const printed = printType === 'printed';
  const totalGsm = printed ? materialGsm + FOIL_PRINTING_GSM : materialGsm;

  const safeSizeMm = Number.isFinite(sizeMm) && sizeMm > 0 ? sizeMm : 105;
  const edgeMm = safeSizeMm + 5;
  const areaMm2 = edgeMm * edgeMm;
  const areaSqM = areaMm2 / 1_000_000;

  const materialCost = calcMaterial(areaSqM, totalGsm, materialRate, wastagePercent);
  const inkCost = printed
    ? calcMaterial(areaSqM, FOIL_PRINTING_GSM, rates.ink, wastagePercent)
    : { baseKg: 0, wastageKg: 0, costPerPouch: 0 };

  const totalCost = materialCost.costPerPouch + inkCost.costPerPouch;
  const priceWithProfit = totalCost + (totalCost * profitPercent / 100);
  const labourPerPouch = safeSizeMm < 60 ? 0.06 : 0.03;
  const finalPrice = priceWithProfit + labourPerPouch;
  const finalTotal = finalPrice * quantity;

  return {
    sizeMm: safeSizeMm,
    edgeMm,
    areaMm2,
    areaSqM,
    quantity,
    materialGroupKey,
    thicknessKey,
    classKey,
    classLabel: materialClass.label,
    materialRateKey: materialClass.rateKey,
    materialGsm,
    totalGsm,
    printed,
    wastagePercent,
    profitPercent,
    materialCost,
    inkCost,
    totalCost,
    priceWithProfit,
    labourPerPouch,
    finalPrice,
    finalTotal,
  };
}

// ─── Labour helpers ───────────────────────────────────────────────────────────

/** @returns {{ labourPerPouch: number, labourExtra: number, labourReason: string }} */
export function labourForPaper(pouchTypeKey, height) {
  const is4Ply = pouchTypeKey === 'ply_ply';
  const isTall = height > 250;
  const labourExtra = is4Ply || isTall ? 0.05 : 0;
  let labourReason = 'Standard pouch';
  if (is4Ply && isTall) labourReason = '4-Ply + tall (>250 mm)';
  else if (is4Ply) labourReason = '4-Ply pouch';
  else if (isTall) labourReason = 'Tall pouch (>250 mm)';
  return { labourPerPouch: 0.05 + labourExtra, labourExtra, labourReason };
}

/** @returns {{ labourPerPouch: number, labourExtra: number, labourReason: string }} */
export function labourForFlex(height) {
  const isTall = height > 250;
  const labourExtra = isTall ? 0.05 : 0;
  return {
    labourPerPouch: 0.05 + labourExtra,
    labourExtra,
    labourReason: isTall ? 'Tall pouch (>250 mm)' : 'Standard pouch',
  };
}

// ─── High-level calculators ───────────────────────────────────────────────────

/**
 * Full paper pouch cost calculation.
 * Profit on material cost: 25% for plain (no print), 30% for one-side / two-side.
 * @param {{ pouchTypeKey, height, width, inkCoverage, printType?, quantity, rates }} p
 */
export function calcPaperPouch({ pouchTypeKey, height, width, inkCoverage, printType = 'one_side', quantity, rates }) {
  const pouchType = POUCH_TYPES[pouchTypeKey];
  const inkKey = inkCoverage === 'half' ? 'ink_half' : 'ink_full';
  const areaSqM = (height * width) / 1_000_000;
  const { side1: s1Key, side2: s2Key } = pouchType;

  const s1 = calcMaterial(areaSqM, MATERIALS[s1Key].gsm, rates[s1Key]);
  const s2 = calcMaterial(areaSqM, MATERIALS[s2Key].gsm, rates[s2Key]);

  const inkGsm = MATERIALS[inkKey].gsm * (PRINT_TYPES[printType] ?? 1);
  const ink = calcMaterial(areaSqM, inkGsm, rates[inkKey]);

  const totalMatCostPerPouch = s1.costPerPouch + s2.costPerPouch + ink.costPerPouch;
  const profitPercent = printType === 'plain' ? 25 : 30;
  const profitPerPouch = totalMatCostPerPouch * (profitPercent / 100);
  const { labourPerPouch, labourExtra, labourReason } = labourForPaper(pouchTypeKey, height);
  const finalPerPouch = totalMatCostPerPouch + profitPerPouch + labourPerPouch;
  const finalTotal = finalPerPouch * quantity;

  const qtyTotals = {
    s1Kg: s1.wastageKg * quantity, s2Kg: s2.wastageKg * quantity,
    inkKg: ink.wastageKg * quantity,
    s1Cost: s1.costPerPouch * quantity, s2Cost: s2.costPerPouch * quantity,
    inkCost: ink.costPerPouch * quantity,
    matCost: totalMatCostPerPouch * quantity,
    profit: profitPerPouch * quantity, labour: labourPerPouch * quantity,
  };

  return {
    pouchType, s1Key, s2Key, inkKey, inkCoverage, printType,
    height, width, quantity, areaSqM,
    s1, s2, ink, rates,
    profitPercent,
    totalMatCostPerPouch, profitPerPouch,
    labourPerPouch, labourExtra, labourReason,
    finalPerPouch, finalTotal, qtyTotals,
  };
}

/**
 * Full flexible pouch cost calculation.
 * @param {{ height, width, inkCoverage, layers: Array<{matKey,mic}>, quantity, rates, paperRates, targetKg? }} p
 */
export function calcFlexiblePouch({ height, width, inkCoverage, printType = 'one_side', layers, quantity: rawQty, rates, paperRates, targetKg }) {
  const inkKey = inkCoverage === 'half' ? 'ink_half' : 'ink_full';
  const areaSqM = (height * width) / 1_000_000;

  const layerCalcs = layers.map(({ matKey, mic }) => {
    const mat = FLEX_MATERIALS[matKey];
    const gsm = mic * mat.density;
    const calc = calcMaterial(areaSqM, gsm, rates[matKey]);
    return { matKey, mic, gsm, density: mat.density, ratePerKg: rates[matKey], ...calc };
  });

  const inkGsm = MATERIALS[inkKey].gsm * (PRINT_TYPES[printType] ?? 1);
  const inkCalc = calcMaterial(areaSqM, inkGsm, paperRates[inkKey]);
  const layerMatCost = layerCalcs.reduce((s, l) => s + l.costPerPouch, 0);
  const totalMatCostPerPouch = layerMatCost + inkCalc.costPerPouch;
  const profitPerPouch = totalMatCostPerPouch * 0.30;
  const { labourPerPouch, labourExtra, labourReason } = labourForFlex(height);
  const finalPerPouch = totalMatCostPerPouch + profitPerPouch + labourPerPouch;
  const totalWastageKgPerPouch = layerCalcs.reduce((s, l) => s + l.wastageKg, 0) + inkCalc.wastageKg;

  // Resolve quantity
  let quantity = rawQty;
  let kgInfoLine = '';
  if (targetKg != null) {
    quantity = Math.floor(targetKg / totalWastageKgPerPouch);
    kgInfoLine = `${targetKg} kg → <strong>${quantity.toLocaleString('en-IN')} pouches</strong> (${totalWastageKgPerPouch.toFixed(6)} kg/pouch)`;
  }

  const finalTotal = finalPerPouch * quantity;
  const qtyTotals = {
    matCost: totalMatCostPerPouch * quantity,
    profit: profitPerPouch * quantity,
    labour: labourPerPouch * quantity,
    inkKg: inkCalc.wastageKg * quantity,
    inkCost: inkCalc.costPerPouch * quantity,
  };

  return {
    height, width, quantity, areaSqM,
    layers, layerCalcs, inkKey, inkCalc, inkCoverage, printType, paperRates, rates,
    totalMatCostPerPouch, profitPerPouch,
    labourPerPouch, labourExtra, labourReason,
    finalPerPouch, finalTotal, qtyTotals,
    qtyLayerKg: layerCalcs.map(l => l.wastageKg * quantity),
    qtyLayerCost: layerCalcs.map(l => l.costPerPouch * quantity),
    totalWastageKgPerPouch, kgInfoLine,
  };
}
