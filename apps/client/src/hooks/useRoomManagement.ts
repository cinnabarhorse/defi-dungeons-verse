import { useState } from 'react';

export function useRoomManagement() {
  const [currentRoomId, setCurrentRoomId] = useState('');
  const [hostSessionId, setHostSessionId] = useState('');
  const [playerCount, setPlayerCount] = useState(0);
  const [maxPlayers, setMaxPlayers] = useState<number | null>(null);
  const [roomPhase, setRoomPhase] = useState<'staging' | 'countdown' | 'in_game' | 'ended'>('staging');
  const [countdownEndsAt, setCountdownEndsAt] = useState<number>(0);
  const [autoCloseAt, setAutoCloseAt] = useState<number>(0);
  const [lateJoinCutoffAt, setLateJoinCutoffAt] = useState<number>(0);
  const [runStartedAt, setRunStartedAt] = useState<number>(0);
  const [startedByPlayerId, setStartedByPlayerId] = useState<string | null>(null);

  // Connection diagnostics state
  const [ping, setPing] = useState<number | undefined>(undefined);

  // Debug wrapper for setPing
  const setPingWithDebug = (value: number) => {
    setPing(value);
  };
  const [connectionStatus, setConnectionStatus] = useState<
    'connected' | 'disconnected' | 'reconnecting'
  >('disconnected');
  const [packetLoss, setPacketLoss] = useState(0);
  const [serverRegion, setServerRegion] = useState<string>('Connecting...');

  return {
    currentRoomId,
    setCurrentRoomId,
    hostSessionId,
    setHostSessionId,
    playerCount,
    setPlayerCount,
    maxPlayers,
    setMaxPlayers,
    roomPhase,
    setRoomPhase,
    countdownEndsAt,
    setCountdownEndsAt,
    autoCloseAt,
    setAutoCloseAt,
    lateJoinCutoffAt,
    setLateJoinCutoffAt,
    runStartedAt,
    setRunStartedAt,
    startedByPlayerId,
    setStartedByPlayerId,
    ping,
    setPing: setPingWithDebug,
    connectionStatus,
    setConnectionStatus,
    packetLoss,
    setPacketLoss,
    serverRegion,
    setServerRegion,
  };
}
