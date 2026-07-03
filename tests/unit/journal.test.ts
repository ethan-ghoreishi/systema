import { describe, it, expect } from 'vitest';
import { splitJournal, assignPhotos } from '../../src/lib/journal';

describe('splitJournal', () => {
  it('splits markdown and photo placeholders', () => {
    const text = '# Debrief\n\nIntro para.\n\n[photo: Carlsberg Laboratory]\n\nMore text.';
    const segs = splitJournal(text);
    expect(segs.map((s) => s.kind)).toEqual(['md', 'photo', 'md']);
    expect(segs[1]).toEqual({ kind: 'photo', stopName: 'Carlsberg Laboratory' });
  });

  it('tolerates a leading ! and odd spacing/case', () => {
    const segs = splitJournal('![PHOTO:  Harbour baths ]');
    expect(segs).toEqual([{ kind: 'photo', stopName: 'Harbour baths' }]);
  });

  it('returns one md segment when there are no placeholders', () => {
    expect(splitJournal('just text')).toEqual([{ kind: 'md', text: 'just text' }]);
  });
});

describe('assignPhotos', () => {
  const photo = (id: string, createdAt: number) => ({ id, createdAt });

  it('consumes photos per stop in capture order and collects leftovers', () => {
    const segs = splitJournal('a\n[photo: X]\nb\n[photo: X]\nc\n[photo: Y]');
    const byName = {
      X: [photo('x2', 2), photo('x1', 1), photo('x3', 3)],
      Z: [photo('z1', 1)],
    };
    const { photoForSegment, leftovers } = assignPhotos(segs, byName);
    const assigned = photoForSegment.filter(Boolean).map((p) => p!.id);
    expect(assigned).toEqual(['x1', 'x2']); // capture order, per stop
    expect(leftovers.map((p) => p.id).sort()).toEqual(['x3', 'z1']);
  });

  it('matches stop names case-insensitively and resolves misses to null', () => {
    const segs = splitJournal('[photo: carlsberg]\n[photo: Unknown]');
    const byName = { Carlsberg: [photo('c1', 1)] };
    const { photoForSegment } = assignPhotos(segs, byName);
    expect(photoForSegment[0]?.id).toBe('c1');
    expect(photoForSegment[1]).toBeNull();
  });
});
