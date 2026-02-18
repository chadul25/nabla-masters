import { derivative, simplify, parse, evaluate } from 'mathjs';

export const Engine = {
  formatToTex: (formula) => {
    try { 
      const simplified = simplify(formula).toString();
      return parse(simplified).toTex(); 
    } catch { return formula; }
  },
  checkDestruction: (formula, activeField) => {
    try {
      const s = simplify(formula).toString();
      if (s === '0') return { destroyed: true, reason: 'ZERO' };
      if (formula.includes('Infinity') || formula.includes('NaN')) return { destroyed: true, reason: 'UNDEFINED' };
      if (activeField?.effect === 'RATIONAL_Q' && (s.includes('e') || s.includes('pi'))) return { destroyed: true, reason: 'NOT_RATIONAL' };
      return { destroyed: false, formula: s };
    } catch { return { destroyed: true }; }
  },
  sortDeck: (cards) => {
    const priority = { monster: 0, spell: 1, trap: 2, field: 3 };
    return [...cards].sort((a, b) => priority[a.type] - priority[b.type] || a.id.localeCompare(b.id));
  },
  shuffle: (arr) => [...arr].sort(() => Math.random() - 0.5),
  inverseMap: {
    'exp(x)': 'log(x)', 'log(x)': 'exp(x)', 'sin(x)': 'asin(x)', 'cos(x)': 'acos(x)',
    'x^2': 'sqrt(x)', 'sqrt(x)': 'x^2', 'x': 'x', '1/x': '1/x'
  },
  getMaclaurin: (f) => {
    if (f.includes('exp')) return '1'; if (f.includes('sin')) return 'x';
    if (f.includes('cos')) return '1'; if (f.includes('log')) return 'x-1';
    return f;
  }
};