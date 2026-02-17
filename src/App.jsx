import React, { useState, useEffect, useCallback } from 'react';
import { derivative, simplify, evaluate, parse } from 'mathjs';
import 'katex/dist/katex.min.css';
import { InlineMath } from 'react-katex';
import { io } from 'socket.io-client';
import './App.css';
import { MONSTERS, SPELLS, TRAPS, FIELDS } from './cards';

// ★ 중요: Vercel 배포 버전에서는 localhost가 아닌 ngrok 주소를 사용해야 합니다 ★
const socket = io('https://renate-nonmultiplicative-edgardo.ngrok-free.dev');
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

const sortCards = (cards) => {
  const priority = { monster: 0, spell: 1, trap: 2, field: 3 };
  return [...cards].sort((a, b) => priority[a.type] - priority[b.type] || a.id.localeCompare(b.id));
};

// --- [컴포넌트] 덱 편집기 ---
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
          <div className="mini-grid">{currentCards.map((c, i) => (
            <div key={c.instanceId || `deck-item-${i}`} className={`mini-card ${c.type}`} onContextMenu={(e)=>handleRemove(e, c.instanceId)}>
              <span className="mini-card-name">{c.name}</span>
              <div className="mini-formula"><InlineMath math={c.display || c.formula} /></div>
            </div>
          ))}</div>
        </div>
        <div className="library-view">
          <h3>LIBRARY (Right-Click to Add)</h3>
          <div className="mini-grid">{ALL_CARDS_LIB.map((c, i) => (
            <div key={c.id || `lib-item-${i}`} className={`mini-card ${c.type}`} onContextMenu={(e)=>handleAdd(e, c)}>
              <span className="mini-card-name">{c.name}</span>
              <div className="mini-formula"><InlineMath math={c.display || c.formula} /></div>
            </div>
          ))}</div>
        </div>
      </div>
    </div>
  );
}

// --- 메인 앱 ---
export default function App() {
  const [view, setView] = useState('MENU'); 
  const [decks, setDecks] = useState(JSON.parse(localStorage.getItem('nabla_decks')) || [{id: 'd1', name: 'Starter Deck', cards: []}]);
  const [editingDeck, setEditingDeck] = useState(null);
  const [selectedDeckId, setSelectedDeckId] = useState(decks[0]?.id);

  const [roomCode, setRoomCode] = useState("");
  const [inputCode, setInputCode] = useState("");
  const [showJoinInput, setShowJoinInput] = useState(false); // 조인 입력창 노출 여부
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
    return () => { socket.off('ROOM_CREATED'); socket.off('ROOM_JOINED'); socket.off('GAME_START_SIGNAL'); };
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
    setPMonsters(newPM); setOMonsters(newOM); setPSpells(newPS); setOSpells(newOS);
    setChain([]); setPriorityPlayer(turn);
  }, [chain, pMonsters, oMonsters, pSpells, oSpells, activeField, turn]);

  useEffect(() => {
    if (view !== 'GAME' || phase === 'SETUP') return;
    if (consecutivePasses >= 2 && chain.length > 0) resolveChain();
  }, [consecutivePasses, chain, view, phase, resolveChain]);

  // --- 뷰 렌더링 함수 ---
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
      <h1 className="game-title small">SELECT MODE</h1>
      <div className="menu-main vertical">
        <button className="menu-btn large" onClick={() => setView('ROOM_LOBBY')}>MULTI PLAY</button>
        <button className="menu-btn large secondary" disabled>SOLO PLAY (Coming Soon)</button>
        <button className="menu-btn large" onClick={() => setView('MENU')}>BACK</button>
      </div>
    </div>
  );

  if (view === 'ROOM_LOBBY') return (
    <div className="menu-screen">
      <h1 className="game-title small">MULTI PLAY</h1>
      <div className="menu-main vertical">
        {!showJoinInput ? (
          <>
            <button className="menu-btn large" onClick={() => socket.emit('CREATE_ROOM')}>CREATE ROOM</button>
            <button className="menu-btn large" onClick={() => setShowJoinInput(true)}>JOIN ROOM</button>
            <button className="menu-btn large" onClick={() => setView('DUEL_MENU')}>BACK</button>
          </>
        ) : (
          <div className="join-input-container">
            <input 
              className="room-code-input"
              type="text" 
              placeholder="ENTER ROOM CODE" 
              value={inputCode} 
              onChange={(e)=>setInputCode(e.target.value.toUpperCase())} 
            />
            <div className="join-btns">
              <button className="menu-btn primary" onClick={() => socket.emit('JOIN_ROOM', inputCode)}>JOIN</button>
              <button className="menu-btn" onClick={() => setShowJoinInput(false)}>CANCEL</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  if (view === 'LOBBY') return (
    <div className="menu-screen lobby">
      <div className="room-info-header">
        <p>ROOM CODE</p>
        <h2 className="code-display">{roomCode}</h2>
      </div>
      <h2>SELECT DECK</h2>
      <div className="deck-selector">
        {decks.map(d => (
          <div key={d.id} className={`deck-item ${selectedDeckId === d.id ? 'selected' : ''}`} onClick={() => setSelectedDeckId(d.id)}>
            {d.name} ({d.cards.length} cards)
          </div>
        ))}
      </div>
      <div className="lobby-btns">
        <button className={`menu-btn ${isPReady ? 'ready' : ''}`} onClick={() => {
          const d = decks.find(d => d.id === selectedDeckId);
          if (d.cards.length < 40) return alert("덱은 최소 40장이어야 합니다.");
          setIsPReady(true);
          socket.emit('READY_TO_START', { roomCode, deck: d.cards });
        }}>{isPReady ? 'READY √' : 'READY TO DUEL'}</button>
        <button className="menu-btn" onClick={() => window.location.reload()}>LEAVE</button>
      </div>
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