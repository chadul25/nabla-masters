import React, { useState, useEffect, useCallback } from 'react';
import 'katex/dist/katex.min.css';
import { InlineMath } from 'react-katex';
import { derivative, simplify, evaluate, parse } from 'mathjs';
import './App.css';

// 분리된 모듈 가져오기
import { MONSTERS, SPELLS, TRAPS, FIELDS } from './cards';
import { Engine } from './engine';
import { socket } from './socket';

const CARD_LIBRARY = [...MONSTERS, ...SPELLS, ...TRAPS, ...FIELDS];

// --- [UI 컴포넌트 1] 카드 ---
function UI_Card({ card, isFacedown, isPlayerSide, isPlayable, isHover, isDoomed, onClick, onContextMenu }) {
  if (!card) return null;
  const isMonster = card.type === 'monster';
  const math = isMonster ? Engine.formatToTex(card.formula) : card.display;
  return (
    <div className={`card ${card.type} ${isFacedown?'back':''} ${isPlayerSide&&card.isSet?'facedown':''} ${isPlayable?'playable':''} ${isDoomed?'doomed':''} ${isHover?'projection-hover':''}`}
      onClick={onClick} onContextMenu={onContextMenu}>
      {!isFacedown && (
        <><span className="card-name">{card.name}</span>
          <div className="card-formula"><div><InlineMath math={math} /></div></div>
          <span className="card-type-label">{card.type.toUpperCase()}</span></>
      )}
    </div>
  );
}

// --- [UI 컴포넌트 2] 덱 편집기 ---
function UI_DeckEditor({ deck, onSave, onBack }) {
  const [currentCards, setCurrentCards] = useState(deck.cards || []);
  const handleAdd = (e, card) => {
    e.preventDefault();
    const count = currentCards.filter(c => c.id === card.id).length;
    if (currentCards.length < 60 && count < 4) {
      setCurrentCards(Engine.sortDeck([...currentCards, { ...card, instanceId: Math.random() }]));
    }
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
        <div className="deck-view"><h3>MY DECK</h3><div className="editor-grid">{currentCards.map((c, i) => (<div key={c.instanceId || i} className="editor-card-wrapper" onContextMenu={(e) => handleRemove(e, c.instanceId)}><UI_Card card={c} isPlayerSide /></div>))}</div></div>
        <div className="library-view"><h3>LIBRARY</h3><div className="editor-grid">{CARD_LIBRARY.map((c, i) => (<div key={c.id || i} className="editor-card-wrapper" onContextMenu={(e) => handleAdd(e, c)}><UI_Card card={c} isPlayerSide /></div>))}</div></div>
      </div>
    </div>
  );
}

// --- [MAIN APP] ---
export default function App() {
  const [view, setView] = useState('MENU');
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [roomCode, setRoomCode] = useState("");
  const [inputCode, setInputCode] = useState("");
  const [showJoinInput, setShowJoinInput] = useState(false);
  const [myPlayerNumber, setMyPlayerNumber] = useState(null);
  
  // 게임 데이터 상태 (game_)
  const [game_phase, setGame_phase] = useState('START');
  const [game_turn, setGame_turn] = useState(0);
  const [game_totalTurns, setGame_totalTurns] = useState(1);
  const [game_priority, setGame_priority] = useState(0);
  const [game_chain, setGame_chain] = useState([]);
  const [game_winner, setGame_winner] = useState(null);
  const [game_notif, setGame_notif] = useState("");
  const [game_passes, setGame_passes] = useState(0);
  const [game_selectedAction, setGame_selectedAction] = useState(null);

  const [savedDecks, setSavedDecks] = useState(JSON.parse(localStorage.getItem('nabla_decks')) || [{id:'d1', name:'Starter', cards:[]}]);
  const [selectedDeckId, setSelectedDeckId] = useState('d1');
  const [pMonsters, setPMonsters] = useState([]); const [pSpells, setPSpells] = useState([]); const [pHand, setPHand] = useState([]); const [pDeck, setPDeck] = useState([]);
  const [oMonsters, setOMonsters] = useState([]); const [oSpells, setOSpells] = useState([]); const [oHand, setOHand] = useState([]); const [oDeck, setODeck] = useState([]);
  const [activeField, setActiveField] = useState(null);
  const [isLobbyReady, setIsLobbyReady] = useState(false);
  const [isOpponentReady, setIsOpponentReady] = useState(false);

  // --- [LOGIC] 핵심 함수 (Callbacks) ---
  const triggerNotif = useCallback((msg) => { setGame_notif(msg); setTimeout(()=>setGame_notif(""), 1500); }, []);
  const netEmit = useCallback((type, data) => socket.emit('GAME_ACTION', { roomCode, actionType: type, data }), [roomCode]);

  const game_draw = useCallback((pIdx, count) => {
    const isMe = pIdx === myPlayerNumber;
    const targetDeck = isMe ? pDeck : oDeck;
    if (targetDeck.length < count) { setGame_winner(isMe ? 'OPPONENT' : 'PLAYER'); return; }
    const newCards = targetDeck.slice(0, count);
    if (isMe) { setPHand(v => [...v, ...newCards]); setPDeck(v => v.slice(count)); }
    else { setOHand(v => [...v, ...newCards]); setODeck(v => v.slice(count)); }
  }, [pDeck, oDeck, myPlayerNumber]);

  const handleEndTurn = useCallback(() => {
    const next = game_turn === 0 ? 1 : 0;
    setGame_turn(next); setGame_totalTurns(t => t + 1); setGame_priority(next); setGame_passes(0);
    triggerNotif("NEXT TURN");
    if (myPlayerNumber === game_turn) netEmit('END_TURN_SYNC', { next, total: game_totalTurns + 1 });
    setTimeout(() => game_draw(next, 2), 500);
  }, [game_turn, myPlayerNumber, game_totalTurns, netEmit, game_draw, triggerNotif]);

  const handlePass = useCallback(() => {
    if (game_chain.length === 0 && game_turn === myPlayerNumber && game_priority === myPlayerNumber) {
      handleEndTurn(); return;
    }
    setGame_priority(game_priority === 0 ? 1 : 0); setGame_passes(p => p + 1);
    if (game_priority === myPlayerNumber) netEmit('PASS', {});
  }, [game_chain.length, game_turn, myPlayerNumber, game_priority, handleEndTurn, netEmit]);

  const resolveChain = useCallback(() => {
    triggerNotif("RESOLVING...");
    let newPM = [...pMonsters], newOM = [...oMonsters], newPS = [...pSpells], newOS = [...oSpells];
    let tempChain = [...game_chain];
    while (tempChain.length > 0) {
      const act = tempChain.pop();
      newPS = newPS.filter(s => s.instanceId !== act.instanceId); newOS = newOS.filter(s => s.instanceId !== act.instanceId);
      let target = newPM.find(m => m.instanceId === act.targetId) || newOM.find(m => m.instanceId === act.targetId);
      if (target && act.effect === 'DIFF') {
        const next = Engine.checkDestruction(derivative(target.formula, 'x').toString(), activeField);
        if (next.destroyed) { newPM = newPM.filter(m => m.instanceId !== act.targetId); newOM = newOM.filter(m => m.instanceId !== act.targetId); }
        else target.formula = next.formula;
      }
    }
    setTimeout(() => { setPMonsters(newPM); setOMonsters(newOM); setPSpells(newPS); setOSpells(newOS); setGame_chain([]); setGame_priority(game_turn); setGame_passes(0); }, 800);
  }, [game_chain, pMonsters, oMonsters, pSpells, oSpells, activeField, game_turn, triggerNotif]);

  // --- [EFFECTS] 소켓 및 자동화 ---
  useEffect(() => {
    socket.on('connect', () => setIsConnected(true));
    socket.on('ROOM_CREATED', ({ roomCode, playerNumber }) => { setRoomCode(roomCode); setMyPlayerNumber(playerNumber); setView('LOBBY'); });
    socket.on('ROOM_JOINED', ({ roomCode, playerNumber }) => { setRoomCode(roomCode); setMyPlayerNumber(playerNumber); setView('LOBBY'); });
    socket.on('GAME_START_SIGNAL', ({ decks, firstTurn, playerIds }) => {
      const myId = socket.id; const opId = playerIds.find(id => id !== myId);
      setPDeck(decks[myId].slice(6)); setODeck(decks[opId].slice(6));
      setPHand(decks[myId].slice(0, 6)); setOHand(decks[opId].slice(0, 6));
      setGame_phase('SETUP'); setView('GAME'); setGame_turn(firstTurn); setGame_priority(firstTurn);
    });
    socket.on('OPPONENT_ACTION', ({ actionType, data }) => {
      if (actionType === 'PASS') handlePass();
      if (actionType === 'END_TURN_SYNC') { setGame_turn(data.next); setGame_totalTurns(data.total); setGame_priority(data.next); }
      if (actionType === 'SETUP_MONSTER') { setOMonsters(p => [...p, {...data.card, isFacedown:true}]); setOHand(p => p.slice(0, -1)); }
    });
    return () => { socket.off('ROOM_CREATED'); socket.off('ROOM_JOINED'); socket.off('OPPONENT_ACTION'); };
  }, [myPlayerNumber, roomCode, handlePass, triggerNotif]);

  useEffect(() => {
    if (view !== 'GAME' || game_phase === 'SETUP' || game_winner) return;
    if (game_passes >= 2 && game_chain.length > 0) resolveChain();
    else if (game_priority === myPlayerNumber && !game_selectedAction && !pHand.some(c => c.type === 'monster')) handlePass();
  }, [game_priority, game_passes, game_chain.length, game_phase, view, handlePass, resolveChain, game_winner]);

  // --- [RENDER] ---
  if (view === 'MENU') return (
    <div className="menu-screen">
      <h1 className="game-title">NABLA MASTERS</h1>
      <div className="menu-main vertical">
        <button className="menu-btn large" onClick={() => setView('DUEL_MENU')}>DUEL</button>
        <button className="menu-btn large" onClick={() => setView('DECK_LIST')}>DECK</button>
      </div>
      <div className={`connection-status ${isConnected?'on':'off'}`}>Server: {isConnected?'ON':'OFF'}</div>
    </div>
  );

  if (view === 'DECK_LIST') return (
    <div className="menu-screen deck-list-view">
      <h1 className="game-title small">MY DECKS</h1>
      <div className="deck-grid">
        {savedDecks.map(d => (
          <div key={d.id} className="deck-slot" onClick={() => { setEditingDeck(d); setView('DECK_EDITOR'); }}>
            <div className="deck-slot-name">{d.name}</div><div className="deck-slot-count">{d.cards.length} Cards</div>
          </div>
        ))}
        <div className="deck-slot add-new" onClick={() => setSavedDecks([...savedDecks, {id: Date.now().toString(), name:'New', cards:[]}])}>+ NEW</div>
      </div>
      <button className="menu-btn" onClick={() => setView('MENU')}>BACK</button>
    </div>
  );

  if (view === 'DECK_EDITOR') return <UI_DeckEditor deck={editingDeck} onBack={()=>setView('DECK_LIST')} onSave={(c)=>{
    const updated = savedDecks.map(d => d.id === editingDeck.id ? {...editingDeck, cards: c} : d);
    setSavedDecks(updated); localStorage.setItem('nabla_decks', JSON.stringify(updated)); setView('DECK_LIST');
  }}/>;

  if (view === 'DUEL_MENU') return (
    <div className="menu-screen">
      <h1 className="game-title small">DUEL MODE</h1>
      <div className="menu-main vertical">
        <button className="menu-btn large" onClick={() => { setShowJoinInput(false); setView('ROOM_LOBBY'); }}>MULTI</button>
        <button className="menu-btn large" onClick={() => setView('MENU')}>BACK</button>
      </div>
    </div>
  );

  if (view === 'ROOM_LOBBY') return (
    <div className="menu-screen">
      <div className="menu-main vertical">
        {!showJoinInput ? (<><button className="menu-btn large" onClick={() => socket.emit('CREATE_ROOM')}>CREATE</button><button className="menu-btn large" onClick={() => setShowJoinInput(true)}>JOIN</button><button className="menu-btn large" onClick={() => setView('DUEL_MENU')}>BACK</button></>) : 
        (<div className="join-input-container"><input className="room-code-input" value={inputCode} onChange={(e)=>setInputCode(e.target.value.toUpperCase())} /><div className="join-btns"><button className="menu-btn primary" onClick={() => socket.emit('JOIN_ROOM', inputCode)}>JOIN</button><button className="menu-btn" onClick={() => setShowJoinInput(false)}>CANCEL</button></div></div>)}
      </div>
    </div>
  );

  if (view === 'LOBBY') return (
    <div className="menu-screen lobby">
      <div className="room-info-header"><p>CODE: <span className="code-display">{roomCode}</span></p></div>
      <div className="deck-selector">{savedDecks.map(d => (<div key={d.id} className={`deck-item ${selectedDeckId === d.id ? 'selected' : ''}`} onClick={() => setSelectedDeckId(d.id)}>{d.name}</div>))}</div>
      <button className="menu-btn large" onClick={() => { const d = savedDecks.find(x=>x.id===selectedDeckId); socket.emit('READY_TO_START', {roomCode, deck: Engine.shuffle(d.cards)}); setIsLobbyReady(true); }}>READY</button>
    </div>
  );

  return (
    <div className="game-container">
      {game_notif && <div className="phase-notification">{game_notif}</div>}
      <div className="hand-container top">{oHand.map((c, i) => <div key={i} className="card back small" />)}</div>
      <div className="main-arena">
        <div className="duel-board">
          <div className="zone spell-zone opponent-side">{[0,1,2].map(i => <div key={i} className="slot">{oSpells[i] && <div className="card back" />}</div>)}</div>
          <div className="zone monster-zone opponent-side">{[0,1,2].map(i => <div key={i} className="slot">{oMonsters[i] && <UI_Card card={oMonsters[i]} isFacedown={oMonsters[i].isFacedown} />}</div>)}</div>
          <div className="center-divider">
            <div className="field-anchor"><div className="slot field-slot">{activeField ? <UI_Card card={activeField} /> : 'FIELD'}</div></div>
            <div className={`turn-priority-tab ${game_turn===myPlayerNumber?'player-turn':'opponent-turn'}`}>
               <div className="turn-info">TURN {game_totalTurns}</div>
               <button className="pass-btn" onClick={handlePass} disabled={game_priority!==myPlayerNumber}>PASS</button>
            </div>
          </div>
          <div className="zone monster-zone player-side">{[0,1,2].map(i => <div key={i} className="slot">{pMonsters[i] && <UI_Card card={pMonsters[i]} isPlayerSide isFacedown={pMonsters[i].isFacedown} />}</div>)}</div>
          <div className="zone spell-zone player-side">{[0,1,2].map(i => <div key={i} className="slot">{pSpells[i] && <UI_Card card={pSpells[i]} isPlayerSide />}</div>)}</div>
        </div>
      </div>
      <div className="hand-container bottom">{pHand.map((c, i) => <UI_Card key={i} card={c} isPlayerSide isHand isPlayable={isCardPlayable(c, true)} />)}</div>
    </div>
  );
}