'use client';

import React from 'react';
import { cn } from '../lib/utils';
import { CharacterPreview } from './CharacterPreview';
import { useSession } from './providers/SessionProvider';
import { getAppServerBaseUrl } from '../lib/server-url';
import { getDifficultyTier } from '../data/difficulty-tiers';

interface DialogueResponse {
  text: string;
  nextDialogue: string;
}

interface DialogueData {
  text: string;
  responses: DialogueResponse[];
}

interface DialogueBoxProps {
  isOpen: boolean;
  npcName: string;
  npcCharacterId: string;
  dialogueData: DialogueData | null;
  isProcessingAction: boolean;
  onResponseSelect: (nextDialogue: string) => void;
  onClose: () => void;
  className?: string;
  extraContent?: React.ReactNode;
  dailyQuestDifficultyId?: string | null;
}

// Render inline bold segments for any **bold** markers in a plain string
function renderBoldSegments(source: string): React.ReactNode[] {
  if (!source) return [];
  const nodes: React.ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIndex = 0;
  while ((match = pattern.exec(source)) !== null) {
    const before = source.slice(lastIndex, match.index);
    if (before) nodes.push(before);
    const boldContent = match[1];
    nodes.push(<strong key={`bold-${keyIndex++}`}>{boldContent}</strong>);
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < source.length) {
    nodes.push(source.slice(lastIndex));
  }
  return nodes;
}

interface BoldSegment {
  isBold: boolean;
  text: string;
}

function parseBoldSegments(source: string): BoldSegment[] {
  if (!source) return [];
  const segments: BoldSegment[] = [];
  let index = 0;
  while (index < source.length) {
    const start = source.indexOf('**', index);
    if (start === -1) {
      segments.push({ isBold: false, text: source.slice(index) });
      break;
    }
    if (start > index) {
      segments.push({ isBold: false, text: source.slice(index, start) });
    }
    const end = source.indexOf('**', start + 2);
    if (end === -1) {
      // Unmatched; treat remainder as plain text
      segments.push({ isBold: false, text: source.slice(start) });
      break;
    }
    const boldContent = source.slice(start + 2, end);
    segments.push({ isBold: true, text: boldContent });
    index = end + 2;
  }
  return segments;
}

function renderTypedSegments(segments: BoldSegment[]): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let keyIndex = 0;
  for (const seg of segments) {
    if (!seg.text) continue;
    nodes.push(
      seg.isBold ? (
        <strong key={`seg-${keyIndex++}`}>{seg.text}</strong>
      ) : (
        <React.Fragment key={`seg-${keyIndex++}`}>{seg.text}</React.Fragment>
      )
    );
  }
  return nodes;
}

export function DialogueBox({
  isOpen,
  npcName,
  npcCharacterId,
  dialogueData,
  isProcessingAction,
  onResponseSelect,
  onClose,
  className,
  extraContent,
  dailyQuestDifficultyId,
}: DialogueBoxProps) {
  const { walletAddress, ensName, hasValidSession } = useSession();
  const [typedSegments, setTypedSegments] = React.useState<BoldSegment[]>([]);
  const [isTyping, setIsTyping] = React.useState(false);
  const typingTimeoutRef = React.useRef<number | null>(null);
  const [playerUsername, setPlayerUsername] = React.useState<string | null>(
    null
  );
  const scoreFormatter = React.useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }),
    []
  );
  const [dailyQuestPreview, setDailyQuestPreview] = React.useState<{
    thresholdScore: number;
    referenceScore: number;
  } | null>(null);
  const [loadingDailyQuest, setLoadingDailyQuest] = React.useState(false);

  // Resolve a friendly display name for the player
  function shortenAddress(address: string): string {
    if (!address || address.length < 10) return address || 'Unknown player';
    return `${address.slice(0, 6)}…${address.slice(-4)}`;
  }

  const displayPlayerName = React.useMemo(() => {
    const trimmedUsername = (playerUsername ?? '').trim();
    if (trimmedUsername) return trimmedUsername;
    if (ensName && ensName.trim()) return ensName;
    return shortenAddress(walletAddress);
  }, [playerUsername, ensName, walletAddress]);

  const resolvedDifficultyName = React.useMemo(() => {
    const fromTier = dailyQuestDifficultyId
      ? getDifficultyTier(dailyQuestDifficultyId)
      : null;
    return fromTier?.name ?? dailyQuestDifficultyId ?? 'your tier';
  }, [dailyQuestDifficultyId]);

  const needsDailyQuestData = React.useMemo(() => {
    if (!dialogueData) return false;
    const check = (text: string) =>
      text.includes('${difficulty}') || text.includes('${score}');
    if (check(dialogueData.text)) return true;
    return dialogueData.responses?.some((r) => check(r.text)) ?? false;
  }, [dialogueData]);

  // Fetch player username once when dialogue opens (if session exists)
  React.useEffect(() => {
    if (!isOpen || !hasValidSession) return;
    let cancelled = false;
    const baseUrl = getAppServerBaseUrl();
    (async () => {
      try {
        const res = await fetch(`${baseUrl}/api/player`, {
          credentials: 'include',
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setPlayerUsername(data?.username ?? null);
        }
      } catch {
        // ignore network errors; fall back to ENS/wallet
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, hasValidSession]);

  // Fetch daily quest preview when needed
  React.useEffect(() => {
    if (
      !isOpen ||
      !needsDailyQuestData ||
      !dailyQuestDifficultyId ||
      !hasValidSession
    ) {
      setDailyQuestPreview(null);
      return;
    }

    const controller = new AbortController();
    const baseUrl = getAppServerBaseUrl();
    const url = new URL('/api/daily-runs/preview', baseUrl);
    url.searchParams.set('difficultyId', dailyQuestDifficultyId);

    const run = async () => {
      setLoadingDailyQuest(true);
      try {
        const res = await fetch(url.toString(), {
          method: 'GET',
          credentials: 'include',
          signal: controller.signal,
        });
        if (!res.ok) {
          setDailyQuestPreview(null);
          return;
        }
        const data = await res.json();
        const thresholdScore = Math.max(
          0,
          Math.floor(Number(data?.thresholdScore) || 0)
        );
        const referenceScore = Math.max(
          0,
          Math.floor(Number(data?.referenceScore) || 0)
        );
        setDailyQuestPreview({ thresholdScore, referenceScore });
      } catch (error) {
        if ((error as any)?.name !== 'AbortError') {
          setDailyQuestPreview(null);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoadingDailyQuest(false);
        }
      }
    };

    run();

    return () => controller.abort();
  }, [isOpen, needsDailyQuestData, dailyQuestDifficultyId, hasValidSession]);

  // Replace ${playerName} placeholders with resolved display name
  const processedText = React.useMemo(() => {
    const src = dialogueData?.text ?? '';
    if (!src) return '';
    let next = src.replace(/\$\{playerName\}/g, displayPlayerName);
    next = next.replace(/\$\{difficulty\}/g, resolvedDifficultyName);
    const score =
      dailyQuestPreview?.thresholdScore != null
        ? scoreFormatter.format(dailyQuestPreview.thresholdScore)
        : '—';
    next = next.replace(/\$\{score\}/g, score);
    return next;
  }, [
    dialogueData?.text,
    displayPlayerName,
    resolvedDifficultyName,
    dailyQuestPreview?.thresholdScore,
    scoreFormatter,
  ]);

  const processedResponses = React.useMemo(() => {
    if (!dialogueData?.responses) return [];
    return dialogueData.responses.map((response) => {
      let text = response.text || '';
      text = text.replace(/\$\{playerName\}/g, displayPlayerName);
      text = text.replace(/\$\{difficulty\}/g, resolvedDifficultyName);
      const score =
        dailyQuestPreview?.thresholdScore != null
          ? scoreFormatter.format(dailyQuestPreview.thresholdScore)
          : '—';
      text = text.replace(/\$\{score\}/g, score);
      return { ...response, text };
    });
  }, [
    dialogueData?.responses,
    displayPlayerName,
    resolvedDifficultyName,
    dailyQuestPreview?.thresholdScore,
    scoreFormatter,
  ]);

  const fullSegments = React.useMemo(() => {
    return parseBoldSegments(processedText);
  }, [processedText]);

  React.useEffect(() => {
    if (!isOpen || !processedText) return;

    const tokenize = (value: string): string[] => {
      return value.match(/(\s+|\S+\s*)/g) || [];
    };

    // reset state
    setTypedSegments(fullSegments.map((s) => ({ isBold: s.isBold, text: '' })));
    setIsTyping(true);

    let cancelled = false;
    let segmentIndex = 0;
    let tokens = fullSegments.length > 0 ? tokenize(fullSegments[0].text) : [];
    let tokenIndex = 0;

    // Tunable timing (ms)
    const baseDelay = 140; // per word
    const commaPause = 260; // after comma/semicolon/colon
    const sentencePause = 420; // after end of sentence

    const step = () => {
      if (cancelled) return;

      // Advance to next segment when out of tokens
      while (
        segmentIndex < fullSegments.length &&
        tokenIndex >= tokens.length
      ) {
        segmentIndex += 1;
        if (segmentIndex < fullSegments.length) {
          tokens = tokenize(fullSegments[segmentIndex].text);
          tokenIndex = 0;
        }
      }

      if (segmentIndex >= fullSegments.length) {
        setIsTyping(false);
        if (typingTimeoutRef.current) {
          clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = null;
        }
        return;
      }

      const currentToken = tokens[tokenIndex] ?? '';
      setTypedSegments((prev) => {
        const next = prev.slice();
        const current = next[segmentIndex];
        next[segmentIndex] = {
          isBold: current.isBold,
          text: current.text + currentToken,
        };
        return next;
      });
      tokenIndex += 1;

      const lastChar = currentToken.trimEnd().slice(-1);
      const delay =
        lastChar === '.' || lastChar === '!' || lastChar === '?'
          ? sentencePause
          : lastChar === ',' || lastChar === ';' || lastChar === ':'
            ? commaPause
            : baseDelay;
      typingTimeoutRef.current = window.setTimeout(step, delay);
    };

    typingTimeoutRef.current = window.setTimeout(step, baseDelay / 2);

    return () => {
      cancelled = true;
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
    };
  }, [isOpen, processedText, fullSegments]);

  const handleSkipTyping = () => {
    if (!isTyping || !processedText) return;
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    setTypedSegments(fullSegments);
    setIsTyping(false);
  };

  const handleResponseClick = (response: DialogueResponse) => {
    if (isProcessingAction) return;
    if (response.nextDialogue === 'end') {
      onClose();
    } else {
      onResponseSelect(response.nextDialogue);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    // Only close if clicking the backdrop, not the dialogue box itself
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen || !dialogueData) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center"
      onClick={handleBackdropClick}
    >
      <div
        className={cn(
          'bg-slate-900/95 border-t border-slate-600 w-full max-h-[60vh] md:h-64 overflow-hidden',
          'rounded-t-2xl md:rounded-none',
          'pb-[calc(env(safe-area-inset-bottom)+8px)]',
          'transform transition-all duration-300 ease-out',
          'animate-in slide-in-from-bottom-8 fade-in-0',
          className
        )}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={npcName ? `${npcName} dialogue` : 'Dialogue'}
      >
        {/* Mobile Layout (bottom sheet) */}
        <div className="md:hidden flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center gap-3 p-4 border-b border-slate-700">
            <div className="flex items-center justify-center rounded-md bg-slate-800 shrink-0">
              {npcCharacterId === 'laozigotchi' ? (
                <img
                  src="/pfp/laozigotchi_pfp.png"
                  alt={npcName}
                  className="w-12 h-12 object-contain"
                />
              ) : (
                <CharacterPreview
                  characterId={npcCharacterId}
                  size="sm"
                  isSelected={true}
                />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-slate-100 font-bold truncate">{npcName}</div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wider">
                NPC
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-200 transition-colors p-2 rounded-lg hover:bg-slate-700/50"
              aria-label="Close dialogue"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-auto p-4">
            <div
              className="bg-slate-800/50 rounded-lg p-4 border-l-4 border-green-400 active:opacity-90"
              onClick={handleSkipTyping}
            >
              <p className="text-slate-200 text-base leading-relaxed">
                {renderTypedSegments(typedSegments)}
                {isTyping ? (
                  <span className="inline-block w-2 h-5 align-baseline animate-pulse">
                    ▌
                  </span>
                ) : null}
              </p>
            </div>
            {extraContent ? <div className="mt-4">{extraContent}</div> : null}
          </div>

          {/* Actions (sticky) */}
          <div className="sticky bottom-0 bg-gradient-to-t from-slate-900/95 to-slate-900/0 px-4 pt-3">
            {processedResponses && processedResponses.length > 0 ? (
              <div className="grid grid-cols-1 gap-2">
                {processedResponses.slice(0, 4).map((response, index) => (
                  <button
                    key={index}
                    disabled={isProcessingAction}
                    onClick={() => handleResponseClick(response)}
                    className={cn(
                      'w-full text-left px-4 py-3 rounded-xl border',
                      'bg-slate-700/40 border-slate-600 text-slate-200',
                      'hover:bg-slate-600/60 hover:border-slate-500',
                      'active:scale-[0.99] transition-all',
                      isProcessingAction ? 'opacity-60 cursor-not-allowed' : ''
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-blue-400 font-bold text-sm mt-0.5 flex-shrink-0">
                        {index + 1}.
                      </span>
                      <span className="flex-1 text-sm leading-relaxed">
                        {renderBoldSegments(response.text)}
                      </span>
                    </div>
                  </button>
                ))}
                {isProcessingAction ? (
                  <p className="text-xs text-slate-400 pb-2">
                    Nyx is weaving the trade...
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="pb-2">
                <button
                  disabled={isProcessingAction}
                  onClick={onClose}
                  className="w-full min-h-[48px] px-4 py-3 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-xl transition-colors"
                >
                  Continue
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Desktop Layout (original 3-column) */}
        <div className="hidden md:grid grid-cols-10 h-full">
          {/* Left Column - Character Profile Picture */}
          <div className="col-span-2 bg-slate-800/80 border-r border-slate-600 flex flex-col items-center justify-center p-6">
            <div className="flex flex-col items-center gap-3">
              <div className="w-32 h-32 flex items-center justify-center">
                {/* NPC Profile Picture */}
                {npcCharacterId === 'laozigotchi' ? (
                  <img
                    src="/pfp/laozigotchi_pfp.png"
                    alt={npcName}
                    className="w-28 h-28 rounded-full object-cover border-2 border-green-400"
                  />
                ) : (
                  /* Fallback to CharacterPreview for NPCs without profile pictures */
                  <CharacterPreview
                    characterId={npcCharacterId}
                    size="lg"
                    isSelected={true}
                    className="animate-pulse-subtle"
                  />
                )}
              </div>
              <div className="text-center">
                <div className="flex items-center gap-2 justify-center mb-1">
                  <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                  <h2 className="text-lg font-bold text-slate-100">
                    {npcName}
                  </h2>
                </div>
                <p className="text-xs text-slate-400 uppercase tracking-wider">
                  NPC
                </p>
              </div>
            </div>

            {/* Close button */}
            <button
              onClick={onClose}
              className="absolute top-4 left-4 text-slate-400 hover:text-slate-200 transition-colors p-2 rounded-lg hover:bg-slate-700/50"
              aria-label="Close dialogue"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Middle Column - Dialogue Text */}
          <div className="col-span-5 bg-slate-900/80 p-6 flex flex-col justify-center">
            <div
              className="bg-slate-800/50 rounded-lg p-6 border-l-4 border-green-400 cursor-pointer"
              onClick={handleSkipTyping}
            >
              <p className="text-slate-200 text-lg leading-relaxed">
                {renderTypedSegments(typedSegments)}
                {isTyping ? (
                  <span className="inline-block w-2 h-5 align-baseline animate-pulse">
                    ▌
                  </span>
                ) : null}
              </p>
            </div>
            {extraContent ? <div className="mt-6">{extraContent}</div> : null}
          </div>

          {/* Right Column - Response Buttons */}
          <div className="col-span-3 bg-slate-800/80 border-l border-slate-600 p-6 flex flex-col justify-center">
            {processedResponses && processedResponses.length > 0 ? (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-3">
                  {processedResponses.slice(0, 4).map((response, index) => (
                    <button
                      key={index}
                      disabled={isProcessingAction}
                      onClick={() => handleResponseClick(response)}
                      className={cn(
                        'text-left p-3 rounded-lg border transition-all duration-200',
                        'bg-slate-700/30 border-slate-600 text-slate-200',
                        'hover:bg-slate-600/50 hover:border-slate-500 hover:text-slate-100',
                        'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-900',
                        'active:scale-[0.98] active:bg-slate-600/70',
                        isProcessingAction
                          ? 'opacity-60 cursor-not-allowed'
                          : ''
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <span className="text-blue-400 font-bold text-sm mt-0.5 flex-shrink-0">
                          {index + 1}.
                        </span>
                        <span className="flex-1 text-sm leading-relaxed">
                          {renderBoldSegments(response.text)}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
                {isProcessingAction ? (
                  <p className="col-span-2 mt-4 text-xs text-slate-400">
                    Nyx is weaving the trade...
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full">
                <button
                  disabled={isProcessingAction}
                  onClick={onClose}
                  className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition-colors"
                >
                  Continue
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Hook for keyboard navigation
export function useDialogueKeyboard(
  isOpen: boolean,
  responses: DialogueResponse[] | undefined,
  onResponseSelect: (nextDialogue: string) => void,
  onClose: () => void,
  isLocked = false
) {
  React.useEffect(() => {
    if (!isOpen || isLocked) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Close on Escape
      if (event.key === 'Escape') {
        onClose();
        return;
      }

      // Number key shortcuts for responses
      if (responses && responses.length > 0) {
        const num = parseInt(event.key);
        if (num >= 1 && num <= responses.length) {
          const response = responses[num - 1];
          if (response.nextDialogue === 'end') {
            onClose();
          } else {
            onResponseSelect(response.nextDialogue);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isLocked, responses, onResponseSelect, onClose]);
}
