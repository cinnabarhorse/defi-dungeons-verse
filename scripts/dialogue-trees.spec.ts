import fs from 'fs';
import path from 'path';

interface DialogueResponse {
  text: string;
  nextDialogue: string;
}

interface DialogueNode {
  text: string;
  responses: DialogueResponse[];
}

interface DialogueFile {
  npcId?: string;
  npcName?: string;
  dialogues: Record<string, DialogueNode>;
}

function isAction(next: string): boolean {
  return next.startsWith('action:');
}

function readJsonFile(filePath: string): DialogueFile {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const json = JSON.parse(raw);
  return json as DialogueFile;
}

describe('NPC dialogue trees', () => {
  const baseDir = path.join(
    __dirname,
    '..',
    'apps',
    'server',
    'src',
    'data',
    'npc-dialogues'
  );

  it('directory exists', () => {
    expect(fs.existsSync(baseDir)).toBe(true);
  });

  const files = fs
    .readdirSync(baseDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(baseDir, f));

  if (files.length === 0) {
    it('has at least one dialogue file', () => {
      expect(files.length).toBeGreaterThan(0);
    });
  }

  for (const file of files) {
    describe(path.basename(file), () => {
      const data = readJsonFile(file);
      const keys = new Set(Object.keys(data?.dialogues || {}));

      it('has a dialogues map', () => {
        expect(data).toBeTruthy();
        expect(data.dialogues && typeof data.dialogues === 'object').toBe(true);
        expect(keys.size).toBeGreaterThan(0);
      });

      it('has a greeting node', () => {
        expect(keys.has('greeting')).toBe(true);
        const node = data.dialogues['greeting'];
        expect(node && typeof node.text === 'string').toBe(true);
        expect(Array.isArray(node.responses)).toBe(true);
      });

      it('all referenced nextDialogue nodes exist or are actions/end', () => {
        const missing: Array<{ from: string; target: string }> = [];
        for (const [nodeKey, node] of Object.entries(data.dialogues)) {
          // Basic shape
          expect(typeof node.text).toBe('string');
          expect(Array.isArray(node.responses)).toBe(true);

          for (const resp of node.responses) {
            expect(typeof resp.text).toBe('string');
            expect(typeof resp.nextDialogue).toBe('string');

            const target = resp.nextDialogue;
            if (isAction(target)) continue;
            if (target === 'end') continue; // special terminal case handled in UI
            if (!keys.has(target)) {
              missing.push({ from: nodeKey, target });
            }
          }
        }

        if (missing.length > 0) {
          const details = missing
            .map((m) => `  - ${m.from} -> ${m.target}`)
            .join('\n');
          throw new Error(
            `Missing dialogue nodes in ${path.basename(
              file
            )}:\n${details}\n\nAdd the missing node(s) or update response targets.`
          );
        }
      });
    });
  }
});









