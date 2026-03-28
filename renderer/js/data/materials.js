/**
 * @file materials.js
 * @description Single source of truth for all material data, rates, and pouch configurations.
 * Pure data — no DOM, no side effects. Import freely from any module.
 */

/** @type {Record<string, { label: string, gsm: number }>} */
export const MATERIALS = {
  med: { label: 'Medical Paper', gsm: 60 },
  ost: { label: 'One Side Transparent (OST)', gsm: 55 },
  cromo: { label: 'Cromo', gsm: 75 },
  ply: { label: '4 Ply', gsm: 118 },
  poster: { label: 'Poster', gsm: 60 },
  ink_half: { label: 'Ink — Half Coverage', gsm: 1 },
  ink_full: { label: 'Ink — Full Coverage', gsm: 2 },
};

/** @type {Record<string, number>} */
export const PRINT_TYPES = {
  plain: 0,
  one_side: 1,
  two_side: 2,
};

/** @type {Record<string, number>} */
export const DEFAULT_RATES = {
  med: 160,
  ost: 120,
  cromo: 90,
  ply: 110,
  poster: 75,
  ink_half: 15000,
  ink_full: 15000,
};

/** @type {Record<string, { label: string, side1: string, side2: string }>} */
export const POUCH_TYPES = {
  med_ost: { label: 'Medical Paper + One Side Transparent', side1: 'med', side2: 'ost' },
  cromo_ost: { label: 'Cromo + One Side Transparent', side1: 'cromo', side2: 'ost' },
  cromo_cromo: { label: 'Cromo + Cromo', side1: 'cromo', side2: 'cromo' },
  ply_ply: { label: '4 Ply + 4 Ply', side1: 'ply', side2: 'ply' },
  poster_poster: { label: 'Poster + Poster', side1: 'poster', side2: 'poster' },
};

/** @type {Record<string, { label: string, density: number, defaultRate: number }>} */
export const FLEX_MATERIALS = {
  Polyster: { label: 'Polyester', density: 1.4, defaultRate: 125 },
  Metal: { label: 'Metal (Polyester)', density: 1.4, defaultRate: 420 },
  Milky: { label: 'Milky BOPP', density: 0.925, defaultRate: 135 },
  Aluminium: { label: 'Aluminium Foil', density: 2.72, defaultRate: 135 },
  CppNatural: { label: 'CPP Natural', density: 0.91, defaultRate: 135 },
  CppMetal: { label: 'CPP Metal', density: 0.91, defaultRate: 135 },
  Natural: { label: 'Natural BOPP', density: 0.925, defaultRate: 135 },
  NaturalMedmettlocin: { label: 'Natural Med-Metallocene', density: 0.925, defaultRate: 135 },
  NaturalMettlocin: { label: 'Natural Metallocene', density: 0.925, defaultRate: 135 },
  MilkyMedmettlocin: { label: 'Milky Med-Metallocene', density: 0.925, defaultRate: 135 },
  MilkyMettlocin: { label: 'Milky Metallocene', density: 0.925, defaultRate: 135 },
  PerlBopp: { label: 'Pearl BOPP', density: 0.71, defaultRate: 135 },
  Bopp: { label: 'BOPP', density: 0.91, defaultRate: 135 },
  Bopa: { label: 'BOPA (Nylon)', density: 1.16, defaultRate: 135 },
  NaturalBopp: { label: 'Natural BOPP (Plain)', density: 0.91, defaultRate: 135 },
  MetalizeBopp: { label: 'Metalized BOPP', density: 0.91, defaultRate: 135 },
  MetFinishBopp: { label: 'Met Finish BOPP', density: 0.91, defaultRate: 135 },
  ChemicalCoatedPolyster: { label: 'Chemical Coated Polyester', density: 1.4, defaultRate: 125 },
  ChemicalCoatedMetal: { label: 'Chemical Coated Metal', density: 1.4, defaultRate: 420 },
  WindowMetal: { label: 'Window Metal', density: 1.4, defaultRate: 420 },
  MatteFinishPolyster: { label: 'Matte Finish Polyester', density: 1.4, defaultRate: 125 },
  Holography: { label: 'Holography', density: 1.4, defaultRate: 125 },
  BlackPoly: { label: 'Black Poly', density: 0.925, defaultRate: 125 },
  NaturalHDPlus: { label: 'Natural HD Plus', density: 0.925, defaultRate: 135 },
  NaturalNFG: { label: 'Natural NFG', density: 0.925, defaultRate: 135 },
};

/** @type {Record<string, number>} */
export const DEFAULT_FLEX_RATES = Object.fromEntries(
  Object.entries(FLEX_MATERIALS).map(([k, v]) => [k, v.defaultRate])
);

export const LAYER_NAMES = ['Outer', 'Middle', 'Inner'];

/** Show breakdown tables by default in results */
export const SHOW_BREAKDOWN = false;
