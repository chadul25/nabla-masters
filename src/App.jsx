import React, { useState, useEffect, useCallback } from 'react';
import { derivative, simplify, evaluate, parse } from 'mathjs';
import 'katex/dist/katex.min.css';
import { InlineMath } from 'react-katex';
import { io } from 'socket.io-client';
import './App.css';
import { MONSTERS, SPELLS, TRAPS, FIELDS } from './cards';

const socket = io('https://renate-nonmultiplicative-edgardo.ngrok-free.dev');
const ALL_CARDS_LIB = [...MONSTERS, ...SPELLS, ...TRAPS, ...FIELDS];

// --- [A] 고성능 셔플 알고리즘 ---
const shuffleDeck = (array) => {
  const newArr = [...array];
  for (let i = newArr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
  }
  return newArr;
};

const formatFormula = (formula) => {
  try { return parse(simplify(formula).toString()).toTex(); } catch (e) { return formula; }
};

const checkDestruction = (formula, activeField) => {
  try {
    const simplified = simplify(formula).toString();
    if (simplified === '0') return { destroyed: true, reason: 'ZERO' };
    if (formula.includes('Infinity') || formula.includes('NaN')) return { destroyed: true, reason: 'UNDEFINED' };
    return { destroyed: false, formula: simplified };
  } catch (e) { return { destroyed: true, reason: 'UNDEFINED' }; }
};

const sortCards = (cards) => {
  const p = { monster: 0, spell: 1, trap: 2, field: 3 };
  return [...cards].sort((a, b) => p[a.type] - p[b.type] || a.id.localeCompare(b.id));
};

// --- [B] 카드 UI 컴포넌트 ---
function CardUI({ card, isFacedown, isPlayerSide, isPlayable, onClick, onContextMenu }) {
  if (!card) return null;
  const isMonster = card.type === 'monster';
  const mathContent = isMonster ? formatFormula(card.formula) : card.display;
  return (
    <div 
      className={`card ${card.type} ${isFacedown ? 'back' : (isPlayerSide && card.isSet ? 'facedown' : '')} ${isPlayable ? 'playable' : ''}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {!isFacedown && (
        <>
          <span className="card-name">{card.name}</span>
          <div className="card-formula"><div><InlineMath math={mathContent} /></div></div>
          <span className="card-type-label">{card.type.toUpperCase()}</span>
        </>
      )}
    </div>
  );
}

// --- [C] 메인 앱 ---
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
  const [summonedThisTurn, setSummonedThisTurn] = useState(false);

  const showNotification = useCallback((msg) => {
    setNotification(msg);
    setTimeout(() => setNotification(""), 1500);
  }, []);

  const emit = useCallback((actionType, data) => socket.emit('GAME_ACTION', { roomCode, actionType, data }), [roomCode]);

  // --- [1] 타겟팅 취소 (우클릭/ESC) ---
  const cancelTargeting = useCallback((e) => {
    if (e) e.preventDefault();
    if (selectedAction) {
      setSelectedAction(null);
      showNotification("TARGETING CANCELLED");
    }
  }, [selectedAction, showNotification]);

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') cancelTargeting(); };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [cancelTargeting]);

  const drawCard = useCallback((p, count) => {
    const isMe = p === myPlayerNumber;
    const currentDeck = isMe ? pDeck : oDeck;
    if (currentDeck.length < count) {
      setWinner(isMe ? 'OPPONENT' : 'PLAYER');
      showNotification("DECK OUT!"); return;
    }
    const newCards = currentDeck.slice(0, count);
    if (isMe) { setPHand(v => [...v, ...newCards]); setPDeck(v => v.slice(count)); }
    else { setOHand(v => [...v, ...newCards]); setODeck(v => v.slice(count)); }
  }, [pDeck, oDeck, myPlayerNumber, showNotification]);

  const handleEndTurn = useCallback(() => {
    const nextTurn = turn === 0 ? 1 : 0;
    setTurn(nextTurn); setTotalTurns(t => t + 1); setPriorityPlayer(nextTurn);
    setSummonedThisTurn(false); setConsecutivePasses(0);
    showNotification("NEXT TURN");
    if (myPlayerNumber === turn) emit('END_TURN_SYNC', { nextTurn, totalTurns: totalTurns + 1 });
    setTimeout(() => drawCard(nextTurn, 2), 500);
  }, [turn, myPlayerNumber, totalTurns, emit, drawCard, showNotification]);

  const handlePass = useCallback(() => {
    if (chain.length === 0 && turn === myPlayerNumber && priorityPlayer === myPlayerNumber) {
      handleEndTurn(); return;
    }
    setPriorityPlayer(priorityPlayer === 0 ? 1 : 0);
    setConsecutivePasses(prev => prev + 1);
    if (priorityPlayer === myPlayerNumber) emit('PASS', {});
  }, [chain.length, turn, myPlayerNumber, priorityPlayer, handleEndTurn, emit]);

  const resolveChain = useCallback(() => {
    showNotification("RESOLVING...");
    let newPM = [...pMonsters]; let newOM = [...oMonsters];
    let newPS = [...pSpells]; let newOS = [...oSpells];
    let tempChain = [...chain];
    while (tempChain.length > 0) {
      const action = tempChain.pop(); const { card, targetId } = action;
      newPS = newPS.filter(s => s.instanceId !== card.instanceId);
      newOS = newOS.filter(s => s.instanceId !== card.instanceId);
      let target = newPM.find(m => m.instanceId === targetId) || newOM.find(m => m.instanceId === targetId);
      if (target && action.effect === 'DIFF') {
        const next = derivative(target.formula, 'x').toString();
        const res = checkDestruction(next, activeField);
        if (res.destroyed) { newPM = newPM.filter(m => m.instanceId !== targetId); newOM = newOM.filter(m => m.instanceId !== targetId); }
        else target.formula = res.formula;
      }
    }
    setTimeout(() => { setPMonsters(newPM); setOMonsters(newOM); setPSpells(newPS); setOSpells(newOS); setChain([]); setPriorityPlayer(turn); setConsecutivePasses(0); }, 800);
  }, [chain, pMonsters, oMonsters, pSpells, oSpells, activeField, turn, showNotification]);

  const canAct = useCallback((pIdx) => {
    if (winner || phase === 'SETUP' || phase === 'DISCARD' || selectedAction) return true;
    const isMe = pIdx === myPlayerNumber;
    const hand = isMe ? pHand : oHand;
    const spells = isMe ? pSpells : oSpells;
    if (pIdx === turn && chain.length === 0) return hand.some(c => c.type === 'monster' ? pMonsters.length < 3 : spells.length < 3);
    if (spells.some(s => s.isSet && s.setAtTurn < totalTurns)) return true;
    return false;
  }, [winner, phase, selectedAction, myPlayerNumber, pHand, oHand, pSpells, oSpells, turn, chain, pMonsters.length, totalTurns]);

  useEffect(() => {
    if (winner || phase === 'SETUP' || phase === 'START' || view !== 'GAME') return;
    if (consecutivePasses >= 2 && chain.length > 0) resolveChain();
    else if (priorityPlayer === myPlayerNumber && !canAct(myPlayerNumber)) handlePass();
  }, [priorityPlayer, consecutivePasses, chain.length, phase, canAct, view, winner, myPlayerNumber, handlePass, resolveChain]);

  // --- 소켓 연동 ---
  useEffect(() => {
    socket.on('connect', () => setIsConnected(true));
    socket.on('ROOM_CREATED', ({ roomCode, playerNumber }) => { setRoomCode(roomCode); setMyPlayerNumber(playerNumber); setView('LOBBY'); });
    socket.on('ROOM_JOINED', ({ roomCode, playerNumber }) => { setRoomCode(roomCode); setMyPlayerNumber(playerNumber); setView('LOBBY'); });
    socket.on('MATCH_FOUND', () => showNotification("MATCH FOUND!"));
    socket.on('OPPONENT_READY', () => setIsOReady(true));
    socket.on('GAME_START_SIGNAL', ({ decks: allDecks, firstTurn, playerIds }) => {
      const myId = socket.id; const opId = playerIds.find(id => id !== myId);
      // 호스트가 섞은 덱을 그대로 수신
      const myD = allDecks[myId]; const opD = allDecks[opId];
      setPDeck(myD.slice(6)); setODeck(opD.slice(6));
      setPHand(myD.slice(0, 6)); setOHand(opD.slice(0, 6));
      setPhase('SETUP'); setView('GAME'); setTurn(firstTurn); setPriorityPlayer(firstTurn);
      showNotification(firstTurn === myPlayerNumber ? "YOU ARE FIRST" : "YOU ARE SECOND");
    });
    socket.on('OPPONENT_ACTION', ({ actionType, data }) => {
      switch (actionType) {
        case 'SETUP_MONSTER': setOMonsters(p => [...p, {...data.card, isFacedown: true}]); setOHand(p => p.slice(0, -1)); break;
        case 'READY_SIGNAL': setIsOReady(true); break;
        case 'START_DUEL_SYNC': setPMonsters(data.pMonsters); setOMonsters(data.oMonsters); setPhase('MAIN'); setTotalTurns(1); showNotification("DUEL START!"); break;
        case 'PASS': handlePass(); break;
        case 'END_TURN_SYNC': setTurn(data.nextTurn); setTotalTurns(data.totalTurns); setPriorityPlayer(data.nextTurn); break;
        case 'PLAY_MONSTER': setOMonsters(p => [...p, data.card]); setOHand(p => p.slice(0, -1)); break;
        case 'ADD_TO_CHAIN': setChain(p => [...p, {...data.card, isPlayer: false}]); setPriorityPlayer(myPlayerNumber); break;
        default: break;
      }
    });
    return () => { socket.off('ROOM_CREATED'); socket.off('ROOM_JOINED'); socket.off('GAME_START_SIGNAL'); socket.off('OPPONENT_ACTION'); };
  }, [myPlayerNumber, roomCode, showNotification, handlePass, setupGame]);

  const handleHandClick = (card, idx, isPlayer) => {
    if (!isPlayer || winner || (priorityPlayer !== myPlayerNumber && phase !== 'SETUP') || selectedAction) return;
    if (phase === 'SETUP') {
      if (card.type !== 'monster') return;
      const newM = { ...card, instanceId: Math.random(), isFacedown: true };
      setPMonsters([...pMonsters, newM]); setPHand(pHand.filter((_, i) => i !== idx));
      emit('SETUP_MONSTER', { card: newM }); return;
    }
    if (card.type === 'monster' && pMonsters.length < 3 && !summonedThisTurn) {
      const newM = { ...card, instanceId: Math.random(), isFacedown: false };
      setPMonsters([...pMonsters, newM]); setPHand(pHand.filter((_, i) => i !== idx));
      setSummonedThisTurn(true); emit('PLAY_MONSTER', { card: newM });
    }
  };

  const handleReady = () => {
    if (pMonsters.length < 1) return alert("세트할 몬스터가 필요합니다.");
    setIsPReady(true); emit('READY_SIGNAL', {});
  };

  useEffect(() => {
    if (phase === 'SETUP' && isPReady && isOReady && myPlayerNumber === 0) {
       const flippedPM = pMonsters.map(m => ({ ...m, isFacedown: false }));
       const flippedOM = oMonsters.map(m => ({ ...m, isFacedown: false }));
       emit('START_DUEL_SYNC', { oMonsters: flippedPM, pMonsters: flippedOM });
       setPMonsters(flippedPM); setOMonsters(flippedOM); setPhase('MAIN'); showNotification("DUEL START!");
    }
  }, [isPReady, isOReady, myPlayerNumber, pMonsters, oMonsters, phase, emit, showNotification]);

  // --- 뷰 렌더링 ---
  if (view === 'MENU') return (
    <div className="menu-screen">
      <h1 className="game-title">NABLA MASTERS</h1>
      <div className="menu-main vertical">
        <button className="menu-btn large" onClick={() => setView('DUEL_MENU')}>DUEL</button>
        <button className="menu-btn large" onClick={() => setView('DECK_LIST')}>DECK</button>
      </div>
    </div>
  );

  if (view === 'DECK_LIST') return (
    <div className="menu-screen deck-list-view">
      <h1 className="game-title small">MY DECKS</h1>
      <div className="deck-grid">
        {decks.map(d => (
          <div key={d.id} className="deck-slot" onClick={() => { setEditingDeck(d); setView('DECK_EDITOR'); }}>
            <div className="deck-slot-name">{d.name}</div>
            <div className="deck-slot-count">{d.cards.length} Cards</div>
          </div>
        ))}
        <div className="deck-slot add-new" onClick={() => setDecks([...decks, {id: Date.now().toString(), name: 'New Deck', cards: []}])}><span>+ NEW DECK</span></div>
      </div>
      <button className="menu-btn" onClick={() => setView('MENU')}>BACK</button>
    </div>
  );

  if (view === 'DECK_EDITOR') return (
    <div className="deck-editor" onContextMenu={(e)=>e.preventDefault()}>
      <div className="editor-header">
        <h2>{editingDeck.name} ({editingDeck.cards.length}/60)</h2>
        <div className="header-btns">
          <button className="menu-btn primary" onClick={() => { setDecks(decks.map(d => d.id === editingDeck.id ? editingDeck : d)); setView('DECK_LIST'); }}>SAVE</button>
          <button className="menu-btn" onClick={() => setView('DECK_LIST')}>BACK</button>
        </div>
      </div>
      <div className="editor-body">
        <div className="deck-view"><h3>MY DECK</h3><div className="editor-grid">{editingDeck.cards.map((c, i) => (<div key={c.instanceId || i} onContextMenu={(e) => { e.preventDefault(); setEditingDeck({...editingDeck, cards: editingDeck.cards.filter(card => card.instanceId !== c.instanceId)}); }}><CardUI card={c} isPlayerSide={true} /></div>))}</div></div>
        <div className="library-view"><h3>LIBRARY</h3><div className="editor-grid">{ALL_CARDS_LIB.map((c, i) => (<div key={c.id || i} onContextMenu={(e) => { e.preventDefault(); if (editingDeck.cards.length >= 60) return; setEditingDeck({...editingDeck, cards: sortCards([...editingDeck.cards, {...c, instanceId: Math.random()}])}); }}><CardUI card={c} isPlayerSide={true} /></div>))}</div></div>
      </div>
    </div>
  );

  if (view === 'LOBBY') return (
    <div className="menu-screen lobby">
      <div className="room-info-header"><p>ROOM CODE</p><h2 className="code-display">{roomCode}</h2></div>
      <div className="deck-selector">{decks.map(d => (<div key={d.id} className={`deck-item ${selectedDeckId === d.id ? 'selected' : ''}`} onClick={() => setSelectedDeckId(d.id)}>{d.name} ({d.cards.length})</div>))}</div>
      <div className="lobby-btns"><button className={`menu-btn large ${isPReady ? 'ready' : ''}`} onClick={() => {
        const d = decks.find(d => d.id === selectedDeckId); if (!d || d.cards.length < 40) return alert("40장 필수");
        setIsPReady(true); socket.emit('READY_TO_START', { roomCode, deck: shuffleDeck(d.cards) });
      }}>{isPReady ? 'READY √' : 'READY TO DUEL'}</button></div>
    </div>
  );

  if (view === 'DUEL_MENU') return (
    <div className="menu-screen"><h1 className="game-title small">DUEL MODE</h1><div className="menu-main vertical"><button className="menu-btn large" onClick={() => setView('ROOM_LOBBY')}>MULTI PLAY</button><button className="menu-btn large" onClick={() => setView('MENU')}>BACK</button></div></div>
  );

  if (view === 'ROOM_LOBBY') return (
    <div className="menu-screen"><div className="menu-main vertical">
      {!showJoinInput ? (<><button className="menu-btn large" onClick={() => socket.emit('CREATE_ROOM')}>CREATE ROOM</button><button className="menu-btn large" onClick={() => setShowJoinInput(true)}>JOIN ROOM</button><button className="menu-btn large" onClick={() => setView('DUEL_MENU')}>BACK</button></>) : 
      (<div className="join-input-container"><input className="room-code-input" type="text" placeholder="CODE" value={inputCode} onChange={(e)=>setInputCode(e.target.value.toUpperCase())} /><div className="join-btns"><button className="menu-btn primary" onClick={() => socket.emit('JOIN_ROOM', inputCode)}>JOIN</button><button className="menu-btn" onClick={() => setShowJoinInput(false)}>CANCEL</button></div></div>)}
    </div></div>
  );

  return (
    <div className="game-container" onContextMenu={cancelTargeting}>
      {notification && <div className="phase-notification">{notification}</div>}
      {/* 상대 정보 및 덱 매수 */}
      <div className="hand-container top">
        <div className="deck-info opponent-deck">DECK: {oDeck.length}</div>
        {oHand.map((c, i) => <div key={`oh-${i}`} className="card back small" />)}
      </div>

      <div className="main-arena">
        <div className="duel-board">
          <div className="zone spell-zone opponent-side">{[0,1,2].map(i => (<div key={`os-${i}`} className="slot">{oSpells[i] && <div className="card back" />}</div>))}</div>
          <div className="zone monster-zone opponent-side">{[0,1,2].map(i => (<div key={`om-${i}`} className="slot" onClick={() => selectedAction && handleTargetClick(oMonsters[i]?.instanceId)}>{oMonsters[i] && <CardUI card={oMonsters[i]} isFacedown={oMonsters[i].isFacedown} />}</div>))}</div>
          <div className="center-divider">
            <div className="field-anchor"><div className="slot field-slot">{activeField ? <CardUI card={activeField} /> : 'FIELD'}</div></div>
            <div className={`turn-priority-tab ${turn === myPlayerNumber ? "player-turn" : "opponent-turn"}`}>
              <div className="turn-info">TURN {totalTurns}</div>
              {phase === 'SETUP' ? <button className={`setup-btn ${isPReady ? "ready-active" : ""}`} onClick={handleReady}>{isPReady ? "READY √" : "READY"}</button> : 
              <button className="pass-btn" onClick={handlePass} disabled={priorityPlayer !== myPlayerNumber}>PASS</button>}
            </div>
          </div>
          <div className="zone monster-zone player-side">{[0,1,2].map(i => (<div key={`pm-${i}`} className="slot" onClick={() => selectedAction && handleTargetClick(pMonsters[i]?.instanceId)}>{pMonsters[i] && <CardUI card={pMonsters[i]} isPlayerSide={true} isFacedown={pMonsters[i].isFacedown} />}</div>))}</div>
          <div className="zone spell-zone player-side">{[0,1,2].map(i => <div key={`ps-${i}`} className="slot" onClick={() => pSpells[i] && (pSpells[i].setAtTurn < totalTurns ? addToChain(pSpells[i], null, true) : null)}>{pSpells[i] && <CardUI card={pSpells[i]} isPlayerSide={true} />}</div>)}</div>
        </div>
      </div>

      {/* 플레이어 정보 및 덱 매수 */}
      <div className="hand-container bottom">
        <div className="deck-info player-deck">DECK: {pDeck.length}</div>
        {pHand.map((c, i) => <CardUI key={`ph-${i}`} card={c} isPlayerSide={true} isPlayable={isCardPlayable(c, true)} onClick={() => handleHandClick(c, i, true)} isHand={true} />)}
      </div>
    </div>
  );
}