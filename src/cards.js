// --- 몬스터 카드 (14종) ---
export const MONSTERS = [
  { id: 'M-01', name: '상수', formula: '1', display : '1', type: 'monster' },
  { id: 'M-02', name: '일차함수', formula: 'x', display : 'x', type: 'monster' },
  { id: 'M-03', name: '이차함수', formula: 'x^2', display : 'x^2', type: 'monster' },
  { id: 'M-04', name: '삼차함수', formula: 'x^3', display : 'x^3', type: 'monster' },
  { id: 'M-05', name: '분수함수', formula: '1/x', display : '\\frac{1}{x}', type: 'monster' },
  { id: 'M-06', name: '무리함수', formula: 'sqrt(x)', display : '\\sqrt{x}', type: 'monster' },
  { id: 'M-07', name: '지수함수', formula: 'exp(x)', display : 'e^x', type: 'monster' },
  { id: 'M-08', name: '로그함수', formula: 'log(x)', display : '\\ln(x)', type: 'monster' },
  { id: 'M-09', name: '사인', formula: 'sin(x)', display : '\\sin(x)', type: 'monster' },
  { id: 'M-10', name: '코사인', formula: 'cos(x)', display : '\\cos(x)', type: 'monster' },
  { id: 'M-11', name: '탄젠트', formula: 'tan(x)', display : '\\tan(x)', type: 'monster' },
  { id: 'M-12', name: '코탄젠트', formula: 'cot(x)', display : '\\cot(x)', type: 'monster' },
  { id: 'M-13', name: '시컨트', formula: 'sec(x)', display : '\\sec(x)', type: 'monster' },
  { id: 'M-14', name: '코시컨트', formula: 'csc(x)', display : '\\csc(x)', type: 'monster' },
];

// --- 마법 카드 (13종) ---
export const SPELLS = [
  { id: 'S-01', name: '+2', type: 'spell', display: '+2', effect: 'DRAW', value: 2 },
  { id: 'S-02', name: '-1', type: 'spell', display: '-1', effect: 'HAND_DISCARD', value: 1 },
  { id: 'S-03', name: '×2', type: 'spell', display: '\\times 2', effect: 'CLONE' },
  { id: 'S-04', name: '×(-1)', type: 'spell', display: '\\times(-1)', effect: 'NEGATE' },
  { id: 'S-05', name: '미분', type: 'spell', display: '\\frac{d}{dx} f', effect: 'DIFF' },
  { id: 'S-06', name: '부정적분', type: 'spell', display: '\\int f dx', effect: 'INTEGRAL' },
  { id: 'S-07', name: '지수화', type: 'spell', display: 'e^{f}', effect: 'EXP_F' },
  { id: 'S-08', name: '로그화', type: 'spell', display: '\\ln(f)', effect: 'LN_F' },
  { id: 'S-09', name: '역수', type: 'spell', display: '\\frac{1}{f}', effect: 'RECIPROCAL' },
  { id: 'S-10', name: '역함수', type: 'spell', display: 'f^{-1}', effect: 'INVERSE' },
  { id: 'S-11', name: 'x = 1', type: 'spell', display: 'x = 1', effect: 'SUB', value: 1 },
  { id: 'S-12', name: '합성', type: 'spell', display: 'f \\circ g', effect: 'COMPOSE' },
  { id: 'S-13', name: '절댓값', type: 'spell', display: '|f|', effect: 'ABS' },
];

// --- 함정 카드 (7종) ---
export const TRAPS = [
  { id: 'T-01', name: '전미분', type: 'trap', display: 'dF', effect: 'FIELD_DIFF' },
  { id: 'T-02', name: '원시함수', type: 'trap', display: 'F', effect: 'FIELD_INTEGRAL' },
  { id: 'T-03', name: '구분구적법', type: 'trap', display: '\\sum \\Delta x', effect: 'OPP_FIELD_INTEGRAL' },
  { id: 'T-04', name: '부동점 정리', type: 'trap', display: 'fixed point', effect: 'PROTECT' },
  { id: 'T-05', name: 'lim x->0', type: 'trap', display: '\\lim_{x\\to 0}', effect: 'LIMIT', value: 0 },
  { id: 'T-06', name: 'x', type: 'trap', display: '\\times x', effect: 'MUL_X' },
  { id: 'T-07', name: '매클로린 급수', type: 'trap', display: 'Maclaurin', effect: 'MACLAURIN' },
];

// --- 필드 카드 (4종) ---
export const FIELDS = [
  { id: 'F-01', name: '이계도함수', type: 'field', display: '\\frac{d^2}{dx^2}', effect: 'SECOND_DERIV' },
  { id: 'F-02', name: '적분상수', type: 'field', display: '+C', effect: 'CONST_C' },
  { id: 'F-03', name: '양의 실수', type: 'field', display: '\\mathbb{R}^+', effect: 'DOMAIN_R' },
  { id: 'F-04', name: '유리수체', type: 'field', display: '\\mathbb{Q}', effect: 'RATIONAL_Q' },
];