import React, { useState, useEffect, useCallback } from 'react';
import { derivative, simplify, evaluate, parse } from 'mathjs';
import 'katex/dist/katex.min.css';
import { InlineMath } from 'react-katex';
import { io } from 'socket.io-client';
import './App.css';
import { MONSTERS, SPELLS, TRAPS, FIELDS } from './cards';

const socket = io('http://localhost:3001');
const ALL_CARDS_LIB = [...MONSTERS, ...SPELLS, ...TRAPS, ...FIELDS];

// --- 수학 유틸리티 ---
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

const sortCards = (cards) => {
  const priority = { monster: 0, spell: 1, trap: 2, field: 3 };
  return [...cards].sort((a, b) => priority[a.type] - priority[b.type] || a.id.localeCompare(b.id));
};

// --- 메뉴 컴포넌트 ---
function Menu({ setView }) {
  return (
    <div className="menu-screen">
      <h1 className="game-title">NABLA MASTERS</h1>
      <div className="menu-main">
        <button className="menu-btn large" onClick={() => setView('DUEL_MENU')}>DUEL</button>
        <button className="menu-btn large" onClick={() => setView('DECK_LIST')}>DECK</button>
      </div>
    </div>
  );
}

// --- 덱 편집기 컴포넌트 ---
function DeckEditor({ deck, onSave, onBack }) {
  const [currentCards, setCurrentCards] = useState(deck.cards || []);
  const handleAdd = (e, card) => {
    e.preventDefault();
    if (currentCards.length >= 60) return;
    if (currentCards.filter(c => c.id === card.id).length >= 4) return;
    setCurrentCards(sortCards([...currentCards, { ...card, instanceId: Math.random() }]));
  };
  const handleRemove = (e, instId) => {
    e.preventDefault();
    setCurrentCards(currentCards.filter(c => c.instanceId !== instId));
  };
  return (
    <div className="deck-editor">
      <div className="editor-header">
        <h2>{deck.name} ({currentCards.length}/60)</h2>
        <div><button onClick={() => onSave(currentCards)}>SAVE</button><button onClick={onBack}>BACK</button></div>
      </div>
      <div className="editor-body">
        <div className="deck-view">
          <h3>MY DECK (Right-Click to Remove)</h3>
          <div className="mini-grid">{currentCards.map(c => (
            <div key={c.instanceId} className={`mini-card ${c.type}`} onContextMenu={(e)=>handleRemove(e, c.instanceId)}>
              <span className="mini-card-name">{c.name}</span>
              <div className="mini-formula"><InlineMath math={c.display || c.formula} /></div>
            </div>
          ))}</div>
        </div>
        <div className="library-view">
          <h3>LIBRARY (Right-Click to Add)</h3>
          <div className="mini-grid">{ALL_CARDS_LIB.map(c => (
            <div key={c.id} className={`mini-card ${c.type}`} onContextMenu={(e)=>handleAdd(e, c)}>
              <span className="mini-card-name">{c.name}</span>
              <div className="mini-formula"><InlineMath math={c.display || c.formula} /></div>
            </div>
          ))}</div>
        </div>
      </div>
    </div>
  );
}

// --- 메인 앱 컴포넌트 ---
export default function App() {
  const [view, setView] = useState('MENU'); 
  const [decks, setDecks] = useState(JSON.parse(localStorage.getItem('nabla_decks')) || [{id: 'd1', name: 'Starter Deck', cards: []}]);
  const [editingDeck, setEditingDeck] = useState(null);
  const [selectedDeckId, setSelectedDeckId] = useState(decks[0]?.id);

  const [roomCode, setRoomCode] = useState("");
  const [inputCode, setInputCode] = useState("");
  const [myPlayerNumber, setMyPlayerNumber] = useState(null); 
  const [isPReady, setIsPReady] = useState(false);
  const [isOReady, setIsOReady] = useState(false);

  const [phase, setPhase] = useState('START'); 
  const [turn, setTurn] = useState(0); 
  const [totalTurns, setTotalTurns] = useState(1); 
  const [winner, setWinner] = useState(null);
  const [notification, setNotification] = useState(""); 
  const [chain, setChain] = useState([]);
  const [selectedAction, setSelectedAction] = useState(null); 
  const [summonedThisTurn, setSummonedThisTurn] = useState(false);
  const [priorityPlayer, setPriorityPlayer] = useState(0); 
  const [consecutivePasses, setConsecutivePasses] = useState(0); 
  const [doomedIds, setDoomedIds] = useState(new Set());

  const [pDeck, setPDeck] = useState([]);
  const [pHand, setPHand] = useState([]);
  const [pMonsters, setPMonsters] = useState([]);
  const [pSpells, setPSpells] = useState([]); 
  const [oDeck, setODeck] = useState([]);
  const [oHand, setOHand] = useState([]);
  const [oMonsters, setOMonsters] = useState([]);
  const [oSpells, setOSpells] = useState([]);
  const [activeField, setActiveField] = useState(null);

  useEffect(() => { localStorage.setItem('nabla_decks', JSON.stringify(decks)); }, [decks]);

  const showNotification = useCallback((msg) => {
    setNotification(msg);
    setTimeout(() => setNotification(""), 1500);
  }, []);

  const emit = useCallback((actionType, data) => {
    socket.emit('GAME_ACTION', { roomCode, actionType, data });
  }, [roomCode]);

  // --- 덱 상태 체크 함수 ---
  const isCardPlayable = useCallback((card, isPlayer) => {
    if (winner || !isPlayer || selectedAction) return false;
    if (phase === 'SETUP') return card.type === 'monster' && pMonsters.length < 3;
    if (priorityPlayer !== myPlayerNumber) return false;
    if (phase === 'MAIN') {
      if (card.type === 'monster') return turn === myPlayerNumber && chain.length === 0 && !summonedThisTurn && pMonsters.length < 3;
      if (card.type === 'spell') return pSpells.length < 3 && (card.effect === 'DRAW' ? pDeck.length >= card.value : true);
      return (card.type === 'trap' || card.type === 'field') && turn === myPlayerNumber && chain.length === 0 && pSpells.length < 3;
    }
    return false;
  }, [winner, selectedAction, phase, pMonsters.length, priorityPlayer, myPlayerNumber, turn, chain.length, summonedThisTurn, pSpells.length, pDeck.length]);

  const canAct = useCallback((pIdx) => {
    if (winner || phase === 'SETUP' || phase === 'DISCARD' || selectedAction) return true;
    const hand = pIdx === myPlayerNumber ? pHand : oHand;
    const spells = pIdx === myPlayerNumber ? pSpells : oSpells;
    if (pIdx === turn && chain.length === 0) {
      if (hand.some(c => c.type === 'monster' ? !summonedThisTurn : spells.length < 3)) return true;
    }
    if (spells.some(s => s.isSet && s.setAtTurn < totalTurns)) return true;
    if (chain.length > 0 && spells.length < 3 && hand.some(c => c.type === 'spell')) return true;
    return false;
  }, [winner, phase, selectedAction, myPlayerNumber, pHand, oHand, pSpells, oSpells, turn, chain, summonedThisTurn, totalTurns]);

  const setupGame = useCallback((d0, d1, firstTurn) => {
    const myD = myPlayerNumber === 0 ? d0 : d1;
    const opD = myPlayerNumber === 0 ? d1 : d0;
    setPDeck(myD); setODeck(opD);
    setPHand(myD.slice(0, 6)); setOHand(opD.slice(0, 6));
    setPDeck(prev => prev.slice(6)); setODeck(prev => prev.slice(6));
    setPhase('SETUP'); setView('GAME'); setTurn(firstTurn); setPriorityPlayer(firstTurn);
    showNotification(firstTurn === myPlayerNumber ? "YOUR FIRST" : "OPPONENT FIRST");
  }, [myPlayerNumber, showNotification]);

  // --- 소켓 이벤트 핸들러 ---
  useEffect(() => {
    socket.on('ROOM_CREATED', ({ roomCode, playerNumber }) => { setRoomCode(roomCode); setMyPlayerNumber(playerNumber); setView('LOBBY'); });
    socket.on('ROOM_JOINED', ({ roomCode, playerNumber }) => { setRoomCode(roomCode); setMyPlayerNumber(playerNumber); setView('LOBBY'); });
    socket.on('MATCH_FOUND', () => showNotification("상대방이 입장했습니다!"));
    socket.on('OPPONENT_READY', () => setIsOReady(true));
    socket.on('GAME_START_SIGNAL', ({ decks: allDecks, firstTurn, playerIds }) => {
      const myId = socket.id;
      const opId = playerIds.find(id => id !== myId);
      setupGame(allDecks[myId], allDecks[opId], firstTurn);
    });
    socket.on('OPPONENT_ACTION', ({ actionType, data }) => {
        switch (actionType) {
            case 'SETUP_MONSTER': setOMonsters(p => [...p, { ...data.card, isFacedown: true }]); setOHand(p => p.slice(0, -1)); break;
            case 'READY_SIGNAL': setIsOReady(true); break;
            case 'START_DUEL_SYNC': setPMonsters(data.pMonsters); setOMonsters(data.oMonsters); setPhase('MAIN'); setTotalTurns(1); showNotification("DUEL START!"); break;
            case 'PLAY_MONSTER': setOMonsters(p => [...p, data.card]); setOHand(p => p.slice(0, -1)); break;
            case 'PASS': handlePass(); break;
            default: break;
        }
    });
    return () => { socket.off('ROOM_CREATED'); socket.off('ROOM_JOINED'); socket.off('GAME_START_SIGNAL'); socket.off('OPPONENT_ACTION'); };
  }, [myPlayerNumber, roomCode, setupGame, showNotification]);

  const handlePass = useCallback(() => {
    if (chain.length === 0 && turn === myPlayerNumber && priorityPlayer === myPlayerNumber) {
      const nextTurn = turn === 0 ? 1 : 0;
      setTurn(nextTurn); setTotalTurns(t => t + 1); setPriorityPlayer(nextTurn);
      emit('PASS', {}); return;
    }
    setConsecutivePasses(prev => prev + 1);
    setPriorityPlayer(priorityPlayer === 0 ? 1 : 0);
  }, [chain, turn, myPlayerNumber, priorityPlayer, emit]);

  const resolveChain = useCallback(() => {
    showNotification("RESOLVING...");
    let newPM = [...pMonsters]; let newOM = [...oMonsters];
    let newPS = [...pSpells]; let newOS = [...oSpells];
    let tempChain = [...chain];
    while (tempChain.length > 0) {
      const action = tempChain.pop(); const { card, targetId } = action;
      newPS = newPS.filter(s => s.instanceId !== card.instanceId); newOS = newOS.filter(s => s.instanceId !== card.instanceId);
      let target = newPM.find(m => m.instanceId === targetId) || newOM.find(m => m.instanceId === targetId);
      if (target && action.effect === 'DIFF') {
        const next = derivative(target.formula, 'x').toString();
        const res = checkDestruction(next, activeField);
        if (res.destroyed) { newPM = newPM.filter(m => m.instanceId !== targetId); newOM = newOM.filter(m => m.instanceId !== targetId); }
        else target.formula = res.formula;
      }
    }
    setTimeout(() => { setPMonsters(newPM); setOMonsters(newOM); setPSpells(newPS); setOSpells(newOS); setChain([]); setPriorityPlayer(turn); }, 800);
  }, [chain, pMonsters, oMonsters, pSpells, oSpells, activeField, turn, showNotification]);

  useEffect(() => {
    if (winner || phase === 'SETUP' || phase === 'START' || phase === 'DISCARD' || view !== 'GAME') return;
    if (!canAct(priorityPlayer) && !selectedAction) handlePass();
    if (consecutivePasses >= 2 && chain.length > 0) resolveChain();
  }, [priorityPlayer, consecutivePasses, chain, phase, canAct, view, winner, selectedAction, handlePass, resolveChain]);

  const handleHandClick = (card, idx, isPlayer) => {
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
    }
  };

  const renderCard = (card, isPlayerSide, isFacedown, onClick, isHand = false) => {
    const isMonster = card.type === 'monster';
    let mathContent = isMonster ? formatFormula(card.formula) : card.display;
    const playable = isHand && isCardPlayable(card, isPlayerSide);
    return (
      <div key={card.instanceId || Math.random()} className={`card ${card.type} ${isFacedown ? 'back' : (isPlayerSide && card.isSet ? 'facedown' : '')} ${playable ? 'playable' : ''}`} onClick={onClick}>
        {!isFacedown && (
          <><span className="name">{card.name}</span>
            <div className="formula"><div><InlineMath math={mathContent} /></div></div>
            <span className="type-label">{card.type.toUpperCase()}</span></>
        )}
      </div>
    );
  };

  // --- 화면 분기 ---
  if (view === 'MENU') return <Menu setView={setView} />;

  if (view === 'DECK_LIST') return (
    <div className="menu-screen">
      <h2>MY DECKS</h2>
      <div className="deck-grid">
        {decks.map(d => (
          <div key={d.id} className="deck-slot" onClick={() => { setEditingDeck(d); setView('DECK_EDITOR'); }}>
            {d.name} ({d.cards.length})
          </div>
        ))}
        <div className="deck-slot add-new" onClick={() => setDecks([...decks, {id: Date.now().toString(), name: 'New Deck', cards: []}])}>+ NEW DECK</div>
      </div>
      <button className="menu-btn" onClick={() => setView('MENU')}>BACK</button>
    </div>
  );

  if (view === 'DECK_EDITOR') return <DeckEditor deck={editingDeck} onBack={() => setView('DECK_LIST')} onSave={(c) => { setDecks(decks.map(d => d.id === editingDeck.id ? {...d, cards: c} : d)); setView('DECK_LIST'); }} />;

  if (view === 'DUEL_MENU') return (
    <div className="menu-screen">
      <h2>DUEL MODE</h2>
      <div className="menu-options">
        <button className="menu-btn" onClick={() => setView('ROOM_LOBBY')}>MULTI PLAY</button>
        <button className="menu-btn" onClick={() => setView('MENU')}>BACK</button>
      </div>
    </div>
  );

  if (view === 'ROOM_LOBBY') return (
    <div className="menu-screen">
      <div className="menu-options">
        <button className="menu-btn" onClick={() => socket.emit('CREATE_ROOM')}>CREATE ROOM</button>
        <div className="join-group">
          <input type="text" placeholder="ROOM CODE" value={inputCode} onChange={(e)=>setInputCode(e.target.value.toUpperCase())} />
          <button className="menu-btn" onClick={() => socket.emit('JOIN_ROOM', inputCode)}>JOIN</button>
        </div>
        <button className="menu-btn" onClick={() => setView('DUEL_MENU')}>BACK</button>
      </div>
    </div>
  );

  if (view === 'LOBBY') return (
    <div className="menu-screen lobby">
      <div className="room-info-header">
        <p>ROOM CODE: <span className="code-display">{roomCode}</span></p>
      </div>
      <h2>SELECT DECK & READY</h2>
      <div className="deck-selector">
        {decks.map(d => (
          <div key={d.id} className={`deck-item ${selectedDeckId === d.id ? 'selected' : ''}`} onClick={() => setSelectedDeckId(d.id)}>
            {d.name} ({d.cards.length} cards)
          </div>
        ))}
      </div>
      <button className={`menu-btn ${isPReady ? 'ready' : ''}`} onClick={() => {
        const d = decks.find(d => d.id === selectedDeckId);
        if (d.cards.length < 40) return alert("덱이 40장 미만입니다.");
        setIsPReady(true);
        socket.emit('READY_TO_START', { roomCode, deck: d.cards });
      }}>{isPReady ? 'READY √' : 'READY TO DUEL'}</button>
      <button className="menu-btn" onClick={() => setView('ROOM_LOBBY')}>LEAVE</button>
    </div>
  );

  return (
    <div className="game-container">
      {notification && <div className="phase-notification">{notification}</div>}
      <div className="hand-container top">{oHand.map((c, i) => <div key={`o-hand-${i}`} className="card back small" />)}</div>
      <div className="main-arena">
        <div className="duel-board">
          <div className="zone spell-zone opponent-side">{[0,1,2].map(i => <div key={`o-spell-${i}`} className="slot">{oSpells[i] && <div className="card back" />}</div>)}</div>
          <div className="zone monster-zone opponent-side">{[0,1,2].map(i => (<div key={`o-mon-${i}`} className="slot">{oMonsters[i] && renderCard(oMonsters[i], false, oMonsters[i].isFacedown, null)}</div>))}</div>
          <div className="center-divider">
            <div className="field-anchor"><div className="slot field-slot">{activeField ? renderCard(activeField, true, false, null) : <span className="slot-label">FIELD</span>}</div></div>
            <div className={`turn-priority-tab ${turn === myPlayerNumber ? "player-turn" : "opponent-turn"}`}>
                <div className="turn-info">TURN {totalTurns}</div>
                {phase === 'SETUP' ? <button className="setup-btn" onClick={() => {setIsPReady(true); emit('READY_SIGNAL', {})}}>READY</button> : 
                <button className="pass-btn" onClick={handlePass} disabled={winner || priorityPlayer !== myPlayerNumber}>PASS</button>}
              </div>
          </div>
          <div className="zone monster-zone player-side">{[0,1,2].map(i => (<div key={`p-mon-${i}`} className="slot" onClick={() => selectedAction && setSelectedAction(null)}>{pMonsters[i] && renderCard(pMonsters[i], true, pMonsters[i].isFacedown, null)}</div>))}</div>
          <div className="zone spell-zone player-side">{[0,1,2].map(i => <div key={`p-spell-${i}`} className="slot">{pSpells[i] && renderCard(pSpells[i], true, false, null)}</div>)}</div>
        </div>
      </div>
      <div className="hand-container bottom">{pHand.map((c, i) => renderCard(c, true, false, () => handleHandClick(c, i, true), true))}</div>
    </div>
  );
}