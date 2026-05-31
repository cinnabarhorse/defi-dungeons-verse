'use client';

import { useState, useCallback } from 'react';

interface DialogueResponse {
  text: string;
  nextDialogue: string;
}

interface DialogueData {
  text: string;
  responses: DialogueResponse[];
}

interface DialogueState {
  isOpen: boolean;
  npcId: string | null;
  npcName: string | null;
  npcCharacterId: string | null;
  dialogueId: string | null;
  currentDialogue: string | null;
  dialogueData: DialogueData | null;
  isProcessingAction: boolean;
  pendingAction: string | null;
}

interface UseDialogueReturn {
  dialogueState: DialogueState;
  startDialogue: (
    npcId: string,
    npcName: string,
    npcCharacterId: string,
    dialogueId: string
  ) => void;
  selectResponse: (nextDialogue: string) => void;
  resolveAction: (nextDialogue: string | null) => Promise<void>;
  closeDialogue: () => void;
  isDialogueOpen: boolean;
}

export function useDialogue(): UseDialogueReturn {
  const [dialogueState, setDialogueState] = useState<DialogueState>({
    isOpen: false,
    npcId: null,
    npcName: null,
    npcCharacterId: null,
    dialogueId: null,
    currentDialogue: null,
    dialogueData: null,
    isProcessingAction: false,
    pendingAction: null,
  });

  const loadDialogueData = useCallback(
    async (
      dialogueId: string,
      dialogueKey: string
    ): Promise<DialogueData | null> => {
      try {
        // Load dialogue JSON file from server
        const response = await fetch(`/api/npc-dialogue/${dialogueId}`);
        if (!response.ok) {
          console.error('Failed to load dialogue:', response.statusText);
          return null;
        }

        const dialogueFile = await response.json();
        const dialogue = dialogueFile.dialogues[dialogueKey];

        if (!dialogue) {
          console.error('Dialogue key not found:', dialogueKey);
          return null;
        }

        return dialogue;
      } catch (error) {
        console.error('Error loading dialogue:', error);
        return null;
      }
    },
    []
  );

  const startDialogue = useCallback(
    async (
      npcId: string,
      npcName: string,
      npcCharacterId: string,
      dialogueId: string
    ) => {
      console.log(
        '🎭 Starting dialogue with',
        npcName,
        'character:',
        npcCharacterId,
        'using dialogue',
        dialogueId
      );

      // Load the greeting dialogue
      const dialogueData = await loadDialogueData(dialogueId, 'greeting');
      if (!dialogueData) {
        console.error('Failed to load greeting dialogue for', dialogueId);
        return;
      }

      setDialogueState((prev) => ({
        ...prev,
        isOpen: true,
        npcId,
        npcName,
        npcCharacterId,
        dialogueId,
        currentDialogue: 'greeting',
        dialogueData,
      }));
    },
    [loadDialogueData]
  );

  const selectResponse = useCallback(
    async (nextDialogue: string) => {
      if (!dialogueState.dialogueId || !dialogueState.npcId) return;
      if (dialogueState.isProcessingAction) {
        console.warn('Dialogue action already in progress');
        return;
      }

      console.log('🎭 Selecting response, next dialogue:', nextDialogue);

      if (nextDialogue.startsWith('action:')) {
        setDialogueState((prev) => ({
          ...prev,
          isProcessingAction: true,
          pendingAction: nextDialogue,
        }));

        const parts = nextDialogue.split(':');
        const [, actionDomain, actionVerb, ...rest] = parts;

        if (actionDomain === 'shop' && actionVerb === 'buy') {
          const itemId = rest.join(':');
          if (!itemId) {
            console.error(
              'Missing itemId for shop action response:',
              nextDialogue
            );
            setDialogueState((prev) => ({
              ...prev,
              isProcessingAction: false,
              pendingAction: null,
            }));
            return;
          }

          const npcId = dialogueState.npcId;
          const { getGameScene } = await import('../lib/getGameScene');
          const scene = getGameScene();
          const room = scene?.room;

          if (!room || !npcId) {
            console.error(
              'Unable to send npc_purchase message. Room or NPC missing.',
              {
                hasRoom: !!room,
                npcId,
              }
            );
            setDialogueState((prev) => ({
              ...prev,
              isProcessingAction: false,
              pendingAction: null,
            }));
            return;
          }

          try {
            room.send('npc_purchase', {
              npcId,
              itemId,
            });
          } catch (error) {
            console.error('Failed to send npc_purchase message', error);
            setDialogueState((prev) => ({
              ...prev,
              isProcessingAction: false,
              pendingAction: null,
            }));
          }
        } else {
          console.warn('Unhandled dialogue action:', nextDialogue);
          setDialogueState((prev) => ({
            ...prev,
            isProcessingAction: false,
            pendingAction: null,
          }));
        }

        return;
      }

      // Load the next dialogue
      const dialogueData = await loadDialogueData(
        dialogueState.dialogueId,
        nextDialogue
      );
      if (!dialogueData) {
        console.error('Failed to load dialogue:', nextDialogue);
        return;
      }

      setDialogueState((prev) => ({
        ...prev,
        currentDialogue: nextDialogue,
        dialogueData,
      }));
    },
    [
      dialogueState.dialogueId,
      dialogueState.npcId,
      dialogueState.isProcessingAction,
      loadDialogueData,
    ]
  );

  const resolveAction = useCallback(
    async (nextDialogue: string | null) => {
      const dialogueId = dialogueState.dialogueId;
      if (!dialogueId) {
        setDialogueState((prev) => ({
          ...prev,
          isProcessingAction: false,
          pendingAction: null,
        }));
        return;
      }

      if (!nextDialogue) {
        setDialogueState((prev) => ({
          ...prev,
          isProcessingAction: false,
          pendingAction: null,
        }));
        return;
      }

      const dialogueData = await loadDialogueData(dialogueId, nextDialogue);
      if (!dialogueData) {
        setDialogueState((prev) => ({
          ...prev,
          isProcessingAction: false,
          pendingAction: null,
        }));
        return;
      }

      setDialogueState((prev) => ({
        ...prev,
        isProcessingAction: false,
        pendingAction: null,
        currentDialogue: nextDialogue,
        dialogueData,
      }));
    },
    [dialogueState.dialogueId, loadDialogueData]
  );

  const closeDialogue = useCallback(() => {
    console.log('🎭 Closing dialogue');
    setDialogueState({
      isOpen: false,
      npcId: null,
      npcName: null,
      npcCharacterId: null,
      dialogueId: null,
      currentDialogue: null,
      dialogueData: null,
      isProcessingAction: false,
      pendingAction: null,
    });
  }, []);

  return {
    dialogueState,
    startDialogue,
    selectResponse,
    resolveAction,
    closeDialogue,
    isDialogueOpen: dialogueState.isOpen,
  };
}
