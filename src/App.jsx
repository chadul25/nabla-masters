import React, { useState, useEffect, useCallback } from 'react';
import { derivative, simplify, evaluate, parse } from 'mathjs';
import 'katex/dist/katex.min.css';
import { InlineMath } from 'react-katex';
import { io } from 'socket.io-client';
import './App.css';
import { MONSTERS, SPELLS, TRAPS, FIELDS } from './cards';

const socket = io('https://renate-nonmultiplicative-edgardo.ngrok-free.dev');

// --- [A] 전역 수학 유틸리티 ---
const formatFormula = (formula) => {
  try { return parse(simplify(formula).toString()).toTex(); } catch (e) { return formula; }
};

const checkDestruction = (formula, activeField) => {
  try {
    const simplified = simplify(formula).toString();
    if (simplified === '0') return { destroyed: true, reason: 'ZERO' };
    if (formula.includes('Infinity') || formula.includes('NaN')) return { destroyed: true, reason: 'UNDEFINED' };
    if (activeField?.effect === 'RATIONAL_Q' && (simplified.includes('e') || simplified.includes('pi'))) return { destroyed: true, reason: 'NOT_RATIONAL' };
    return { destroyed: false, formula: simplified };
  } catch (e) { return { destroyed: true, reason: 'UNDEFINED' }; }
};

const inverseMap = {
  'exp(x)': 'log(x)', 'log(x)': 'exp(x)', 'sin(x)': 'asin(x)', 'cos(x)': 'acos(x)',
  'x^2': 'sqrt(x)', 'sqrt(x)': 'x^2', 'x': 'x', '1/x': '1/x'
};

const getMaclaurin = (f) => {
  if (f.includes('exp')) return '1'; if (f.includes('sin')) return 'x';
  if (f.includes('cos')) return '1'; if (f.includes('log')) return 'x-1';
  return f;
};

// --- [B] 메뉴 컴포넌트 ---
function Menu({ roomCode, inputCode, setInputCode }) {
  return (
    <div className="menu-screen">
      <div className="menu-content">
        <h1 className="game-title">NABLA MASTERS</h1>
        <p className="game-subtitle">Online Calculus Duel</p>
        {roomCode ? (
          <div className="room-waiting">
            <p>ROOM CODE</p>
            <h2 className="code-display">{roomCode}</h2>
            <p className="blink">상대방을 기다리는 중...</p>
          </div>
        ) : (
          <div className="menu-options">
            <button className="menu-btn primary" onClick={() => socket.emit('CREATE_ROOM')}>CREATE ROOM</button>
            <div className="join-group">
              <input type="text" placeholder="ENTER CODE" value={inputCode} onChange={(e) => setInputCode(e.target.value.toUpperCase())} />
              <button className="menu-btn secondary" onClick={() => socket.emit('JOIN_ROOM', inputCode)}>JOIN</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DeckBuilder({ onBack }) {
  const [myDeck, setMyDeck] = useState(JSON.parse(localStorage.getItem('nabla_deck')) || []);
  const allCards = [...MONSTERS, ...SPELLS, ...TRAPS, ...FIELDS];

  const addToDeck = (card) => {
    const count = myDeck.filter(c => c.id === card.id).length;
    if (count < 4 && myDeck.length < 60) {
      setMyDeck([...myDeck, { ...card, instanceId: Math.random() }]);
    }
  };

  const removeFromDeck = (instanceId) => {
    setMyDeck(myDeck.filter(c => c.instanceId !== instanceId));
  };

  const saveDeck = () => {
    if (myDeck.length < 40) return alert("최소 40장이 필요합니다.");
    localStorage.setItem('nabla_deck', JSON.stringify(myDeck));
    alert("덱이 저장되었습니다!");
    onBack();
  };

  return (
    <div className="deck-builder">
      <h2>DECK BUILDER ({myDeck.length}/60)</h2>
      <div className="builder-container">
        <div className="card-library">
          {allCards.map(c => (
            <div key={c.id} className="library-item" onClick={() => addToDeck(c)}>
               <InlineMath math={c.display || c.formula} />
               <span>{c.name}</span>
            </div>
          ))}
        </div>
        <div className="current-deck-list">
          {myDeck.map((c, i) => (
            <div key={c.instanceId} className="deck-item" onClick={() => removeFromDeck(c.instanceId)}>
              {c.name}
            </div>
          ))}
        </div>
      </div>
      <button onClick={saveDeck}>SAVE & EXIT</button>
    </div>
  );
}

function Lobby({ roomCode, onReady }) {
  const [isReady, setIsReady] = useState(false);
  const [selectedDeck, setSelectedDeck] = useState(JSON.parse(localStorage.getItem('nabla_deck')) || []);

  const handleReady = () => {
    if (selectedDeck.length < 40) return alert("유효한 덱이 없습니다. 덱 빌더에서 덱을 만드세요.");
    setIsReady(true);
    onReady(selectedDeck); // socket.emit('READY_TO_DUEL') 호출
  };

  return (
    <div className="lobby-screen">
      <h2>ROOM: {roomCode}</h2>
      <div className="status">
        {isReady ? "준비 완료! 상대방을 기다립니다..." : "덱을 선택하고 READY를 누르세요."}
      </div>
      <div className="selected-deck-preview">
        카드 매수: {selectedDeck.length}장
      </div>
      <button onClick={handleReady} disabled={isReady}>READY</button>
    </div>
  );
}

// --- [C] 메인 앱 컴포넌트 ---
export default function App() {
  // 1. 상태 관리
  const [view, setView] = useState('MENU'); 
  const [roomCode, setRoomCode] = useState("");
  const [inputCode, setInputCode] = useState("");
  const [myPlayerNumber, setMyPlayerNumber] = useState(null); 
  const [phase, setPhase] = useState('START'); 
  const [turn, setTurn] = useState(0); 
  const [totalTurns, setTotalTurns] = useState(1); 
  const [winner, setWinner] = useState(null);
  const [notification, setNotification] = useState(""); 
  const [chain, setChain] = useState([]);
  const [selectedAction, setSelectedAction] = useState(null); 
  const [hoveredTargetId, setHoveredTargetId] = useState(null);
  const [summonedThisTurn, setSummonedThisTurn] = useState(false);
  const [priorityPlayer, setPriorityPlayer] = useState(0); 
  const [consecutivePasses, setConsecutivePasses] = useState(0); 
  const [multiTargetStep, setMultiTargetStep] = useState(0); 
  const [compositionOuter, setCompositionOuter] = useState(null);
  const [doomedIds, setDoomedIds] = useState(new Set());
  const [isPReady, setIsPReady] = useState(false);
  const [isOReady, setIsOReady] = useState(false);

  const [pDeck, setPDeck] = useState([]);
  const [pHand, setPHand] = useState([]);
  const [pMonsters, setPMonsters] = useState([]);
  const [pSpells, setPSpells] = useState([]); 
  const [oDeck, setODeck] = useState([]);
  const [oHand, setOHand] = useState([]);
  const [oMonsters, setOMonsters] = useState([]);
  const [oSpells, setOSpells] = useState([]);
  const [activeField, setActiveField] = useState(null);

  // 2. 핵심 함수 정의 (Hoisting 방지를 위해 최상단 배치)

  const showNotification = useCallback((msg) => {
    setNotification(msg);
    setTimeout(() => setNotification(""), 1500);
  }, []);

  const emit = useCallback((actionType, data) => {
    socket.emit('GAME_ACTION', { roomCode, actionType, data });
  }, [roomCode]);

  const canAct = useCallback((pIdx) => {
    if (winner || phase === 'SETUP' || phase === 'DISCARD' || selectedAction) return true;
    const isMe = pIdx === myPlayerNumber;
    const hand = isMe ? pHand : oHand;
    const spells = isMe ? pSpells : oSpells;
    const totalMonsters = pMonsters.length + oMonsters.length;

    if (pIdx === turn && chain.length === 0) {
      if (hand.some(c => {
        if (c.type === 'monster') return !summonedThisTurn && (isMe ? pMonsters.length < 3 : oMonsters.length < 3);
        if (c.type === 'spell') {
          if (spells.length >= 3) return false;
          if (c.effect === 'COMPOSE') return totalMonsters >= 2;
          if (['DIFF', 'SUB', 'CLONE', 'LN_F', 'EXP_F', 'INTEGRAL', 'RECIPROCAL', 'INVERSE', 'NEGATE', 'ABS', 'MUL_X'].includes(c.effect)) return totalMonsters > 0;
          return true;
        }
        return spells.length < 3;
      })) return true;
    }
    if (spells.some(s => s.isSet && s.setAtTurn < totalTurns)) return true;
    if (chain.length > 0 && spells.length < 3 && hand.some(c => c.type === 'spell')) return true;
    return false;
  }, [winner, phase, selectedAction, myPlayerNumber, pHand, oHand, pSpells, oSpells, turn, chain, summonedThisTurn, totalTurns, pMonsters.length, oMonsters.length]);

  // --- [지능형 카드 발동 가능 여부 판정 엔진] ---
  const isCardPlayable = useCallback((card, isPlayer) => {
    // 1. 공통 차단 조건
    if (winner) return false; // 승패가 결정됨
    if (!isPlayer) return false; // 내 패가 아님
    if (priorityPlayer !== myPlayerNumber) return false; // 지금 내 우선권이 아님
    if (selectedAction) return false; // 이미 다른 마법의 타겟을 고르는 중임
    if (phase === 'DISCARD') return false; // 패 버리기 단계임

    const totalMonsters = pMonsters.length + oMonsters.length;
    const myMonsters = pMonsters.length;
    const mySpells = pSpells.length;

    // 2. SETUP PHASE (게임 시작 시 선제 소환 단계)
    if (phase === 'SETUP') {
      // 몬스터만 소환 가능하며, 최대 3장까지만 세트 가능
      return card.type === 'monster' && myMonsters < 3;
    }

    // 3. MAIN PHASE (일반적인 플레이 단계)
    if (phase === 'MAIN') {
      // (A) 몬스터 카드일 경우
      if (card.type === 'monster') {
        return (
          turn === myPlayerNumber && // 내 턴이어야 함
          chain.length === 0 &&      // 체인이 쌓이는 중이 아니어야 함 (일반 소환)
          !summonedThisTurn &&       // 이번 턴에 아직 소환권을 쓰지 않았어야 함
          myMonsters < 3             // 몬스터 존에 빈자리가 있어야 함
        );
      }

      // (B) 마법 / 함정 / 필드 카드일 경우
      if (card.type === 'spell' || card.type === 'trap' || card.type === 'field') {
        
        // 마함 존 빈자리 체크 (필드 카드는 전용 존이 있으므로 제외)
        if (card.type !== 'field' && mySpells >= 3) return false;

        // 체인이 비어있을 때 (패에서 능동적으로 발동 시도)
        if (chain.length === 0) {
          if (turn !== myPlayerNumber) return false; // 내 턴이 아니면 패에서 발동 불가

          // 효과별 특수 발동 조건 (덱 규칙 1번 반영)
          switch (card.effect) {
            case 'DRAW':
              // 규칙 1: 덱의 남은 매수가 드로우할 양보다 적으면 발동 불가
              return pDeck.length >= card.value;

            case 'COMPOSE':
              // 합성: 필드에 최소 2장의 몬스터가 있어야 함
              return totalMonsters >= 2;

            case 'HAND_DISCARD':
              // 패 파괴: 상대방의 패가 1장이라도 있어야 함
              return oHand.length > 0;

            case 'DIFF':
            case 'INTEGRAL':
            case 'SUB':
            case 'EXP_F':
            case 'LN_F':
            case 'RECIPROCAL':
            case 'INVERSE':
            case 'NEGATE':
            case 'ABS':
            case 'CLONE':
            case 'MUL_X':
              // 타겟팅 마법: 필드에 최소 1장의 몬스터가 있어야 함
              return totalMonsters > 0;

            default:
              return true;
          }
        } 
        
        // 체인이 형성된 후 (상대의 발동에 대응하여 패에서 마법 발동 시도)
        else {
          // 룰상 체인 중에는 '마법'만 패에서 대응 발동 가능 (함정은 미리 세트되어야 함)
          if (card.type !== 'spell') return false;
          
          // 드로우 마법 대응 시 덱 매수 체크
          if (card.effect === 'DRAW') return pDeck.length >= card.value;
          
          // 타겟팅 마법 대응 시 필드 체크
          if (['DIFF', 'SUB', 'CLONE'].includes(card.effect)) return totalMonsters > 0;
          
          return true;
        }
      }
    }

    return false;
  }, [
    winner, priorityPlayer, myPlayerNumber, selectedAction, phase, 
    pMonsters.length, oMonsters.length, pSpells.length, turn, 
    chain.length, summonedThisTurn, pDeck.length, oHand.length, totalTurns
  ]);
  
  const drawCard = useCallback((p, count) => {
  const isMe = p === myPlayerNumber;
  const currentDeck = isMe ? pDeck : oDeck;

  // 1. 덱이 부족한 상태에서 드로우 시도 시 패배
  if (currentDeck.length < count) {
    setWinner(isMe ? 'OPPONENT' : 'PLAYER');
    showNotification("DECK OUT!");
    return;
  }

  const newCards = currentDeck.slice(0, count);
  if (isMe) {
    setPHand(prev => [...prev, ...newCards]);
    setPDeck(prev => prev.slice(count));
  } else {
    setOHand(prev => [...prev, ...newCards]);
    setODeck(prev => prev.slice(count));
  }
  }, [pDeck, oDeck, myPlayerNumber]);

  const handleEndTurn = useCallback(() => {
    if (turn === myPlayerNumber && pHand.length > 8) { setPhase('DISCARD'); showNotification("DISCARD PHASE"); return; }
    const nextTurn = turn === 0 ? 1 : 0;
    setTurn(nextTurn); setTotalTurns(t => t + 1); setSummonedThisTurn(false);
    setPriorityPlayer(nextTurn); setConsecutivePasses(0);
    setPMonsters(prev => prev.map(m => ({...m, isProtected: false})));
    setOMonsters(prev => prev.map(m => ({...m, isProtected: false})));
    showNotification("DRAW PHASE"); 
    setTimeout(() => {
      drawCard(nextTurn, 2);
      showNotification("MAIN PHASE"); setPhase('MAIN');
    }, 1000);
  }, [turn, myPlayerNumber, pHand.length, drawCard, showNotification]);

  const handlePass = useCallback(() => {
    if (chain.length === 0 && turn === myPlayerNumber && priorityPlayer === myPlayerNumber) { handleEndTurn(); return; }
    setConsecutivePasses(prev => prev + 1);
    const nextPriority = priorityPlayer === 0 ? 1 : 0;
    setPriorityPlayer(nextPriority);
    if (priorityPlayer === myPlayerNumber) emit('PASS', {});
  }, [chain.length, turn, myPlayerNumber, priorityPlayer, handleEndTurn, emit]);

  const addToChain = useCallback((card, targetId, isOriginPlayer) => {
    let tName = "";
    if (targetId) {
      const t = pMonsters.find(m => m.instanceId === targetId) || oMonsters.find(m => m.instanceId === targetId) ||
                pMonsters.find(m => targetId.outer && m.instanceId === targetId.outer) || oMonsters.find(m => targetId.outer && m.instanceId === targetId.outer);
      tName = t ? `→ ${t.name}` : "";
    }
    setChain(prev => [...prev, { ...card, targetId, targetName: tName, isPlayer: isOriginPlayer }]);
    setPriorityPlayer(isOriginPlayer ? (myPlayerNumber === 0 ? 1 : 0) : myPlayerNumber);
    setConsecutivePasses(0);
    setSelectedAction(null);
    setHoveredTargetId(null);
    if (isOriginPlayer) emit('ADD_TO_CHAIN', { card, targetId, targetName: tName });
  }, [pMonsters, oMonsters, myPlayerNumber, emit]);

  const resolveChain = useCallback(() => {
    showNotification("RESOLVING...");
    let newPM = [...pMonsters]; let newOM = [...oMonsters];
    let newPS = [...pSpells]; let newOS = [...oSpells];
    let tempChain = [...chain];

    while (tempChain.length > 0) {
      const action = tempChain.pop(); const { card, targetId, isPlayer: actionOwner } = action;
      newPS = newPS.filter(s => s.instanceId !== card.instanceId); newOS = newOS.filter(s => s.instanceId !== card.instanceId);
      
      // 광역 효과
      if (['FIELD_DIFF', 'FIELD_INTEGRAL', 'OPP_FIELD_INTEGRAL', 'MACLAURIN', 'LIMIT'].includes(card.effect)) {
        let ts = (card.effect === 'FIELD_INTEGRAL') ? (actionOwner ? newPM : newOM) : (actionOwner ? newOM : newPM);
        const resList = ts.map(m => {
          if (m.isProtected) return m;
          let n = m.formula;
          if (card.effect === 'FIELD_DIFF') n = derivative(n, 'x').toString();
          if (card.effect.includes('INTEGRAL')) n = `integral(${n}, x)`;
          if (card.effect === 'LIMIT') n = evaluate(n, {x: 0}).toString();
          if (card.effect === 'MACLAURIN') n = getMaclaurin(n);
          const chk = checkDestruction(n, activeField); return chk.destroyed ? null : {...m, formula: chk.formula};
        }).filter(m => m);
        if (ts === newPM) newPM = resList; else newOM = resList; continue;
      }

      // 합성 (S-12)
      if (card.effect === 'COMPOSE') {
        const outer = newPM.find(m => m.instanceId === targetId.outer) || newOM.find(m => m.instanceId === targetId.outer);
        const inner = newPM.find(m => m.instanceId === targetId.inner) || newOM.find(m => m.instanceId === targetId.inner);
        if (outer && inner) {
          outer.formula = parse(outer.formula).transform(node => (node.isSymbolNode && node.name === 'x') ? parse(inner.formula) : node).toString();
          newPM = newPM.filter(m => m.instanceId !== targetId.inner); newOM = newOM.filter(m => m.instanceId !== targetId.inner);
        } continue;
      }

      // 단일 타겟 효과
      let target = newPM.find(m => m.instanceId === targetId) || newOM.find(m => m.instanceId === targetId);
      if (!target || target.isProtected) continue;
      let next = target.formula;
      switch(card.effect) {
        case 'DIFF': const times = activeField?.effect === 'SECOND_DERIV' ? 2 : 1; for(let i=0; i<times; i++) next = derivative(next, 'x').toString(); break;
        case 'INTEGRAL': next = `integral(${next}, x)`; break;
        case 'SUB': next = evaluate(next, {x: 1}).toString(); break;
        case 'EXP_F': next = `exp(${next})`; break;
        case 'LN_F': next = `log(${next})`; break;
        case 'RECIPROCAL': next = `1/(${next})`; break;
        case 'NEGATE': next = `-1*(${next})`; break;
        case 'ABS': next = `abs(${next})`; break;
        case 'MUL_X': next = `x*(${next})`; break;
        case 'INVERSE': next = inverseMap[next] || `1/(${next})`; break;
        case 'PROTECT': target.isProtected = true; break;
        case 'CLONE': 
            const clone = {...target, instanceId: Math.random()};
            if (actionOwner && newPM.length < 3) newPM.push(clone); else if (!actionOwner && newOM.length < 3) newOM.push(clone); break;
        default: break;
      }
      const res = checkDestruction(next, activeField);
      if (res.destroyed) { newPM = newPM.filter(m => m.instanceId !== targetId); newOM = newOM.filter(m => m.instanceId !== targetId); }
      else target.formula = (activeField?.effect === 'CONST_C' && card.effect === 'INTEGRAL') ? res.formula + "+C" : res.formula;
    }
    setTimeout(() => { setPMonsters(newPM); setOMonsters(newOM); setPSpells(newPS); setOSpells(newOS); setChain([]); setPriorityPlayer(turn); }, 800);
  }, [chain, pMonsters, oMonsters, pSpells, oSpells, activeField, turn, showNotification]);

  const simulateChain = useCallback(() => {
    if (chain.length === 0) { setDoomedIds(new Set()); return; }
    let simPM = pMonsters.map(m => ({ ...m })); let simOM = oMonsters.map(m => ({ ...m }));
    let doomed = new Set(); let tempChain = [...chain];
    while (tempChain.length > 0) {
      const action = tempChain.pop(); const { card, targetId, isPlayer: actionOwner } = action;
      let target = simPM.find(m => m.instanceId === targetId) || simOM.find(m => m.instanceId === targetId);
      if (target && action.card.effect === 'DIFF') {
        const next = derivative(target.formula, 'x').toString();
        if (checkDestruction(next, activeField).destroyed) doomed.add(targetId);
      }
    }
    setDoomedIds(doomed);
  }, [chain, pMonsters, oMonsters, activeField]);

  const setupGame = useCallback((d0, d1, firstTurn) => {
    const myD = myPlayerNumber === 0 ? d0 : d1;
    const opD = myPlayerNumber === 0 ? d1 : d0;
    setPDeck(myD.slice(6)); setODeck(opD.slice(6));
    setPHand(myD.slice(0, 6)); setOHand(opD.slice(0, 6));
    setPhase('SETUP'); setView('GAME'); setTurn(firstTurn); setPriorityPlayer(firstTurn);
    showNotification(firstTurn === myPlayerNumber ? "YOUR FIRST" : "OPPONENT FIRST");
  }, [myPlayerNumber, showNotification]);

  // 3. 소켓 및 자동 진행 이펙트
  useEffect(() => {
    socket.on('ROOM_CREATED', ({ roomCode, playerNumber }) => { setRoomCode(roomCode); setMyPlayerNumber(playerNumber); });
    socket.on('ROOM_JOINED', ({ roomCode, playerNumber }) => { setRoomCode(roomCode); setMyPlayerNumber(playerNumber); });
    socket.on('MATCH_FOUND', () => {
      if (myPlayerNumber === 0) {
        const all = [...MONSTERS, ...SPELLS, ...TRAPS, ...FIELDS];
        const d0 = [...all, ...all].sort(() => Math.random() - 0.5).slice(0, 40);
        const d1 = [...all, ...all].sort(() => Math.random() - 0.5).slice(0, 40);
        const firstTurn = Math.floor(Math.random() * 2);
        socket.emit('GAME_ACTION', { roomCode, actionType: 'INIT_GAME', data: { d0, d1, firstTurn } });
        setupGame(d0, d1, firstTurn);
      }
    });
    socket.on('OPPONENT_ACTION', ({ actionType, data }) => {
        switch (actionType) {
            case 'INIT_GAME': setupGame(data.d0, data.d1, data.firstTurn); break;
            case 'SETUP_MONSTER': setOMonsters(p => [...p, { ...data.card, isFacedown: true }]); setOHand(p => p.slice(0, -1)); break;
            case 'READY_SIGNAL': setIsOReady(true); break;
            case 'START_DUEL_SYNC': setPMonsters(data.pMonsters); setOMonsters(data.oMonsters); setPhase('MAIN'); setTotalTurns(1); showNotification("DUEL START!"); break;
            case 'PLAY_MONSTER': setOMonsters(p => [...p, data.card]); setOHand(p => p.slice(0, -1)); break;
            case 'SET_TRAP': setOSpells(p => [...p, { ...data.card, isSet: true }]); setOHand(p => p.slice(0, -1)); break;
            case 'PLAY_SPELL': setOSpells(p => [...p, data.card]); setOHand(p => p.slice(0, -1)); break;
            case 'PLAY_FIELD': setActiveField(data.card); setOHand(p => p.slice(0, -1)); break;
            case 'ADD_TO_CHAIN': addToChain(data.card, data.targetId, false); break;
            case 'PASS': handlePass(); break;
            case 'SURRENDER': setWinner('PLAYER'); break;
            default: break;
        }
    });
    return () => { socket.off('ROOM_CREATED'); socket.off('ROOM_JOINED'); socket.off('MATCH_FOUND'); socket.off('OPPONENT_ACTION'); };
  }, [myPlayerNumber, roomCode, setupGame, showNotification, addToChain, handlePass]);

  useEffect(() => {
    if (winner || phase === 'SETUP' || phase === 'START' || phase === 'DISCARD' || view === 'MENU') return;
    if (!canAct(priorityPlayer) && !selectedAction) handlePass();
    if (consecutivePasses >= 2 && chain.length > 0) resolveChain();
  }, [priorityPlayer, consecutivePasses, chain.length, phase, canAct, view, winner, selectedAction, handlePass, resolveChain]);

  useEffect(() => { simulateChain(); }, [chain, simulateChain]);

  // 4. 이벤트 핸들러
  const handleReady = () => {
    if (pMonsters.length < 1) return alert("몬스터를 세트하세요.");
    setIsPReady(true); emit('READY_SIGNAL', {});
  };

  useEffect(() => {
    if (phase === 'SETUP' && isPReady && isOReady && myPlayerNumber === 0) {
       const flippedPM = pMonsters.map(m => ({ ...m, isFacedown: false }));
       const flippedOM = oMonsters.map(m => ({ ...m, isFacedown: false }));
       emit('START_DUEL_SYNC', { oMonsters: flippedPM, pMonsters: flippedOM });
       setPMonsters(flippedPM); setOMonsters(flippedOM); setPhase('MAIN'); showNotification("DUEL START!");
    }
  }, [isPReady, isOReady, myPlayerNumber, pMonsters, oMonsters, emit, showNotification, phase]);

  const handleHandClick = (card, idx, isPlayer) => {
    if (phase === 'DISCARD' && isPlayer) {
      const newHand = pHand.filter((_, i) => i !== idx); setPHand(newHand);
      if (newHand.length <= 8) proceedToNextTurn();
      return;
    }
    if (!isCardPlayable(card, isPlayer)) return;
    if (phase === 'SETUP') {
      const newM = { ...card, instanceId: Math.random(), isFacedown: true };
      setPMonsters([...pMonsters, newM]); setPHand(pHand.filter((_, i) => i !== idx));
      emit('SETUP_MONSTER', { card: newM }); return;
    }
    if (card.type === 'monster') {
      const newM = { ...card, instanceId: Math.random(), isFacedown: false };
      setPMonsters([...pMonsters, newM]); setPHand(pHand.filter((_, i) => i !== idx));
      setSummonedThisTurn(true); emit('PLAY_MONSTER', { card: newM });
    } else if (card.type === 'spell') {
      const spellInst = { ...card, instanceId: Math.random() };
      setPSpells([...pSpells, spellInst]); setPHand(pHand.filter((_, i) => i !== idx));
      emit('PLAY_SPELL', { card: spellInst });
      if (['DIFF', 'SUB', 'CLONE', 'LN_F', 'EXP_F', 'RECIPROCAL', 'INVERSE', 'NEGATE', 'ABS', 'MUL_X'].includes(card.effect)) {
        setSelectedAction({ card: spellInst, isPlayer });
      } else if (card.effect === 'COMPOSE') { setMultiTargetStep(1); setSelectedAction({ card: spellInst, isPlayer }); }
      else addToChain(spellInst, null, true);
    } else if (card.type === 'trap') {
      const newT = { ...card, instanceId: Math.random(), isSet: true, setAtTurn: totalTurns };
      setPSpells([...pSpells, newT]); setPHand(pHand.filter((_, i) => i !== idx));
      emit('SET_TRAP', { card: newT });
    } else if (card.type === 'field') {
      setActiveField(card); setPHand(pHand.filter((_, i) => i !== idx));
      emit('PLAY_FIELD', { card });
    }
  };

  const handleTargetClick = (targetId) => {
    if (!selectedAction) return;
    if (selectedAction.card.effect === 'COMPOSE') {
      if (multiTargetStep === 1) { setCompositionOuter(targetId); setMultiTargetStep(2); }
      else { addToChain(selectedAction.card, { outer: compositionOuter, inner: targetId }, true); setMultiTargetStep(0); setCompositionOuter(null); }
    } else addToChain(selectedAction.card, targetId, true);
  };

  const calculateProjection = (f, action) => {
    try {
      const eff = action.card.effect; let r = f;
      if (eff === 'DIFF') { const t = activeField?.effect === 'SECOND_DERIV' ? 2 : 1; for(let i=0; i<t; i++) r = derivative(r, 'x').toString(); }
      else if (eff === 'SUB') r = evaluate(f, {x: 1}).toString();
      const simplified = simplify(r).toString();
      const c = checkDestruction(simplified, activeField); return c.destroyed ? "\\mathbf{0}" : formatFormula(simplified);
    } catch { return "Error"; }
  };

  const renderCard = (card, isPlayerSide, isFacedown, onClick, isHover = false, isHand = false, listIdx = 0) => {
    const isMonster = card.type === 'monster';
    let mathContent = isMonster ? formatFormula(card.formula) : card.display;
    if (isHover && selectedAction && selectedAction.card.effect !== 'COMPOSE') mathContent = calculateProjection(card.formula, selectedAction);
    const playable = isHand && isCardPlayable(card, isPlayerSide);
    return (
      <div key={card.instanceId || `card-${listIdx}`} className={`card ${card.type} ${isFacedown ? 'back' : (isPlayerSide && card.isSet ? 'facedown peekable' : '')} ${isHover ? 'projection-hover' : ''} ${card.isProtected ? 'protected' : ''} ${doomedIds.has(card.instanceId) ? 'doomed' : ''} ${playable ? 'playable' : ''}`} onClick={onClick}>
        {!isFacedown && (
          <><span className="name">{card.name}</span>
            <div className={`formula ${isHover ? 'projection-text' : ''} ${doomedIds.has(card.instanceId) ? 'doomed-text' : ''}`}><div><InlineMath math={mathContent} /></div></div>
            <span className="type-label">{doomedIds.has(card.instanceId) ? "DOOMED" : card.type.toUpperCase()}</span></>
        )}
      </div>
    );
  };

  if (view === 'MENU') return <Menu roomCode={roomCode} inputCode={inputCode} setInputCode={setInputCode} />;

  return (
    <div className="game-container">
      {notification && <div className="phase-notification">{notification}</div>}
      <div className="hand-container top">{oHand.map((c, i) => <div key={`o-hand-${i}`} className="card back small" />)}</div>
      <div className="main-arena">
        <div className="duel-board">
          <div className="zone spell-zone opponent-side">
            {[0, 1, 2].map(i => (<div key={`o-spell-slot-${i}`} className="slot">{oSpells[i] && <div className={`card ${oSpells[i].isSet ? 'back' : 'spell'}`}>{!oSpells[i].isSet && <InlineMath math={oSpells[i].display} />}</div>}</div>))}
          </div>
          <div className="zone monster-zone opponent-side">
            {[0, 1, 2].map(i => (<div key={`o-mon-slot-${i}`} className="slot" onMouseEnter={() => selectedAction && setHoveredTargetId(oMonsters[i]?.instanceId)} onMouseLeave={() => setHoveredTargetId(null)} onClick={() => handleTargetClick(oMonsters[i]?.instanceId)}>{oMonsters[i] && renderCard(oMonsters[i], false, oMonsters[i].isFacedown, null, hoveredTargetId === oMonsters[i].instanceId)}</div>))}
          </div>
          <div className="center-divider">
            <div className="field-anchor"><div className="slot field-slot">{activeField ? renderCard(activeField, true, false, null) : <span className="slot-label">FIELD</span>}</div></div>
            <div className="control-anchor">
              <div className={`turn-priority-tab ${turn === myPlayerNumber ? "player-turn" : "opponent-turn"}`}>
                <div className="turn-info">TURN {totalTurns}</div>
                <div className={`priority-tag ${priorityPlayer === myPlayerNumber ? "player" : "opponent"}`}>{priorityPlayer === myPlayerNumber ? "YOUR PRIORITY" : "OPP PRIORITY"}</div>
                {phase === 'SETUP' ? <button className={`setup-btn ${isPReady ? "ready-active" : ""}`} onClick={handleReady}>{isPReady ? "READY √" : "READY"}</button> : 
                <button className="pass-btn" onClick={handlePass} disabled={winner || priorityPlayer !== myPlayerNumber}>PASS</button>}
              </div>
            </div>
          </div>
          <div className="zone monster-zone player-side">
            {[0, 1, 2].map(i => (<div key={`p-mon-slot-${i}`} className="slot" onMouseEnter={() => selectedAction && setHoveredTargetId(pMonsters[i]?.instanceId)} onMouseLeave={() => setHoveredTargetId(null)} onClick={() => handleTargetClick(pMonsters[i]?.instanceId)}>{pMonsters[i] && renderCard(pMonsters[i], true, pMonsters[i].isFacedown, null, hoveredTargetId === pMonsters[i].instanceId)}</div>))}
          </div>
          <div className="zone spell-zone player-side">
            {[0, 1, 2].map(i => <div key={`p-spell-slot-${i}`} className="slot" onClick={() => pSpells[i] && (pSpells[i].setAtTurn < totalTurns ? addToChain(pSpells[i], null, true) : null)}>{pSpells[i] && renderCard(pSpells[i], true, false, null)}</div>)}
          </div>
        </div>
      </div>
      <div className={`hand-container bottom ${phase === 'DISCARD' ? 'discard-mode' : ''} ${selectedAction ? 'targeting-mode' : ''}`}>
        {pHand.map((c, i) => renderCard(c, true, false, () => handleHandClick(c, i, true), false, true, i))}
      </div>
      <div className="chain-stack">{chain.map((c, i) => <div key={`chain-${i}`} className={`chain-tag ${c.isPlayer ? 'p-chain' : 'o-chain'}`}><span className="chain-card-name">{c.card.name}</span><span className="chain-target-name">{c.targetName}</span></div>)}</div>
      <button className="menu-exit-btn" onClick={() => { if(window.confirm("항복하시겠습니까?")) { emit('SURRENDER', {}); setWinner('OPPONENT'); } }}>SURRENDER</button>
      {winner && <div className="victory-overlay"><div className="modal"><h1>{winner === 'PLAYER' ? 'VICTORY' : 'DEFEAT'}</h1><button className="btn restart-btn" onClick={() => setView('MENU')}>MENU</button></div></div>}
    </div>
  );
}