import React, { useState, useEffect, useCallback } from 'react';
import { derivative, simplify, evaluate, parse } from 'mathjs';
import 'katex/dist/katex.min.css';
import { InlineMath } from 'react-katex';
import { io } from 'socket.io-client';
import './App.css';

import { MONSTERS, SPELLS, TRAPS, FIELDS } from './cards';
import { Engine } from './engine';

// --- [SECTION 1] 서버 연결 및 설정 ---
const isLocal = window.location.hostname === 'localhost';
const SERVER_URL = isLocal ? 'http://localhost:3001' : 'https://renate-nonmultiplicative-edgardo.ngrok-free.dev';
const socket = io(SERVER_URL, { transports: ['websocket'] });
const CARD_LIBRARY = [...MONSTERS, ...SPELLS, ...TRAPS, ...FIELDS];

// --- [SECTION 2] 서브 UI 컴포넌트 ---
function UI_Card({ card, isFacedown, isPlayerSide, isPlayable, isHover, isDoomed, onClick, onContextMenu, className }) {
  if (!card) return null;
  const isMonster = card.type === 'monster';
  const mathContent = isMonster ? Engine.formatToTex(card.formula) : card.display;
  return (
    <div 
      className={`card ${card.type} ${isFacedown ? 'back' : (isPlayerSide && card.isSet ? 'facedown peekable' : '')} ${isPlayable ? 'playable' : ''} ${isDoomed ? 'doomed' : ''} ${isHover ? 'projection-hover' : ''} ${className || ''}`}
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

function UI_DeckEditor({ deck, onSave, onBack }) {
  const [currentCards, setCurrentCards] = useState(deck.cards || []);
  const handleAdd = (e, card) => {
    e.preventDefault();
    if (currentCards.length >= 60 || currentCards.filter(x => x.id === card.id).length >= 4) return;
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
        <div className="deck-view"><h3>MY DECK (Right-Click Remove)</h3><div className="editor-grid">{currentCards.map((c, i) => (<div key={c.instanceId || i} className="editor-card-wrapper" onContextMenu={(e) => handleRemove(e, c.instanceId)}><UI_Card card={c} isPlayerSide /></div>))}</div></div>
        <div className="library-view"><h3>CARD LIBRARY (Right-Click Add)</h3><div className="editor-grid">{CARD_LIBRARY.map((c, i) => (<div key={c.id || i} className="editor-card-wrapper" onContextMenu={(e) => handleAdd(e, c)}><UI_Card card={c} isPlayerSide /></div>))}</div></div>
      </div>
    </div>
  );
}

// --- [SECTION 3] 메인 앱 컴포넌트 ---
export default function App() {
  // --- 1. 상태 관리 ---
  const [currentView, setCurrentView] = useState('MENU'); 
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [roomCode, setRoomCode] = useState("");
  const [inputCode, setInputCode] = useState("");
  const [showJoinInput, setShowJoinInput] = useState(false);
  const [myPlayerNumber, setMyPlayerNumber] = useState(null); 
  const [playerCount, setPlayerCount] = useState(0);

  const [savedDecks, setSavedDecks] = useState(JSON.parse(localStorage.getItem('nabla_decks')) || [{id: 'd1', name: 'Starter Deck', cards: []}]);
  const [editingDeck, setEditingDeck] = useState(null);
  const [selectedDeckId, setSelectedDeckId] = useState(savedDecks[0]?.id);
  const [lobby_isPReady, setLobby_isPReady] = useState(false);
  const [lobby_isOReady, setLobby_isOReady] = useState(false);

  const [game_phase, setGame_phase] = useState('START'); 
  const [game_turnOwner, setGame_turnOwner] = useState(0); 
  const [game_totalTurns, setGame_totalTurns] = useState(1); 
  const [game_priorityOwner, setGame_priorityOwner] = useState(0); 
  const [game_winner, setGame_winner] = useState(null);
  const [game_chainStack, setGame_chainStack] = useState([]);
  const [game_passes, setGame_passes] = useState(0);
  const [game_selectedAction, setGame_selectedAction] = useState(null); 
  const [game_summonedThisTurn, setGame_summonedThisTurn] = useState(false);
  const [game_isPReady, setGame_isPReady] = useState(false);
  const [game_isOReady, setGame_isOReady] = useState(false);
  
  const [pDeck, setPDeck] = useState([]); const [pHand, setPHand] = useState([]); const [pMonsters, setPMonsters] = useState([]); const [pSpells, setPSpells] = useState([]);
  const [oDeck, setODeck] = useState([]); const [oHand, setOHand] = useState([]); const [oMonsters, setOMonsters] = useState([]); const [oSpells, setOSpells] = useState([]);
  const [activeField, setActiveField] = useState(null);
  const [ui_notification, setUi_notification] = useState(""); 
  const [doomedIds, setDoomedIds] = useState(new Set());

  // --- 2. 로직 함수 (Callbacks) ---

  const triggerNotif = useCallback((msg) => {
    setUi_notification(msg);
    setTimeout(() => setUi_notification(""), 1500);
  }, []);

  const netEmit = useCallback((type, data) => {
    socket.emit('GAME_ACTION', { roomCode, actionType: type, data });
  }, [roomCode]);

  const game_draw = useCallback((p, count) => {
    const isMe = p === myPlayerNumber;
    const currentDeck = isMe ? pDeck : oDeck;
    if (currentDeck.length < count) { setGame_winner(isMe ? 'OPPONENT' : 'PLAYER'); return; }
    const newCards = currentDeck.slice(0, count);
    if (isMe) { setPHand(v => [...v, ...newCards]); setPDeck(v => v.slice(count)); }
    else { setOHand(v => [...v, ...newCards]); setODeck(v => v.slice(count)); }
  }, [pDeck, oDeck, myPlayerNumber]);

  const setupGame = useCallback((d0, d1, firstTurn) => {
    // 셔플된 덱 수신 및 분배
    const myD = myPlayerNumber === 0 ? d0 : d1;
    const opD = myPlayerNumber === 0 ? d1 : d0;
    setPDeck(myD.slice(6)); setODeck(opD.slice(6));
    setPHand(myD.slice(0, 6)); setOHand(opD.slice(0, 6));
    setGame_phase('SETUP'); setCurrentView('GAME'); 
    setGame_turnOwner(firstTurn); setGame_priorityOwner(firstTurn);
    setGame_isPReady(false); setGame_isOReady(false);
    
    // 선후공 표시 알림
    triggerNotif(firstTurn === myPlayerNumber ? "YOU GO FIRST" : "YOU GO SECOND");
  }, [myPlayerNumber, triggerNotif]);

  const handleEndTurn = useCallback(() => {
    if (game_turnOwner === myPlayerNumber && pHand.length > 8) { setGame_phase('DISCARD'); triggerNotif("DISCARD PHASE"); return; }
    const nextTurn = game_turnOwner === 0 ? 1 : 0;
    setGame_turnOwner(nextTurn); setGame_totalTurns(t => t + 1); setGame_priorityOwner(nextTurn);
    setGame_summonedThisTurn(false); setGame_passes(0);
    triggerNotif("NEXT TURN");
    if (myPlayerNumber === game_turnOwner) netEmit('END_TURN_SYNC', { nextTurn, totalTurns: game_totalTurns + 1 });
    setTimeout(() => game_draw(nextTurn, 2), 500);
  }, [game_turnOwner, myPlayerNumber, pHand.length, game_totalTurns, netEmit, game_draw, triggerNotif]);

  const handlePass = useCallback(() => {
    if (game_chainStack.length === 0 && game_turnOwner === myPlayerNumber && game_priorityOwner === myPlayerNumber) {
      handleEndTurn(); return;
    }
    setGame_priorityOwner(game_priorityOwner === 0 ? 1 : 0);
    setGame_passes(p => p + 1);
    if (game_priorityOwner === myPlayerNumber) netEmit('PASS', {});
  }, [game_chainStack.length, game_turnOwner, myPlayerNumber, game_priorityOwner, handleEndTurn, netEmit]);

  const resolveChain = useCallback(() => {
    triggerNotif("RESOLVING...");
    let newPM = [...pMonsters], newOM = [...oMonsters], newPS = [...pSpells], newOS = [...oSpells];
    let tempChain = [...game_chainStack];
    while (tempChain.length > 0) {
      const act = tempChain.pop(); const { card, targetId } = act;
      newPS = newPS.filter(s => s.instanceId !== act.instanceId); newOS = newOS.filter(s => s.instanceId !== act.instanceId);
      let target = newPM.find(m => m.instanceId === targetId) || newOM.find(m => m.instanceId === targetId);
      if (target && act.effect === 'DIFF') {
        const next = Engine.checkDestruction(derivative(target.formula, 'x').toString(), activeField);
        if (next.destroyed) { newPM = newPM.filter(m => m.instanceId !== act.targetId); newOM = newOM.filter(m => m.instanceId !== act.targetId); }
        else target.formula = next.formula;
      }
    }
    setTimeout(() => { setPMonsters(newPM); setOMonsters(newOM); setPSpells(newPS); setOSpells(newOS); setGame_chainStack([]); setGame_priorityOwner(game_turnOwner); setGame_passes(0); }, 800);
  }, [game_chainStack, pMonsters, oMonsters, pSpells, oSpells, activeField, game_turnOwner, triggerNotif]);

  // --- 3. 소켓 이벤트 리스너 ---
  useEffect(() => {
    socket.on('connect', () => setIsConnected(true));
    socket.on('disconnect', () => setIsConnected(false));
    socket.on('ROOM_CREATED', ({ roomCode, playerNumber }) => { setRoomCode(roomCode); setMyPlayerNumber(playerNumber); setCurrentView('LOBBY'); });
    socket.on('ROOM_JOINED', ({ roomCode, playerNumber }) => { setRoomCode(roomCode); setMyPlayerNumber(playerNumber); setCurrentView('LOBBY'); });
    socket.on('PLAYER_UPDATE', ({ count }) => setPlayerCount(count));
    socket.on('OPPONENT_READY', () => setLobby_isOReady(true));
    socket.on('GAME_START_SIGNAL', ({ decks, firstTurn, playerIds }) => {
      const myId = socket.id; const opId = playerIds.find(id => id !== myId);
      setupGame(decks[myId], decks[opId], firstTurn);
    });
    socket.on('OPPONENT_ACTION', ({ actionType, data }) => {
        switch (actionType) {
            case 'SETUP_MONSTER': setOMonsters(p => [...p, {...data.card, isFacedown: true}]); setOHand(p => p.slice(0, -1)); break;
            case 'GAME_SETUP_READY': setGame_isOReady(true); break;
            case 'GAME_START_SYNC': setPMonsters(data.pMonsters); setOMonsters(data.oMonsters); setGame_phase('MAIN'); setGame_totalTurns(1); showNotif("DUEL START!"); break;
            case 'PASS': handlePass(); break;
            case 'END_TURN_SYNC': setGame_turnOwner(data.nextTurn); setGame_totalTurns(data.total); setGame_priorityOwner(data.nextTurn); break;
            case 'PLAY_MONSTER': setOMonsters(p => [...p, data.card]); setOHand(p => p.slice(0, -1)); break;
            case 'SET_TRAP': setOSpells(p => [...p, {...data.card, isSet: true}]); setOHand(p => p.slice(0, -1)); break;
            case 'PLAY_SPELL': setOSpells(p => [...p, data.card]); setOHand(p => p.slice(0, -1)); break;
            case 'PLAY_FIELD': setActiveField(data.card); setOHand(p => p.slice(0, -1)); break;
            case 'ADD_TO_CHAIN': setGame_chainStack(p => [...p, {...data.card, isPlayer: false, targetId: data.targetId, targetName: data.targetName}]); setGame_priorityOwner(myPlayerNumber); break;
            case 'SURRENDER': setGame_winner('PLAYER'); break;
            default: break;
        }
    });
    socket.on('ERROR', (m) => { alert(m); window.location.reload(); });
    return () => { socket.off('ROOM_CREATED'); socket.off('ROOM_JOINED'); socket.off('GAME_START_SIGNAL'); socket.off('OPPONENT_ACTION'); };
  }, [myPlayerNumber, roomCode, setupGame, triggerNotif, handlePass]);

  // --- 4. 게임 루프 및 핸들러 ---
  const isCardPlayable = useCallback((card, isPlayerSide) => {
    if (game_winner || !isPlayerSide || game_selectedAction) return false;
    if (game_phase === 'SETUP') return card.type === 'monster' && pMonsters.length < 3;
    if (game_priorityOwner !== myPlayerNumber) return false;
    if (game_phase === 'MAIN' && game_chainStack.length === 0) return card.type === 'monster' ? game_turnOwner === myPlayerNumber && pMonsters.length < 3 && !game_summonedThisTurn : pSpells.length < 3;
    return false;
  }, [game_winner, game_selectedAction, game_phase, pMonsters.length, game_priorityOwner, myPlayerNumber, game_turnOwner, game_chainStack.length, game_summonedThisTurn, pSpells.length]);

  useEffect(() => {
    if (game_winner || game_phase === 'SETUP' || game_phase === 'START' || currentView !== 'GAME') return;
    if (game_passes >= 2 && game_chainStack.length > 0) resolveChain();
    else if (game_priorityOwner === myPlayerNumber && !game_selectedAction && !pHand.some(c => isCardPlayable(c, true)) && !pSpells.some(s => s.isSet)) handlePass();
  }, [game_passes, game_chainStack.length, game_phase, currentView, resolveChain, game_winner, game_priorityOwner, myPlayerNumber, game_selectedAction, isCardPlayable, pHand, pSpells, handlePass]);

  const handleHandClick = (card, idx) => {
    if (!isCardPlayable(card, true)) return;
    if (game_phase === 'SETUP') {
      const newM = { ...card, instanceId: Math.random(), isFacedown: true };
      setPMonsters([...pMonsters, newM]); setPHand(pHand.filter((_, i) => i !== idx));
      netEmit('SETUP_MONSTER', { card: newM });
    } else if (card.type === 'monster') {
      const newM = { ...card, instanceId: Math.random(), isFacedown: false };
      setPMonsters([...pMonsters, newM]); setPHand(pHand.filter((_, i) => i !== idx));
      setGame_summonedThisTurn(true); netEmit('PLAY_MONSTER', { card: newM });
    } else if (card.type === 'spell') {
      const sInst = { ...card, instanceId: Math.random() };
      setPSpells([...pSpells, sInst]); setPHand(pHand.filter((_, i) => i !== idx));
      netEmit('PLAY_SPELL', { card: sInst });
    } else if (card.type === 'trap') {
      const tInst = { ...card, instanceId: Math.random(), isSet: true, setAtTurn: game_totalTurns };
      setPSpells([...pSpells, tInst]); setPHand(pHand.filter((_, i) => i !== idx));
      netEmit('SET_TRAP', { card: tInst });
    } else if (card.type === 'field') {
      setActiveField(card); setPHand(pHand.filter((_, i) => i !== idx));
      netEmit('PLAY_FIELD', { card });
    }
  };

  const onLobby_ReadyClick = () => {
    const d = savedDecks.find(x => x.id === selectedDeckId);
    if (!d || d.cards.length < 40) return alert("덱 40장 필수");
    setLobby_isPReady(true);
    // [인게임 수정] 셔플 로직 강제 적용
    socket.emit('READY_TO_START', { roomCode, deck: Engine.shuffle(d.cards) });
  };

  const onGame_SetupReadyClick = () => {
    if (pMonsters.length < 1) return alert("몬스터 세트 필수");
    setGame_isPReady(true); netEmit('GAME_SETUP_READY', {});
  };

  useEffect(() => {
    if (game_phase === 'SETUP' && game_isPReady && game_isOReady && myPlayerNumber === 0) {
      const fPM = pMonsters.map(m => ({ ...m, isFacedown: false }));
      const fOM = oMonsters.map(m => ({ ...m, isFacedown: false }));
      netEmit('GAME_START_SYNC', { oMonsters: fPM, pMonsters: fOM });
      setPMonsters(fPM); setOMonsters(fOM); setGame_phase('MAIN'); triggerNotif("DUEL START!");
    }
  }, [game_isPReady, game_isOReady, myPlayerNumber, game_phase, pMonsters, oMonsters, netEmit, triggerNotif]);

  // --- 5. 뷰 렌더링 ---
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
        {savedDecks.map(d => (<div key={d.id} className="deck-slot" onClick={() => { setEditingDeck(d); setCurrentView('DECK_EDITOR'); }}><div className="deck-slot-name">{d.name}</div><div className="deck-slot-count">{d.cards.length} Cards</div></div>))}
        <div className="deck-slot add-new" onClick={() => setSavedDecks([...savedDecks, {id: Date.now().toString(), name: 'New Deck', cards: []}])}><span>+ NEW DECK</span></div>
      </div>
      <button className="menu-btn" onClick={() => setCurrentView('MENU')}>BACK</button>
    </div>
  );

  if (currentView === 'DECK_EDITOR') return <UI_DeckEditor deck={editingDeck} onBack={() => setCurrentView('DECK_LIST')} onSave={(c) => { 
    const updated = savedDecks.map(d => d.id === editingDeck.id ? {...editingDeck, cards: c} : d);
    setSavedDecks(updated); localStorage.setItem('nabla_decks', JSON.stringify(updated)); setCurrentView('DECK_LIST');
  }} />;

  if (currentView === 'DUEL_MENU') return (
    <div className="menu-screen"><h1 className="game-title small">DUEL MODE</h1><div className="menu-main vertical"><button className="menu-btn large" onClick={() => { setShowJoinInput(false); setCurrentView('ROOM_LOBBY'); }}>MULTI PLAY</button><button className="menu-btn large" onClick={() => setCurrentView('MENU')}>BACK</button></div></div>
  );

  if (currentView === 'ROOM_LOBBY') return (
    <div className="menu-screen"><h1 className="game-title small">MULTI PLAY</h1><div className="menu-main vertical">
      {!showJoinInput ? (<><button className="menu-btn large" onClick={() => socket.emit('CREATE_ROOM')}>CREATE ROOM</button><button className="menu-btn large" onClick={() => setShowJoinInput(true)}>JOIN ROOM</button><button className="menu-btn large" onClick={() => setCurrentView('DUEL_MENU')}>BACK</button></>) : 
      (<div className="join-input-container"><input className="room-code-input" type="text" placeholder="CODE" value={inputCode} onChange={(e)=>setInputCode(e.target.value.toUpperCase())} /><div className="join-btns"><button className="menu-btn primary" onClick={() => socket.emit('JOIN_ROOM', inputCode)}>JOIN</button><button className="menu-btn" onClick={() => setShowJoinInput(false)}>CANCEL</button></div></div>)}
    </div></div>
  );

  if (currentView === 'LOBBY') return (
    <div className="menu-screen lobby">
      <div className="room-info-header"><p>ROOM CODE</p><h2 className="code-display">{roomCode}</h2></div>
      <div className="player-slots"><div className="p-slot active">YOU {lobby_isPReady ? '√' : ''}</div><div className={`p-slot ${playerCount >= 2 ? 'active' : 'waiting'}`}>{playerCount >= 2 ? `OPPONENT ${lobby_isOReady ? '√' : ''}` : "WAITING..."}</div></div>
      <h2>SELECT DECK</h2>
      <div className="deck-selector">{savedDecks.map(d => (<div key={d.id} className={`deck-item ${selectedDeckId === d.id ? 'selected' : ''}`} onClick={() => setSelectedDeckId(d.id)}>{d.name} ({d.cards.length})</div>))}</div>
      <div className="lobby-btns">
        <button className={`menu-btn large ${lobby_isPReady ? 'ready' : ''}`} onClick={onLobby_ReadyClick}>{lobby_isPReady ? 'READY √' : 'READY TO DUEL'}</button>
        <button className="menu-btn large" onClick={() => { socket.emit('LEAVE_ROOM_REQUEST', roomCode); window.location.reload(); }}>EXIT TO MENU</button>
      </div>
    </div>
  );

  return (
    <div className="game-container" onContextMenu={(e)=>{ e.preventDefault(); setGame_selectedAction(null); }}>
      {ui_notification && <div className="phase-notification">{ui_notification}</div>}
      {/* 상대 정보 바 (패 매수 + 덱 매수) */}
      <div className="hand-container top">
        <div className="deck-info opponent-deck">DECK: {oDeck.length}</div>
        {oHand.map((c, i) => <div key={`oh-${i}`} className="card back small" />)}
      </div>

      <div className="main-arena">
        <div className="duel-board">
          <div className="zone spell-zone opponent-side">{[0,1,2].map(i => (<div key={`os-${i}`} className="slot">{oSpells[i] && <div className="card back" />}</div>))}</div>
          <div className="zone monster-zone opponent-side">{[0,1,2].map(i => (<div key={`om-${i}`} className="slot">{oMonsters[i] && <UI_Card card={oMonsters[i]} isFacedown={oMonsters[i].isFacedown} />}</div>))}</div>
          <div className="center-divider">
            <div className="field-anchor"><div className="slot field-slot">{activeField ? <UI_Card card={activeField} /> : 'FIELD'}</div></div>
            {/* [인게임 수정] 현재 턴 및 우선권 명시 */}
            <div className={`turn-priority-tab ${game_turnOwner === myPlayerNumber ? "player-turn" : "opponent-turn"}`}>
              <div className="turn-label">{game_turnOwner === myPlayerNumber ? "YOUR TURN" : "ENEMY TURN"}</div>
              <div className="turn-info">TURN {game_totalTurns}</div>
              {game_phase === 'SETUP' ? 
                <button className={`setup-btn ${game_isPReady ? "ready-active" : ""}`} onClick={onGame_SetupReadyClick}>{game_isPReady ? "READY √" : "READY"}</button> : 
                <button className="pass-btn" onClick={handlePass} disabled={game_priorityOwner !== myPlayerNumber}>PASS</button>
              }
            </div>
          </div>
          <div className="zone monster-zone player-side">{[0,1,2].map(i => (<div key={`pm-${i}`} className="slot">{pMonsters[i] && <UI_Card card={pMonsters[i]} isPlayerSide isFacedown={pMonsters[i].isFacedown} />}</div>))}</div>
          <div className="zone spell-zone player-side">{[0,1,2].map(i => <div key={`ps-${i}`} className="slot" onClick={() => pSpells[i] && netEmit('ADD_TO_CHAIN', {card: pSpells[i], targetId: null})}>{pSpells[i] && <UI_Card card={pSpells[i]} isPlayerSide />}</div>)}</div>
        </div>
      </div>

      {/* 내 정보 바 (패 매수 + 덱 매수) */}
      <div className="hand-container bottom">
        <div className="deck-info player-deck">DECK: {pDeck.length}</div>
        {pHand.map((c, i) => <UI_Card key={`ph-${i}`} card={c} isPlayerSide isHand isPlayable={isCardPlayable(c, true)} onClick={() => handleHandClick(c, i)} />)}
      </div>
      <button className="menu-exit-btn" onClick={() => { if(window.confirm("항복하시겠습니까?")) { socket.emit('GAME_ACTION', { roomCode, actionType: 'SURRENDER', data: {} }); window.location.reload(); } }}>SURRENDER</button>
    </div>
  );
}