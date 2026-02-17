import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { derivative, simplify, evaluate, parse } from 'mathjs';
import 'katex/dist/katex.min.css';
import { InlineMath } from 'react-katex';
import { io } from 'socket.io-client';
import './App.css';
import { MONSTERS, SPELLS, TRAPS, FIELDS } from './cards';

const socket = io('https://renate-nonmultiplicative-edgardo.ngrok-free.dev');
const ALL_CARDS_LIB = [...MONSTERS, ...SPELLS, ...TRAPS, ...FIELDS];

// --- [A] 유틸리티 ---
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

const sortCards = (cards) => {
  const p = { monster: 0, spell: 1, trap: 2, field: 3 };
  return [...cards].sort((a, b) => p[a.type] - p[b.type] || a.id.localeCompare(b.id));
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

// --- [B] 공통 카드 UI 컴포넌트 ---
function CardUI({ card, isFacedown, isPlayerSide, isPlayable, isHover, onClick, onContextMenu, className }) {
  const isMonster = card.type === 'monster';
  const mathContent = isMonster ? formatFormula(card.formula) : card.display;
  return (
    <div 
      className={`card ${card.type} ${isFacedown ? 'back' : (isPlayerSide && card.isSet ? 'facedown peekable' : '')} ${isPlayable ? 'playable' : ''} ${isHover ? 'projection-hover' : ''} ${className || ''}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {!isFacedown && (
        <>
          <span className="card-name">{card.name}</span>
          <div className="card-formula"><InlineMath math={mathContent} /></div>
          <span className="card-type-label">{card.type.toUpperCase()}</span>
        </>
      )}
    </div>
  );
}

// --- [C] 메뉴/로비 컴포넌트 ---
function Menu({ setView, isConnected }) {
  return (
    <div className="menu-screen">
      <h1 className="game-title">NABLA MASTERS</h1>
      <div className="menu-main vertical">
        <button className="menu-btn large" onClick={() => setView('DUEL_MENU')}>DUEL</button>
        <button className="menu-btn large" onClick={() => setView('DECK_LIST')}>DECK</button>
      </div>
      <div className={`connection-status ${isConnected ? 'on' : 'off'}`}>
        Server: {isConnected ? "CONNECTED" : "DISCONNECTED"}
      </div>
    </div>
  );
}

function DeckEditor({ deck, onSave, onBack }) {
  const [currentCards, setCurrentCards] = useState(deck.cards || []);
  const handleAdd = (e, card) => {
    e.preventDefault();
    if (currentCards.length >= 60 || currentCards.filter(c => c.id === card.id).length >= 4) return;
    setCurrentCards(sortCards([...currentCards, { ...card, instanceId: Math.random() }]));
  };
  const handleRemove = (e, instId) => {
    e.preventDefault();
    setCurrentCards(currentCards.filter(c => c.instanceId !== instId));
  };
  return (
    <div className="deck-editor" onContextMenu={(e)=>e.preventDefault()}>
      <div className="editor-header">
        <h2>{deck.name} ({currentCards.length}/60)</h2>
        <div className="header-btns"><button className="menu-btn primary" onClick={() => onSave(currentCards)}>SAVE</button><button className="menu-btn" onClick={onBack}>BACK</button></div>
      </div>
      <div className="editor-body">
        <div className="deck-view"><h3>MY DECK</h3><div className="editor-grid">{currentCards.map((c,i)=><div key={c.instanceId||i} className="editor-card-wrapper"><CardUI card={c} onContextMenu={(e)=>handleRemove(e, c.instanceId)}/></div>)}</div></div>
        <div className="library-view"><h3>LIBRARY</h3><div className="editor-grid">{ALL_CARDS_LIB.map((c,i)=><div key={c.id||i} className="editor-card-wrapper"><CardUI card={c} onContextMenu={(e)=>handleAdd(e, c)}/></div>)}</div></div>
      </div>
    </div>
  );
}

// --- [D] 메인 앱 컴포넌트 ---
export default function App() {
  const [view, setView] = useState('MENU'); 
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [decks, setDecks] = useState(JSON.parse(localStorage.getItem('nabla_decks')) || [{id: 'd1', name: 'Starter Deck', cards: []}]);
  const [editingDeck, setEditingDeck] = useState(null);
  const [selectedDeckId, setSelectedDeckId] = useState(decks[0]?.id);
  const [roomCode, setRoomCode] = useState("");
  const [inputCode, setInputCode] = useState("");
  const [showJoinInput, setShowJoinInput] = useState(false);
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
  const [priorityPlayer, setPriorityPlayer] = useState(0); 
  const [consecutivePasses, setConsecutivePasses] = useState(0); 
  const [pDeck, setPDeck] = useState([]); const [pHand, setPHand] = useState([]); const [pMonsters, setPMonsters] = useState([]); const [pSpells, setPSpells] = useState([]);
  const [oDeck, setODeck] = useState([]); const [oHand, setOHand] = useState([]); const [oMonsters, setOMonsters] = useState([]); const [oSpells, setOSpells] = useState([]);
  const [activeField, setActiveField] = useState(null);
  const [doomedIds, setDoomedIds] = useState(new Set());
  const [hoveredTargetId, setHoveredTargetId] = useState(null);
  const [summonedThisTurn, setSummonedThisTurn] = useState(false);

  const showNotification = useCallback((msg) => { setNotification(msg); setTimeout(() => setNotification(""), 1500); }, []);
  const emit = useCallback((type, data) => socket.emit('GAME_ACTION', { roomCode, actionType: type, data }), [roomCode]);

  // 1. 소켓 리스너 설정
  useEffect(() => {
    socket.on('connect', () => setIsConnected(true));
    socket.on('disconnect', () => setIsConnected(false));
    socket.on('ROOM_CREATED', ({ roomCode, playerNumber }) => { setRoomCode(roomCode); setMyPlayerNumber(playerNumber); setView('LOBBY'); });
    socket.on('ROOM_JOINED', ({ roomCode, playerNumber }) => { setRoomCode(roomCode); setMyPlayerNumber(playerNumber); setView('LOBBY'); });
    socket.on('MATCH_FOUND', () => showNotification("상대방이 입장했습니다!"));
    socket.on('OPPONENT_READY', () => setIsOReady(true));
    socket.on('GAME_START_SIGNAL', ({ decks: allDecks, firstTurn, playerIds }) => {
      const myId = socket.id;
      const opId = playerIds.find(id => id !== myId);
      startGame(allDecks[myId], allDecks[opId], firstTurn);
    });
    socket.on('OPPONENT_ACTION', ({ actionType, data }) => handleOpponentAction(actionType, data));
    socket.on('ERROR', (m) => alert(m));
    return () => { socket.off('connect'); socket.off('ROOM_CREATED'); socket.off('ROOM_JOINED'); socket.off('GAME_START_SIGNAL'); socket.off('OPPONENT_ACTION'); };
  }, [myPlayerNumber, roomCode, showNotification]);

  const startGame = (myDeckData, opDeckData, firstTurn) => {
    setPDeck(myDeckData.slice(6)); setODeck(opDeckData.slice(6));
    setPHand(myDeckData.slice(0, 6)); setOHand(opDeckData.slice(0, 6));
    setPhase('SETUP'); setView('GAME'); setTurn(firstTurn); setPriorityPlayer(firstTurn);
    showNotification(firstTurn === myPlayerNumber ? "YOUR FIRST" : "OPPONENT FIRST");
  };

  const handleOpponentAction = (type, data) => {
    switch (type) {
      case 'SETUP_MONSTER': setOMonsters(p => [...p, {...data.card, isFacedown: true}]); setOHand(p => p.slice(0, -1)); break;
      case 'READY_SIGNAL': setIsOReady(true); break;
      case 'START_DUEL_SYNC': setPMonsters(data.pMonsters); setOMonsters(data.oMonsters); setPhase('MAIN'); showNotification("DUEL START!"); break;
      case 'PASS': handlePass(); break;
      case 'PLAY_MONSTER': setOMonsters(p => [...p, data.card]); setOHand(p => p.slice(0, -1)); break;
      default: break;
    }
  };

  // 2. 게임 엔진 로직
  const isCardPlayable = useCallback((card, isPlayer) => {
    if (winner || !isPlayer || selectedAction) return false;
    if (phase === 'SETUP') return card.type === 'monster' && pMonsters.length < 3;
    if (priorityPlayer !== myPlayerNumber) return false;
    if (phase === 'MAIN') {
      if (card.type === 'monster') return turn === myPlayerNumber && chain.length === 0 && pMonsters.length < 3;
      if (card.type === 'spell') return pSpells.length < 3;
      return (card.type === 'trap' || card.type === 'field') && chain.length === 0 && pSpells.length < 3;
    }
    return false;
  }, [winner, selectedAction, phase, pMonsters.length, priorityPlayer, myPlayerNumber, turn, chain.length, pSpells.length]);

  const handlePass = useCallback(() => {
    if (chain.length === 0 && turn === myPlayerNumber && priorityPlayer === myPlayerNumber) {
      const nextTurn = turn === 0 ? 1 : 0;
      setTurn(nextTurn); setTotalTurns(t => t + 1); setPriorityPlayer(nextTurn);
      emit('PASS', {}); return;
    }
    setPriorityPlayer(priorityPlayer === 0 ? 1 : 0);
    if (priorityPlayer === myPlayerNumber) emit('PASS', {});
  }, [chain, turn, myPlayerNumber, priorityPlayer, emit]);

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
      emit('PLAY_MONSTER', { card: newM });
    }
  };

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

  // 3. 뷰 렌더링
  if (view === 'MENU') return <Menu setView={setView} isConnected={isConnected} />;
  if (view === 'DECK_LIST') return (
    <div className="menu-screen">
      <h1 className="game-title small">MY DECKS</h1>
      <div className="deck-grid">
        {decks.map(d => (<div key={d.id} className="deck-slot" onClick={() => { setEditingDeck(d); setView('DECK_EDITOR'); }}>{d.name} ({d.cards.length})</div>))}
        <div className="deck-slot add-new" onClick={() => setDecks([...decks, {id: Date.now().toString(), name: 'New Deck', cards: []}])}>+ NEW DECK</div>
      </div>
      <button className="menu-btn" onClick={() => setView('MENU')}>BACK</button>
    </div>
  );
  if (view === 'DECK_EDITOR') return <DeckEditor deck={editingDeck} onBack={() => setView('DECK_LIST')} onSave={(c) => { setDecks(decks.map(d => d.id === editingDeck.id ? {...d, cards: c} : d)); setView('DECK_LIST'); }} />;
  if (view === 'DUEL_MENU') return (
    <div className="menu-screen"><h1 className="game-title small">DUEL MODE</h1><div className="menu-main vertical"><button className="menu-btn large" onClick={() => setView('ROOM_LOBBY')}>MULTI PLAY</button><button className="menu-btn large" onClick={() => setView('MENU')}>BACK</button></div></div>
  );
  if (view === 'ROOM_LOBBY') return (
    <div className="menu-screen"><h1 className="game-title small">MULTI PLAY</h1><div className="menu-main vertical">
        {!showJoinInput ? (<><button className="menu-btn large" onClick={() => socket.emit('CREATE_ROOM')}>CREATE ROOM</button><button className="menu-btn large" onClick={() => setShowJoinInput(true)}>JOIN ROOM</button><button className="menu-btn large" onClick={() => setView('DUEL_MENU')}>BACK</button></>) : 
        (<div className="join-input-container"><input className="room-code-input" type="text" placeholder="CODE" value={inputCode} onChange={(e)=>setInputCode(e.target.value.toUpperCase())} /><div className="join-btns"><button className="menu-btn primary" onClick={() => socket.emit('JOIN_ROOM', inputCode)}>JOIN</button><button className="menu-btn" onClick={() => setShowJoinInput(false)}>CANCEL</button></div></div>)}
    </div></div>
  );
  if (view === 'LOBBY') return (
    <div className="menu-screen lobby">
      <div className="room-info-header"><p>ROOM CODE</p><h2 className="code-display">{roomCode}</h2></div>
      <div className="deck-selector">{decks.map(d => (<div key={d.id} className={`deck-item ${selectedDeckId === d.id ? 'selected' : ''}`} onClick={() => setSelectedDeckId(d.id)}>{d.name} ({d.cards.length})</div>))}</div>
      <div className="lobby-btns"><button className={`menu-btn ${isPReady ? 'ready' : ''}`} onClick={() => { const d = decks.find(d => d.id === selectedDeckId); if (!d || d.cards.length < 40) return alert("덱은 40장 이상이어야 합니다."); setIsPReady(true); socket.emit('READY_TO_START', { roomCode, deck: d.cards }); }}>{isPReady ? 'READY √' : 'READY TO DUEL'}</button><button className="menu-btn" onClick={() => window.location.reload()}>LEAVE</button></div>
      {isOReady && <p className="status-msg">상대방 준비 완료!</p>}
    </div>
  );

  return (
    <div className="game-container">
      {notification && <div className="phase-notification">{notification}</div>}
      <div className="hand-container top">{oHand.map((c, i) => <div key={i} className="card back small" />)}</div>
      <div className="main-arena">
        <div className="duel-board">
          <div className="zone spell-zone opponent-side">{[0,1,2].map(i => (<div key={i} className="slot">{oSpells[i] && <div className="card back" />}</div>))}</div>
          <div className="zone monster-zone opponent-side">{[0,1,2].map(i => (<div key={i} className="slot">{oMonsters[i] && <CardUI card={oMonsters[i]} isFacedown={oMonsters[i].isFacedown} />}</div>))}</div>
          <div className="center-divider">
            <div className="field-anchor"><div className="slot field-slot">{activeField ? <CardUI card={activeField} /> : 'FIELD'}</div></div>
            <div className={`turn-priority-tab ${turn === myPlayerNumber ? "player-turn" : "opponent-turn"}`}><div className="turn-info">TURN {totalTurns}</div>
                {phase === 'SETUP' ? <button className={`setup-btn ${isPReady ? "ready-active" : ""}`} onClick={handleReady}>{isPReady ? "READY √" : "READY"}</button> : <button className="pass-btn" onClick={handlePass} disabled={priorityPlayer !== myPlayerNumber}>PASS</button>}
            </div>
          </div>
          <div className="zone monster-zone player-side">{[0,1,2].map(i => (<div key={i} className="slot">{pMonsters[i] && <CardUI card={pMonsters[i]} isPlayerSide={true} isFacedown={pMonsters[i].isFacedown} />}</div>))}</div>
          <div className="zone spell-zone player-side">{[0,1,2].map(i => (<div key={i} className="slot">{pSpells[i] && <CardUI card={pSpells[i]} isPlayerSide={true} />}</div>))}</div>
        </div>
      </div>
      <div className="hand-container bottom">{pHand.map((c, i) => <CardUI key={i} card={c} isPlayerSide={true} isPlayable={isCardPlayable(c, true)} onClick={() => handleHandClick(c, i, true)} />)}</div>
      <button className="menu-exit-btn" onClick={() => window.location.reload()}>SURRENDER</button>
    </div>
  );
}