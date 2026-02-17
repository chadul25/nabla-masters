import React, { useState, useEffect, useCallback } from 'react';
import { derivative, simplify, evaluate, parse } from 'mathjs';
import 'katex/dist/katex.min.css';
import { InlineMath } from 'react-katex';
import { io } from 'socket.io-client';
import './App.css';
import { MONSTERS, SPELLS, TRAPS, FIELDS } from './cards';

// =============================================================================
// [SECTION 1] 전역 설정 및 유틸리티
// =============================================================================
const isLocal = window.location.hostname === 'localhost';
const SERVER_URL = isLocal ? 'http://localhost:3001' : 'https://renate-nonmultiplicative-edgardo.ngrok-free.dev';
const socket = io(SERVER_URL, { transports: ['websocket'] });
const CARD_LIBRARY = [...MONSTERS, ...SPELLS, ...TRAPS, ...FIELDS];

const Engine = {
  formatToTex: (formula) => {
    try { return parse(simplify(formula).toString()).toTex(); } catch (e) { return formula; }
  },
  checkDestruction: (formula, activeField) => {
    try {
      const s = simplify(formula).toString();
      if (s === '0') return { destroyed: true, reason: 'ZERO' };
      if (formula.includes('Infinity') || formula.includes('NaN')) return { destroyed: true, reason: 'UNDEFINED' };
      if (activeField?.effect === 'RATIONAL_Q' && (s.includes('e') || s.includes('pi'))) return { destroyed: true, reason: 'NOT_RATIONAL' };
      return { destroyed: false, formula: s };
    } catch (e) { return { destroyed: true, reason: 'UNDEFINED' }; }
  },
  sortDeck: (cards) => {
    const priority = { monster: 0, spell: 1, trap: 2, field: 3 };
    return [...cards].sort((a, b) => priority[a.type] - priority[b.type] || a.id.localeCompare(b.id));
  },
  shuffle: (array) => {
    const newArr = [...array];
    for (let i = newArr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
    }
    return newArr;
  }
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

// =============================================================================
// [SECTION 2] 서브 UI 컴포넌트
// =============================================================================

function CardUI({ card, isFacedown, isPlayerSide, isPlayable, isHover, isDoomed, onClick, onContextMenu }) {
  if (!card) return null;
  const isMonster = card.type === 'monster';
  const mathContent = isMonster ? Engine.formatToTex(card.formula) : card.display;
  return (
    <div 
      className={`card ${card.type} ${isFacedown ? 'back' : (isPlayerSide && card.isSet ? 'facedown peekable' : '')} ${isPlayable ? 'playable' : ''} ${isDoomed ? 'doomed' : ''}`}
      onClick={onClick} onContextMenu={onContextMenu}
    >
      {!isFacedown && (
        <><span className="card-name">{card.name}</span>
          <div className="card-formula"><div><InlineMath math={mathContent} /></div></div>
          <span className="card-type-label">{card.type.toUpperCase()}</span></>
      )}
    </div>
  );
}

function DeckEditor({ deck, onSave, onBack }) {
  const [currentCards, setCurrentCards] = useState(deck.cards || []);
  const handleAdd = (e, card) => {
    e.preventDefault();
    if (currentCards.length >= 60 || currentCards.filter(c => c.id === card.id).length >= 4) return;
    setCurrentCards(Engine.sortDeck([...currentCards, { ...card, instanceId: Math.random() }]));
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
        <div className="deck-view"><h3 className="section-title">MY DECK</h3><div className="editor-grid">{currentCards.map((c, i) => (<div key={c.instanceId || i} className="editor-card-wrapper" onContextMenu={(e) => handleRemove(e, c.instanceId)}><CardUI card={c} isPlayerSide={true} /></div>))}</div></div>
        <div className="library-view"><h3 className="section-title">LIBRARY</h3><div className="editor-grid">{CARD_LIBRARY.map((c, i) => (<div key={c.id || i} className="editor-card-wrapper" onContextMenu={(e) => handleAdd(e, c)}><CardUI card={c} isPlayerSide={true} /></div>))}</div></div>
      </div>
    </div>
  );
}

// =============================================================================
// [SECTION 3] 메인 앱
// =============================================================================

export default function App() {
  // --- [State] ---
  const [currentView, setCurrentView] = useState('MENU'); 
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [roomCode, setRoomCode] = useState("");
  const [inputCode, setInputCode] = useState("");
  const [showJoinInput, setShowJoinInput] = useState(false); // 문제의 상태값
  const [myPlayerNumber, setMyPlayerNumber] = useState(null);
  const [playerCount, setPlayerCount] = useState(0);

  const [savedDecks, setSavedDecks] = useState(JSON.parse(localStorage.getItem('nabla_decks')) || [{id: 'd1', name: 'Starter Deck', cards: []}]);
  const [editingDeck, setEditingDeck] = useState(null);
  const [selectedDeckId, setSelectedDeckId] = useState(savedDecks[0]?.id);

  const [gamePhase, setGamePhase] = useState('START'); 
  const [gameTurnOwner, setGameTurnOwner] = useState(0); 
  const [gameTotalTurns, setGameTotalTurns] = useState(1);
  const [gameWinner, setGameWinner] = useState(null);
  const [gameNotification, setGameNotification] = useState(""); 
  const [gameChainStack, setGameChainStack] = useState([]);
  const [gameSelectedAction, setGameSelectedAction] = useState(null); 
  const [gamePriorityOwner, setGamePriorityOwner] = useState(0);
  const [gameSummonedThisTurn, setGameSummonedThisTurn] = useState(false);

  const [pDeck, setPDeck] = useState([]); const [pHand, setPHand] = useState([]); const [pMonsters, setPMonsters] = useState([]); const [pSpells, setPSpells] = useState([]);
  const [oDeck, setODeck] = useState([]); const [oHand, setOHand] = useState([]); const [oMonsters, setOMonsters] = useState([]); const [oSpells, setOSpells] = useState([]);
  const [activeField, setActiveField] = useState(null);

  const [lobby_isIReady, setLobby_isIReady] = useState(false);
  const [lobby_isOpponentReady, setLobby_isOpponentReady] = useState(false);
  const [game_isISetupReady, setGame_isISetupReady] = useState(false);
  const [game_isOpponentSetupReady, setGame_isOpponentSetupReady] = useState(false);

  // --- [Logic] ---
  const triggerNotification = useCallback((msg) => {
    setGameNotification(msg);
    setTimeout(() => setGameNotification(""), 1500);
  }, []);

  const networkEmit = useCallback((actionType, data) => {
    socket.emit('GAME_ACTION', { roomCode, actionType, data });
  }, [roomCode]);

  const handleGameStart = useCallback((myD, opD, firstTurn) => {
    setPDeck(myD.slice(6)); setODeck(opD.slice(6));
    setPHand(myD.slice(0, 6)); setOHand(opD.slice(0, 6));
    setGamePhase('SETUP'); setCurrentView('GAME'); 
    setGameTurnOwner(firstTurn); setGamePriorityOwner(firstTurn);
    setGame_isISetupReady(false); setGame_isOpponentSetupReady(false);
    triggerNotification(firstTurn === myPlayerNumber ? "YOU GO FIRST" : "YOU GO SECOND");
  }, [myPlayerNumber, triggerNotification]);

  const handlePass = useCallback(() => {
    if (gameChainStack.length === 0 && gameTurnOwner === myPlayerNumber && gamePriorityOwner === myPlayerNumber) {
      const nextTurn = gameTurnOwner === 0 ? 1 : 0;
      setGameTurnOwner(nextTurn); setGameTotalTurns(t => t + 1); setGamePriorityOwner(nextTurn);
      triggerNotification("NEXT TURN");
      if (myPlayerNumber === gameTurnOwner) networkEmit('PASS', {}); return;
    }
    setGamePriorityOwner(gamePriorityOwner === 0 ? 1 : 0);
    if (gamePriorityOwner === myPlayerNumber) networkEmit('PASS', {});
  }, [gameChainStack, gameTurnOwner, myPlayerNumber, gamePriorityOwner, networkEmit, triggerNotification]);

  const resolveChain = useCallback(() => {
    triggerNotification("RESOLVING...");
    let newPM = [...pMonsters], newOM = [...oMonsters], newPS = [...pSpells], newOS = [...oSpells];
    let tempChain = [...gameChainStack];
    while (tempChain.length > 0) {
      const action = tempChain.pop(); const { card, targetId } = action;
      newPS = newPS.filter(s => s.instanceId !== card.instanceId); newOS = newOS.filter(s => s.instanceId !== card.instanceId);
      let target = newPM.find(m => m.instanceId === targetId) || newOM.find(m => m.instanceId === targetId);
      if (target && action.effect === 'DIFF') {
        const next = derivative(target.formula, 'x').toString();
        const res = Engine.checkDestruction(next, activeField);
        if (res.destroyed) { newPM = newPM.filter(m => m.instanceId !== targetId); newOM = newOM.filter(m => m.instanceId !== targetId); }
        else target.formula = res.formula;
      }
    }
    setTimeout(() => { setPMonsters(newPM); setOMonsters(newOM); setPSpells(newPS); setOSpells(newOS); setGameChainStack([]); setGamePriorityOwner(gameTurnOwner); }, 800);
  }, [gameChainStack, pMonsters, oMonsters, pSpells, oSpells, activeField, gameTurnOwner, triggerNotification]);

  // --- [useEffect] 소켓 리스너 ---
  useEffect(() => {
    socket.on('connect', () => setIsConnected(true));
    socket.on('disconnect', () => setIsConnected(false));
    socket.on('ROOM_CREATED', ({ roomCode, playerNumber }) => { setRoomCode(roomCode); setMyPlayerNumber(playerNumber); setCurrentView('LOBBY'); });
    socket.on('ROOM_JOINED', ({ roomCode, playerNumber }) => { setRoomCode(roomCode); setMyPlayerNumber(playerNumber); setCurrentView('LOBBY'); });
    socket.on('PLAYER_UPDATE', ({ count }) => setPlayerCount(count));
    socket.on('OPPONENT_READY', () => setLobby_isOpponentReady(true));
    socket.on('GAME_START_SIGNAL', ({ decks, firstTurn, playerIds }) => {
      const myId = socket.id; const opId = playerIds.find(id => id !== myId);
      handleGameStart(decks[myId], decks[opId], firstTurn);
    });
    socket.on('OPPONENT_ACTION', ({ actionType, data }) => {
      switch (actionType) {
        case 'SETUP_MONSTER': setOMonsters(p => [...p, {...data.card, isFacedown: true}]); setOHand(p => p.slice(0, -1)); break;
        case 'GAME_SETUP_READY': setGame_isOpponentSetupReady(true); break;
        case 'GAME_START_SYNC': setPMonsters(data.pMonsters); setOMonsters(data.oMonsters); setGamePhase('MAIN'); triggerNotification("DUEL START!"); break;
        case 'PASS': handlePass(); break;
        case 'PLAY_MONSTER': setOMonsters(p => [...p, data.card]); setOHand(p => p.slice(0, -1)); break;
        default: break;
      }
    });
    socket.on('ERROR', (m) => { alert(m); window.location.reload(); });
    return () => { socket.off('ROOM_CREATED'); socket.off('ROOM_JOINED'); socket.off('GAME_START_SIGNAL'); socket.off('OPPONENT_ACTION'); };
  }, [myPlayerNumber, roomCode, handleGameStart, triggerNotification, handlePass]);

  // --- [UI Handlers] ---
  const isCardPlayable = (card, isPlayer) => {
    if (gameWinner || !isPlayer || gameSelectedAction) return false;
    if (gamePhase === 'SETUP') return card.type === 'monster' && pMonsters.length < 3;
    if (gamePriorityOwner !== myPlayerNumber) return false;
    if (gamePhase === 'MAIN') {
      if (card.type === 'monster') return gameTurnOwner === myPlayerNumber && gameChainStack.length === 0 && !gameSummonedThisTurn && pMonsters.length < 3;
      if (card.type === 'spell') return pSpells.length < 3;
      return (card.type === 'trap' || card.type === 'field') && gameChainStack.length === 0 && pSpells.length < 3;
    }
    return false;
  };

  const onHandCardClick = (card, idx) => {
    if (!isCardPlayable(card, true)) return;
    if (gamePhase === 'SETUP') {
      const newM = { ...card, instanceId: Math.random(), isFacedown: true };
      setPMonsters([...pMonsters, newM]); setPHand(pHand.filter((_, i) => i !== idx));
      networkEmit('SETUP_MONSTER', { card: newM });
    } else if (card.type === 'monster') {
      const newM = { ...card, instanceId: Math.random(), isFacedown: false };
      setPMonsters([...pMonsters, newM]); setPHand(pHand.filter((_, i) => i !== idx));
      setGameSummonedThisTurn(true); networkEmit('PLAY_MONSTER', { card: newM });
    }
  };

  // =============================================================================
  // [SECTION 5] 뷰 전환 렌더링 (참조 에러 방지용 직접 배치)
  // =============================================================================

  if (currentView === 'MENU') return (
    <div className="menu-screen">
      <h1 className="game-title">NABLA MASTERS</h1>
      <div className="menu-main vertical">
        <button className="menu-btn large" onClick={() => setCurrentView('DUEL_MENU')}>DUEL</button>
        <button className="menu-btn large" onClick={() => setCurrentView('DECK_LIST')}>DECK</button>
      </div>
      <div className={`connection-status ${isConnected ? 'on' : 'off'}`}>Server: {isConnected ? "CONNECTED" : "DISCONNECTED"}</div>
    </div>
  );

  if (currentView === 'DECK_LIST') return (
    <div className="menu-screen deck-list-view">
      <h1 className="game-title small">MY DECKS</h1>
      <div className="deck-grid">
        {savedDecks.map(d => (<div key={d.id} className="deck-slot" onClick={() => { setEditingDeck(d); setCurrentView('DECK_EDITOR'); }}>
          <div className="deck-slot-name">{d.name}</div><div className="deck-slot-count">{d.cards.length} Cards</div>
        </div>))}
        <div className="deck-slot add-new" onClick={() => setSavedDecks([...savedDecks, {id: Date.now().toString(), name: 'New Deck', cards: []}])}><span>+ NEW DECK</span></div>
      </div>
      <button className="menu-btn" onClick={() => setCurrentView('MENU')}>BACK</button>
    </div>
  );

  if (currentView === 'DECK_EDITOR') return <DeckEditor deck={editingDeck} onBack={() => setCurrentView('DECK_LIST')} onSave={(c) => { 
    const updated = savedDecks.map(d => d.id === editingDeck.id ? {...editingDeck, cards: c} : d);
    setSavedDecks(updated); localStorage.setItem('nabla_decks', JSON.stringify(updated)); setCurrentView('DECK_LIST'); 
  }} />;

  if (currentView === 'DUEL_MENU') return (
    <div className="menu-screen">
      <h1 className="game-title small">DUEL MODE</h1>
      <div className="menu-main vertical">
        <button className="menu-btn large" onClick={() => setCurrentView('ROOM_LOBBY')}>MULTI PLAY</button>
        <button className="menu-btn large" onClick={() => setCurrentView('MENU')}>BACK</button>
      </div>
    </div>
  );

  if (currentView === 'ROOM_LOBBY') return (
    <div className="menu-screen">
      <h1 className="game-title small">MULTI PLAY</h1>
      <div className="menu-main vertical">
        {!showJoinInput ? (
          <><button className="menu-btn large" onClick={() => socket.emit('CREATE_ROOM')}>CREATE ROOM</button>
          <button className="menu-btn large" onClick={() => setShowJoinInput(true)}>JOIN ROOM</button>
          <button className="menu-btn large" onClick={() => setCurrentView('DUEL_MENU')}>BACK</button></>
        ) : (
          <div className="join-input-container">
            <input className="room-code-input" type="text" placeholder="CODE" value={inputCode} onChange={(e)=>setInputCode(e.target.value.toUpperCase())} />
            <div className="join-btns">
              <button className="menu-btn primary" onClick={() => socket.emit('JOIN_ROOM', inputCode)}>JOIN</button>
              <button className="menu-btn" onClick={() => setShowJoinInput(false)}>CANCEL</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  if (currentView === 'LOBBY') return (
    <div className="menu-screen lobby">
      <div className="room-info-header"><p>ROOM CODE</p><h2 className="code-display">{roomCode}</h2></div>
      <div className="player-slots">
        <div className="p-slot active">YOU {lobby_isIReady ? '√' : ''}</div>
        <div className={`p-slot ${playerCount >= 2 ? 'active' : 'waiting'}`}>{playerCount >= 2 ? `OPPONENT ${lobby_isOpponentReady ? '√' : ''}` : "WAITING..."}</div>
      </div>
      <h2>SELECT DECK</h2>
      <div className="deck-selector">
        {savedDecks.map(d => (<div key={d.id} className={`deck-item ${selectedDeckId === d.id ? 'selected' : ''}`} onClick={() => setSelectedDeckId(d.id)}>{d.name} ({d.cards.length} cards)</div>))}
      </div>
      <div className="lobby-btns">
        <button className={`menu-btn large ${lobby_isIReady ? 'ready' : ''}`} onClick={() => {
          const d = savedDecks.find(d => d.id === selectedDeckId); if (!d || d.cards.length < 40) return alert("덱 40장 필수");
          setLobby_isIReady(true); socket.emit('READY_TO_START', { roomCode, deck: Engine.shuffle(d.cards) });
        }}>{lobby_isIReady ? 'READY √' : 'READY TO DUEL'}</button>
        <button className="menu-btn large" onClick={() => { socket.emit('LEAVE_ROOM_REQUEST', roomCode); window.location.reload(); }}>EXIT TO MENU</button>
      </div>
    </div>
  );

  return (
    <div className="game-container">
      {gameNotification && <div className="phase-notification">{gameNotification}</div>}
      <div className="hand-container top">{oHand.map((c, i) => <div key={`oh-${i}`} className="card back small" />)}</div>
      <div className="main-arena">
        <div className="duel-board">
          <div className="zone spell-zone opponent-side">{[0,1,2].map(i => (<div key={`os-${i}`} className="slot">{oSpells[i] && <div className="card back" />}</div>))}</div>
          <div className="zone monster-zone opponent-side">{[0,1,2].map(i => (<div key={`om-${i}`} className="slot">{oMonsters[i] && <CardUI card={oMonsters[i]} isFacedown={oMonsters[i].isFacedown} />}</div>))}</div>
          <div className="center-divider">
            <div className="field-anchor"><div className="slot field-slot">{activeField ? <CardUI card={activeField} /> : 'FIELD'}</div></div>
            <div className={`turn-priority-tab ${gameTurnOwner === myPlayerNumber ? "player-turn" : "opponent-turn"}`}>
              <div className="turn-info">TURN {gameTotalTurns}</div>
              {gamePhase === 'SETUP' ? <button className={`setup-btn ${game_isISetupReady ? "ready-active" : ""}`} onClick={() => { if(pMonsters.length<1) return alert("몬스터 세트 필수"); setGame_isISetupReady(true); networkEmit('GAME_SETUP_READY', {}); }}>{game_isISetupReady ? "READY √" : "READY"}</button> : 
              <button className="pass-btn" onClick={handlePass} disabled={gamePriorityOwner !== myPlayerNumber}>PASS</button>}
            </div>
          </div>
          <div className="zone monster-zone player-side">{[0,1,2].map(i => (<div key={`pm-${i}`} className="slot" onClick={() => gameSelectedAction && handleTargetClick(pMonsters[i]?.instanceId)}>{pMonsters[i] && <CardUI card={pMonsters[i]} isPlayerSide={true} isFacedown={pMonsters[i].isFacedown} />}</div>))}</div>
          <div className="zone spell-zone player-side">{[0,1,2].map(i => <div key={`ps-${i}`} className="slot" onClick={() => pSpells[i] && networkEmit('ADD_TO_CHAIN', {card: pSpells[i], targetId: null})}>{pSpells[i] && <CardUI card={pSpells[i]} isPlayerSide={true} />}</div>)}</div>
        </div>
      </div>
      <div className="hand-container bottom">{pHand.map((c, i) => <CardUI key={`ph-${i}`} card={c} isPlayerSide={true} isPlayable={isCardPlayable(c, true)} onClick={() => onHandCardClick(c, i)} isHand={true} />)}</div>
    </div>
  );
}